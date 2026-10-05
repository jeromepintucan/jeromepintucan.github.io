/**
 * Payment exceptions center (doc 08 §6, doc 16 runbooks): one queue for everything in the money flow that needs a
 * human or is worth watching — stuck pending payments, late captures, duplicate payments, amount mismatches,
 * failed refunds and payouts, open disputes and provider incidents — plus failure-reason analytics. Items are
 * computed from the source records (nothing is copied), and staff acknowledgements are stored separately, so the
 * financial records are never edited to "close" an exception.
 */

import { fail } from '../domain/errors.ts';
import { paymentFailure, payoutFailure, refundFailure } from '../domain/paymentFailures.ts';
import { formatPHP } from '../domain/money.ts';
import { formatDateTime, HOUR, MINUTE } from '../domain/time.ts';
import { bookingSummary } from './checkout.ts';
import { paymentStatus } from './gateway.ts';
import type { Id, Payment } from './model.ts';
import * as provider from './provider.ts';
import { audit, displayName, requireBusiness, requirePlatform, type Svc } from './svc.ts';

export type ExceptionKind = 'amount_mismatch' | 'stuck_pending' | 'refund_failed' | 'payout_failed' | 'dispute_open' | 'late_capture' | 'duplicate_payment' | 'risk_decline' | 'provider_incident';
export type ExceptionAction = 'recheck' | 'retry_refund' | 'manual_refund' | 'retry_payout' | 'resolve_mismatch' | 'acknowledge' | 'open_disputes' | 'fix_payout_account';

export interface ExceptionItem {
  key: string;
  kind: ExceptionKind;
  severity: 'critical' | 'warning' | 'info';
  at: number;
  title: string;
  detail: string;
  guidance: string;
  amount: number | null;
  businessId: Id | null;
  business: string;
  ref: { paymentId?: Id; refundId?: Id; payoutId?: Id; disputeId?: Id; incidentId?: Id };
  actions: ExceptionAction[];
  resolved: { by: string; at: number; note: string } | null;
}

const STUCK_AFTER = 15 * MINUTE;
const WINDOW = 14 * 24 * HOUR;
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

function payLabel(s: Svc, p: Payment): string {
  const c = s.db.get('checkouts', p.checkoutId);
  const b = c?.bookingId ? s.db.get('bookings', c.bookingId) : undefined;
  if (b) return `${b.code} · ${bookingSummary(s.db, b)}`;
  return c?.kind === 'open_play_registration' ? 'Open Play registration' : c?.kind === 'event_registration' ? 'Event registration' : c?.kind === 'product_order' ? 'Venue order' : 'Checkout';
}

