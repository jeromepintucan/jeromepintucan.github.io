/**
 * MOCK PAYMENT PROVIDER — a sandbox stand-in for Xendit xenPlatform so the demo runs end to end without any
 * real account, credentials or money. It models the parts the platform depends on:
 *  - hosted payment sessions created on behalf of a venue sub-account (`for-user-id`) with a split rule that
 *    routes the platform amount to the master account;
 *  - asynchronous webhooks carrying a static `x-callback-token` (Xendit's verification model), with
 *    configurable delay, duplicates, drops and failed first delivery;
 *  - an authoritative query API the platform uses to verify every webhook;
 *  - refunds, payouts (sub-account withdrawals), settlement and disputes.
 * Event names are illustrative; the real adapter maps Xendit's actual event names (docs/design/08).
 * PLACEHOLDER: replace with the Xendit adapter once the account, keys and fee contract exist.
 */

import { fail } from '../domain/errors.ts';
import { randomCode } from '../domain/ids.ts';
import { providerFeeOn, type Centavos } from '../domain/money.ts';
import type { PaymentMethodCode } from '../domain/pricing.ts';
import type { ProviderDelivery, ProviderPayment, ProviderSession } from './model.ts';
import { settings, type Svc } from './svc.ts';

export const SANDBOX_CALLBACK_TOKEN = 'sandbox-callback-token-DEMO-ONLY';
export const SETTLEMENT_DELAY_MS = 60 * 60_000; // demo: settle one hour after capture

export const METHOD_LABEL: Record<PaymentMethodCode, string> = {
  gcash: 'GCash',
  maya: 'Maya',
  grabpay: 'GrabPay',
  card: 'Credit / debit card',
  qrph: 'QR Ph',
  online_banking: 'Online banking (BPI / UnionBank)',
};

function pid(prefix: string): string {
  return `${prefix}-${randomCode(20).toLowerCase()}`;
}

function assertAvailable(s: Svc): void {
  if (settings(s.db).demo.providerOutage) fail('PROVIDER_UNAVAILABLE', 'The payment provider is temporarily unavailable. Your hold is kept — please try again shortly.');
}

function webhookDelayMs(s: Svc): number {
  const mode = settings(s.db).demo.webhookMode;
  return mode === 'slow' ? 25_000 : 2_500;
}

export function scheduleWebhook(s: Svc, type: string, data: Record<string, unknown>, delayMs = webhookDelayMs(s)): void {
  const mode = settings(s.db).demo.webhookMode;
  const eventId = pid('evt');
  const payload = { id: eventId, event: type, created: new Date(s.now).toISOString(), business_id: 'sandbox-master', data };
  const base: ProviderDelivery = {
    id: pid('dlv'),
    eventId,
    type,
    payload,
    deliverAt: s.now + delayMs,
    attempts: 0,
    status: mode === 'drop' && type.startsWith('payment') ? 'dropped' : 'pending',
    lastStatusCode: null,
    duplicateOf: null,
  };
  s.db.insert('providerDeliveries', base);
  if (mode === 'duplicate') s.db.insert('providerDeliveries', { ...base, id: pid('dlv'), deliverAt: base.deliverAt + 1_500, duplicateOf: base.id, status: 'pending' });
}

export function createSession(
  s: Svc,
  p: { externalId: string; amount: Centavos; method: PaymentMethodCode; forUserId: string | null; splitPlatformAmount: Centavos; merchantName: string; description: string; expiresAt: number; idempotencyKey: string },
): ProviderSession {
  assertAvailable(s);
  const prior = s.db.get('providerIdempotency', p.idempotencyKey);
  if (prior) return s.db.must('providerSessions', prior.resultId);
  if (p.amount < 100) fail('VALIDATION_FAILED', 'Amount below provider minimum.');
  const session: ProviderSession = {
    id: pid('ps'),
    externalId: p.externalId,
    forUserId: p.forUserId,
    splitPlatformAmount: p.splitPlatformAmount,
    amount: p.amount,
    currency: 'PHP',
    method: p.method,
    merchantName: p.merchantName,
    description: p.description,
    status: 'PENDING',
    paymentId: null,
    createdAt: s.now,
    expiresAt: p.expiresAt,
    idempotencyKey: p.idempotencyKey,
    failureCode: null,
  };
  s.db.insert('providerSessions', session);
  s.db.insert('providerIdempotency', { id: p.idempotencyKey, resultId: session.id });
  return session;
}

