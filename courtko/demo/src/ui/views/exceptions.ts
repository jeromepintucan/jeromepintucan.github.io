/** Payment exceptions center UI — shared by the business portal (Payments → Payment issues) and the SuperAdmin console. */

import { formatPHP } from '../../domain/money.ts';
import { formatDateTime } from '../../domain/time.ts';
import type { ReadResult } from '../../services/api.ts';
import { action, app, form, str } from '../app.ts';
import { alertBox, btn, card, empty, field, kpi, tag, textarea } from '../components.ts';
import { html, type SafeHtml } from '../html.ts';
import { icon } from '../icons.ts';

type Exc = ReadResult<'GET /v1/admin/payment-exceptions'>;

const KIND_LABEL: Record<string, string> = {
  amount_mismatch: 'Amount mismatch',
  stuck_pending: 'Stuck pending',
  refund_failed: 'Refund failed',
  payout_failed: 'Payout failed',
  dispute_open: 'Chargeback',
  late_capture: 'Late payment',
  duplicate_payment: 'Duplicate payment',
  risk_decline: 'Risk decline',
  provider_incident: 'Provider incident',
};

export function healthBanner(h: Exc['health'] | ReadResult<'GET /v1/public/payment-status'>): SafeHtml {
  if (h.status === 'operational' || !h.message) return html``;
  return alertBox(h.status === 'down' ? 'danger' : 'warning', h.status === 'down' ? 'Online payments are temporarily unavailable' : 'Some payment methods are having problems', h.message);
}

