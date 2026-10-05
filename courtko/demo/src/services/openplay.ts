/**
 * Open Play (doc 24 OPP / ATT / ROT): scheduled sessions where players register as participants without
 * reserving a whole court. Registration reuses the shared checkout → payment → ledger → refund pipeline
 * (checkout kind `open_play_registration`). Attendance is a separate state axis with an append-only event log;
 * court assignment and rotation are staff-controlled (strategies only suggest).
 */

import { checkinRef, checkinRefHash, issueLiveToken, issueRegistrationToken, parseCheckinToken, verifyCheckinSignature } from '../domain/checkin.ts';
import { randomBytes, toBase64Url } from '../domain/crypto.ts';
import { AppError, fail, invalid, type FieldError } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { computeRefund } from '../domain/ledger.ts';
import { formatPHP, pesos } from '../domain/money.ts';
import { describePolicy, evaluateCancellation, POLICY_LIBRARY } from '../domain/policy.ts';
import type { PaymentMethodCode } from '../domain/pricing.ts';
import { findFormat, formatAllowed, OPEN_PLAY_STYLE_LABEL, playersPerGame, registrationModesFor, ROTATION_LABEL, skillLabel, type RegistrationMode, type RotationStrategy, type SportConfig } from '../domain/sports.ts';
import { CHECKOUT_TRANSITIONS, OP_REG_TRANSITIONS, OP_SESSION_TRANSITIONS, transition } from '../domain/state.ts';
import { formatDateShort, formatTime, formatTimeRange, HOUR, MINUTE } from '../domain/time.ts';
import { normalizePhMobile } from '../domain/validation.ts';
import { defaultPreferences } from './auth.ts';
import { activeRestriction, assertNotRestricted, buildQuoteSafe, cancelCheckout, insertSlot, registerCheckoutHooks, releaseSlot, saveSnapshot, startPayment, taxProfile, unitsOfCourt } from './checkout.ts';
import type { AttendanceEvent, AttendanceStatus, BookingSlot, Checkout, Id, OpenPlayGame, OpenPlayParty, OpenPlayRegistration, OpenPlaySession, PartyInvite, Payment, Venue } from './model.ts';
import { venueCancelBooking } from './booking.ts';
import { slotUnits, unitsIntersect } from './store.ts';
import { createRefund } from './refunds.ts';
import type { Db } from './store.ts';
import { actorLabel, audit, commissionTermsFor, DEFAULT_SOCIAL, displayName, notify, notifyBusiness, profileOf, requireBusiness, requirePlatform, requireUser, requireVerifiedUser, requireWritable, settings, type Svc } from './svc.ts';

const INVITE_TTL = 30 * MINUTE;
const HOLD_TTL = 10 * MINUTE;
const OFFER_TTL = 60 * MINUTE;
const PRESENT: AttendanceStatus[] = ['checked_in', 'waiting', 'on_court', 'temp_off'];

// ---------------------------------------------------------------- helpers

function sportOf(db: Db, code: string): SportConfig {
  const sp = db.get('sports', code);
  if (!sp) fail('SPORT_NOT_SUPPORTED', 'That sport is not available.');
  return sp;
}

function liveReg(r: OpenPlayRegistration, now: number): boolean {
  if (r.status === 'confirmed') return true;
  if (r.status === 'held' || r.status === 'pending_payment') return r.holdExpiresAt === null || r.holdExpiresAt > now;
  if (r.status === 'offered') return (r.offerExpiresAt ?? 0) > now;
  return false;
}

function partyMembers(db: Db, partyId: Id, now: number): OpenPlayRegistration[] {
  return db.filter('opRegistrations', (r) => r.partyId === partyId && liveReg(r, now));
}

/** Seats used: individuals + reserved party seats (a pair reserves 2, a team its size); team-unit sessions count teams. */
export function seatsUsed(db: Db, session: OpenPlaySession, now: number): number {
  const parties = db.filter('opParties', (p) => p.sessionId === session.id && p.status !== 'dissolved').filter((p) => partyMembers(db, p.id, now).length > 0);
  if (session.capacityUnit === 'team') return parties.filter((p) => p.kind === 'team').length;
  const individuals = db.count('opRegistrations', (r) => r.sessionId === session.id && r.partyId === null && liveReg(r, now));
  return individuals + parties.reduce((a, p) => a + Math.max(p.size, partyMembers(db, p.id, now).length), 0);
}

function remaining(db: Db, session: OpenPlaySession, now: number): number {
  return Math.max(0, session.capacity - seatsUsed(db, session, now));
}

function amountFor(session: OpenPlaySession, role: OpenPlayRegistration['role']): number {
  if (session.pricing === 'free') return 0;
  if (session.pricing === 'per_team') return role === 'captain' ? session.price : 0;
  return session.price;
}

function newRegistration(s: Svc, session: OpenPlaySession, userId: Id, p: Partial<OpenPlayRegistration> & Pick<OpenPlayRegistration, 'role' | 'mode' | 'status'>): OpenPlayRegistration {
  const id = newId('opr');
  const nonce = toBase64Url(randomBytes(12));
  const reg: OpenPlayRegistration = {
    id,
    sessionId: session.id,
    businessId: session.businessId,
    venueId: session.venueId,
    userId,
    partyId: null,
    history: [],
    checkoutId: null,
    waitlistPosition: null,
    offerExpiresAt: null,
    holdExpiresAt: null,
    attendance: 'not_arrived',
    checkedInAt: null,
    checkedInBy: null,
    checkInMethod: null,
    queueSince: null,
    courtId: null,
    gamesPlayed: 0,
    checkinNonce: nonce,
    checkinRefHash: checkinRefHash(checkinRef(id, nonce)),
    needsPartner: false,
    manuallyAdjusted: false,
    walkIn: false,
    skill: s.db.get('sportProfiles', `${userId}:${session.sport}`)?.skill ?? null,
    createdAt: s.now,
    confirmedAt: p.status === 'confirmed' ? s.now : null,
    cancelledAt: null,
    createdBy: s.actor.realUser?.id ?? userId,
    ...p,
  };
  s.db.insert('opRegistrations', reg);
  return reg;
}

function logAttendance(s: Svc, e: Omit<AttendanceEvent, 'id' | 'seq' | 'at' | 'actorUserId' | 'actorLabel'> & { actorLabel?: string }): AttendanceEvent {
  const row: AttendanceEvent = {
    id: newId('att'),
    seq: s.db.count('attendanceEvents', (x) => x.sessionId === e.sessionId) + 1,
    at: s.now,
    actorUserId: s.actor.realUser?.id ?? null,
    actorLabel: e.actorLabel ?? actorLabel(s),
    ...e,
  };
  s.db.insert('attendanceEvents', row);
  return row;
}

function setAttendance(s: Svc, reg: OpenPlayRegistration, to: AttendanceStatus, e: Omit<AttendanceEvent, 'id' | 'seq' | 'at' | 'actorUserId' | 'actorLabel' | 'sessionId' | 'businessId' | 'registrationId' | 'from' | 'to'> & { actorLabel?: string }, patch: Partial<OpenPlayRegistration> = {}): void {
  const from = reg.attendance;
  s.db.update('opRegistrations', reg.id, (x) => {
    x.attendance = to;
    if (to === 'waiting' && from !== 'waiting') x.queueSince = s.now;
    if (to !== 'on_court') x.courtId = null;
    Object.assign(x, patch);
  });
  logAttendance(s, { sessionId: reg.sessionId, businessId: reg.businessId, registrationId: reg.id, from, to, ...e });
}

function venueOf(db: Db, session: OpenPlaySession): Venue {
  return db.must('venues', session.venueId);
}

function courtLabel(db: Db, courtId: Id | null): string | null {
  return courtId ? db.get('courts', courtId)?.name ?? null : null;
}

// ---------------------------------------------------------------- views

/** Player-facing session fields (no internal staff assignments or slot ids). */
function publicSession(o: OpenPlaySession): OpenPlaySession {
  return { ...o, staffMemberIds: [], slotIds: [], createdBy: '' };
}

/** Player-facing registration (the check-in nonce/hash and staff ids stay server-side). */
function publicRegistration(r: OpenPlayRegistration): OpenPlayRegistration {
  return { ...r, checkinNonce: '', checkinRefHash: '', checkedInBy: null, createdBy: '' };
}

export function sessionSummary(s: Svc, o: OpenPlaySession, opts: { internal?: boolean } = {}) {
  const venue = venueOf(s.db, o);
  const sport = s.db.get('sports', o.sport);
  const format = sport ? findFormat(sport, o.formatCode) : undefined;
  const used = seatsUsed(s.db, o, s.now);
  const registered = s.db.count('opRegistrations', (r) => r.sessionId === o.id && r.status === 'confirmed');
  const waitlisted = s.db.count('opRegistrations', (r) => r.sessionId === o.id && (r.status === 'waitlisted' || r.status === 'offered'));
  const regs = s.db.filter('opRegistrations', (r) => r.sessionId === o.id && r.status === 'confirmed');
  return {
    session: opts.internal ? o : publicSession(o),
    venue: { id: venue.id, name: venue.name, slug: venue.slug, city: venue.address.city, barangay: venue.address.barangay, art: venue.art, offsetMin: venue.offsetMin },
    sportName: sport?.name ?? o.sport,
    sportIcon: sport?.icon ?? 'ball',
    formatLabel: o.style === 'custom' && o.customFormatLabel ? o.customFormatLabel : format?.label ?? o.formatCode,
    styleLabel: OPEN_PLAY_STYLE_LABEL[o.style],
    levelLabel: o.skillLevels.length ? o.skillLevels.map((l) => skillLabel(sport, l)).join(', ') : 'All levels',
    courts: o.courtIds.map((c) => courtLabel(s.db, c) ?? 'Court'),
    priceLabel: o.pricing === 'free' ? 'Free' : `${formatPHP(o.price)}${o.pricing === 'per_team' ? ' per team' : ' per player'}`,
    capacityLabel: `${o.capacity} ${o.capacityUnit === 'team' ? 'teams' : 'players'}`,
    used,
    remaining: Math.max(0, o.capacity - used),
    registered,
    waitlisted,
    checkedIn: regs.filter((r) => PRESENT.includes(r.attendance)).length,
    playing: regs.filter((r) => r.attendance === 'on_court').length,
    registrationOpen: (o.status === 'published' || o.status === 'in_progress') && s.now >= o.registrationOpensAt && s.now < o.registrationClosesAt,
    live: o.status === 'in_progress' || (o.status === 'published' && s.now >= o.startMs && s.now < o.endMs),
  };
}

export interface OpenPlaySearch {
  sport?: string;
  q?: string;
  venueId?: string;
  date?: string;
  level?: string;
  format?: string;
  maxPrice?: number;
  available?: boolean;
}

export function listOpenPlay(s: Svc, input: OpenPlaySearch) {
  const q = (input.q ?? '').trim().toLowerCase();
  return s.db
    .filter('openPlaySessions', (o) => (o.status === 'published' || o.status === 'in_progress') && o.visibility === 'public' && o.endMs > s.now && s.db.get('businesses', o.businessId)?.status === 'active')
    .filter((o) => (!input.sport || o.sport === input.sport) && (!input.venueId || o.venueId === input.venueId) && (!input.format || o.formatCode === input.format) && (!input.level || !o.skillLevels.length || o.skillLevels.includes(input.level)))
    .filter((o) => !input.maxPrice || o.pricing === 'free' || o.price <= input.maxPrice)
    .filter((o) => {
      const v = s.db.get('venues', o.venueId)!;
      if (input.date) {
        const d = new Date(o.startMs + v.offsetMin * MINUTE).toISOString().slice(0, 10);
        if (d !== input.date) return false;
      }
      return !q || [o.title, v.name, v.address.city, v.address.barangay].some((t) => t.toLowerCase().includes(q));
    })
    .map((o) => sessionSummary(s, o))
    .filter((x) => !input.available || x.remaining > 0)
    .sort((a, b) => a.session.startMs - b.session.startMs);
}

export type LivePhase = 'upcoming' | 'check_in' | 'live' | 'ended' | 'cancelled';

export function livePhase(o: OpenPlaySession, now: number): LivePhase {
  if (o.status === 'cancelled') return 'cancelled';
  if (o.status === 'completed' || now >= o.endMs) return 'ended';
  if (o.status === 'in_progress' || now >= o.startMs) return 'live';
  return now >= o.checkInOpensAt ? 'check_in' : 'upcoming';
}

/**
 * Privacy-safe live status for players (doc 24 §5), available from publication until the session ends:
 * aggregate counts, court occupancy and the viewer's own status only — never other players' names,
 * contact details or individual check-in records. Clients refresh it on the live channel (SSE in production).
 */
function playerLive(s: Svc, o: OpenPlaySession, mine: OpenPlayRegistration | undefined) {
  const regs = s.db.filter('opRegistrations', (r) => r.sessionId === o.id && r.status === 'confirmed');
  const waiting = regs.filter((r) => r.attendance === 'waiting').sort((a, b) => queueKey(o, a) - queueKey(o, b));
  const sport = s.db.get('sports', o.sport);
  const format = sport ? findFormat(sport, o.formatCode) : undefined;
  const perGame = format ? playersPerGame(format) : 4;
  const games = s.db.filter('opGames', (g) => g.sessionId === o.id);
  const liveGames = games.filter((g) => g.status === 'in_progress');
  const courts = o.courtIds.map((courtId) => {
    const g = liveGames.find((x) => x.courtId === courtId);
    return { name: courtLabel(s.db, courtId) ?? 'Court', inGame: !!g, minutes: g ? Math.max(0, Math.round((s.now - g.startedAt) / MINUTE)) : 0, players: g ? g.sideA.length + g.sideB.length : 0 };
  });
  const arrivals = regs.map((r) => r.checkedInAt).filter((t): t is number => t !== null && t <= s.now);
  const position = mine && mine.attendance === 'waiting' ? waiting.findIndex((r) => r.id === mine.id) + 1 : null;
  const freeSeats = courts.filter((c) => !c.inGame).length * perGame;
  // Rough estimate only: games ahead of you ÷ courts × game length (shown as "about").
  const estWaitMinutes = position === null ? null : position <= freeSeats ? 0 : Math.ceil((position - freeSeats) / (perGame * Math.max(1, courts.length))) * o.gameMinutes;
  return {
    status: o.status,
    phase: livePhase(o, s.now),
    capacity: o.capacity,
    registered: regs.length,
    checkedIn: regs.filter((r) => PRESENT.includes(r.attendance)).length,
    notArrived: regs.filter((r) => r.attendance === 'not_arrived').length,
    waiting: waiting.length,
    playing: regs.filter((r) => r.attendance === 'on_court').length,
    remaining: remaining(s.db, o, s.now),
    arrivedLast15: arrivals.filter((t) => s.now - t <= 15 * MINUTE).length,
    lastArrivalAt: arrivals.length ? Math.max(...arrivals) : null,
    gamesCompleted: games.filter((g) => g.status === 'completed').length,
    courts,
    gameMinutes: o.gameMinutes,
    playersPerGame: perGame,
    startsAt: o.startMs,
    endsAt: o.endMs,
    checkInOpensAt: o.checkInOpensAt,
    lateCutoffAt: o.lateCutoffAt,
    me: mine
      ? {
          registrationStatus: mine.status,
          attendance: mine.attendance,
          court: courtLabel(s.db, mine.courtId),
          waitingPosition: position,
          estWaitMinutes,
          gamesPlayed: mine.gamesPlayed,
        }
      : null,
    updatedAt: s.now,
  };
}

function partyView(s: Svc, partyId: Id | null, viewerId: Id | null) {
  if (!partyId) return null;
  const p = s.db.get('opParties', partyId);
  if (!p) return null;
  const members = s.db.filter('opRegistrations', (r) => r.partyId === p.id && !['cancelled', 'refunded'].includes(r.status));
  const invites = s.db.filter('opInvites', (i) => i.partyId === p.id).sort((a, b) => b.createdAt - a.createdAt);
  // Only display names are shared between party members — never contact details.
  return {
    party: p,
    members: members.map((m) => ({ registrationId: m.id, name: displayName(s.db, m.userId), username: profileOf(s.db, m.userId)?.username ?? null, role: m.role, status: m.status, attendance: m.attendance, me: m.userId === viewerId })),
    invites: invites.map((i) => ({ id: i.id, status: i.status, name: displayName(s.db, i.inviteeId), expiresAt: i.expiresAt })),
    openSeats: Math.max(0, p.size - members.length - invites.filter((i) => i.status === 'pending' && i.expiresAt > s.now).length),
  };
}

