/**
 * Checkout core shared by court bookings, event registrations and product orders:
 * slot locking, immutable price snapshots, stock and promo reservations, payment-session creation,
 * expiry/cancellation, and fulfillment after a VERIFIED capture (including late captures and
 * automatic refunds when a paid checkout can no longer be fulfilled).
 */

import { AppError, fail } from '../domain/errors.ts';
import { canonicalJson, sha256Hex } from '../domain/crypto.ts';
import { newId } from '../domain/ids.ts';
import { formatPHP } from '../domain/money.ts';
import {
  buildQuote,
  evaluatePromotion,
  priceCourtTime,
  PricingError,
  type CourtPricing,
  type PaymentMethodCode,
  type PromoApplication,
  type Quote,
  type TaxProfile,
} from '../domain/pricing.ts';
import { BOOKING_TRANSITIONS, CHECKOUT_TRANSITIONS, OP_REG_TRANSITIONS, ORDER_TRANSITIONS, PAYMENT_TRANSITIONS, REGISTRATION_TRANSITIONS, transition } from '../domain/state.ts';
import { formatDateShort, formatTimeRange, MINUTE } from '../domain/time.ts';
import { reserveStock, releaseStock, sellStock } from './inventory.ts';
import type { Booking, BookingSlot, Business, Checkout, Court, Id, OrderItem, Payment, PriceSnapshot, Restriction, Venue } from './model.ts';
import * as provider from './provider.ts';
import { callProvider } from './gateway.ts';
import { paymentFailure } from '../domain/paymentFailures.ts';

export const MAX_FAILED_ATTEMPTS = 5;
import { createRefund } from './refunds.ts';
import { ConstraintViolation, slotUnits, unitsIntersect } from './store.ts';
import { commissionTermsFor, displayName, feeSchedule, notify, notifyBusiness, settings, type Svc } from './svc.ts';
import type { Db } from './store.ts';

// ---------------------------------------------------------------- restrictions

export function activeRestriction(db: Db, userId: Id, businessId: Id, venueId: Id | null, now: number): Restriction | undefined {
  return db.find(
    'restrictions',
    (r) =>
      r.userId === userId &&
      r.status === 'active' &&
      r.startAt <= now &&
      (r.endAt === null || now < r.endAt) &&
      (r.scope === 'platform' || (r.businessId === businessId && (r.venueId === null || r.venueId === venueId))),
  );
}

export const RESTRICTED_MESSAGE = "Booking isn't available for your account at this venue right now. If you think this is a mistake, you can contact the venue or submit an appeal from your notifications.";

export function assertNotRestricted(s: Svc, userId: Id, businessId: Id, venueId: Id | null): void {
  if (activeRestriction(s.db, userId, businessId, venueId, s.now)) fail('BOOKING_NOT_ALLOWED', RESTRICTED_MESSAGE);
}

// ---------------------------------------------------------------- pricing helpers

export function taxProfile(s: Svc | { db: Db }, business: Business): TaxProfile {
  return { vatRegistered: business.vatRegistered, pricesIncludeVat: business.pricesIncludeVat, vatPpm: settings(s.db).vatPpm };
}

export function holidaySet(db: Db): Set<string> {
  return new Set(db.all('holidays').map((h) => h.date));
}

export function courtPricing(db: Db, venue: Venue, court: Court, startMs: number, endMs: number): CourtPricing {
  const rules = db.filter('pricingRules', (r) => r.venueId === venue.id && r.status === 'active');
  try {
    return priceCourtTime({ rules, courtId: court.id, courtName: court.name, startMs, endMs, offsetMin: venue.offsetMin, holidays: holidaySet(db), ...(court.sport ? { sport: court.sport } : {}) });
  } catch (e) {
    if (e instanceof PricingError) throw new AppError('CONFLICT', e.message);
    throw e;
  }
}

export function lockedCourtPricing(q: Quote): CourtPricing | null {
  const item = q.items.find((i) => i.kind === 'court');
  if (!item) return null;
  return { segments: q.courtSegments, subtotal: item.amount - q.minChargeAdjustment, minChargeAdjustment: q.minChargeAdjustment, total: item.amount, nonRefundable: q.nonRefundable, ruleIds: q.pricingRuleIds };
}

export interface AddOnRequest {
  productId: Id;
  variantId: Id | null;
  qty: number;
}

export function resolveAddOns(db: Db, venue: Venue, addOns: AddOnRequest[], purpose: 'booking' | 'event' | 'standalone') {
  const quoteAddOns: { ref: string; productId: Id; variantId?: Id; label: string; unitAmount: number; qty: number; taxable: boolean }[] = [];
  const orderItems: OrderItem[] = [];
  const stockItems: { productId: Id; variantId: Id | null; qty: number; name: string }[] = [];
  for (const a of addOns.filter((x) => x.qty > 0)) {
    const p = db.get('products', a.productId);
    if (!p || p.venueId !== venue.id || p.status !== 'active') fail('VALIDATION_FAILED', 'One of the selected items is no longer available.');
    const allowed = purpose === 'booking' ? p.fulfillment.bookingAddOn : purpose === 'event' ? p.fulfillment.eventAddOn : p.fulfillment.standalone;
    if (!allowed) fail('VALIDATION_FAILED', `${p.name} can't be added here.`);
    if (!Number.isInteger(a.qty) || a.qty < 1 || a.qty > p.maxPerOrder) fail('VALIDATION_FAILED', `You can order up to ${p.maxPerOrder} of ${p.name}.`);
    const variant = a.variantId ? p.variants.find((v) => v.id === a.variantId) : null;
    if (p.variants.length && !variant) fail('VALIDATION_FAILED', `Choose a size or option for ${p.name}.`);
    const name = variant ? `${p.name} (${variant.name})` : p.name;
    const unit = variant?.price ?? p.price;
    const ref = `addon:${p.id}:${variant?.id ?? '-'}`;
    quoteAddOns.push({ ref, productId: p.id, ...(variant ? { variantId: variant.id } : {}), label: a.qty > 1 ? `${name} × ${a.qty}` : name, unitAmount: unit, qty: a.qty, taxable: p.taxable });
    orderItems.push({ ref, productId: p.id, variantId: variant?.id ?? null, name, qty: a.qty, unitPrice: unit, total: unit * a.qty });
    stockItems.push({ productId: p.id, variantId: variant?.id ?? null, qty: a.qty, name });
  }
  return { quoteAddOns, orderItems, stockItems };
}

