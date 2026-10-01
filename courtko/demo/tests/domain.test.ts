import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';

import { allocate, applyRate, formatPHP, formatPpm, grossUpFee, includedTax, parsePesoInput, providerFeeOn } from '../src/domain/money.ts';
import { formatMinuteOfDay, localParts, localToInstant, addDays, HOUR, MINUTE } from '../src/domain/time.ts';
import { buildQuote, priceCourtTime, findRuleConflict, evaluatePromotion, type PricingRule, type FeeSchedule, type CommissionTerms } from '../src/domain/pricing.ts';
import { computeAvailability, validateBookingWindow, scheduleFor, DEFAULT_BOOKING_SETTINGS, type Occupancy } from '../src/domain/availability.ts';
import { captureJournal, providerFeeJournal, refundJournal, computeRefund, chargebackJournal, payoutJournal, accountBalance, venuePayable, ACCOUNTS, totals } from '../src/domain/ledger.ts';
import { evaluateCancellation, POLICY_LIBRARY } from '../src/domain/policy.ts';
import { BOOKING_TRANSITIONS, canTransition, transition } from '../src/domain/state.ts';
import { checkGrant, BUSINESS_ROLE_TEMPLATES, ALL_BUSINESS_PERMISSIONS } from '../src/domain/rbac.ts';
import * as c from '../src/domain/crypto.ts';
import { totpAt, verifyTotp } from '../src/domain/totp.ts';
import { normalizePhMobile, passwordProblems } from '../src/domain/validation.ts';

const DATE = '2026-10-05'; // Monday
const OFFSET = 480;
const at = (date: string, hh: number, mm = 0) => localToInstant(date, hh * 60 + mm, OFFSET);

function rule(partial: Partial<PricingRule> & Pick<PricingRule, 'id' | 'name' | 'effect'>): PricingRule {
  return {
    businessId: 'biz_1',
    venueId: 'ven_1',
    courtIds: null,
    kind: 'custom',
    conditions: {},
    priority: 0,
    status: 'active',
    version: 1,
    createdAt: 0,
    createdBy: 'u',
    updatedAt: 0,
    updatedBy: 'u',
    ...partial,
  };
}

const RULES: PricingRule[] = [
  rule({ id: 'r_base', name: 'Standard', kind: 'base', effect: { type: 'rate', ratePerHour: 40_000 }, priority: 0, minChargeCentavos: 40_000 }),
  rule({ id: 'r_peak', name: 'Weekday peak', kind: 'peak', effect: { type: 'rate', ratePerHour: 60_000 }, priority: 20, conditions: { daysOfWeek: [1, 2, 3, 4, 5], startMinute: 17 * 60, endMinute: 22 * 60 } }),
  rule({ id: 'r_weekend', name: 'Weekend', kind: 'weekend', effect: { type: 'rate', ratePerHour: 55_000 }, priority: 10, conditions: { daysOfWeek: [0, 6] } }),
  rule({ id: 'r_early', name: 'Early bird', kind: 'off_peak', effect: { type: 'adjust_percent', percentPpm: -150_000 }, priority: 5, conditions: { daysOfWeek: [1, 2, 3, 4, 5], startMinute: 6 * 60, endMinute: 9 * 60 } }),
  rule({ id: 'r_holiday', name: 'Holiday', kind: 'holiday', effect: { type: 'rate', ratePerHour: 65_000 }, priority: 30, conditions: { holidaysOnly: true } }),
];

const COMMISSION: CommissionTerms = { ratePpm: 50_000, source: 'global', appliesToProducts: false, appliesToEvents: true, label: '5% platform default' };
const QRPH: FeeSchedule = { method: 'qrph', label: 'QR Ph', percentPpm: 0, fixed: 1_500, passThrough: false, passThroughLockedReason: 'BSP QR Ph P2M: no customer fees', enabled: true };
const BANK: FeeSchedule = { method: 'online_banking', label: 'Online banking', percentPpm: 0, fixed: 1_500, passThrough: true, enabled: true };
const GCASH: FeeSchedule = { method: 'gcash', label: 'GCash', percentPpm: 23_000, fixed: 0, passThrough: true, enabled: true };
const NO_VAT = { vatRegistered: false, pricesIncludeVat: true, vatPpm: 120_000 };
const VAT_INCL = { vatRegistered: true, pricesIncludeVat: true, vatPpm: 120_000 };

