/**
 * Court booking workflow (design docs 04 and 07): availability, holds with slot locking, checkout updates,
 * payment start, player cancellations/reschedules, and front-desk operations (check-in, no-show,
 * venue cancellation, walk-ins, calendar).
 */

import { computeAvailability, scheduleFor, validateBookingWindow, type Occupancy } from '../domain/availability.ts';
import { fail, invalid } from '../domain/errors.ts';
import { hmacSha256, randomBytes, toBase64Url, toHex, timingSafeEqual } from '../domain/crypto.ts';
import { bookingCode, newId, normalizeCode } from '../domain/ids.ts';
import { computeRefund } from '../domain/ledger.ts';
import { formatPHP } from '../domain/money.ts';
import { canReschedule, describePolicy, evaluateCancellation, POLICY_LIBRARY, type CancellationInitiator } from '../domain/policy.ts';
import { customerLines, type PaymentMethodCode } from '../domain/pricing.ts';
import { BOOKING_TRANSITIONS, ORDER_TRANSITIONS, transition, type BookingStatus } from '../domain/state.ts';
import { DAY, formatDateShort, formatTime, formatTimeRange, localDate, localToInstant, MINUTE } from '../domain/time.ts';
import { normalizePhMobile } from '../domain/validation.ts';
import {
  activeRestriction,
  assertNotRestricted,
  buildQuoteSafe,
  cancelCheckout,
  courtPricing,
  insertSlot,
  releaseSlot,
  resolveAddOns,
  resolvePromo,
  saveSnapshot,
  startPayment,
  sweepStaleHolds,
  taxProfile,
  lockedCourtPricing,
  rebuildQuoteWithMethod,
  RESTRICTED_MESSAGE,
  type AddOnRequest,
} from './checkout.ts';
import { reserveStock, releaseStock } from './inventory.ts';
import { defaultPreferences } from './auth.ts';
import type { Booking, Checkout, Court, Id, Order, Payment, Venue } from './model.ts';
import { createRefund } from './refunds.ts';
import {
  audit,
  commissionTermsFor,
  contactFor,
  displayName,
  notify,
  pageOf,
  requireBusiness,
  requireUser,
  requireVerifiedUser,
  requireWritable,
  settings,
  type Svc,
} from './svc.ts';
import type { Db } from './store.ts';

/** PLACEHOLDER signing key for booking QR tokens (production: per-environment secret in AWS Secrets Manager). */
const QR_SIGNING_KEY = 'demo-qr-signing-key-rotate-in-production';

export function bookingQrToken(b: Booking): string {
  const sig = toHex(hmacSha256(QR_SIGNING_KEY, `${b.id}.${b.qrNonce}`)).slice(0, 24);
  return `CK1.${b.id}.${sig}`;
}

function verifyQrToken(db: Db, token: string): Booking | undefined {
  const m = /^CK1\.([a-z0-9_]+)\.([0-9a-f]{24})$/.exec(token.trim());
  if (!m) return undefined;
  const b = db.get('bookings', m[1]!);
  if (!b) return undefined;
  const expected = toHex(hmacSha256(QR_SIGNING_KEY, `${b.id}.${b.qrNonce}`)).slice(0, 24);
  return timingSafeEqual(expected, m[2]!) ? b : undefined;
}

// ---------------------------------------------------------------- availability

export function occupanciesFor(db: Db, venueId: Id, from: number, to: number, now: number): Occupancy[] {
  return db
    .filter('slots', (s) => s.venueId === venueId && s.status === 'active' && s.startMs < to && from < s.occupiedEndMs && !(s.kind === 'hold' && s.expiresAt !== null && s.expiresAt <= now))
    .map((s) => ({ id: s.id, courtId: s.courtId, startMs: s.startMs, endMs: s.endMs, occupiedEndMs: s.occupiedEndMs, kind: s.kind, sourceId: s.sourceId }));
}

export function venueAvailability(s: Svc, input: { venueId: Id; date: string; durationMinutes?: number }) {
  const venue = s.db.get('venues', input.venueId);
  if (!venue || venue.status !== 'published') fail('NOT_FOUND', 'Venue not found.');
  const business = s.db.must('businesses', venue.businessId);
  const courts = s.db.filter('courts', (c) => c.venueId === venue.id && c.status === 'active').sort((a, b) => a.sortOrder - b.sortOrder);
  const duration = input.durationMinutes ?? venue.settings.minDurationMinutes;
  const schedule = scheduleFor(input.date, venue.hours, s.db.filter('specialHours', (x) => x.venueId === venue.id));
  const dayStart = localToInstant(input.date, 0, venue.offsetMin);
  const occ = occupanciesFor(s.db, venue.id, dayStart, dayStart + DAY, s.now);
  const grid = computeAvailability({ date: input.date, offsetMin: venue.offsetMin, schedule, settings: venue.settings, courtIds: courts.map((c) => c.id), occupancies: occ, durationMinutes: duration, now: s.now });
  const restricted = s.actor.user ? !!activeRestriction(s.db, s.actor.user.id, venue.businessId, venue.id, s.now) : false;
  return {
    venue,
    businessActive: business.status === 'active',
    schedule,
    durationMinutes: duration,
    restricted,
    courts: courts.map((court) => {
      const g = grid.find((x) => x.courtId === court.id)!;
      return {
        court,
        bookableStarts: g.bookableStarts,
        cells: g.cells.map((cell) => ({
          ...cell,
          price: cell.bookable ? courtPricing(s.db, venue, court, cell.startMs, cell.startMs + duration * MINUTE).total : null,
        })),
      };
    }),
  };
}

// ---------------------------------------------------------------- holds & checkout

export interface CreateHoldInput {
  venueId: Id;
  courtId: Id;
  startMs: number;
  durationMinutes: number;
  addOns?: AddOnRequest[];
  promoCode?: string | null;
}

function activeHoldCount(s: Svc, userId: Id): number {
  return s.db.count('checkouts', (c) => c.userId === userId && (c.status === 'open' || c.status === 'payment_pending') && c.expiresAt > s.now);
}