export function resolvePromo(s: Svc, code: string | null | undefined, businessId: Id, venueId: Id, subtotal: number, userId: Id, checkoutId?: Id): PromoApplication | null {
  const c = (code ?? '').trim().toUpperCase();
  if (!c) return null;
  const promo = s.db.find('promotions', (p) => p.code.toUpperCase() === c && p.status !== 'archived' && (p.businessId === null || p.businessId === businessId));
  const userRedemptions = promo ? s.db.count('redemptions', (r) => r.promotionId === promo.id && r.userId === userId && r.status !== 'released' && r.checkoutId !== checkoutId) : 0;
  const reservedCount = promo ? s.db.count('redemptions', (r) => r.promotionId === promo.id && r.status === 'reserved' && r.checkoutId !== checkoutId) : 0;
  const res = evaluatePromotion(promo, { now: s.now, businessId, venueId, subtotal, userRedemptions, reservedCount });
  if (!res.ok) fail('PROMO_INVALID', res.reason, { fields: [{ field: 'promoCode', message: res.reason }] });
  return res.application;
}

export function saveSnapshot(s: Svc, businessId: Id, quote: Quote, lockedUntil: number): PriceSnapshot {
  const snap: PriceSnapshot = { id: newId('snp'), businessId, quote, hash: sha256Hex(canonicalJson(quote)), createdAt: s.now, lockedUntil };
  s.db.insert('snapshots', snap);
  return snap;
}

export function buildQuoteSafe(input: Parameters<typeof buildQuote>[0]): Quote {
  try {
    return buildQuote(input);
  } catch (e) {
    if (e instanceof PricingError) throw new AppError('PROMO_INVALID', e.message);
    throw e;
  }
}

// ---------------------------------------------------------------- slots

export function insertSlot(
  s: Svc,
  p: { businessId: Id; venueId: Id; courtId: Id; startMs: number; endMs: number; bufferMinutes: number; kind: BookingSlot['kind']; sourceId: Id; expiresAt: number | null },
): BookingSlot {
  const court = s.db.get('courts', p.courtId);
  const units = unitsOfCourt(court, p.courtId);
  const slot: BookingSlot = {
    id: newId('slt'),
    businessId: p.businessId,
    venueId: p.venueId,
    courtId: p.courtId,
    startMs: p.startMs,
    endMs: p.endMs,
    occupiedEndMs: p.endMs + p.bufferMinutes * MINUTE,
    kind: p.kind,
    sourceId: p.sourceId,
    units,
    ...(court?.sport ? { sport: court.sport } : {}),
    status: 'active',
    expiresAt: p.expiresAt,
    createdAt: s.now,
    releasedAt: null,
  };
  // CR-D04: different sports on the same space need a changeover gap (checked inside the same transaction).
  if (court?.sport && (p.kind === 'hold' || p.kind === 'booking' || p.kind === 'open_play')) {
    const physical = court.physicalCourtId ? s.db.get('physicalCourts', court.physicalCourtId) : undefined;
    const gap = (physical?.changeoverMinutes ?? s.db.get('venues', p.venueId)?.settings.changeoverMinutes ?? 15) * MINUTE;
    const clash = gap
      ? s.db.find('slots', (o) => o.status === 'active' && o.sourceId !== p.sourceId && !!o.sport && o.sport !== court.sport && !(o.kind === 'hold' && o.expiresAt !== null && o.expiresAt <= s.now) && unitsIntersect(slotUnits(o), units) && o.startMs - gap < slot.occupiedEndMs && slot.startMs < o.occupiedEndMs + gap && !(o.startMs < slot.occupiedEndMs && slot.startMs < o.occupiedEndMs))
      : undefined;
    if (clash) fail('CHANGEOVER_CONFLICT', `This space is set up for ${clash.sport} right before or after. Leave ${Math.round(gap / MINUTE)} minutes for the court changeover.`);
  }
  try {
    return s.db.insert('slots', slot);
  } catch (e) {
    if (e instanceof ConstraintViolation && e.constraint === 'booking_slots_no_overlap') {
      const other = e.conflictingId ? s.db.get('slots', e.conflictingId) : undefined;
      if (other && (other.kind === 'hold' || other.kind === 'booking')) {
        s.deferred.push({ at: s.now, type: 'double_booking_blocked', severity: 'info', userId: s.actor.realUser?.id ?? null, businessId: p.businessId, detail: `Overlapping ${p.kind} rejected by booking_slots_no_overlap (conflict with ${other.kind}${other.courtId !== p.courtId ? ' on a dependent court layout' : ''})`, ip: s.req.ip });
      }
      const dependent = other && other.courtId !== p.courtId;
      const otherCourt = dependent ? s.db.get('courts', other.courtId)?.name : undefined;
      fail(
        'SLOT_UNAVAILABLE',
        other?.kind === 'block'
          ? 'That court is blocked for maintenance at this time.'
          : other?.kind === 'event'
            ? 'That court is reserved for an event at this time.'
            : other?.kind === 'open_play'
              ? 'That court is reserved for an Open Play session at this time.'
              : dependent
                ? `That space is already in use (${otherCourt ?? 'a related court layout'}) at this time.`
                : 'Someone else just booked or is checking out this time. Please pick another slot.',
      );
    }
    throw e;
  }
}

