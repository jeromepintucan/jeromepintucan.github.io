/**
 * Events, tournaments, clinics and open play (build step 12): capacity-safe registration (seats are held during
 * checkout), waitlist with timed offers, withdrawals with policy-based refunds, venue-initiated cancellation
 * with full refunds, court reservations for the event, and officially recorded results.
 */

import { fail, invalid, type FieldError } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { computeRefund } from '../domain/ledger.ts';
import { formatPHP, pesos } from '../domain/money.ts';
import { evaluateCancellation, POLICY_LIBRARY } from '../domain/policy.ts';
import { REGISTRATION_TRANSITIONS, transition } from '../domain/state.ts';
import { formatDateShort, formatTime, formatTimeRange, MINUTE, HOUR } from '../domain/time.ts';
import { assertNotRestricted, buildQuoteSafe, cancelCheckout, insertSlot, releaseSlot, resolveAddOns, saveSnapshot, taxProfile, type AddOnRequest } from './checkout.ts';
import { reserveStock } from './inventory.ts';
import { bookingCode } from '../domain/ids.ts';
import type { Checkout, CourtEvent, Division, EventRegistration, EventType, Id, Order } from './model.ts';
import { createRefund } from './refunds.ts';
import { audit, commissionTermsFor, displayName, notify, requireBusiness, requireUser, requireVerifiedUser, requireWritable, settings, type Svc } from './svc.ts';
import type { Db } from './store.ts';

const HOLDING: EventRegistration['status'][] = ['confirmed', 'checked_in', 'held', 'pending_payment'];

export function seatsTaken(db: Db, eventId: Id, divisionId: Id, now: number): number {
  return db.count('registrations', (r) => r.eventId === eventId && r.divisionId === divisionId && HOLDING.includes(r.status) && !((r.status === 'held' || r.status === 'pending_payment') && r.holdExpiresAt !== null && r.holdExpiresAt <= now));
}

function eventView(s: Svc, e: CourtEvent) {
  const venue = s.db.must('venues', e.venueId);
  return {
    event: e,
    venue,
    divisions: e.divisions.map((d) => ({
      division: d,
      taken: seatsTaken(s.db, e.id, d.id, s.now),
      waitlist: s.db.count('registrations', (r) => r.eventId === e.id && r.divisionId === d.id && (r.status === 'waitlisted' || r.status === 'offered')),
      fee: d.fee ?? e.fee,
    })),
    registrationOpen: s.now >= e.registrationOpensAt && s.now < e.registrationClosesAt && e.status === 'published',
    mine: s.actor.user ? s.db.filter('registrations', (r) => r.eventId === e.id && r.userId === s.actor.user!.id && r.status !== 'cancelled') : [],
  };
}

export function listPublicEvents(s: Svc, input: { type?: EventType | ''; q?: string }) {
  const q = (input.q ?? '').trim().toLowerCase();
  return s.db
    .filter('events', (e) => e.status === 'published' && e.visibility === 'public' && e.endMs > s.now && (!input.type || e.type === input.type))
    .filter((e) => !q || e.name.toLowerCase().includes(q) || s.db.must('venues', e.venueId).address.city.toLowerCase().includes(q))
    .sort((a, b) => a.startMs - b.startMs)
    .map((e) => eventView(s, e));
}

export function getEvent(s: Svc, input: { eventId: Id }) {
  const e = s.db.get('events', input.eventId);
  if (!e || e.status === 'draft' || (e.visibility === 'private' && !(s.actor.user && s.db.find('registrations', (r) => r.eventId === e.id && r.userId === s.actor.user!.id)))) fail('NOT_FOUND', 'Event not found.');
  return eventView(s, e);
}