export function paymentExceptions(s: Svc, input: { businessId?: Id } = {}) {
  const platform = !input.businessId;
  if (input.businessId) requireBusiness(s, input.businessId, 'payments.view');
  else requirePlatform(s, 'platform.transactions.view');
  const scope = <T extends { businessId: Id | null }>(x: T) => platform || x.businessId === input.businessId;
  const bizName = (id: Id | null) => (id ? s.db.get('businesses', id)?.tradeName ?? '' : 'Platform');
  const since = s.now - WINDOW;
  const items: ExceptionItem[] = [];
  const push = (it: Omit<ExceptionItem, 'resolved' | 'business'>) => {
    const res = s.db.get('exceptionResolutions', it.key);
    items.push({ ...it, business: bizName(it.businessId), resolved: res ? { by: displayName(s.db, res.by), at: res.at, note: res.note } : null });
  };
  const payments = s.db.filter('payments', (p) => scope(p) && p.createdAt >= since);

  for (const p of s.db.filter('payments', (x) => scope(x) && !!x.review)) {
    const r = p.review!;
    push({ key: `amount_mismatch:${p.id}`, kind: 'amount_mismatch', severity: r.resolvedAt ? 'info' : 'critical', at: r.detectedAt, title: `Amount mismatch · provider ${formatPHP(r.providerAmount)} vs checkout ${formatPHP(p.amount)}`, detail: `${payLabel(s, p)} · ${displayName(s.db, p.userId)} · ${p.methodDisplay}${r.resolution ? ` — ${r.resolution}` : ''}`, guidance: 'Not fulfilled. Platform finance refunds the provider payment in full and the player books again. Raise a ticket with the provider.', amount: r.providerAmount, businessId: p.businessId, ref: { paymentId: p.id }, actions: r.resolvedAt ? [] : platform ? ['resolve_mismatch'] : [] });
  }
  for (const p of payments.filter((x) => x.status === 'pending' && !x.review && s.now - x.createdAt > STUCK_AFTER)) {
    push({ key: `stuck_pending:${p.id}`, kind: 'stuck_pending', severity: 'warning', at: p.createdAt, title: `Payment pending for ${Math.round((s.now - p.createdAt) / MINUTE)} min`, detail: `${payLabel(s, p)} · ${p.methodDisplay} · ${formatPHP(p.amount)}`, guidance: 'Re-check with the provider. Reconciliation also re-queries every pending payment each minute; the hold expires on its own if it was never paid.', amount: p.amount, businessId: p.businessId, ref: { paymentId: p.id }, actions: ['recheck', 'acknowledge'] });
  }
  for (const r of s.db.filter('refunds', (x) => scope(x) && (x.status === 'failed' || (x.status === 'approved' && !!x.failureReason)))) {
    const info = refundFailure(r.failureReason);
    const manual = info.action === 'manual_route';
    push({ key: `refund_failed:${r.id}`, kind: 'refund_failed', severity: 'critical', at: r.history.at(-1)?.at ?? r.createdAt, title: `Refund ${formatPHP(r.amount)} failed · ${r.status === 'approved' ? 'provider unreachable' : info.title}`, detail: `${displayName(s.db, r.userId)} · ${r.reason}${r.failureReason ? ` · ${r.failureReason}` : ''}`, guidance: r.status === 'approved' ? 'The provider could not be reached. The refund is resubmitted automatically when it is back.' : info.staffNote, amount: r.amount, businessId: r.businessId, ref: { refundId: r.id, paymentId: r.paymentId }, actions: r.status === 'failed' ? (manual ? ['manual_refund', 'retry_refund'] : ['retry_refund', 'manual_refund']) : [] });
  }
  for (const po of s.db.filter('payouts', (x) => scope(x) && x.status === 'failed')) {
    const info = payoutFailure(po.failureReason);
    push({ key: `payout_failed:${po.id}`, kind: 'payout_failed', severity: 'critical', at: po.history.at(-1)?.at ?? po.createdAt, title: `Payout ${formatPHP(po.amount)} failed · ${info.title}`, detail: `${bizName(po.businessId)} · ${po.destinationMasked} · attempt ${po.attempts}`, guidance: `${info.staffNote} The money stays in the venue balance (reversed in the ledger) until a successful payout.`, amount: po.amount, businessId: po.businessId, ref: { payoutId: po.id }, actions: platform ? (info.action === 'fix_account' ? ['retry_payout', 'acknowledge'] : ['retry_payout']) : ['fix_payout_account'] });
  }
  for (const d of s.db.filter('disputes', (x) => scope(x) && ['open', 'evidence_submitted'].includes(x.status))) {
    push({ key: `dispute_open:${d.id}`, kind: 'dispute_open', severity: s.now > d.dueAt - 2 * 24 * HOUR ? 'critical' : 'warning', at: d.openedAt, title: `Chargeback ${formatPHP(d.amount)} · ${d.status === 'open' ? 'evidence due' : 'evidence submitted'}`, detail: `${d.reason} · respond by ${formatDateTime(d.dueAt)}`, guidance: 'Submit booking, check-in and receipt evidence before the deadline. Amount is held from the venue balance.', amount: d.amount, businessId: d.businessId, ref: { disputeId: d.id, paymentId: d.paymentId }, actions: platform ? ['open_disputes'] : [] });
  }
  for (const p of payments.filter((x) => x.history.some((h) => (h.reason ?? '').startsWith('Late capture')))) {
    const refunded = s.db.find('refunds', (r) => r.paymentId === p.id && r.initiator === 'system');
    const b = s.db.get('bookings', s.db.get('checkouts', p.checkoutId)?.bookingId ?? '');
    push({ key: `late_capture:${p.id}`, kind: 'late_capture', severity: 'info', at: p.capturedAt ?? p.createdAt, title: `Late payment ${refunded ? 'auto-refunded' : 'recovered'} · ${formatPHP(p.amount)}`, detail: `${payLabel(s, p)} · paid after the hold expired${refunded ? ` — ${refunded.reason}` : b?.lateRecovery ? ' — same slot re-acquired, booking confirmed' : ''}`, guidance: 'Handled automatically: the provider is authoritative, so a late capture is either fulfilled (slot still free) or refunded in full including fees.', amount: p.amount, businessId: p.businessId, ref: { paymentId: p.id }, actions: ['acknowledge'] });
  }
  for (const r of s.db.filter('refunds', (x) => scope(x) && x.reason === 'Duplicate payment' && x.createdAt >= since)) {
    push({ key: `duplicate_payment:${r.id}`, kind: 'duplicate_payment', severity: 'info', at: r.createdAt, title: `Duplicate payment refunded · ${formatPHP(r.amount)}`, detail: `${displayName(s.db, r.userId)} paid twice for the same checkout (e.g. two tabs). Refund ${r.status}.`, guidance: 'Handled automatically — the second capture is refunded in full.', amount: r.amount, businessId: r.businessId, ref: { refundId: r.id, paymentId: r.paymentId }, actions: ['acknowledge'] });
  }
  for (const p of payments.filter((x) => x.status === 'failed' && paymentFailure(x.failureCode).category === 'risk')) {
    push({ key: `risk_decline:${p.id}`, kind: 'risk_decline', severity: 'warning', at: p.history.at(-1)?.at ?? p.createdAt, title: 'Issuer risk decline', detail: `${displayName(s.db, p.userId)} · ${p.methodDisplay} · ${formatPHP(p.amount)}`, guidance: paymentFailure(p.failureCode).staffNote, amount: p.amount, businessId: p.businessId, ref: { paymentId: p.id }, actions: ['acknowledge'] });
  }
  for (const i of s.db.filter('providerIncidents', (x) => x.at >= since && (platform || x.businessId === input.businessId))) {
    push({ key: `provider_incident:${i.id}`, kind: 'provider_incident', severity: i.outcome === 'failed' ? 'warning' : 'info', at: i.at, title: `Provider ${i.op.replace('_', ' ')} ${i.outcome === 'failed' ? 'failed' : 'recovered after retry'}${i.method ? ` · ${provider.METHOD_LABEL[i.method]}` : ''}`, detail: i.detail, guidance: i.outcome === 'failed' ? 'The player was told nothing was charged and their hold was kept. Watch the provider status page; repeated failures open a provider ticket.' : 'Retried automatically with the same idempotency key — no duplicate session or charge.', amount: null, businessId: i.businessId, ref: { incidentId: i.id }, actions: ['acknowledge'] });
  }

  items.sort((a, b) => (a.resolved ? 1 : 0) - (b.resolved ? 1 : 0) || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.at - a.at);
  // Failure analytics (last 7 days): why attempts fail, by method.
  const week = payments.filter((p) => p.createdAt >= s.now - 7 * 24 * HOUR && p.status !== 'created');
  const failed = week.filter((p) => p.status === 'failed' || (p.status === 'expired' && p.failureCode));
  const reasons = new Map<string, { code: string; title: string; category: string; count: number; methods: Set<string> }>();
  for (const p of failed) {
    const info = paymentFailure(p.failureCode);
    const r = reasons.get(info.code) ?? { code: info.code, title: info.title, category: info.category, count: 0, methods: new Set<string>() };
    r.count++;
    r.methods.add(provider.METHOD_LABEL[p.method]);
    reasons.set(info.code, r);
  }
  const open = items.filter((i) => !i.resolved && i.actions.some((x) => x !== 'acknowledge'));
  return {
    health: paymentStatus(s, provider.providerHealth(s)),
    summary: {
      open: open.length,
      critical: open.filter((i) => i.severity === 'critical').length,
      attempts7d: week.length,
      failed7d: failed.length,
      successRate7d: week.length ? Math.round(((week.length - failed.length) / week.length) * 1000) / 10 : 100,
      autoHandled: items.filter((i) => i.kind === 'late_capture' || i.kind === 'duplicate_payment' || (i.kind === 'provider_incident' && i.severity === 'info')).length,
    },
    reasons: [...reasons.values()].sort((a, b) => b.count - a.count).map((r) => ({ ...r, methods: [...r.methods] })),
    items,
  };
}