/** Space units a court layout occupies; layouts created before CR-01 occupy themselves. */
export function unitsOfCourt(court: Court | undefined, fallbackId: Id): string[] {
  return court?.units?.length ? [...court.units] : [fallbackId];
}

export function releaseSlot(s: Svc, slotId: Id | null | undefined, reason: string): void {
  if (!slotId) return;
  const slot = s.db.get('slots', slotId);
  if (!slot || slot.status !== 'active') return;
  s.db.update('slots', slotId, (x) => {
    x.status = 'released';
    x.releasedAt = s.now;
    x.releaseReason = reason;
  });
}

/** Releases expired holds that overlap a requested range (the production code does this in the same transaction). */
export function sweepStaleHolds(s: Svc, courtId: Id, startMs: number, occupiedEndMs: number): void {
  const units = unitsOfCourt(s.db.get('courts', courtId), courtId);
  for (const slot of s.db.filter('slots', (x) => unitsIntersect(slotUnits(x), units) && x.status === 'active' && x.kind === 'hold' && x.expiresAt !== null && x.expiresAt <= s.now && x.startMs < occupiedEndMs && startMs < x.occupiedEndMs)) {
    const booking = s.db.get('bookings', slot.sourceId);
    if (booking) expireCheckout(s, booking.checkoutId, 'Hold expired');
    else releaseSlot(s, slot.id, 'Hold expired');
  }
}

// ---------------------------------------------------------------- checkout kind hooks

/**
 * Feature modules that add a checkout kind (Open Play) register their fulfillment here. This keeps one payment
 * pipeline (doc 24 CR-D06) without import cycles: checkout.ts never imports the feature module.
 */
export interface CheckoutKindHooks {
  fulfill(s: Svc, checkout: Checkout, payment: Payment): void;
  /** Called after a not-yet-paid registration is released (hold expired, cancelled, auto-refunded). */
  released?(s: Svc, checkout: Checkout, reason: string): void;
}
const KIND_HOOKS: Partial<Record<Checkout['kind'], CheckoutKindHooks>> = {};
export function registerCheckoutHooks(kind: Checkout['kind'], hooks: CheckoutKindHooks): void {
  KIND_HOOKS[kind] = hooks;
}

function releaseOpenPlayHold(s: Svc, checkout: Checkout, reason: string, by: string): void {
  if (!checkout.openPlayRegistrationId) return;
  const r = s.db.get('opRegistrations', checkout.openPlayRegistrationId);
  if (r && (r.status === 'held' || r.status === 'pending_payment')) {
    s.db.update('opRegistrations', r.id, (x) => {
      x.cancelledAt = s.now;
      transition(OP_REG_TRANSITIONS, x, 'cancelled', s.now, by, reason, 'Open Play registration');
    });
    KIND_HOOKS[checkout.kind]?.released?.(s, checkout, reason);
  }
}

// ---------------------------------------------------------------- checkout lifecycle

function releaseReservations(s: Svc, checkout: Checkout, reason: string): void {
  if (checkout.orderId) {
    const order = s.db.get('orders', checkout.orderId);
    if (order && order.status === 'pending_payment') {
      releaseStock(s, order.businessId, order.items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })), order.id, reason);
      s.db.update('orders', order.id, (o) => transition(ORDER_TRANSITIONS, o, 'cancelled', s.now, 'system', reason, 'order'));
    }
  }
  if (checkout.redemptionId) {
    const r = s.db.get('redemptions', checkout.redemptionId);
    if (r && r.status === 'reserved') {
      s.db.update('redemptions', r.id, (x) => {
        x.status = 'released';
      });
    }
  }
}

function expirePendingPayments(s: Svc, checkout: Checkout, to: 'expired' | 'cancelled'): void {
  for (const pid of checkout.paymentIds) {
    const p = s.db.get('payments', pid);
    if (p && (p.status === 'pending' || p.status === 'created')) s.db.update('payments', p.id, (x) => transition(PAYMENT_TRANSITIONS, x, to, s.now, 'system', to === 'expired' ? 'Checkout expired' : 'Checkout cancelled', 'payment'));
  }
}

