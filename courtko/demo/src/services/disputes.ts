/** Disputes and chargebacks (doc 09). Outcome and fees follow the configurable bearer rules in the ledger. */

import { fail } from '../domain/errors.ts';
import { chargebackJournal } from '../domain/ledger.ts';
import { formatPHP, pesos } from '../domain/money.ts';
import { BOOKING_TRANSITIONS, DISPUTE_TRANSITIONS, PAYMENT_TRANSITIONS, transition } from '../domain/state.ts';
import { newId } from '../domain/ids.ts';
import { postJournal } from './ledgerSvc.ts';
import type { Id } from './model.ts';
import * as provider from './provider.ts';
import { audit, notify, notifyBusiness, requirePlatform, type Svc } from './svc.ts';

const DISPUTE_FEE = pesos(500); // PLACEHOLDER — provider dispute fee per contract

export function onDisputeCreated(s: Svc, paymentId: Id, providerDisputeId: string, reason: string): void {
  const payment = s.db.get('payments', paymentId);
  if (!payment || s.db.find('disputes', (d) => d.providerDisputeId === providerDisputeId)) return;
  const checkout = s.db.get('checkouts', payment.checkoutId);
  const bookingId = checkout?.bookingId ?? null;
  s.db.insert('disputes', {
    id: newId('dsp'),
    paymentId,
    businessId: payment.businessId,
    bookingId,
    amount: payment.amount,
    reason,
    status: 'open',
    history: [],
    openedAt: s.now,
    dueAt: s.now + 7 * 24 * 3_600_000,
    resolvedAt: null,
    evidence: [],
    providerDisputeId,
    disputeFee: DISPUTE_FEE,
  });
  if ((PAYMENT_TRANSITIONS[payment.status] as readonly string[]).includes('disputed')) s.db.update('payments', payment.id, (p) => transition(PAYMENT_TRANSITIONS, p, 'disputed', s.now, 'provider', reason, 'payment'));
  if (bookingId) {
    const b = s.db.get('bookings', bookingId);
    if (b && (BOOKING_TRANSITIONS[b.status] as readonly string[]).includes('disputed')) s.db.update('bookings', b.id, (x) => transition(BOOKING_TRANSITIONS, x, 'disputed', s.now, 'provider', reason, 'booking'));
  }
  notifyBusiness(s, payment.businessId, 'finance.view_summary', { title: 'Payment disputed', body: `A customer disputed ${formatPHP(payment.amount)} (${reason}). CourtKo will respond with booking evidence.`, link: '#/biz/payments' }, 'payment_updates');
}

export function onDisputeResolved(s: Svc, providerDisputeId: string, outcome: 'won' | 'lost'): void {
  const d = s.db.find('disputes', (x) => x.providerDisputeId === providerDisputeId);
  if (!d || d.status === 'won' || d.status === 'lost') return;
  const payment = s.db.must('payments', d.paymentId);
  s.db.update('disputes', d.id, (x) => {
    x.resolvedAt = s.now;
    transition(DISPUTE_TRANSITIONS, x, outcome, s.now, 'provider', `Dispute ${outcome}`, 'dispute');
  });
  if (outcome === 'won') {
    if (payment.status === 'disputed') s.db.update('payments', payment.id, (p) => transition(PAYMENT_TRANSITIONS, p, 'captured', s.now, 'provider', 'Dispute won', 'payment'));
    if (d.bookingId) {
      const b = s.db.get('bookings', d.bookingId);
      if (b?.status === 'disputed') {
        const back = b.endMs < s.now ? 'completed' : 'confirmed';
        s.db.update('bookings', b.id, (x) => transition(BOOKING_TRANSITIONS, x, back, s.now, 'provider', 'Dispute won', 'booking'));
      }
    }
  } else {
    const quote = s.db.must('snapshots', payment.snapshotId).quote;
    postJournal(s, chargebackJournal(quote, payment.businessId, d.disputeFee, { paymentId: payment.id, disputeId: d.id, ...(d.bookingId ? { bookingId: d.bookingId } : {}) }, s.now, `Chargeback lost ${formatPHP(payment.amount)}`));
    if (payment.status === 'disputed') s.db.update('payments', payment.id, (p) => transition(PAYMENT_TRANSITIONS, p, 'chargeback', s.now, 'provider', 'Dispute lost', 'payment'));
    if (d.bookingId) {
      const b = s.db.get('bookings', d.bookingId);
      if (b?.status === 'disputed') s.db.update('bookings', b.id, (x) => transition(BOOKING_TRANSITIONS, x, 'refunded', s.now, 'provider', 'Chargeback — funds returned to cardholder', 'booking'));
    }
  }
  notifyBusiness(s, d.businessId, 'finance.view_summary', { title: `Dispute ${outcome}`, body: outcome === 'won' ? `The ${formatPHP(d.amount)} dispute was resolved in your favor.` : `The ${formatPHP(d.amount)} chargeback was lost; your share is deducted from your balance.`, link: '#/biz/payments' }, 'payment_updates');
  notify(s, payment.userId, 'payment_updates', { title: `Dispute ${outcome === 'won' ? 'closed' : 'resolved'}`, body: `Your dispute about ${formatPHP(d.amount)} has been ${outcome === 'won' ? 'closed by your bank in favor of the merchant' : 'resolved in your favor by your bank'}.` });
}