export function registerForEvent(s: Svc, input: { eventId: Id; divisionId: Id; partnerName?: string; teamName?: string; addOns?: AddOnRequest[] }) {
  requireWritable(s);
  const user = requireVerifiedUser(s);
  const e = s.db.get('events', input.eventId);
  if (!e || e.status !== 'published') fail('NOT_FOUND', 'Event not found.');
  if (s.now < e.registrationOpensAt || s.now >= e.registrationClosesAt) fail('CONFLICT', 'Registration is closed for this event.');
  const division = e.divisions.find((d) => d.id === input.divisionId);
  if (!division) fail('NOT_FOUND', 'Division not found.');
  assertNotRestricted(s, user.id, e.businessId, e.venueId);
  if (s.db.find('registrations', (r) => r.eventId === e.id && r.userId === user.id && ['confirmed', 'checked_in', 'held', 'pending_payment', 'waitlisted', 'offered'].includes(r.status) && !((r.status === 'held' || r.status === 'pending_payment') && r.holdExpiresAt !== null && r.holdExpiresAt <= s.now))) fail('CONFLICT', "You're already registered or on the waitlist for this event.");
  if (e.teamBased && !input.partnerName?.trim()) invalid([{ field: 'partnerName', message: 'Enter your partner’s name for this doubles division.' }]);
  if (seatsTaken(s.db, e.id, division.id, s.now) >= division.capacity) fail('EVENT_FULL', `${division.name} is full.${e.waitlistEnabled ? ' You can join the waitlist.' : ''}`);
  return createRegistrationCheckout(s, user.id, e, division, input.partnerName ?? null, input.teamName ?? null, input.addOns ?? [], null);
}

function createRegistrationCheckout(s: Svc, userId: Id, e: CourtEvent, division: Division, partnerName: string | null, teamName: string | null, addOns: AddOnRequest[], existing: EventRegistration | null) {
  const venue = s.db.must('venues', e.venueId);
  const business = s.db.must('businesses', e.businessId);
  const cfg = settings(s.db);
  const expiresAt = s.now + 10 * MINUTE;
  const checkoutId = newId('chk');
  const fee = division.fee ?? e.fee;
  const { quoteAddOns, orderItems, stockItems } = resolveAddOns(s.db, venue, addOns, 'event');
  const { terms } = commissionTermsFor(s.db, business.id, s.now);
  const quote = buildQuoteSafe({ eventItems: [{ ref: 'event', label: `${e.name} · ${division.name}`, detail: `${formatDateShort(e.startMs, venue.offsetMin)} · ${formatTimeRange(e.startMs, e.endMs, venue.offsetMin)}`, amount: fee, taxable: true }], addOns: quoteAddOns, tax: taxProfile(s, business), fee: null, commission: terms });
  const snap = saveSnapshot(s, business.id, quote, expiresAt);
  const regId = existing?.id ?? newId('reg');
  let orderId: Id | null = null;
  if (orderItems.length) {
    const order: Order = { id: newId('ord'), code: `PU-${bookingCode().slice(3)}`, businessId: business.id, venueId: venue.id, userId, checkoutId, bookingId: null, registrationId: regId, items: orderItems, status: 'pending_payment', history: [], total: orderItems.reduce((a, i) => a + i.total, 0), createdAt: s.now, paidAt: null, readyAt: null, claimedAt: null, claimedBy: null };
    s.db.insert('orders', order);
    reserveStock(s, business.id, stockItems, order.id);
    orderId = order.id;
  }
  if (existing) {
    s.db.update('registrations', existing.id, (r) => {
      r.checkoutId = checkoutId;
      r.holdExpiresAt = expiresAt;
      r.offerExpiresAt = null;
      r.waitlistPosition = null;
      transition(REGISTRATION_TRANSITIONS, r, 'held', s.now, userId, 'Waitlist offer accepted', 'registration');
    });
  } else {
    s.db.insert('registrations', { id: regId, eventId: e.id, businessId: e.businessId, divisionId: division.id, userId, partnerName: partnerName?.trim() || null, teamName: teamName?.trim() || null, status: 'held', history: [], checkoutId, waitlistPosition: null, offerExpiresAt: null, holdExpiresAt: expiresAt, createdAt: s.now, confirmedAt: null, checkedInAt: null });
  }
  const checkout: Checkout = {
    id: checkoutId,
    kind: 'event_registration',
    userId,
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
    registrationId: regId,
    ...(orderId ? { orderId } : {}),
    promoCode: null,
    redemptionId: null,
    addOns,
    policyKey: e.policyKey,
    policyVersion: POLICY_LIBRARY[e.policyKey].version,
    policyAcceptedAt: null,
    source: 'online',
    createdBy: userId,
  };
  s.db.insert('checkouts', checkout);
  return { checkoutId, registrationId: regId, expiresAt };
}