export function expireCheckout(s: Svc, checkoutId: Id, reason: string): void {
  const checkout = s.db.get('checkouts', checkoutId);
  if (!checkout || (checkout.status !== 'open' && checkout.status !== 'payment_pending')) return;
  s.db.update('checkouts', checkout.id, (c) => transition(CHECKOUT_TRANSITIONS, c, 'expired', s.now, 'system', reason, 'checkout'));
  expirePendingPayments(s, checkout, 'expired');
  if (checkout.bookingId) {
    const b = s.db.must('bookings', checkout.bookingId);
    releaseSlot(s, b.slotId, reason);
    if (b.status === 'slot_held' || b.status === 'payment_pending') s.db.update('bookings', b.id, (x) => transition(BOOKING_TRANSITIONS, x, 'expired', s.now, 'system', reason, 'booking'));
  }
  if (checkout.registrationId) {
    const r = s.db.get('registrations', checkout.registrationId);
    if (r && (r.status === 'held' || r.status === 'pending_payment')) s.db.update('registrations', r.id, (x) => transition(REGISTRATION_TRANSITIONS, x, 'cancelled', s.now, 'system', reason, 'registration'));
  }
  releaseOpenPlayHold(s, checkout, reason, 'system');
  releaseReservations(s, checkout, reason);
}

export function cancelCheckout(s: Svc, checkoutId: Id, reason: string, by: string): void {
  const checkout = s.db.must('checkouts', checkoutId, 'checkout');
  if (checkout.status !== 'open' && checkout.status !== 'payment_pending') fail('INVALID_STATE_TRANSITION', 'This checkout is no longer active.');
  s.db.update('checkouts', checkout.id, (c) => {
    c.cancelReason = reason;
    transition(CHECKOUT_TRANSITIONS, c, 'cancelled', s.now, by, reason, 'checkout');
  });
  expirePendingPayments(s, checkout, 'cancelled');
  if (checkout.bookingId) {
    const b = s.db.must('bookings', checkout.bookingId);
    releaseSlot(s, b.slotId, reason);
    if (b.status === 'slot_held' || b.status === 'payment_pending') s.db.update('bookings', b.id, (x) => transition(BOOKING_TRANSITIONS, x, 'cancelled', s.now, by, reason, 'booking'));
  }
  if (checkout.registrationId) {
    const r = s.db.get('registrations', checkout.registrationId);
    if (r && (r.status === 'held' || r.status === 'pending_payment')) s.db.update('registrations', r.id, (x) => transition(REGISTRATION_TRANSITIONS, x, 'cancelled', s.now, by, reason, 'registration'));
  }
  releaseOpenPlayHold(s, checkout, reason, by);
  releaseReservations(s, checkout, reason);
}

// ---------------------------------------------------------------- payment start

export function rebuildQuoteWithMethod(s: Svc, checkout: Checkout, method: PaymentMethodCode | null): Quote {
  const venue = s.db.must('venues', checkout.venueId);
  const business = s.db.must('businesses', checkout.businessId);
  const current = s.db.must('snapshots', checkout.snapshotId).quote;
  const fee = method ? feeSchedule(s.db, method) : null;
  const { terms } = commissionTermsFor(s.db, business.id, s.now);
  const court = lockedCourtPricing(current);
  const courtItem = current.items.find((i) => i.kind === 'court');
  const eventItems = current.items.filter((i) => i.kind === 'event').map((i) => ({ ref: i.ref, label: i.label, ...(i.detail ? { detail: i.detail } : {}), amount: i.amount, taxable: i.taxable }));
  const addOns = current.items.filter((i) => i.kind === 'addon').map((i) => ({ ref: i.ref, productId: i.productId!, ...(i.variantId ? { variantId: i.variantId } : {}), label: i.label, unitAmount: i.unitAmount, qty: i.qty, taxable: i.taxable }));
  const promo = checkout.promoCode ? resolvePromo(s, checkout.promoCode, business.id, venue.id, current.subtotal, checkout.userId, checkout.id) : null;
  return buildQuoteSafe({
    court: court && courtItem ? { pricing: court, ref: courtItem.ref, label: courtItem.label, ...(courtItem.detail ? { detail: courtItem.detail } : {}) } : null,
    addOns,
    eventItems,
    promo,
    tax: taxProfile(s, business),
    fee,
    commission: terms,
  });
}

