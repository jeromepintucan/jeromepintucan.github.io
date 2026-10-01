/**
 * Append-only double-entry ledger (design doc 09). Journals must balance (debits = credits); corrections are
 * reversing journals, never edits. Venue payable is a liability (credit-normal): a negative balance means the
 * venue owes the platform (e.g. a refund after payout) and is recovered from future settlements.
 */

import { applyRate, divRound, type Centavos } from './money.ts';
import type { Quote } from './pricing.ts';

export type EntryType =
  | 'customer_charge'
  | 'booking_base'
  | 'product_amount'
  | 'event_amount'
  | 'discount'
  | 'tax'
  | 'gateway_fee'
  | 'platform_commission'
  | 'venue_payable'
  | 'refund'
  | 'partial_refund'
  | 'chargeback'
  | 'dispute_adjustment'
  | 'manual_adjustment'
  | 'payout'
  | 'failed_payout'
  | 'reversed_payout';

export const ACCOUNTS = {
  providerClearing: 'platform:provider_clearing',
  commissionRevenue: 'platform:commission_revenue',
  feeRecovery: 'platform:gateway_fee_recovery',
  feeExpense: 'platform:gateway_fee_expense',
  promotionsExpense: 'platform:promotions_expense',
  chargebackLosses: 'platform:chargeback_losses',
  adjustments: 'platform:adjustments',
  withholdingPayable: 'platform:withholding_tax_payable',
} as const;

export function venuePayable(businessId: string): string {
  return `venue:${businessId}:payable`;
}

export interface LedgerLine {
  account: string;
  direction: 'debit' | 'credit';
  amount: Centavos;
  entryType: EntryType;
  businessId?: string;
  memo?: string;
}

export type JournalType =
  | 'payment_captured'
  | 'provider_fee'
  | 'refund'
  | 'chargeback'
  | 'dispute_won'
  | 'payout'
  | 'payout_failed'
  | 'payout_reversed'
  | 'manual_adjustment';

export interface JournalDraft {
  type: JournalType;
  businessId: string | null;
  description: string;
  lines: LedgerLine[];
  refs: { paymentId?: string; bookingId?: string; orderId?: string; registrationId?: string; refundId?: string; payoutId?: string; disputeId?: string; checkoutId?: string; approvalId?: string };
  occurredAt: number;
  currency: 'PHP';
}

export class UnbalancedJournalError extends Error {}

export function totals(lines: readonly LedgerLine[]): { debit: Centavos; credit: Centavos } {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amount) || l.amount < 0) throw new UnbalancedJournalError(`line amount must be a non-negative integer (${l.amount})`);
    if (l.direction === 'debit') debit += l.amount;
    else credit += l.amount;
  }
  return { debit, credit };
}

export function assertBalanced(j: Pick<JournalDraft, 'lines' | 'description'>): void {
  const t = totals(j.lines);
  if (t.debit !== t.credit) throw new UnbalancedJournalError(`Journal "${j.description}" is unbalanced: debits ${t.debit} ≠ credits ${t.credit}`);
}

function line(account: string, direction: 'debit' | 'credit', amount: Centavos, entryType: EntryType, businessId?: string, memo?: string): LedgerLine | null {
  if (amount === 0) return null;
  return { account, direction, amount, entryType, ...(businessId ? { businessId } : {}), ...(memo ? { memo } : {}) };
}

function compact(lines: (LedgerLine | null)[]): LedgerLine[] {
  return lines.filter((l): l is LedgerLine => l !== null);
}

/** Journal for a verified captured payment, built from the immutable quote snapshot. */
export function captureJournal(q: Quote, businessId: string, refs: JournalDraft['refs'], occurredAt: number, description: string): JournalDraft {
  const vp = venuePayable(businessId);
  const court = q.items.filter((i) => i.kind === 'court').reduce((a, i) => a + i.amount, 0);
  const products = q.items.filter((i) => i.kind === 'addon').reduce((a, i) => a + i.amount, 0);
  const events = q.items.filter((i) => i.kind === 'event').reduce((a, i) => a + i.amount, 0);
  const d = q.discount;
  const lines = compact([
    line(ACCOUNTS.providerClearing, 'debit', q.total, 'customer_charge', undefined, 'Customer payment received at provider'),
    line(vp, 'credit', court, 'booking_base', businessId, 'Court booking base'),
    line(vp, 'credit', products, 'product_amount', businessId, 'Products'),
    line(vp, 'credit', events, 'event_amount', businessId, 'Event registration'),
    d && d.fundedBy === 'venue' ? line(vp, 'debit', d.amount, 'discount', businessId, `Venue-funded promo ${d.code}`) : null,
    d && d.fundedBy === 'platform' ? line(ACCOUNTS.promotionsExpense, 'debit', d.amount, 'discount', undefined, `Platform-funded promo ${d.code}`) : null,
    line(ACCOUNTS.feeRecovery, 'credit', q.fee?.customerAmount ?? 0, 'gateway_fee', undefined, 'Payment processing fee paid by customer'),
    line(vp, 'debit', q.commission.amount, 'platform_commission', businessId, `Commission ${q.commission.label}`),
    line(ACCOUNTS.commissionRevenue, 'credit', q.commission.amount, 'platform_commission', undefined, 'Platform commission'),
  ]);
  // Exclusive VAT collected on behalf of the venue (venue remits): credited to the venue.
  if (q.taxAdded) lines.push({ account: vp, direction: 'credit', amount: q.taxAdded, entryType: 'tax', businessId, memo: 'VAT collected for venue' });
  const j: JournalDraft = { type: 'payment_captured', businessId, description, lines, refs, occurredAt, currency: 'PHP' };
  assertBalanced(j);
  return j;
}

