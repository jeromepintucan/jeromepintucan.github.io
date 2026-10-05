/**
 * Payment verification pipeline (design doc 08):
 *   webhook → constant-time x-callback-token check → dedupe by provider event id (unique constraint)
 *   → RE-QUERY the provider for the authoritative status → idempotent state transition → ledger → fulfillment.
 * A browser redirect is never treated as proof of payment; the return page only triggers the same
 * server-side provider query. A reconciliation job heals missed webhooks.
 */

import { fail } from '../domain/errors.ts';
import { canonicalJson, sha256Hex, timingSafeEqual } from '../domain/crypto.ts';
import { newId } from '../domain/ids.ts';
import { captureJournal, providerFeeJournal, ACCOUNTS } from '../domain/ledger.ts';
import { formatPHP } from '../domain/money.ts';
import { PAYMENT_TRANSITIONS, transition } from '../domain/state.ts';
import { fulfillCheckout, onPaymentAttemptFailed, bookingSummary } from './checkout.ts';
import { journalsFor, platformBalance, postJournal } from './ledgerSvc.ts';
import type { Id, Payment, ProviderPayment } from './model.ts';
import * as provider from './provider.ts';
import { callProvider } from './gateway.ts';
import { onRefundSettled } from './refunds.ts';
import { onPayoutSettled } from './payouts.ts';
import { onDisputeCreated, onDisputeResolved } from './disputes.ts';
import { ConstraintViolation } from './store.ts';
import { audit, displayName, notify, pageOf, requireBusiness, requirePlatform, requireUser, requireWritable, securityEvent, type Svc } from './svc.ts';

import { paymentFailure } from '../domain/paymentFailures.ts';

export function handleProviderWebhook(s: Svc, input: { headers: Record<string, string>; body: { id: string; event: string; data: Record<string, unknown> } }): { status: number; result: string } {
  const token = input.headers['x-callback-token'] ?? '';
  const digest = sha256Hex(canonicalJson(input.body));
  if (!timingSafeEqual(token, provider.SANDBOX_CALLBACK_TOKEN)) {
    s.db.insert('webhookEvents', { id: newId('whk'), provider: 'xendit_sandbox', providerEventId: `rejected:${newId('x')}`, type: String(input.body?.event ?? 'unknown'), receivedAt: s.now, processedAt: s.now, status: 'rejected', tokenValid: false, payloadDigest: digest, note: 'Invalid x-callback-token', deliveries: 1 });
    securityEvent(s, { type: 'webhook_token_invalid', severity: 'critical', userId: null, businessId: null, detail: `Webhook with invalid verification token rejected (${String(input.body?.event ?? 'unknown')})` });
    return { status: 401, result: 'rejected: invalid verification token' };
  }
  const eventId = String(input.body.id);
  const existing = s.db.find('webhookEvents', (w) => w.provider === 'xendit_sandbox' && w.providerEventId === eventId);
  if (existing) {
    s.db.update('webhookEvents', existing.id, (w) => {
      w.deliveries += 1;
      w.note = `${w.note} · duplicate delivery ignored`.replace(/^ · /, '');
    });
    return { status: 200, result: 'duplicate ignored (idempotent)' };
  }
  const row = { id: newId('whk'), provider: 'xendit_sandbox' as const, providerEventId: eventId, type: input.body.event, receivedAt: s.now, processedAt: null as number | null, status: 'processed' as const, tokenValid: true, payloadDigest: digest, note: '', deliveries: 1 };
  try {
    s.db.insert('webhookEvents', row);
  } catch (e) {
    if (e instanceof ConstraintViolation) return { status: 200, result: 'duplicate ignored (unique constraint)' };
    throw e;
  }
  const data = input.body.data ?? {};
  const ref = String(data['reference_id'] ?? '');
  let note = '';
  switch (input.body.event) {
    case 'payment.succeeded':
    case 'payment.failed':
    case 'payment_session.expired': {
      const r = syncPayment(s, ref, 'webhook');
      note = `Verified with provider query → ${r}`;
      break;
    }
    case 'refund.succeeded':
    case 'refund.failed': {
      const pr = s.db.get('providerRefunds', String(data['refund_id'] ?? ''));
      onRefundSettled(s, ref, pr?.status === 'SUCCEEDED', pr?.failureCode ?? null);
      note = `Refund ${pr?.status ?? 'unknown'} (verified)`;
      break;
    }
    case 'payout.succeeded':
    case 'payout.failed': {
      const pp = s.db.get('providerPayouts', String(data['payout_id'] ?? ''));
      onPayoutSettled(s, ref, pp?.status === 'SUCCEEDED', pp?.failureCode ?? null);
      note = `Payout ${pp?.status ?? 'unknown'} (verified)`;
      break;
    }
    case 'dispute.created':
      onDisputeCreated(s, ref, String(data['dispute_id']), String(data['reason'] ?? 'Chargeback'));
      note = 'Dispute opened';
      break;
    case 'dispute.won':
    case 'dispute.lost':
      onDisputeResolved(s, String(data['dispute_id']), input.body.event === 'dispute.won' ? 'won' : 'lost');
      note = `Dispute ${input.body.event === 'dispute.won' ? 'won' : 'lost'}`;
      break;
    default:
      note = 'Unhandled event type (ignored)';
  }
  s.db.update('webhookEvents', row.id, (w) => {
    w.processedAt = s.now;
    w.note = note;
  });
  return { status: 200, result: note };
}