/** Authoritative query API (the platform never trusts a redirect or an unverified webhook). */
export function getSession(s: Svc, sessionId: string): ProviderSession | undefined {
  return s.db.get('providerSessions', sessionId);
}

export function getPayment(s: Svc, paymentId: string | null): ProviderPayment | undefined {
  return paymentId ? s.db.get('providerPayments', paymentId) : undefined;
}

function actualFee(s: Svc, method: PaymentMethodCode, amount: Centavos, international: boolean): Centavos {
  const f = settings(s.db).feeSchedules.find((x) => x.method === method);
  const pct = (f?.percentPpm ?? 0) + (international ? 10_000 : 0); // +1% for international cards (illustrative)
  return providerFeeOn(amount, pct, f?.fixed ?? 0);
}

function masked(method: PaymentMethodCode, last4: string): string {
  if (method === 'card') return `Visa •••• ${last4}`;
  if (method === 'qrph') return 'QR Ph (InstaPay)';
  if (method === 'online_banking') return `BPI •••• ${last4}`;
  return `${METHOD_LABEL[method]} •••• ${last4}`;
}

/** Hosted-page customer action: approve. Card numbers never leave the sandbox page; only brand/last4 are kept. */
export function customerApprove(s: Svc, sessionId: string, opts: { last4?: string; international?: boolean } = {}): ProviderSession {
  const session = s.db.must('providerSessions', sessionId, 'payment session');
  if (session.status !== 'PENDING') fail('CONFLICT', `This payment session is ${session.status.toLowerCase()}.`);
  if (s.now > session.expiresAt) fail('HOLD_EXPIRED', 'This payment session has expired.');
  const fee = actualFee(s, session.method, session.amount, !!opts.international);
  const payment: ProviderPayment = {
    id: pid('py'),
    sessionId,
    externalId: session.externalId,
    amount: session.amount,
    fee,
    method: session.method,
    methodDisplay: masked(session.method, opts.last4 ?? '0001'),
    status: 'SUCCEEDED',
    forUserId: session.forUserId,
    splitPlatformAmount: session.splitPlatformAmount,
    createdAt: s.now,
    refundedAmount: 0,
    settledAt: null,
  };
  s.db.insert('providerPayments', payment);
  s.db.update('providerSessions', sessionId, (x) => {
    x.status = 'COMPLETED';
    x.paymentId = payment.id;
  });
  // Split rule: platform amount to master (the master also bears the provider fee), remainder to the venue sub-account.
  s.db.update('providerMaster', 'master', (m) => {
    m.balance += session.splitPlatformAmount - fee;
  });
  if (session.forUserId && s.db.get('providerSubAccounts', session.forUserId)) {
    s.db.update('providerSubAccounts', session.forUserId, (a) => {
      a.balance += session.amount - session.splitPlatformAmount;
    });
  }
  scheduleWebhook(s, 'payment.succeeded', { payment_id: payment.id, payment_session_id: sessionId, reference_id: session.externalId, amount: session.amount, currency: 'PHP', status: 'SUCCEEDED', channel_code: session.method.toUpperCase() });
  return s.db.must('providerSessions', sessionId);
}

export function customerDecline(s: Svc, sessionId: string, code: 'INSUFFICIENT_BALANCE' | 'CARD_DECLINED' | 'USER_CANCELLED'): ProviderSession {
  const session = s.db.must('providerSessions', sessionId, 'payment session');
  if (session.status !== 'PENDING') fail('CONFLICT', `This payment session is ${session.status.toLowerCase()}.`);
  s.db.update('providerSessions', sessionId, (x) => {
    x.status = code === 'USER_CANCELLED' ? 'CANCELLED' : 'FAILED';
    x.failureCode = code;
  });
  scheduleWebhook(s, 'payment.failed', { payment_session_id: sessionId, reference_id: session.externalId, status: 'FAILED', failure_code: code }, 1_500);
  return s.db.must('providerSessions', sessionId);
}

