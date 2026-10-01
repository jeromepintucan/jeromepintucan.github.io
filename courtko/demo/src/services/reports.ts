/**
 * Reporting (build step 16). Each metric states its date basis — booking date, play date, payment date,
 * refund date or payout date — and they are never mixed in one figure. Exports are permission-gated and audited.
 */

import { scheduleFor } from '../domain/availability.ts';
import { fail } from '../domain/errors.ts';
import { ACCOUNTS } from '../domain/ledger.ts';
import { DAY, addDays, localDate, localParts, localToInstant, toIso } from '../domain/time.ts';
import { platformBalance, statementTotals } from './ledgerSvc.ts';
import type { Id } from './model.ts';
import { audit, displayName, requireBusiness, requirePlatform, type Svc } from './svc.ts';

export interface ReportRange {
  from: number;
  to: number;
}

function utilization(s: Svc, venueIds: Id[], range: ReportRange) {
  let available = 0;
  let booked = 0;
  const heat: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const perCourt = new Map<Id, { name: string; venue: string; availableMin: number; bookedMin: number }>();
  for (const vid of venueIds) {
    const venue = s.db.must('venues', vid);
    const courts = s.db.filter('courts', (c) => c.venueId === vid && c.status === 'active');
    const special = s.db.filter('specialHours', (x) => x.venueId === vid);
    for (let d = localDate(range.from, venue.offsetMin); localToInstant(d, 0, venue.offsetMin) < range.to; d = addDays(d, 1)) {
      const sch = scheduleFor(d, venue.hours, special);
      if (sch.closed) continue;
      for (const c of courts) {
        const pc = perCourt.get(c.id) ?? { name: c.name, venue: venue.name, availableMin: 0, bookedMin: 0 };
        pc.availableMin += sch.close - sch.open;
        available += sch.close - sch.open;
        perCourt.set(c.id, pc);
      }
    }
  }
  for (const b of s.db.filter('bookings', (x) => venueIds.includes(x.venueId) && ['confirmed', 'checked_in', 'completed', 'no_show'].includes(x.status) && x.startMs >= range.from && x.startMs < range.to)) {
    booked += b.durationMinutes;
    const pc = perCourt.get(b.courtId);
    if (pc) pc.bookedMin += b.durationMinutes;
    const p = localParts(b.startMs, 480);
    for (let m = 0; m < b.durationMinutes; m += 60) heat[p.dow]![Math.min(23, Math.floor((p.minute + m) / 60))]! += 1;
  }
  return { rate: available ? booked / available : 0, bookedHours: booked / 60, availableHours: available / 60, heat, perCourt: [...perCourt.values()].map((c) => ({ ...c, rate: c.availableMin ? c.bookedMin / c.availableMin : 0 })) };
}

