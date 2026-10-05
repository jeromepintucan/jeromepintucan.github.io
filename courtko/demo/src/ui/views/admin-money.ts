/** SuperAdmin money: transactions & ledger, reconciliation, commissions (maker-checker), payouts, refunds, disputes, reports. */

import { totals } from '../../domain/ledger.ts';
import { formatPHP, formatPpm, parsePercentInput } from '../../domain/money.ts';
import { DAY, formatDateShort, formatDateTime, localDate, localToInstant } from '../../domain/time.ts';
import { action, app, form, str } from '../app.ts';
import { barChart, donut } from '../charts.ts';
import { alertBox, btn, card, checkbox, dl, empty, field, kpi, pageHeader, pill, select, tabs, tag, textarea } from '../components.ts';
import { html } from '../html.ts';
import { icon } from '../icons.ts';
import { download } from './booking.ts';
import { adminRoute } from './admin.ts';
import { methodLogo } from './shared.ts';
import { exceptionsView } from './exceptions.ts';

adminRoute('/admin/payment-exceptions', 'Payment exceptions', () => {
  const d = app.api.read('GET /v1/admin/payment-exceptions');
  return html`${pageHeader('Payment exceptions', { subtitle: 'Everything in the money flow that needs a person: failed refunds and payouts, stuck or mismatched payments, chargebacks and provider incidents.' })}${exceptionsView(d, 'platform')}`;
});