function createBookingHold(s: Svc, userId: Id, input: CreateHoldInput, opts: { source: 'online' | 'walk_in'; createdBy: Id }): { checkout: Checkout; booking: Booking } {
  const venue = s.db.get('venues', input.venueId);
  if (!venue || venue.status !== 'published') fail('NOT_FOUND', 'Venue not found.');
  const business = s.db.must('businesses', venue.businessId);
  if (business.status !== 'active') fail('CONFLICT', 'This venue is not taking bookings right now.');
  const court = s.db.get('courts', input.courtId);
  if (!court || court.venueId !== venue.id || court.status !== 'active') fail('NOT_FOUND', 'Court not found.');
  assertNotRestricted(s, userId, venue.businessId, venue.id);
  const date = localDate(input.startMs, venue.offsetMin);
  const schedule = scheduleFor(date, venue.hours, s.db.filter('specialHours', (x) => x.venueId === venue.id));
  const errors = validateBookingWindow({ startMs: input.startMs, durationMinutes: input.durationMinutes, offsetMin: venue.offsetMin, settings: venue.settings, schedule, now: s.now });
  if (errors.length) invalid(errors);
  if (opts.source === 'online' && activeHoldCount(s, userId) >= venue.settings.maxActiveHoldsPerUser) {
    fail('HOLD_LIMIT_REACHED', `You already have ${venue.settings.maxActiveHoldsPerUser} checkouts in progress. Finish or cancel one first.`);
  }
  const endMs = input.startMs + input.durationMinutes * MINUTE;
  const occupiedEnd = endMs + venue.settings.bufferMinutes * MINUTE;
  sweepStaleHolds(s, court.id, input.startMs, occupiedEnd);

  const bookingId = newId('bkg');
  const checkoutId = newId('chk');
  const cfg = settings(s.db);
  const expiresAt = s.now + venue.settings.holdTtlMinutes * MINUTE;
  const slot = insertSlot(s, { businessId: business.id, venueId: venue.id, courtId: court.id, startMs: input.startMs, endMs, bufferMinutes: venue.settings.bufferMinutes, kind: 'hold', sourceId: bookingId, expiresAt });

  const pricing = courtPricing(s.db, venue, court, input.startMs, endMs);
  const { quoteAddOns, orderItems, stockItems } = resolveAddOns(s.db, venue, input.addOns ?? [], 'booking');
  const subtotal = pricing.total + quoteAddOns.reduce((a, x) => a + x.unitAmount * x.qty, 0);
  const promo = resolvePromo(s, input.promoCode, business.id, venue.id, subtotal, userId);
  const { terms } = commissionTermsFor(s.db, business.id, s.now);
  const when = `${formatDateShort(input.startMs, venue.offsetMin)} · ${formatTimeRange(input.startMs, endMs, venue.offsetMin)}`;
  const quote = buildQuoteSafe({ court: { pricing, ref: 'court', label: `${court.name} · ${input.durationMinutes / 60 === 1 ? '1 hr' : `${input.durationMinutes / 60} hrs`}`, detail: when }, addOns: quoteAddOns, promo, tax: taxProfile(s, business), fee: null, commission: terms });
  const snap = saveSnapshot(s, business.id, quote, expiresAt);
  const policy = POLICY_LIBRARY[quote.nonRefundable ? 'non_refundable' : venue.policyKey];

  let orderId: Id | null = null;
  if (orderItems.length) {
    const order: Order = { id: newId('ord'), code: `PU-${bookingCode().slice(3)}`, businessId: business.id, venueId: venue.id, userId, checkoutId, bookingId, registrationId: null, items: orderItems, status: 'pending_payment', history: [], total: orderItems.reduce((a, i) => a + i.total, 0), createdAt: s.now, paidAt: null, readyAt: null, claimedAt: null, claimedBy: null };
    s.db.insert('orders', order);
    reserveStock(s, business.id, stockItems, order.id);
    orderId = order.id;
  }
  let redemptionId: Id | null = null;
  if (promo) {
    redemptionId = newId('red');
    s.db.insert('redemptions', { id: redemptionId, promotionId: promo.promotionId, userId, checkoutId, amount: quote.discount?.amount ?? 0, status: 'reserved', createdAt: s.now });
  }
  const booking: Booking = {
    id: bookingId,
    code: bookingCode(),
    businessId: business.id,
    venueId: venue.id,
    courtId: court.id,
    userId,
    checkoutId,
    startMs: input.startMs,
    endMs,
    durationMinutes: input.durationMinutes,
    status: 'draft',
    history: [],
    snapshotId: snap.id,
    policy: { key: policy.key, version: policy.version, name: policy.name, acceptedAt: 0 },
    participants: [],
    addOnOrderId: orderId,
    source: opts.source,
    createdAt: s.now,
    confirmedAt: null,
    checkedInAt: null,
    checkedInBy: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    noShowAt: null,
    rescheduleCount: 0,
    slotId: slot.id,
    lateRecovery: false,
    qrNonce: toBase64Url(randomBytes(9)),
  };
  s.db.insert('bookings', booking);
  s.db.update('bookings', bookingId, (b) => transition(BOOKING_TRANSITIONS, b, 'slot_held', s.now, opts.createdBy, `Hold for ${venue.settings.holdTtlMinutes} min`, 'booking'));
  const checkout: Checkout = {
    id: checkoutId,
    kind: 'court_booking',
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
    bookingId,
    ...(orderId ? { orderId } : {}),
    promoCode: promo?.code ?? null,
    redemptionId,
    addOns: (input.addOns ?? []).filter((a) => a.qty > 0),
    policyKey: policy.key,
    policyVersion: policy.version,
    policyAcceptedAt: null,
    source: opts.source,
    createdBy: opts.createdBy,
  };
  s.db.insert('checkouts', checkout);
  return { checkout, booking: s.db.must('bookings', bookingId) };
}

export function createHold(s: Svc, input: CreateHoldInput) {
  requireWritable(s);
  const user = requireVerifiedUser(s);
  const { checkout, booking } = createBookingHold(s, user.id, input, { source: 'online', createdBy: user.id });
  return { checkoutId: checkout.id, bookingId: booking.id, expiresAt: checkout.expiresAt };
}

function ownCheckout(s: Svc, checkoutId: Id): Checkout {
  const u = requireUser(s);
  const c = s.db.get('checkouts', checkoutId);
  if (!c || c.userId !== u.id) fail('NOT_FOUND', 'Checkout not found.');
  return c;
}

