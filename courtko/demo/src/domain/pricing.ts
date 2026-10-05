/**
 * Pricing engine (design doc 01 §PRC, brief §4).
 *
 * Court time is priced in 15-minute slices. For each slice the winning RATE rule sets the hourly rate and the
 * winning ADJUSTMENT rule (if any) modifies it. Winner = highest priority, then court-specific over
 * venue-wide, then most recently updated. Adjustments do not stack. The exact total (centavo-minutes) is
 * rounded once, then allocated back to display segments so lines always add up.
 *
 * `buildQuote` produces the immutable snapshot stored with every booking: customer lines, discount
 * (with funding source), VAT, gateway fee, commission, venue net and platform revenue.
 */

import { allocate, applyRate, divRound, grossUpFee, includedTax, providerFeeOn, sum, type Centavos, type Ppm } from './money.ts';
import { formatMinuteOfDay, localParts, MINUTE, type LocalDate } from './time.ts';

export type RuleKind =
  | 'base'
  | 'peak'
  | 'off_peak'
  | 'weekend'
  | 'holiday'
  | 'date_override'
  | 'seasonal'
  | 'promotional'
  | 'member'
  | 'event'
  | 'custom';

export const RULE_KIND_LABEL: Record<RuleKind, string> = {
  base: 'Standard rate',
  peak: 'Peak',
  off_peak: 'Off-peak',
  weekend: 'Weekend',
  holiday: 'Holiday',
  date_override: 'Date override',
  seasonal: 'Seasonal',
  promotional: 'Promotional',
  member: 'Member rate',
  event: 'Event rate',
  custom: 'Custom',
};

export type RuleEffect =
  | { type: 'rate'; ratePerHour: Centavos }
  | { type: 'adjust_percent'; percentPpm: number }
  | { type: 'adjust_amount'; amountPerHour: Centavos };

export interface RuleConditions {
  daysOfWeek?: number[];
  startMinute?: number;
  endMinute?: number;
  dateFrom?: LocalDate;
  dateTo?: LocalDate;
  holidaysOnly?: boolean;
  segment?: 'member';
}

export interface PricingRule {
  id: string;
  businessId: string;
  venueId: string;
  courtIds: string[] | null;
  /** Sport-specific rate (doc 24 CR-D05). null = every sport. */
  sports?: string[] | null;
  name: string;
  kind: RuleKind;
  effect: RuleEffect;
  conditions: RuleConditions;
  priority: number;
  minChargeCentavos?: Centavos;
  nonRefundable?: boolean;
  status: 'active' | 'archived';
  version: number;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
}

export interface SliceContext {
  date: LocalDate;
  dow: number;
  minute: number;
  isHoliday: boolean;
  segment: 'standard' | 'member';
}

function inTimeWindow(minute: number, start?: number, end?: number): boolean {
  if (start === undefined && end === undefined) return true;
  const s = start ?? 0;
  const e = end ?? 1440;
  if (s === e) return true;
  if (s < e) return minute >= s && minute < e;
  return minute >= s || minute < e; // wraps past midnight
}

export function ruleMatches(rule: PricingRule, courtId: string, ctx: SliceContext, sport?: string): boolean {
  if (rule.status !== 'active') return false;
  if (rule.courtIds && !rule.courtIds.includes(courtId)) return false;
  if (rule.sports?.length && (!sport || !rule.sports.includes(sport))) return false;
  const c = rule.conditions;
  if (c.daysOfWeek && c.daysOfWeek.length && !c.daysOfWeek.includes(ctx.dow)) return false;
  if (!inTimeWindow(ctx.minute, c.startMinute, c.endMinute)) return false;
  if (c.dateFrom && ctx.date < c.dateFrom) return false;
  if (c.dateTo && ctx.date > c.dateTo) return false;
  if (c.holidaysOnly && !ctx.isHoliday) return false;
  if (c.segment && c.segment !== ctx.segment) return false;
  return true;
}

/** Specificity: court-specific > sport-specific > venue-wide. */
export function ruleSpecificity(r: PricingRule): number {
  return r.courtIds ? 2 : r.sports?.length ? 1 : 0;
}