export function joinWaitlist(s: Svc, input: { eventId: Id; divisionId: Id; partnerName?: string }) {
  requireWritable(s);
  const user = requireVerifiedUser(s);
  const e = s.db.get('events', input.eventId);
  if (!e || e.status !== 'published' || !e.waitlistEnabled) fail('CONFLICT', 'This event has no waitlist.');
  const division = e.divisions.find((d) => d.id === input.divisionId);
  if (!division) fail('NOT_FOUND', 'Division not found.');
  assertNotRestricted(s, user.id, e.businessId, e.venueId);
  if (s.db.find('registrations', (r) => r.eventId === e.id && r.userId === user.id && ['confirmed', 'waitlisted', 'offered', 'held', 'pending_payment'].includes(r.status))) fail('CONFLICT', "You're already registered or waitlisted.");
  const position = s.db.count('registrations', (r) => r.eventId === e.id && r.divisionId === division.id && r.status === 'waitlisted') + 1;
  const reg: EventRegistration = { id: newId('reg'), eventId: e.id, businessId: e.businessId, divisionId: division.id, userId: user.id, partnerName: input.partnerName?.trim() || null, teamName: null, status: 'waitlisted', history: [], checkoutId: null, waitlistPosition: position, offerExpiresAt: null, holdExpiresAt: null, createdAt: s.now, confirmedAt: null, checkedInAt: null };
  s.db.insert('registrations', reg);
  notify(s, user.id, 'events', { title: `On the waitlist · ${e.name}`, body: `You're #${position} for ${division.name}. We'll notify you if a spot opens.`, link: '#/app/events' });
  return { registrationId: reg.id, position };
}

/** Offer the next waitlisted player a spot (first-in, first-out) for 120 minutes. */
export function offerNextSpot(s: Svc, eventId: Id, divisionId: Id): void {
  const e = s.db.must('events', eventId);
  const division = e.divisions.find((d) => d.id === divisionId)!;
  const offered = s.db.count('registrations', (r) => r.eventId === eventId && r.divisionId === divisionId && r.status === 'offered');
  if (seatsTaken(s.db, eventId, divisionId, s.now) + offered >= division.capacity) return;
  const next = s.db.filter('registrations', (r) => r.eventId === eventId && r.divisionId === divisionId && r.status === 'waitlisted').sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0) || a.createdAt - b.createdAt)[0];
  if (!next) return;
  const until = Math.min(s.now + 120 * MINUTE, e.registrationClosesAt);
  s.db.update('registrations', next.id, (r) => {
    r.offerExpiresAt = until;
    transition(REGISTRATION_TRANSITIONS, r, 'offered', s.now, 'system', 'Spot opened', 'registration');
  });
  notify(s, next.userId, 'events', { title: `A spot opened · ${e.name}`, body: `${division.name}: claim it before ${formatTime(until)} or it goes to the next player.`, link: '#/app/events' });
}

export function acceptOffer(s: Svc, input: { registrationId: Id }) {
  requireWritable(s);
  const user = requireUser(s);
  const reg = s.db.get('registrations', input.registrationId);
  if (!reg || reg.userId !== user.id) fail('NOT_FOUND', 'Registration not found.');
  if (reg.status !== 'offered' || (reg.offerExpiresAt ?? 0) <= s.now) fail('CONFLICT', 'This offer has expired.');
  const e = s.db.must('events', reg.eventId);
  const division = e.divisions.find((d) => d.id === reg.divisionId)!;
  return createRegistrationCheckout(s, user.id, e, division, reg.partnerName, reg.teamName, [], reg);
}

