/**
 * SYNTHETIC DEMO DATA — Open Play sessions, attendance, partners/teams and the social graph (doc 24).
 * Split from seed.ts: `planOpenPlay` reserves court time before generated booking history is created, and
 * `seedOpenPlayAndSocial` writes registrations (paid through the same capture/ledger helper as bookings),
 * attendance events, games, follows and per-sport profiles.
 */

import { checkinRef, checkinRefHash } from '../domain/checkin.ts';
import { pesos } from '../domain/money.ts';
import { buildQuote, type FeeSchedule, type Quote } from '../domain/pricing.ts';
import type { RegistrationMode, RotationStrategy } from '../domain/sports.ts';
import { HOUR, MINUTE } from '../domain/time.ts';
import type { AttendanceEvent, AttendanceStatus, Business, Court, DbTables, Id, OpenPlayGame, OpenPlayParty, OpenPlayRegistration, OpenPlaySession, User, Venue } from './model.ts';

export interface SeedCtx {
  t: DbTables;
  id: (prefix: string) => string;
  int: (min: number, max: number) => number;
  pick: <T>(arr: readonly T[]) => T;
  chance: (p: number) => boolean;
  at: (dayOffset: number, hh: number, mm?: number) => number;
  now: number;
  persona: Record<string, User>;
  players: User[];
  venues: { spec: { key: string }; venue: Venue; courts: Court[] }[];
  take: (courtId: Id, s: number, e: number) => void;
  capture: (o: { business: Business; venue: Venue; userId: Id; quote: Quote; method: 'gcash' | 'maya'; at: number; kind: 'open_play_registration'; settle: boolean }) => { checkoutId: Id; payId: Id };
  tax: (b: Business) => { vatRegistered: boolean; pricesIncludeVat: boolean; vatPpm: number };
  commission: (b: Business, at: number) => { ratePpm: number; source: 'agreement' | 'global'; agreementId: string; appliesToProducts: boolean; appliesToEvents: boolean; label: string };
  fee: (m: 'gcash') => FeeSchedule;
}

interface PlanItem {
  key: string;
  venueKey: string;
  courtIds: Id[];
  sport: string;
  title: string;
  description: string;
  startMs: number;
  endMs: number;
  formatCode: string;
  style: OpenPlaySession['style'];
  capacity: number;
  capacityUnit: OpenPlaySession['capacityUnit'];
  pricing: OpenPlaySession['pricing'];
  price: number;
  modes: RegistrationMode[];
  teamSize: number;
  rotation: RotationStrategy;
  skillLevels: string[];
  gameMinutes: number;
  past: boolean;
  live: boolean;
  instructions: string;
  equipment: string;
}

function court(ctx: SeedCtx, venueKey: string, name: string): Id {
  const vv = ctx.venues.find((v) => v.spec.key === venueKey)!;
  const c = vv.courts.find((x) => x.name === name);
  if (!c) throw new Error(`seed: court ${name} not found at ${venueKey}`);
  return c.id;
}

const half = (ms: number) => Math.ceil(ms / (30 * MINUTE)) * 30 * MINUTE;