/** Platform-initiated session cancellation (Xendit supports expiring a session via API). */
export function cancelSession(s: Svc, sessionId: string): void {
  const session = s.db.get('providerSessions', sessionId);
  if (!session || session.status !== 'PENDING') return;
  s.db.update('providerSessions', sessionId, (x) => {
    x.status = 'CANCELLED';
    x.failureCode = 'MERCHANT_CANCELLED';
  });
}

/** Provider-side job: expire unpaid sessions. */
export function expireSessions(s: Svc): number {
  let n = 0;
  for (const session of s.db.filter('providerSessions', (x) => x.status === 'PENDING' && s.now > x.expiresAt)) {
    s.db.update('providerSessions', session.id, (x) => {
      x.status = 'EXPIRED';
    });
    scheduleWebhook(s, 'payment_session.expired', { payment_session_id: session.id, reference_id: session.externalId, status: 'EXPIRED' }, 1_000);
    n++;
  }
  return n;
}

export function settlePayments(s: Svc): number {
  let n = 0;
  for (const p of s.db.filter('providerPayments', (x) => x.settledAt === null && (x.status === 'SUCCEEDED' || x.status === 'PARTIALLY_REFUNDED') && s.now - x.createdAt >= SETTLEMENT_DELAY_MS)) {
    s.db.update('providerPayments', p.id, (x) => {
      x.settledAt = s.now;
    });
    n++;
  }
  return n;
}

export function createRefund(s: Svc, p: { providerPaymentId: string; amount: Centavos; externalId: string; idempotencyKey: string }): { id: string; status: 'PENDING' } {
  assertAvailable(s);
  const prior = s.db.get('providerIdempotency', p.idempotencyKey);
  if (prior) return { id: prior.resultId, status: 'PENDING' };
  const payment = s.db.must('providerPayments', p.providerPaymentId, 'provider payment');
  if (p.amount <= 0 || p.amount > payment.amount - payment.refundedAmount) fail('VALIDATION_FAILED', 'Refund amount exceeds the refundable balance.');
  const demo = settings(s.db).demo;
  const id = pid('rfd');
  s.db.insert('providerRefunds', { id, paymentId: payment.id, externalId: p.externalId, amount: p.amount, status: 'PENDING', createdAt: s.now, completeAt: s.now + 3_000, failureCode: demo.failNextRefund ? 'REFUND_REJECTED_BY_CHANNEL' : null, idempotencyKey: p.idempotencyKey });
  s.db.insert('providerIdempotency', { id: p.idempotencyKey, resultId: id });
  if (demo.failNextRefund) {
    s.db.update('settings', 'platform', (x) => {
      x.demo.failNextRefund = false;
    });
  }
  return { id, status: 'PENDING' };
}

export function processRefunds(s: Svc): number {
  let n = 0;
  for (const r of s.db.filter('providerRefunds', (x) => x.status === 'PENDING' && s.now >= x.completeAt)) {
    const ok = !r.failureCode;
    s.db.update('providerRefunds', r.id, (x) => {
      x.status = ok ? 'SUCCEEDED' : 'FAILED';
    });
    if (ok) {
      const pay = s.db.must('providerPayments', r.paymentId);
      s.db.update('providerPayments', pay.id, (x) => {
        x.refundedAmount += r.amount;
        x.status = x.refundedAmount >= x.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      });
      // Funded from the venue sub-account first; if already withdrawn, the master account covers it.
      const sub = pay.forUserId ? s.db.get('providerSubAccounts', pay.forUserId) : undefined;
      const fromSub = sub ? Math.max(0, Math.min(sub.balance, r.amount)) : 0;
      if (sub && fromSub) {
        s.db.update('providerSubAccounts', sub.id, (a) => {
          a.balance -= fromSub;
        });
      }
      s.db.update('providerMaster', 'master', (m) => {
        m.balance -= r.amount - fromSub;
      });
    }
    scheduleWebhook(s, ok ? 'refund.succeeded' : 'refund.failed', { refund_id: r.id, payment_id: r.paymentId, reference_id: r.externalId, amount: r.amount, status: ok ? 'SUCCEEDED' : 'FAILED', failure_code: r.failureCode }, 1_000);
    n++;
  }
  return n;
}