export function getOpenPlay(s: Svc, input: { sessionId: Id }) {
  const o = s.db.get('openPlaySessions', input.sessionId);
  if (!o || o.status === 'draft') fail('NOT_FOUND', 'Session not found.');
  const me = s.actor.user;
  const mine = me ? s.db.find('opRegistrations', (r) => r.sessionId === o.id && r.userId === me.id && !['cancelled', 'refunded'].includes(r.status)) : undefined;
  const policy = POLICY_LIBRARY[o.policyKey];
  const sport = s.db.get('sports', o.sport);
  const format = sport ? findFormat(sport, o.formatCode) : undefined;
  const joinableTeams = s.db
    .filter('opParties', (p) => p.sessionId === o.id && p.kind === 'team' && p.joinable && p.status !== 'dissolved')
    .map((p) => ({ id: p.id, name: p.name, size: p.size, members: partyMembers(s.db, p.id, s.now).length }))
    .filter((p) => p.members > 0 && p.members < p.size);
  return {
    ...sessionSummary(s, o),
    policy: { name: policy.name, lines: describePolicy(policy) },
    rotationLabel: ROTATION_LABEL[o.rotation],
    format: format ?? null,
    joinableTeams,
    restricted: me ? !!activeRestriction(s.db, me.id, o.businessId, o.venueId, s.now) : false,
    mine: mine ? { registration: publicRegistration(mine), party: partyView(s, mine.partyId, me!.id) } : null,
    liveSummary: playerLive(s, o, mine),
  };
}

// ---------------------------------------------------------------- registration (player)

function findUserByUsername(s: Svc, username: string): Id {
  const u = username.trim().replace(/^@/, '').toLowerCase();
  const p = s.db.find('profiles', (x) => (x.username ?? '').toLowerCase() === u);
  const viewer = s.actor.user?.id;
  // Blocks in either direction look like "not found" (doc 24 CR-D12); contact details are never searched.
  if (!p || s.db.get('users', p.userId)?.status !== 'active' || (viewer && (s.db.find('blocks', (b) => (b.blockerId === viewer && b.blockedId === p.userId) || (b.blockerId === p.userId && b.blockedId === viewer))))) fail('NOT_FOUND', `No player found with the username @${u}.`);
  return p.userId;
}

function assertCanRegister(s: Svc, o: OpenPlaySession, userId: Id): void {
  if (o.status !== 'published' && o.status !== 'in_progress') fail('NOT_FOUND', 'Session not found.');
  if (s.now < o.registrationOpensAt || s.now >= o.registrationClosesAt) fail('REGISTRATION_CLOSED', s.now < o.registrationOpensAt ? `Registration opens ${formatDateShort(o.registrationOpensAt)} at ${formatTime(o.registrationOpensAt)}.` : 'Registration for this session has closed.');
  assertNotRestricted(s, userId, o.businessId, o.venueId);
  if (s.db.find('opRegistrations', (r) => r.sessionId === o.id && r.userId === userId && (liveReg(r, s.now) || r.status === 'waitlisted'))) fail('CONFLICT', "You're already registered or waitlisted for this session.");
}

function createRegistrationCheckout(s: Svc, o: OpenPlaySession, reg: OpenPlayRegistration, amount: number, opts: { source?: 'online' | 'walk_in'; createdBy?: Id } = {}): { checkoutId: Id; expiresAt: number } {
  const venue = venueOf(s.db, o);
  const business = s.db.must('businesses', o.businessId);
  const cfg = settings(s.db);
  const expiresAt = s.now + HOLD_TTL;
  const checkoutId = newId('chk');
  const { terms } = commissionTermsFor(s.db, business.id, s.now);
  const label = `${o.title}${reg.role === 'captain' && o.pricing === 'per_team' ? ' · team entry' : ''}`;
  const quote = buildQuoteSafe({ eventItems: [{ ref: 'open_play', label, detail: `${formatDateShort(o.startMs, venue.offsetMin)} · ${formatTimeRange(o.startMs, o.endMs, venue.offsetMin)}`, amount, taxable: true }], tax: taxProfile(s, business), fee: null, commission: terms });
  const snap = saveSnapshot(s, business.id, quote, expiresAt);
  const checkout: Checkout = {
    id: checkoutId,
    kind: 'open_play_registration',
    userId: reg.userId,
    businessId: business.id,
    venueId: venue.id,
    status: 'open',
    history: [],
    createdAt: s.now,
    expiresAt,
    maxExpiresAt: s.now + cfg.maxHoldLifetimeMinutes * MINUTE,
    snapshotId: snap.id,
    paymentMethod: null,
    paymentIds: [],
    openPlayRegistrationId: reg.id,
    promoCode: null,
    redemptionId: null,
    addOns: [],
    policyKey: o.policyKey,
    policyVersion: POLICY_LIBRARY[o.policyKey].version,
    policyAcceptedAt: null,
    source: opts.source ?? 'online',
    createdBy: opts.createdBy ?? reg.userId,
  };
  s.db.insert('checkouts', checkout);
  s.db.update('opRegistrations', reg.id, (r) => {
    r.checkoutId = checkoutId;
    r.holdExpiresAt = expiresAt;
  });
  return { checkoutId, expiresAt };
}

/** Confirmation side effects shared by paid (after verified capture) and free registrations. */
function onConfirmed(s: Svc, reg: OpenPlayRegistration): void {
  const o = s.db.must('openPlaySessions', reg.sessionId);
  const venue = venueOf(s.db, o);
  if (reg.partyId) {
    const p = s.db.must('opParties', reg.partyId);
    if (reg.role === 'captain' && p.invitees.length) {
      for (const inviteeId of p.invitees) createInvite(s, o, p, reg.userId, inviteeId);
      s.db.update('opParties', p.id, (x) => {
        x.invitees = [];
      });
    }
    refreshParty(s, p.id);
  }
  notify(s, reg.userId, 'events', {
    title: `You're in · ${o.title}`,
    body: `${venue.name} · ${formatDateShort(o.startMs, venue.offsetMin)}, ${formatTimeRange(o.startMs, o.endMs, venue.offsetMin)}. Show your Open Play QR at the front desk to check in.`,
    link: `#/app/open-play/registrations/${reg.id}`,
  });
  notifyBusiness(s, o.businessId, 'openplay.view', { title: `New Open Play registration · ${o.title}`, body: `${displayName(s.db, reg.userId)} (${reg.mode})`, link: `#/biz/open-play/${o.id}` });
  if (reg.walkIn) {
    const fresh = s.db.must('opRegistrations', reg.id);
    if (fresh.attendance === 'not_arrived') setAttendance(s, fresh, o.autoQueueOnCheckIn ? 'waiting' : 'checked_in', { type: 'walk_in', method: 'walk_in' }, { checkedInAt: s.now, checkedInBy: fresh.createdBy, checkInMethod: 'walk_in' });
  }
}

function refreshParty(s: Svc, partyId: Id): void {
  const p = s.db.get('opParties', partyId);
  if (!p || p.status === 'dissolved') return;
  const confirmed = s.db.count('opRegistrations', (r) => r.partyId === p.id && r.status === 'confirmed');
  const live = partyMembers(s.db, p.id, s.now).length;
  const pending = s.db.count('opInvites', (i) => i.partyId === p.id && i.status === 'pending' && i.expiresAt > s.now);
  const status: OpenPlayParty['status'] = live === 0 ? 'dissolved' : confirmed >= p.size ? 'complete' : pending || p.invitees.length || (p.kind === 'team' && p.joinable) ? 'forming' : 'needs_member';
  if (status !== p.status) s.db.update('opParties', p.id, (x) => {
    x.status = status;
  });
  const captain = s.db.find('opRegistrations', (r) => r.partyId === p.id && r.role === 'captain' && liveReg(r, s.now));
  if (captain && p.kind === 'pair') {
    const needs = status === 'needs_member';
    if (captain.needsPartner !== needs) s.db.update('opRegistrations', captain.id, (x) => {
      x.needsPartner = needs;
    });
  }
}

function createInvite(s: Svc, o: OpenPlaySession, p: OpenPlayParty, inviterId: Id, inviteeId: Id): PartyInvite {
  const inv: PartyInvite = { id: newId('inv'), partyId: p.id, sessionId: o.id, businessId: o.businessId, inviterId, inviteeId, status: 'pending', createdAt: s.now, expiresAt: Math.min(s.now + INVITE_TTL, o.registrationClosesAt), respondedAt: null };
  s.db.insert('opInvites', inv);
  notify(s, inviteeId, 'events', {
    title: `${displayName(s.db, inviterId)} invited you to Open Play`,
    body: `${o.title} — join as their ${p.kind === 'pair' ? 'partner' : `teammate on ${p.name}`}. Respond before ${formatTime(inv.expiresAt)}.`,
    link: '#/app/invites',
  });
  return inv;
}

export function registerOpenPlay(s: Svc, input: { sessionId: Id; mode: RegistrationMode; partnerUsername?: string; teamName?: string; teamSize?: number; teammateUsernames?: string[]; joinPartyId?: Id; skill?: string | null; joinable?: boolean }) {
  requireWritable(s);
  const user = requireVerifiedUser(s);
  const o = s.db.get('openPlaySessions', input.sessionId);
  if (!o) fail('NOT_FOUND', 'Session not found.');
  assertCanRegister(s, o, user.id);
  const sport = sportOf(s.db, o.sport);
  const format = findFormat(sport, o.formatCode);
  if (!format) fail('FORMAT_INCOMPATIBLE', 'This session format is not available.');
  if (input.skill && !sport.skillLevels.some((l) => l.code === input.skill)) invalid([{ field: 'skill', message: 'Choose a skill level for this sport.' }]);
  const skill = input.skill ?? s.db.get('sportProfiles', `${user.id}:${o.sport}`)?.skill ?? null;
  if (o.skillLevels.length && skill && !o.skillLevels.includes(skill)) fail('BOOKING_NOT_ALLOWED', `This session is for ${o.skillLevels.map((l) => skillLabel(sport, l)).join(', ')} players.`);

  // Join an existing team
  if (input.joinPartyId) {
    const p = s.db.get('opParties', input.joinPartyId);
    if (!p || p.sessionId !== o.id || p.kind !== 'team' || !p.joinable || p.status === 'dissolved') fail('NOT_FOUND', 'That team is not open for new members.');
    if (partyMembers(s.db, p.id, s.now).length >= p.size) fail('SESSION_FULL', `${p.name} is full.`);
    const amount = amountFor(o, 'member');
    const reg = newRegistration(s, o, user.id, { role: 'member', mode: 'team', status: amount ? 'held' : 'confirmed', partyId: p.id, skill });
    if (!amount) {
      onConfirmed(s, reg);
      return { registrationId: reg.id, checkoutId: null, status: 'confirmed' as const };
    }
    const c = createRegistrationCheckout(s, o, reg, amount);
    return { registrationId: reg.id, checkoutId: c.checkoutId, status: 'held' as const };
  }

  const allowedModes = o.registrationModes;
  if (!allowedModes.includes(input.mode)) fail('FORMAT_INCOMPATIBLE', `This session doesn't take ${input.mode} registrations.`);
  let party: OpenPlayParty | null = null;
  let need = 1;
  if (input.mode === 'partner') {
    if (!input.partnerUsername?.trim()) fail('PARTNER_REQUIRED', 'Enter your partner’s CourtKo username, or register individually.', { fields: [{ field: 'partnerUsername', message: 'Enter a username.' }] });
    const partnerId = findUserByUsername(s, input.partnerUsername);
    if (partnerId === user.id) invalid([{ field: 'partnerUsername', message: "You can't invite yourself." }]);
    if (s.db.find('opRegistrations', (r) => r.sessionId === o.id && r.userId === partnerId && liveReg(r, s.now))) fail('CONFLICT', 'That player is already registered for this session.');
    party = { id: newId('opp'), sessionId: o.id, businessId: o.businessId, kind: 'pair', name: `${displayName(s.db, user.id)} & ${displayName(s.db, partnerId)}`, captainUserId: user.id, size: 2, status: 'forming', joinable: false, invitees: [partnerId], createdAt: s.now, createdBy: user.id };
    need = 2;
  } else if (input.mode === 'team') {
    const range = format.teamSize ?? { min: 2, max: 10, default: o.teamSize };
    const size = Math.round(input.teamSize ?? o.teamSize);
    const errors: FieldError[] = [];
    const name = (input.teamName ?? '').trim();
    if (name.length < 2 || name.length > 40) errors.push({ field: 'teamName', message: 'Team name must be 2–40 characters.' });
    if (!(size >= range.min && size <= range.max)) errors.push({ field: 'teamSize', message: `Teams have ${range.min}–${range.max} players for ${format.label}.` });
    if (errors.length) invalid(errors);
    if (s.db.find('opParties', (p) => p.sessionId === o.id && p.status !== 'dissolved' && p.name.toLowerCase() === name.toLowerCase())) invalid([{ field: 'teamName', message: 'Another team already uses that name in this session.' }]);
    const invitees = (input.teammateUsernames ?? []).map((u) => u.trim()).filter(Boolean).slice(0, size - 1).map((u) => findUserByUsername(s, u)).filter((id) => id !== user.id);
    party = { id: newId('opp'), sessionId: o.id, businessId: o.businessId, kind: 'team', name, captainUserId: user.id, size, status: 'forming', joinable: input.joinable ?? true, invitees: [...new Set(invitees)], createdAt: s.now, createdBy: user.id };
    need = o.capacityUnit === 'team' ? 1 : size;
  }
  if (remaining(s.db, o, s.now) < need) fail('SESSION_FULL', `This session is full${o.waitlistEnabled && input.mode === 'individual' ? ' — you can join the waitlist.' : need > 1 ? ' for a group of that size.' : '.'}`);
  if (party) s.db.insert('opParties', party);
  const role: OpenPlayRegistration['role'] = party ? 'captain' : 'individual';
  const amount = amountFor(o, role);
  const reg = newRegistration(s, o, user.id, { role, mode: input.mode, status: amount ? 'held' : 'confirmed', partyId: party?.id ?? null, skill });
  if (!amount) {
    onConfirmed(s, reg);
    return { registrationId: reg.id, checkoutId: null, status: 'confirmed' as const };
  }
  const c = createRegistrationCheckout(s, o, reg, amount);
  return { registrationId: reg.id, checkoutId: c.checkoutId, status: 'held' as const };
}

export function joinOpenPlayWaitlist(s: Svc, input: { sessionId: Id }) {
  requireWritable(s);
  const user = requireVerifiedUser(s);
  const o = s.db.get('openPlaySessions', input.sessionId);
  if (!o || !o.waitlistEnabled) fail('CONFLICT', 'This session has no waitlist.');
  assertCanRegister(s, o, user.id);
  const position = s.db.count('opRegistrations', (r) => r.sessionId === o.id && r.status === 'waitlisted') + 1;
  const reg = newRegistration(s, o, user.id, { role: 'individual', mode: 'individual', status: 'waitlisted', waitlistPosition: position });
  notify(s, user.id, 'events', { title: `On the waitlist · ${o.title}`, body: `You're #${position}. We'll notify you if a spot opens.`, link: `#/app/open-play/registrations/${reg.id}` });
  return { registrationId: reg.id, position };
}