function outranks(a: PricingRule, b: PricingRule): boolean {
  if (a.priority !== b.priority) return a.priority > b.priority;
  const sa = ruleSpecificity(a);
  const sb = ruleSpecificity(b);
  if (sa !== sb) return sa > sb;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return a.id < b.id;
}

function pickWinner(rules: PricingRule[]): PricingRule | null {
  let best: PricingRule | null = null;
  for (const r of rules) if (!best || outranks(r, best)) best = r;
  return best;
}

export interface CourtSegment {
  startMs: number;
  endMs: number;
  minutes: number;
  ratePerHour: Centavos;
  rateRuleId: string;
  adjustRuleId: string | null;
  label: string;
  amount: Centavos;
}

export interface CourtPricing {
  segments: CourtSegment[];
  subtotal: Centavos;
  minChargeAdjustment: Centavos;
  total: Centavos;
  nonRefundable: boolean;
  ruleIds: string[];
}

export class PricingError extends Error {}

export function effectiveRate(rateRule: PricingRule, adjust: PricingRule | null): Centavos {
  if (rateRule.effect.type !== 'rate') throw new PricingError('winning rate rule must set a rate');
  let rate = rateRule.effect.ratePerHour;
  if (adjust) {
    if (adjust.effect.type === 'adjust_percent') rate = Number(divRound(BigInt(rate) * BigInt(1_000_000 + adjust.effect.percentPpm), 1_000_000n));
    else if (adjust.effect.type === 'adjust_amount') rate = rate + adjust.effect.amountPerHour;
  }
  return Math.max(0, rate);
}

export function priceCourtTime(input: {
  rules: readonly PricingRule[];
  courtId: string;
  courtName: string;
  startMs: number;
  endMs: number;
  offsetMin: number;
  holidays: ReadonlySet<LocalDate>;
  segment?: 'standard' | 'member';
  sport?: string;
}): CourtPricing {
  const SLICE = 15;
  if (input.endMs <= input.startMs) throw new PricingError('end must be after start');
  if ((input.endMs - input.startMs) % (SLICE * MINUTE) !== 0) throw new PricingError('duration must be a multiple of 15 minutes');
  const rateRules = input.rules.filter((r) => r.effect.type === 'rate');
  const adjustRules = input.rules.filter((r) => r.effect.type !== 'rate');
  type Raw = { startMs: number; endMs: number; rate: number; rateRule: PricingRule; adjust: PricingRule | null };
  const raw: Raw[] = [];
  for (let t = input.startMs; t < input.endMs; t += SLICE * MINUTE) {
    const p = localParts(t, input.offsetMin);
    const ctx: SliceContext = { date: p.date, dow: p.dow, minute: p.minute, isHoliday: input.holidays.has(p.date), segment: input.segment ?? 'standard' };
    const rateRule = pickWinner(rateRules.filter((r) => ruleMatches(r, input.courtId, ctx, input.sport)));
    if (!rateRule) throw new PricingError(`No rate is configured for ${input.courtName} at ${formatMinuteOfDay(p.minute)} on ${p.date}.`);
    const adjust = pickWinner(adjustRules.filter((r) => ruleMatches(r, input.courtId, ctx, input.sport)));
    raw.push({ startMs: t, endMs: t + SLICE * MINUTE, rate: effectiveRate(rateRule, adjust), rateRule, adjust });
  }
  // merge contiguous slices with identical pricing
  const merged: { startMs: number; endMs: number; rate: number; rateRule: PricingRule; adjust: PricingRule | null }[] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && last.rate === s.rate && last.rateRule.id === s.rateRule.id && (last.adjust?.id ?? null) === (s.adjust?.id ?? null)) last.endMs = s.endMs;
    else merged.push({ ...s });
  }
  const exact = merged.map((m) => BigInt(m.rate) * BigInt((m.endMs - m.startMs) / MINUTE));
  const exactTotal = exact.reduce((a, b) => a + b, 0n);
  const subtotal = Number(divRound(exactTotal, 60n));
  const amounts = allocate(subtotal, exact.map((e) => Number(e)));
  const segments: CourtSegment[] = merged.map((m, i) => ({
    startMs: m.startMs,
    endMs: m.endMs,
    minutes: (m.endMs - m.startMs) / MINUTE,
    ratePerHour: m.rate,
    rateRuleId: m.rateRule.id,
    adjustRuleId: m.adjust?.id ?? null,
    label: m.adjust ? `${m.rateRule.name} · ${m.adjust.name}` : m.rateRule.name,
    amount: amounts[i]!,
  }));
  const winners = new Map<string, PricingRule>();
  for (const s of raw) {
    winners.set(s.rateRule.id, s.rateRule);
    if (s.adjust) winners.set(s.adjust.id, s.adjust);
  }
  const minCharge = Math.max(0, ...[...winners.values()].map((r) => r.minChargeCentavos ?? 0));
  const minChargeAdjustment = Math.max(0, minCharge - subtotal);
  return {
    segments,
    subtotal,
    minChargeAdjustment,
    total: subtotal + minChargeAdjustment,
    nonRefundable: [...winners.values()].some((r) => r.nonRefundable),
    ruleIds: [...winners.keys()].sort(),
  };
}