/** Change add-ons, promo code or payment method while the hold is active. Court price stays locked. */
export function updateCheckout(s: Svc, input: { checkoutId: Id; addOns?: AddOnRequest[]; promoCode?: string | null; paymentMethod?: PaymentMethodCode | null }) {
  requireWritable(s);
  const checkout = ownCheckout(s, input.checkoutId);
  if (checkout.status !== 'open') fail('INVALID_STATE_TRANSITION', checkout.status === 'payment_pending' ? 'A payment is already in progress for this checkout.' : 'This checkout is no longer active.');
  if (s.now >= checkout.expiresAt) fail('HOLD_EXPIRED', 'Your hold expired. Please pick the time again.');
  const venue = s.db.must('venues', checkout.venueId);
  const business = s.db.must('businesses', checkout.businessId);
  const current = s.db.must('snapshots', checkout.snapshotId).quote;
  let addOnRequests = checkout.addOns;
  if (input.addOns) {
    addOnRequests = input.addOns.filter((a) => a.qty > 0);
    // Swap stock reservations atomically.
    const { orderItems, stockItems } = resolveAddOns(s.db, venue, addOnRequests, checkout.kind === 'event_registration' ? 'event' : 'booking');
    if (checkout.orderId) {
      const old = s.db.must('orders', checkout.orderId);
      releaseStock(s, old.businessId, old.items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })), old.id, 'Add-ons changed');
      if (orderItems.length) {
        reserveStock(s, business.id, stockItems, old.id);
        s.db.update('orders', old.id, (o) => {
          o.items = orderItems;
          o.total = orderItems.reduce((a, i) => a + i.total, 0);
        });
      } else {
        s.db.update('orders', old.id, (o) => transition(ORDER_TRANSITIONS, o, 'cancelled', s.now, 'player', 'Add-ons removed', 'order'));
        s.db.update('checkouts', checkout.id, (c) => {
          delete c.orderId;
        });
        if (checkout.bookingId) s.db.update('bookings', checkout.bookingId, (b) => {
          b.addOnOrderId = null;
        });
      }
    } else if (orderItems.length) {
      const order: Order = { id: newId('ord'), code: `PU-${bookingCode().slice(3)}`, businessId: business.id, venueId: venue.id, userId: checkout.userId, checkoutId: checkout.id, bookingId: checkout.bookingId ?? null, registrationId: checkout.registrationId ?? null, items: orderItems, status: 'pending_payment', history: [], total: orderItems.reduce((a, i) => a + i.total, 0), createdAt: s.now, paidAt: null, readyAt: null, claimedAt: null, claimedBy: null };
      s.db.insert('orders', order);
      reserveStock(s, business.id, stockItems, order.id);
      s.db.update('checkouts', checkout.id, (c) => {
        c.orderId = order.id;
      });
      if (checkout.bookingId) s.db.update('bookings', checkout.bookingId, (b) => {
        b.addOnOrderId = order.id;
      });
    }
  }
  const promoCode = input.promoCode !== undefined ? (input.promoCode ?? '').trim().toUpperCase() || null : checkout.promoCode ?? null;
  s.db.update('checkouts', checkout.id, (c) => {
    c.addOns = addOnRequests;
    c.promoCode = promoCode;
    if (input.paymentMethod !== undefined) c.paymentMethod = input.paymentMethod;
  });
  // Rebuild the quote: court lines come from the locked snapshot, everything else is re-evaluated.
  const updated = s.db.must('checkouts', checkout.id);
  const { quoteAddOns } = resolveAddOns(s.db, venue, addOnRequests, checkout.kind === 'event_registration' ? 'event' : 'booking');
  const court = lockedCourtPricing(current);
  const courtItem = current.items.find((i) => i.kind === 'court');
  const eventItems = current.items.filter((i) => i.kind === 'event').map((i) => ({ ref: i.ref, label: i.label, ...(i.detail ? { detail: i.detail } : {}), amount: i.amount, taxable: i.taxable }));
  const subtotal = (courtItem?.amount ?? 0) + eventItems.reduce((a, e) => a + e.amount, 0) + quoteAddOns.reduce((a, x) => a + x.unitAmount * x.qty, 0);
  const promo = resolvePromo(s, promoCode, business.id, venue.id, subtotal, checkout.userId, checkout.id);
  const { terms } = commissionTermsFor(s.db, business.id, s.now);
  const quote = buildQuoteSafe({
    court: court && courtItem ? { pricing: court, ref: courtItem.ref, label: courtItem.label, ...(courtItem.detail ? { detail: courtItem.detail } : {}) } : null,
    addOns: quoteAddOns,
    eventItems,
    promo,
    tax: taxProfile(s, business),
    fee: updated.paymentMethod ? (settings(s.db).feeSchedules.find((f) => f.method === updated.paymentMethod && f.enabled) ?? null) : null,
    commission: terms,
  });
  const snap = saveSnapshot(s, business.id, quote, checkout.expiresAt);
  // Promo reservation follows the code.
  if (checkout.redemptionId) {
    const r = s.db.get('redemptions', checkout.redemptionId);
    if (r && r.status === 'reserved' && (!promo || r.promotionId !== promo.promotionId)) s.db.update('redemptions', r.id, (x) => {
      x.status = 'released';
    });
  }
  let redemptionId = checkout.redemptionId ?? null;
  if (promo && (!redemptionId || s.db.get('redemptions', redemptionId)?.status !== 'reserved')) {
    redemptionId = newId('red');
    s.db.insert('redemptions', { id: redemptionId, promotionId: promo.promotionId, userId: checkout.userId, checkoutId: checkout.id, amount: quote.discount?.amount ?? 0, status: 'reserved', createdAt: s.now });
  }
  s.db.update('checkouts', checkout.id, (c) => {
    c.snapshotId = snap.id;
    c.redemptionId = promo ? redemptionId : null;
  });
  if (checkout.bookingId) s.db.update('bookings', checkout.bookingId, (b) => {
    b.snapshotId = snap.id;
  });
  return { checkoutId: checkout.id, snapshotId: snap.id };
}

export function releaseHold(s: Svc, input: { checkoutId: Id }) {
  requireWritable(s);
  const checkout = ownCheckout(s, input.checkoutId);
  cancelCheckout(s, checkout.id, 'Checkout cancelled by player', checkout.userId);
  return { ok: true };
}

export function beginPayment(s: Svc, input: { checkoutId: Id; paymentMethod: PaymentMethodCode; acceptPolicy: boolean }) {
  requireWritable(s);
  const checkout = ownCheckout(s, input.checkoutId);
  if (activeRestriction(s.db, checkout.userId, checkout.businessId, checkout.venueId, s.now)) {
    // Persist the release even though this request fails.
    s.after.push((s2) => {
      const c = s2.db.get('checkouts', checkout.id);
      if (c && (c.status === 'open' || c.status === 'payment_pending')) cancelCheckout(s2, c.id, 'Booking not allowed', 'system');
    });
    fail('BOOKING_NOT_ALLOWED', RESTRICTED_MESSAGE);
  }
  if (!input.acceptPolicy) fail('POLICY_NOT_ACCEPTED', 'Please review and accept the cancellation policy.', { fields: [{ field: 'acceptPolicy', message: 'Required to continue.' }] });
  s.db.update('checkouts', checkout.id, (c) => {
    c.policyAcceptedAt = s.now;
  });
  if (checkout.bookingId) s.db.update('bookings', checkout.bookingId, (b) => {
    b.policy.acceptedAt = s.now;
  });
  const res = startPayment(s, checkout.id, input.paymentMethod);
  return { paymentId: res.payment.id, redirectUrl: res.redirectUrl, expiresAt: res.expiresAt, amount: res.payment.amount };
}