describe('money', () => {
  test('commission and rounding are integer-exact', () => {
    assert.equal(applyRate(40_000, 50_000), 2_000);
    assert.equal(applyRate(12_345, 50_000), 617); // 617.25 → 617
    assert.equal(applyRate(12_350, 50_000), 618); // 617.5 → 618 (half up)
    assert.equal(includedTax(40_000, 120_000), 4_286);
  });
  test('allocate always sums to total', () => {
    for (const [total, weights] of [[100, [1, 1, 1]], [1_001, [3, 3, 4]], [5, [0, 0, 0]], [99_999, [7, 13, 29, 51]]] as [number, number[]][]) {
      const parts = allocate(total, weights);
      assert.equal(parts.reduce((a, b) => a + b, 0), total);
    }
  });
  test('gross-up fee leaves exactly the net after the provider fee', () => {
    for (const net of [40_000, 12_345, 99_999, 150]) {
      const fee = grossUpFee(net, 23_000, 0);
      assert.equal(net + fee - providerFeeOn(net + fee, 23_000, 0) >= net, true);
      assert.equal(net + fee - 1 - providerFeeOn(net + fee - 1, 23_000, 0) < net, true);
    }
    assert.equal(grossUpFee(40_000, 0, 1_500), 1_500);
  });
  test('formatting and parsing', () => {
    assert.equal(formatPHP(41_500), '₱415.00');
    assert.equal(formatPHP(-2_000), '−₱20.00');
    assert.equal(formatPpm(50_000), '5%');
    assert.equal(formatPpm(47_500), '4.75%');
    assert.equal(parsePesoInput('1,250.50'), 125_050);
    assert.equal(parsePesoInput('12.345'), null);
  });
});

describe('time', () => {
  test('Manila offset and NN/MN labels', () => {
    const t = at(DATE, 18, 30);
    assert.equal(localParts(t, OFFSET).minute, 18 * 60 + 30);
    assert.equal(new Date(t).toISOString(), '2026-10-05T10:30:00.000Z');
    assert.equal(formatMinuteOfDay(720), '12:00 NN');
    assert.equal(formatMinuteOfDay(0), '12:00 MN');
    assert.equal(formatMinuteOfDay(1_110), '6:30 PM');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });
});

describe('pricing engine', () => {
  const price = (start: number, end: number, holidays = new Set<string>()) =>
    priceCourtTime({ rules: RULES, courtId: 'crt_1', courtName: 'Court 1', startMs: start, endMs: end, offsetMin: OFFSET, holidays });

  test('booking spanning off-peak into peak is sliced', () => {
    const p = price(at(DATE, 16), at(DATE, 18));
    assert.equal(p.total, 40_000 + 60_000);
    assert.deepEqual(p.segments.map((s) => s.ratePerHour), [40_000, 60_000]);
  });
  test('adjustment applies on top of the winning rate (early bird −15%)', () => {
    const p = price(at(DATE, 8), at(DATE, 9));
    assert.equal(p.total, 40_000); // 34,000 but minimum charge ₱400 applies
    assert.equal(p.minChargeAdjustment, 6_000);
    const p2 = price(at(DATE, 7), at(DATE, 9));
    assert.equal(p2.total, 68_000);
  });
  test('holiday outranks weekday peak', () => {
    const p = price(at(DATE, 18), at(DATE, 19), new Set([DATE]));
    assert.equal(p.total, 65_000);
  });
  test('weekend rate on Saturday', () => {
    const sat = addDays(DATE, 5);
    assert.equal(price(at(sat, 10), at(sat, 11, 30)).total, 82_500);
  });
  test('equal-priority overlapping rule is rejected at save', () => {
    const clash = rule({ id: 'r_new', name: 'Clash', effect: { type: 'rate', ratePerHour: 1 }, priority: 20, conditions: { daysOfWeek: [3], startMinute: 19 * 60, endMinute: 20 * 60 } });
    assert.equal(findRuleConflict(clash, RULES)?.id, 'r_peak');
    const ok = { ...clash, priority: 25 };
    assert.equal(findRuleConflict(ok, RULES), null);
  });
});