export function acknowledgeException(s: Svc, input: { businessId?: Id; key: string; note: string }) {
  if (input.businessId) requireBusiness(s, input.businessId, 'payments.view', { write: true });
  else requirePlatform(s, 'platform.transactions.view', { write: true });
  const list = paymentExceptions(s, input.businessId ? { businessId: input.businessId } : {}).items;
  const item = list.find((i) => i.key === input.key);
  if (!item) fail('NOT_FOUND', 'Exception not found.');
  if (!item.actions.includes('acknowledge')) fail('CONFLICT', 'This exception needs an action (retry, refund…), not just an acknowledgement.');
  const note = (input.note ?? '').trim();
  if (note.length < 3) fail('VALIDATION_FAILED', 'Add a short note.', { fields: [{ field: 'note', message: 'Note is required.' }] });
  if (s.db.get('exceptionResolutions', item.key)) fail('CONFLICT', 'Already acknowledged.');
  const [kind, ref] = item.key.split(':') as [string, Id];
  s.db.insert('exceptionResolutions', { id: item.key, kind, ref, businessId: item.businessId, note: note.slice(0, 300), by: s.actor.realUser!.id, at: s.now });
  audit(s, { action: 'payment_exception.acknowledged', targetType: kind, targetId: ref, businessId: item.businessId, summary: `Acknowledged: ${item.title}`, reason: note });
  return { ok: true };
}

/** Public: payment-method health for the checkout page (no internal detail). */
export function publicPaymentStatus(s: Svc) {
  const h = paymentStatus(s, provider.providerHealth(s));
  return { status: h.status, message: h.message, methods: h.methods.map((m) => ({ method: m.method, status: m.status })) };
}