export function extendHold(s: Svc, input: { checkoutId: Id }) {
  requireWritable(s);
  const checkout = ownCheckout(s, input.checkoutId);
  if (checkout.status !== 'open') fail('INVALID_STATE_TRANSITION', 'This hold can no longer be extended.');
  if (s.now >= checkout.expiresAt) fail('HOLD_EXPIRED', 'Your hold already expired.');
  const next = Math.min(checkout.expiresAt + 5 * MINUTE, checkout.maxExpiresAt);
  if (next <= checkout.expiresAt) fail('CONFLICT', 'This hold has reached its maximum length.');
  s.db.update('checkouts', checkout.id, (c) => {
    c.expiresAt = next;
  });
  if (checkout.bookingId) {
    const b = s.db.must('bookings', checkout.bookingId);
    if (b.slotId) s.db.update('slots', b.slotId, (x) => {
      x.expiresAt = next;
    });
  }
  return { expiresAt: next, maxExpiresAt: checkout.maxExpiresAt };
}

export function getMyCheckout(s: Svc, input: { checkoutId: Id }) {
  const checkout = ownCheckout(s, input.checkoutId);
  const snapshot = s.db.must('snapshots', checkout.snapshotId);
  const booking = checkout.bookingId ? s.db.get('bookings', checkout.bookingId) ?? null : null;
  const venue = s.db.must('venues', checkout.venueId);
  const payments = checkout.paymentIds.map((id) => s.db.get('payments', id)).filter((p): p is Payment => !!p);
  const policy = POLICY_LIBRARY[checkout.policyKey];
  return {
    checkout,
    snapshot,
    lines: customerLines(snapshot.quote),
    booking,
    court: booking ? s.db.get('courts', booking.courtId) ?? null : null,
    venue,
    payments,
    policy: { name: policy.name, version: policy.version, lines: describePolicy(policy) },
    order: checkout.orderId ? s.db.get('orders', checkout.orderId) ?? null : null,
    registration: checkout.registrationId ? s.db.get('registrations', checkout.registrationId) ?? null : null,
    methods: settings(s.db).feeSchedules.filter((f) => f.enabled && venue.acceptedMethods.includes(f.method)).map((f) => ({ ...f, preview: previewTotal(s, checkout, f.method) })),
  };
}

function previewTotal(s: Svc, checkout: Checkout, method: PaymentMethodCode): { total: number; fee: number } {
  try {
    const q = rebuildQuoteWithMethod(s, checkout, method);
    return { total: q.total, fee: q.fee?.customerAmount ?? 0 };
  } catch {
    return { total: 0, fee: 0 };
  }
}

// ---------------------------------------------------------------- my bookings

function bookingView(s: Svc, b: Booking) {
  const venue = s.db.must('venues', b.venueId);
  const court = s.db.must('courts', b.courtId);
  const snapshot = s.db.get('snapshots', b.snapshotId);
  const checkout = s.db.get('checkouts', b.checkoutId);
  const payments = (checkout?.paymentIds ?? []).map((id) => s.db.get('payments', id)).filter((p): p is Payment => !!p && p.status !== 'created');
  return {
    booking: b,
    venue,
    court,
    snapshot: snapshot ?? null,
    lines: snapshot ? customerLines(snapshot.quote) : [],
    payments,
    refunds: s.db.filter('refunds', (r) => r.bookingId === b.id).sort((x, y) => x.createdAt - y.createdAt),
    order: b.addOnOrderId ? s.db.get('orders', b.addOnOrderId) ?? null : null,
    review: s.db.find('reviews', (r) => r.bookingId === b.id) ?? null,
    policyLines: describePolicy(POLICY_LIBRARY[b.policy.key]),
  };
}

export function myBookings(s: Svc, input: { tab?: 'upcoming' | 'past' | 'cancelled' } = {}) {
  const u = requireUser(s);
  const tab = input.tab ?? 'upcoming';
  const list = s.db.filter('bookings', (b) => (b.userId === u.id || b.participants.some((p) => p.userId === u.id)) && b.status !== 'draft');
  const upcoming: BookingStatus[] = ['confirmed', 'checked_in', 'slot_held', 'payment_pending'];
  const cancelled: BookingStatus[] = ['cancelled', 'refunded', 'partially_refunded', 'refund_pending', 'expired', 'failed'];
  const rows = list
    .filter((b) => (tab === 'upcoming' ? upcoming.includes(b.status) && b.endMs > s.now - 30 * MINUTE : tab === 'cancelled' ? cancelled.includes(b.status) : !upcoming.includes(b.status) && !cancelled.includes(b.status) || (upcoming.includes(b.status) && b.endMs <= s.now - 30 * MINUTE)))
    .filter((b) => !(b.status === 'slot_held' || b.status === 'payment_pending') || s.db.get('checkouts', b.checkoutId)!.expiresAt > s.now)
    .sort((a, b) => (tab === 'upcoming' ? a.startMs - b.startMs : b.startMs - a.startMs));
  return rows.map((b) => bookingView(s, b));
}

export function myBooking(s: Svc, input: { bookingId: Id }) {
  const u = requireUser(s);
  const b = s.db.get('bookings', input.bookingId);
  if (!b || (b.userId !== u.id && !b.participants.some((p) => p.userId === u.id))) fail('NOT_FOUND', 'Booking not found.');
  const view = bookingView(s, b);
  const isOwner = b.userId === u.id;
  const policy = POLICY_LIBRARY[b.policy.key];
  return {
    ...view,
    isOwner,
    qrToken: ['confirmed', 'checked_in'].includes(b.status) ? bookingQrToken(b) : null,
    canCancel: isOwner && b.status === 'confirmed' && b.startMs > s.now,
    reschedule: isOwner && b.status === 'confirmed' ? canReschedule(policy, s.now, b.startMs, b.rescheduleCount) : { ok: false, reason: 'Not available' },
    canReview: isOwner && b.status === 'completed' && !view.review,
  };
}

function policyDecision(s: Svc, b: Booking, initiator: CancellationInitiator) {
  const decision = evaluateCancellation(POLICY_LIBRARY[b.policy.key], initiator, s.now, b.startMs);
  const payment = s.db.filter('payments', (p) => p.checkoutId === b.checkoutId && ['captured', 'partially_refunded'].includes(p.status))[0];
  const quote = payment ? s.db.must('snapshots', payment.snapshotId).quote : s.db.must('snapshots', b.snapshotId).quote;
  const order = b.addOnOrderId ? s.db.get('orders', b.addOnOrderId) : undefined;
  const addOnRefs = order && order.status !== 'claimed' ? quote.items.filter((i) => i.kind === 'addon').map((i) => i.ref) : [];
  const components = { items: [{ ref: 'court', sharePpm: decision.courtRefundPpm }, ...addOnRefs.map((ref) => ({ ref, sharePpm: decision.refundUnclaimedAddOns ? 1_000_000 : 0 }))], refundGatewayFee: decision.refundGatewayFee };
  const breakdown = computeRefund(quote, components, payment ? refundedByRefSafe(s, payment.id) : {});
  return { decision, payment, breakdown, components };
}

