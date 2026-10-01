/** Business money & insight: payments + refund approvals, payouts & settlement statement, reports, audit log. */

import { formatPHP } from '../../domain/money.ts';
import { DAY, DOW_SHORT, formatDateShort, formatDateTime, localDate, localToInstant, addDays } from '../../domain/time.ts';
import { action, app, form, str } from '../app.ts';
import { barChart, donut, heatmap } from '../charts.ts';
import { alertBox, btn, card, dl, empty, field, kpi, pageHeader, pill, select, tabs, tag } from '../components.ts';
import { html } from '../html.ts';
import { icon } from '../icons.ts';
import { download } from './booking.ts';
import { bizRoute } from './business.ts';
import { methodLogo } from './shared.ts';

bizRoute('/biz/payments', 'Payments', (_ctx, b) => {
  const tab = app.state<string>('payTab', 'refunds');
  const refunds = app.api.read('GET /v1/businesses/{businessId}/refunds', { businessId: b.businessId });
  const pays = app.api.read('GET /v1/businesses/{businessId}/payments', { businessId: b.businessId, limit: 60 });
  const pending = refunds.filter((r) => r.refund.status === 'pending_approval');
  const canApprove = b.perms.has('refunds.approve');
  return html`${pageHeader('Payments & refunds', { subtitle: 'Card numbers and wallet PINs never reach CourtKo — only provider references and masked details.' })}${tabs([{ key: 'refunds', label: 'Refunds', count: pending.length }, { key: 'payments', label: 'Payments', count: pays.page.total }], tab, 'pay.tab')}
  ${tab === 'refunds' ? html`${pending.length && !canApprove ? alertBox('info', `${pending.length} refund(s) await approval`, 'Someone with “Approve refunds” (the Business Owner) must approve them.') : ''}${card(refunds.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Requested</th><th>Booking</th><th>Customer</th><th>Reason</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead><tbody>${refunds.map((r) => html`<tr><td class="nowrap small">${formatDateShort(r.refund.createdAt)}<div class="xs muted">by ${r.requestedBy}</div></td><td><code>${r.booking ?? '—'}</code></td><td>${r.customer}</td><td class="small">${r.refund.reason}${r.refund.afterPayout ? html` ${tag('after payout', 'warning')}` : ''}${r.refund.failureReason ? html`<div class="xs" style="color:var(--ck-color-danger)">${r.refund.failureReason}</div>` : ''}</td><td class="num">${formatPHP(r.refund.amount)}</td><td>${pill(r.refund.status)}${r.refund.needsPlatformApproval ? html` ${tag('+ CourtKo approval', 'info')}` : ''}</td><td class="right nowrap">${r.refund.status === 'pending_approval' && r.refund.needsBusinessApproval && canApprove ? html`${btn('Approve', { action: 'rf.approve', data: { id: r.refund.id }, variant: 'primary', size: 'sm' })}${btn('Reject', { action: 'rf.reject', data: { id: r.refund.id }, variant: 'ghost', size: 'sm' })}` : ''}${r.refund.status === 'failed' && canApprove ? btn('Retry', { action: 'rf.retry', data: { id: r.refund.id }, variant: 'secondary', size: 'sm' }) : ''}</td></tr>`)}</tbody></table></div>` : empty('No refunds'), { pad: !refunds.length })}` : ''}
  ${tab === 'payments' ? card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>For</th><th>Customer</th><th>Method</th><th class="num">Amount</th><th class="num">Fee paid by player</th><th>Status</th><th></th></tr></thead><tbody>${pays.data.map((p) => html`<tr><td class="nowrap small">${formatDateTime(p.createdAt)}</td><td class="small">${p.summary}</td><td>${p.customer}</td><td><span class="row" style="gap:6px">${methodLogo(p.method)}<span class="xs">${p.methodDisplay}</span></span></td><td class="num">${formatPHP(p.amount)}</td><td class="num">${formatPHP(p.customerFee)}</td><td>${pill(p.status)}${p.confirmedVia === 'reconciliation' ? html` ${tag('healed', 'info')}` : ''}</td><td class="right">${p.status === 'pending' && b.perms.has('payments.confirm_status') ? btn('Re-check', { action: 'pay.recheck', data: { id: p.id }, variant: 'ghost', size: 'sm' }) : ''}</td></tr>`)}</tbody></table></div>`, { pad: false }) : ''}`;
});
action('pay.tab', (el) => app.set('payTab', el.dataset.key));
action('rf.approve', async (el) => {
  const ok = await app.confirm({ title: 'Approve refund?', body: 'The refund is sent to the customer’s original payment method. This action is audited.', confirmLabel: 'Approve refund' });
  if (ok) await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/refunds/{refundId}/approve', { businessId: app.businessId!, refundId: el.dataset.id! }), { success: 'Refund approved and submitted to the provider' });
});
action('rf.reject', async (el) => {
  const note = window.prompt('Reason for rejecting (recorded in the audit log):');
  if (note) await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/refunds/{refundId}/reject', { businessId: app.businessId!, refundId: el.dataset.id!, note }), { success: 'Refund rejected' });
});
action('rf.retry', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/refunds/{refundId}/retry', { businessId: app.businessId!, refundId: el.dataset.id! }), { success: 'Refund resubmitted' });
});
action('pay.recheck', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/payments/{paymentId}/recheck', { businessId: app.businessId!, paymentId: el.dataset.id! }));
  if (r) app.toast(`Provider says: ${r.result}. Staff can never mark a payment as paid manually.`, 'info');
});