export function withdrawRegistration(s: Svc, input: { registrationId: Id }) {
  requireWritable(s);
  const user = requireUser(s);
  const reg = s.db.get('registrations', input.registrationId);
  if (!reg || reg.userId !== user.id) fail('NOT_FOUND', 'Registration not found.');
  const e = s.db.must('events', reg.eventId);
  if (reg.status === 'waitlisted' || reg.status === 'offered') {
    s.db.update('registrations', reg.id, (r) => transition(REGISTRATION_TRANSITIONS, r, 'withdrawn', s.now, user.id, 'Left the waitlist', 'registration'));
    if (reg.status === 'offered') offerNextSpot(s, e.id, reg.divisionId);
    return { refundTotal: 0 };
  }
  if (reg.status !== 'confirmed') fail('INVALID_STATE_TRANSITION', 'This registration cannot be withdrawn.');
  if (e.startMs <= s.now) fail('CONFLICT', 'The event has already started.');
  const decision = evaluateCancellation(POLICY_LIBRARY[e.policyKey], 'player', s.now, e.startMs);
  const payment = s.db.filter('payments', (p) => p.checkoutId === reg.checkoutId && ['captured', 'partially_refunded'].includes(p.status))[0];
  s.db.update('registrations', reg.id, (r) => transition(REGISTRATION_TRANSITIONS, r, 'withdrawn', s.now, user.id, decision.tierLabel, 'registration'));
  let refundTotal = 0;
  if (payment) {
    const quote = s.db.must('snapshots', payment.snapshotId).quote;
    const components = { items: [{ ref: 'event', sharePpm: decision.courtRefundPpm }, ...quote.items.filter((i) => i.kind === 'addon').map((i) => ({ ref: i.ref, sharePpm: 1_000_000 }))], refundGatewayFee: decision.refundGatewayFee };
    if (computeRefund(quote, components).toCustomer > 0) {
      const r = createRefund(s, { payment, components, reason: `Withdrew from ${e.name}`, initiator: 'player', registrationId: reg.id });
      refundTotal = r?.amount ?? 0;
    }
  }
  notify(s, user.id, 'events', { title: `Withdrawn · ${e.name}`, body: refundTotal ? `${decision.tierLabel}. ${formatPHP(refundTotal)} is on its way back to you.` : `${decision.tierLabel}.`, link: '#/app/events' });
  offerNextSpot(s, e.id, reg.divisionId);
  return { refundTotal };
}

export function myRegistrations(s: Svc) {
  const u = requireUser(s);
  return s.db
    .filter('registrations', (r) => r.userId === u.id && !(r.status === 'cancelled' && !r.confirmedAt))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({ registration: r, ...eventView(s, s.db.must('events', r.eventId)) }));
}

// ---------------------------------------------------------------- business side

export function businessEvents(s: Svc, input: { businessId: Id }) {
  requireBusiness(s, input.businessId, 'bookings.view');
  return s.db
    .filter('events', (e) => e.businessId === input.businessId)
    .sort((a, b) => b.startMs - a.startMs)
    .map((e) => eventView(s, e));
}