export function startPayment(s: Svc, checkoutId: Id, method: PaymentMethodCode): { payment: Payment; redirectUrl: string; expiresAt: number } {
  const checkout = s.db.must('checkouts', checkoutId, 'checkout');
  if (checkout.status === 'payment_pending') {
    // Idempotent re-submit: reuse the open session for the same method.
    const open = checkout.paymentIds.map((id) => s.db.get('payments', id)).find((p) => p && p.status === 'pending' && p.method === method);
    if (open) return { payment: open, redirectUrl: `#/pay/${open.providerSessionId}`, expiresAt: checkout.expiresAt };
  }
  if (checkout.status !== 'open' && checkout.status !== 'payment_pending') fail('HOLD_EXPIRED', 'This checkout is no longer active. Please start again.');
  if (s.now >= checkout.expiresAt) fail('HOLD_EXPIRED', 'Your hold expired. Please pick the time again.');
  const venue = s.db.must('venues', checkout.venueId);
  const business = s.db.must('businesses', checkout.businessId);
  if (!venue.acceptedMethods.includes(method)) fail('PAYMENT_METHOD_UNAVAILABLE', `${provider.METHOD_LABEL[method]} isn't accepted at this venue.`);
  // Card-testing / abuse guard: a checkout allows a limited number of failed attempts.
  const failedAttempts = checkout.paymentIds.filter((id) => s.db.get('payments', id)?.status === 'failed').length;
  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    s.deferred.push({ at: s.now, type: 'rate_limited', severity: 'warning', userId: checkout.userId, businessId: checkout.businessId, detail: `Checkout ${checkout.id} blocked after ${failedAttempts} failed payment attempts (possible card testing)`, ip: s.req.ip });
    fail('RATE_LIMITED', `This checkout had ${failedAttempts} failed payment attempts, so we've paused payments for it. Please start a new booking in a few minutes or contact support.`);
  }
  const quote = rebuildQuoteWithMethod(s, checkout, method);
  const snap = saveSnapshot(s, business.id, quote, checkout.expiresAt);
  const cfg = settings(s.db);
  // B02 (doc 07): make sure the provider session can live at least its minimum TTL, capped at the max hold lifetime.
  const minExpiry = s.now + cfg.providerSessionMinMinutes * MINUTE;
  const expiresAt = Math.min(Math.max(checkout.expiresAt, minExpiry), checkout.maxExpiresAt);
  // Any earlier pending attempt with another method is superseded.
  for (const pid of checkout.paymentIds) {
    const p = s.db.get('payments', pid);
    if (p && p.status === 'pending') s.db.update('payments', p.id, (x) => transition(PAYMENT_TRANSITIONS, x, 'cancelled', s.now, 'system', 'Superseded by a new payment attempt', 'payment'));
  }
  const attempt = checkout.paymentIds.length + 1;
  const paymentId = newId('pay');
  const splitPlatformAmount = quote.total - quote.venueNet;
  const payment: Payment = {
    id: paymentId,
    checkoutId: checkout.id,
    userId: checkout.userId,
    businessId: business.id,
    provider: 'xendit_sandbox',
    providerSessionId: '',
    providerPaymentId: null,
    method,
    methodDisplay: provider.METHOD_LABEL[method],
    snapshotId: snap.id,
    amount: quote.total,
    currency: 'PHP',
    status: 'created',
    history: [],
    customerFee: quote.fee?.customerAmount ?? 0,
    estimatedProviderFee: quote.fee?.estimatedProviderFee ?? 0,
    actualProviderFee: null,
    splitPlatformAmount,
    attempt,
    idempotencyKey: `${checkout.id}:${attempt}`,
    createdAt: s.now,
    capturedAt: null,
    failureReason: null,
    refundedAmount: 0,
    reconciledAt: null,
    confirmedVia: null,
    settledAt: null,
    payoutId: null,
  };
  s.db.insert('payments', payment);
  const session = callProvider(s, 'create_session', { method, businessId: business.id }, () => provider.createSession(s, {
    externalId: paymentId,
    amount: quote.total,
    method,
    forUserId: business.payoutAccount.providerSubAccountId,
    splitPlatformAmount,
    merchantName: venue.name,
    description: checkout.kind === 'court_booking' ? 'Court booking' : checkout.kind === 'event_registration' ? 'Event registration' : checkout.kind === 'open_play_registration' ? 'Open Play registration' : 'Venue order',
    expiresAt,
    idempotencyKey: payment.idempotencyKey,
  }));
  s.db.update('payments', paymentId, (p) => {
    p.providerSessionId = session.id;
    transition(PAYMENT_TRANSITIONS, p, 'pending', s.now, 'system', 'Payment session created', 'payment');
  });
  s.db.update('checkouts', checkout.id, (c) => {
    c.snapshotId = snap.id;
    c.paymentMethod = method;
    c.paymentIds = [...c.paymentIds, paymentId];
    c.expiresAt = expiresAt;
    if (c.status === 'open') transition(CHECKOUT_TRANSITIONS, c, 'payment_pending', s.now, s.actor.realUser?.id ?? 'system', `Paying with ${provider.METHOD_LABEL[method]}`, 'checkout');
  });
  if (checkout.bookingId) {
    const b = s.db.must('bookings', checkout.bookingId);
    s.db.update('bookings', b.id, (x) => {
      x.snapshotId = snap.id;
      if (x.status === 'slot_held') transition(BOOKING_TRANSITIONS, x, 'payment_pending', s.now, s.actor.realUser?.id ?? 'system', 'Payment started', 'booking');
    });
    if (b.slotId) s.db.update('slots', b.slotId, (x) => {
      x.expiresAt = expiresAt;
    });
  }
  if (checkout.registrationId) {
    const r = s.db.get('registrations', checkout.registrationId);
    if (r?.status === 'held') s.db.update('registrations', r.id, (x) => {
      x.holdExpiresAt = expiresAt;
      transition(REGISTRATION_TRANSITIONS, x, 'pending_payment', s.now, 'system', 'Payment started', 'registration');
    });
  }
  if (checkout.openPlayRegistrationId) {
    const r = s.db.get('opRegistrations', checkout.openPlayRegistrationId);
    if (r?.status === 'held') s.db.update('opRegistrations', r.id, (x) => {
      x.holdExpiresAt = expiresAt;
      transition(OP_REG_TRANSITIONS, x, 'pending_payment', s.now, 'system', 'Payment started', 'Open Play registration');
    });
  }
  return { payment: s.db.must('payments', paymentId), redirectUrl: `#/pay/${session.id}`, expiresAt };
}

// ---------------------------------------------------------------- fulfillment after verified capture