/** Save-time conflict check: an unresolved tie (same priority and scope, overlapping conditions) is rejected. */
export function findRuleConflict(candidate: PricingRule, existing: readonly PricingRule[]): PricingRule | null {
  const sameClass = (r: PricingRule) => (r.effect.type === 'rate') === (candidate.effect.type === 'rate');
  const overlapsDays = (a?: number[], b?: number[]) => !a?.length || !b?.length || a.some((d) => b.includes(d));
  const windowSet = (c: RuleConditions) => {
    const set = new Set<number>();
    for (let m = 0; m < 1440; m += 15) if (inTimeWindow(m, c.startMinute, c.endMinute)) set.add(m);
    return set;
  };
  const overlapsDates = (a: RuleConditions, b: RuleConditions) => (a.dateFrom ?? '0000') <= (b.dateTo ?? '9999') && (b.dateFrom ?? '0000') <= (a.dateTo ?? '9999');
  const overlapsCourts = (a: string[] | null, b: string[] | null) => !a || !b || a.some((c) => b.includes(c));
  const cw = windowSet(candidate.conditions);
  for (const r of existing) {
    if (r.id === candidate.id || r.status !== 'active' || r.venueId !== candidate.venueId || !sameClass(r)) continue;
    if (r.priority !== candidate.priority || ruleSpecificity(r) !== ruleSpecificity(candidate)) continue;
    if (!overlapsCourts(r.courtIds, candidate.courtIds)) continue;
    if (!overlapsCourts(r.sports?.length ? r.sports : null, candidate.sports?.length ? candidate.sports : null)) continue;
    if (!overlapsDays(r.conditions.daysOfWeek, candidate.conditions.daysOfWeek)) continue;
    if (!overlapsDates(r.conditions, candidate.conditions)) continue;
    if ((r.conditions.holidaysOnly ?? false) !== (candidate.conditions.holidaysOnly ?? false)) continue;
    if ((r.conditions.segment ?? null) !== (candidate.conditions.segment ?? null)) continue;
    const rw = windowSet(r.conditions);
    if ([...cw].some((m) => rw.has(m))) return r;
  }
  return null;
}

// ---------------------------------------------------------------- quote

export type PaymentMethodCode = 'gcash' | 'maya' | 'grabpay' | 'card' | 'qrph' | 'online_banking';

export interface FeeSchedule {
  method: PaymentMethodCode;
  label: string;
  percentPpm: Ppm;
  fixed: Centavos;
  passThrough: boolean;
  /** When set, pass-through is locked off for a compliance reason (e.g. QR Ph P2M customer fees). */
  passThroughLockedReason?: string;
  enabled: boolean;
}

export interface CommissionTerms {
  ratePpm: Ppm;
  source: 'global' | 'agreement';
  agreementId?: string;
  appliesToProducts: boolean;
  appliesToEvents: boolean;
  label: string;
}