/** Authoritative status check against the provider; idempotent. */
export function syncPayment(s: Svc, paymentId: Id, via: 'webhook' | 'reconciliation' | 'return_check'): 'captured' | 'failed' | 'expired' | 'pending' | 'review' | 'noop' {
  const payment = s.db.get('payments', paymentId);
  if (!payment) return 'noop';
  if (payment.review && !payment.review.resolvedAt) return 'review';
  const session = provider.getSession(s, payment.providerSessionId);
  if (!session) return 'noop';
  if (session.status === 'COMPLETED') {
    const pp = provider.getPayment(s, session.paymentId);
    if (pp && pp.status !== 'FAILED') {
      return captureFromProvider(s, payment, pp, via) ? 'captured' : 'review';
    }
  }
  if (session.status === 'FAILED' || session.status === 'CANCELLED') {
    if (payment.status === 'pending') onPaymentAttemptFailed(s, payment.id, paymentFailure(session.failureCode).title, session.failureCode);
    return 'failed';
  }
  if (session.status === 'EXPIRED') {
    if (payment.status === 'pending') s.db.update('payments', payment.id, (p) => {
      p.failureCode = 'SESSION_EXPIRED';
      p.failureReason = paymentFailure('SESSION_EXPIRED').title;
      transition(PAYMENT_TRANSITIONS, p, 'expired', s.now, 'provider', 'Payment session expired', 'payment');
    });
    return 'expired';
  }
  return 'pending';
}