function refundedByRefSafe(s: Svc, paymentId: Id): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of s.db.filter('refunds', (x) => x.paymentId === paymentId && x.status !== 'rejected' && x.status !== 'failed')) for (const l of r.breakdown.lines) out[l.ref] = (out[l.ref] ?? 0) + l.customerAmount;
  return out;
}

export function cancellationQuote(s: Svc, input: { bookingId: Id }) {
  const u = requireUser(s);
  const b = s.db.get('bookings', input.bookingId);
  if (!b || b.userId !== u.id) fail('NOT_FOUND', 'Booking not found.');
  if (b.status !== 'confirmed') fail('INVALID_STATE_TRANSITION', 'Only confirmed bookings can be cancelled.');
  const { decision, breakdown, payment } = policyDecision(s, b, 'player');
  return { tierLabel: decision.tierLabel, validUntil: decision.validUntil, refundTotal: breakdown.toCustomer, lines: breakdown.lines, paidTotal: payment?.amount ?? 0, feeRefundable: decision.refundGatewayFee, method: payment?.methodDisplay ?? null };
}

function cancelWithRefund(s: Svc, b: Booking, initiator: CancellationInitiator, reason: string, by: Id) {
  const { decision, payment, breakdown, components } = policyDecision(s, b, initiator);
  releaseSlot(s, b.slotId, reason);
  const order = b.addOnOrderId ? s.db.get('orders', b.addOnOrderId) : undefined;
  if (order && ['paid', 'preparing', 'ready_for_pickup'].includes(order.status)) s.db.update('orders', order.id, (o) => transition(ORDER_TRANSITIONS, o, 'cancelled', s.now, by, 'Booking cancelled', 'order'));
  s.db.update('bookings', b.id, (x) => {
    x.cancelledAt = s.now;
    x.cancelledBy = by;
    x.cancelReason = reason;
    transition(BOOKING_TRANSITIONS, x, breakdown.toCustomer > 0 && payment ? 'refund_pending' : 'cancelled', s.now, by, reason, 'booking');
  });
  let refundId: Id | null = null;
  if (payment && breakdown.toCustomer > 0) {
    const r = createRefund(s, { payment, components, reason, initiator, bookingId: b.id, orderId: order?.id ?? null });
    refundId = r?.id ?? null;
  }
  return { decision, refundTotal: breakdown.toCustomer, refundId };
}

export function cancelMyBooking(s: Svc, input: { bookingId: Id; reason?: string }) {
  requireWritable(s);
  const u = requireUser(s);
  const b = s.db.get('bookings', input.bookingId);
  if (!b || b.userId !== u.id) fail('NOT_FOUND', 'Booking not found.');
  if (b.status !== 'confirmed' || b.startMs <= s.now) fail('INVALID_STATE_TRANSITION', 'This booking can no longer be cancelled.');
  const res = cancelWithRefund(s, b, 'player', input.reason?.trim() || 'Cancelled by player', u.id);
  notify(s, u.id, 'booking_updates', {
    title: `Booking cancelled · ${b.code}`,
    body: res.refundTotal > 0 ? `${res.decision.tierLabel}. ${formatPHP(res.refundTotal)} is being refunded to your original payment method.` : `${res.decision.tierLabel}. No refund applies under the policy you accepted.`,
    link: `#/app/bookings/${b.id}`,
  });
  return { refundTotal: res.refundTotal, tierLabel: res.decision.tierLabel };
}

export function rescheduleMyBooking(s: Svc, input: { bookingId: Id; startMs: number; courtId?: Id }) {
  requireWritable(s);
  const u = requireUser(s);
  const b = s.db.get('bookings', input.bookingId);
  if (!b || b.userId !== u.id) fail('NOT_FOUND', 'Booking not found.');
  return reschedule(s, b, input.startMs, input.courtId ?? b.courtId, u.id, true);
}

function reschedule(s: Svc, b: Booking, startMs: number, courtId: Id, by: Id, byPlayer: boolean) {
  if (b.status !== 'confirmed') fail('INVALID_STATE_TRANSITION', 'Only confirmed bookings can be rescheduled.');
  const policy = POLICY_LIBRARY[b.policy.key];
  if (byPlayer) {
    const ok = canReschedule(policy, s.now, b.startMs, b.rescheduleCount);
    if (!ok.ok) fail('CONFLICT', ok.reason);
  }
  const venue = s.db.must('venues', b.venueId);
  const court = s.db.get('courts', courtId);
  if (!court || court.venueId !== venue.id || court.status !== 'active') fail('NOT_FOUND', 'Court not found.');
  assertNotRestricted(s, b.userId, b.businessId, b.venueId);
  const date = localDate(startMs, venue.offsetMin);
  const schedule = scheduleFor(date, venue.hours, s.db.filter('specialHours', (x) => x.venueId === venue.id));
  const errors = validateBookingWindow({ startMs, durationMinutes: b.durationMinutes, offsetMin: venue.offsetMin, settings: venue.settings, schedule, now: s.now });
  if (errors.length) invalid(errors);
  const endMs = startMs + b.durationMinutes * MINUTE;
  const newPrice = courtPricing(s.db, venue, court, startMs, endMs).total;
  const oldQuote = s.db.must('snapshots', b.snapshotId).quote;
  const oldPrice = oldQuote.items.find((i) => i.kind === 'court')?.amount ?? 0;
  if (newPrice > oldPrice) fail('CONFLICT', `That time costs ${formatPHP(newPrice - oldPrice)} more. Pick a time with the same or lower price, or cancel and rebook.`);
  // Acquire the new slot before releasing the old one (atomic within the transaction).
  releaseSlot(s, b.slotId, 'Rescheduled');
  sweepStaleHolds(s, court.id, startMs, endMs + venue.settings.bufferMinutes * MINUTE);
  const slot = insertSlot(s, { businessId: b.businessId, venueId: b.venueId, courtId: court.id, startMs, endMs, bufferMinutes: venue.settings.bufferMinutes, kind: 'booking', sourceId: b.id, expiresAt: null });
  const from = `${s.db.must('courts', b.courtId).name}, ${formatDateShort(b.startMs, venue.offsetMin)} ${formatTimeRange(b.startMs, b.endMs, venue.offsetMin)}`;
  const to = `${court.name}, ${formatDateShort(startMs, venue.offsetMin)} ${formatTimeRange(startMs, endMs, venue.offsetMin)}`;
  s.db.update('bookings', b.id, (x) => {
    x.slotId = slot.id;
    x.courtId = court.id;
    x.startMs = startMs;
    x.endMs = endMs;
    if (byPlayer) x.rescheduleCount += 1;
    transition(BOOKING_TRANSITIONS, x, 'confirmed', s.now, by, `Rescheduled from ${from} to ${to}`, 'booking');
  });
  let refunded = 0;
  if (newPrice < oldPrice) {
    const payment = s.db.filter('payments', (p) => p.checkoutId === b.checkoutId && ['captured', 'partially_refunded'].includes(p.status))[0];
    if (payment) {
      const courtItem = oldQuote.items.find((i) => i.kind === 'court')!;
      const paid = courtItem.amount - (oldQuote.discount?.allocations.find((a) => a.ref === 'court')?.amount ?? 0);
      const share = Math.floor(((oldPrice - newPrice) * 1_000_000) / Math.max(1, paid));
      const r = createRefund(s, { payment, components: { items: [{ ref: 'court', sharePpm: share }], refundGatewayFee: false }, reason: 'Price difference after reschedule', initiator: 'venue', bookingId: b.id });
      refunded = r?.amount ?? 0;
    }
  }
  notify(s, b.userId, 'booking_updates', { title: `Booking rescheduled · ${b.code}`, body: `Now ${to}.${refunded ? ` ${formatPHP(refunded)} price difference is being refunded.` : ''}`, link: `#/app/bookings/${b.id}` });
  return { bookingId: b.id, refunded };
}

