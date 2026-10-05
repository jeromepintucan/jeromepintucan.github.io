/**
 * Settlement & payouts — Option A (provider split, xenPlatform sub-accounts). The venue's share lands in its
 * sub-account at capture; a daily payout withdraws settled funds to the venue's verified bank account.
 * Payout journal is posted at initiation; a failure posts a reversing `failed_payout` journal.
 * Option B (platform payouts) is modeled in the ledger but disabled pending regulatory review (doc 23).
 */

import { fail } from '../domain/errors.ts';
import { payoutFailedJournal, payoutJournal } from '../domain/ledger.ts';
import { formatPHP } from '../domain/money.ts';
import { PAYOUT_TRANSITIONS, transition } from '../domain/state.ts';
import { newId } from '../domain/ids.ts';
import { postJournal, venueBalance, statementTotals } from './ledgerSvc.ts';
import type { Id, Payout } from './model.ts';
import * as provider from './provider.ts';
import { callProvider } from './gateway.ts';
import { audit, notifyBusiness, pageOf, requireBusiness, requirePlatform, type Svc } from './svc.ts';

function settledUnpaidNet(s: Svc, businessId: Id): { amount: number; paymentIds: Id[] } {
  let amount = 0;
  const paymentIds: Id[] = [];
  for (const p of s.db.filter('payments', (x) => x.businessId === businessId && x.payoutId === null && ['captured', 'partially_refunded', 'refunded'].includes(x.status))) {
    const pp = p.providerPaymentId ? s.db.get('providerPayments', p.providerPaymentId) : undefined;
    if (!pp?.settledAt) continue;
    const quote = s.db.get('snapshots', p.snapshotId)?.quote;
    if (!quote) continue;
    const refunded = s.db.filter('refunds', (r) => r.paymentId === p.id && r.status === 'succeeded').reduce((a, r) => a + r.breakdown.venueReversal, 0);
    amount += quote.venueNet - refunded;
    paymentIds.push(p.id);
  }
  return { amount, paymentIds };
}

export function runPayouts(s: Svc, onlyBusinessId?: Id): Payout[] {
  const created: Payout[] = [];
  if (provider.providerHealth(s).status === 'down') return created; // nothing is created; the next run picks it up
  for (const b of s.db.filter('businesses', (x) => x.status === 'active' && x.payoutAccount.status === 'verified' && (!onlyBusinessId || x.id === onlyBusinessId))) {
    if (s.db.find('payouts', (p) => p.businessId === b.id && p.status === 'processing')) continue;
    const { amount: settled, paymentIds } = settledUnpaidNet(s, b.id);
    const balance = venueBalance(s.db, b.id);
    const amount = Math.min(settled, balance);
    if (paymentIds.length === 0 || amount <= 0) continue;
    const payout: Payout = {
      id: newId('pyo'),
      businessId: b.id,
      amount,
      status: 'scheduled',
      history: [],
      periodEnd: s.now,
      paymentIds,
      destinationMasked: b.payoutAccount.accountMasked ?? 'Bank account',
      providerPayoutId: null,
      createdAt: s.now,
      paidAt: null,
      failureReason: null,
      attempts: 1,
    };
    s.db.insert('payouts', payout);
    const res = callProvider(s, 'create_payout', { businessId: b.id }, () => provider.createPayout(s, { forUserId: b.payoutAccount.providerSubAccountId!, amount, externalId: payout.id }));
    s.db.update('payouts', payout.id, (x) => {
      x.providerPayoutId = res.id;
      transition(PAYOUT_TRANSITIONS, x, 'processing', s.now, 'system', 'Submitted to provider', 'payout');
    });
    for (const pid of paymentIds) s.db.update('payments', pid, (p) => {
      p.payoutId = payout.id;
    });
    postJournal(s, payoutJournal(amount, b.id, { payoutId: payout.id }, s.now, `Payout ${formatPHP(amount)} to ${payout.destinationMasked}`));
    if (settled > balance) {
      notifyBusiness(s, b.id, 'finance.view_payouts', { title: 'Payout reduced by a recovery', body: `${formatPHP(settled - balance)} was withheld to recover an earlier refund or adjustment.`, link: '#/biz/payouts' }, 'payouts');
    }
    created.push(s.db.must('payouts', payout.id));
  }
  return created;
}