export function planOpenPlay(ctx: SeedCtx, scripted: { fri: number; sat: number }): PlanItem[] {
  const localHour = (ms: number) => new Date(ms + 8 * HOUR).getUTCHours() + new Date(ms + 8 * HOUR).getUTCMinutes() / 60;
  let liveStart = half(ctx.now - 40 * MINUTE);
  const live = localHour(liveStart) >= 6 && localHour(liveStart) <= 20;
  if (!live) liveStart = ctx.at(1, 18);
  const base = { style: 'recreational' as const, capacityUnit: 'player' as const, pricing: 'per_player' as const, teamSize: 2, skillLevels: [] as string[], past: false, live: false, instructions: 'Check in at the front desk with your Open Play pass, then wait for the court captain to call your group.', equipment: '' };
  const items: PlanItem[] = [
    { ...base, key: 'live', venueKey: 'bgc', courtIds: [court(ctx, 'bgc', 'Court 5'), court(ctx, 'bgc', 'Court 6')], sport: 'pickleball', title: live ? 'Drop-in Open Play — All Levels' : 'Evening Open Play — All Levels', description: 'Show up, check in and rotate through doubles games with players at your level. Paddles available at the desk.', startMs: liveStart, endMs: liveStart + 3 * HOUR, formatCode: 'rotation', capacity: 16, price: pesos(250), modes: ['individual'], rotation: 'first_waiting', gameMinutes: 15, live, equipment: 'Paddles and balls provided' },
    { ...base, key: 'friday', venueKey: 'bgc', courtIds: [court(ctx, 'bgc', 'Court 5'), court(ctx, 'bgc', 'Court 6')], sport: 'pickleball', title: 'Friday Night Open Play', description: 'Rotate in, meet new players and play as many games as you like. Skill-balanced courts; perfect after work.', startMs: ctx.at(scripted.fri, 19), endMs: ctx.at(scripted.fri, 22), formatCode: 'rotation', capacity: 24, price: pesos(250), modes: ['individual', 'partner'], rotation: 'skill_based', gameMinutes: 15 },
    { ...base, key: 'vball_bgc', venueKey: 'bgc', courtIds: [court(ctx, 'bgc', 'The Hall · Volleyball court')], sport: 'volleyball', title: 'Volleyball Night — Beginner Friendly', description: 'Learn the rotation, play friendly 6s and meet the BGC volleyball crowd. Coaches on court.', startMs: ctx.at(2, 19), endMs: ctx.at(2, 21), formatCode: 'individual', style: 'beginner', capacity: 18, price: pesos(180), modes: ['individual'], rotation: 'random', gameMinutes: 20, skillLevels: ['beginner', 'intermediate'], equipment: 'Volleyballs provided' },
    { ...base, key: 'hoops_sat', venueKey: 'hoops', courtIds: [court(ctx, 'hoops', 'Gym 1 · Full court')], sport: 'basketball', title: 'Saturday Pickup Run (5-on-5)', description: 'Full-court runs, games to 21 or 12 minutes. Bring a squad or sign up solo and we’ll place you on a team.', startMs: ctx.at(scripted.sat, 16), endMs: ctx.at(scripted.sat, 19), formatCode: 'team', capacity: 30, price: pesos(200), modes: ['team', 'individual'], teamSize: 5, rotation: 'winner_stays', gameMinutes: 12 },
    { ...base, key: 'hoops_3x3', venueKey: 'hoops', courtIds: [court(ctx, 'hoops', 'Gym 2 · Half court A'), court(ctx, 'hoops', 'Gym 2 · Half court B')], sport: 'basketball', title: 'Weeknight 3x3 Half-Court', description: 'Fast 3-on-3 on two half courts. First to 11 or 10 minutes.', startMs: ctx.at(1, 19), endMs: ctx.at(1, 21), formatCode: 'half_court', style: 'competitive', capacity: 18, price: pesos(150), modes: ['team', 'individual'], teamSize: 3, rotation: 'winner_stays', gameMinutes: 10 },
    { ...base, key: 'spike', venueKey: 'spike', courtIds: [court(ctx, 'spike', 'Court 1'), court(ctx, 'spike', 'Court 2')], sport: 'volleyball', title: 'Coed 6s Open Play', description: 'Bring your team of six for round-robin coed matches. One fee per team.', startMs: ctx.at(2, 18), endMs: ctx.at(2, 21), formatCode: 'team', capacity: 8, capacityUnit: 'team', pricing: 'per_team', price: pesos(1_200), modes: ['team'], teamSize: 6, rotation: 'first_waiting', gameMinutes: 25 },
    { ...base, key: 'tennis', venueKey: 'baseline', courtIds: [court(ctx, 'baseline', 'Court 3'), court(ctx, 'baseline', 'Court 2 · Tennis court')], sport: 'tennis', title: 'Doubles Open Play 3.0–3.5', description: 'Rotating doubles for intermediate players. Come with a partner or get paired at the desk.', startMs: ctx.at(3, 7), endMs: ctx.at(3, 10), formatCode: 'doubles', style: 'competitive', capacity: 12, price: pesos(350), modes: ['individual', 'partner'], rotation: 'first_checked_in', gameMinutes: 30, skillLevels: ['intermediate'] },
    { ...base, key: 'pb_on_tennis', venueKey: 'baseline', courtIds: [court(ctx, 'baseline', 'Court 1 · Pickleball A'), court(ctx, 'baseline', 'Court 1 · Pickleball B')], sport: 'pickleball', title: 'Morning Pickleball on the Tennis Courts', description: 'Court 1 converts to two pickleball courts for this session (tennis is unavailable on Court 1 meanwhile).', startMs: ctx.at(1, 7), endMs: ctx.at(1, 9), formatCode: 'rotation', capacity: 8, price: pesos(150), modes: ['individual'], rotation: 'first_waiting', gameMinutes: 15 },
    // Past sessions (completed) — they power the My Sports dashboard and attendance history.
    { ...base, key: 'past_pb1', venueKey: 'bgc', courtIds: [court(ctx, 'bgc', 'Court 5'), court(ctx, 'bgc', 'Court 6')], sport: 'pickleball', title: 'Friday Night Open Play', description: 'Weekly Open Play.', startMs: ctx.at(-7, 19), endMs: ctx.at(-7, 22), formatCode: 'rotation', capacity: 24, price: pesos(250), modes: ['individual'], rotation: 'skill_based', gameMinutes: 15, past: true },
    { ...base, key: 'past_pb2', venueKey: 'bgc', courtIds: [court(ctx, 'bgc', 'Court 5'), court(ctx, 'bgc', 'Court 6')], sport: 'pickleball', title: 'Friday Night Open Play', description: 'Weekly Open Play.', startMs: ctx.at(-14, 19), endMs: ctx.at(-14, 22), formatCode: 'rotation', capacity: 24, price: pesos(250), modes: ['individual'], rotation: 'skill_based', gameMinutes: 15, past: true },
    { ...base, key: 'past_hoops', venueKey: 'hoops', courtIds: [court(ctx, 'hoops', 'Gym 1 · Full court')], sport: 'basketball', title: 'Saturday Pickup Run (5-on-5)', description: 'Full-court runs.', startMs: ctx.at(-10, 16), endMs: ctx.at(-10, 19), formatCode: 'individual', capacity: 30, price: pesos(200), modes: ['individual'], rotation: 'winner_stays', gameMinutes: 12, past: true },
    { ...base, key: 'past_tennis', venueKey: 'baseline', courtIds: [court(ctx, 'baseline', 'Court 3')], sport: 'tennis', title: 'Doubles Open Play 3.0–3.5', description: 'Rotating doubles.', startMs: ctx.at(-20, 7), endMs: ctx.at(-20, 10), formatCode: 'doubles', capacity: 12, price: pesos(350), modes: ['individual', 'partner'], rotation: 'first_checked_in', gameMinutes: 30, past: true },
  ];
  for (const it of items) for (const c of it.courtIds) ctx.take(c, it.startMs - 15 * MINUTE, it.endMs + 15 * MINUTE);
  return items;
}

