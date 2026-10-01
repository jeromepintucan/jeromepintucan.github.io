/**
 * Refunds (design doc 09): proportional breakdown from the immutable quote snapshot, approval rules,
 * provider submission with idempotency, completion via verified webhook, failure handling, and
 * refund-after-payout (venue payable goes negative and is recovered from later settlements).
 */

import { fail } from '../domain/errors.ts';
import { computeRefund, refundJournal, type RefundComponents } from '../domain/ledger.ts';
import { formatPHP } from '../domain/money.ts';
import type { CancellationInitiator } from '../domain/policy.ts';
import { BOOKING_TRANSITIONS, ORDER_TRANSITIONS, PAYMENT_TRANSITIONS, REFUND_TRANSITIONS, REGISTRATION_TRANSITIONS, transition } from '../domain/state.ts';
import { newId } from '../domain/ids.ts';
import { postJournal } from './ledgerSvc.ts';
import type { Id, Payment, Refund } from './model.ts';
import * as provider from './provider.ts';
import { audit, notify, notifyBusiness, requireBusiness, requirePlatform, requireUser, settings, type Svc } from './svc.ts';
import { returnStock } from './inventory.ts';

export function refundedByRef(s: Svc, paymentId: Id): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of s.db.filter('refunds', (x) => x.paymentId === paymentId && (x.status === 'succeeded' || x.status === 'processing' || x.status === 'approved' || x.status === 'pending_approval' || x.status === 'requested'))) {
    for (const l of r.breakdown.lines) out[l.ref] = (out[l.ref] ?? 0) + l.customerAmount;
  }
  return out;
}

export function paidOut(s: Svc, payment: Payment): boolean {
  if (!payment.payoutId) return false;
  const p = s.db.get('payouts', payment.payoutId);
  return !!p && (p.status === 'paid' || p.status === 'processing');
}

export function createRefund(
  s: Svc,
  input: {
    payment: Payment;
    components: RefundComponents;
    reason: string;
    initiator: CancellationInitiator | 'goodwill';
    bookingId?: Id | null;
    orderId?: Id | null;
    registrationId?: Id | null;
    approvedByRequester?: boolean;
  },
): Refund | null {
  const payment = input.payment;
  if (!['captured', 'partially_refunded', 'disputed'].includes(payment.status)) fail('INVALID_STATE_TRANSITION', 'Only captured payments can be refunded.');
  const snapshot = s.db.must('snapshots', payment.snapshotId);
  const breakdown = computeRefund(snapshot.quote, input.components, refundedByRef(s, payment.id));
  if (breakdown.toCustomer <= 0) return null;
  const afterPayout = paidOut(s, payment);
  const threshold = settings(s.db).refundPlatformApprovalThreshold;
  const needsBusinessApproval = input.initiator === 'goodwill' && !input.approvedByRequester;
  const needsPlatformApproval = input.initiator === 'goodwill' && (breakdown.toCustomer > threshold || afterPayout);
  const partial = breakdown.toCustomer < payment.amount - payment.refundedAmount;
  const refund: Refund = {
    id: newId('rfn'),
    paymentId: payment.id,
    businessId: payment.businessId,
    userId: payment.userId,
    checkoutId: payment.checkoutId,
    bookingId: input.bookingId ?? null,
    orderId: input.orderId ?? null,
    registrationId: input.registrationId ?? null,
    amount: breakdown.toCustomer,
    breakdown,
    reason: input.reason,
    initiator: input.initiator,
    requestedBy: s.actor.realUser?.id ?? 'system',
    status: 'requested',
    history: [],
    providerRefundId: null,
    approvals: input.approvedByRequester && s.actor.realUser ? [{ by: s.actor.realUser.id, at: s.now, role: 'business' }] : [],
    needsBusinessApproval,
    needsPlatformApproval,
    afterPayout,
    createdAt: s.now,
    completedAt: null,
    failureReason: null,
    partial,
  };
  s.db.insert('refunds', refund);
  if (needsBusinessApproval || needsPlatformApproval) {
    s.db.update('refunds', refund.id, (r) => transition(REFUND_TRANSITIONS, r, 'pending_approval', s.now, s.actor.realUser?.id ?? 'system', 'Awaiting approval', 'refund'));
    if (needsBusinessApproval) notifyBusiness(s, refund.businessId, 'refunds.approve', { title: 'Refund awaiting approval', body: `${formatPHP(refund.amount)} — ${refund.reason}`, link: '#/biz/payments' });
  } else {
    s.db.update('refunds', refund.id, (r) => transition(REFUND_TRANSITIONS, r, 'approved', s.now, 'policy', 'Within policy — approved automatically', 'refund'));
    submitRefund(s, refund.id);
  }
  return s.db.must('refunds', refund.id);
}