export function addParticipant(s: Svc, input: { bookingId: Id; name: string; email?: string }) {
  requireWritable(s);
  const u = requireUser(s);
  const b = s.db.get('bookings', input.bookingId);
  if (!b || b.userId !== u.id) fail('NOT_FOUND', 'Booking not found.');
  const name = (input.name ?? '').trim();
  if (!name || name.length > 60) invalid([{ field: 'name', message: 'Enter a name (up to 60 characters).' }]);
  if (b.participants.length >= 7) fail('CONFLICT', 'A court booking can list up to 8 players.');
  const email = (input.email ?? '').trim().toLowerCase();
  const invitee = email ? s.db.find('users', (x) => x.email === email && x.status === 'active') : undefined;
  s.db.update('bookings', b.id, (x) => {
    x.participants.push({ userId: invitee?.id ?? null, name, status: invitee ? 'invited' : 'accepted' });
  });
  if (invitee) notify(s, invitee.id, 'booking_updates', { title: `${displayName(s.db, u.id)} added you to a game`, body: `${s.db.must('venues', b.venueId).name} · ${formatDateShort(b.startMs)} ${formatTimeRange(b.startMs, b.endMs)}`, link: `#/app/bookings/${b.id}` });
  return { participants: s.db.must('bookings', b.id).participants };
}

// ---------------------------------------------------------------- business operations

function customerLabel(s: Svc, perms: Set<string>, userId: Id): { name: string; contact: string | null } {
  const u = s.db.get('users', userId);
  return { name: displayName(s.db, userId), contact: perms.has('customers.view_contact') && u ? (u.phone ?? u.email ?? null) : u ? contactFor(u) : null };
}

export function businessBookings(s: Svc, input: { businessId: Id; venueId?: Id; from?: number; to?: number; status?: string; q?: string; limit?: number; cursor?: string }) {
  const acc = requireBusiness(s, input.businessId, 'bookings.view', { venueId: input.venueId ?? null });
  const q = (input.q ?? '').trim().toLowerCase();
  const rows = s.db
    .filter('bookings', (b) => b.businessId === input.businessId && b.status !== 'draft' && (!input.venueId || b.venueId === input.venueId) && (input.from === undefined || b.startMs >= input.from) && (input.to === undefined || b.startMs < input.to) && (!input.status || b.status === input.status))
    .filter((b) => !(b.status === 'slot_held' || b.status === 'payment_pending') || s.db.get('checkouts', b.checkoutId)!.expiresAt > s.now)
    .filter((b) => (acc.member.venueIds ? acc.member.venueIds.includes(b.venueId) : true))
    .map((b) => ({ ...bookingView(s, b), customer: customerLabel(s, acc.perms, b.userId) }))
    .filter((r) => !q || r.booking.code.toLowerCase().includes(q) || r.customer.name.toLowerCase().includes(q))
    .sort((a, b) => a.booking.startMs - b.booking.startMs);
  return pageOf(rows, input.limit ?? 50, input.cursor);
}

export function businessBooking(s: Svc, input: { businessId: Id; bookingId: Id }) {
  const b = s.db.get('bookings', input.bookingId);
  const acc = requireBusiness(s, input.businessId, 'bookings.view', { venueId: b?.venueId ?? null });
  if (!b || b.businessId !== input.businessId) fail('NOT_FOUND', 'Booking not found.'); // object-level check: no cross-tenant reads
  const restriction = activeRestriction(s.db, b.userId, b.businessId, b.venueId, s.now);
  return {
    ...bookingView(s, b),
    customer: customerLabel(s, acc.perms, b.userId),
    restriction: restriction && acc.perms.has('restrictions.view') ? { reasonCategory: restriction.reasonCategory, endAt: restriction.endAt, notes: acc.perms.has('restrictions.manage') ? restriction.internalNotes : null } : null,
    perms: [...acc.perms],
  };
}