describe('quote, commission and ledger', () => {
  const pricing = priceCourtTime({ rules: RULES, courtId: 'crt_1', courtName: 'Court 1', startMs: at(DATE, 10), endMs: at(DATE, 11), offsetMin: OFFSET, holidays: new Set() });

  test('canonical example: ₱400 + ₱15 fee = ₱415; commission ₱20; venue net ₱380', () => {
    const q = buildQuote({ court: { pricing, ref: 'court', label: 'Court 1' }, tax: NO_VAT, fee: BANK, commission: COMMISSION });
    assert.equal(q.subtotal, 40_000);
    assert.equal(q.fee?.customerAmount, 1_500);
    assert.equal(q.total, 41_500);
    assert.equal(q.commission.amount, 2_000);
    assert.equal(q.venueNet, 38_000);
    assert.equal(q.platformRevenue, 2_000);
    const j = captureJournal(q, 'biz_1', { paymentId: 'pay_1' }, 0, 'capture');
    assert.equal(totals(j.lines).debit, totals(j.lines).credit);
    const fee = providerFeeJournal(1_500, 'biz_1', {}, 0, 'fee');
    const all = [...j.lines, ...fee.lines];
    assert.equal(accountBalance(all, venuePayable('biz_1')), 38_000);
    assert.equal(accountBalance(all, ACCOUNTS.commissionRevenue), 2_000);
    assert.equal(accountBalance(all, ACCOUNTS.providerClearing), 40_000);
  });

  test('QR Ph fee pass-through is locked off; platform absorbs the fee', () => {
    const q = buildQuote({ court: { pricing, ref: 'court', label: 'Court 1' }, tax: NO_VAT, fee: { ...QRPH, passThrough: true }, commission: COMMISSION });
    assert.equal(q.fee?.customerAmount, 0);
    assert.equal(q.total, 40_000);
    assert.equal(q.platformRevenue, 500); // ₱20 commission − ₱15 fee
  });

  test('venue-funded vs platform-funded discount', () => {
    const promo = { promotionId: 'p', code: 'SAVE50', label: '₱50 off', type: 'fixed' as const, value: 5_000, fundedBy: 'venue' as const, appliesTo: 'court' as const };
    const qv = buildQuote({ court: { pricing, ref: 'court', label: 'Court 1' }, promo, tax: NO_VAT, fee: null, commission: COMMISSION });
    assert.equal(qv.commission.base, 35_000);
    assert.equal(qv.commission.amount, 1_750);
    assert.equal(qv.venueNet, 33_250);
    const qp = buildQuote({ court: { pricing, ref: 'court', label: 'Court 1' }, promo: { ...promo, fundedBy: 'platform' }, tax: NO_VAT, fee: null, commission: COMMISSION });
    assert.equal(qp.commission.base, 40_000);
    assert.equal(qp.venueNet, 38_000);
    assert.equal(qp.platformRevenue, 2_000 - 5_000);
    for (const q of [qv, qp]) {
      const j = captureJournal(q, 'biz_1', {}, 0, 'capture');
      assert.equal(totals(j.lines).debit, totals(j.lines).credit);
    }
  });

  test('VAT-inclusive pricing shows an informational VAT line', () => {
    const q = buildQuote({ court: { pricing, ref: 'court', label: 'Court 1' }, tax: VAT_INCL, fee: GCASH, commission: COMMISSION });
    assert.equal(q.taxIncluded, 4_286);
    assert.equal(q.taxAdded, 0);
    assert.equal(q.fee?.customerAmount, 942);
    assert.equal(q.total, 40_942);
  });

  test('50% player refund reverses commission proportionally and balances', () => {
    const addOn = { ref: 'addon_1', productId: 'prd_water', label: 'Bottled water × 2', unitAmount: 4_000, qty: 2, taxable: true };
    const q = buildQuote({ court: { pricing, ref: 'court', label: 'Court 1' }, addOns: [addOn], tax: NO_VAT, fee: BANK, commission: COMMISSION });
    const decision = evaluateCancellation(POLICY_LIBRARY.standard, 'player', at(DATE, 0), at(DATE, 10));
    assert.equal(decision.courtRefundPpm, 500_000); // 10 hours before → 50%
    const b = computeRefund(q, { items: [{ ref: 'court', sharePpm: decision.courtRefundPpm }, { ref: 'addon_1', sharePpm: 1_000_000 }], refundGatewayFee: decision.refundGatewayFee });
    assert.equal(b.toCustomer, 20_000 + 8_000);
    assert.equal(b.commissionReversal, 1_000);
    const j = refundJournal(b, 'biz_1', true, {}, 0, 'refund');
    assert.equal(totals(j.lines).debit, totals(j.lines).credit);
    const cap = captureJournal(q, 'biz_1', {}, 0, 'capture');
    const bal = accountBalance([...cap.lines, ...j.lines], venuePayable('biz_1'));
    assert.equal(bal, (40_000 - 20_000) * 0.95);
  });

  test('refund after payout drives venue payable negative (receivable)', () => {
    const q = buildQuote({ court: { pricing, ref: 'court', label: 'Court 1' }, tax: NO_VAT, fee: BANK, commission: COMMISSION });
    const cap = captureJournal(q, 'biz_1', {}, 0, 'capture');
    const payout = payoutJournal(q.venueNet, 'biz_1', {}, 0, 'payout');
    const b = computeRefund(q, { items: [{ ref: 'court', sharePpm: 1_000_000 }], refundGatewayFee: true });
    const r = refundJournal(b, 'biz_1', false, {}, 0, 'venue cancel');
    assert.equal(b.toCustomer, 41_500);
    assert.equal(accountBalance([...cap.lines, ...payout.lines, ...r.lines], venuePayable('biz_1')), -38_000);
  });

  test('chargeback journal balances', () => {
    const q = buildQuote({ court: { pricing, ref: 'court', label: 'Court 1' }, tax: VAT_INCL, fee: GCASH, commission: COMMISSION });
    const j = chargebackJournal(q, 'biz_1', 50_000, {}, 0, 'chargeback');
    assert.equal(totals(j.lines).debit, totals(j.lines).credit);
  });

  test('promotion validation', () => {
    const base = { id: 'p1', code: 'WELCOME', name: '10% off', businessId: null, venueIds: null, type: 'percent' as const, value: 100_000, fundedBy: 'platform' as const, appliesTo: 'court' as const, validFrom: 0, validTo: Date.UTC(2030, 0), usageLimit: 1, perUserLimit: 1, usedCount: 0, status: 'active' as const };
    assert.equal(evaluatePromotion(base, { now: 1, businessId: 'b', venueId: 'v', subtotal: 40_000, userRedemptions: 0, reservedCount: 0 }).ok, true);
    assert.equal(evaluatePromotion(base, { now: 1, businessId: 'b', venueId: 'v', subtotal: 40_000, userRedemptions: 0, reservedCount: 1 }).ok, false);
    assert.equal(evaluatePromotion(base, { now: 1, businessId: 'b', venueId: 'v', subtotal: 40_000, userRedemptions: 1, reservedCount: 0 }).ok, false);
  });
});