/** Returns false when the payment was put on hold for review instead of being captured. */
function captureFromProvider(s: Svc, payment: Payment, pp: ProviderPayment, via: 'webhook' | 'reconciliation' | 'return_check'): boolean {
  if (['captured', 'partially_refunded', 'refunded', 'disputed', 'chargeback'].includes(payment.status)) return true; // idempotent
  if (pp.amount !== payment.amount) {
    // Never fulfil on a mismatched amount. Hold for review and acknowledge the webhook (no retry storm).
    s.db.update('payments', payment.id, (p) => {
      p.review = { reason: 'amount_mismatch', providerAmount: pp.amount, providerPaymentId: pp.id, detectedAt: s.now, resolvedAt: null, resolution: null };
      p.providerPaymentId = pp.id;
    });
    securityEvent(s, { type: 'payment_amount_mismatch', severity: 'critical', userId: null, businessId: payment.businessId, detail: `Amount mismatch for ${payment.id}: provider ${formatPHP(pp.amount)} vs expected ${formatPHP(payment.amount)} — held for review, not fulfilled` });
    notify(s, payment.userId, 'payment_updates', { title: 'We are checking your payment', body: `The payment provider reported a different amount than your checkout (${formatPHP(pp.amount)} vs ${formatPHP(payment.amount)}). Our team is reviewing it — if it can't be confirmed you'll get a full refund.`, link: '#/app/payments' });
    return false;
  }
  const late = payment.status !== 'pending';
  s.db.update('payments', payment.id, (p) => {
    p.providerPaymentId = pp.id;
    p.actualProviderFee = pp.fee;
    p.methodDisplay = pp.methodDisplay;
    p.capturedAt = s.now;
    p.confirmedVia = via;
    transition(PAYMENT_TRANSITIONS, p, 'captured', s.now, 'provider', late ? `Late capture reported by provider (${via})` : `Capture verified via ${via.replace('_', ' ')}`, 'payment');
  });
  const checkout = s.db.must('checkouts', payment.checkoutId);
  const snap = s.db.must('snapshots', payment.snapshotId);
  const refs = { paymentId: payment.id, checkoutId: checkout.id, ...(checkout.bookingId ? { bookingId: checkout.bookingId } : {}), ...(checkout.orderId ? { orderId: checkout.orderId } : {}), ...(checkout.registrationId ? { registrationId: checkout.registrationId } : {}) };
  postJournal(s, captureJournal(snap.quote, payment.businessId, refs, s.now, `Payment captured ${formatPHP(payment.amount)} (${pp.methodDisplay})`));
  if (pp.fee > 0) postJournal(s, providerFeeJournal(pp.fee, payment.businessId, refs, s.now, `Provider fee for ${payment.id}`));
  fulfillCheckout(s, checkout.id, payment.id);
  return true;
}

/**
 * Resolve an amount-mismatch review (platform finance, MFA). The provider payment is refunded in full to the
 * customer because the platform never captured it in the ledger; the checkout is not fulfilled.
 */
export function resolveAmountMismatch(s: Svc, input: { paymentId: Id; note: string }) {
  requirePlatform(s, 'platform.refunds.approve', { write: true });
  const p = s.db.get('payments', input.paymentId);
  if (!p || !p.review || p.review.resolvedAt) fail('NOT_FOUND', 'No open amount review for this payment.');
  if ((input.note ?? '').trim().length < 5) fail('VALIDATION_FAILED', 'Add a note for the audit log.', { fields: [{ field: 'note', message: 'Note is required.' }] });
  const pp = s.db.must('providerPayments', p.review.providerPaymentId, 'provider payment');
  const r = callProvider(s, 'create_refund', { method: p.method, businessId: p.businessId }, () => provider.createRefund(s, { providerPaymentId: pp.id, amount: pp.amount - pp.refundedAmount, externalId: `review:${p.id}`, idempotencyKey: `review:${p.id}` }));
  s.db.update('payments', p.id, (x) => {
    x.review = { ...x.review!, resolvedAt: s.now, resolution: `Refunded ${formatPHP(pp.amount)} in full (provider refund ${r.id}). ${input.note.trim()}` };
  });
  audit(s, { action: 'payment.review_resolved', targetType: 'payment', targetId: p.id, businessId: p.businessId, summary: `Amount mismatch: refunded provider payment ${formatPHP(pp.amount)} in full`, reason: input.note.trim() });
  notify(s, p.userId, 'payment_updates', { title: 'Payment refunded', body: `We couldn't confirm your payment, so ${formatPHP(pp.amount)} is being refunded in full. Sorry for the trouble — you can book again any time.`, link: '#/app/payments' });
  return { refunded: pp.amount };
}