export function saveEvent(
  s: Svc,
  input: { businessId: Id; eventId?: Id; venueId: Id; sport?: string; type: EventType; name: string; description: string; startMs: number; endMs: number; courtIds: Id[]; organizer: string; fee: number; divisions: { id?: Id; name: string; skill: string; capacity: number; format: Division['format']; fee?: number | null }[]; registrationOpensAt: number; registrationClosesAt: number; waitlistEnabled: boolean; visibility: CourtEvent['visibility']; rules: string; prizes: string; format: string; teamBased: boolean; ageNote?: string },
) {
  const acc = requireBusiness(s, input.businessId, 'events.manage', { venueId: input.venueId, write: true });
  const venue = s.db.get('venues', input.venueId);
  if (!venue || venue.businessId !== input.businessId) fail('NOT_FOUND', 'Venue not found.');
  const errors: FieldError[] = [];
  if (!input.name?.trim() || input.name.length > 80) errors.push({ field: 'name', message: 'Event name is required (up to 80 characters).' });
  if (!(input.endMs > input.startMs)) errors.push({ field: 'endMs', message: 'End must be after start.' });
  if (input.startMs < s.now) errors.push({ field: 'startMs', message: 'The event must start in the future.' });
  if (!(input.registrationClosesAt <= input.startMs && input.registrationClosesAt > input.registrationOpensAt)) errors.push({ field: 'registrationClosesAt', message: 'Registration must close before the event starts.' });
  if (!input.divisions.length) errors.push({ field: 'divisions', message: 'Add at least one division.' });
  for (const d of input.divisions) if (!d.name.trim() || !(d.capacity >= 2 && d.capacity <= 256)) errors.push({ field: 'divisions', message: 'Each division needs a name and capacity between 2 and 256.' });
  if (input.fee < 0 || input.fee > pesos(20_000)) errors.push({ field: 'fee', message: 'Fee must be between ₱0 and ₱20,000.' });
  const sport = input.sport ?? venue.sports?.[0] ?? 'pickleball';
  if (!(venue.sports?.length ? venue.sports : ['pickleball']).includes(sport)) errors.push({ field: 'sport', message: 'Choose a sport this venue offers.' });
  if ((input.type as string) === 'open_play') errors.push({ field: 'type', message: 'Open Play now has its own section (Open Play → New session).' });
  const courtIds = input.courtIds.filter((c) => s.db.get('courts', c)?.venueId === venue.id && (s.db.get('courts', c)?.sport ?? 'pickleball') === sport);
  if (errors.length) invalid(errors);
  const existing = input.eventId ? s.db.get('events', input.eventId) : undefined;
  if (input.eventId && (!existing || existing.businessId !== input.businessId)) fail('NOT_FOUND', 'Event not found.');
  if (existing && existing.status !== 'draft') {
    // Published events: only descriptive fields can change (times/courts/capacity changes need cancellation & re-creation).
    s.db.update('events', existing.id, (x) => Object.assign(x, { name: input.name.trim(), description: input.description.trim(), rules: input.rules, prizes: input.prizes, organizer: input.organizer }));
    audit(s, { action: 'event.updated', targetType: 'event', targetId: existing.id, businessId: existing.businessId, summary: `Updated details of ${input.name}` });
    return s.db.must('events', existing.id);
  }
  const event: CourtEvent = {
    id: existing?.id ?? newId('evt'),
    businessId: input.businessId,
    venueId: venue.id,
    sport,
    type: input.type,
    name: input.name.trim(),
    description: input.description.trim(),
    startMs: input.startMs,
    endMs: input.endMs,
    courtIds,
    organizer: input.organizer.trim() || acc.business.tradeName,
    fee: input.fee,
    divisions: input.divisions.map((d) => ({ id: d.id ?? newId('div'), name: d.name.trim(), skill: d.skill.trim(), capacity: d.capacity, format: d.format, fee: d.fee ?? null })),
    registrationOpensAt: input.registrationOpensAt,
    registrationClosesAt: input.registrationClosesAt,
    waitlistEnabled: input.waitlistEnabled,
    policyKey: 'standard',
    rules: input.rules,
    prizes: input.prizes,
    format: input.format,
    visibility: input.visibility,
    status: 'draft',
    checkInRequired: true,
    teamBased: input.teamBased,
    ageNote: input.ageNote ?? 'Open to players 18 and above. Minors need a parent or guardian’s consent.',
    slotIds: [],
    createdAt: existing?.createdAt ?? s.now,
    createdBy: existing?.createdBy ?? acc.user.id,
  };
  if (existing) s.db.update('events', existing.id, (x) => Object.assign(x, event));
  else s.db.insert('events', event);
  audit(s, { action: existing ? 'event.updated' : 'event.created', targetType: 'event', targetId: event.id, businessId: event.businessId, summary: `${existing ? 'Updated' : 'Created'} draft event ${event.name}` });
  return s.db.must('events', event.id);
}