export function businessReport(s: Svc, input: { businessId: Id; from: number; to: number; venueId?: Id }) {
  const acc = requireBusiness(s, input.businessId, 'reports.view');
  const range = { from: input.from, to: input.to };
  const venueIds = s.db.filter('venues', (v) => v.businessId === input.businessId && (!input.venueId || v.id === input.venueId)).map((v) => v.id);
  // Play-date basis
  const played = s.db.filter('bookings', (b) => b.businessId === input.businessId && venueIds.includes(b.venueId) && b.startMs >= range.from && b.startMs < range.to && !['draft', 'slot_held', 'payment_pending', 'expired', 'failed'].includes(b.status));
  const cancelled = played.filter((b) => ['cancelled', 'refunded', 'partially_refunded', 'refund_pending'].includes(b.status)).length;
  const noShows = played.filter((b) => b.status === 'no_show').length;
  // Booking-date basis
  const created = s.db.count('bookings', (b) => b.businessId === input.businessId && b.createdAt >= range.from && b.createdAt < range.to && b.confirmedAt !== null);
  // Payment-date basis
  const payments = s.db.filter('payments', (p) => p.businessId === input.businessId && p.capturedAt !== null && p.capturedAt >= range.from && p.capturedAt < range.to);
  let courtRevenue = 0, productRevenue = 0, eventRevenue = 0, discounts = 0, commission = 0, venueNet = 0, customerFees = 0;
  for (const p of payments) {
    const q = s.db.get('snapshots', p.snapshotId)?.quote;
    if (!q) continue;
    for (const i of q.items) {
      if (i.kind === 'court') courtRevenue += i.amount;
      else if (i.kind === 'addon') productRevenue += i.amount;
      else eventRevenue += i.amount;
    }
    if (q.discount?.fundedBy === 'venue') discounts += q.discount.amount;
    commission += q.commission.amount;
    venueNet += q.venueNet;
    customerFees += q.fee?.customerAmount ?? 0;
  }
  // Refund-date basis
  const refunds = s.db.filter('refunds', (r) => r.businessId === input.businessId && r.status === 'succeeded' && (r.completedAt ?? 0) >= range.from && (r.completedAt ?? 0) < range.to);
  // Payout-date basis
  const payouts = s.db.filter('payouts', (p) => p.businessId === input.businessId && p.status === 'paid' && (p.paidAt ?? 0) >= range.from && (p.paidAt ?? 0) < range.to);
  // Returning customers (play-date basis)
  const counts = new Map<Id, number>();
  for (const b of played.filter((x) => ['completed', 'checked_in', 'confirmed'].includes(x.status))) counts.set(b.userId, (counts.get(b.userId) ?? 0) + 1);
  const returning = [...counts.values()].filter((n) => n > 1).length;
  const byDay: { date: string; revenue: number; bookings: number }[] = [];
  for (let d = localDate(range.from); localToInstant(d, 0) < range.to; d = addDays(d, 1)) {
    const start = localToInstant(d, 0);
    const end = start + DAY;
    byDay.push({ date: d, revenue: payments.filter((p) => p.capturedAt! >= start && p.capturedAt! < end).reduce((a, p) => a + p.amount, 0), bookings: played.filter((b) => b.startMs >= start && b.startMs < end).length });
  }
  const topCustomers = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([userId, n]) => ({ name: displayName(s.db, userId), sessions: n }));
  return {
    bases: { bookings: 'play date', created: 'booking date', revenue: 'payment date', refunds: 'refund date', payouts: 'payout date' },
    playedBookings: played.length,
    createdBookings: created,
    cancellationRate: played.length ? cancelled / played.length : 0,
    noShowRate: played.length ? noShows / played.length : 0,
    returningCustomers: returning,
    customers: counts.size,
    revenue: { court: courtRevenue, products: productRevenue, events: eventRevenue, gross: courtRevenue + productRevenue + eventRevenue, discounts, commission, venueNet, customerFees },
    refunds: { count: refunds.length, amount: refunds.reduce((a, r) => a + r.amount, 0) },
    payouts: { count: payouts.length, amount: payouts.reduce((a, p) => a + p.amount, 0) },
    utilization: utilization(s, venueIds, range),
    byDay,
    topCustomers,
    statement: acc.perms.has('finance.view_summary') ? statementTotals(s.db, input.businessId, range.from, range.to) : null,
  };
}

export function platformReport(s: Svc, input: { from: number; to: number }) {
  requirePlatform(s, 'platform.reports.view');
  const range = { from: input.from, to: input.to };
  const payments = s.db.filter('payments', (p) => p.capturedAt !== null && p.capturedAt >= range.from && p.capturedAt < range.to);
  const byBusiness = new Map<Id, { name: string; gbv: number; commission: number; bookings: number }>();
  const byMethod = new Map<string, { label: string; count: number; amount: number }>();
  for (const p of payments) {
    const q = s.db.get('snapshots', p.snapshotId)?.quote;
    const b = byBusiness.get(p.businessId) ?? { name: s.db.get('businesses', p.businessId)?.tradeName ?? '', gbv: 0, commission: 0, bookings: 0 };
    b.gbv += p.amount;
    b.commission += q?.commission.amount ?? 0;
    b.bookings += 1;
    byBusiness.set(p.businessId, b);
    const m = byMethod.get(p.method) ?? { label: p.method, count: 0, amount: 0 };
    m.count += 1;
    m.amount += p.amount;
    byMethod.set(p.method, m);
  }
  const attempts = s.db.filter('payments', (p) => p.createdAt >= range.from && p.createdAt < range.to && p.status !== 'created');
  const failed = attempts.filter((p) => p.status === 'failed').length;
  return {
    gbv: payments.reduce((a, p) => a + p.amount, 0),
    commission: platformBalance(s.db, ACCOUNTS.commissionRevenue, range.from, range.to),
    gatewayFees: platformBalance(s.db, ACCOUNTS.feeExpense, range.from, range.to),
    feeRecovery: platformBalance(s.db, ACCOUNTS.feeRecovery, range.from, range.to),
    promotions: platformBalance(s.db, ACCOUNTS.promotionsExpense, range.from, range.to),
    successfulPayments: payments.length,
    failedPayments: failed,
    successRate: attempts.length ? payments.length / attempts.length : 0,
    refunds: s.db.filter('refunds', (r) => r.status === 'succeeded' && (r.completedAt ?? 0) >= range.from && (r.completedAt ?? 0) < range.to).reduce((a, r) => a + r.amount, 0),
    chargebacks: s.db.count('disputes', (d) => d.status === 'lost' && (d.resolvedAt ?? 0) >= range.from),
    pendingPayouts: s.db.count('payouts', (p) => p.status === 'processing' || p.status === 'scheduled'),
    failedPayouts: s.db.count('payouts', (p) => p.status === 'failed'),
    eventRegistrations: s.db.count('registrations', (r) => (r.confirmedAt ?? 0) >= range.from && (r.confirmedAt ?? 0) < range.to),
    productOrders: s.db.count('orders', (o) => (o.paidAt ?? 0) >= range.from && (o.paidAt ?? 0) < range.to),
    supportReports: s.db.count('contentReports', (r) => r.createdAt >= range.from),
    utilization: utilization(s, s.db.filter('venues', (v) => v.status === 'published').map((v) => v.id), range).rate,
    topBusinesses: [...byBusiness.values()].sort((a, b) => b.gbv - a.gbv),
    methods: [...byMethod.values()].sort((a, b) => b.amount - a.amount),
  };
}