function autoRefundAll(s: Svc, checkout: Checkout, payment: Payment, reason: string, playerMessage: { title: string; body: string }): void {
  const snap = s.db.must('snapshots', payment.snapshotId);
  if (checkout.status !== 'failed' && (CHECKOUT_TRANSITIONS[checkout.status] as readonly string[]).includes('failed')) {
    s.db.update('checkouts', checkout.id, (c) => transition(CHECKOUT_TRANSITIONS, c, 'failed', s.now, 'system', reason, 'checkout'));
  }
  if (checkout.bookingId) {
    const b = s.db.must('bookings', checkout.bookingId);
    s.db.update('bookings', b.id, (x) => {
      if (x.status === 'slot_held') transition(BOOKING_TRANSITIONS, x, 'payment_pending', s.now, 'system', 'Payment received', 'booking');
      if ((BOOKING_TRANSITIONS[x.status] as readonly string[]).includes('refund_pending')) transition(BOOKING_TRANSITIONS, x, 'refund_pending', s.now, 'system', reason, 'booking');
    });
    releaseSlot(s, b.slotId, reason);
  }
  if (checkout.registrationId) {
    const r = s.db.get('registrations', checkout.registrationId);
    if (r && (r.status === 'held' || r.status === 'pending_payment')) s.db.update('registrations', r.id, (x) => transition(REGISTRATION_TRANSITIONS, x, 'cancelled', s.now, 'system', reason, 'registration'));
  }
  releaseOpenPlayHold(s, checkout, reason, 'system');
  if (checkout.orderId) {
    const o = s.db.get('orders', checkout.orderId);
    if (o && o.status === 'pending_payment') s.db.update('orders', o.id, (x) => transition(ORDER_TRANSITIONS, x, 'cancelled', s.now, 'system', reason, 'order'));
  }
  createRefund(s, {
    payment: s.db.must('payments', payment.id),
    components: { items: snap.quote.items.map((i) => ({ ref: i.ref, sharePpm: 1_000_000 })), refundGatewayFee: true },
    reason,
    initiator: 'system',
    bookingId: checkout.bookingId ?? null,
    orderId: checkout.orderId ?? null,
    registrationId: checkout.registrationId ?? null,
    openPlayRegistrationId: checkout.openPlayRegistrationId ?? null,
  });
  notify(s, checkout.userId, 'booking_updates', { ...playerMessage, link: '#/app/payments' });
}

function markPromoRedeemed(s: Svc, checkout: Checkout): void {
  if (!checkout.redemptionId) return;
  const r = s.db.get('redemptions', checkout.redemptionId);
  if (!r || r.status === 'redeemed') return;
  s.db.update('redemptions', r.id, (x) => {
    x.status = 'redeemed';
  });
  s.db.update('promotions', r.promotionId, (p) => {
    p.usedCount += 1;
  });
}

function payOrder(s: Svc, checkout: Checkout, late: boolean): { ok: boolean } {
  if (!checkout.orderId) return { ok: true };
  const order = s.db.must('orders', checkout.orderId);
  if (order.status !== 'pending_payment' && order.status !== 'cancelled') return { ok: true };
  const items = order.items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty, name: i.name }));
  if (order.status === 'cancelled' || late) {
    // Reservation was released when the hold expired; try to take stock again.
    try {
      reserveStock(s, order.businessId, items, order.id);
    } catch {
      return { ok: false };
    }
    if (order.status === 'cancelled') {
      s.db.update('orders', order.id, (o) => {
        o.status = 'pending_payment';
        o.history.push({ from: 'cancelled', to: 'pending_payment', at: s.now, by: 'system', reason: 'Late payment recovered' });
      });
    }
  }
  sellStock(s, order.businessId, items, order.id);
  s.db.update('orders', order.id, (o) => {
    o.paidAt = s.now;
    transition(ORDER_TRANSITIONS, o, 'paid', s.now, 'system', 'Payment captured', 'order');
  });
  return { ok: true };
}

export function fulfillCheckout(s: Svc, checkoutId: Id, paymentId: Id): void {
  const checkout = s.db.must('checkouts', checkoutId);
  const payment = s.db.must('payments', paymentId);
  if (checkout.status === 'completed') {
    // A second successful payment for an already-completed checkout (e.g. paid twice in two tabs): refund it in full.
    if (!checkout.paymentIds.includes(paymentId) || s.db.filter('payments', (p) => p.checkoutId === checkout.id && p.status === 'captured').length > 1) {
      const snap = s.db.must('snapshots', payment.snapshotId);
      createRefund(s, { payment, components: { items: snap.quote.items.map((i) => ({ ref: i.ref, sharePpm: 1_000_000 })), refundGatewayFee: true }, reason: 'Duplicate payment', initiator: 'system' });
      notify(s, checkout.userId, 'payment_updates', { title: 'Duplicate payment refunded', body: `We received two payments for the same checkout. ${formatPHP(payment.amount)} is being refunded.`, link: '#/app/payments' });
    }
    return;
  }
  const venue = s.db.must('venues', checkout.venueId);
  const restricted = activeRestriction(s.db, checkout.userId, checkout.businessId, checkout.venueId, s.now);
  if (restricted) {
    autoRefundAll(s, checkout, payment, 'Booking could not be completed', { title: "We couldn't complete your booking", body: `Your payment of ${formatPHP(payment.amount)} is being refunded in full. ${RESTRICTED_MESSAGE}` });
    return;
  }
  if (checkout.status === 'cancelled') {
    autoRefundAll(s, checkout, payment, checkout.cancelReason ?? 'Checkout cancelled before payment completed', { title: 'Payment refunded', body: `Your checkout was cancelled (${checkout.cancelReason ?? 'cancelled'}) before the payment completed, so ${formatPHP(payment.amount)} is being refunded in full.` });
    return;
  }
  if (checkout.kind === 'court_booking') fulfillBooking(s, checkout, payment, venue);
  else if (checkout.kind === 'event_registration') fulfillRegistration(s, checkout, payment);
  else if (KIND_HOOKS[checkout.kind]) KIND_HOOKS[checkout.kind]!.fulfill(s, checkout, payment);
  else fulfillOrder(s, checkout, payment);
  // Close any other open attempt so the player can't pay twice (a second capture would be refunded).
  for (const pid of s.db.must('checkouts', checkout.id).paymentIds) {
    const p = s.db.get('payments', pid);
    if (p && p.id !== payment.id && p.status === 'pending') {
      s.db.update('payments', p.id, (x) => transition(PAYMENT_TRANSITIONS, x, 'cancelled', s.now, 'system', 'Checkout already paid', 'payment'));
      provider.cancelSession(s, p.providerSessionId);
    }
  }
}