export function publishEvent(s: Svc, input: { businessId: Id; eventId: Id }) {
  const e = s.db.get('events', input.eventId);
  if (!e || e.businessId !== input.businessId) fail('NOT_FOUND', 'Event not found.');
  requireBusiness(s, input.businessId, 'events.manage', { venueId: e.venueId, write: true });
  if (e.status !== 'draft') fail('INVALID_STATE_TRANSITION', 'Only draft events can be published.');
  const slotIds: Id[] = [];
  for (const courtId of e.courtIds) {
    const slot = insertSlot(s, { businessId: e.businessId, venueId: e.venueId, courtId, startMs: e.startMs, endMs: e.endMs, bufferMinutes: 0, kind: 'event', sourceId: e.id, expiresAt: null });
    slotIds.push(slot.id);
  }
  s.db.update('events', e.id, (x) => {
    x.status = 'published';
    x.slotIds = slotIds;
  });
  audit(s, { action: 'event.published', targetType: 'event', targetId: e.id, businessId: e.businessId, summary: `Published ${e.name}; reserved ${slotIds.length} court(s)` });
  return s.db.must('events', e.id);
}

export function cancelEvent(s: Svc, input: { businessId: Id; eventId: Id; reason: string }) {
  const e = s.db.get('events', input.eventId);
  if (!e || e.businessId !== input.businessId) fail('NOT_FOUND', 'Event not found.');
  requireBusiness(s, input.businessId, 'events.manage', { venueId: e.venueId, write: true });
  if (e.status !== 'published' && e.status !== 'draft') fail('INVALID_STATE_TRANSITION', 'This event cannot be cancelled.');
  if (!input.reason?.trim()) invalid([{ field: 'reason', message: 'Tell participants why the event is cancelled.' }]);
  let refunded = 0;
  for (const reg of s.db.filter('registrations', (r) => r.eventId === e.id && ['confirmed', 'held', 'pending_payment', 'waitlisted', 'offered'].includes(r.status))) {
    const payment = s.db.filter('payments', (p) => p.checkoutId === reg.checkoutId && ['captured', 'partially_refunded'].includes(p.status))[0];
    const c = reg.checkoutId ? s.db.get('checkouts', reg.checkoutId) : undefined;
    if ((reg.status === 'held' || reg.status === 'pending_payment') && c && (c.status === 'open' || c.status === 'payment_pending')) {
      // Releases the seat; a payment that still completes later is refunded automatically.
      cancelCheckout(s, c.id, 'Event cancelled', 'venue');
    } else {
      s.db.update('registrations', reg.id, (r) => transition(REGISTRATION_TRANSITIONS, r, 'cancelled', s.now, 'venue', `Event cancelled: ${input.reason}`, 'registration'));
    }
    if (payment) {
      const quote = s.db.must('snapshots', payment.snapshotId).quote;
      const r = createRefund(s, { payment, components: { items: quote.items.map((i) => ({ ref: i.ref, sharePpm: 1_000_000 })), refundGatewayFee: true }, reason: `Event cancelled: ${e.name}`, initiator: 'venue', registrationId: reg.id });
      refunded += r?.amount ?? 0;
    }
    notify(s, reg.userId, 'events', { title: `Event cancelled · ${e.name}`, body: `${input.reason.trim()}${payment ? ' You will receive a full refund, including fees.' : ''}`, link: '#/app/events' });
  }
  for (const slotId of e.slotIds) releaseSlot(s, slotId, 'Event cancelled');
  s.db.update('events', e.id, (x) => {
    x.status = 'cancelled';
  });
  audit(s, { action: 'event.cancelled', targetType: 'event', targetId: e.id, businessId: e.businessId, summary: `Cancelled ${e.name}; refunds ${formatPHP(refunded)}`, reason: input.reason });
  return { refunded };
}