export interface TaxProfile {
  vatRegistered: boolean;
  pricesIncludeVat: boolean;
  vatPpm: Ppm;
}

export interface PromoApplication {
  promotionId: string;
  code: string;
  label: string;
  type: 'percent' | 'fixed';
  value: number;
  maxDiscount?: Centavos;
  fundedBy: 'venue' | 'platform';
  appliesTo: 'court' | 'products' | 'events' | 'all';
}

export interface QuoteItem {
  ref: string;
  kind: 'court' | 'addon' | 'event';
  label: string;
  detail?: string;
  qty: number;
  unitAmount: Centavos;
  amount: Centavos;
  commissionable: boolean;
  taxable: boolean;
  productId?: string;
  variantId?: string;
}

export interface QuoteDiscount {
  promotionId: string;
  code: string;
  label: string;
  amount: Centavos;
  fundedBy: 'venue' | 'platform';
  allocations: { ref: string; amount: Centavos }[];
}

export interface QuoteFee {
  method: PaymentMethodCode;
  label: string;
  customerAmount: Centavos;
  estimatedProviderFee: Centavos;
  passThrough: boolean;
  percentPpm: Ppm;
  fixed: Centavos;
}

export interface Quote {
  version: 1;
  currency: 'PHP';
  items: QuoteItem[];
  courtSegments: CourtSegment[];
  minChargeAdjustment: Centavos;
  subtotal: Centavos;
  discount: QuoteDiscount | null;
  taxIncluded: Centavos;
  taxAdded: Centavos;
  /** Exclusive VAT per item (empty when prices include VAT). */
  taxAllocations: { ref: string; amount: Centavos }[];
  taxLabel: string | null;
  fee: QuoteFee | null;
  total: Centavos;
  commission: { ratePpm: Ppm; base: Centavos; amount: Centavos; source: 'global' | 'agreement'; agreementId?: string; label: string };
  venueNet: Centavos;
  platformRevenue: Centavos;
  nonRefundable: boolean;
  pricingRuleIds: string[];
}

export const MIN_PAYABLE: Centavos = 100;

export function discountFor(promo: PromoApplication, eligible: Centavos): Centavos {
  if (eligible <= 0) return 0;
  let d = promo.type === 'percent' ? applyRate(eligible, promo.value) : Math.min(promo.value, eligible);
  if (promo.maxDiscount !== undefined) d = Math.min(d, promo.maxDiscount);
  return Math.max(0, Math.min(d, eligible));
}