adminRoute('/admin/transactions', 'Transactions', () => {
  const tab = app.state<string>('txTab', 'payments');
  const pays = app.api.read('GET /v1/admin/payments', { limit: 60 });
  const journals = tab === 'ledger' ? app.api.read('GET /v1/admin/ledger/journals', { limit: 40 }) : null;
  const tot = app.api.read('GET /v1/admin/ledger/totals');
  const recon = tab === 'recon' ? app.api.read('GET /v1/admin/reconciliation') : null;
  const open = app.ui.journalOpen as string | undefined;
  return html`${pageHeader('Transactions', { subtitle: 'Payments, the double-entry ledger, and provider reconciliation' })}
  <div class="grid g4">${kpi('Provider clearing', formatPHP(tot.providerClearing!), 'funds at the provider (all accounts)', { icon: 'wallet' })}${kpi('Commission revenue', formatPHP(tot.commissionRevenue!), 'ledger balance', { icon: 'percent', tone: 'info' })}${kpi('Gateway fees', formatPHP(tot.feeExpense!), html`recovered ${formatPHP(tot.feeRecovery!)}`, { icon: 'card', tone: 'warning' })}${kpi('Platform promos', formatPHP(tot.promotionsExpense!), 'platform-funded discounts', { icon: 'gift', tone: 'event' })}</div>
  <div style="margin-top:16px">${tabs([{ key: 'payments', label: 'Payments' }, { key: 'ledger', label: 'Ledger journals' }, { key: 'recon', label: 'Reconciliation' }], tab, 'tx.tab')}</div>
  ${tab === 'payments' ? card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Captured</th><th>Business</th><th>Customer</th><th>Method</th><th class="num">Amount</th><th class="num">Fee est. / actual</th><th>Refs</th><th>Status</th><th></th></tr></thead><tbody>${pays.data.map((r) => html`<tr><td class="small nowrap">${formatDateTime(r.payment.capturedAt ?? r.payment.createdAt)}</td><td class="small">${r.business}</td><td class="small">${r.customer}</td><td>${methodLogo(r.payment.method)}</td><td class="num">${formatPHP(r.payment.amount)}</td><td class="num small">${formatPHP(r.payment.estimatedProviderFee)} / ${r.payment.actualProviderFee !== null ? formatPHP(r.payment.actualProviderFee) : '—'}</td><td class="xs"><code>${r.payment.id}</code><br/><code>${r.payment.providerPaymentId ?? r.payment.providerSessionId}</code></td><td>${pill(r.payment.status)}${r.payment.confirmedVia === 'reconciliation' ? html` ${tag('healed', 'info')}` : ''}</td><td class="right">${r.payment.status === 'captured' ? btn('Chargeback (demo)', { action: 'tx.cb', data: { id: r.payment.id }, variant: 'ghost', size: 'sm' }) : ''}</td></tr>`)}</tbody></table></div>`, { pad: false }) : ''}
  ${tab === 'ledger' && journals ? html`<div class="split"><div>${card(html`<div class="table-wrap"><table class="table"><thead><tr><th class="num">#</th><th>Posted</th><th>Type</th><th>Description</th><th class="num">Debits = Credits</th></tr></thead><tbody>${journals.data.map((j) => { const t = totals(j.lines); return html`<tr class="clickable" data-action="jnl.open" data-id="${j.id}" tabindex="0"><td class="num xs">${j.seq}</td><td class="small nowrap">${formatDateTime(j.postedAt)}</td><td><code class="xs">${j.type}</code></td><td class="small">${j.description}</td><td class="num">${formatPHP(t.debit)} ${t.debit === t.credit ? icon('check', 14, 'balanced') : icon('alert', 14, 'unbalanced')}</td></tr>`; })}</tbody></table></div>`, { pad: false })}</div>
    <div>${open ? (() => { const j = journals.data.find((x) => x.id === open) ?? null; if (!j) return ''; return card(html`<p class="small">${j.description}</p><div class="table-wrap"><table class="table"><thead><tr><th>Account</th><th>Entry type</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>${j.lines.map((l) => html`<tr><td class="xs"><code>${l.account.replace(/venue:biz_[a-z0-9]+:/, 'venue:…:')}</code></td><td class="xs">${l.entryType}</td><td class="num">${l.direction === 'debit' ? formatPHP(l.amount) : ''}</td><td class="num">${l.direction === 'credit' ? formatPHP(l.amount) : ''}</td></tr>`)}</tbody></table></div><p class="xs muted">Journals are append-only; corrections are made with reversing journals, never edits.</p>`, { title: `Journal #${j.seq}`, pad: true }); })() : card(html`<p class="small muted">Select a journal to see its debit/credit lines. Every journal must balance before it is posted.</p>`, { title: 'Journal lines' })}</div></div>` : ''}
  ${tab === 'recon' && recon ? html`${alertBox(recon.balanced ? 'success' : 'danger', recon.balanced ? 'Provider balances match the ledger' : 'Provider balances do not match the ledger', `Provider (master + sub-accounts): ${formatPHP(recon.providerTotal)} · ledger provider clearing: ${formatPHP(recon.ledgerClearing)}`, btn('Run reconciliation now', { action: 'rec.run', variant: 'secondary', size: 'sm', icon: 'refresh' }))}
    <div class="chips" style="margin:12px 0">${Object.entries(recon.counts).map(([k, n]) => tag(`${k.replace(/_/g, ' ')}: ${n}`, k === 'matched' ? 'success' : k === 'fee_variance' ? 'info' : 'danger'))}</div>
    ${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Issue</th><th>Payment</th><th>Provider</th><th>Platform</th><th class="num">Amount</th><th>Detail</th><th></th></tr></thead><tbody>${recon.rows.filter((r) => r.issue !== 'matched').slice(0, 50).map((r) => html`<tr><td>${pill(r.issue)}</td><td class="xs"><code>${r.paymentId ?? '—'}</code></td><td>${r.providerStatus}</td><td>${r.internalStatus ?? '—'}</td><td class="num">${formatPHP(r.amount)}</td><td class="small">${r.detail}</td><td>${r.issue === 'missing_capture' && r.paymentId ? btn('Heal', { action: 'rec.heal', data: { id: r.paymentId }, variant: 'primary', size: 'sm' }) : ''}</td></tr>`)}</tbody></table></div>${recon.rows.every((r) => r.issue === 'matched') ? empty('All provider payments matched') : ''}<p class="xs muted" style="padding:10px 14px">Matched: ${recon.counts.matched ?? 0}. Try the presenter's “Drop payment webhooks” mode, pay for a booking, then heal it here (the 5-minute reconciliation job would also catch it).</p>`, { pad: false })}` : ''}`;
});
action('tx.tab', (el) => app.set('txTab', el.dataset.key));
action('jnl.open', (el) => app.set('journalOpen', el.dataset.id));
action('rec.run', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /v1/admin/reconciliation/runs', undefined as never));
  if (r) app.toast(`Reconciliation complete — ${r.healed} payment(s) healed.`, 'success');
});
action('rec.heal', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/admin/reconciliation/payments/{paymentId}/heal', { paymentId: el.dataset.id! }), { success: 'Provider re-queried; payment confirmed and booking fulfilled.' });
});
action('tx.cb', async (el) => {
  const ok = await app.confirm({ title: 'Simulate a chargeback?', body: 'The sandbox issuer opens a dispute on this payment. You can then submit evidence and decide the outcome under Disputes.', confirmLabel: 'Open dispute' });
  if (ok) await app.run(el, () => app.api.write('POST /demo/payments/{paymentId}/chargeback', { paymentId: el.dataset.id! }), { success: 'Dispute requested — the provider webhook arrives in a moment.' });
});