export function listDisputes(s: Svc) {
  requirePlatform(s, 'platform.disputes.manage');
  return s.db.all('disputes').sort((a, b) => b.openedAt - a.openedAt);
}

export function submitEvidence(s: Svc, input: { disputeId: Id; note: string }) {
  requirePlatform(s, 'platform.disputes.manage', { write: true });
  const d = s.db.must('disputes', input.disputeId, 'dispute');
  if (!input.note?.trim()) fail('VALIDATION_FAILED', 'Describe the evidence you are submitting.', { fields: [{ field: 'note', message: 'Required.' }] });
  s.db.update('disputes', d.id, (x) => {
    x.evidence.push({ note: input.note.trim(), at: s.now, by: s.actor.realUser!.id });
    if (x.status === 'open') transition(DISPUTE_TRANSITIONS, x, 'evidence_submitted', s.now, s.actor.realUser!.id, 'Evidence submitted', 'dispute');
  });
  audit(s, { action: 'dispute.evidence_submitted', targetType: 'dispute', targetId: d.id, businessId: d.businessId, summary: 'Submitted dispute evidence' });
  return s.db.must('disputes', d.id);
}

/** DEMO: ask the sandbox issuer to decide the dispute. */
export function simulateDisputeOutcome(s: Svc, input: { disputeId: Id; outcome: 'WON' | 'LOST' }) {
  requirePlatform(s, 'platform.disputes.manage', { write: true });
  const d = s.db.must('disputes', input.disputeId, 'dispute');
  const p = s.db.must('payments', d.paymentId);
  provider.resolveDispute(s, p.providerPaymentId!, d.providerDisputeId, input.outcome);
  audit(s, { action: 'dispute.outcome_simulated', targetType: 'dispute', targetId: d.id, businessId: d.businessId, summary: `Sandbox issuer decision requested: ${input.outcome}` });
  return { ok: true };
}

/** DEMO: a cardholder disputes a captured payment. */
export function simulateChargeback(s: Svc, input: { paymentId: Id }) {
  requirePlatform(s, 'platform.disputes.manage', { write: true });
  const p = s.db.must('payments', input.paymentId, 'payment');
  if (p.status !== 'captured' || !p.providerPaymentId) fail('INVALID_STATE_TRANSITION', 'Only captured payments can be disputed.');
  provider.openDispute(s, p.providerPaymentId, 'Cardholder does not recognize transaction');
  audit(s, { action: 'dispute.simulated', targetType: 'payment', targetId: p.id, businessId: p.businessId, summary: 'Sandbox chargeback opened for demonstration' });
  return { ok: true };
}