export function buildQuote(input: {
  court?: { pricing: CourtPricing; ref: string; label: string; detail?: string } | null;
  addOns?: { ref: string; productId: string; variantId?: string; label: string; unitAmount: Centavos; qty: number; taxable: boolean }[];
  eventItems?: { ref: string; label: string; detail?: string; amount: Centavos; taxable: boolean }[];
  promo?: PromoApplication | null;
  tax: TaxProfile;
  fee?: FeeSchedule | null;
  commission: CommissionTerms;
}): Quote {
  const items: QuoteItem[] = [];
  if (input.court) {
    const p = input.court.pricing;
    items.push({
      ref: input.court.ref,
      kind: 'court',
      label: input.court.label,
      ...(input.court.detail ? { detail: input.court.detail } : {}),
      qty: 1,
      unitAmount: p.total,
      amount: p.total,
      commissionable: true,
      taxable: true,
    });
  }
  for (const a of input.addOns ?? []) {
    if (!Number.isInteger(a.qty) || a.qty <= 0) throw new PricingError('quantity must be a positive whole number');
    items.push({
      ref: a.ref,
      kind: 'addon',
      label: a.label,
      qty: a.qty,
      unitAmount: a.unitAmount,
      amount: a.unitAmount * a.qty,
      commissionable: input.commission.appliesToProducts,
      taxable: a.taxable,
      productId: a.productId,
      ...(a.variantId ? { variantId: a.variantId } : {}),
    });
  }
  for (const e of input.eventItems ?? []) {
    items.push({ ref: e.ref, kind: 'event', label: e.label, ...(e.detail ? { detail: e.detail } : {}), qty: 1, unitAmount: e.amount, amount: e.amount, commissionable: input.commission.appliesToEvents, taxable: e.taxable });
  }
  const subtotal = sum(items.map((i) => i.amount));

  // discount
  let discount: QuoteDiscount | null = null;
  if (input.promo) {
    const promo = input.promo;
    const eligibleItems = items.filter(
      (i) => promo.appliesTo === 'all' || (promo.appliesTo === 'court' && i.kind === 'court') || (promo.appliesTo === 'products' && i.kind === 'addon') || (promo.appliesTo === 'events' && i.kind === 'event'),
    );
    const eligible = sum(eligibleItems.map((i) => i.amount));
    const amount = discountFor(promo, eligible);
    if (amount > 0) {
      const parts = allocate(amount, eligibleItems.map((i) => i.amount));
      discount = {
        promotionId: promo.promotionId,
        code: promo.code,
        label: promo.label,
        amount,
        fundedBy: promo.fundedBy,
        allocations: eligibleItems.map((i, k) => ({ ref: i.ref, amount: parts[k]! })),
      };
    }
  }
  const discountOf = (ref: string) => discount?.allocations.find((a) => a.ref === ref)?.amount ?? 0;
  const discountAmount = discount?.amount ?? 0;
  if (subtotal - discountAmount < MIN_PAYABLE && subtotal > 0) throw new PricingError('The minimum payable amount is ₱1.00.');

  // tax
  let taxIncluded = 0;
  let taxAdded = 0;
  let taxLabel: string | null = null;
  const taxAllocations: { ref: string; amount: Centavos }[] = [];
  if (input.tax.vatRegistered) {
    const pct = input.tax.vatPpm / 10_000;
    for (const i of items) {
      if (!i.taxable) continue;
      const net = i.amount - discountOf(i.ref);
      if (input.tax.pricesIncludeVat) taxIncluded += includedTax(net, input.tax.vatPpm);
      else {
        const t = applyRate(net, input.tax.vatPpm);
        taxAdded += t;
        if (t) taxAllocations.push({ ref: i.ref, amount: t });
      }
    }
    taxLabel = input.tax.pricesIncludeVat ? `VAT (${pct}%, included)` : `VAT (${pct}%)`;
  }

  const netBeforeFee = subtotal - discountAmount + taxAdded;
  let fee: QuoteFee | null = null;
  let customerFee = 0;
  if (input.fee) {
    const f = input.fee;
    const passThrough = f.passThrough && !f.passThroughLockedReason;
    customerFee = passThrough && netBeforeFee > 0 ? grossUpFee(netBeforeFee, f.percentPpm, f.fixed) : 0;
    const total = netBeforeFee + customerFee;
    fee = {
      method: f.method,
      label: f.label,
      customerAmount: customerFee,
      estimatedProviderFee: total > 0 ? providerFeeOn(total, f.percentPpm, f.fixed) : 0,
      passThrough,
      percentPpm: f.percentPpm,
      fixed: f.fixed,
    };
  }
  const total = netBeforeFee + customerFee;

  // commission
  const venueFunded = discount?.fundedBy === 'venue' ? discount : null;
  const commissionableBase = sum(items.filter((i) => i.commissionable).map((i) => i.amount - (venueFunded ? discountOf(i.ref) : 0)));
  const commissionAmount = applyRate(commissionableBase, input.commission.ratePpm);
  const venueGross = subtotal;
  const venueFundedDiscount = venueFunded ? venueFunded.amount : 0;
  const platformFundedDiscount = discount?.fundedBy === 'platform' ? discount.amount : 0;
  // Venue net includes exclusive VAT collected on the venue's behalf (the venue remits it).
  const venueNet = venueGross - venueFundedDiscount - commissionAmount + taxAdded;
  const platformRevenue = commissionAmount - platformFundedDiscount + customerFee - (fee?.estimatedProviderFee ?? 0);

  return {
    version: 1,
    currency: 'PHP',
    items,
    courtSegments: input.court?.pricing.segments ?? [],
    minChargeAdjustment: input.court?.pricing.minChargeAdjustment ?? 0,
    subtotal,
    discount,
    taxIncluded,
    taxAdded,
    taxAllocations,
    taxLabel,
    fee,
    total,
    commission: {
      ratePpm: input.commission.ratePpm,
      base: commissionableBase,
      amount: commissionAmount,
      source: input.commission.source,
      ...(input.commission.agreementId ? { agreementId: input.commission.agreementId } : {}),
      label: input.commission.label,
    },
    venueNet,
    platformRevenue,
    nonRefundable: input.court?.pricing.nonRefundable ?? false,
    pricingRuleIds: input.court?.pricing.ruleIds ?? [],
  };
}