/** Actual provider fee as reported by the provider (may differ from the checkout estimate). */
export function providerFeeJournal(actualFee: Centavos, businessId: string, refs: JournalDraft['refs'], occurredAt: number, description: string): JournalDraft {
  const j: JournalDraft = {
    type: 'provider_fee',
    businessId,
    description,
    lines: compact([line(ACCOUNTS.feeExpense, 'debit', actualFee, 'gateway_fee', undefined, 'Provider fee'), line(ACCOUNTS.providerClearing, 'credit', actualFee, 'gateway_fee')]),
    refs,
    occurredAt,
    currency: 'PHP',
  };
  assertBalanced(j);
  return j;
}

export interface RefundComponents {
  /** Items refunded with the refunded share of each (ppm of the item). */
  items: { ref: string; sharePpm: number }[];
  refundGatewayFee: boolean;
}

export interface RefundBreakdown {
  toCustomer: Centavos;
  venueReversal: Centavos;
  commissionReversal: Centavos;
  platformDiscountReversal: Centavos;
  feeRefund: Centavos;
  lines: { ref: string; label: string; customerAmount: Centavos }[];
}

/**
 * Proportional refund of a captured quote: the customer gets back the share of what they paid for each item,
 * commission and platform-funded discounts reverse by the same share, and the venue's reversal is derived so
 * the journal balances exactly.
 */
export function computeRefund(q: Quote, components: RefundComponents, alreadyRefundedByRef: Record<string, Centavos> = {}): RefundBreakdown {
  let toCustomer = 0;
  let commissionReversal = 0;
  let platformDiscountReversal = 0;
  let venueReversal = 0;
  const lines: RefundBreakdown['lines'] = [];
  const disc = (ref: string) => q.discount?.allocations.find((a) => a.ref === ref)?.amount ?? 0;
  const tax = (ref: string) => q.taxAllocations?.find((a) => a.ref === ref)?.amount ?? 0;
  for (const c of components.items) {
    const item = q.items.find((i) => i.ref === c.ref);
    if (!item || c.sharePpm <= 0) continue;
    const share = BigInt(Math.min(1_000_000, c.sharePpm));
    const itemDiscount = disc(item.ref);
    const itemTax = tax(item.ref);
    const paid = item.amount - itemDiscount + itemTax;
    let customerPart = Number(divRound(BigInt(paid) * share, 1_000_000n));
    const already = alreadyRefundedByRef[item.ref] ?? 0;
    customerPart = Math.max(0, Math.min(customerPart, paid - already));
    if (customerPart === 0) continue;
    const ratio = paid > 0 ? customerPart / paid : 0;
    const grossPart = Math.round(item.amount * ratio);
    const discPart = Math.round(itemDiscount * ratio);
    const taxPart = customerPart - grossPart + discPart; // derived so the customer part is exact
    const platformDisc = q.discount?.fundedBy === 'platform' ? discPart : 0;
    const venueDisc = q.discount?.fundedBy === 'venue' ? discPart : 0;
    let commissionPart = 0;
    if (item.commissionable && q.commission.base > 0) {
      const venueBaseForItem = item.amount - (q.discount?.fundedBy === 'venue' ? itemDiscount : 0);
      commissionPart = Math.round(applyRate(venueBaseForItem, q.commission.ratePpm) * ratio);
    }
    platformDiscountReversal += platformDisc;
    commissionReversal += commissionPart;
    venueReversal += grossPart - venueDisc - commissionPart + taxPart;
    toCustomer += customerPart;
    lines.push({ ref: item.ref, label: item.label, customerAmount: customerPart });
  }
  const feeRefund = components.refundGatewayFee ? Math.max(0, (q.fee?.customerAmount ?? 0) - (alreadyRefundedByRef['fee'] ?? 0)) : 0;
  if (feeRefund > 0) {
    toCustomer += feeRefund;
    lines.push({ ref: 'fee', label: 'Payment processing fee', customerAmount: feeRefund });
  }
  return { toCustomer, venueReversal, commissionReversal, platformDiscountReversal, feeRefund, lines };
}

