/** Ledger posting and balances (append-only; see domain/ledger.ts). */

import { accountBalance, assertBalanced, venuePayable, type JournalDraft, type LedgerLine } from '../domain/ledger.ts';
import { newId } from '../domain/ids.ts';
import type { Db } from './store.ts';
import type { Id, LedgerJournal } from './model.ts';
import type { Svc } from './svc.ts';

export function postJournal(s: Svc, draft: JournalDraft): LedgerJournal {
  assertBalanced(draft);
  const seq = s.meta.journalSeq + 1;
  const j: LedgerJournal = { ...draft, id: newId('jnl'), seq, postedAt: s.now };
  s.db.insert('journals', j);
  s.meta.journalSeq = seq;
  return j;
}

export function* allLines(db: Db, filter?: (j: LedgerJournal) => boolean): Generator<LedgerLine & { journalId: Id; occurredAt: number; type: LedgerJournal['type'] }> {
  for (const j of db.all('journals')) {
    if (filter && !filter(j)) continue;
    for (const l of j.lines) yield { ...l, journalId: j.id, occurredAt: j.occurredAt, type: j.type };
  }
}

export function venueBalance(db: Db, businessId: Id, upTo?: number): number {
  return accountBalance(allLines(db, (j) => j.businessId === businessId && (upTo === undefined || j.occurredAt <= upTo)), venuePayable(businessId));
}

export function platformBalance(db: Db, account: string, from?: number, to?: number): number {
  return accountBalance(allLines(db, (j) => (from === undefined || j.occurredAt >= from) && (to === undefined || j.occurredAt < to)), account);
}

export function journalsFor(db: Db, refs: { paymentId?: Id; bookingId?: Id; refundId?: Id; payoutId?: Id; orderId?: Id; registrationId?: Id }): LedgerJournal[] {
  return db
    .filter('journals', (j) =>
      (refs.paymentId !== undefined && j.refs.paymentId === refs.paymentId) ||
      (refs.bookingId !== undefined && j.refs.bookingId === refs.bookingId) ||
      (refs.refundId !== undefined && j.refs.refundId === refs.refundId) ||
      (refs.payoutId !== undefined && j.refs.payoutId === refs.payoutId) ||
      (refs.orderId !== undefined && j.refs.orderId === refs.orderId) ||
      (refs.registrationId !== undefined && j.refs.registrationId === refs.registrationId),
    )
    .sort((a, b) => a.seq - b.seq);
}

/** Sums by entry type for a business over a posting-date window (settlement statement). */
export function statementTotals(db: Db, businessId: Id, from: number, to: number) {
  const vp = venuePayable(businessId);
  const t = { bookingBase: 0, products: 0, events: 0, venueDiscounts: 0, commission: 0, refunds: 0, chargebacks: 0, adjustments: 0, payouts: 0, failedPayouts: 0, vat: 0 };
  for (const l of allLines(db, (j) => j.businessId === businessId && j.occurredAt >= from && j.occurredAt < to)) {
    if (l.account !== vp) continue;
    const signed = l.direction === 'credit' ? l.amount : -l.amount;
    switch (l.entryType) {
      case 'booking_base': t.bookingBase += signed; break;
      case 'product_amount': t.products += signed; break;
      case 'event_amount': t.events += signed; break;
      case 'discount': t.venueDiscounts += signed; break;
      case 'platform_commission': t.commission += signed; break;
      case 'refund':
      case 'partial_refund': t.refunds += signed; break;
      case 'chargeback': t.chargebacks += signed; break;
      case 'manual_adjustment': t.adjustments += signed; break;
      case 'payout': t.payouts += signed; break;
      case 'failed_payout': t.failedPayouts += signed; break;
      case 'tax': t.vat += signed; break;
      default: break;
    }
  }
  const opening = venueBalance(db, businessId, from - 1);
  const closing = venueBalance(db, businessId, to - 1);
  return { ...t, opening, closing };
}