describe('availability', () => {
  const weekly = { days: Array.from({ length: 7 }, () => ({ open: 6 * 60, close: 23 * 60 })) };
  const settings = { ...DEFAULT_BOOKING_SETTINGS, bufferMinutes: 10 };
  const occ: Occupancy[] = [{ id: 's1', courtId: 'c1', startMs: at(DATE, 18), endMs: at(DATE, 19), occupiedEndMs: at(DATE, 19, 10), kind: 'booking', sourceId: 'b1' }];
  const grid = computeAvailability({ date: DATE, offsetMin: OFFSET, schedule: scheduleFor(DATE, weekly, []), settings, courtIds: ['c1'], occupancies: occ, durationMinutes: 60, now: at(DATE, 6) });
  const cell = (h: number, m = 0) => grid[0]!.cells.find((x) => x.startMs === at(DATE, h, m))!;

  test('booked cells and buffer are respected', () => {
    assert.equal(cell(18).state, 'booked');
    assert.equal(cell(17).bookable, false, '17:00–18:00 + 10 min buffer overlaps 18:00');
    assert.equal(cell(16, 30).bookable, true);
    assert.equal(cell(19).bookable, false, 'starts inside the previous booking buffer');
    assert.equal(cell(19, 30).bookable, true);
    assert.equal(cell(22, 30).bookable, false, 'not enough time before closing');
  });
  test('lead time and window validation', () => {
    const errs = validateBookingWindow({ startMs: at(DATE, 6, 15), durationMinutes: 45, offsetMin: OFFSET, settings, schedule: scheduleFor(DATE, weekly, []), now: at(DATE, 6) });
    assert.ok(errs.some((e) => e.field === 'durationMinutes'));
    assert.ok(errs.some((e) => e.field === 'startAt'));
  });
  test('special closure', () => {
    const s = scheduleFor(DATE, weekly, [{ id: 'x', venueId: 'v', date: DATE, kind: 'closed', reason: 'Resurfacing' }]);
    assert.equal(s.closed, true);
  });
});