export function submitRefund(s: Svc, refundId: Id): void {
  const refund = s.db.must('refunds', refundId, 'refund');
  const payment = s.db.must('payments', refund.paymentId);
  if (!payment.providerPaymentId) fail('CONFLICT', 'Payment has no provider reference.');
  try {
    const r = provider.createRefund(s, { providerPaymentId: payment.providerPaymentId, amount: refund.amount, externalId: refund.id, idempotencyKey: `refund:${refund.id}:${refund.history.filter((h) => h.to === 'processing').length}` });
    s.db.update('refunds', refund.id, (x) => {
      x.providerRefundId = r.id;
      x.failureReason = null;
      transition(REFUND_TRANSITIONS, x, 'processing', s.now, 'system', 'Submitted to provider', 'refund');
    });
  } catch (e) {
    // Provider outage: keep the approved refund and let the retry job resubmit it.
    s.db.update('refunds', refund.id, (x) => {
      x.failureReason = e instanceof Error ? e.message : 'Provider unavailable';
    });
  }
}

export function onRefundSettled(s: Svc, refundId: Id, ok: boolean, failureCode: string | null): void {
  const refund = s.db.get('refunds', refundId);
  if (!refund || refund.status !== 'processing') return; // idempotent
  if (!ok) {
    s.db.update('refunds', refund.id, (x) => {
      x.failureReason = failureCode ?? 'Refund failed at provider';
      transition(REFUND_TRANSITIONS, x, 'failed', s.now, 'provider', x.failureReason, 'refund');
    });
    notifyBusiness(s, refund.businessId, 'refunds.approve', { title: 'Refund failed', body: `${formatPHP(refund.amount)} could not be returned (${failureCode}). Retry or contact support.`, link: '#/biz/payments' }, 'payment_updates');
    notify(s, refund.userId, 'payment_updates', { title: 'Your refund is delayed', body: `We couldn't complete your ${formatPHP(refund.amount)} refund yet. We'll retry and keep you posted.`, link: '#/app/payments' });
    return;
  }
  const payment = s.db.must('payments', refund.paymentId);
  postJournal(
    s,
    refundJournal(refund.breakdown, refund.businessId, refund.partial, { paymentId: payment.id, refundId: refund.id, ...(refund.bookingId ? { bookingId: refund.bookingId } : {}), ...(refund.orderId ? { orderId: refund.orderId } : {}), ...(refund.registrationId ? { registrationId: refund.registrationId } : {}) }, s.now, `Refund ${formatPHP(refund.amount)} — ${refund.reason}`),
  );
  s.db.update('refunds', refund.id, (x) => {
    x.completedAt = s.now;
    transition(REFUND_TRANSITIONS, x, 'succeeded', s.now, 'provider', 'Refund confirmed by provider', 'refund');
  });
  s.db.update('payments', payment.id, (p) => {
    p.refundedAmount += refund.amount;
    const to = p.refundedAmount >= p.amount ? 'refunded' : 'partially_refunded';
    if (p.status !== to) transition(PAYMENT_TRANSITIONS, p, to, s.now, 'provider', `Refunded ${formatPHP(refund.amount)}`, 'payment');
  });
  const fullyRefunded = s.db.must('payments', payment.id).status === 'refunded';
  if (refund.bookingId) {
    const b = s.db.get('bookings', refund.bookingId);
    if (b && b.status === 'refund_pending') {
      s.db.update('bookings', b.id, (x) => transition(BOOKING_TRANSITIONS, x, fullyRefunded || !refund.partial ? 'refunded' : 'partially_refunded', s.now, 'provider', 'Refund completed', 'booking'));
    }
  }
  if (refund.orderId) {
    const o = s.db.get('orders', refund.orderId);
    if (o && o.status !== 'refunded') {
      const allItems = refund.breakdown.lines.filter((l) => l.ref.startsWith('addon')).length >= o.items.length;
      s.db.update('orders', o.id, (x) => {
        const to = allItems ? 'refunded' : 'partially_refunded';
        if (x.status !== to && (ORDER_TRANSITIONS[x.status] as readonly string[]).includes(to)) transition(ORDER_TRANSITIONS, x, to, s.now, 'provider', 'Refund completed', 'order');
      });
      if (o.status !== 'claimed') returnStock(s, o.businessId, o.items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })), o.id);
    }
  }
  if (refund.registrationId) {
    const r = s.db.get('registrations', refund.registrationId);
    if (r && (REGISTRATION_TRANSITIONS[r.status] as readonly string[]).includes('refunded')) s.db.update('registrations', r.id, (x) => transition(REGISTRATION_TRANSITIONS, x, 'refunded', s.now, 'provider', 'Refund completed', 'registration'));
  }
  notify(s, refund.userId, 'payment_updates', {
    title: `Refund of ${formatPHP(refund.amount)} completed`,
    body: `We returned ${formatPHP(refund.amount)} to ${payment.methodDisplay}. It may take 1–7 banking days to appear, depending on your provider.`,
    link: '#/app/payments',
  });
  if (refund.afterPayout) {
    notifyBusiness(s, refund.businessId, 'finance.view_summary', { title: 'Refund after payout', body: `${formatPHP(refund.breakdown.venueReversal)} will be recovered from your next settlement.`, link: '#/biz/payouts' }, 'payouts');
  }
}