export function eventRegistrations(s: Svc, input: { businessId: Id; eventId: Id }) {
  const e = s.db.get('events', input.eventId);
  if (!e || e.businessId !== input.businessId) fail('NOT_FOUND', 'Event not found.');
  requireBusiness(s, input.businessId, 'bookings.view', { venueId: e.venueId });
  return s.db
    .filter('registrations', (r) => r.eventId === e.id && r.status !== 'cancelled')
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => ({ registration: r, player: displayName(s.db, r.userId), division: e.divisions.find((d) => d.id === r.divisionId)?.name ?? '' }));
}

export function checkInRegistration(s: Svc, input: { businessId: Id; registrationId: Id }) {
  const reg = s.db.get('registrations', input.registrationId);
  if (!reg || reg.businessId !== input.businessId) fail('NOT_FOUND', 'Registration not found.');
  const e = s.db.must('events', reg.eventId);
  requireBusiness(s, input.businessId, 'events.check_in', { venueId: e.venueId, write: true });
  if (reg.status !== 'confirmed') fail('INVALID_STATE_TRANSITION', `Registration is ${reg.status}.`);
  if (s.now < e.startMs - 2 * HOUR) fail('CONFLICT', 'Event check-in opens 2 hours before the start.');
  s.db.update('registrations', reg.id, (r) => {
    r.checkedInAt = s.now;
    transition(REGISTRATION_TRANSITIONS, r, 'checked_in', s.now, s.actor.realUser!.id, 'Checked in', 'registration');
  });
  return s.db.must('registrations', reg.id);
}

export function recordMatch(s: Svc, input: { businessId: Id; eventId: Id; divisionId: Id; round: string; sideA: Id[]; sideB: Id[]; scoreA: number; scoreB: number }) {
  const e = s.db.get('events', input.eventId);
  if (!e || e.businessId !== input.businessId) fail('NOT_FOUND', 'Event not found.');
  const acc = requireBusiness(s, input.businessId, 'events.manage', { venueId: e.venueId, write: true });
  if (!(input.scoreA >= 0 && input.scoreB >= 0 && input.scoreA !== input.scoreB)) invalid([{ field: 'score', message: 'Enter a final score with a winner.' }]);
  const match = { id: newId('mtc'), eventId: e.id, businessId: e.businessId, divisionId: input.divisionId, round: input.round, sideA: input.sideA, sideB: input.sideB, scoreA: input.scoreA, scoreB: input.scoreB, recordedBy: acc.user.id, recordedAt: s.now };
  s.db.insert('matches', match);
  audit(s, { action: 'event.result_recorded', targetType: 'event', targetId: e.id, businessId: e.businessId, summary: `Recorded result ${input.scoreA}–${input.scoreB} (${input.round})` });
  return match;
}

/** Job: expire unclaimed waitlist offers and move to the next player. */
export function expireWaitlistOffers(s: Svc): number {
  let n = 0;
  for (const r of s.db.filter('registrations', (x) => x.status === 'offered' && (x.offerExpiresAt ?? 0) <= s.now)) {
    s.db.update('registrations', r.id, (x) => transition(REGISTRATION_TRANSITIONS, x, 'cancelled', s.now, 'system', 'Waitlist offer expired', 'registration'));
    notify(s, r.userId, 'events', { title: 'Waitlist offer expired', body: 'The spot was offered to the next player.', link: '#/app/events' });
    offerNextSpot(s, r.eventId, r.divisionId);
    n++;
  }
  // Seats released by expired checkouts may also open spots.
  for (const e of s.db.filter('events', (x) => x.status === 'published' && x.waitlistEnabled && x.registrationClosesAt > s.now)) for (const d of e.divisions) offerNextSpot(s, e.id, d.id);
  return n;
}