function offerNext(s: Svc, o: OpenPlaySession): void {
  if (!o.waitlistEnabled || o.status === 'cancelled' || o.status === 'completed' || s.now >= o.registrationClosesAt) return;
  while (remaining(s.db, o, s.now) > 0) {
    const next = s.db.filter('opRegistrations', (r) => r.sessionId === o.id && r.status === 'waitlisted').sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0) || a.createdAt - b.createdAt)[0];
    if (!next) return;
    const until = Math.min(s.now + OFFER_TTL, o.registrationClosesAt);
    s.db.update('opRegistrations', next.id, (r) => {
      r.offerExpiresAt = until;
      transition(OP_REG_TRANSITIONS, r, 'offered', s.now, 'system', 'Spot opened', 'Open Play registration');
    });
    notify(s, next.userId, 'events', { title: `A spot opened · ${o.title}`, body: `Claim it before ${formatTime(until)} or it goes to the next player.`, link: `#/app/open-play/registrations/${next.id}` });
  }
}

export function acceptOpenPlayOffer(s: Svc, input: { registrationId: Id }) {
  requireWritable(s);
  const user = requireUser(s);
  const reg = s.db.get('opRegistrations', input.registrationId);
  if (!reg || reg.userId !== user.id) fail('NOT_FOUND', 'Registration not found.');
  if (reg.status !== 'offered' || (reg.offerExpiresAt ?? 0) <= s.now) fail('INVITE_EXPIRED', 'This offer has expired.');
  const o = s.db.must('openPlaySessions', reg.sessionId);
  const amount = amountFor(o, 'individual');
  if (!amount) {
    s.db.update('opRegistrations', reg.id, (r) => {
      r.confirmedAt = s.now;
      r.offerExpiresAt = null;
      r.waitlistPosition = null;
      transition(OP_REG_TRANSITIONS, r, 'confirmed', s.now, user.id, 'Waitlist offer accepted', 'Open Play registration');
    });
    onConfirmed(s, s.db.must('opRegistrations', reg.id));
    return { registrationId: reg.id, checkoutId: null };
  }
  s.db.update('opRegistrations', reg.id, (r) => {
    r.offerExpiresAt = null;
    r.waitlistPosition = null;
    transition(OP_REG_TRANSITIONS, r, 'held', s.now, user.id, 'Waitlist offer accepted', 'Open Play registration');
  });
  const c = createRegistrationCheckout(s, o, s.db.must('opRegistrations', reg.id), amount);
  return { registrationId: reg.id, checkoutId: c.checkoutId };
}

// ---------------------------------------------------------------- invites