function csv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => {
    const t = String(c);
    // CSV-injection guard: prefix cells that spreadsheet apps would treat as formulas.
    const safe = /^[=+\-@]/.test(t) ? `'${t}` : t;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }).join(',')).join('\n');
}

export function exportReport(s: Svc, input: { businessId?: Id; kind: 'bookings' | 'payments' | 'payouts'; from: number; to: number }) {
  if (input.businessId) requireBusiness(s, input.businessId, 'reports.export');
  else requirePlatform(s, 'platform.reports.export');
  const scope = (bid: Id) => !input.businessId || bid === input.businessId;
  let rows: (string | number)[][];
  if (input.kind === 'bookings') {
    rows = [['booking_code', 'venue', 'court', 'play_start_utc', 'status', 'booked_at_utc', 'total_centavos', 'currency']];
    for (const b of s.db.filter('bookings', (x) => scope(x.businessId) && x.startMs >= input.from && x.startMs < input.to && x.status !== 'draft')) rows.push([b.code, s.db.get('venues', b.venueId)?.name ?? '', s.db.get('courts', b.courtId)?.name ?? '', toIso(b.startMs), b.status, toIso(b.createdAt), s.db.get('snapshots', b.snapshotId)?.quote.total ?? 0, 'PHP']);
  } else if (input.kind === 'payments') {
    rows = [['payment_id', 'provider_payment_id', 'captured_at_utc', 'method', 'amount_centavos', 'customer_fee', 'provider_fee', 'commission', 'venue_net', 'status', 'currency']];
    for (const p of s.db.filter('payments', (x) => scope(x.businessId) && x.capturedAt !== null && x.capturedAt >= input.from && x.capturedAt < input.to)) {
      const q = s.db.get('snapshots', p.snapshotId)?.quote;
      rows.push([p.id, p.providerPaymentId ?? '', toIso(p.capturedAt!), p.methodDisplay, p.amount, p.customerFee, p.actualProviderFee ?? '', q?.commission.amount ?? 0, q?.venueNet ?? 0, p.status, 'PHP']);
    }
  } else {
    rows = [['payout_id', 'business', 'created_at_utc', 'paid_at_utc', 'amount_centavos', 'status', 'destination', 'currency']];
    for (const p of s.db.filter('payouts', (x) => scope(x.businessId) && x.createdAt >= input.from && x.createdAt < input.to)) rows.push([p.id, s.db.get('businesses', p.businessId)?.tradeName ?? '', toIso(p.createdAt), p.paidAt ? toIso(p.paidAt) : '', p.amount, p.status, p.destinationMasked, 'PHP']);
  }
  if (rows.length > 20_000) fail('CONFLICT', 'Export too large; narrow the date range.');
  s.after.push((s2) => audit(s2, { action: 'report.exported', targetType: 'report', targetId: input.kind, businessId: input.businessId ?? null, summary: `Exported ${input.kind} (${rows.length - 1} rows)` }));
  return { filename: `courtko-${input.kind}-${localDate(input.from)}-to-${localDate(input.to - 1)}.csv`, content: csv(rows), rows: rows.length - 1 };
}