adminRoute('/admin/commissions', 'Commissions', () => {
  const d = app.api.read('GET /v1/admin/commission-agreements');
  const me = app.me();
  const pending = d.approvals.filter((a) => a.approval.status === 'pending');
  return html`${pageHeader('Commissions', { subtitle: 'Global default and per-business agreements. Changes need a second administrator (maker-checker).' })}
  ${pending.length ? html`<div class="stack-sm" style="margin-bottom:16px">${pending.map((a) => alertBox('warning', `Awaiting approval: ${a.approval.summary}`, html`Requested by ${a.requestedBy} · ${formatDateTime(a.approval.requestedAt)} · payload hash <code>${a.approval.payloadHash.slice(0, 12)}</code>${a.approval.requestedBy === me?.profile?.displayName ? html`<br/><b>You made this request — another administrator must approve it.</b> (Demo: sign in as Carla Mendoza, Finance Ops, in another tab.)` : ''}`, html`${btn('Approve', { action: 'apr.decide', data: { id: a.approval.id, ok: '1' }, variant: 'primary', size: 'sm' })}${btn('Reject', { action: 'apr.decide', data: { id: a.approval.id, ok: '0' }, variant: 'ghost', size: 'sm' })}`))}</div>` : ''}
  <div class="split"><div>${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Scope</th><th class="num">Rate</th><th>Effective</th><th>Applies to</th><th>Approved by</th><th>Status</th></tr></thead><tbody>${d.agreements.map((a) => html`<tr><td><b>${a.business}</b><div class="xs muted">${a.agreement.note}</div></td><td class="num"><b>${formatPpm(a.agreement.ratePpm)}</b></td><td class="small nowrap">${formatDateShort(a.agreement.effectiveFrom)} → ${a.agreement.effectiveTo ? formatDateShort(a.agreement.effectiveTo) : 'open'}</td><td class="small">Courts${a.agreement.appliesToEvents ? ', events' : ''}${a.agreement.appliesToProducts ? ', products' : ''}</td><td class="small">${a.createdBy} → ${a.approvedBy ?? '—'}</td><td>${pill(a.agreement.status)}</td></tr>`)}</tbody></table></div>`, { title: 'Agreements', pad: false })}</div>
  <div>${card(html`<form data-form="com.propose" class="stack-sm">${select({ name: 'businessId', label: 'Scope', options: [{ value: '', label: 'Platform default (all businesses)' }, ...d.businesses.map((b) => ({ value: b.id, label: b.name }))] })}${field({ name: 'rate', label: 'Commission %', value: '4.5', required: true })}${field({ name: 'from', label: 'Effective from', type: 'date', value: localDate(app.store.now()) })}${field({ name: 'to', label: 'Effective until (optional)', type: 'date' })}${checkbox({ name: 'events', label: 'Also applies to event registrations', checked: true })}${checkbox({ name: 'products', label: 'Also applies to products' })}${textarea({ name: 'note', label: 'Commercial agreement reference', required: true, value: 'Signed agreement OPH-2026-02' })}${btn('Submit for approval', { type: 'submit', variant: 'primary', block: true })}</form><p class="xs muted" style="margin-top:8px">Bookings keep the rate that applied when they were priced — changes never alter past receipts or statements.</p>`, { title: 'Propose a change' })}</div></div>
  ${card(html`${d.approvals.filter((a) => a.approval.status !== 'pending').slice(0, 10).map((a) => html`<div class="row-between small" style="padding:5px 0"><span>${a.approval.summary}</span><span>${pill(a.approval.status)} <span class="muted">${a.requestedBy} → ${a.decidedBy ?? '—'}</span></span></div>`)}${d.approvals.length ? '' : html`<p class="small muted">No decisions yet.</p>`}`, { title: 'Approval history' })}`;
});
form('com.propose', async (fd) => {
  const ppm = parsePercentInput(str(fd, 'rate'));
  if (ppm === null) return app.toast('Enter a valid percentage.', 'warning');
  await app.api.write('POST /v1/admin/commission-agreements', { businessId: str(fd, 'businessId') || null, ratePpm: ppm, effectiveFrom: localToInstant(str(fd, 'from'), 0), effectiveTo: str(fd, 'to') ? localToInstant(str(fd, 'to'), 0) : null, appliesToEvents: !!fd.get('events'), appliesToProducts: !!fd.get('products'), note: str(fd, 'note') });
  app.toast('Submitted. A second administrator must approve it.', 'success');
});
action('apr.decide', async (el) => {
  const note = el.dataset.ok === '1' ? 'Verified against signed agreement' : window.prompt('Reason for rejecting:') ?? '';
  await app.run(el, () => app.api.write('POST /v1/admin/approval-requests/{approvalId}/decision', { approvalId: el.dataset.id!, approve: el.dataset.ok === '1', note }), { success: 'Decision recorded' });
});

adminRoute('/admin/payouts', 'Payouts', () => {
  const res = app.api.read('GET /v1/admin/payouts', { limit: 80 });
  return html`${pageHeader('Payouts', { subtitle: 'Sub-account withdrawals to venue bank accounts (Option A: provider split)' })}${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Created</th><th>Business</th><th class="num">Amount</th><th>Destination</th><th class="num">Attempts</th><th>Status</th><th></th></tr></thead><tbody>${res.data.map((p) => html`<tr><td class="small nowrap">${formatDateShort(p.createdAt)}</td><td class="small">${app.store.read((db) => db.get('businesses', p.businessId)?.tradeName ?? '')}</td><td class="num">${formatPHP(p.amount)}</td><td class="small">${p.destinationMasked}</td><td class="num">${p.attempts}</td><td>${pill(p.status)}${p.failureReason ? html`<div class="xs" style="color:var(--ck-color-danger)">${p.failureReason}</div>` : ''}</td><td class="right">${p.status === 'failed' ? btn('Retry', { action: 'po.retry', data: { id: p.id }, variant: 'primary', size: 'sm' }) : ''}</td></tr>`)}</tbody></table></div>`, { pad: false })}`;
});
action('po.retry', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/admin/payouts/{payoutId}/retry', { payoutId: el.dataset.id! }), { success: 'Payout resubmitted to the provider' });
});

