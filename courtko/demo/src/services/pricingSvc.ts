/**
 * Pricing rules & promotions administration (build step 6). Every change creates a new rule version in
 * `ruleHistory` and an audit entry with before/after values. Save-time validation blocks unresolved ties.
 * Confirmed bookings keep their immutable price snapshot, so edits never change past transactions.
 */

import { fail, invalid, type FieldError } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { formatPHP, formatPpm, pesos } from '../domain/money.ts';
import { customerLines, findRuleConflict, RULE_KIND_LABEL, type PricingRule, type RuleConditions, type RuleEffect, type RuleKind } from '../domain/pricing.ts';
import { isLocalDate, MINUTE } from '../domain/time.ts';
import { buildQuoteSafe, courtPricing, taxProfile } from './checkout.ts';
import type { Id, Promotion } from './model.ts';
import { audit, commissionTermsFor, requireBusiness, requirePlatform, settings, type Svc } from './svc.ts';

export function listPricingRules(s: Svc, input: { businessId: Id; venueId: Id; includeArchived?: boolean }) {
  requireBusiness(s, input.businessId, 'bookings.view', { venueId: input.venueId });
  const venue = s.db.get('venues', input.venueId);
  if (!venue || venue.businessId !== input.businessId) fail('NOT_FOUND', 'Venue not found.');
  const rules = s.db.filter('pricingRules', (r) => r.venueId === venue.id && (input.includeArchived || r.status === 'active')).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  return {
    venue,
    courts: s.db.filter('courts', (c) => c.venueId === venue.id).sort((a, b) => a.sortOrder - b.sortOrder),
    rules,
    history: s.db.filter('ruleHistory', (h) => h.businessId === input.businessId && rules.some((r) => r.id === h.ruleId)).sort((a, b) => b.changedAt - a.changedAt).slice(0, 30),
  };
}

function validateRule(errors: FieldError[], input: { name: string; kind: RuleKind; effect: RuleEffect; conditions: RuleConditions; priority: number; minChargeCentavos?: number }): void {
  if (!input.name?.trim() || input.name.trim().length > 60) errors.push({ field: 'name', message: 'Give the rule a name (up to 60 characters).' });
  if (!(input.kind in RULE_KIND_LABEL)) errors.push({ field: 'kind', message: 'Choose a rule type.' });
  const e = input.effect;
  if (e.type === 'rate' && (!Number.isSafeInteger(e.ratePerHour) || e.ratePerHour < pesos(50) || e.ratePerHour > pesos(20_000))) errors.push({ field: 'ratePerHour', message: 'Hourly rate must be between ₱50 and ₱20,000.' });
  if (e.type === 'adjust_percent' && (!Number.isInteger(e.percentPpm) || e.percentPpm < -900_000 || e.percentPpm > 2_000_000)) errors.push({ field: 'percent', message: 'Adjustment must be between −90% and +200%.' });
  if (e.type === 'adjust_amount' && (!Number.isSafeInteger(e.amountPerHour) || Math.abs(e.amountPerHour) > pesos(5_000))) errors.push({ field: 'amountPerHour', message: 'Adjustment must be within ±₱5,000 per hour.' });
  const c = input.conditions;
  if (c.startMinute !== undefined && (c.startMinute < 0 || c.startMinute >= 1440 || c.startMinute % 15)) errors.push({ field: 'startMinute', message: 'Use a start time on a 15-minute boundary.' });
  if (c.endMinute !== undefined && (c.endMinute <= 0 || c.endMinute > 1440 || c.endMinute % 15)) errors.push({ field: 'endMinute', message: 'Use an end time on a 15-minute boundary.' });
  if (c.dateFrom && !isLocalDate(c.dateFrom)) errors.push({ field: 'dateFrom', message: 'Invalid start date.' });
  if (c.dateTo && !isLocalDate(c.dateTo)) errors.push({ field: 'dateTo', message: 'Invalid end date.' });
  if (c.dateFrom && c.dateTo && c.dateTo < c.dateFrom) errors.push({ field: 'dateTo', message: 'End date must be on or after the start date.' });
  if (c.daysOfWeek && c.daysOfWeek.some((d) => d < 0 || d > 6)) errors.push({ field: 'daysOfWeek', message: 'Invalid day.' });
  if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 100) errors.push({ field: 'priority', message: 'Priority must be 0–100.' });
  if (input.minChargeCentavos !== undefined && (!Number.isSafeInteger(input.minChargeCentavos) || input.minChargeCentavos < 0)) errors.push({ field: 'minCharge', message: 'Invalid minimum charge.' });
}

export function describeRule(r: PricingRule): string {
  const e = r.effect;
  const effect = e.type === 'rate' ? `${formatPHP(e.ratePerHour, { compact: true })}/hr` : e.type === 'adjust_percent' ? `${e.percentPpm >= 0 ? '+' : '−'}${formatPpm(Math.abs(e.percentPpm))}` : `${e.amountPerHour >= 0 ? '+' : '−'}${formatPHP(Math.abs(e.amountPerHour), { compact: true })}/hr`;
  return effect;
}