export function calendar(s: Svc, input: { businessId: Id; venueId: Id; date: string }) {
  const acc = requireBusiness(s, input.businessId, 'bookings.view', { venueId: input.venueId });
  const venue = s.db.get('venues', input.venueId);
  if (!venue || venue.businessId !== input.businessId) fail('NOT_FOUND', 'Venue not found.');
  const courts = s.db.filter('courts', (c) => c.venueId === venue.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const dayStart = localToInstant(input.date, 0, venue.offsetMin);
  const schedule = scheduleFor(input.date, venue.hours, s.db.filter('specialHours', (x) => x.venueId === venue.id));
  const items = occupanciesFor(s.db, venue.id, dayStart, dayStart + DAY, s.now).map((o) => {
    if (o.kind === 'booking' || o.kind === 'hold') {
      const b = s.db.get('bookings', o.sourceId);
      return { ...o, status: b?.status ?? 'slot_held', title: b ? customerLabel(s, acc.perms, b.userId).name : 'Hold', code: b?.code ?? null, bookingId: b?.id ?? null, source: b?.source ?? 'online' };
    }
    if (o.kind === 'event') {
      const e = s.db.get('events', o.sourceId);
      return { ...o, status: 'event', title: e?.name ?? 'Event', code: null, bookingId: null, source: 'event' };
    }
    const blk = s.db.find('courtBlocks', (x) => x.slotId === o.id);
    return { ...o, status: 'blocked', title: blk ? `${blk.reason.replace('_', ' ')}${blk.note ? ` · ${blk.note}` : ''}` : 'Blocked', code: null, bookingId: null, source: 'block' };
  });
  // Completed / checked-in bookings whose slots remain active are included above; released ones are history.
  return { venue, courts, schedule, items, perms: [...acc.perms] };
}

function findBookingForCheckIn(s: Svc, businessId: Id, codeOrToken: string): Booking {
  const raw = (codeOrToken ?? '').trim();
  let b: Booking | undefined;
  if (raw.startsWith('CK1.')) {
    b = verifyQrToken(s.db, raw);
    if (!b) {
      s.deferred.push({ at: s.now, type: 'authz_denied', severity: 'warning', userId: s.actor.realUser?.id ?? null, businessId, detail: 'Invalid or forged booking QR token presented', ip: s.req.ip });
      fail('VALIDATION_FAILED', 'This QR code is not valid.', { fields: [{ field: 'code', message: 'Invalid QR code.' }] });
    }
  } else {
    const code = normalizeCode(raw);
    b = s.db.find('bookings', (x) => x.code === code);
  }
  if (!b || b.businessId !== businessId) fail('NOT_FOUND', 'No booking with that code at this business.');
  return b;
}

export function checkIn(s: Svc, input: { businessId: Id; code: string }) {
  const b0 = findBookingForCheckIn(s, input.businessId, input.code);
  const acc = requireBusiness(s, input.businessId, 'bookings.check_in', { venueId: b0.venueId, write: true });
  const venue = s.db.must('venues', b0.venueId);
  if (b0.status === 'checked_in') fail('CONFLICT', `${b0.code} is already checked in (${formatTime(b0.checkedInAt!, venue.offsetMin)}).`);
  if (b0.status !== 'confirmed') fail('INVALID_STATE_TRANSITION', `This booking is ${b0.status.replace(/_/g, ' ')}.`);
  const opens = b0.startMs - venue.settings.checkInWindowMinutesBefore * MINUTE;
  if (s.now < opens) fail('CONFLICT', `Check-in opens ${venue.settings.checkInWindowMinutesBefore} minutes before the start (${formatTime(opens, venue.offsetMin)}).`);
  if (s.now > b0.endMs) fail('CONFLICT', 'This booking has already ended.');
  s.db.update('bookings', b0.id, (x) => {
    x.checkedInAt = s.now;
    x.checkedInBy = acc.user.id;
    transition(BOOKING_TRANSITIONS, x, 'checked_in', s.now, acc.user.id, 'Checked in at front desk', 'booking');
  });
  notify(s, b0.userId, 'booking_updates', { title: "You're checked in", body: `${s.db.must('courts', b0.courtId).name} is ready. Enjoy your game!`, link: `#/app/bookings/${b0.id}`, dedupeKey: `checkin:${b0.id}` });
  return { booking: s.db.must('bookings', b0.id), customer: customerLabel(s, acc.perms, b0.userId) };
}

export function markNoShow(s: Svc, input: { businessId: Id; bookingId: Id }) {
  const b = s.db.get('bookings', input.bookingId);
  const acc = requireBusiness(s, input.businessId, 'bookings.mark_no_show', { venueId: b?.venueId ?? null, write: true });
  if (!b || b.businessId !== input.businessId) fail('NOT_FOUND', 'Booking not found.');
  const venue = s.db.must('venues', b.venueId);
  if (b.status !== 'confirmed') fail('INVALID_STATE_TRANSITION', `This booking is ${b.status.replace(/_/g, ' ')}.`);
  if (s.now < b.startMs + venue.settings.noShowGraceMinutes * MINUTE) fail('CONFLICT', `You can mark a no-show ${venue.settings.noShowGraceMinutes} minutes after the start time.`);
  s.db.update('bookings', b.id, (x) => {
    x.noShowAt = s.now;
    transition(BOOKING_TRANSITIONS, x, 'no_show', s.now, acc.user.id, 'Marked as no-show', 'booking');
  });
  audit(s, { action: 'booking.no_show', targetType: 'booking', targetId: b.id, businessId: b.businessId, summary: `Marked ${b.code} as no-show` });
  notify(s, b.userId, 'booking_updates', { title: `Marked as no-show · ${b.code}`, body: "The venue marked this booking as a no-show. If that's a mistake, contact the venue.", link: `#/app/bookings/${b.id}` });
  return { booking: s.db.must('bookings', b.id) };
}

export function venueCancelBooking(s: Svc, input: { businessId: Id; bookingId: Id; reason: 'venue' | 'court_unavailable' | 'weather'; note?: string }) {
  const b = s.db.get('bookings', input.bookingId);
  const acc = requireBusiness(s, input.businessId, 'bookings.cancel', { venueId: b?.venueId ?? null, write: true });
  if (!b || b.businessId !== input.businessId) fail('NOT_FOUND', 'Booking not found.');
  if (b.status !== 'confirmed') fail('INVALID_STATE_TRANSITION', 'Only confirmed bookings can be cancelled.');
  const label = input.reason === 'weather' ? 'Cancelled due to weather' : input.reason === 'court_unavailable' ? 'Court unavailable' : 'Cancelled by the venue';
  const res = cancelWithRefund(s, b, input.reason, `${label}${input.note ? ` — ${input.note}` : ''}`, acc.user.id);
  audit(s, { action: 'booking.venue_cancelled', targetType: 'booking', targetId: b.id, businessId: b.businessId, summary: `${label}: ${b.code}, full refund ${formatPHP(res.refundTotal)}`, reason: input.note ?? null });
  notify(s, b.userId, 'booking_updates', { title: `Booking cancelled by the venue · ${b.code}`, body: `${label}. You'll get a full refund of ${formatPHP(res.refundTotal)}, including fees. Sorry for the inconvenience!`, link: `#/app/bookings/${b.id}` });
  return { refundTotal: res.refundTotal };
}

export function staffReschedule(s: Svc, input: { businessId: Id; bookingId: Id; startMs: number; courtId?: Id }) {
  const b = s.db.get('bookings', input.bookingId);
  const acc = requireBusiness(s, input.businessId, 'bookings.reschedule', { venueId: b?.venueId ?? null, write: true });
  if (!b || b.businessId !== input.businessId) fail('NOT_FOUND', 'Booking not found.');
  const res = reschedule(s, b, input.startMs, input.courtId ?? b.courtId, acc.user.id, false);
  audit(s, { action: 'booking.rescheduled_by_staff', targetType: 'booking', targetId: b.id, businessId: b.businessId, summary: `Rescheduled ${b.code}` });
  return res;
}

/** Walk-in: staff books on the customer's behalf and shows a payment QR/link the customer pays on their phone. */
export function createWalkIn(s: Svc, input: { businessId: Id; venueId: Id; courtId: Id; startMs: number; durationMinutes: number; customerUserId?: Id; customerName?: string; customerPhone?: string; paymentMethod: PaymentMethodCode }) {
  const acc = requireBusiness(s, input.businessId, 'bookings.create_walkin', { venueId: input.venueId, write: true });
  const venue = s.db.get('venues', input.venueId);
  if (!venue || venue.businessId !== input.businessId) fail('NOT_FOUND', 'Venue not found.');
  let userId = input.customerUserId ?? null;
  if (userId) {
    if (!s.db.get('users', userId)) fail('NOT_FOUND', 'Customer not found.');
  } else {
    const name = (input.customerName ?? '').trim();
    const phone = normalizePhMobile(input.customerPhone ?? '');
    const errors = [];
    if (!name) errors.push({ field: 'customerName', message: 'Enter the customer name.' });
    if (!phone) errors.push({ field: 'customerPhone', message: 'Enter a valid PH mobile number for the receipt.' });
    if (errors.length) invalid(errors);
    const existing = s.db.find('users', (u) => u.phone === phone && u.status !== 'deleted');
    if (existing) userId = existing.id;
    else {
      userId = newId('usr');
      const [first, ...rest] = name.split(/\s+/);
      s.db.insert('users', { id: userId, email: null, phone, passwordHash: null, status: 'active', emailVerifiedAt: null, phoneVerifiedAt: null, mfa: null, platformRole: null, createdAt: s.now, lastLoginAt: null, lockedUntil: null, invited: true, deletion: null });
      s.db.insert('profiles', { id: userId, userId, firstName: first ?? name, lastName: rest.join(' '), displayName: name, city: '', skillSelf: null, bio: '', avatarHue: 140, visibility: { profile: 'private', activity: 'private', ratings: 'private' } });
      s.db.insert('preferences', { ...defaultPreferences(userId), });
    }
  }
  const { checkout, booking } = createBookingHold(s, userId!, { venueId: input.venueId, courtId: input.courtId, startMs: input.startMs, durationMinutes: input.durationMinutes }, { source: 'walk_in', createdBy: acc.user.id });
  s.db.update('checkouts', checkout.id, (c) => {
    c.policyAcceptedAt = s.now;
  });
  const res = startPayment(s, checkout.id, input.paymentMethod);
  audit(s, { action: 'booking.walk_in_created', targetType: 'booking', targetId: booking.id, businessId: input.businessId, summary: `Walk-in ${booking.code} for ${displayName(s.db, userId!)} — payment link sent` });
  return { bookingId: booking.id, code: booking.code, checkoutId: checkout.id, paymentUrl: res.redirectUrl, amount: res.payment.amount, expiresAt: res.expiresAt };
}

export function businessCustomers(s: Svc, input: { businessId: Id; q?: string }) {
  const acc = requireBusiness(s, input.businessId, 'customers.view');
  const q = (input.q ?? '').trim().toLowerCase();
  const map = new Map<Id, { userId: Id; bookings: number; completed: number; noShows: number; cancelled: number; lastVisit: number; spent: number }>();
  for (const b of s.db.filter('bookings', (x) => x.businessId === input.businessId && !['draft', 'expired', 'failed', 'slot_held', 'payment_pending'].includes(x.status))) {
    const r = map.get(b.userId) ?? { userId: b.userId, bookings: 0, completed: 0, noShows: 0, cancelled: 0, lastVisit: 0, spent: 0 };
    r.bookings++;
    if (b.status === 'completed') r.completed++;
    if (b.status === 'no_show') r.noShows++;
    if (['cancelled', 'refunded', 'partially_refunded'].includes(b.status)) r.cancelled++;
    if (b.startMs < s.now) r.lastVisit = Math.max(r.lastVisit, b.startMs);
    r.spent += s.db.get('snapshots', b.snapshotId)?.quote.total ?? 0;
    map.set(b.userId, r);
  }
  return [...map.values()]
    .map((r) => {
      const restriction = acc.perms.has('restrictions.view') ? activeRestriction(s.db, r.userId, input.businessId, null, s.now) : undefined;
      return { ...r, ...customerLabel(s, acc.perms, r.userId), restricted: !!restriction, restrictionId: restriction?.id ?? null };
    })
    .filter((r) => !q || r.name.toLowerCase().includes(q))
    .sort((a, b) => b.bookings - a.bookings);
}

export function customerSearch(s: Svc, input: { businessId: Id; q: string }) {
  const acc = requireBusiness(s, input.businessId, 'bookings.create_walkin');
  const q = (input.q ?? '').trim().toLowerCase();
  if (q.length < 2) return [];
  return s.db
    .filter('profiles', (p) => p.displayName.toLowerCase().includes(q) || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q))
    .slice(0, 8)
    .map((p) => ({ userId: p.userId, ...customerLabel(s, acc.perms, p.userId) }));
}