export function onPayoutSettled(s: Svc, payoutId: Id, ok: boolean, failureCode: string | null): void {
  const payout = s.db.get('payouts', payoutId);
  if (!payout || payout.status !== 'processing') return;
  if (ok) {
    s.db.update('payouts', payout.id, (x) => {
      x.paidAt = s.now;
      transition(PAYOUT_TRANSITIONS, x, 'paid', s.now, 'provider', 'Paid to bank', 'payout');
    });
    notifyBusiness(s, payout.businessId, 'finance.view_payouts', { title: `Payout sent · ${formatPHP(payout.amount)}`, body: `Sent to ${payout.destinationMasked}. It usually arrives within 1 banking day.`, link: '#/biz/payouts' }, 'payouts');
    return;
  }
  s.db.update('payouts', payout.id, (x) => {
    x.failureReason = failureCode ?? 'Payout failed';
    transition(PAYOUT_TRANSITIONS, x, 'failed', s.now, 'provider', x.failureReason, 'payout');
  });
  postJournal(s, payoutFailedJournal(payout.amount, payout.businessId, { payoutId: payout.id }, s.now, `Payout ${formatPHP(payout.amount)} failed (${failureCode})`));
  for (const pid of payout.paymentIds) s.db.update('payments', pid, (p) => {
    p.payoutId = null;
  });
  notifyBusiness(s, payout.businessId, 'finance.view_payouts', { title: 'Payout failed', body: `${formatPHP(payout.amount)} could not be sent (${failureCode}). Check your payout account; we'll retry after it's fixed.`, link: '#/biz/payouts' }, 'payouts');
}

export function retryPayout(s: Svc, input: { payoutId: Id }): Payout {
  requirePlatform(s, 'platform.payouts.manage', { write: true });
  const payout = s.db.must('payouts', input.payoutId, 'payout');
  if (payout.status !== 'failed') fail('INVALID_STATE_TRANSITION', 'Only failed payouts can be retried.');
  const business = s.db.must('businesses', payout.businessId);
  if (business.payoutAccount.status !== 'verified' || !business.payoutAccount.providerSubAccountId) fail('CONFLICT', 'The payout account must be verified before retrying.');
  const amount = Math.min(payout.amount, venueBalance(s.db, payout.businessId));
  if (amount <= 0) fail('CONFLICT', 'Nothing to pay out — the balance was used to recover refunds.');
  s.db.update('payouts', payout.id, (x) => {
    x.amount = amount;
    x.attempts += 1;
    x.failureReason = null;
    transition(PAYOUT_TRANSITIONS, x, 'scheduled', s.now, s.actor.realUser!.id, 'Retry requested', 'payout');
  });
  const res = callProvider(s, 'create_payout', { businessId: business.id }, () => provider.createPayout(s, { forUserId: business.payoutAccount.providerSubAccountId!, amount, externalId: payout.id }));
  s.db.update('payouts', payout.id, (x) => {
    x.providerPayoutId = res.id;
    transition(PAYOUT_TRANSITIONS, x, 'processing', s.now, 'system', `Resubmitted (attempt ${x.attempts})`, 'payout');
  });
  for (const pid of payout.paymentIds) s.db.update('payments', pid, (p) => {
    p.payoutId = payout.id;
  });
  postJournal(s, payoutJournal(amount, payout.businessId, { payoutId: payout.id }, s.now, `Payout retry ${formatPHP(amount)} to ${payout.destinationMasked}`));
  audit(s, { action: 'payout.retried', targetType: 'payout', targetId: payout.id, businessId: payout.businessId, summary: `Retried failed payout ${formatPHP(amount)}` });
  return s.db.must('payouts', payout.id);
}

export function businessPayouts(s: Svc, input: { businessId: Id }) {
  const acc = requireBusiness(s, input.businessId, 'finance.view_payouts');
  const payouts = s.db.filter('payouts', (p) => p.businessId === input.businessId).sort((a, b) => b.createdAt - a.createdAt);
  const balance = venueBalance(s.db, input.businessId);
  const { amount: settledUnpaid } = settledUnpaidNet(s, input.businessId);
  const pendingSettlement = s.db
    .filter('payments', (p) => p.businessId === input.businessId && p.payoutId === null && p.status === 'captured')
    .filter((p) => !s.db.get('providerPayments', p.providerPaymentId ?? '')?.settledAt)
    .reduce((a, p) => a + (s.db.get('snapshots', p.snapshotId)?.quote.venueNet ?? 0), 0);
  return { payouts, balance, settledUnpaid, pendingSettlement, account: acc.business.payoutAccount, settlementModel: acc.business.settlementModel };
}

export function settlementStatement(s: Svc, input: { businessId: Id; from: number; to: number }) {
  requireBusiness(s, input.businessId, 'finance.view_payouts');
  return statementTotals(s.db, input.businessId, input.from, input.to);
}

export function allPayouts(s: Svc, input: { status?: string; limit?: number; cursor?: string }) {
  requirePlatform(s, 'platform.transactions.view');
  const rows = s.db.filter('payouts', (p) => !input.status || p.status === input.status).sort((a, b) => b.createdAt - a.createdAt);
  return pageOf(rows, input.limit ?? 50, input.cursor);
}