function fulfillBooking(s: Svc, checkout: Checkout, payment: Payment, venue: Venue): void {
  const booking = s.db.must('bookings', checkout.bookingId!);
  const court = s.db.must('courts', booking.courtId);
  let slot = booking.slotId ? s.db.get('slots', booking.slotId) : undefined;
  let late = false;
  if (!slot || slot.status !== 'active' || slot.sourceId !== booking.id) {
    // Late capture after the hold was released: try to take the same time again.
    try {
      sweepStaleHolds(s, booking.courtId, booking.startMs, booking.endMs + venue.settings.bufferMinutes * MINUTE);
      slot = insertSlot(s, { businessId: booking.businessId, venueId: booking.venueId, courtId: booking.courtId, startMs: booking.startMs, endMs: booking.endMs, bufferMinutes: venue.settings.bufferMinutes, kind: 'booking', sourceId: booking.id, expiresAt: null });
      late = true;
    } catch (e) {
      if (e instanceof AppError && e.code === 'SLOT_UNAVAILABLE') {
        autoRefundAll(s, checkout, payment, 'Slot no longer available after late payment', {
          title: 'Payment received after your hold expired',
          body: `Your hold on ${court.name} expired before the payment completed and the time was taken by someone else. ${formatPHP(payment.amount)} is being refunded in full, including fees.`,
        });
        return;
      }
      throw e;
    }
  } else {
    s.db.update('slots', slot.id, (x) => {
      x.kind = 'booking';
      x.expiresAt = null;
    });
  }
  const orderOk = payOrder(s, checkout, late);
  s.db.update('bookings', booking.id, (b) => {
    b.slotId = slot!.id;
    b.confirmedAt = s.now;
    b.lateRecovery = late;
    if (b.status === 'slot_held') transition(BOOKING_TRANSITIONS, b, 'payment_pending', s.now, 'system', 'Payment received', 'booking');
    transition(BOOKING_TRANSITIONS, b, 'confirmed', s.now, 'system', late ? 'Late payment recovered — same slot re-acquired' : 'Payment verified with provider', 'booking');
  });
  s.db.update('checkouts', checkout.id, (c) => transition(CHECKOUT_TRANSITIONS, c, 'completed', s.now, 'system', 'Paid', 'checkout'));
  markPromoRedeemed(s, checkout);
  if (!orderOk.ok && checkout.orderId) {
    const order = s.db.must('orders', checkout.orderId);
    createRefund(s, { payment: s.db.must('payments', payment.id), components: { items: order.items.map((i) => ({ ref: i.ref, sharePpm: 1_000_000 })), refundGatewayFee: false }, reason: 'Add-on out of stock after late payment', initiator: 'system', orderId: order.id });
  }
  const when = `${formatDateShort(booking.startMs, venue.offsetMin)}, ${formatTimeRange(booking.startMs, booking.endMs, venue.offsetMin)}`;
  notify(s, booking.userId, 'booking_updates', {
    title: `Booking confirmed · ${booking.code}`,
    body: `${venue.name} · ${court.name} · ${when}. Show your QR code or booking code at the front desk.`,
    link: `#/app/bookings/${booking.id}`,
    smsBody: `CourtKo: Booking ${booking.code} confirmed. ${venue.name}, ${court.name}, ${when}.`,
  });
  notify(s, booking.userId, 'payment_updates', { title: `Payment received · ${formatPHP(payment.amount)}`, body: `Paid with ${s.db.must('payments', payment.id).methodDisplay}. Your receipt is in your booking details.`, link: `#/app/bookings/${booking.id}` });
  notifyBusiness(s, booking.businessId, 'bookings.view', { title: `New booking · ${court.name}`, body: `${displayName(s.db, booking.userId)} · ${when}${booking.source === 'walk_in' ? ' (walk-in)' : ''}`, link: '#/biz/calendar' });
}