export function approveRefund(s: Svc, input: { businessId?: Id; refundId: Id; note?: string }): Refund {
  const refund = s.db.must('refunds', input.refundId, 'refund');
  if (refund.status !== 'pending_approval') fail('INVALID_STATE_TRANSITION', 'This refund is not waiting for approval.');
  const real = s.actor.realUser;
  if (input.businessId) {
    if (refund.businessId !== input.businessId) fail('NOT_FOUND', 'Refund not found.');
    requireBusiness(s, input.businessId, 'refunds.approve', { write: true });
    if (refund.requestedBy === real?.id) fail('FORBIDDEN', 'A different team member must approve a refund you requested (separation of duties).');
    s.db.update('refunds', refund.id, (x) => {
      x.needsBusinessApproval = false;
      x.approvals.push({ by: real!.id, at: s.now, role: 'business' });
    });
  } else {
    requirePlatform(s, 'platform.refunds.approve', { write: true });
    s.db.update('refunds', refund.id, (x) => {
      x.needsPlatformApproval = false;
      x.approvals.push({ by: real!.id, at: s.now, role: 'platform' });
    });
  }
  const r = s.db.must('refunds', refund.id);
  audit(s, { action: 'refund.approved', targetType: 'refund', targetId: r.id, businessId: r.businessId, summary: `Approved refund ${formatPHP(r.amount)} (${input.businessId ? 'business' : 'platform'} approval)`, reason: input.note ?? null });
  if (!r.needsBusinessApproval && !r.needsPlatformApproval) {
    s.db.update('refunds', r.id, (x) => transition(REFUND_TRANSITIONS, x, 'approved', s.now, real!.id, 'All approvals received', 'refund'));
    submitRefund(s, r.id);
  }
  return s.db.must('refunds', r.id);
}

export function rejectRefund(s: Svc, input: { businessId?: Id; refundId: Id; note: string }): Refund {
  const refund = s.db.must('refunds', input.refundId, 'refund');
  if (refund.status !== 'pending_approval') fail('INVALID_STATE_TRANSITION', 'This refund is not waiting for approval.');
  if (input.businessId) {
    if (refund.businessId !== input.businessId) fail('NOT_FOUND', 'Refund not found.');
    requireBusiness(s, input.businessId, 'refunds.approve', { write: true });
  } else requirePlatform(s, 'platform.refunds.approve', { write: true });
  if (!input.note?.trim()) fail('VALIDATION_FAILED', 'Add a reason for rejecting this refund.', { fields: [{ field: 'note', message: 'Reason is required.' }] });
  s.db.update('refunds', refund.id, (x) => transition(REFUND_TRANSITIONS, x, 'rejected', s.now, s.actor.realUser!.id, input.note, 'refund'));
  if (refund.bookingId) {
    const b = s.db.get('bookings', refund.bookingId);
    if (b?.status === 'refund_pending') {
      // Restore the prior state recorded before the refund request.
      const prior = [...b.history].reverse().find((h) => h.to === 'refund_pending')?.from ?? 'completed';
      s.db.update('bookings', b.id, (x) => {
        x.status = prior;
        x.history.push({ from: 'refund_pending', to: prior, at: s.now, by: s.actor.realUser!.id, reason: 'Refund rejected' });
      });
    }
  }
  audit(s, { action: 'refund.rejected', targetType: 'refund', targetId: refund.id, businessId: refund.businessId, summary: `Rejected refund ${formatPHP(refund.amount)}`, reason: input.note });
  return s.db.must('refunds', refund.id);
}

export function retryRefund(s: Svc, input: { businessId?: Id; refundId: Id }): Refund {
  const refund = s.db.must('refunds', input.refundId, 'refund');
  if (input.businessId) {
    if (refund.businessId !== input.businessId) fail('NOT_FOUND', 'Refund not found.');
    requireBusiness(s, input.businessId, 'refunds.approve', { write: true });
  } else requirePlatform(s, 'platform.refunds.approve', { write: true });
  if (refund.status !== 'failed' && !(refund.status === 'approved' && refund.failureReason)) fail('INVALID_STATE_TRANSITION', 'Only failed refunds can be retried.');
  submitRefund(s, refund.id);
  audit(s, { action: 'refund.retried', targetType: 'refund', targetId: refund.id, businessId: refund.businessId, summary: `Retried refund ${formatPHP(refund.amount)}` });
  return s.db.must('refunds', refund.id);
}

/** Job: resubmit approved refunds that could not reach the provider. */
export function retryStuckRefunds(s: Svc): number {
  let n = 0;
  for (const r of s.db.filter('refunds', (x) => x.status === 'approved' && !!x.failureReason)) {
    if (settings(s.db).demo.providerOutage) break;
    submitRefund(s, r.id);
    n++;
  }
  return n;
}

export function myRefunds(s: Svc): Refund[] {
  const u = requireUser(s);
  return s.db.filter('refunds', (r) => r.userId === u.id).sort((a, b) => b.createdAt - a.createdAt);
}