/** Job: pending payments older than a minute are checked against the provider (heals missed webhooks). */
export function reconcilePending(s: Svc): number {
  let n = 0;
  for (const p of s.db.filter('payments', (x) => x.status === 'pending' && !x.review && s.now - x.createdAt > 60_000)) {
    const r = syncPayment(s, p.id, 'reconciliation');
    if (r === 'captured') {
      securityEvent(s, { type: 'reconciliation_healed', severity: 'info', userId: null, businessId: p.businessId, detail: `Reconciliation confirmed ${p.id} without a webhook (missed/late webhook healed)` });
      n++;
    }
  }
  return n;
}

export function verifyCheckoutPayment(s: Svc, input: { checkoutId: Id }): { result: string } {
  requireWritable(s);
  const u = requireUser(s);
  const checkout = s.db.get('checkouts', input.checkoutId);
  if (!checkout || checkout.userId !== u.id) fail('NOT_FOUND', 'Checkout not found.');
  const latest = checkout.paymentIds.map((id) => s.db.get('payments', id)).filter((p): p is Payment => !!p).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!latest) return { result: 'no_payment' };
  return { result: syncPayment(s, latest.id, 'return_check') };
}

export function recheckPayment(s: Svc, input: { businessId: Id; paymentId: Id }): { result: string } {
  requireBusiness(s, input.businessId, 'payments.confirm_status', { write: true });
  const p = s.db.get('payments', input.paymentId);
  if (!p || p.businessId !== input.businessId) fail('NOT_FOUND', 'Payment not found.');
  const result = syncPayment(s, p.id, 'reconciliation');
  audit(s, { action: 'payment.status_rechecked', targetType: 'payment', targetId: p.id, businessId: p.businessId, summary: `Staff re-checked payment status with provider → ${result}` });
  return { result };
}

export interface PaymentView extends Payment {
  summary: string;
  customer: string;
  journals: number;
}

function paymentView(s: Svc, p: Payment): PaymentView {
  const checkout = s.db.get('checkouts', p.checkoutId);
  const booking = checkout?.bookingId ? s.db.get('bookings', checkout.bookingId) : undefined;
  const summary = booking ? `${booking.code} · ${bookingSummary(s.db, booking)}` : checkout?.kind === 'event_registration' ? 'Event registration' : checkout?.kind === 'product_order' ? 'Venue order' : 'Checkout';
  return { ...p, summary, customer: displayName(s.db, p.userId), journals: journalsFor(s.db, { paymentId: p.id }).length };
}

export function myPayments(s: Svc): PaymentView[] {
  const u = requireUser(s);
  return s.db
    .filter('payments', (p) => p.userId === u.id && p.status !== 'created')
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => paymentView(s, p));
}

export function businessPayments(s: Svc, input: { businessId: Id; status?: string; limit?: number; cursor?: string }) {
  requireBusiness(s, input.businessId, 'payments.view');
  const rows = s.db
    .filter('payments', (p) => p.businessId === input.businessId && p.status !== 'created' && (!input.status || p.status === input.status))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => paymentView(s, p));
  return pageOf(rows, input.limit ?? 50, input.cursor);
}

export function paymentDetail(s: Svc, input: { businessId?: Id; paymentId: Id }) {
  const p = s.db.get('payments', input.paymentId);
  if (input.businessId) {
    requireBusiness(s, input.businessId, 'payments.view');
    if (!p || p.businessId !== input.businessId) fail('NOT_FOUND', 'Payment not found.');
  } else {
    requirePlatform(s, 'platform.transactions.view');
    if (!p) fail('NOT_FOUND', 'Payment not found.');
  }
  return {
    payment: paymentView(s, p),
    snapshot: s.db.get('snapshots', p.snapshotId) ?? null,
    journals: journalsFor(s.db, { paymentId: p.id }),
    refunds: s.db.filter('refunds', (r) => r.paymentId === p.id).sort((a, b) => a.createdAt - b.createdAt),
    webhooks: s.db.filter('webhookEvents', (w) => w.note.includes(p.id) || false),
    providerSession: s.db.get('providerSessions', p.providerSessionId) ?? null,
  };
}