export function savePricingRule(
  s: Svc,
  input: { businessId: Id; venueId: Id; ruleId?: Id; name: string; kind: RuleKind; courtIds: Id[] | null; effect: RuleEffect; conditions: RuleConditions; priority: number; minChargeCentavos?: number; nonRefundable?: boolean },
) {
  const acc = requireBusiness(s, input.businessId, 'pricing.manage', { venueId: input.venueId, write: true });
  const venue = s.db.get('venues', input.venueId);
  if (!venue || venue.businessId !== input.businessId) fail('NOT_FOUND', 'Venue not found.');
  const errors: FieldError[] = [];
  validateRule(errors, input);
  if (input.courtIds) {
    const valid = new Set(s.db.filter('courts', (c) => c.venueId === venue.id).map((c) => c.id));
    if (!input.courtIds.length || input.courtIds.some((c) => !valid.has(c))) errors.push({ field: 'courtIds', message: 'Choose courts from this venue.' });
  }
  if (errors.length) invalid(errors);
  const existing = input.ruleId ? s.db.get('pricingRules', input.ruleId) : undefined;
  if (input.ruleId && (!existing || existing.venueId !== venue.id)) fail('NOT_FOUND', 'Rule not found.');
  const rule: PricingRule = {
    id: existing?.id ?? newId('prl'),
    businessId: input.businessId,
    venueId: venue.id,
    courtIds: input.courtIds && input.courtIds.length ? input.courtIds : null,
    name: input.name.trim(),
    kind: input.kind,
    effect: input.effect,
    conditions: Object.fromEntries(Object.entries(input.conditions).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))) as RuleConditions,
    priority: input.priority,
    ...(input.minChargeCentavos ? { minChargeCentavos: input.minChargeCentavos } : {}),
    ...(input.nonRefundable ? { nonRefundable: true } : {}),
    status: 'active',
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? s.now,
    createdBy: existing?.createdBy ?? acc.user.id,
    updatedAt: s.now,
    updatedBy: acc.user.id,
  };
  const clash = findRuleConflict(rule, s.db.filter('pricingRules', (r) => r.venueId === venue.id));
  if (clash) fail('CONFLICT', `"${clash.name}" has the same priority and overlapping days/times. Give one of them a different priority.`, { fields: [{ field: 'priority', message: `Conflicts with "${clash.name}".` }] });
  if (existing) {
    const before = { ...existing };
    s.db.update('pricingRules', existing.id, (x) => Object.assign(x, rule));
    s.db.insert('ruleHistory', { id: newId('rlh'), ruleId: rule.id, businessId: rule.businessId, version: rule.version, change: 'updated', snapshot: rule, changedBy: acc.user.id, changedAt: s.now });
    audit(s, { action: 'pricing.rule_updated', targetType: 'pricing_rule', targetId: rule.id, businessId: rule.businessId, summary: `Updated "${rule.name}" (v${rule.version}): ${describeRule(before)} → ${describeRule(rule)}`, before, after: rule });
  } else {
    s.db.insert('pricingRules', rule);
    s.db.insert('ruleHistory', { id: newId('rlh'), ruleId: rule.id, businessId: rule.businessId, version: 1, change: 'created', snapshot: rule, changedBy: acc.user.id, changedAt: s.now });
    audit(s, { action: 'pricing.rule_created', targetType: 'pricing_rule', targetId: rule.id, businessId: rule.businessId, summary: `Created "${rule.name}" ${describeRule(rule)} (priority ${rule.priority})`, after: rule });
  }
  return s.db.must('pricingRules', rule.id);
}

export function archivePricingRule(s: Svc, input: { businessId: Id; ruleId: Id }) {
  const r = s.db.get('pricingRules', input.ruleId);
  if (!r || r.businessId !== input.businessId) fail('NOT_FOUND', 'Rule not found.');
  const acc = requireBusiness(s, input.businessId, 'pricing.manage', { venueId: r.venueId, write: true });
  const isOnlyBase = r.effect.type === 'rate' && !r.courtIds && !Object.keys(r.conditions).length && s.db.count('pricingRules', (x) => x.venueId === r.venueId && x.status === 'active' && x.effect.type === 'rate' && !x.courtIds && !Object.keys(x.conditions).length) === 1;
  if (isOnlyBase) fail('CONFLICT', "You can't archive the only standard rate — every time slot needs a price.");
  s.db.update('pricingRules', r.id, (x) => {
    x.status = 'archived';
    x.version += 1;
    x.updatedAt = s.now;
    x.updatedBy = acc.user.id;
  });
  s.db.insert('ruleHistory', { id: newId('rlh'), ruleId: r.id, businessId: r.businessId, version: r.version, change: 'archived', snapshot: s.db.must('pricingRules', r.id), changedBy: acc.user.id, changedAt: s.now });
  audit(s, { action: 'pricing.rule_archived', targetType: 'pricing_rule', targetId: r.id, businessId: r.businessId, summary: `Archived "${r.name}"` });
  return { ok: true };
}