export function refundJournal(b: RefundBreakdown, businessId: string, partial: boolean, refs: JournalDraft['refs'], occurredAt: number, description: string): JournalDraft {
  const vp = venuePayable(businessId);
  const type: EntryType = partial ? 'partial_refund' : 'refund';
  const lines = compact([
    line(ACCOUNTS.providerClearing, 'credit', b.toCustomer, type, undefined, 'Refund to original payment method'),
    b.venueReversal >= 0 ? line(vp, 'debit', b.venueReversal, type, businessId, 'Venue share of refund') : line(vp, 'credit', -b.venueReversal, type, businessId, 'Venue share of refund'),
    line(ACCOUNTS.commissionRevenue, 'debit', b.commissionReversal, 'platform_commission', undefined, 'Commission reversed'),
    line(ACCOUNTS.promotionsExpense, 'credit', b.platformDiscountReversal, 'discount', undefined, 'Platform promo reversed'),
    line(ACCOUNTS.feeRecovery, 'debit', b.feeRefund, 'gateway_fee', undefined, 'Processing fee refunded'),
  ]);
  const j: JournalDraft = { type: 'refund', businessId, description, lines, refs, occurredAt, currency: 'PHP' };
  assertBalanced(j);
  return j;
}

export function payoutJournal(amount: Centavos, businessId: string, refs: JournalDraft['refs'], occurredAt: number, description: string): JournalDraft {
  const j: JournalDraft = {
    type: 'payout',
    businessId,
    description,
    lines: compact([line(venuePayable(businessId), 'debit', amount, 'payout', businessId, 'Settled to venue'), line(ACCOUNTS.providerClearing, 'credit', amount, 'payout')]),
    refs,
    occurredAt,
    currency: 'PHP',
  };
  assertBalanced(j);
  return j;
}

export function payoutFailedJournal(amount: Centavos, businessId: string, refs: JournalDraft['refs'], occurredAt: number, description: string): JournalDraft {
  const j: JournalDraft = {
    type: 'payout_failed',
    businessId,
    description,
    lines: compact([line(ACCOUNTS.providerClearing, 'debit', amount, 'failed_payout'), line(venuePayable(businessId), 'credit', amount, 'failed_payout', businessId, 'Payout returned — will retry')]),
    refs,
    occurredAt,
    currency: 'PHP',
  };
  assertBalanced(j);
  return j;
}

/**
 * Chargeback lost: the full captured amount leaves provider clearing. The venue bears its net share,
 * commission is reversed, and the platform absorbs the processing fee portion plus the provider's dispute fee.
 */
export function chargebackJournal(q: Quote, businessId: string, disputeFee: Centavos, refs: JournalDraft['refs'], occurredAt: number, description: string): JournalDraft {
  const vp = venuePayable(businessId);
  const customerFee = q.fee?.customerAmount ?? 0;
  const platformDiscount = q.discount?.fundedBy === 'platform' ? q.discount.amount : 0;
  const lines = compact([
    line(vp, 'debit', q.venueNet, 'chargeback', businessId, 'Venue share of chargeback'),
    line(ACCOUNTS.commissionRevenue, 'debit', q.commission.amount, 'chargeback', undefined, 'Commission reversed'),
    line(ACCOUNTS.feeRecovery, 'debit', customerFee, 'chargeback', undefined, 'Fee recovery reversed'),
    line(ACCOUNTS.promotionsExpense, 'credit', platformDiscount, 'chargeback', undefined, 'Platform promo reversed'),
    line(ACCOUNTS.providerClearing, 'credit', q.total, 'chargeback', undefined, 'Funds returned to cardholder'),
    line(ACCOUNTS.chargebackLosses, 'debit', disputeFee, 'dispute_adjustment', undefined, 'Provider dispute fee'),
    line(ACCOUNTS.providerClearing, 'credit', disputeFee, 'dispute_adjustment'),
  ]);
  const j: JournalDraft = { type: 'chargeback', businessId, description, lines, refs, occurredAt, currency: 'PHP' };
  assertBalanced(j);
  return j;
}

export function adjustmentJournal(amount: Centavos, businessId: string, direction: 'credit_venue' | 'debit_venue', refs: JournalDraft['refs'], occurredAt: number, description: string): JournalDraft {
  const vp = venuePayable(businessId);
  const lines =
    direction === 'credit_venue'
      ? compact([line(ACCOUNTS.adjustments, 'debit', amount, 'manual_adjustment', undefined, description), line(vp, 'credit', amount, 'manual_adjustment', businessId, description)])
      : compact([line(vp, 'debit', amount, 'manual_adjustment', businessId, description), line(ACCOUNTS.adjustments, 'credit', amount, 'manual_adjustment', undefined, description)]);
  const j: JournalDraft = { type: 'manual_adjustment', businessId, description, lines, refs, occurredAt, currency: 'PHP' };
  assertBalanced(j);
  return j;
}

/** Signed balance: debit-normal accounts (assets/expenses) positive on debit; credit-normal positive on credit. */
export function accountBalance(lines: Iterable<LedgerLine>, account: string): Centavos {
  const creditNormal = account.startsWith('venue:') || account === ACCOUNTS.commissionRevenue || account === ACCOUNTS.feeRecovery || account === ACCOUNTS.withholdingPayable;
  let bal = 0;
  for (const l of lines) {
    if (l.account !== account) continue;
    const signed = l.direction === 'debit' ? l.amount : -l.amount;
    bal += creditNormal ? -signed : signed;
  }
  return bal;
}