// ---------------------------------------------------------------- reconciliation (SuperAdmin)

export interface ReconRow {
  paymentId: Id | null;
  providerPaymentId: string;
  businessId: Id | null;
  providerStatus: string;
  internalStatus: string | null;
  amount: number;
  issue: 'matched' | 'fee_variance' | 'missing_capture' | 'amount_mismatch' | 'refund_mismatch' | 'unknown_reference';
  detail: string;
}

export function reconciliationReport(s: Svc) {
  requirePlatform(s, 'platform.transactions.view');
  const rows: ReconRow[] = [];
  for (const pp of s.db.all('providerPayments')) {
    const p = s.db.get('payments', pp.externalId);
    if (!p) {
      rows.push({ paymentId: null, providerPaymentId: pp.id, businessId: null, providerStatus: pp.status, internalStatus: null, amount: pp.amount, issue: 'unknown_reference', detail: 'Provider payment has no matching internal payment' });
      continue;
    }
    let issue: ReconRow['issue'] = 'matched';
    let detail = 'Matched';
    if (!['captured', 'partially_refunded', 'refunded', 'disputed', 'chargeback'].includes(p.status)) {
      issue = 'missing_capture';
      detail = 'Provider captured this payment but the platform has not confirmed it (missed webhook)';
    } else if (pp.amount !== p.amount) {
      issue = 'amount_mismatch';
      detail = `Provider ${formatPHP(pp.amount)} vs platform ${formatPHP(p.amount)}`;
    } else if (pp.refundedAmount !== p.refundedAmount) {
      issue = 'refund_mismatch';
      detail = `Provider refunded ${formatPHP(pp.refundedAmount)} vs platform ${formatPHP(p.refundedAmount)} (refund in flight?)`;
    } else if (p.actualProviderFee !== null && p.actualProviderFee !== p.estimatedProviderFee) {
      issue = 'fee_variance';
      detail = `Fee estimate ${formatPHP(p.estimatedProviderFee)} vs actual ${formatPHP(p.actualProviderFee)} (${formatPHP(p.actualProviderFee - p.estimatedProviderFee, { signed: true })})`;
    }
    rows.push({ paymentId: p.id, providerPaymentId: pp.id, businessId: p.businessId, providerStatus: pp.status, internalStatus: p.status, amount: pp.amount, issue, detail });
  }
  const providerTotal = s.db.all('providerSubAccounts').reduce((a, x) => a + x.balance, 0) + (s.db.get('providerMaster', 'master')?.balance ?? 0);
  const ledgerClearing = platformBalance(s.db, ACCOUNTS.providerClearing);
  const counts = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.issue] = (acc[r.issue] ?? 0) + 1), acc), {});
  return { rows: rows.sort((a, b) => (a.issue === 'matched' ? 1 : 0) - (b.issue === 'matched' ? 1 : 0)), counts, providerTotal, ledgerClearing, balanced: providerTotal === ledgerClearing };
}

export function healPayment(s: Svc, input: { paymentId: Id }): { result: string } {
  requirePlatform(s, 'platform.reconciliation.run', { write: true });
  const result = syncPayment(s, input.paymentId, 'reconciliation');
  audit(s, { action: 'reconciliation.healed', targetType: 'payment', targetId: input.paymentId, summary: `Reconciliation re-queried provider → ${result}` });
  return { result };
}

export function runReconciliation(s: Svc): { healed: number } {
  requirePlatform(s, 'platform.reconciliation.run', { write: true });
  let healed = 0;
  for (const pp of s.db.all('providerPayments')) {
    const p = s.db.get('payments', pp.externalId);
    if (p && !['captured', 'partially_refunded', 'refunded', 'disputed', 'chargeback'].includes(p.status) && syncPayment(s, p.id, 'reconciliation') === 'captured') healed++;
  }
  audit(s, { action: 'reconciliation.run', targetType: 'platform', targetId: null, summary: `Reconciliation run: ${healed} payment(s) healed` });
  return { healed };
}