export function seedOpenPlayAndSocial(ctx: SeedCtx, plan: PlanItem[]): void {
  const { t, persona, players } = ctx;
  const juan = persona.player!;
  const bea = persona.player2!;
  const sessions = new Map<string, OpenPlaySession>();
  const evSeq = new Map<Id, number>();
  const ev = (o: OpenPlaySession, e: Omit<AttendanceEvent, 'id' | 'seq' | 'sessionId' | 'businessId'>) => {
    const seq = (evSeq.get(o.id) ?? 0) + 1;
    evSeq.set(o.id, seq);
    const id = ctx.id('att');
    t.attendanceEvents[id] = { id, seq, sessionId: o.id, businessId: o.businessId, ...e };
  };
  const staffLabel = 'Paolo R. (Receptionist)';

  for (const it of plan) {
    const vv = ctx.venues.find((v) => v.spec.key === it.venueKey)!;
    const business = t.businesses[vv.venue.businessId]!;
    const created = Math.min(it.startMs - 10 * 24 * HOUR, ctx.now - 2 * 24 * HOUR);
    const status: OpenPlaySession['status'] = it.past ? 'completed' : it.live ? 'in_progress' : 'published';
    const o: OpenPlaySession = {
      id: ctx.id('ops'),
      businessId: business.id,
      venueId: vv.venue.id,
      sport: it.sport,
      title: it.title,
      description: it.description,
      courtIds: it.courtIds,
      startMs: it.startMs,
      endMs: it.endMs,
      registrationOpensAt: created,
      registrationClosesAt: it.endMs - HOUR,
      checkInOpensAt: it.startMs - 30 * MINUTE,
      lateCutoffAt: it.startMs + 45 * MINUTE,
      minParticipants: Math.min(8, it.capacity),
      capacity: it.capacity,
      capacityUnit: it.capacityUnit,
      formatCode: it.formatCode,
      style: it.style,
      customFormatLabel: '',
      skillLevels: it.skillLevels,
      eligibility: it.skillLevels.length ? 'Self-declared level; the venue may move you to a better-matched court.' : 'Open to all registered players.',
      pricing: it.pricing,
      price: it.price,
      registrationModes: it.modes,
      teamSize: it.teamSize,
      walkInsAllowed: true,
      waitlistEnabled: true,
      equipmentIncluded: !!it.equipment,
      equipmentNote: it.equipment,
      policyKey: 'standard',
      refundNote: 'Full refund up to 24 hours before; 50% up to 6 hours before; no refund after that.',
      noShowPolicy: 'No-shows after the late-arrival cutoff are not refunded and are recorded on your venue history.',
      partnerFallback: 'keep_solo',
      instructions: it.instructions,
      organizer: vv.venue.name,
      staffMemberIds: [],
      rotation: it.rotation,
      autoQueueOnCheckIn: true,
      scoreRecording: true,
      gameMinutes: it.gameMinutes,
      visibility: 'public',
      status,
      history: [{ from: 'draft', to: 'published', at: created, by: business.ownerUserId, reason: 'Published' }, ...(it.live ? [{ from: 'published' as const, to: 'in_progress' as const, at: it.startMs, by: 'system', reason: 'Session started' }] : []), ...(it.past ? [{ from: 'published' as const, to: 'completed' as const, at: it.endMs, by: 'system', reason: 'Session ended' }] : [])],
      slotIds: [],
      cancelReason: null,
      createdAt: created,
      createdBy: business.ownerUserId,
      publishedAt: created,
      updatedAt: created,
    };
    for (const cid of it.courtIds) {
      const sid = ctx.id('slt');
      const c = t.courts[cid]!;
      t.slots[sid] = { id: sid, businessId: business.id, venueId: vv.venue.id, courtId: cid, startMs: o.startMs, endMs: o.endMs, occupiedEndMs: o.endMs, kind: 'open_play', sourceId: o.id, units: c.units ?? [cid], sport: c.sport ?? it.sport, status: 'active', expiresAt: null, createdAt: created, releasedAt: null };
      o.slotIds.push(sid);
    }
    t.openPlaySessions[o.id] = o;
    sessions.set(it.key, o);
  }

  const regFor = (o: OpenPlaySession, user: User, p: Partial<OpenPlayRegistration> & Pick<OpenPlayRegistration, 'role' | 'mode'>, opts: { paid?: boolean } = {}): OpenPlayRegistration => {
    const vv = ctx.venues.find((v) => v.venue.id === o.venueId)!;
    const business = t.businesses[o.businessId]!;
    const id = ctx.id('opr');
    const nonce = ctx.id('n').slice(2, 18);
    const at = Math.min(o.startMs - ctx.int(6, 120) * HOUR, ctx.now - ctx.int(5, 600) * MINUTE);
    let checkoutId: Id | null = null;
    const amount = o.pricing === 'free' ? 0 : o.pricing === 'per_team' ? (p.role === 'captain' ? o.price : 0) : o.price;
    if (amount && opts.paid !== false) {
      const quote = buildQuote({ eventItems: [{ ref: 'open_play', label: o.title, amount, taxable: true }], tax: ctx.tax(business), fee: ctx.fee('gcash'), commission: ctx.commission(business, at) });
      const cap = ctx.capture({ business, venue: vv.venue, userId: user.id, quote, method: 'gcash', at, kind: 'open_play_registration', settle: at + HOUR < ctx.now });
      checkoutId = cap.checkoutId;
      t.checkouts[cap.checkoutId]!.openPlayRegistrationId = id;
    }
    const reg: OpenPlayRegistration = {
      id,
      sessionId: o.id,
      businessId: o.businessId,
      venueId: o.venueId,
      userId: user.id,
      partyId: null,
      status: 'confirmed',
      history: [{ from: 'held', to: 'confirmed', at: at + 3 * MINUTE, by: 'system', reason: amount ? 'Payment verified with provider' : 'Registered' }],
      checkoutId,
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
      skill: t.sportProfiles[`${user.id}:${o.sport}`]?.skill ?? ctx.pick(['beginner', 'novice', 'intermediate', 'intermediate', 'advanced'].filter((l) => t.sports[o.sport]!.skillLevels.some((x) => x.code === l))),
      createdAt: at,
      confirmedAt: at + 3 * MINUTE,
      cancelledAt: null,
      createdBy: user.id,
      ...p,
    };
    t.opRegistrations[id] = reg;
    return reg;
  };

  // Per-sport profiles for personas (self-declared, labeled with source)
  const sp = (u: User, sport: string, skill: string | null, extra: { interested?: boolean; pinned?: boolean } = {}) => {
    const id = `${u.id}:${sport}`;
    t.sportProfiles[id] = { id, userId: u.id, sport, skill, skillSource: 'self_declared', interested: extra.interested ?? true, pinned: extra.pinned ?? false, hidden: false, updatedAt: ctx.now - 30 * 24 * HOUR };
  };
  sp(juan, 'pickleball', 'intermediate', { pinned: true });
  sp(juan, 'basketball', 'intermediate');
  sp(juan, 'tennis', 'intermediate');
  sp(juan, 'volleyball', null, { interested: true });
  sp(bea, 'pickleball', 'novice', { pinned: true });
  sp(bea, 'tennis', 'intermediate');
  players.forEach((p, i) => {
    if (i % 3 === 0) sp(p, 'pickleball', ctx.pick(['beginner', 'novice', 'intermediate', 'advanced']));
    if (i % 4 === 1) sp(p, 'basketball', ctx.pick(['beginner', 'intermediate', 'advanced']));
    if (i % 5 === 2) sp(p, 'volleyball', ctx.pick(['beginner', 'intermediate', 'advanced']));
    if (i % 6 === 3) sp(p, 'tennis', ctx.pick(['beginner', 'intermediate', 'advanced']));
  });

  const pool = (skip: Id[], n: number, offset = 0) => players.filter((p) => !skip.includes(p.id)).slice(offset, offset + n);

  // ---- LIVE session (BGC pickleball)
  const live = sessions.get('live')!;
  const liveRegs = [juan, bea, ...pool([], 13, 2)].map((u) => regFor(live, u, { role: 'individual', mode: 'individual' }));
  const liveItem = plan.find((x) => x.key === 'live')!;
  if (liveItem.live) {
    const [c5, c6] = live.courtIds;
    const present = liveRegs.slice(0, 11);
    present.forEach((r, i) => {
      const at = live.checkInOpensAt + (i + 1) * 3 * MINUTE;
      const method = i === 6 ? 'manual' : i % 4 === 3 ? 'search' : 'qr';
      r.attendance = 'waiting';
      r.checkedInAt = at;
      r.checkedInBy = persona.receptionist!.id;
      r.checkInMethod = method;
      r.queueSince = at;
      if (method === 'manual') r.manuallyAdjusted = true;
      ev(live, { registrationId: r.id, type: 'check_in', method, from: 'not_arrived', to: 'waiting', actorUserId: persona.receptionist!.id, actorLabel: staffLabel, at, ...(method === 'manual' ? { reason: 'Phone battery dead — name and ID checked at the desk' } : {}) });
    });
    ev(live, { registrationId: liveRegs[4]!.id, type: 'check_in_rejected', method: 'qr', rejectCode: 'duplicate', actorUserId: persona.receptionist!.id, actorLabel: staffLabel, at: live.checkInOpensAt + 20 * MINUTE });
    ev(live, { registrationId: null, type: 'check_in_rejected', method: 'qr', rejectCode: 'expired', actorUserId: persona.receptionist!.id, actorLabel: staffLabel, at: live.checkInOpensAt + 26 * MINUTE });
    // Two completed games earlier, then two live games now.
    const mkGame = (courtId: Id, a: OpenPlayRegistration[], b: OpenPlayRegistration[], start: number, end: number | null, score: [number, number] | null): OpenPlayGame => {
      const g: OpenPlayGame = { id: ctx.id('opg'), sessionId: live.id, businessId: live.businessId, courtId, sideA: a.map((x) => x.id), sideB: b.map((x) => x.id), status: end ? 'completed' : 'in_progress', startedAt: start, endedAt: end, score: score ? { a: score[0], b: score[1] } : null, winner: score ? (score[0] > score[1] ? 'a' : 'b') : null, startedBy: persona.receptionist!.id, recordedBy: end ? persona.receptionist!.id : null };
      t.opGames[g.id] = g;
      for (const r of [...a, ...b]) {
        ev(live, { registrationId: r.id, type: 'start_game', courtId, gameId: g.id, from: 'waiting', to: 'on_court', actorUserId: persona.receptionist!.id, actorLabel: staffLabel, at: start });
        if (end) {
          r.gamesPlayed += 1;
          ev(live, { registrationId: r.id, type: 'end_game', courtId, gameId: g.id, from: 'on_court', to: 'waiting', actorUserId: persona.receptionist!.id, actorLabel: staffLabel, at: end });
          r.queueSince = end;
        }
      }
      return g;
    };
    const t0 = Math.max(live.startMs, ctx.now - 40 * MINUTE);
    mkGame(c5!, [present[0]!, present[2]!], [present[3]!, present[5]!], t0, t0 + 14 * MINUTE, [11, 7]);
    mkGame(c6!, [present[1]!, present[4]!], [present[6]!, present[7]!], t0 + 2 * MINUTE, t0 + 17 * MINUTE, [9, 11]);
    // Live: Bea on Court 5; Juan waiting #1.
    const onA = [present[1]!, present[8]!, present[9]!, present[10]!];
    const onB = [present[2]!, present[3]!, present[5]!, present[6]!];
    mkGame(c5!, [onA[0]!, onA[1]!], [onA[2]!, onA[3]!], ctx.now - 8 * MINUTE, null, null);
    mkGame(c6!, [onB[0]!, onB[1]!], [onB[2]!, onB[3]!], ctx.now - 3 * MINUTE, null, null);
    for (const r of onA) {
      r.attendance = 'on_court';
      r.courtId = c5!;
    }
    for (const r of onB) {
      r.attendance = 'on_court';
      r.courtId = c6!;
    }
    present[0]!.queueSince = t0 + 14 * MINUTE; // Juan finished first → first in the queue
    present[4]!.queueSince = t0 + 17 * MINUTE;
    present[7]!.attendance = 'temp_off';
    ev(live, { registrationId: present[7]!.id, type: 'temp_off', from: 'waiting', to: 'temp_off', actorUserId: persona.receptionist!.id, actorLabel: staffLabel, at: ctx.now - 6 * MINUTE });
  }

  // ---- upcoming sessions
  const fri = sessions.get('friday')!;
  regFor(fri, juan, { role: 'individual', mode: 'individual' });
  for (const u of pool([juan.id], 20, 5)) regFor(fri, u, { role: 'individual', mode: 'individual' });
  const vb = sessions.get('vball_bgc')!;
  for (const u of pool([], 9, 12)) regFor(vb, u, { role: 'individual', mode: 'individual' });
  const pbt = sessions.get('pb_on_tennis')!;
  for (const u of pool([], 5, 20)) regFor(pbt, u, { role: 'individual', mode: 'individual' });

  // Basketball pickup: one complete team, Juan's team with open spots (joinable), and solo players.
  const hoops = sessions.get('hoops_sat')!;
  const party = (o: OpenPlaySession, kind: OpenPlayParty['kind'], name: string, captain: User, size: number, status: OpenPlayParty['status'], joinable: boolean): OpenPlayParty => {
    const p: OpenPlayParty = { id: ctx.id('opp'), sessionId: o.id, businessId: o.businessId, kind, name, captainUserId: captain.id, size, status, joinable, invitees: [], createdAt: ctx.now - 2 * 24 * HOUR, createdBy: captain.id };
    t.opParties[p.id] = p;
    return p;
  };
  const ballers = pool([], 5, 8);
  const pb = party(hoops, 'team', 'Cubao Ballers', ballers[0]!, 5, 'complete', false);
  ballers.forEach((u, i) => regFor(hoops, u, { role: i === 0 ? 'captain' : 'member', mode: 'team', partyId: pb.id }));
  const ww = party(hoops, 'team', 'Weekend Warriors', juan, 5, 'forming', true);
  regFor(hoops, juan, { role: 'captain', mode: 'team', partyId: ww.id });
  for (const u of pool([juan.id], 2, 14)) regFor(hoops, u, { role: 'member', mode: 'team', partyId: ww.id });
  for (const u of pool([], 6, 18)) regFor(hoops, u, { role: 'individual', mode: 'individual' });
  const h3 = sessions.get('hoops_3x3')!;
  for (const u of pool([], 7, 24)) regFor(h3, u, { role: 'individual', mode: 'individual' });

  // Volleyball team session (per-team pricing, team capacity)
  const spike = sessions.get('spike')!;
  ['Mandaue Spikers', 'Net Ninjas', 'Block Party', 'Serve & Protect', 'Dig Deep'].forEach((name, k) => {
    const members = pool([], 6, (k * 6) % 36);
    const p = party(spike, 'team', name, members[0]!, 6, 'complete', false);
    members.forEach((u, i) => regFor(spike, u, { role: i === 0 ? 'captain' : 'member', mode: 'team', partyId: p.id }));
  });

  // Tennis doubles: Juan registered with Bea invited (pending) — shows the partner-invite flow from both sides.
  const tennis = sessions.get('tennis')!;
  const pair = party(tennis, 'pair', 'Juan dela Cruz & Bea S.', juan, 2, 'forming', false);
  regFor(tennis, juan, { role: 'captain', mode: 'partner', partyId: pair.id });
  const invId = ctx.id('inv');
  t.opInvites[invId] = { id: invId, partyId: pair.id, sessionId: tennis.id, businessId: tennis.businessId, inviterId: juan.id, inviteeId: bea.id, status: 'pending', createdAt: ctx.now - 20 * MINUTE, expiresAt: ctx.now + 8 * HOUR, respondedAt: null };
  for (const u of pool([], 6, 30)) regFor(tennis, u, { role: 'individual', mode: 'individual' });

  // ---- past sessions (completed attendance + recorded games for Juan)
  const pastFill = (key: string, n: number, offset: number, juanGames: number, scores: [number, number][], extra: User[] = []) => {
    const o = sessions.get(key)!;
    const regs = [regFor(o, juan, { role: 'individual', mode: 'individual' }), ...extra.map((u) => regFor(o, u, { role: 'individual', mode: 'individual' })), ...pool([juan.id], n, offset).map((u) => regFor(o, u, { role: 'individual', mode: 'individual' }))];
    regs.forEach((r, i) => {
      if (i > 0 && i % 7 === 0) {
        r.attendance = 'no_show';
        ev(o, { registrationId: r.id, type: 'no_show', from: 'not_arrived', to: 'no_show', actorUserId: null, actorLabel: 'System (late-arrival cutoff)', at: o.lateCutoffAt });
        return;
      }
      const at = o.checkInOpensAt + (i + 1) * 2 * MINUTE;
      r.attendance = 'completed';
      r.checkedInAt = at;
      r.checkInMethod = 'qr';
      r.gamesPlayed = i === 0 ? juanGames : ctx.int(2, 6);
      ev(o, { registrationId: r.id, type: 'check_in', method: 'qr', from: 'not_arrived', to: 'waiting', actorUserId: null, actorLabel: 'Front desk', at });
      ev(o, { registrationId: r.id, type: 'completed', from: 'waiting', to: 'completed', actorUserId: null, actorLabel: 'System (session ended)', at: o.endMs });
    });
    const others = regs.slice(1).filter((r) => r.attendance === 'completed');
    scores.forEach(([a, b], k) => {
      const per = o.sport === 'basketball' ? 5 : 2;
      const sideA = [regs[0]!.id, ...others.slice(k, k + per - 1).map((r) => r.id)];
      const sideB = others.slice(k + per, k + per * 2).map((r) => r.id);
      const g: OpenPlayGame = { id: ctx.id('opg'), sessionId: o.id, businessId: o.businessId, courtId: o.courtIds[k % o.courtIds.length]!, sideA, sideB, status: 'completed', startedAt: o.startMs + k * 20 * MINUTE, endedAt: o.startMs + k * 20 * MINUTE + 15 * MINUTE, score: { a, b }, winner: a > b ? 'a' : 'b', startedBy: o.createdBy, recordedBy: o.createdBy };
      t.opGames[g.id] = g;
    });
  };
  pastFill('past_pb1', 14, 3, 6, [[11, 8], [11, 9], [7, 11]], [bea]);
  pastFill('past_pb2', 12, 9, 5, [[11, 4], [10, 12]]);
  pastFill('past_hoops', 15, 15, 4, [[21, 17], [18, 21]]);
  pastFill('past_tennis', 7, 25, 3, [[6, 4], [6, 3]], [bea]);

  // ---- social graph (synthetic)
  const follow = (a: User, b: User, status: 'accepted' | 'pending' = 'accepted', daysAgo = 20) => {
    const id = ctx.id('fol');
    t.follows[id] = { id, followerId: a.id, followeeId: b.id, status, createdAt: ctx.now - daysAgo * 24 * HOUR, respondedAt: status === 'accepted' ? ctx.now - daysAgo * 24 * HOUR : null, endedAt: null };
  };
  follow(juan, bea, 'accepted', 60);
  follow(bea, juan, 'accepted', 59);
  [players[2]!, players[3]!, players[5]!].forEach((p, i) => follow(juan, p, 'accepted', 30 - i));
  [players[2]!, players[4]!, players[6]!, players[8]!, players[11]!].forEach((p, i) => follow(p, juan, 'accepted', 25 - i));
  follow(players[7]!, juan, 'pending', 1); // incoming request for Juan to approve
  t.profiles[players[10]!.id]!.social.requireApproval = true;
  t.profiles[players[10]!.id]!.visibility.profile = 'followers';
  follow(juan, players[10]!, 'pending', 2); // outgoing request waiting on a private profile
  t.profiles[players[12]!.id]!.social.discoverable = false; // hidden from search
  for (let i = 13; i < 30; i++) if (i % 3 === 0) follow(players[i]!, players[(i + 5) % players.length]!, 'accepted', i);
  // A player-to-player block (synthetic), invisible to everyone else
  const bid = ctx.id('blk');
  t.blocks[bid] = { id: bid, blockerId: players[20]!.id, blockedId: players[21]!.id, createdAt: ctx.now - 9 * 24 * HOUR };
  t.profiles[bea.id]!.bio = 'Learning pickleball, playing tennis since college. Looking for doubles partners!';

  // Notifications for the new flows
  const note = (userId: Id, category: 'events' | 'social', title: string, body: string, link: string, at: number) => {
    const id = ctx.id('ntf');
    t.notifications[id] = { id, userId, category, title, body, link, createdAt: at, readAt: null, channels: { email: 'suppressed', sms: 'n/a', push: 'sent' }, dedupeKey: null };
  };
  note(bea.id, 'events', 'Juan dela Cruz invited you to Open Play', `${tennis.title} — join as their partner. Respond before the invitation expires.`, '#/app/invites', ctx.now - 20 * MINUTE);
  note(juan.id, 'social', 'New follow request', `${t.profiles[players[7]!.id]!.displayName} (@${t.profiles[players[7]!.id]!.username}) wants to follow you.`, '#/app/follow-requests', ctx.now - 24 * HOUR);
  if (liveItem.live) note(juan.id, 'events', "You're next on court", `${live.title}: you're #1 in the waiting rotation.`, `#/app/open-play/registrations/${liveRegs[0]!.id}`, ctx.now - 2 * MINUTE);
  void ({} as AttendanceStatus);
}