export function exceptionsView(d: Exc, scope: 'business' | 'platform'): SafeHtml {
  const filter = app.state<string>(`excFilter:${scope}`, 'open');
  const actionable = (i: Exc['items'][number]) => !i.resolved && i.actions.some((a) => a !== 'acknowledge');
  const list = d.items.filter((i) => (filter === 'open' ? actionable(i) : filter === 'auto' ? !actionable(i) : true));
  const btnFor = (i: Exc['items'][number], a: string): SafeHtml => {
    const data = { key: i.key, scope, payment: i.ref.paymentId ?? '', refund: i.ref.refundId ?? '', payout: i.ref.payoutId ?? '' };
    switch (a) {
      case 'recheck':
        return btn('Re-check with provider', { action: 'exc.recheck', data, variant: 'secondary', size: 'sm', icon: 'refresh' });
      case 'retry_refund':
        return btn('Retry refund', { action: 'exc.retryRefund', data, variant: 'secondary', size: 'sm' });
      case 'manual_refund':
        return btn('Record bank-transfer refund…', { action: 'exc.manual', data: { ...data, amount: String(i.amount ?? 0) }, variant: 'ghost', size: 'sm' });
      case 'retry_payout':
        return btn('Retry payout', { action: 'exc.retryPayout', data, variant: 'secondary', size: 'sm' });
      case 'resolve_mismatch':
        return btn('Refund in full & close…', { action: 'exc.mismatch', data, variant: 'danger', size: 'sm' });
      case 'acknowledge':
        return i.resolved ? html`` : btn('Acknowledge…', { action: 'exc.ack', data, variant: 'ghost', size: 'sm' });
      case 'open_disputes':
        return btn('Open disputes', { href: '#/admin/disputes', variant: 'secondary', size: 'sm' });
      case 'fix_payout_account':
        return btn('Check payout account', { href: '#/biz/payouts', variant: 'secondary', size: 'sm' });
      default:
        return html``;
    }
  };
  return html`${healthBanner(d.health)}
  <div class="grid g4">${kpi('Needs action', String(d.summary.open), `${d.summary.critical} critical`, { icon: 'alert' })}${kpi('Payment success (7 days)', `${d.summary.successRate7d}%`, `${d.summary.failed7d} of ${d.summary.attempts7d} attempts failed`, { icon: 'card' })}${kpi('Handled automatically', String(d.summary.autoHandled), 'late payments, duplicates, retries', { icon: 'checkCircle' })}${kpi('Provider status', d.health.status === 'operational' ? 'Operational' : d.health.status === 'down' ? 'Down' : 'Degraded', d.health.recentIncidents ? `${d.health.recentIncidents} incident(s) in 10 min` : 'no recent incidents', { icon: 'shield' })}</div>
  <div class="split" style="margin-top:16px"><div class="stack">
    <div class="seg" role="group" aria-label="Filter">${[['open', 'Needs action'], ['auto', 'Handled / FYI'], ['all', 'All']].map(([k, l]) => html`<button class="${filter === k ? 'active' : ''}" data-action="exc.filter" data-scope="${scope}" data-k="${k}">${l}</button>`)}</div>
    ${list.length ? html`<div class="stack-sm">${list.map((i) => html`<div class="card exc exc-${i.severity}${i.resolved ? ' exc-resolved' : ''}"><div class="card-body">
      <div class="row-between" style="gap:8px;flex-wrap:wrap"><span class="row" style="gap:6px">${tag(KIND_LABEL[i.kind] ?? i.kind, i.severity === 'critical' ? 'danger' : i.severity === 'warning' ? 'warning' : 'info')}${scope === 'platform' && i.business ? html`<span class="xs muted">${i.business}</span>` : ''}</span><span class="xs muted">${formatDateTime(i.at)}</span></div>
      <b style="display:block;margin-top:6px">${i.title}</b><p class="small" style="margin:2px 0 0">${i.detail}</p>
      <p class="xs muted" style="margin:6px 0 0">${icon('info', 12)} ${i.guidance}</p>
      ${i.resolved ? html`<p class="xs" style="margin:6px 0 0">${icon('checkCircle', 12)} Acknowledged by ${i.resolved.by} · ${formatDateTime(i.resolved.at)} — ${i.resolved.note}</p>` : ''}
      ${i.actions.length && !i.resolved ? html`<div class="row" style="gap:6px;margin-top:10px;flex-wrap:wrap">${i.actions.map((a) => btnFor(i, a))}</div>` : ''}
    </div></div>`)}</div>` : empty(filter === 'open' ? 'Nothing needs action' : 'No exceptions', filter === 'open' ? 'Failed refunds, stuck payments, mismatches and payout problems show up here.' : undefined, undefined, 'checkCircle')}
  </div><div class="stack">
    ${card(d.reasons.length ? html`<div class="stack-sm">${d.reasons.map((r) => html`<div class="row-between small"><span><b>${r.title}</b><div class="xs muted">${r.code} · ${r.methods.join(', ')}</div></span>${tag(String(r.count), r.category === 'risk' ? 'danger' : r.category === 'provider' ? 'warning' : 'neutral')}</div>`)}</div>` : html`<p class="small muted">No failed attempts in the last 7 days.</p>`, { title: 'Why payments failed (7 days)', subtitle: 'Customer-side declines need no action; provider errors are monitored.' })}
    ${card(html`<div class="stack-sm">${d.health.methods.map((m) => html`<div class="row-between small"><span>${m.label}</span>${tag(m.status === 'operational' ? 'Operational' : m.status === 'down' ? 'Down' : 'Degraded', m.status === 'operational' ? 'success' : m.status === 'down' ? 'danger' : 'warning')}</div>`)}</div>`, { title: 'Payment channels' })}
    ${card(html`<ul class="bullets small"><li>Provider calls retry 3× with the same idempotency key — a lost response never creates a second charge.</li><li>A payment confirmed after the hold expired is either fulfilled (slot still free) or refunded in full, automatically.</li><li>Amounts that don't match the checkout are never fulfilled.</li><li>Nobody can mark a payment as paid by hand — status always comes from the provider.</li></ul>`, { title: 'Safeguards' })}
  </div></div>`;
}

action('exc.filter', (el) => app.set(`excFilter:${el.dataset.scope}`, el.dataset.k));
const isBiz = (el: HTMLElement) => el.dataset.scope === 'business';

action('exc.recheck', async (el) => {
  const r = await app.run(el, () => (isBiz(el) ? app.api.write('POST /v1/businesses/{businessId}/payments/{paymentId}/recheck', { businessId: app.businessId!, paymentId: el.dataset.payment! }) : app.api.write('POST /v1/admin/reconciliation/payments/{paymentId}/heal', { paymentId: el.dataset.payment! })));
  if (r) app.toast(`Provider says: ${r.result}.`, 'info');
});
action('exc.retryRefund', async (el) => {
  await app.run(el, () => (isBiz(el) ? app.api.write('POST /v1/businesses/{businessId}/refunds/{refundId}/retry', { businessId: app.businessId!, refundId: el.dataset.refund! }) : app.api.write('POST /v1/admin/refunds/{refundId}/retry', { refundId: el.dataset.refund! })), { success: 'Refund resubmitted to the provider' });
});
action('exc.retryPayout', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/admin/payouts/{payoutId}/retry', { payoutId: el.dataset.payout! }), { success: 'Payout resubmitted' });
});
action('exc.manual', (el) => {
  app.modal({
    title: 'Record a bank-transfer refund',
    body: html`<form class="stack-sm" data-form="exc.manual" data-scope="${el.dataset.scope}" data-refund="${el.dataset.refund}"><p class="small">Use this when the channel can't take the refund through the API. Send <b>${formatPHP(Number(el.dataset.amount ?? 0))}</b> to the customer by bank transfer first, then record the reference. The ledger records it like any refund and the customer is notified.</p>${field({ name: 'reference', label: 'Bank transfer reference', required: true, placeholder: 'e.g. BPI-2026100612345' })}${textarea({ name: 'note', label: 'Note (optional)', rows: 2 })}<div class="row" style="justify-content:flex-end">${btn('Cancel', { action: 'modal.close', variant: 'ghost' })}${btn('Record refund', { type: 'submit', variant: 'primary' })}</div></form>`,
  });
});
form('exc.manual', async (fd, f) => {
  const body = { refundId: f.dataset.refund!, reference: str(fd, 'reference'), note: str(fd, 'note') };
  if (f.dataset.scope === 'business') await app.api.write('POST /v1/businesses/{businessId}/refunds/{refundId}/manual-completion', { businessId: app.businessId!, ...body });
  else await app.api.write('POST /v1/admin/refunds/{refundId}/manual-completion', body);
  app.closeModal();
  app.toast('Refund recorded as completed by bank transfer', 'success');
});
action('exc.mismatch', (el) => {
  app.modal({
    title: 'Refund the mismatched payment',
    body: html`<form class="stack-sm" data-form="exc.mismatch" data-payment="${el.dataset.payment}"><p class="small">The booking was not confirmed. This refunds the full amount the provider captured back to the customer and closes the review.</p>${textarea({ name: 'note', label: 'Note for the audit log', required: true, rows: 2, placeholder: 'e.g. Provider ticket #4821 — amount reported ₱1 higher' })}<div class="row" style="justify-content:flex-end">${btn('Cancel', { action: 'modal.close', variant: 'ghost' })}${btn('Refund in full', { type: 'submit', variant: 'danger' })}</div></form>`,
  });
});
form('exc.mismatch', async (fd, f) => {
  const r = await app.api.write('POST /v1/admin/payments/{paymentId}/review-resolution', { paymentId: f.dataset.payment!, note: str(fd, 'note') });
  app.closeModal();
  app.toast(`Refund of ${formatPHP(r.refunded)} submitted; the customer was notified.`, 'success');
});
action('exc.ack', (el) => {
  app.modal({
    title: 'Acknowledge',
    body: html`<form class="stack-sm" data-form="exc.ack" data-scope="${el.dataset.scope}" data-key="${el.dataset.key}">${field({ name: 'note', label: 'Note', required: true, placeholder: 'e.g. Checked with the player — paid again with Maya' })}<p class="xs muted">The payment records are not changed. The note is kept in the audit log.</p><div class="row" style="justify-content:flex-end">${btn('Cancel', { action: 'modal.close', variant: 'ghost' })}${btn('Acknowledge', { type: 'submit', variant: 'primary' })}</div></form>`,
  });
});
form('exc.ack', async (fd, f) => {
  if (f.dataset.scope === 'business') await app.api.write('POST /v1/businesses/{businessId}/payment-exceptions/acknowledgements', { businessId: app.businessId!, key: f.dataset.key!, note: str(fd, 'note') });
  else await app.api.write('POST /v1/admin/payment-exceptions/acknowledgements', { key: f.dataset.key!, note: str(fd, 'note') });
  app.closeModal();
  app.toast('Acknowledged', 'success');
});