function fulfillRegistration(s: Svc, checkout: Checkout, payment: Payment): void {
  const reg = s.db.must('registrations', checkout.registrationId!);
  const event = s.db.must('events', reg.eventId);
  const division = event.divisions.find((d) => d.id === reg.divisionId)!;
  if (reg.status === 'cancelled' || reg.status === 'held' || reg.status === 'pending_payment') {
    if (reg.status === 'cancelled') {
      const taken = s.db.count('registrations', (r) => r.eventId === event.id && r.divisionId === division.id && r.id !== reg.id && ['confirmed', 'checked_in', 'held', 'pending_payment'].includes(r.status));
      if (taken >= division.capacity) {
        autoRefundAll(s, checkout, payment, 'Event division full after late payment', { title: `${event.name}: division filled up`, body: `Your seat hold expired before the payment completed and the division is now full. ${formatPHP(payment.amount)} is being refunded in full. You can join the waitlist.` });
        return;
      }
      s.db.update('registrations', reg.id, (r) => {
        r.status = 'pending_payment';
        r.history.push({ from: 'cancelled', to: 'pending_payment', at: s.now, by: 'system', reason: 'Late payment recovered' });
      });
    }
    s.db.update('registrations', reg.id, (r) => {
      r.confirmedAt = s.now;
      r.holdExpiresAt = null;
      transition(REGISTRATION_TRANSITIONS, r, 'confirmed', s.now, 'system', 'Payment verified with provider', 'registration');
    });
  }
  payOrder(s, checkout, false);
  s.db.update('checkouts', checkout.id, (c) => transition(CHECKOUT_TRANSITIONS, c, 'completed', s.now, 'system', 'Paid', 'checkout'));
  markPromoRedeemed(s, checkout);
  notify(s, reg.userId, 'events', { title: `You're registered · ${event.name}`, body: `${division.name}. We'll remind you before the event.`, link: '#/app/events' });
  notify(s, reg.userId, 'payment_updates', { title: `Payment received · ${formatPHP(payment.amount)}`, body: `Event registration for ${event.name}.`, link: '#/app/payments' });
  notifyBusiness(s, reg.businessId, 'events.manage', { title: `New registration · ${event.name}`, body: `${displayName(s.db, reg.userId)} · ${division.name}`, link: '#/biz/events' });
}

function fulfillOrder(s: Svc, checkout: Checkout, payment: Payment): void {
  const order = s.db.must('orders', checkout.orderId!);
  const res = payOrder(s, checkout, order.status === 'cancelled');
  if (!res.ok) {
    autoRefundAll(s, checkout, payment, 'Items no longer in stock', { title: 'Order refunded', body: `An item sold out before your payment completed. ${formatPHP(payment.amount)} is being refunded in full.` });
    return;
  }
  s.db.update('checkouts', checkout.id, (c) => transition(CHECKOUT_TRANSITIONS, c, 'completed', s.now, 'system', 'Paid', 'checkout'));
  markPromoRedeemed(s, checkout);
  notify(s, order.userId, 'orders', { title: `Order paid · ${order.code}`, body: "We'll let you know when it's ready for pickup.", link: `#/app/orders/${order.id}` });
  notifyBusiness(s, order.businessId, 'orders.fulfill', { title: `New order · ${order.code}`, body: order.items.map((i) => `${i.qty}× ${i.name}`).join(', '), link: '#/biz/orders' });
}

/** Payment failed/cancelled at the provider: the hold stays so the player can retry within the hold time. */
export function onPaymentAttemptFailed(s: Svc, paymentId: Id, reason: string, code: string | null = null): void {
  const payment = s.db.must('payments', paymentId);
  if (payment.status !== 'pending' && payment.status !== 'created') return;
  s.db.update('payments', payment.id, (p) => {
    p.failureReason = reason;
    p.failureCode = code;
    transition(PAYMENT_TRANSITIONS, p, 'failed', s.now, 'provider', reason, 'payment');
  });
  const checkout = s.db.must('checkouts', payment.checkoutId);
  if (checkout.status === 'payment_pending') {
    s.db.update('checkouts', checkout.id, (c) => transition(CHECKOUT_TRANSITIONS, c, 'open', s.now, 'provider', 'Payment failed — retry allowed', 'checkout'));
    if (checkout.bookingId) {
      const b = s.db.must('bookings', checkout.bookingId);
      if (b.status === 'payment_pending') s.db.update('bookings', b.id, (x) => transition(BOOKING_TRANSITIONS, x, 'slot_held', s.now, 'provider', 'Payment failed — hold kept for retry', 'booking'));
    }
    if (checkout.registrationId) {
      const r = s.db.get('registrations', checkout.registrationId);
      if (r?.status === 'pending_payment') s.db.update('registrations', r.id, (x) => transition(REGISTRATION_TRANSITIONS, x, 'held', s.now, 'provider', 'Payment failed', 'registration'));
    }
    if (checkout.openPlayRegistrationId) {
      const r = s.db.get('opRegistrations', checkout.openPlayRegistrationId);
      if (r?.status === 'pending_payment') s.db.update('opRegistrations', r.id, (x) => transition(OP_REG_TRANSITIONS, x, 'held', s.now, 'provider', 'Payment failed', 'Open Play registration'));
    }
  }
  const info = paymentFailure(code);
  notify(s, payment.userId, 'payment_updates', { title: `Payment not completed · ${info.title}`, body: `${provider.METHOD_LABEL[payment.method]}: ${info.message} ${info.nextStep}`, link: `#/app/checkout/${payment.checkoutId}` });
}

export function bookingSummary(db: Db, booking: Booking): string {
  const venue = db.get('venues', booking.venueId);
  const court = db.get('courts', booking.courtId);
  return `${venue?.name ?? 'Venue'} · ${court?.name ?? 'Court'} · ${formatDateShort(booking.startMs, venue?.offsetMin)} ${formatTimeRange(booking.startMs, booking.endMs, venue?.offsetMin)}`;
}