export function createSubAccount(s: Svc, businessId: string): string {
  const id = pid('sub');
  s.db.insert('providerSubAccounts', { id, businessId, type: 'MANAGED', status: 'LIVE', balance: 0, createdAt: s.now });
  return id;
}

export function createPayout(s: Svc, p: { forUserId: string; amount: Centavos; externalId: string }): { id: string } {
  assertAvailable(s);
  const demo = settings(s.db).demo;
  const id = pid('po');
  s.db.insert('providerPayouts', { id, externalId: p.externalId, forUserId: p.forUserId, amount: p.amount, status: 'PENDING', createdAt: s.now, completeAt: s.now + 4_000, failureCode: demo.failNextPayout ? 'INVALID_DESTINATION_ACCOUNT' : null });
  if (demo.failNextPayout) {
    s.db.update('settings', 'platform', (x) => {
      x.demo.failNextPayout = false;
    });
  }
  return { id };
}

export function processPayouts(s: Svc): number {
  let n = 0;
  for (const p of s.db.filter('providerPayouts', (x) => x.status === 'PENDING' && s.now >= x.completeAt)) {
    const ok = !p.failureCode;
    s.db.update('providerPayouts', p.id, (x) => {
      x.status = ok ? 'SUCCEEDED' : 'FAILED';
    });
    if (ok && p.forUserId && s.db.get('providerSubAccounts', p.forUserId)) {
      s.db.update('providerSubAccounts', p.forUserId, (a) => {
        a.balance -= p.amount;
      });
    }
    scheduleWebhook(s, ok ? 'payout.succeeded' : 'payout.failed', { payout_id: p.id, reference_id: p.externalId, amount: p.amount, status: ok ? 'SUCCEEDED' : 'FAILED', failure_code: p.failureCode }, 1_000);
    n++;
  }
  return n;
}

export function openDispute(s: Svc, providerPaymentId: string, reason: string): string {
  const pay = s.db.must('providerPayments', providerPaymentId, 'provider payment');
  s.db.update('providerPayments', pay.id, (x) => {
    x.status = 'DISPUTED';
  });
  const disputeId = pid('dsp');
  scheduleWebhook(s, 'dispute.created', { dispute_id: disputeId, payment_id: pay.id, reference_id: pay.externalId, amount: pay.amount, reason, status: 'OPEN' }, 1_500);
  return disputeId;
}

export function resolveDispute(s: Svc, providerPaymentId: string, disputeId: string, outcome: 'WON' | 'LOST'): void {
  const pay = s.db.must('providerPayments', providerPaymentId, 'provider payment');
  s.db.update('providerPayments', pay.id, (x) => {
    x.status = outcome === 'WON' ? 'SUCCEEDED' : 'CHARGEBACK';
  });
  if (outcome === 'LOST') {
    s.db.update('providerMaster', 'master', (m) => {
      m.balance -= pay.amount;
    });
  }
  scheduleWebhook(s, outcome === 'WON' ? 'dispute.won' : 'dispute.lost', { dispute_id: disputeId, payment_id: pay.id, reference_id: pay.externalId, amount: pay.amount, status: outcome }, 1_500);
}

export function dueDeliveries(s: Svc): ProviderDelivery[] {
  return s.db.filter('providerDeliveries', (d) => d.status === 'pending' && d.deliverAt <= s.now).sort((a, b) => a.deliverAt - b.deliverAt);
}

export function markDelivery(s: Svc, deliveryId: string, statusCode: number): void {
  s.db.update('providerDeliveries', deliveryId, (d) => {
    d.attempts += 1;
    d.lastStatusCode = statusCode;
    if (statusCode >= 200 && statusCode < 300) d.status = 'delivered';
    else if (d.attempts >= 6) d.status = 'failed';
    else d.deliverAt = s.now + Math.min(60_000, 2_000 * 2 ** d.attempts); // exponential backoff
  });
}