/** What would a player pay? Shows per-segment rules so owners can check their configuration. */
export function simulatePrice(s: Svc, input: { businessId: Id; venueId: Id; courtId: Id; startMs: number; durationMinutes: number; method?: string }) {
  requireBusiness(s, input.businessId, 'bookings.view', { venueId: input.venueId });
  const venue = s.db.get('venues', input.venueId);
  const court = s.db.get('courts', input.courtId);
  if (!venue || venue.businessId !== input.businessId || !court || court.venueId !== venue.id) fail('NOT_FOUND', 'Court not found.');
  const business = s.db.must('businesses', venue.businessId);
  const pricing = courtPricing(s.db, venue, court, input.startMs, input.startMs + input.durationMinutes * MINUTE);
  const fee = input.method ? settings(s.db).feeSchedules.find((f) => f.method === input.method && f.enabled) ?? null : null;
  const { terms } = commissionTermsFor(s.db, business.id, s.now);
  const quote = buildQuoteSafe({ court: { pricing, ref: 'court', label: court.name }, tax: taxProfile(s, business), fee, commission: terms });
  const rules = new Map(s.db.filter('pricingRules', (r) => r.venueId === venue.id).map((r) => [r.id, r]));
  return {
    quote,
    lines: customerLines(quote),
    segments: pricing.segments.map((seg) => ({ ...seg, rateRule: rules.get(seg.rateRuleId)?.name ?? '', adjustRule: seg.adjustRuleId ? rules.get(seg.adjustRuleId)?.name ?? '' : null })),
  };
}

// ---------------------------------------------------------------- promotions

export function listPromotions(s: Svc, input: { businessId?: Id }) {
  if (input.businessId) {
    requireBusiness(s, input.businessId, 'bookings.view');
    return s.db.filter('promotions', (p) => p.businessId === input.businessId).sort((a, b) => b.createdAt - a.createdAt);
  }
  requirePlatform(s, 'platform.promotions.manage');
  return s.db.filter('promotions', (p) => p.businessId === null).sort((a, b) => b.createdAt - a.createdAt);
}

export function savePromotion(
  s: Svc,
  input: { businessId?: Id; promotionId?: Id; code: string; name: string; type: 'percent' | 'fixed'; value: number; maxDiscount?: number; minSpend?: number; appliesTo: Promotion['appliesTo']; validFrom: number; validTo: number; usageLimit: number | null; perUserLimit: number | null; status?: Promotion['status'] },
) {
  const actor = input.businessId ? requireBusiness(s, input.businessId, 'promotions.manage', { write: true }).user : requirePlatform(s, 'platform.promotions.manage', { write: true });
  const errors: FieldError[] = [];
  const code = (input.code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(code)) errors.push({ field: 'code', message: 'Use 4–16 letters or numbers.' });
  if (!input.name?.trim()) errors.push({ field: 'name', message: 'Name is required.' });
  if (input.type === 'percent' && (input.value <= 0 || input.value > 500_000)) errors.push({ field: 'value', message: 'Percent discount must be between 0% and 50%.' });
  if (input.type === 'fixed' && (input.value <= 0 || input.value > pesos(2_000))) errors.push({ field: 'value', message: 'Fixed discount must be between ₱0.01 and ₱2,000.' });
  if (!(input.validTo > input.validFrom)) errors.push({ field: 'validTo', message: 'End must be after start.' });
  if (errors.length) invalid(errors);
  const existing = input.promotionId ? s.db.get('promotions', input.promotionId) : undefined;
  if (input.promotionId && (!existing || existing.businessId !== (input.businessId ?? null))) fail('NOT_FOUND', 'Promotion not found.');
  const promo: Promotion = {
    id: existing?.id ?? newId('prm'),
    code,
    name: input.name.trim(),
    businessId: input.businessId ?? null,
    venueIds: null,
    type: input.type,
    value: input.value,
    ...(input.maxDiscount ? { maxDiscount: input.maxDiscount } : {}),
    ...(input.minSpend ? { minSpend: input.minSpend } : {}),
    fundedBy: input.businessId ? 'venue' : 'platform',
    appliesTo: input.appliesTo,
    validFrom: input.validFrom,
    validTo: input.validTo,
    usageLimit: input.usageLimit,
    perUserLimit: input.perUserLimit,
    usedCount: existing?.usedCount ?? 0,
    status: input.status ?? existing?.status ?? 'active',
    createdBy: existing?.createdBy ?? actor.id,
    createdAt: existing?.createdAt ?? s.now,
  };
  if (existing) s.db.update('promotions', existing.id, (x) => Object.assign(x, promo));
  else s.db.insert('promotions', promo);
  audit(s, { action: existing ? 'promotion.updated' : 'promotion.created', targetType: 'promotion', targetId: promo.id, businessId: promo.businessId, summary: `${existing ? 'Updated' : 'Created'} promo ${code} (${promo.type === 'percent' ? formatPpm(promo.value) : formatPHP(promo.value)} off, funded by ${promo.fundedBy})`, after: promo });
  return s.db.must('promotions', promo.id);
}