/** Customer-facing breakdown lines (funding source of discounts is never shown to players). */
export function customerLines(q: Quote): { label: string; detail?: string; amount: Centavos; kind: string; informational?: boolean }[] {
  const lines: { label: string; detail?: string; amount: Centavos; kind: string; informational?: boolean }[] = [];
  for (const i of q.items) lines.push({ label: i.label, ...(i.detail ? { detail: i.detail } : {}), amount: i.amount, kind: i.kind });
  if (q.discount) lines.push({ label: `Promo ${q.discount.code}`, detail: q.discount.label, amount: -q.discount.amount, kind: 'discount' });
  if (q.taxAdded) lines.push({ label: q.taxLabel ?? 'VAT', amount: q.taxAdded, kind: 'tax' });
  if (q.fee) lines.push({ label: 'Payment processing fee', detail: q.fee.passThrough ? q.fee.label : `${q.fee.label} · covered by CourtKo`, amount: q.fee.customerAmount, kind: 'fee' });
  if (q.taxIncluded) lines.push({ label: q.taxLabel ?? 'VAT included', amount: q.taxIncluded, kind: 'tax_included', informational: true });
  return lines;
}

export interface PromoDefinition {
  id: string;
  code: string;
  name: string;
  businessId: string | null;
  venueIds: string[] | null;
  type: 'percent' | 'fixed';
  value: number;
  maxDiscount?: Centavos;
  minSpend?: Centavos;
  fundedBy: 'venue' | 'platform';
  appliesTo: 'court' | 'products' | 'events' | 'all';
  validFrom: number;
  validTo: number;
  usageLimit: number | null;
  perUserLimit: number | null;
  usedCount: number;
  status: 'active' | 'paused' | 'archived';
}

/** Validates a promo for a cart; returns the application or a player-safe reason. */
export function evaluatePromotion(
  promo: PromoDefinition | undefined,
  ctx: { now: number; businessId: string; venueId: string; subtotal: Centavos; userRedemptions: number; reservedCount: number },
): { ok: true; application: PromoApplication } | { ok: false; reason: string } {
  if (!promo || promo.status !== 'active') return { ok: false, reason: "This code isn't valid." };
  if (ctx.now < promo.validFrom || ctx.now > promo.validTo) return { ok: false, reason: 'This code has expired or is not yet active.' };
  if (promo.businessId && promo.businessId !== ctx.businessId) return { ok: false, reason: "This code isn't valid at this venue." };
  if (promo.venueIds && !promo.venueIds.includes(ctx.venueId)) return { ok: false, reason: "This code isn't valid at this venue." };
  if (promo.minSpend && ctx.subtotal < promo.minSpend) return { ok: false, reason: 'Your booking does not meet the minimum spend for this code.' };
  if (promo.usageLimit !== null && promo.usedCount + ctx.reservedCount >= promo.usageLimit) return { ok: false, reason: 'This code has reached its usage limit.' };
  if (promo.perUserLimit !== null && ctx.userRedemptions >= promo.perUserLimit) return { ok: false, reason: "You've already used this code." };
  return {
    ok: true,
    application: {
      promotionId: promo.id,
      code: promo.code,
      label: promo.name,
      type: promo.type,
      value: promo.value,
      ...(promo.maxDiscount !== undefined ? { maxDiscount: promo.maxDiscount } : {}),
      fundedBy: promo.fundedBy,
      appliesTo: promo.appliesTo,
    },
  };
}