export function myInvites(s: Svc) {
  const u = requireUser(s);
  return s.db
    .filter('opInvites', (i) => i.inviteeId === u.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((i) => {
      const o = s.db.must('openPlaySessions', i.sessionId);
      const p = s.db.must('opParties', i.partyId);
      return { invite: { ...i, status: i.status === 'pending' && i.expiresAt <= s.now ? ('expired' as const) : i.status }, from: displayName(s.db, i.inviterId), party: { kind: p.kind, name: p.name }, ...sessionSummary(s, o), price: amountFor(o, p.kind === 'pair' ? 'partner' : 'member') };
    });
}

export function respondToInvite(s: Svc, input: { inviteId: Id; accept: boolean }) {
  requireWritable(s);
  const user = requireVerifiedUser(s);
  const inv = s.db.get('opInvites', input.inviteId);
  if (!inv || inv.inviteeId !== user.id) fail('NOT_FOUND', 'Invitation not found.');
  if (inv.status !== 'pending') fail('CONFLICT', `This invitation was already ${inv.status}.`);
  if (inv.expiresAt <= s.now) fail('INVITE_EXPIRED', 'This invitation has expired.');
  const o = s.db.must('openPlaySessions', inv.sessionId);
  const p = s.db.must('opParties', inv.partyId);
  if (!input.accept) {
    s.db.update('opInvites', inv.id, (x) => {
      x.status = 'declined';
      x.respondedAt = s.now;
    });
    partnerGone(s, o, p, `${displayName(s.db, user.id)} declined your invitation`);
    return { status: 'declined' as const, checkoutId: null, registrationId: null };
  }
  assertCanRegister(s, o, user.id);
  const role: OpenPlayRegistration['role'] = p.kind === 'pair' ? 'partner' : 'member';
  const amount = amountFor(o, role);
  s.db.update('opInvites', inv.id, (x) => {
    x.status = 'accepted';
    x.respondedAt = s.now;
  });
  const reg = newRegistration(s, o, user.id, { role, mode: p.kind === 'pair' ? 'partner' : 'team', status: amount ? 'held' : 'confirmed', partyId: p.id });
  notify(s, inv.inviterId, 'events', { title: `${displayName(s.db, user.id)} accepted · ${o.title}`, body: amount ? 'They are completing payment for their spot.' : 'Your group is set.', link: '#/app/open-play' });
  if (!amount) {
    onConfirmed(s, reg);
    return { status: 'accepted' as const, checkoutId: null, registrationId: reg.id };
  }
  const c = createRegistrationCheckout(s, o, reg, amount);
  return { status: 'accepted' as const, checkoutId: c.checkoutId, registrationId: reg.id };
}

/**
 * An invited partner declined, let the invite expire, cancelled, or never paid. Per session rules the remaining
 * player either stays registered and is marked as needing a partner (default), or both are cancelled with a
 * full refund. The affected player is always notified.
 */
function partnerGone(s: Svc, o: OpenPlaySession, p: OpenPlayParty, why: string): void {
  const captain = s.db.find('opRegistrations', (r) => r.partyId === p.id && r.role === 'captain' && liveReg(r, s.now));
  if (o.partnerFallback === 'cancel_both' && p.kind === 'pair' && captain && captain.status === 'confirmed') {
    cancelRegistrationInternal(s, captain, { initiator: 'system', reason: `${why} — the session requires a partner`, fullRefund: true, by: 'system' });
    notify(s, captain.userId, 'events', { title: `Registration cancelled · ${o.title}`, body: `${why}. This session needs a partner, so your registration was cancelled with a full refund.`, link: '#/app/open-play' });
    return;
  }
  refreshParty(s, p.id);
  if (captain) {
    if (p.kind === 'pair') s.db.update('opRegistrations', captain.id, (x) => {
      x.needsPartner = true;
    });
    notify(s, captain.userId, 'events', {
      title: p.kind === 'pair' ? `You need a partner · ${o.title}` : `A spot opened on ${p.name}`,
      body: `${why}. You're still registered${p.kind === 'pair' ? ' and marked as needing a partner — invite someone else, or the venue can pair you on the day' : ''}.`,
      link: '#/app/open-play',
    });
  }
}

export function invitePartner(s: Svc, input: { registrationId: Id; username: string }) {
  requireWritable(s);
  const user = requireUser(s);
  const reg = s.db.get('opRegistrations', input.registrationId);
  if (!reg || reg.userId !== user.id) fail('NOT_FOUND', 'Registration not found.');
  if (reg.role !== 'captain' || !reg.partyId) fail('CONFLICT', 'Only the person who registered the group can invite players.');
  if (reg.status !== 'confirmed') fail('CONFLICT', 'Finish your own registration first.');
  const o = s.db.must('openPlaySessions', reg.sessionId);
  const p = s.db.must('opParties', reg.partyId);
  const view = partyView(s, p.id, user.id)!;
  if (view.openSeats <= 0) fail('CONFLICT', 'Your group has no open spots.');
  const invitee = findUserByUsername(s, input.username);
  if (invitee === user.id) invalid([{ field: 'username', message: "You can't invite yourself." }]);
  if (s.db.find('opRegistrations', (r) => r.sessionId === o.id && r.userId === invitee && liveReg(r, s.now))) fail('CONFLICT', 'That player is already registered for this session.');
  if (s.db.find('opInvites', (i) => i.partyId === p.id && i.inviteeId === invitee && i.status === 'pending' && i.expiresAt > s.now)) fail('CONFLICT', 'You already invited that player.');
  const inv = createInvite(s, o, p, user.id, invitee);
  refreshParty(s, p.id);
  return inv;
}

// ---------------------------------------------------------------- my registrations & cancellation

export function myOpenPlay(s: Svc) {
  const u = requireUser(s);
  return s.db
    .filter('opRegistrations', (r) => r.userId === u.id && !(r.status === 'cancelled' && !r.confirmedAt))
    .sort((a, b) => s.db.must('openPlaySessions', b.sessionId).startMs - s.db.must('openPlaySessions', a.sessionId).startMs)
    .map((r) => ({ registration: publicRegistration(r), ...sessionSummary(s, s.db.must('openPlaySessions', r.sessionId)) }));
}

export function myOpenPlayRegistration(s: Svc, input: { registrationId: Id }) {
  const u = requireUser(s);
  const reg = s.db.get('opRegistrations', input.registrationId);
  if (!reg || reg.userId !== u.id) fail('NOT_FOUND', 'Registration not found.');
  const o = s.db.must('openPlaySessions', reg.sessionId);
  const checkout = reg.checkoutId ? s.db.get('checkouts', reg.checkoutId) ?? null : null;
  const payment = checkout ? s.db.filter('payments', (p) => p.checkoutId === checkout.id).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null : null;
  const refunds = payment ? s.db.filter('refunds', (r) => r.paymentId === payment.id) : [];
  const canCheckIn = reg.status === 'confirmed' && reg.attendance === 'not_arrived' && o.status !== 'cancelled' && o.status !== 'completed' && s.now < o.endMs;
  return {
    registration: publicRegistration(reg),
    ...sessionSummary(s, o),
    party: partyView(s, reg.partyId, u.id),
    checkout: checkout ? { id: checkout.id, status: checkout.status, expiresAt: checkout.expiresAt } : null,
    payment: payment ? { status: payment.status, amount: payment.amount, methodDisplay: payment.methodDisplay, capturedAt: payment.capturedAt } : null,
    refunds: refunds.map((r) => ({ amount: r.amount, status: r.status, reason: r.reason })),
    live: playerLive(s, o, reg),
    canCheckIn,
    checkInOpensAt: o.checkInOpensAt,
    lateCutoffAt: o.lateCutoffAt,
    attendanceHistory: s.db
      .filter('attendanceEvents', (e) => e.registrationId === reg.id && e.type !== 'check_in_rejected')
      .sort((a, b) => a.at - b.at)
      .map((e) => ({ type: e.type, to: e.to ?? null, at: e.at, court: courtLabel(s.db, e.courtId ?? null) })),
  };
}

/** Rotating live pass (OP1) and the registration QR (REG1). Neither contains personal data or permanent ids. */
export function openPlayCheckinToken(s: Svc, input: { registrationId: Id }) {
  const u = requireUser(s);
  const reg = s.db.get('opRegistrations', input.registrationId);
  if (!reg || reg.userId !== u.id) fail('NOT_FOUND', 'Registration not found.');
  if (reg.status !== 'confirmed') fail('CONFLICT', 'Your check-in pass is available once the registration is confirmed.');
  const o = s.db.must('openPlaySessions', reg.sessionId);
  const ref = checkinRef(reg.id, reg.checkinNonce);
  const live = issueLiveToken(ref, o.id, s.now, o.lateCutoffAt);
  return { token: live.token, expiresAt: live.expiresAt, registrationToken: issueRegistrationToken(ref, o.id, o.lateCutoffAt), validUntil: o.lateCutoffAt };
}

export function openPlayCancellationQuote(s: Svc, input: { registrationId: Id }) {
  const u = requireUser(s);
  const reg = s.db.get('opRegistrations', input.registrationId);
  if (!reg || reg.userId !== u.id) fail('NOT_FOUND', 'Registration not found.');
  const o = s.db.must('openPlaySessions', reg.sessionId);
  const decision = evaluateCancellation(POLICY_LIBRARY[o.policyKey], 'player', s.now, o.startMs);
  const payment = reg.checkoutId ? s.db.filter('payments', (p) => p.checkoutId === reg.checkoutId && ['captured', 'partially_refunded'].includes(p.status))[0] : undefined;
  const refund = payment ? computeRefund(s.db.must('snapshots', payment.snapshotId).quote, { items: [{ ref: 'open_play', sharePpm: decision.courtRefundPpm }], refundGatewayFee: decision.refundGatewayFee }).toCustomer : 0;
  const teamNote = reg.role === 'captain' && reg.partyId ? 'Cancelling also removes your partner or teammates from this session (they will be notified).' : reg.role === 'partner' ? 'Your partner stays registered and will be marked as needing a partner.' : null;
  return { tier: decision.tierLabel, refund, paid: payment?.amount ?? 0, validUntil: decision.validUntil, policy: POLICY_LIBRARY[o.policyKey].name, teamNote };
}

function cancelRegistrationInternal(s: Svc, reg: OpenPlayRegistration, opts: { initiator: 'player' | 'venue' | 'system'; reason: string; fullRefund: boolean; by: string }): number {
  const o = s.db.must('openPlaySessions', reg.sessionId);
  if (reg.status === 'held' || reg.status === 'pending_payment') {
    const c = reg.checkoutId ? s.db.get('checkouts', reg.checkoutId) : undefined;
    if (c && (c.status === 'open' || c.status === 'payment_pending')) cancelCheckout(s, c.id, opts.reason, opts.by);
    return 0;
  }
  if (reg.status === 'waitlisted' || reg.status === 'offered') {
    s.db.update('opRegistrations', reg.id, (x) => {
      x.cancelledAt = s.now;
      transition(OP_REG_TRANSITIONS, x, 'cancelled', s.now, opts.by, opts.reason, 'Open Play registration');
    });
    return 0;
  }
  if (reg.status !== 'confirmed') return 0;
  const decision = opts.fullRefund ? null : evaluateCancellation(POLICY_LIBRARY[o.policyKey], opts.initiator === 'player' ? 'player' : 'venue', s.now, o.startMs);
  s.db.update('opRegistrations', reg.id, (x) => {
    x.cancelledAt = s.now;
    x.courtId = null;
    transition(OP_REG_TRANSITIONS, x, 'cancelled', s.now, opts.by, opts.reason, 'Open Play registration');
  });
  let refunded = 0;
  const payment = reg.checkoutId ? s.db.filter('payments', (p) => p.checkoutId === reg.checkoutId && ['captured', 'partially_refunded'].includes(p.status))[0] : undefined;
  if (payment) {
    const quote = s.db.must('snapshots', payment.snapshotId).quote;
    const components = { items: quote.items.map((i) => ({ ref: i.ref, sharePpm: decision ? decision.courtRefundPpm : 1_000_000 })), refundGatewayFee: decision ? decision.refundGatewayFee : true };
    if (computeRefund(quote, components).toCustomer > 0) {
      const r = createRefund(s, { payment, components, reason: opts.reason, initiator: opts.initiator, openPlayRegistrationId: reg.id });
      refunded = r?.amount ?? 0;
    }
  }
  return refunded;
}

export function cancelMyOpenPlay(s: Svc, input: { registrationId: Id; reason?: string }) {
  requireWritable(s);
  const user = requireUser(s);
  const reg = s.db.get('opRegistrations', input.registrationId);
  if (!reg || reg.userId !== user.id) fail('NOT_FOUND', 'Registration not found.');
  const o = s.db.must('openPlaySessions', reg.sessionId);
  if (o.startMs <= s.now && reg.status === 'confirmed') fail('CONFLICT', 'The session has started. Ask the front desk to check you out instead.');
  if (!['confirmed', 'held', 'pending_payment', 'waitlisted', 'offered'].includes(reg.status)) fail('INVALID_STATE_TRANSITION', 'This registration is no longer active.');
  const tier = evaluateCancellation(POLICY_LIBRARY[o.policyKey], 'player', s.now, o.startMs).tierLabel;
  const refunded = cancelRegistrationInternal(s, reg, { initiator: 'player', reason: input.reason?.trim() || `Cancelled by player (${tier})`, fullRefund: false, by: user.id });
  // Partner / team consequences
  if (reg.partyId) {
    const p = s.db.must('opParties', reg.partyId);
    if (reg.role === 'captain') {
      for (const m of s.db.filter('opRegistrations', (r) => r.partyId === p.id && r.id !== reg.id && liveReg(r, s.now))) {
        const amount = cancelRegistrationInternal(s, m, { initiator: 'system', reason: `${displayName(s.db, user.id)} cancelled the group registration`, fullRefund: true, by: 'system' });
        notify(s, m.userId, 'events', { title: `Group registration cancelled · ${o.title}`, body: `${displayName(s.db, user.id)} cancelled the ${p.kind === 'pair' ? 'pair' : 'team'} registration.${amount ? ` Your ${formatPHP(amount)} is being refunded in full.` : ''} You can still register on your own.`, link: `#/app/open-play/${o.id}` });
      }
      for (const i of s.db.filter('opInvites', (x) => x.partyId === p.id && x.status === 'pending')) s.db.update('opInvites', i.id, (x) => {
        x.status = 'cancelled';
      });
      s.db.update('opParties', p.id, (x) => {
        x.status = 'dissolved';
      });
    } else {
      partnerGone(s, o, p, `${displayName(s.db, user.id)} cancelled`);
    }
  }
  notify(s, user.id, 'events', { title: `Cancelled · ${o.title}`, body: refunded ? `${tier}. ${formatPHP(refunded)} is on its way back to you.` : `${tier}.`, link: '#/app/open-play' });
  offerNext(s, o);
  return { refunded };
}

// ---------------------------------------------------------------- checkout hooks (verified capture)

registerCheckoutHooks('open_play_registration', {
  fulfill(s: Svc, checkout: Checkout, payment: Payment) {
    const reg = s.db.must('opRegistrations', checkout.openPlayRegistrationId!);
    const o = s.db.must('openPlaySessions', reg.sessionId);
    if (reg.status === 'cancelled') {
      // Late capture after the hold expired: recover the seat if one is still free, otherwise refund in full.
      const needSeat = reg.partyId ? 0 : 1;
      if (o.status === 'cancelled' || o.status === 'completed' || remaining(s.db, o, s.now) < needSeat) {
        if ((CHECKOUT_TRANSITIONS[checkout.status] as readonly string[]).includes('failed')) s.db.update('checkouts', checkout.id, (c) => transition(CHECKOUT_TRANSITIONS, c, 'failed', s.now, 'system', 'Session full after late payment', 'checkout'));
        createRefund(s, { payment, components: { items: s.db.must('snapshots', payment.snapshotId).quote.items.map((i) => ({ ref: i.ref, sharePpm: 1_000_000 })), refundGatewayFee: true }, reason: 'Session full after late payment', initiator: 'system', openPlayRegistrationId: reg.id });
        notify(s, reg.userId, 'events', { title: `${o.title}: the session filled up`, body: `Your hold expired before the payment completed. ${formatPHP(payment.amount)} is being refunded in full.`, link: '#/app/payments' });
        return;
      }
      s.db.update('opRegistrations', reg.id, (r) => transition(OP_REG_TRANSITIONS, r, 'pending_payment', s.now, 'system', 'Late payment recovered', 'Open Play registration'));
    }
    s.db.update('opRegistrations', reg.id, (r) => {
      r.confirmedAt = s.now;
      r.holdExpiresAt = null;
      transition(OP_REG_TRANSITIONS, r, 'confirmed', s.now, 'system', 'Payment verified with provider', 'Open Play registration');
    });
    s.db.update('checkouts', checkout.id, (c) => transition(CHECKOUT_TRANSITIONS, c, 'completed', s.now, 'system', 'Paid', 'checkout'));
    notify(s, reg.userId, 'payment_updates', { title: `Payment received · ${formatPHP(payment.amount)}`, body: `Open Play registration for ${o.title}.`, link: `#/app/open-play/registrations/${reg.id}` });
    onConfirmed(s, s.db.must('opRegistrations', reg.id));
  },
  released(s: Svc, checkout: Checkout, reason: string) {
    const reg = s.db.get('opRegistrations', checkout.openPlayRegistrationId!);
    if (!reg) return;
    const o = s.db.must('openPlaySessions', reg.sessionId);
    if (reg.partyId) {
      const p = s.db.must('opParties', reg.partyId);
      if (reg.role === 'captain') {
        s.db.update('opParties', p.id, (x) => {
          x.status = 'dissolved';
          x.invitees = [];
        });
      } else partnerGone(s, o, p, `${displayName(s.db, reg.userId)} didn't complete payment (${reason.toLowerCase()})`);
    }
    offerNext(s, o);
  },
});

// ---------------------------------------------------------------- business: sessions

function ownSession(s: Svc, businessId: Id, sessionId: Id): OpenPlaySession {
  const o = s.db.get('openPlaySessions', sessionId);
  if (!o || o.businessId !== businessId) fail('NOT_FOUND', 'Session not found.');
  return o;
}

export function businessOpenPlay(s: Svc, input: { businessId: Id; venueId?: Id }) {
  const acc = requireBusiness(s, input.businessId, 'openplay.view', { venueId: input.venueId ?? null });
  return s.db
    .filter('openPlaySessions', (o) => o.businessId === input.businessId && (!input.venueId || o.venueId === input.venueId) && (!acc.member.venueIds || acc.member.venueIds.includes(o.venueId)))
    .sort((a, b) => {
      const rank = (o: OpenPlaySession) => (livePhase(o, s.now) === 'live' ? 0 : o.endMs > s.now && o.status !== 'cancelled' ? 1 : 2);
      return rank(a) - rank(b) || (rank(a) === 2 ? b.startMs - a.startMs : a.startMs - b.startMs);
    })
    .map((o) => sessionSummary(s, o, { internal: true }));
}

export interface SaveOpenPlayInput {
  businessId: Id;
  sessionId?: Id;
  venueId: Id;
  sport: string;
  title: string;
  description: string;
  courtIds: Id[];
  startMs: number;
  endMs: number;
  registrationOpensAt: number;
  registrationClosesAt: number;
  checkInOpensAt: number;
  lateCutoffAt: number;
  minParticipants: number;
  capacity: number;
  capacityUnit: OpenPlaySession['capacityUnit'];
  formatCode: string;
  style: OpenPlaySession['style'];
  customFormatLabel?: string;
  skillLevels: string[];
  eligibility?: string;
  pricing: OpenPlaySession['pricing'];
  price: number;
  registrationModes: RegistrationMode[];
  teamSize?: number;
  walkInsAllowed: boolean;
  waitlistEnabled: boolean;
  equipmentIncluded: boolean;
  equipmentNote?: string;
  policyKey: OpenPlaySession['policyKey'];
  refundNote?: string;
  noShowPolicy?: string;
  partnerFallback?: OpenPlaySession['partnerFallback'];
  instructions?: string;
  organizer?: string;
  staffMemberIds?: Id[];
  rotation: RotationStrategy;
  autoQueueOnCheckIn?: boolean;
  scoreRecording: boolean;
  gameMinutes?: number;
  visibility?: OpenPlaySession['visibility'];
}

/** Server-side validation of an Open Play configuration (sport ↔ format ↔ courts compatibility, windows, capacity). */
export function validateOpenPlay(s: Svc, input: SaveOpenPlayInput, venue: Venue, isNew: boolean): { errors: FieldError[]; sport: SportConfig | null } {
  const errors: FieldError[] = [];
  const sport = s.db.get('sports', input.sport) ?? null;
  if (!sport || sport.status !== 'active' || !sport.openPlay.enabled) {
    errors.push({ field: 'sport', message: 'Choose an active sport.' });
    return { errors, sport: null };
  }
  if (!(venue.sports ?? ['pickleball']).includes(sport.code)) errors.push({ field: 'sport', message: `${venue.name} doesn't offer ${sport.name}. Add it in Venue settings first.` });
  const title = (input.title ?? '').trim();
  if (title.length < 3 || title.length > 80) errors.push({ field: 'title', message: 'Title must be 3–80 characters.' });
  const format = findFormat(sport, input.formatCode);
  if (!format || !formatAllowed(sport, input.formatCode, 'open_play')) errors.push({ field: 'formatCode', message: `That format isn't available for ${sport.name}.` });
  if (!sport.openPlay.styles.includes(input.style)) errors.push({ field: 'style', message: 'Choose a session style.' });
  if (input.style === 'custom' && !(input.customFormatLabel ?? '').trim()) errors.push({ field: 'customFormatLabel', message: 'Describe your custom format.' });
  const courts = input.courtIds.map((id) => s.db.get('courts', id));
  if (!courts.length) errors.push({ field: 'courtIds', message: 'Assign at least one court.' });
  for (const c of courts) {
    if (!c || c.venueId !== venue.id || c.status !== 'active') errors.push({ field: 'courtIds', message: 'One of the courts is not available at this venue.' });
    else if ((c.sport ?? 'pickleball') !== sport.code) errors.push({ field: 'courtIds', message: `${c.name} is set up for ${c.sport ?? 'pickleball'}, not ${sport.name}.` });
    else if (format?.layout === 'half' && c.layout !== 'half') errors.push({ field: 'courtIds', message: `${format.label} is played on half courts.` });
  }
  if (!(input.endMs > input.startMs)) errors.push({ field: 'endMs', message: 'End must be after start.' });
  if (input.endMs - input.startMs > 12 * HOUR) errors.push({ field: 'endMs', message: 'Sessions can be at most 12 hours.' });
  if (isNew && input.startMs < s.now - 5 * MINUTE) errors.push({ field: 'startMs', message: 'The session must start in the future.' });
  if (!(input.registrationOpensAt < input.registrationClosesAt)) errors.push({ field: 'registrationClosesAt', message: 'Registration must close after it opens.' });
  if (input.registrationClosesAt > input.endMs) errors.push({ field: 'registrationClosesAt', message: 'Registration must close before the session ends.' });
  if (!(input.checkInOpensAt <= input.startMs && input.checkInOpensAt >= input.startMs - 3 * HOUR)) errors.push({ field: 'checkInOpensAt', message: 'Check-in opens up to 3 hours before the start.' });
  if (!(input.lateCutoffAt >= input.startMs && input.lateCutoffAt <= input.endMs)) errors.push({ field: 'lateCutoffAt', message: 'The late-arrival cutoff must be during the session.' });
  if (!(Number.isInteger(input.capacity) && input.capacity >= 2 && input.capacity <= 200)) errors.push({ field: 'capacity', message: 'Capacity must be 2–200.' });
  if (!(Number.isInteger(input.minParticipants) && input.minParticipants >= 1 && input.minParticipants <= input.capacity)) errors.push({ field: 'minParticipants', message: 'Minimum must be between 1 and the capacity.' });
  if (input.pricing === 'free' ? input.price !== 0 : !(input.price >= pesos(1) && input.price <= pesos(10_000))) errors.push({ field: 'price', message: input.pricing === 'free' ? 'Free sessions have no price.' : 'Price must be ₱1–₱10,000.' });
  const modes = [...new Set(input.registrationModes)];
  const allowedModes = format ? registrationModesFor(sport, format) : [];
  if (!modes.length) errors.push({ field: 'registrationModes', message: 'Allow at least one registration type.' });
  for (const m of modes) if (!allowedModes.includes(m) || !sport.openPlay.registrationModes.includes(m)) errors.push({ field: 'registrationModes', message: `${m} registration doesn't fit ${format?.label ?? 'this format'}.` });
  if (input.capacityUnit === 'team' && (modes.length !== 1 || modes[0] !== 'team')) errors.push({ field: 'capacityUnit', message: 'Team capacity only works with team registration.' });
  if (input.pricing === 'per_team' && !modes.includes('team')) errors.push({ field: 'pricing', message: 'Per-team pricing needs team registration.' });
  if (modes.includes('team') && format?.teamSize) {
    const ts = input.teamSize ?? format.teamSize.default;
    if (!(ts >= format.teamSize.min && ts <= format.teamSize.max)) errors.push({ field: 'teamSize', message: `Team size must be ${format.teamSize.min}–${format.teamSize.max} for ${format.label}.` });
  }
  if (!sport.openPlay.rotationStrategies.includes(input.rotation)) errors.push({ field: 'rotation', message: 'Choose a rotation option.' });
  for (const l of input.skillLevels) if (!sport.skillLevels.some((x) => x.code === l)) errors.push({ field: 'skillLevels', message: 'Unknown skill level for this sport.' });
  if (!POLICY_LIBRARY[input.policyKey]) errors.push({ field: 'policyKey', message: 'Choose a cancellation policy.' });
  return { errors, sport };
}

export function saveOpenPlay(s: Svc, input: SaveOpenPlayInput) {
  const acc = requireBusiness(s, input.businessId, 'openplay.manage', { venueId: input.venueId, write: true });
  const venue = s.db.get('venues', input.venueId);
  if (!venue || venue.businessId !== input.businessId) fail('NOT_FOUND', 'Venue not found.');
  const existing = input.sessionId ? ownSession(s, input.businessId, input.sessionId) : undefined;
  if (existing && existing.status !== 'draft') {
    // Published: descriptive and operational fields only. Times, courts, sport and price need cancel + recreate.
    if (input.capacity < existing.capacity) fail('CONFLICT', 'Capacity can only be increased after publishing.');
    s.db.update('openPlaySessions', existing.id, (x) =>
      Object.assign(x, {
        title: input.title.trim().slice(0, 80) || x.title,
        description: (input.description ?? '').trim().slice(0, 2000),
        instructions: (input.instructions ?? '').trim().slice(0, 600),
        equipmentIncluded: input.equipmentIncluded,
        equipmentNote: (input.equipmentNote ?? '').slice(0, 200),
        walkInsAllowed: input.walkInsAllowed,
        waitlistEnabled: input.waitlistEnabled,
        rotation: input.rotation,
        scoreRecording: input.scoreRecording,
        staffMemberIds: (input.staffMemberIds ?? x.staffMemberIds).filter((m) => s.db.get('members', m)?.businessId === input.businessId),
        capacity: Math.max(x.capacity, Math.min(200, Math.round(input.capacity))),
        organizer: (input.organizer ?? x.organizer).slice(0, 80),
        updatedAt: s.now,
      }),
    );
    audit(s, { action: 'openplay.updated', targetType: 'open_play_session', targetId: existing.id, businessId: existing.businessId, summary: `Updated ${existing.title}` });
    offerNext(s, s.db.must('openPlaySessions', existing.id));
    return s.db.must('openPlaySessions', existing.id);
  }
  const { errors, sport } = validateOpenPlay(s, input, venue, !existing);
  if (errors.length) {
    if (errors.some((e) => e.field === 'formatCode' || e.field === 'registrationModes')) throw new AppError('FORMAT_INCOMPATIBLE', errors.map((e) => e.message).join(' '), { fields: errors });
    invalid(errors);
  }
  const format = findFormat(sport!, input.formatCode)!;
  const row: OpenPlaySession = {
    id: existing?.id ?? newId('ops'),
    businessId: input.businessId,
    venueId: venue.id,
    sport: sport!.code,
    title: input.title.trim(),
    description: (input.description ?? '').trim().slice(0, 2000),
    courtIds: [...new Set(input.courtIds)],
    startMs: input.startMs,
    endMs: input.endMs,
    registrationOpensAt: input.registrationOpensAt,
    registrationClosesAt: input.registrationClosesAt,
    checkInOpensAt: input.checkInOpensAt,
    lateCutoffAt: input.lateCutoffAt,
    minParticipants: input.minParticipants,
    capacity: input.capacity,
    capacityUnit: input.capacityUnit,
    formatCode: input.formatCode,
    style: input.style,
    customFormatLabel: (input.customFormatLabel ?? '').trim().slice(0, 60),
    skillLevels: input.skillLevels,
    eligibility: (input.eligibility ?? '').trim().slice(0, 200),
    pricing: input.pricing,
    price: input.pricing === 'free' ? 0 : input.price,
    registrationModes: [...new Set(input.registrationModes)],
    teamSize: input.teamSize ?? format.teamSize?.default ?? format.playersPerSide,
    walkInsAllowed: input.walkInsAllowed,
    waitlistEnabled: input.waitlistEnabled,
    equipmentIncluded: input.equipmentIncluded,
    equipmentNote: (input.equipmentNote ?? '').slice(0, 200),
    policyKey: input.policyKey,
    refundNote: (input.refundNote ?? '').slice(0, 300),
    noShowPolicy: (input.noShowPolicy ?? 'No-shows after the late-arrival cutoff are not refunded and are recorded on your venue history.').slice(0, 300),
    partnerFallback: input.partnerFallback ?? 'keep_solo',
    instructions: (input.instructions ?? '').trim().slice(0, 600),
    organizer: (input.organizer ?? '').trim().slice(0, 80) || venue.name,
    staffMemberIds: (input.staffMemberIds ?? []).filter((m) => s.db.get('members', m)?.businessId === input.businessId),
    rotation: input.rotation,
    autoQueueOnCheckIn: input.autoQueueOnCheckIn ?? true,
    scoreRecording: input.scoreRecording,
    gameMinutes: Math.max(5, Math.min(120, Math.round(input.gameMinutes ?? sport!.openPlay.defaultGameMinutes))),
    visibility: input.visibility ?? 'public',
    status: 'draft',
    history: existing?.history ?? [],
    slotIds: [],
    cancelReason: null,
    createdAt: existing?.createdAt ?? s.now,
    createdBy: existing?.createdBy ?? acc.user.id,
    publishedAt: null,
    updatedAt: s.now,
  };
  if (existing) s.db.update('openPlaySessions', existing.id, (x) => Object.assign(x, row));
  else s.db.insert('openPlaySessions', row);
  audit(s, { action: existing ? 'openplay.updated' : 'openplay.created', targetType: 'open_play_session', targetId: row.id, businessId: row.businessId, summary: `${existing ? 'Updated' : 'Created'} draft Open Play “${row.title}” (${sport!.name}, ${format.label})` });
  return s.db.must('openPlaySessions', row.id);
}

export interface CourtConflict {
  kind: 'booking' | 'hold' | 'block' | 'event' | 'open_play';
  sourceId: Id;
  label: string;
  court: string;
  startMs: number;
  endMs: number;
  when: string;
  /** True when the clash is only the sport changeover gap, not a direct overlap. */
  changeover: boolean;
}

function slotConflicts(s: Svc, courtId: Id, startMs: number, endMs: number, excludeSourceId: Id | null): CourtConflict[] {
  const court = s.db.must('courts', courtId);
  const venue = s.db.must('venues', court.venueId);
  const units = unitsOfCourt(court, court.id);
  const physical = court.physicalCourtId ? s.db.get('physicalCourts', court.physicalCourtId) : undefined;
  const gap = (physical?.changeoverMinutes ?? venue.settings.changeoverMinutes ?? 15) * MINUTE;
  const overlaps = (x: BookingSlot) => x.startMs < endMs && startMs < x.occupiedEndMs;
  const changeover = (x: BookingSlot) => !!gap && !!x.sport && !!court.sport && x.sport !== court.sport && x.startMs - gap < endMs && startMs < x.occupiedEndMs + gap;
  return s.db
    .filter('slots', (x) => x.status === 'active' && x.sourceId !== excludeSourceId && !(x.kind === 'hold' && x.expiresAt !== null && x.expiresAt <= s.now) && unitsIntersect(slotUnits(x), units) && (overlaps(x) || changeover(x)))
    .sort((a, b) => a.startMs - b.startMs)
    .map((x) => {
      const b = x.kind === 'booking' || x.kind === 'hold' ? s.db.get('bookings', x.sourceId) : undefined;
      const e = x.kind === 'event' ? s.db.get('events', x.sourceId) : undefined;
      const op = x.kind === 'open_play' ? s.db.get('openPlaySessions', x.sourceId) : undefined;
      const blk = x.kind === 'block' ? s.db.get('courtBlocks', x.sourceId) : undefined;
      const label = b
        ? x.kind === 'hold'
          ? `Checkout in progress (${b.code})`
          : `Booking ${b.code}`
        : e
          ? `Event: ${e.name}`
          : op
            ? `Open Play: ${op.title}`
            : blk
              ? `Court block (${blk.reason.replace(/_/g, ' ')}${blk.note ? ` — ${blk.note}` : ''})`
              : 'Court block';
      return { kind: x.kind as CourtConflict['kind'], sourceId: x.sourceId, label, court: s.db.get('courts', x.courtId)?.name ?? 'Court', startMs: x.startMs, endMs: x.endMs, when: `${formatDateShort(x.startMs, venue.offsetMin)} ${formatTimeRange(x.startMs, x.endMs, venue.offsetMin)}`, changeover: !overlaps(x) };
    });
}

/**
 * Pre-publish court check: what is already on each assigned court (and on dependent layouts that share its space)
 * during the session, plus a suggested set of free courts for the same sport and layout. Staff see exactly which
 * bookings, blocks or events are in the way instead of a generic "slot unavailable".
 */
export function openPlayCourtCheck(s: Svc, input: { businessId: Id; sessionId: Id; courtIds?: Id[] }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  const acc = requireBusiness(s, input.businessId, 'openplay.view', { venueId: o.venueId });
  const courtIds = input.courtIds?.length ? [...new Set(input.courtIds)] : o.courtIds;
  const exclude = o.status === 'draft' ? null : o.id;
  const courts = courtIds.map((courtId) => ({ courtId, name: s.db.get('courts', courtId)?.name ?? 'Court', conflicts: s.db.get('courts', courtId) ? slotConflicts(s, courtId, o.startMs, o.endMs, exclude) : [] }));
  const sport = s.db.get('sports', o.sport);
  const format = sport ? findFormat(sport, o.formatCode) : undefined;
  const candidates = s.db
    .filter('courts', (c) => c.venueId === o.venueId && c.status === 'active' && (c.sport ?? 'pickleball') === o.sport && (format?.layout !== 'half' || c.layout === 'half'))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  // Greedy replacement: keep the free courts, swap each blocked court for a free one whose space doesn't overlap the others.
  const kept = courts.filter((c) => !c.conflicts.length).map((c) => c.courtId);
  const used = kept.flatMap((id) => unitsOfCourt(s.db.get('courts', id), id));
  const replacement: Id[] = [...kept];
  for (let i = courts.filter((x) => x.conflicts.length).length; i > 0; i--) {
    const alt = candidates.find((k) => !replacement.includes(k.id) && !courtIds.includes(k.id) && !unitsIntersect(unitsOfCourt(k, k.id), used) && !slotConflicts(s, k.id, o.startMs, o.endMs, exclude).length);
    if (!alt) break;
    replacement.push(alt.id);
    used.push(...unitsOfCourt(alt, alt.id));
  }
  const all = courts.flatMap((c) => c.conflicts);
  const unique = [...new Map(all.map((c) => [`${c.kind}:${c.sourceId}`, c])).values()];
  const bookingsOnly = unique.length > 0 && unique.every((c) => c.kind === 'booking' || c.kind === 'hold');
  const fullSwap = replacement.length === courtIds.length && courts.some((c) => c.conflicts.length);
  return {
    sessionId: o.id,
    clear: unique.length === 0,
    courts,
    conflictCount: unique.length,
    bookingCount: unique.filter((c) => c.kind === 'booking').length,
    holdCount: unique.filter((c) => c.kind === 'hold').length,
    blocking: unique.filter((c) => c.kind !== 'booking' && c.kind !== 'hold'),
    canCancelBookings: bookingsOnly && acc.perms.has('bookings.cancel'),
    suggestion: fullSwap ? { courtIds: replacement, names: replacement.map((id) => s.db.get('courts', id)?.name ?? 'Court') } : null,
  };
}

function setSessionCourts(s: Svc, o: OpenPlaySession, courtIds: Id[]): void {
  const ids = [...new Set(courtIds)];
  if (!ids.length) invalid([{ field: 'courtIds', message: 'Assign at least one court.' }]);
  const sport = s.db.get('sports', o.sport);
  const format = sport ? findFormat(sport, o.formatCode) : undefined;
  const units: string[] = [];
  for (const id of ids) {
    const c = s.db.get('courts', id);
    if (!c || c.venueId !== o.venueId || c.status !== 'active') fail('NOT_FOUND', 'One of the courts is not available at this venue.');
    if ((c.sport ?? 'pickleball') !== o.sport) fail('SPORT_NOT_SUPPORTED', `${c.name} is set up for ${c.sport ?? 'pickleball'}, not ${sport?.name ?? o.sport}.`);
    if (format?.layout === 'half' && c.layout !== 'half') fail('FORMAT_INCOMPATIBLE', `${format.label} is played on half courts.`);
    const u = unitsOfCourt(c, c.id);
    if (unitsIntersect(u, units)) fail('CONFLICT', `${c.name} shares space with another court you picked.`);
    units.push(...u);
  }
  s.db.update('openPlaySessions', o.id, (x) => {
    x.courtIds = ids;
    x.updatedAt = s.now;
  });
}

export function publishOpenPlay(s: Svc, input: { businessId: Id; sessionId: Id; courtIds?: Id[]; resolution?: 'fail' | 'cancel_and_refund' }) {
  let o = ownSession(s, input.businessId, input.sessionId);
  const acc = requireBusiness(s, input.businessId, 'openplay.manage', { venueId: o.venueId, write: true });
  if (o.status !== 'draft') fail('INVALID_STATE_TRANSITION', 'Only draft sessions can be published.');
  if (o.endMs <= s.now) fail('CONFLICT', 'This session is already over. Duplicate it to a new date instead.');
  if (input.courtIds?.length) {
    setSessionCourts(s, o, input.courtIds);
    o = s.db.must('openPlaySessions', o.id);
  }
  const check = openPlayCourtCheck(s, { businessId: input.businessId, sessionId: o.id });
  if (!check.clear) {
    const list = check.courts.filter((c) => c.conflicts.length).map((c) => `${c.name}: ${c.conflicts.map((x) => `${x.label} ${x.when}${x.changeover ? ' (changeover)' : ''}`).join(', ')}`).join('; ');
    if (input.resolution !== 'cancel_and_refund') throw new AppError('COURT_CONFLICT', `These courts aren't free for the whole session — ${list}. Pick other courts, move the session, or cancel the affected bookings.`, { meta: { check } });
    if (check.blocking.length) throw new AppError('COURT_CONFLICT', `Blocks, events and other Open Play sessions can't be cancelled from here — ${check.blocking.map((x) => `${x.label} on ${x.court}`).join(', ')}. Pick other courts or move the session.`, { meta: { check } });
    if (!acc.perms.has('bookings.cancel')) fail('FORBIDDEN', 'Cancelling the affected bookings needs the “Cancel bookings” permission. Ask a manager, or pick other courts.');
    const seen = new Set<string>();
    for (const c of check.courts.flatMap((x) => x.conflicts)) {
      if (seen.has(c.sourceId)) continue;
      seen.add(c.sourceId);
      const b = s.db.must('bookings', c.sourceId);
      if (c.kind === 'hold') {
        cancelCheckout(s, b.checkoutId, 'Court reserved for Open Play', acc.user.id);
        notify(s, b.userId, 'booking_updates', { title: 'Your checkout was cancelled', body: `The court you were checking out was just reserved for ${o.title}. If you already paid, you'll get a full refund automatically.`, link: '#/app/bookings' });
      } else if (b.status === 'confirmed') venueCancelBooking(s, { businessId: input.businessId, bookingId: b.id, reason: 'court_unavailable', note: `Reserved for Open Play: ${o.title}` });
      else releaseSlot(s, b.slotId, 'Court reserved for Open Play');
    }
  }
  const slotIds: Id[] = [];
  for (const courtId of o.courtIds) {
    const slot = insertSlot(s, { businessId: o.businessId, venueId: o.venueId, courtId, startMs: o.startMs, endMs: o.endMs, bufferMinutes: 0, kind: 'open_play', sourceId: o.id, expiresAt: null });
    slotIds.push(slot.id);
  }
  s.db.update('openPlaySessions', o.id, (x) => {
    x.slotIds = slotIds;
    x.publishedAt = s.now;
    transition(OP_SESSION_TRANSITIONS, x, 'published', s.now, s.actor.realUser?.id ?? 'system', 'Published', 'session');
  });
  audit(s, { action: 'openplay.published', targetType: 'open_play_session', targetId: o.id, businessId: o.businessId, summary: `Published ${o.title}; reserved ${slotIds.length} court${slotIds.length === 1 ? '' : 's'}${check.clear ? '' : `; cancelled ${check.bookingCount + check.holdCount} conflicting booking(s) with full refunds`}` });
  return s.db.must('openPlaySessions', o.id);
}

export function duplicateOpenPlay(s: Svc, input: { businessId: Id; sessionId: Id; days?: number }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  const acc = requireBusiness(s, input.businessId, 'openplay.manage', { venueId: o.venueId, write: true });
  const shift = (input.days ?? 7) * 24 * HOUR;
  const copy: OpenPlaySession = { ...structuredClone(o), id: newId('ops'), startMs: o.startMs + shift, endMs: o.endMs + shift, registrationOpensAt: Math.max(s.now, o.registrationOpensAt + shift), registrationClosesAt: o.registrationClosesAt + shift, checkInOpensAt: o.checkInOpensAt + shift, lateCutoffAt: o.lateCutoffAt + shift, status: 'draft', history: [], slotIds: [], cancelReason: null, createdAt: s.now, createdBy: acc.user.id, publishedAt: null, updatedAt: s.now };
  s.db.insert('openPlaySessions', copy);
  audit(s, { action: 'openplay.created', targetType: 'open_play_session', targetId: copy.id, businessId: copy.businessId, summary: `Duplicated ${o.title} (+${input.days ?? 7} days) as a draft` });
  return copy;
}

export function cancelOpenPlay(s: Svc, input: { businessId: Id; sessionId: Id; reason: string }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  requireBusiness(s, input.businessId, 'openplay.manage', { venueId: o.venueId, write: true });
  if (!['draft', 'published', 'in_progress'].includes(o.status)) fail('INVALID_STATE_TRANSITION', 'This session cannot be cancelled.');
  const reason = (input.reason ?? '').trim();
  if (reason.length < 5) invalid([{ field: 'reason', message: 'Tell participants why the session is cancelled.' }]);
  let refunded = 0;
  for (const reg of s.db.filter('opRegistrations', (r) => r.sessionId === o.id && ['confirmed', 'held', 'pending_payment', 'waitlisted', 'offered'].includes(r.status))) {
    const amount = cancelRegistrationInternal(s, reg, { initiator: 'venue', reason: `Session cancelled: ${reason}`, fullRefund: true, by: 'venue' });
    refunded += amount;
    notify(s, reg.userId, 'events', { title: `Session cancelled · ${o.title}`, body: `${reason}${amount ? ` You'll receive a full refund of ${formatPHP(amount)}, including fees.` : ''}`, link: '#/app/open-play' });
  }
  for (const i of s.db.filter('opInvites', (x) => x.sessionId === o.id && x.status === 'pending')) s.db.update('opInvites', i.id, (x) => {
    x.status = 'cancelled';
  });
  for (const g of s.db.filter('opGames', (x) => x.sessionId === o.id && x.status === 'in_progress')) s.db.update('opGames', g.id, (x) => {
    x.status = 'abandoned';
    x.endedAt = s.now;
  });
  for (const slotId of o.slotIds) releaseSlot(s, slotId, 'Open Play cancelled');
  s.db.update('openPlaySessions', o.id, (x) => {
    x.cancelReason = reason;
    transition(OP_SESSION_TRANSITIONS, x, 'cancelled', s.now, s.actor.realUser?.id ?? 'venue', reason, 'session');
  });
  audit(s, { action: 'openplay.cancelled', targetType: 'open_play_session', targetId: o.id, businessId: o.businessId, summary: `Cancelled ${o.title}; refunds ${formatPHP(refunded)}`, reason });
  return { refunded };
}

// ---------------------------------------------------------------- live desk (staff)

function queueKey(o: OpenPlaySession, r: OpenPlayRegistration): number {
  return o.rotation === 'first_checked_in' ? r.checkedInAt ?? r.queueSince ?? 0 : r.queueSince ?? r.checkedInAt ?? 0;
}

const SKILL_RANK: Record<string, number> = { beginner: 1, novice: 2, intermediate: 3, advanced: 4, expert: 5 };

export function openPlayDesk(s: Svc, input: { businessId: Id; sessionId: Id }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  const acc = requireBusiness(s, input.businessId, 'openplay.view', { venueId: o.venueId });
  const seeRestrictions = acc.perms.has('restrictions.view');
  const sport = s.db.get('sports', o.sport);
  const format = sport ? findFormat(sport, o.formatCode) : undefined;
  const regs = s.db.filter('opRegistrations', (r) => r.sessionId === o.id);
  const confirmed = regs.filter((r) => r.status === 'confirmed');
  const events = s.db.filter('attendanceEvents', (e) => e.sessionId === o.id).sort((a, b) => b.at - a.at || b.seq - a.seq);
  const games = s.db.filter('opGames', (g) => g.sessionId === o.id);
  const waiting = confirmed.filter((r) => r.attendance === 'waiting').sort((a, b) => queueKey(o, a) - queueKey(o, b));
  const windowOpen = s.now >= o.checkInOpensAt && s.now < o.lateCutoffAt;
  const counts = {
    capacity: o.capacity,
    registered: confirmed.length,
    waitlisted: regs.filter((r) => r.status === 'waitlisted' || r.status === 'offered').length,
    eligible: windowOpen ? confirmed.filter((r) => r.attendance === 'not_arrived').length : 0,
    checkedIn: confirmed.filter((r) => PRESENT.includes(r.attendance)).length,
    waiting: waiting.length,
    onCourt: confirmed.filter((r) => r.attendance === 'on_court').length,
    tempOff: confirmed.filter((r) => r.attendance === 'temp_off').length,
    checkedOut: confirmed.filter((r) => r.attendance === 'checked_out').length,
    completed: confirmed.filter((r) => r.attendance === 'completed').length,
    cancelled: regs.filter((r) => r.status === 'cancelled' || r.status === 'refunded').length,
    noShow: confirmed.filter((r) => r.attendance === 'no_show').length,
    rejected: events.filter((e) => e.type === 'check_in_rejected').length,
    adjusted: confirmed.filter((r) => r.manuallyAdjusted).length,
    remaining: remaining(s.db, o, s.now),
  };
  const nameOf = (id: Id) => displayName(s.db, regs.find((r) => r.id === id)?.userId);
  const players = confirmed
    .map((r) => {
      const party = r.partyId ? s.db.get('opParties', r.partyId) : undefined;
      return {
        registrationId: r.id,
        name: displayName(s.db, r.userId),
        username: profileOf(s.db, r.userId)?.username ?? null,
        skill: r.skill,
        skillLabel: skillLabel(sport, r.skill),
        party: party ? { name: party.name, kind: party.kind, status: party.status } : null,
        role: r.role,
        attendance: r.attendance,
        court: courtLabel(s.db, r.courtId),
        courtId: r.courtId,
        queuePosition: r.attendance === 'waiting' ? waiting.findIndex((w) => w.id === r.id) + 1 : null,
        gamesPlayed: r.gamesPlayed,
        checkedInAt: r.checkedInAt,
        method: r.checkInMethod,
        needsPartner: r.needsPartner,
        walkIn: r.walkIn,
        manuallyAdjusted: r.manuallyAdjusted,
        // Restriction status only for staff allowed to see it (restrictions.view); never shown to players.
        restricted: seeRestrictions && !!activeRestriction(s.db, r.userId, o.businessId, o.venueId, s.now),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const courts = o.courtIds.map((courtId) => {
    const live = games.find((g) => g.courtId === courtId && g.status === 'in_progress');
    const last = games.filter((g) => g.courtId === courtId && g.status === 'completed').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
    const assigned = confirmed.filter((r) => r.attendance === 'on_court' && r.courtId === courtId);
    return {
      courtId,
      name: courtLabel(s.db, courtId) ?? 'Court',
      game: live ? { id: live.id, startedAt: live.startedAt, sideA: live.sideA.map((id) => ({ id, name: nameOf(id) })), sideB: live.sideB.map((id) => ({ id, name: nameOf(id) })), overtime: s.now - live.startedAt > o.gameMinutes * MINUTE } : null,
      assigned: assigned.map((r) => ({ id: r.id, name: displayName(s.db, r.userId), inGame: !!live && [...live.sideA, ...live.sideB].includes(r.id) })),
      lastGame: last ? { score: last.score, winner: last.winner, endedAt: last.endedAt } : null,
    };
  });
  const exceptions = [
    ...players.filter((p) => p.needsPartner).map((p) => ({ kind: 'needs_partner', text: `${p.name} needs a partner`, registrationId: p.registrationId })),
    ...players.filter((p) => p.restricted).map((p) => ({ kind: 'restricted', text: `${p.name} has an active restriction at this venue`, registrationId: p.registrationId })),
    ...events.filter((e) => e.type === 'check_in_rejected').slice(0, 5).map((e) => ({ kind: 'rejected', text: `Rejected scan (${(e.rejectCode ?? '').replace(/_/g, ' ')}) at ${formatTime(e.at)}${e.registrationId ? ` — ${nameOf(e.registrationId)}` : ''}`, registrationId: e.registrationId })),
    ...courts.filter((c) => c.game?.overtime).map((c) => ({ kind: 'overtime', text: `${c.name}: game running past ${o.gameMinutes} min`, registrationId: null })),
    ...(s.now > o.startMs && counts.registered < o.minParticipants ? [{ kind: 'low_turnout', text: `Below the minimum of ${o.minParticipants} participants`, registrationId: null }] : []),
  ];
  return {
    ...sessionSummary(s, o, { internal: true }),
    perms: { checkIn: acc.perms.has('openplay.check_in'), run: acc.perms.has('openplay.run'), correct: acc.perms.has('openplay.attendance.correct'), manage: acc.perms.has('openplay.manage') },
    format: format ?? null,
    playersPerGame: format ? playersPerGame(format) : 4,
    rotationLabel: ROTATION_LABEL[o.rotation],
    counts,
    players,
    queue: waiting.map((r, i) => ({ registrationId: r.id, name: displayName(s.db, r.userId), skillLabel: skillLabel(sport, r.skill), position: i + 1, since: queueKey(o, r), gamesPlayed: r.gamesPlayed })),
    board: courts,
    exceptions,
    events: events.slice(0, 40).map((e) => ({ ...e, player: e.registrationId ? nameOf(e.registrationId) : null, court: courtLabel(s.db, e.courtId ?? null) })),
    checkInWindow: { opensAt: o.checkInOpensAt, lateCutoffAt: o.lateCutoffAt, open: windowOpen },
    lastUpdatedAt: s.now,
  };
}

/** Controlled search: only this session's registrants, min 2 characters, display names only. */
export function openPlaySearch(s: Svc, input: { businessId: Id; sessionId: Id; q: string }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  requireBusiness(s, input.businessId, 'openplay.check_in', { venueId: o.venueId });
  const q = (input.q ?? '').trim().toLowerCase().replace(/^@/, '');
  if (q.length < 2) return [];
  return s.db
    .filter('opRegistrations', (r) => r.sessionId === o.id && r.status === 'confirmed')
    .filter((r) => {
      const p = profileOf(s.db, r.userId);
      return !!p && (p.displayName.toLowerCase().includes(q) || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) || (p.username ?? '').toLowerCase().startsWith(q));
    })
    .slice(0, 8)
    .map((r) => ({ registrationId: r.id, name: displayName(s.db, r.userId), username: profileOf(s.db, r.userId)?.username ?? null, attendance: r.attendance }));
}

function reject(s: Svc, o: OpenPlaySession, code: string, message: string, errCode: Parameters<typeof fail>[0], regId: Id | null, method: OpenPlayRegistration['checkInMethod']): never {
  const actor = s.actor.realUser?.id ?? null;
  const label = actorLabel(s);
  // Rejected scans are recorded even though the request fails (written after the rollback).
  s.after.push((s2) => {
    s2.db.insert('attendanceEvents', { id: newId('att'), seq: s2.db.count('attendanceEvents', (x) => x.sessionId === o.id) + 1, sessionId: o.id, businessId: o.businessId, registrationId: regId, type: 'check_in_rejected', method, rejectCode: code, actorUserId: actor, actorLabel: label, at: s2.now });
  });
  fail(errCode, message);
}

/**
 * Check-in (doc 24 §5). Methods: `qr` (rotating OP1 pass), `registration_qr` (REG1), `search` (controlled
 * search result) and `manual` (fallback, reason required). Duplicate, expired, tampered, wrong-session and
 * out-of-window scans are rejected and recorded.
 */
export function openPlayCheckIn(s: Svc, input: { businessId: Id; sessionId: Id; token?: string; registrationId?: Id; method?: 'search' | 'manual'; reason?: string }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  const acc = requireBusiness(s, input.businessId, 'openplay.check_in', { venueId: o.venueId, write: true });
  let reg: OpenPlayRegistration | undefined;
  let method: OpenPlayRegistration['checkInMethod'];
  if (input.token) {
    const parsed = parseCheckinToken(input.token);
    method = parsed?.kind === 'REG1' ? 'registration_qr' : 'qr';
    if (!parsed) reject(s, o, 'malformed', "That code isn't a CourtKo Open Play pass.", 'CHECKIN_TOKEN_INVALID', null, method);
    const hash = checkinRefHash(parsed.ref);
    reg = s.db.find('opRegistrations', (r) => r.checkinRefHash === hash);
    if (!reg || reg.businessId !== o.businessId) reject(s, o, 'unknown_pass', "That pass doesn't match any registration here.", 'CHECKIN_TOKEN_INVALID', null, method);
    if (!verifyCheckinSignature(parsed, reg.sessionId)) {
      s.deferred.push({ at: s.now, type: 'checkin_token_invalid', severity: 'warning', userId: acc.user.id, businessId: o.businessId, detail: 'Open Play pass with an invalid signature was scanned (possible tampering)', ip: s.req.ip });
      reject(s, o, 'bad_signature', "That pass failed the security check. Ask the player to refresh their pass.", 'CHECKIN_TOKEN_INVALID', reg.sessionId === o.id ? reg.id : null, method);
    }
    if (reg.sessionId !== o.id) reject(s, o, 'wrong_session', `That pass is for a different session (${s.db.get('openPlaySessions', reg.sessionId)?.title ?? 'another session'}).`, 'CHECKIN_WRONG_SESSION', null, method);
    if (parsed.exp <= s.now) reject(s, o, 'expired', 'That pass has expired. Ask the player to open their pass again — it refreshes automatically.', 'CHECKIN_TOKEN_EXPIRED', reg.id, method);
  } else {
    method = input.method === 'manual' ? 'manual' : 'search';
    reg = input.registrationId ? s.db.get('opRegistrations', input.registrationId) : undefined;
    if (!reg || reg.sessionId !== o.id) fail('NOT_FOUND', 'Registration not found for this session.');
    if (method === 'manual' && (input.reason ?? '').trim().length < 5) invalid([{ field: 'reason', message: 'Manual check-in needs a reason (e.g. "Phone battery dead — ID checked").' }]);
  }
  if (reg.status !== 'confirmed') reject(s, o, `registration_${reg.status}`, `This registration is ${reg.status.replace(/_/g, ' ')}.`, 'CONFLICT', reg.id, method);
  if (reg.attendance !== 'not_arrived') reject(s, o, 'duplicate', `${displayName(s.db, reg.userId)} is already checked in (${reg.attendance.replace(/_/g, ' ')}).`, 'ALREADY_CHECKED_IN', reg.id, method);
  if (o.status === 'cancelled' || o.status === 'completed' || o.status === 'draft') reject(s, o, 'session_closed', 'This session is not running.', 'CHECKIN_WINDOW_CLOSED', reg.id, method);
  if (s.now < o.checkInOpensAt) reject(s, o, 'too_early', `Check-in opens at ${formatTime(o.checkInOpensAt)}.`, 'CHECKIN_WINDOW_CLOSED', reg.id, method);
  if (s.now >= o.lateCutoffAt && method !== 'manual') reject(s, o, 'after_cutoff', `The late-arrival cutoff (${formatTime(o.lateCutoffAt)}) has passed. Use manual check-in with a reason if the venue allows it.`, 'CHECKIN_WINDOW_CLOSED', reg.id, method);
  const to: AttendanceStatus = o.autoQueueOnCheckIn ? 'waiting' : 'checked_in';
  setAttendance(s, reg, to, { type: 'check_in', method, ...(input.reason ? { reason: input.reason.trim().slice(0, 200) } : {}) }, { checkedInAt: s.now, checkedInBy: acc.user.id, checkInMethod: method, ...(method === 'manual' ? { manuallyAdjusted: true } : {}) });
  if (o.status === 'published' && s.now >= o.startMs) s.db.update('openPlaySessions', o.id, (x) => transition(OP_SESSION_TRANSITIONS, x, 'in_progress', s.now, 'system', 'Session started', 'session'));
  const fresh = s.db.must('opRegistrations', reg.id);
  const party = fresh.partyId ? s.db.get('opParties', fresh.partyId) : undefined;
  return { registrationId: fresh.id, name: displayName(s.db, fresh.userId), skill: fresh.skill, attendance: fresh.attendance, party: party?.name ?? null, needsPartner: fresh.needsPartner, method };
}

export function openPlayWalkIn(s: Svc, input: { businessId: Id; sessionId: Id; customerUserId?: Id; customerName?: string; customerPhone?: string; paymentMethod?: PaymentMethodCode }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  const acc = requireBusiness(s, input.businessId, 'openplay.check_in', { venueId: o.venueId, write: true });
  if (!o.walkInsAllowed) fail('CONFLICT', 'Walk-ins are turned off for this session.');
  if (o.status !== 'published' && o.status !== 'in_progress') fail('CONFLICT', 'This session is not taking walk-ins.');
  if (remaining(s.db, o, s.now) < 1) fail('SESSION_FULL', 'The session is full.');
  let userId = input.customerUserId ?? null;
  if (userId) {
    if (!s.db.get('users', userId)) fail('NOT_FOUND', 'Player not found.');
  } else {
    const name = (input.customerName ?? '').trim();
    const phone = normalizePhMobile(input.customerPhone ?? '');
    const errors: FieldError[] = [];
    if (!name) errors.push({ field: 'customerName', message: 'Enter the player’s name.' });
    if (!phone) errors.push({ field: 'customerPhone', message: 'Enter a valid PH mobile number for the receipt.' });
    if (errors.length) invalid(errors);
    const existing = s.db.find('users', (u) => u.phone === phone && u.status !== 'deleted');
    if (existing) userId = existing.id;
    else {
      userId = newId('usr');
      const [first, ...rest] = name.split(/\s+/);
      s.db.insert('users', { id: userId, email: null, phone, passwordHash: null, status: 'active', emailVerifiedAt: null, phoneVerifiedAt: null, mfa: null, platformRole: null, createdAt: s.now, lastLoginAt: null, lockedUntil: null, invited: true, deletion: null });
      s.db.insert('profiles', { id: userId, userId, firstName: first ?? name, lastName: rest.join(' '), displayName: name, city: '', skillSelf: null, bio: '', avatarHue: 140, visibility: { profile: 'private', activity: 'private', ratings: 'private' }, username: null, social: { ...DEFAULT_SOCIAL, discoverable: false, allowFollows: false } });
      s.db.insert('preferences', defaultPreferences(userId));
    }
  }
  assertNotRestricted(s, userId!, o.businessId, o.venueId);
  if (s.db.find('opRegistrations', (r) => r.sessionId === o.id && r.userId === userId && liveReg(r, s.now))) fail('CONFLICT', 'That player is already registered.');
  const amount = amountFor(o, 'individual');
  const reg = newRegistration(s, o, userId!, { role: 'individual', mode: 'individual', status: amount ? 'held' : 'confirmed', walkIn: true, createdBy: acc.user.id });
  audit(s, { action: 'openplay.walk_in', targetType: 'open_play_session', targetId: o.id, businessId: o.businessId, summary: `Walk-in ${displayName(s.db, userId)} added to ${o.title}${amount ? ' — payment link sent' : ''}` });
  if (!amount) {
    onConfirmed(s, reg);
    return { registrationId: reg.id, paymentUrl: null, amount: 0, expiresAt: null };
  }
  const c = createRegistrationCheckout(s, o, reg, amount, { source: 'walk_in', createdBy: acc.user.id });
  s.db.update('checkouts', c.checkoutId, (x) => {
    x.policyAcceptedAt = s.now;
  });
  const pay = startPayment(s, c.checkoutId, input.paymentMethod ?? 'qrph');
  return { registrationId: reg.id, paymentUrl: pay.redirectUrl, amount: pay.payment.amount, expiresAt: pay.expiresAt };
}

function deskReg(s: Svc, o: OpenPlaySession, regId: Id): OpenPlayRegistration {
  const r = s.db.get('opRegistrations', regId);
  if (!r || r.sessionId !== o.id || r.status !== 'confirmed') fail('NOT_FOUND', 'Player not found in this session.');
  return r;
}

function liveGameOn(s: Svc, o: OpenPlaySession, courtId: Id): OpenPlayGame | undefined {
  return s.db.find('opGames', (g) => g.sessionId === o.id && g.courtId === courtId && g.status === 'in_progress');
}

function removeFromGame(s: Svc, o: OpenPlaySession, regId: Id): void {
  for (const g of s.db.filter('opGames', (x) => x.sessionId === o.id && x.status === 'in_progress' && (x.sideA.includes(regId) || x.sideB.includes(regId)))) {
    s.db.update('opGames', g.id, (x) => {
      x.sideA = x.sideA.filter((id) => id !== regId);
      x.sideB = x.sideB.filter((id) => id !== regId);
    });
  }
}

/** Staff-controlled moves: queue, assign/move to a court, temporarily off, check out. */
export function openPlayAttendance(s: Svc, input: { businessId: Id; sessionId: Id; registrationIds: Id[]; action: 'to_waiting' | 'assign' | 'temp_off' | 'check_out'; courtId?: Id }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  requireBusiness(s, input.businessId, 'openplay.run', { venueId: o.venueId, write: true });
  if (!input.registrationIds.length) invalid([{ field: 'registrationIds', message: 'Select at least one player.' }]);
  if (input.action === 'assign' && (!input.courtId || !o.courtIds.includes(input.courtId))) invalid([{ field: 'courtId', message: 'Choose one of this session’s courts.' }]);
  const sport = s.db.get('sports', o.sport);
  const format = sport ? findFormat(sport, o.formatCode) : undefined;
  if (input.action === 'assign' && format) {
    const already = s.db.count('opRegistrations', (r) => r.sessionId === o.id && r.attendance === 'on_court' && r.courtId === input.courtId && !input.registrationIds.includes(r.id));
    if (already + input.registrationIds.length > playersPerGame(format) * 2) fail('CONFLICT', `${courtLabel(s.db, input.courtId!)} can't take that many players for ${format.label}.`);
  }
  for (const id of input.registrationIds) {
    const r = deskReg(s, o, id);
    if (!PRESENT.includes(r.attendance)) fail('NOT_CHECKED_IN', `${displayName(s.db, r.userId)} isn't checked in.`);
    if (input.action === 'assign') {
      if (r.attendance === 'on_court' && r.courtId === input.courtId) continue;
      if (r.attendance === 'on_court') removeFromGame(s, o, r.id);
      setAttendance(s, r, 'on_court', { type: r.attendance === 'on_court' ? 'move_court' : 'assign_court', courtId: input.courtId! }, { courtId: input.courtId! });
    } else {
      if (r.attendance === 'on_court') removeFromGame(s, o, r.id);
      const to: AttendanceStatus = input.action === 'to_waiting' ? 'waiting' : input.action === 'temp_off' ? 'temp_off' : 'checked_out';
      if (r.attendance === to) continue;
      setAttendance(s, r, to, { type: input.action === 'to_waiting' ? 'to_waiting' : input.action === 'temp_off' ? 'temp_off' : 'check_out' });
    }
  }
  return { ok: true };
}

/** Rotation suggestion — deterministic per strategy; staff always confirm (doc 24 CR-D09). */
export function rotationSuggestion(s: Svc, input: { businessId: Id; sessionId: Id; courtId: Id }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  requireBusiness(s, input.businessId, 'openplay.view', { venueId: o.venueId });
  const sport = sportOf(s.db, o.sport);
  const format = findFormat(sport, o.formatCode);
  const need = format ? playersPerGame(format) : 4;
  const confirmed = s.db.filter('opRegistrations', (r) => r.sessionId === o.id && r.status === 'confirmed');
  const onThisCourt = confirmed.filter((r) => r.attendance === 'on_court' && r.courtId === input.courtId);
  let pool = confirmed.filter((r) => r.attendance === 'waiting').sort((a, b) => queueKey(o, a) - queueKey(o, b));
  const keep: OpenPlayRegistration[] = [];
  let note = ROTATION_LABEL[o.rotation];
  if (o.rotation === 'manual') return { registrationIds: [] as Id[], sideA: [] as Id[], sideB: [] as Id[], need, note: 'Manual assignment — pick players from the queue.', short: 0, names: {} as Record<Id, string> };
  if (o.rotation === 'winner_stays') {
    const last = s.db.filter('opGames', (g) => g.sessionId === o.id && g.courtId === input.courtId && g.status === 'completed').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
    if (last?.winner) {
      const winners = (last.winner === 'a' ? last.sideA : last.sideB).map((id) => confirmed.find((r) => r.id === id)).filter((r): r is OpenPlayRegistration => !!r && PRESENT.includes(r.attendance));
      keep.push(...winners);
      note = `Winners stay (${winners.length}) + next challengers`;
    }
  }
  keep.push(...onThisCourt.filter((r) => !keep.includes(r)));
  pool = pool.filter((r) => !keep.includes(r));
  if (o.rotation === 'random') {
    let seed = Math.floor(s.now / 60_000);
    pool = [...pool].sort(() => ((seed = (seed * 9301 + 49297) % 233280) / 233280) - 0.5);
  } else if (o.rotation === 'skill_based' && pool.length) {
    const anchor = SKILL_RANK[pool[0]!.skill ?? ''] ?? 3;
    pool = [...pool].sort((a, b) => Math.abs((SKILL_RANK[a.skill ?? ''] ?? 3) - anchor) - Math.abs((SKILL_RANK[b.skill ?? ''] ?? 3) - anchor) || queueKey(o, a) - queueKey(o, b));
    note = 'Skill-based grouping (closest levels to the first player waiting)';
  }
  const chosen = [...keep, ...pool].slice(0, need);
  // Balance sides by skill (snake draft).
  const bySkill = [...chosen].sort((a, b) => (SKILL_RANK[b.skill ?? ''] ?? 3) - (SKILL_RANK[a.skill ?? ''] ?? 3));
  const sideA: Id[] = [];
  const sideB: Id[] = [];
  bySkill.forEach((r, i) => ((i % 4 === 0 || i % 4 === 3) ? sideA : sideB).push(r.id));
  return { registrationIds: chosen.map((r) => r.id), sideA, sideB, need, note, short: Math.max(0, need - chosen.length), names: Object.fromEntries(chosen.map((r) => [r.id, displayName(s.db, r.userId)])) };
}

export function startOpenPlayGame(s: Svc, input: { businessId: Id; sessionId: Id; courtId: Id; sideA: Id[]; sideB: Id[] }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  const acc = requireBusiness(s, input.businessId, 'openplay.run', { venueId: o.venueId, write: true });
  if (!o.courtIds.includes(input.courtId)) invalid([{ field: 'courtId', message: 'Choose one of this session’s courts.' }]);
  if (liveGameOn(s, o, input.courtId)) fail('CONFLICT', `A ${s.db.get('sports', o.sport)?.gameNoun ?? 'game'} is already running on ${courtLabel(s.db, input.courtId)}.`);
  const ids = [...input.sideA, ...input.sideB];
  if (new Set(ids).size !== ids.length) invalid([{ field: 'sideA', message: 'A player can only be on one side.' }]);
  if (!input.sideA.length || !input.sideB.length) invalid([{ field: 'sideA', message: 'Both sides need at least one player.' }]);
  for (const id of ids) {
    const r = deskReg(s, o, id);
    if (!PRESENT.includes(r.attendance)) fail('NOT_CHECKED_IN', `${displayName(s.db, r.userId)} isn't checked in.`);
    if (r.attendance === 'on_court' && r.courtId !== input.courtId && s.db.find('opGames', (g) => g.sessionId === o.id && g.status === 'in_progress' && [...g.sideA, ...g.sideB].includes(r.id))) fail('CONFLICT', `${displayName(s.db, r.userId)} is playing on another court.`);
  }
  const game: OpenPlayGame = { id: newId('opg'), sessionId: o.id, businessId: o.businessId, courtId: input.courtId, sideA: input.sideA, sideB: input.sideB, status: 'in_progress', startedAt: s.now, endedAt: null, score: null, winner: null, startedBy: acc.user.id, recordedBy: null };
  s.db.insert('opGames', game);
  for (const id of ids) {
    const r = s.db.must('opRegistrations', id);
    if (r.attendance === 'on_court' && r.courtId === input.courtId) logAttendance(s, { sessionId: o.id, businessId: o.businessId, registrationId: r.id, type: 'start_game', courtId: input.courtId, gameId: game.id, from: 'on_court', to: 'on_court' });
    else setAttendance(s, r, 'on_court', { type: 'start_game', courtId: input.courtId, gameId: game.id }, { courtId: input.courtId });
  }
  if (o.status === 'published' && s.now >= o.startMs) s.db.update('openPlaySessions', o.id, (x) => transition(OP_SESSION_TRANSITIONS, x, 'in_progress', s.now, 'system', 'Session started', 'session'));
  return game;
}

export function endOpenPlayGame(s: Svc, input: { businessId: Id; sessionId: Id; gameId: Id; scoreA?: number | null; scoreB?: number | null; winner?: 'a' | 'b' | null }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  const acc = requireBusiness(s, input.businessId, 'openplay.run', { venueId: o.venueId, write: true });
  const g = s.db.get('opGames', input.gameId);
  if (!g || g.sessionId !== o.id) fail('NOT_FOUND', 'Game not found.');
  if (g.status !== 'in_progress') fail('INVALID_STATE_TRANSITION', 'This game already ended.');
  const hasScore = input.scoreA !== undefined && input.scoreA !== null && input.scoreB !== undefined && input.scoreB !== null;
  if (hasScore && !o.scoreRecording) fail('SCORE_RECORDING_DISABLED', 'Score recording is turned off for this session.');
  if (hasScore && !(Number.isInteger(input.scoreA) && Number.isInteger(input.scoreB) && input.scoreA! >= 0 && input.scoreB! >= 0 && input.scoreA !== input.scoreB && input.scoreA! <= 99 && input.scoreB! <= 99)) invalid([{ field: 'scoreA', message: 'Enter a final score with a winner.' }]);
  const winner: 'a' | 'b' | null = hasScore ? (input.scoreA! > input.scoreB! ? 'a' : 'b') : input.winner ?? null;
  s.db.update('opGames', g.id, (x) => {
    x.status = 'completed';
    x.endedAt = s.now;
    x.score = hasScore ? { a: input.scoreA!, b: input.scoreB! } : null;
    x.winner = winner;
    x.recordedBy = acc.user.id;
  });
  const stays = o.rotation === 'winner_stays' && winner ? (winner === 'a' ? g.sideA : g.sideB) : [];
  for (const id of [...g.sideA, ...g.sideB]) {
    const r = s.db.get('opRegistrations', id);
    if (!r || r.status !== 'confirmed') continue;
    s.db.update('opRegistrations', r.id, (x) => {
      x.gamesPlayed += 1;
    });
    const fresh = s.db.must('opRegistrations', r.id);
    if (fresh.attendance !== 'on_court') continue;
    if (stays.includes(id)) logAttendance(s, { sessionId: o.id, businessId: o.businessId, registrationId: r.id, type: 'end_game', courtId: g.courtId, gameId: g.id, from: 'on_court', to: 'on_court', reason: 'Winner stays' });
    else setAttendance(s, fresh, 'waiting', { type: 'end_game', courtId: g.courtId, gameId: g.id });
  }
  return s.db.must('opGames', g.id);
}

/** Corrections are new events (never edits) and need a reason (doc 24 ATT). */
export function correctAttendance(s: Svc, input: { businessId: Id; sessionId: Id; registrationId: Id; to: AttendanceStatus; reason: string }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  requireBusiness(s, input.businessId, 'openplay.attendance.correct', { venueId: o.venueId, write: true });
  const reason = (input.reason ?? '').trim();
  if (reason.length < 5) invalid([{ field: 'reason', message: 'Corrections need a reason (at least 5 characters).' }]);
  const r = s.db.get('opRegistrations', input.registrationId);
  if (!r || r.sessionId !== o.id) fail('NOT_FOUND', 'Registration not found.');
  if (r.attendance === input.to) fail('CONFLICT', 'Attendance is already set to that status.');
  if (input.to === 'on_court') fail('CONFLICT', 'Use court assignment to put a player on court.');
  if (r.attendance === 'on_court') removeFromGame(s, o, r.id);
  setAttendance(s, r, input.to, { type: 'correction', reason }, { manuallyAdjusted: true, ...(input.to === 'not_arrived' ? { checkedInAt: null, checkedInBy: null, checkInMethod: null } : {}) });
  audit(s, { action: 'openplay.attendance_corrected', targetType: 'open_play_registration', targetId: r.id, businessId: o.businessId, summary: `Attendance for ${displayName(s.db, r.userId)}: ${r.attendance} → ${input.to}`, reason });
  return s.db.must('opRegistrations', r.id);
}

export function reverseAttendanceEvent(s: Svc, input: { businessId: Id; sessionId: Id; eventId: Id; reason: string }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  requireBusiness(s, input.businessId, 'openplay.attendance.correct', { venueId: o.venueId, write: true });
  const reason = (input.reason ?? '').trim();
  if (reason.length < 5) invalid([{ field: 'reason', message: 'Reversals need a reason (at least 5 characters).' }]);
  const e = s.db.get('attendanceEvents', input.eventId);
  if (!e || e.sessionId !== o.id || !e.registrationId) fail('NOT_FOUND', 'Event not found.');
  if (!['check_in', 'no_show', 'check_out', 'walk_in'].includes(e.type)) fail('CONFLICT', 'Only check-ins, check-outs and no-shows can be reversed.');
  if (s.db.find('attendanceEvents', (x) => x.reversesEventId === e.id)) fail('CONFLICT', 'This event was already reversed.');
  const r = s.db.must('opRegistrations', e.registrationId);
  const latest = s.db.filter('attendanceEvents', (x) => x.registrationId === r.id && x.type !== 'check_in_rejected').sort((a, b) => b.at - a.at || b.seq - a.seq)[0];
  if (latest?.id !== e.id) fail('CONFLICT', 'Only the latest attendance change can be reversed. Use a correction instead.');
  const to = e.from ?? 'not_arrived';
  if (r.attendance === 'on_court') removeFromGame(s, o, r.id);
  setAttendance(s, r, to, { type: 'reversal', reversesEventId: e.id, reason }, { manuallyAdjusted: true, ...(to === 'not_arrived' ? { checkedInAt: null, checkedInBy: null, checkInMethod: null } : {}) });
  audit(s, { action: 'openplay.attendance_reversed', targetType: 'open_play_registration', targetId: r.id, businessId: o.businessId, summary: `Reversed ${e.type.replace(/_/g, ' ')} for ${displayName(s.db, r.userId)}`, reason });
  return s.db.must('opRegistrations', r.id);
}

/** Management assigns a replacement partner/teammate from registered players who are on their own. */
export function assignReplacement(s: Svc, input: { businessId: Id; sessionId: Id; partyId: Id; registrationId: Id }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  requireBusiness(s, input.businessId, 'openplay.manage', { venueId: o.venueId, write: true });
  const p = s.db.get('opParties', input.partyId);
  if (!p || p.sessionId !== o.id || p.status === 'dissolved') fail('NOT_FOUND', 'Group not found.');
  const r = deskReg(s, o, input.registrationId);
  if (r.partyId) fail('CONFLICT', `${displayName(s.db, r.userId)} is already in a group.`);
  if (partyMembers(s.db, p.id, s.now).length >= p.size) fail('CONFLICT', 'That group is already complete.');
  s.db.update('opRegistrations', r.id, (x) => {
    x.partyId = p.id;
    x.role = p.kind === 'pair' ? 'partner' : 'member';
    x.needsPartner = false;
  });
  refreshParty(s, p.id);
  const captain = s.db.find('opRegistrations', (x) => x.partyId === p.id && x.role === 'captain');
  if (captain) notify(s, captain.userId, 'events', { title: `New ${p.kind === 'pair' ? 'partner' : 'teammate'} · ${o.title}`, body: `The venue paired you with ${displayName(s.db, r.userId)}.`, link: `#/app/open-play/registrations/${captain.id}` });
  notify(s, r.userId, 'events', { title: `You've been paired · ${o.title}`, body: `You'll play with ${p.kind === 'pair' ? displayName(s.db, captain?.userId) : `team ${p.name}`}.`, link: `#/app/open-play/registrations/${r.id}` });
  audit(s, { action: 'openplay.replacement_assigned', targetType: 'open_play_party', targetId: p.id, businessId: o.businessId, summary: `Assigned ${displayName(s.db, r.userId)} to ${p.name}` });
  return { ok: true };
}

/** Staff-created pair or team from checked-in individuals (e.g. pickup basketball). */
export function formParty(s: Svc, input: { businessId: Id; sessionId: Id; registrationIds: Id[]; name: string }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  const acc = requireBusiness(s, input.businessId, 'openplay.run', { venueId: o.venueId, write: true });
  const name = (input.name ?? '').trim();
  if (name.length < 2 || name.length > 40) invalid([{ field: 'name', message: 'Name must be 2–40 characters.' }]);
  if (input.registrationIds.length < 2) invalid([{ field: 'registrationIds', message: 'Select at least two players.' }]);
  const regs = input.registrationIds.map((id) => deskReg(s, o, id));
  for (const r of regs) if (r.partyId && s.db.get('opParties', r.partyId)?.status !== 'dissolved') fail('CONFLICT', `${displayName(s.db, r.userId)} is already in a group.`);
  const p: OpenPlayParty = { id: newId('opp'), sessionId: o.id, businessId: o.businessId, kind: regs.length === 2 ? 'pair' : 'team', name, captainUserId: regs[0]!.userId, size: regs.length, status: 'complete', joinable: false, invitees: [], createdAt: s.now, createdBy: acc.user.id };
  s.db.insert('opParties', p);
  regs.forEach((r, i) => s.db.update('opRegistrations', r.id, (x) => {
    x.partyId = p.id;
    x.role = i === 0 ? 'captain' : p.kind === 'pair' ? 'partner' : 'member';
    x.needsPartner = false;
  }));
  return p;
}

export function attendanceLog(s: Svc, input: { businessId: Id; sessionId: Id }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  requireBusiness(s, input.businessId, 'openplay.view', { venueId: o.venueId });
  return s.db
    .filter('attendanceEvents', (e) => e.sessionId === o.id)
    .sort((a, b) => b.at - a.at || b.seq - a.seq)
    .map((e) => ({ ...e, player: e.registrationId ? displayName(s.db, s.db.get('opRegistrations', e.registrationId)?.userId) : null, court: courtLabel(s.db, e.courtId ?? null), reversed: !!s.db.find('attendanceEvents', (x) => x.reversesEventId === e.id) }));
}

export function adminOpenPlay(s: Svc) {
  requirePlatform(s, 'platform.bookings.view');
  return s.db
    .all('openPlaySessions')
    .sort((a, b) => b.startMs - a.startMs)
    .map((o) => ({ ...sessionSummary(s, o), business: s.db.get('businesses', o.businessId)?.tradeName ?? '' }));
}

// ---------------------------------------------------------------- jobs

export function openPlayJobs(s: Svc): number {
  let n = 0;
  for (const inv of s.db.filter('opInvites', (i) => i.status === 'pending' && i.expiresAt <= s.now)) {
    s.db.update('opInvites', inv.id, (x) => {
      x.status = 'expired';
    });
    const o = s.db.must('openPlaySessions', inv.sessionId);
    const p = s.db.get('opParties', inv.partyId);
    if (p) partnerGone(s, o, p, `${displayName(s.db, inv.inviteeId)} didn't respond to your invitation in time`);
    n++;
  }
  for (const r of s.db.filter('opRegistrations', (x) => x.status === 'offered' && (x.offerExpiresAt ?? 0) <= s.now)) {
    s.db.update('opRegistrations', r.id, (x) => {
      x.cancelledAt = s.now;
      transition(OP_REG_TRANSITIONS, x, 'cancelled', s.now, 'system', 'Waitlist offer expired', 'Open Play registration');
    });
    notify(s, r.userId, 'events', { title: 'Waitlist offer expired', body: 'The spot was offered to the next player.', link: '#/app/open-play' });
    n++;
  }
  for (const o of s.db.filter('openPlaySessions', (x) => x.status === 'published' || x.status === 'in_progress')) {
    offerNext(s, o);
    if (o.status === 'published' && s.now >= o.startMs && s.now < o.endMs) {
      s.db.update('openPlaySessions', o.id, (x) => transition(OP_SESSION_TRANSITIONS, x, 'in_progress', s.now, 'system', 'Session started', 'session'));
      n++;
    }
    if (s.now >= o.lateCutoffAt) {
      for (const r of s.db.filter('opRegistrations', (x) => x.sessionId === o.id && x.status === 'confirmed' && x.attendance === 'not_arrived')) {
        setAttendance(s, r, 'no_show', { type: 'no_show', actorLabel: 'System (late-arrival cutoff)' });
        n++;
      }
    }
    if (s.now >= o.endMs) {
      for (const g of s.db.filter('opGames', (x) => x.sessionId === o.id && x.status === 'in_progress')) s.db.update('opGames', g.id, (x) => {
        x.status = 'completed';
        x.endedAt = s.now;
      });
      for (const r of s.db.filter('opRegistrations', (x) => x.sessionId === o.id && x.status === 'confirmed' && PRESENT.includes(x.attendance))) setAttendance(s, r, 'completed', { type: 'completed', actorLabel: 'System (session ended)' });
      s.db.update('openPlaySessions', o.id, (x) => transition(OP_SESSION_TRANSITIONS, x, 'completed', s.now, 'system', 'Session ended', 'session'));
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- DEMO ONLY: sample passes for presenting the desk

/**
 * DEMO helper (not part of the production API): returns a pass code a staff member would normally scan from a
 * player's phone, so presenters can demonstrate valid, expired, wrong-session and tampered scans.
 */
export function demoSamplePass(s: Svc, input: { businessId: Id; sessionId: Id; kind: 'valid' | 'expired' | 'wrong_session' | 'tampered' | 'duplicate' }) {
  const o = ownSession(s, input.businessId, input.sessionId);
  requireBusiness(s, input.businessId, 'openplay.check_in', { venueId: o.venueId });
  const pickFrom = (sessionId: Id, arrived: boolean) => s.db.filter('opRegistrations', (r) => r.sessionId === sessionId && r.status === 'confirmed' && (arrived ? r.attendance !== 'not_arrived' : r.attendance === 'not_arrived')).sort((a, b) => a.createdAt - b.createdAt)[0];
  let reg: OpenPlayRegistration | undefined;
  let sessionId = o.id;
  if (input.kind === 'wrong_session') {
    const other = s.db.filter('openPlaySessions', (x) => x.businessId === o.businessId && x.id !== o.id && (x.status === 'published' || x.status === 'in_progress')).sort((a, b) => a.startMs - b.startMs)[0];
    if (!other) fail('NOT_FOUND', 'No other session to borrow a pass from.');
    sessionId = other.id;
    reg = pickFrom(other.id, false) ?? pickFrom(other.id, true);
  } else reg = pickFrom(o.id, input.kind === 'duplicate');
  if (!reg) fail('NOT_FOUND', input.kind === 'duplicate' ? 'Nobody is checked in yet.' : 'Everyone registered is already checked in.');
  const target = s.db.must('openPlaySessions', sessionId);
  const ref = checkinRef(reg.id, reg.checkinNonce);
  let token = issueLiveToken(ref, sessionId, input.kind === 'expired' ? s.now - 30 * MINUTE : s.now, input.kind === 'expired' ? s.now - 20 * MINUTE : target.lateCutoffAt).token;
  if (input.kind === 'tampered') token = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
  return { token, player: displayName(s.db, reg.userId), kind: input.kind };
}

/**
 * DEMO helper: simulate players arriving at the front desk (2–3 check-ins through the same attendance path as a
 * staff scan) and, when a court is free and enough players are waiting, start the next game. Used by the presenter
 * to show the player-facing live status changing in real time.
 */
export function demoSimulateArrivals(s: Svc, input: { sessionId?: Id }) {
  const juan = s.db.find('users', (u) => u.persona === 'player');
  const o = input.sessionId
    ? s.db.get('openPlaySessions', input.sessionId)
    : s.db
        .filter('openPlaySessions', (x) => (x.status === 'published' || x.status === 'in_progress') && x.endMs > s.now && !!juan && s.db.count('opRegistrations', (r) => r.sessionId === x.id && r.userId === juan.id && r.status === 'confirmed') > 0)
        .sort((a, b) => a.startMs - b.startMs)[0];
  if (!o) fail('NOT_FOUND', 'No upcoming Open Play session to simulate.');
  if (o.status !== 'published' && o.status !== 'in_progress') fail('CONFLICT', 'That session is not running.');
  if (s.now < o.checkInOpensAt) fail('CHECKIN_WINDOW_CLOSED', `Check-in for ${o.title} opens at ${formatTime(o.checkInOpensAt)}. Move the demo clock forward first.`);
  if (s.now >= o.lateCutoffAt) fail('CHECKIN_WINDOW_CLOSED', 'The late-arrival cutoff has passed for this session.');
  const personaIds = new Set(s.db.filter('users', (u) => !!u.persona).map((u) => u.id));
  const due = s.db.filter('opRegistrations', (r) => r.sessionId === o.id && r.status === 'confirmed' && r.attendance === 'not_arrived' && !personaIds.has(r.userId)).sort((a, b) => a.createdAt - b.createdAt);
  const n = Math.min(due.length, 2 + (Math.floor(s.now / 1000) % 2));
  const to: AttendanceStatus = o.autoQueueOnCheckIn ? 'waiting' : 'checked_in';
  for (const r of due.slice(0, n)) setAttendance(s, r, to, { type: 'check_in', method: 'qr', actorLabel: 'Front desk (demo)' }, { checkedInAt: s.now, checkInMethod: 'qr', queueSince: s.now });
  let started: string | null = null;
  if (livePhase(o, s.now) === 'live') {
    if (o.status === 'published') s.db.update('openPlaySessions', o.id, (x) => transition(OP_SESSION_TRANSITIONS, x, 'in_progress', s.now, 'system', 'Session started', 'session'));
    const sport = s.db.get('sports', o.sport);
    const format = sport ? findFormat(sport, o.formatCode) : undefined;
    const per = format ? playersPerGame(format) : 4;
    const free = o.courtIds.find((c) => !liveGameOn(s, o, c));
    const queue = s.db.filter('opRegistrations', (r) => r.sessionId === o.id && r.status === 'confirmed' && r.attendance === 'waiting' && !personaIds.has(r.userId)).sort((a, b) => queueKey(o, a) - queueKey(o, b));
    if (free && queue.length >= per) {
      const group = queue.slice(0, per);
      const g: OpenPlayGame = { id: newId('opg'), sessionId: o.id, businessId: o.businessId, courtId: free, sideA: group.slice(0, per / 2).map((r) => r.id), sideB: group.slice(per / 2).map((r) => r.id), status: 'in_progress', startedAt: s.now, endedAt: null, score: null, winner: null, startedBy: 'system', recordedBy: null };
      s.db.insert('opGames', g);
      for (const r of group) setAttendance(s, r, 'on_court', { type: 'start_game', courtId: free, gameId: g.id, actorLabel: 'Court captain (demo)' }, { courtId: free });
      started = courtLabel(s.db, free);
    }
  }
  return { sessionId: o.id, title: o.title, checkedIn: n, started };
}

/**
 * DEMO helper: start a live Open Play session right now at Dink District BGC (free community session) with a few
 * players already checked in, so the live desk can be shown at any time of day. Uses the same insert and
 * attendance paths as production code (court reservation goes through the no-overlap rule).
 */
export function demoStartLiveOpenPlay(s: Svc) {
  const venue = s.db.find('venues', (v) => v.slug === 'dink-district-bgc');
  if (!venue) fail('NOT_FOUND', 'Demo venue missing.');
  const start = Math.floor(s.now / (15 * MINUTE)) * 15 * MINUTE;
  const end = start + 2 * HOUR;
  const pickle = s.db.filter('courts', (c) => c.venueId === venue.id && c.status === 'active' && (c.sport ?? 'pickleball') === 'pickleball').sort((a, b) => a.sortOrder - b.sortOrder);
  const free = pickle.filter((c) => !s.db.find('slots', (x) => x.status === 'active' && (x.units ?? [x.courtId]).some((u) => (c.units ?? [c.id]).includes(u)) && x.startMs < end && start < x.occupiedEndMs && !(x.kind === 'hold' && x.expiresAt !== null && x.expiresAt <= s.now))).slice(0, 2);
  if (free.length < 1) fail('CONFLICT', 'No free pickleball court at Dink District BGC for the next two hours.');
  const owner = s.db.must('businesses', venue.businessId).ownerUserId;
  const o: OpenPlaySession = {
    id: newId('ops'), businessId: venue.businessId, venueId: venue.id, sport: 'pickleball', title: 'Pop-up Community Open Play', description: 'Free drop-in session started for the demo — check players in, run the rotation and watch the counters update live.',
    courtIds: free.map((c) => c.id), startMs: start, endMs: end, registrationOpensAt: s.now - HOUR, registrationClosesAt: end - 30 * MINUTE, checkInOpensAt: start - 30 * MINUTE, lateCutoffAt: start + 60 * MINUTE,
    minParticipants: 4, capacity: 16, capacityUnit: 'player', formatCode: 'rotation', style: 'recreational', customFormatLabel: '', skillLevels: [], eligibility: 'Open to all registered players.', pricing: 'free', price: 0,
    registrationModes: ['individual'], teamSize: 2, walkInsAllowed: true, waitlistEnabled: true, equipmentIncluded: true, equipmentNote: 'Paddles and balls provided', policyKey: 'flexible', refundNote: '', noShowPolicy: 'Please cancel if you cannot make it.', partnerFallback: 'keep_solo',
    instructions: 'Check in at the front desk with your Open Play pass.', organizer: venue.name, staffMemberIds: [], rotation: 'first_waiting', autoQueueOnCheckIn: true, scoreRecording: true, gameMinutes: 15, visibility: 'public',
    status: 'published', history: [{ from: 'draft', to: 'published', at: s.now, by: owner, reason: 'Published (demo)' }], slotIds: [], cancelReason: null, createdAt: s.now, createdBy: owner, publishedAt: s.now, updatedAt: s.now,
  };
  s.db.insert('openPlaySessions', o);
  for (const c of free) o.slotIds.push(insertSlot(s, { businessId: o.businessId, venueId: o.venueId, courtId: c.id, startMs: o.startMs, endMs: o.endMs, bufferMinutes: 0, kind: 'open_play', sourceId: o.id, expiresAt: null }).id);
  s.db.update('openPlaySessions', o.id, (x) => {
    x.slotIds = o.slotIds;
    transition(OP_SESSION_TRANSITIONS, x, 'in_progress', s.now, 'system', 'Session started', 'session');
  });
  const people = [
    ...s.db.filter('users', (u) => u.persona === 'player' || u.persona === 'player2'),
    ...s.db.filter('users', (u) => !u.persona && !u.platformRole && u.status === 'active' && !!s.db.get('profiles', u.id)?.username).slice(0, 9),
  ];
  people.forEach((u, i) => {
    const reg = newRegistration(s, o, u.id, { role: 'individual', mode: 'individual', status: 'confirmed', createdBy: u.id });
    if (i >= 2 && i < 8) setAttendance(s, reg, 'waiting', { type: 'check_in', method: i % 3 ? 'qr' : 'search', actorLabel: 'Front desk (demo)' }, { checkedInAt: s.now, checkInMethod: i % 3 ? 'qr' : 'search' });
  });
  audit(s, { action: 'openplay.created', targetType: 'open_play_session', targetId: o.id, businessId: o.businessId, summary: 'Demo: started a live pop-up Open Play session' });
  return { sessionId: o.id };
}