// ---------------------------------------------------------------- jobs

export function completeFinishedBookings(s: Svc): number {
  let n = 0;
  for (const b of s.db.filter('bookings', (x) => (x.status === 'confirmed' || x.status === 'checked_in') && x.endMs <= s.now)) {
    const venue = s.db.get('venues', b.venueId);
    if (b.status === 'confirmed' && venue?.settings.requireCheckIn) continue;
    s.db.update('bookings', b.id, (x) => {
      x.completedAt = s.now;
      transition(BOOKING_TRANSITIONS, x, 'completed', s.now, 'system', 'Play time ended', 'booking');
    });
    notify(s, b.userId, 'reminders', { title: 'How was your game?', body: `Rate your session at ${venue?.name ?? 'the venue'} — reviews come only from verified bookings.`, link: `#/app/bookings/${b.id}`, dedupeKey: `review:${b.id}` });
    n++;
  }
  return n;
}

export function sendReminders(s: Svc): number {
  let n = 0;
  for (const b of s.db.filter('bookings', (x) => x.status === 'confirmed' && x.startMs > s.now && x.startMs - s.now <= 24 * 3_600_000)) {
    const venue = s.db.must('venues', b.venueId);
    const within2h = b.startMs - s.now <= 2 * 3_600_000;
    const key = `${within2h ? 'r2h' : 'r24h'}:${b.id}`;
    const nfy = notify(s, b.userId, 'reminders', {
      title: within2h ? `Your game starts at ${formatTime(b.startMs, venue.offsetMin)}` : 'Game coming up',
      body: `${venue.name} · ${s.db.must('courts', b.courtId).name} · ${formatDateShort(b.startMs)} ${formatTimeRange(b.startMs, b.endMs)}. Booking code ${b.code}.`,
      link: `#/app/bookings/${b.id}`,
      dedupeKey: key,
    });
    if (nfy) n++;
  }
  return n;
}

export function courtLabel(c: Court): string {
  return `${c.name} · ${c.environment === 'indoor' ? 'Indoor' : c.environment === 'covered' ? 'Covered' : 'Outdoor'}`;
}

export function venueOf(db: Db, id: Id): Venue | undefined {
  return db.get('venues', id);
}