describe('policies and state machines', () => {
  test('standard policy tiers', () => {
    const start = at(DATE, 18);
    assert.equal(evaluateCancellation(POLICY_LIBRARY.standard, 'player', start - 30 * HOUR, start).courtRefundPpm, 1_000_000);
    assert.equal(evaluateCancellation(POLICY_LIBRARY.standard, 'player', start - 7 * HOUR, start).courtRefundPpm, 500_000);
    assert.equal(evaluateCancellation(POLICY_LIBRARY.standard, 'player', start - 60 * MINUTE, start).courtRefundPpm, 0);
    const venue = evaluateCancellation(POLICY_LIBRARY.standard, 'venue', start - 60 * MINUTE, start);
    assert.equal(venue.courtRefundPpm, 1_000_000);
    assert.equal(venue.refundGatewayFee, true);
  });
  test('booking transitions reject illegal moves', () => {
    assert.equal(canTransition(BOOKING_TRANSITIONS, 'slot_held', 'confirmed'), false);
    assert.equal(canTransition(BOOKING_TRANSITIONS, 'payment_pending', 'confirmed'), true);
    assert.equal(canTransition(BOOKING_TRANSITIONS, 'expired', 'confirmed'), true, 'late payment recovery');
    const b = { status: 'confirmed' as const, history: [] };
    assert.throws(() => transition(BOOKING_TRANSITIONS, b as { status: 'confirmed' | 'draft'; history: [] }, 'draft', 0, 'x'));
  });
  test('privilege escalation guard', () => {
    const manager = new Set<string>(BUSINESS_ROLE_TEMPLATES.business_manager.permissions);
    assert.equal(checkGrant(manager, ['bookings.view', 'refunds.approve']).ok, false);
    assert.equal(checkGrant(new Set(ALL_BUSINESS_PERMISSIONS), ['finance.manage_payout_account']).ok, false, 'owner-only permission cannot go into a custom role');
    assert.equal(checkGrant(manager, ['bookings.view', 'bookings.check_in']).ok, true);
  });
});

describe('security primitives', () => {
  test('SHA-256/HMAC/PBKDF2 match Node crypto', () => {
    for (const m of ['', 'abc', 'x'.repeat(1_000)]) {
      assert.equal(c.toHex(c.sha256(c.utf8(m))), nodeCrypto.createHash('sha256').update(m).digest('hex'));
      assert.equal(c.toHex(c.hmacSha256('k', m)), nodeCrypto.createHmac('sha256', 'k').update(m).digest('hex'));
    }
    assert.equal(c.toHex(c.pbkdf2Sha256(c.utf8('pw'), c.utf8('salt'), 1_000, 32)), nodeCrypto.pbkdf2Sync('pw', 'salt', 1_000, 32, 'sha256').toString('hex'));
  });
  test('password hashing never stores the password and verifies correctly', () => {
    const h = c.hashPassword('CourtKo!2026', 1_000);
    assert.ok(!h.includes('CourtKo'));
    assert.equal(c.verifyPassword('CourtKo!2026', h), true);
    assert.equal(c.verifyPassword('CourtKo!2027', h), false);
  });
  test('TOTP RFC 6238 vectors and replay protection', () => {
    const secret = c.toBase32(c.utf8('12345678901234567890'));
    assert.equal(totpAt(secret, 59_000, 8), '94287082');
    assert.equal(totpAt(secret, 1_111_111_109_000, 8), '07081804');
    const now = 1_800_000_000_000;
    const code = totpAt(secret, now);
    const step = verifyTotp(secret, code, now);
    assert.ok(step !== null);
    assert.equal(verifyTotp(secret, code, now, step!), null, 'same code cannot be reused');
  });
  test('validation helpers', () => {
    assert.equal(normalizePhMobile('0917 000 0001'), '+639170000001');
    assert.equal(normalizePhMobile('12345'), null);
    assert.ok(passwordProblems('short').length > 0);
    assert.equal(passwordProblems('Rally-at-the-kitchen-line').length, 0);
  });
});