adminRoute('/admin/refunds', 'Refunds', () => {
  const list = app.api.read('GET /v1/admin/refunds');
  return html`${pageHeader('Refunds', { subtitle: 'Refunds above the threshold or after payout also need platform approval' })}${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Requested</th><th>Business</th><th>Customer</th><th>Reason</th><th class="num">Amount</th><th>Approvals</th><th>Status</th><th></th></tr></thead><tbody>${list.slice(0, 80).map((r) => html`<tr><td class="small nowrap">${formatDateShort(r.refund.createdAt)}</td><td class="small">${r.business}</td><td class="small">${r.customer}</td><td class="small">${r.refund.reason}${r.refund.afterPayout ? html` ${tag('after payout', 'warning')}` : ''}</td><td class="num">${formatPHP(r.refund.amount)}</td><td class="small">${r.refund.needsBusinessApproval ? 'Business pending' : ''}${r.refund.needsPlatformApproval ? ' Platform pending' : ''}${!r.refund.needsBusinessApproval && !r.refund.needsPlatformApproval ? '—' : ''}</td><td>${pill(r.refund.status)}</td><td class="right nowrap">${r.refund.status === 'pending_approval' && r.refund.needsPlatformApproval && !r.refund.needsBusinessApproval ? html`${btn('Approve', { action: 'arf.approve', data: { id: r.refund.id }, variant: 'primary', size: 'sm' })}${btn('Reject', { action: 'arf.reject', data: { id: r.refund.id }, variant: 'ghost', size: 'sm' })}` : ''}${r.refund.status === 'failed' ? btn('Retry', { action: 'arf.retry', data: { id: r.refund.id }, variant: 'secondary', size: 'sm' }) : ''}</td></tr>`)}</tbody></table></div>`, { pad: false })}`;
});
action('arf.approve', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/admin/refunds/{refundId}/approve', { refundId: el.dataset.id! }), { success: 'Approved' });
});
action('arf.reject', async (el) => {
  const note = window.prompt('Reason for rejecting:');
  if (note) await app.run(el, () => app.api.write('POST /v1/admin/refunds/{refundId}/reject', { refundId: el.dataset.id!, note }), { success: 'Rejected' });
});
action('arf.retry', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/admin/refunds/{refundId}/retry', { refundId: el.dataset.id! }), { success: 'Resubmitted' });
});

adminRoute('/admin/disputes', 'Disputes', () => {
  const list = app.api.read('GET /v1/admin/disputes');
  return html`${pageHeader('Disputes & chargebacks', { subtitle: 'Open a sandbox chargeback from Transactions → Payments to try this flow' })}${list.length ? html`<div class="stack-sm">${list.map((d) => html`<div class="card"><div class="card-body"><div class="row-between"><div><b>${formatPHP(d.amount)}</b> · ${d.reason} ${pill(d.status)}<div class="xs muted">Opened ${formatDateTime(d.openedAt)} · evidence due ${formatDateShort(d.dueAt)} · payment <code>${d.paymentId}</code></div></div></div>${d.evidence.map((e) => html`<div class="small" style="margin-top:6px">${icon('receipt', 14)} ${e.note}</div>`)}${d.status === 'open' || d.status === 'evidence_submitted' ? html`<form data-form="dsp.evidence" data-id="${d.id}" class="row" style="margin-top:10px"><input name="note" placeholder="Evidence (e.g. check-in log, QR scan time, receipt)" value="Player checked in via QR at the front desk; booking completed." style="flex:1" aria-label="Evidence"/>${btn('Submit evidence', { type: 'submit', variant: 'secondary', size: 'sm' })}</form><div class="row" style="margin-top:8px"><span class="xs muted">Sandbox issuer decision:</span>${btn('Won', { action: 'dsp.outcome', data: { id: d.id, o: 'WON' }, variant: 'ghost', size: 'sm' })}${btn('Lost (chargeback)', { action: 'dsp.outcome', data: { id: d.id, o: 'LOST' }, variant: 'ghost', size: 'sm' })}</div>` : ''}</div></div>`)}</div>` : empty('No disputes', undefined, undefined, 'scale')}`;
});
form('dsp.evidence', async (fd, f) => {
  await app.api.write('POST /v1/admin/disputes/{disputeId}/evidence', { disputeId: f.dataset.id!, note: str(fd, 'note') });
  app.toast('Evidence submitted', 'success');
});
action('dsp.outcome', async (el) => {
  await app.run(el, () => app.api.write('POST /demo/disputes/{disputeId}/outcome', { disputeId: el.dataset.id!, outcome: el.dataset.o as 'WON' | 'LOST' }), { success: 'Decision requested — webhook arrives shortly' });
});

adminRoute('/admin/reports', 'Reports', () => {
  const days = app.state<number>('arDays', 30);
  const now = app.store.now();
  const r = app.api.read('GET /v1/admin/reports/summary', { from: now - days * DAY, to: now });
  const colors = ['#0F7A5A', '#0369A1', '#6D28D9', '#B45309', '#9BC93A', '#B91C1C'];
  return html`${pageHeader('Platform reports', { actions: html`<div class="seg">${[7, 30, 45].map((d) => html`<button class="${d === days ? 'active' : ''}" data-action="ar.days" data-d="${d}">${d} days</button>`)}</div>${btn('Payments CSV', { action: 'ar.export', variant: 'secondary', size: 'sm', icon: 'download' })}` })}
  <div class="grid g4">${kpi('GBV', formatPHP(r.gbv, { compact: true }), `${r.successfulPayments} payments · ${(r.successRate * 100).toFixed(1)}% success`, { icon: 'wallet' })}${kpi('Commission', formatPHP(r.commission, { compact: true }), 'ledger (posting date)', { icon: 'percent', tone: 'info' })}${kpi('Gateway fees', formatPHP(r.gatewayFees, { compact: true }), html`recovered ${formatPHP(r.feeRecovery, { compact: true })}`, { icon: 'card', tone: 'warning' })}${kpi('Refunds', formatPHP(r.refunds, { compact: true }), `${r.chargebacks} chargebacks lost`, { icon: 'refresh', tone: 'danger' })}</div>
  <div class="split" style="margin-top:16px"><div class="stack">${card(barChart(r.topBusinesses.map((b) => ({ label: b.name.split(' ').slice(0, 2).join(' '), value: b.gbv })), { title: 'GBV by business', format: (n) => formatPHP(n) }), { title: 'Gross booking value by business' })}
  ${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Business</th><th class="num">Payments</th><th class="num">GBV</th><th class="num">Commission</th></tr></thead><tbody>${r.topBusinesses.map((b) => html`<tr><td>${b.name}</td><td class="num">${b.bookings}</td><td class="num">${formatPHP(b.gbv)}</td><td class="num">${formatPHP(b.commission)}</td></tr>`)}</tbody></table></div>`, { pad: false })}</div>
  <div class="stack">${card(donut(r.methods.map((m, i) => ({ label: m.label, value: m.amount, color: colors[i % colors.length]! })), { title: 'Payment method mix' }), { title: 'Payment methods' })}
  ${card(dl([['Failed payments', String(r.failedPayments)], ['Pending payouts', String(r.pendingPayouts)], ['Failed payouts', String(r.failedPayouts)], ['Event registrations', String(r.eventRegistrations)], ['Product orders', String(r.productOrders)], ['Utilization (all venues)', `${Math.round(r.utilization * 100)}%`], ['Platform promo cost', formatPHP(r.promotions)], ['Support / content reports', String(r.supportReports)]]), { title: 'Operations' })}</div></div>`;
});
action('ar.days', (el) => app.set('arDays', Number(el.dataset.d)));
action('ar.export', async (el) => {
  const now = app.store.now();
  const r = await app.run(el, () => Promise.resolve(app.api.write('POST /v1/businesses/{businessId}/reports/exports', { kind: 'payments', from: now - 60 * DAY, to: now } as never)));
  if (r) download(r.filename, r.content, 'text/csv');
});