bizRoute('/biz/payouts', 'Payouts', (_ctx, b) => {
  const d = app.api.read('GET /v1/businesses/{businessId}/payouts', { businessId: b.businessId });
  const now = app.store.now();
  const range = app.state('stmt', { from: localToInstant(addDays(localDate(now), -7), 0), to: localToInstant(addDays(localDate(now), 1), 0) });
  const st = app.api.read('GET /v1/businesses/{businessId}/settlements', { businessId: b.businessId, ...range });
  const acct = d.account;
  return html`${pageHeader('Payouts & settlement', { subtitle: 'Your share settles to your payment sub-account and is paid out daily to your bank.' })}
  <div class="grid g4">${kpi('Balance owed to you', formatPHP(d.balance), d.balance < 0 ? 'negative: recovering a refund after payout' : 'ledger balance', { icon: 'wallet' })}${kpi('Ready for next payout', formatPHP(d.settledUnpaid), 'settled funds', { icon: 'check', tone: 'info' })}${kpi('Awaiting settlement', formatPHP(d.pendingSettlement), 'provider settles T+1 (demo: 1 hour)', { icon: 'clock', tone: 'warning' })}${kpi('Paid out (all time)', formatPHP(d.payouts.filter((p) => p.status === 'paid').reduce((a, p) => a + p.amount, 0), { compact: true }), `${d.payouts.length} payouts`, { icon: 'receipt', tone: 'event' })}</div>
  <div class="split" style="margin-top:16px"><div class="stack">
    ${card(html`<div class="row-between"><span class="small">Statement (posting-date basis)</span><form data-form="stmt" class="row"><input type="date" name="from" value="${localDate(range.from)}" aria-label="From" style="width:auto"/><input type="date" name="to" value="${localDate(range.to - 1)}" aria-label="To" style="width:auto"/>${btn('Update', { type: 'submit', variant: 'secondary', size: 'sm' })}</form></div>
    <dl class="breakdown" style="margin-top:10px">${[['Opening balance', st.opening], ['Court bookings', st.bookingBase], ['Products', st.products], ['Events', st.events], ['Venue-funded discounts', st.venueDiscounts], ['CourtKo commission', st.commission], ['Refunds (your share)', st.refunds], ['Chargebacks', st.chargebacks], ['Adjustments', st.adjustments], ['Payouts sent', st.payouts], ['Failed payouts returned', st.failedPayouts]].map(([l, v]) => html`<div class="bd-row"><dt>${l}</dt><dd>${formatPHP(v as number, { signed: l !== 'Opening balance' })}</dd></div>`)}<div class="bd-row bd-total"><dt>Closing balance</dt><dd>${formatPHP(st.closing)}</dd></div></dl>
    <p class="xs muted">Every line comes from the append-only double-entry ledger. Gateway fees are borne by the player or CourtKo, not deducted from your share. ${b.perms.has('reports.export') ? '' : ''}</p>${b.perms.has('reports.export') ? btn('Download payouts CSV', { action: 'exp', data: { kind: 'payouts' }, variant: 'secondary', size: 'sm', icon: 'download' }) : ''}`, { title: 'Settlement statement' })}
    ${card(d.payouts.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Created</th><th>Paid</th><th class="num">Amount</th><th>Destination</th><th>Status</th></tr></thead><tbody>${d.payouts.slice(0, 30).map((p) => html`<tr><td class="small nowrap">${formatDateShort(p.createdAt)}</td><td class="small nowrap">${p.paidAt ? formatDateShort(p.paidAt) : '—'}</td><td class="num">${formatPHP(p.amount)}</td><td class="small">${p.destinationMasked}</td><td>${pill(p.status)}${p.failureReason ? html`<div class="xs" style="color:var(--ck-color-danger)">${p.failureReason}</div>` : ''}</td></tr>`)}</tbody></table></div>` : empty('No payouts yet'), { title: 'Payout history', pad: !d.payouts.length })}
  </div><div class="stack">
    ${card(html`${dl([['Status', pill(acct.status)], ['Account', acct.accountMasked ?? '—'], ['Provider sub-account', acct.providerSubAccountId ? html`<code>${acct.providerSubAccountId}</code>` : '—'], ['Model', d.settlementModel === 'provider_split' ? 'Provider split (Option A)' : 'Platform payout (Option B)']])}${b.perms.has('finance.manage_payout_account') ? html`<form data-form="payout.connect" class="stack-sm" style="margin-top:12px">${select({ name: 'bank', label: 'Bank', options: ['BPI', 'BDO', 'UnionBank', 'Metrobank', 'Landbank', 'Security Bank'].map((x) => ({ value: x, label: x })) })}${field({ name: 'last4', label: 'Account number — last 4 digits only', inputmode: 'numeric', maxlength: 4, required: true, hint: 'PLACEHOLDER flow: production hands off to the provider’s secure KYB onboarding; CourtKo never stores full account numbers.' })}${btn(acct.status === 'not_connected' ? 'Connect payout account' : 'Change payout account', { type: 'submit', variant: 'secondary' })}</form>${acct.status === 'pending_provider_setup' ? btn('Simulate provider verification', { action: 'payout.verify', variant: 'ghost', size: 'sm' }) : ''}` : html`<p class="xs muted">${icon('lock', 12)} Only the Business Owner can change payout details (requires two-step verification; everyone on the team is notified).</p>`}`, { title: 'Payout account' })}
    ${card(html`<ul class="bullets small"><li>Payments are split at capture: CourtKo's commission and fee recovery go to the platform account; your share goes to your sub-account.</li><li>A refund after payout makes your balance negative; it's recovered from your next payout (you're notified).</li><li>Withholding tax on e-marketplace remittances (BIR RR 16-2023) is configurable pending tax advice.</li></ul>`, { title: 'How settlement works' })}
  </div></div>`;
});
form('stmt', (fd) => app.set('stmt', { from: localToInstant(str(fd, 'from'), 0), to: localToInstant(str(fd, 'to'), 0) + DAY }));
form('payout.connect', async (fd) => {
  await app.api.write('PUT /v1/businesses/{businessId}/payout-account', { businessId: app.businessId!, bankName: str(fd, 'bank'), accountLast4: str(fd, 'last4') });
  app.toast('Payout account submitted for provider verification. Your team was notified.', 'success');
});
action('payout.verify', async (el) => {
  await app.run(el, () => app.api.write('POST /demo/businesses/{businessId}/payout-account/verify', { businessId: app.businessId! }), { success: 'Provider verified the sub-account (sandbox).' });
});
action('exp', async (el) => {
  const now = app.store.now();
  const r = await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/reports/exports', { businessId: app.businessId!, kind: el.dataset.kind as never, from: now - 60 * DAY, to: now + 31 * DAY }));
  if (r) {
    download(r.filename, r.content, 'text/csv');
    app.toast(`Exported ${r.rows} rows (recorded in the audit log).`, 'success');
  }
});

bizRoute('/biz/reports', 'Reports', (_ctx, b) => {
  const days = app.state<number>('repDays', 30);
  const now = app.store.now();
  const r = app.api.read('GET /v1/businesses/{businessId}/reports/summary', { businessId: b.businessId, from: now - days * DAY, to: now });
  const hours = Array.from({ length: 24 }, (_, i) => String(i));
  return html`${pageHeader('Reports', { subtitle: 'Each figure states its date basis — booking, play, payment, refund or payout date — and they are never mixed.', actions: html`<div class="seg">${[7, 30, 45].map((d) => html`<button class="${d === days ? 'active' : ''}" data-action="rep.days" data-d="${d}">${d} days</button>`)}</div>${b.perms.has('reports.export') ? html`${btn('Bookings CSV', { action: 'exp', data: { kind: 'bookings' }, variant: 'secondary', size: 'sm', icon: 'download' })}${btn('Payments CSV', { action: 'exp', data: { kind: 'payments' }, variant: 'secondary', size: 'sm', icon: 'download' })}` : ''}` })}
  <div class="grid g4">${kpi('Gross revenue', formatPHP(r.revenue.gross, { compact: true }), 'payment date', { icon: 'wallet' })}${kpi('Venue net', formatPHP(r.revenue.venueNet, { compact: true }), html`after ${formatPHP(r.revenue.commission, { compact: true })} commission`, { icon: 'receipt', tone: 'info' })}${kpi('Bookings played', String(r.playedBookings), `${r.createdBookings} booked (booking date)`, { icon: 'calendar', tone: 'event' })}${kpi('Utilization', `${Math.round(r.utilization.rate * 100)}%`, `${r.utilization.bookedHours.toFixed(0)} of ${r.utilization.availableHours.toFixed(0)} court-hours`, { icon: 'court', tone: 'warning' })}</div>
  <div class="split" style="margin-top:16px"><div class="stack">
    ${card(barChart(r.byDay.map((d) => ({ label: d.date.slice(5), value: d.revenue })), { title: 'Revenue by payment date', format: (n) => formatPHP(n) }), { title: 'Revenue', subtitle: 'Payment date basis' })}
    ${card(heatmap([1, 2, 3, 4, 5, 6, 0].map((d) => r.utilization.heat[d]!), { title: 'Booked court-hours by day and hour', rowLabels: [1, 2, 3, 4, 5, 6, 0].map((d) => DOW_SHORT[d]!), colLabels: hours }), { title: 'Peak hours', subtitle: 'Play date basis — darker is busier' })}
    ${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Court</th><th>Venue</th><th class="num">Booked hrs</th><th class="num">Utilization</th></tr></thead><tbody>${r.utilization.perCourt.map((c) => html`<tr><td>${c.name}</td><td class="small">${c.venue}</td><td class="num">${(c.bookedMin / 60).toFixed(0)}</td><td class="num"><div class="row" style="justify-content:flex-end"><div class="bar-inline" style="width:90px"><span style="width:${Math.round(c.rate * 100)}%"></span></div>${Math.round(c.rate * 100)}%</div></td></tr>`)}</tbody></table></div>`, { title: 'Court utilization', pad: false })}
  </div><div class="stack">
    ${card(donut([{ label: 'Courts', value: r.revenue.court, color: 'var(--ck-color-primary)' }, { label: 'Events', value: r.revenue.events, color: 'var(--ck-color-event)' }, { label: 'Products', value: r.revenue.products, color: 'var(--ck-color-accent-strong)' }], { title: 'Revenue mix', center: formatPHP(r.revenue.gross, { compact: true }) }), { title: 'Revenue mix' })}
    ${card(dl([['Cancellation rate', `${(r.cancellationRate * 100).toFixed(1)}%`], ['No-show rate', `${(r.noShowRate * 100).toFixed(1)}%`], ['Returning customers', `${r.returningCustomers} of ${r.customers}`], ['Venue-funded discounts', formatPHP(r.revenue.discounts)], [`Refunds (refund date)`, `${formatPHP(r.refunds.amount)} · ${r.refunds.count}`], ['Payouts (payout date)', `${formatPHP(r.payouts.amount)} · ${r.payouts.count}`], ['Fees paid by players', formatPHP(r.revenue.customerFees)]]), { title: 'Key rates' })}
    ${card(html`${r.topCustomers.map((c) => html`<div class="row-between small" style="padding:5px 0"><span>${c.name}</span><b>${c.sessions} sessions</b></div>`)}`, { title: 'Top regulars' })}
  </div></div>`;
});
action('rep.days', (el) => app.set('repDays', Number(el.dataset.d)));

bizRoute('/biz/audit', 'Audit log', (_ctx, b) => {
  const q = app.state<string>('audQ', '');
  const res = app.api.read('GET /v1/businesses/{businessId}/audit-logs', { businessId: b.businessId, q, limit: 80 });
  return html`${pageHeader('Audit log', { subtitle: 'Append-only record of sensitive actions in your business. Entries cannot be edited or deleted.' })}<form data-form="aud.q" class="row" style="margin-bottom:12px"><input name="q" type="search" value="${q}" placeholder="Search action, person or detail" aria-label="Search audit log" style="max-width:360px"/></form>
  ${card(res.data.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>${res.data.map((a) => html`<tr><td class="nowrap small">${formatDateTime(a.at)}</td><td class="small">${a.actorLabel}${a.supportSessionId ? html` ${tag('support', 'warning')}` : ''}</td><td><code class="xs">${a.action}</code></td><td class="small">${a.summary}${a.reason ? html`<div class="xs muted">Reason: ${a.reason}</div>` : ''}</td></tr>`)}</tbody></table></div>` : empty('No audit entries'), { pad: false })}`;
});
form('aud.q', (fd) => app.set('audQ', str(fd, 'q')));
