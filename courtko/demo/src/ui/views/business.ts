/** Business portal: onboarding wizard + overview (decisions, exceptions, today's activity, money summary). */

import { formatPHP } from '../../domain/money.ts';
import { DAY, formatDateLong, formatTime, formatTimeRange, localDate, localToInstant } from '../../domain/time.ts';
import { validateUpload } from '../../domain/validation.ts';
import { DOCUMENT_LABEL, REQUIRED_DOCUMENTS } from '../../services/businesses.ts';
import type { DocumentType } from '../../services/model.ts';
import { action, app, form, onChange, route, str, type ViewCtx } from '../app.ts';
import { barChart } from '../charts.ts';
import { alertBox, btn, card, checkbox, dl, empty, field, kpi, pageHeader, pill, select, steps, tag } from '../components.ts';
import { html, type SafeHtml } from '../html.ts';
import { icon } from '../icons.ts';
import { bizContext, type BizContext } from '../layouts.ts';

export function requireBiz(ctx: ViewCtx): BizContext {
  const b = bizContext(ctx.me);
  if (!b) throw new NoBusiness();
  return b;
}
class NoBusiness extends Error {}

export function noBizView(): SafeHtml {
  return html`<div class="state-panel">${icon('building', 36)}<h1>No business yet</h1><p class="muted">Register your venue business to start accepting bookings.</p>${btn('Register a business', { href: '#/biz/onboarding', variant: 'primary' })}</div>`;
}

export function bizRoute(pattern: string, title: string, view: (ctx: ViewCtx, b: BizContext) => SafeHtml): void {
  route(
    pattern,
    'business',
    title,
    (ctx) => {
      try {
        return view(ctx, requireBiz(ctx));
      } catch (e) {
        if (e instanceof NoBusiness) return noBizView();
        throw e;
      }
    },
    { auth: true },
  );
}

// ---------------------------------------------------------------- onboarding

route('/biz/onboarding', 'business', 'Register your business', (ctx) => {
  const me = ctx.me!;
  const draft = me.memberships.find((m) => ['draft', 'rejected'].includes(m.business.status));
  const pending = me.memberships.find((m) => m.business.status === 'pending_verification');
  if (pending && !draft)
    return html`${pageHeader('Verification in progress')}${steps(['Business details', 'Documents', 'Review', 'Approved'], 2)}${card(html`${alertBox('info', `${pending.business.tradeName} is being reviewed`, 'CourtKo usually reviews documents within 1–2 business days. Meanwhile you can set up venues, courts and pricing — they go live when you are approved.')}<div class="row" style="margin-top:12px">${btn('Set up courts', { href: '#/biz/courts', variant: 'primary' })}${btn('Pricing', { href: '#/biz/pricing', variant: 'secondary' })}</div>`)}`;
  if (!draft) {
    return html`${pageHeader('Register your business', { subtitle: 'Step 1 of 3 — tell us about your business. You need a verified CourtKo account.' })}${steps(['Business details', 'Documents', 'Review', 'Approved'], 0)}
    ${card(html`<form data-form="onb.register" class="form-grid">
      ${field({ name: 'legalName', label: 'Registered business name', required: true, hint: 'Exactly as on your DTI/SEC/CDA registration.' })}${field({ name: 'tradeName', label: 'Trade name (shown to players)', required: true })}
      ${select({ name: 'type', label: 'Business type', options: [{ value: 'sole_proprietorship', label: 'Sole proprietorship (DTI)' }, { value: 'partnership', label: 'Partnership (SEC)' }, { value: 'corporation', label: 'Corporation (SEC)' }, { value: 'cooperative', label: 'Cooperative (CDA)' }] })}${field({ name: 'registrationNo', label: 'DTI / SEC / CDA registration no.', required: true })}
      ${field({ name: 'tin', label: 'TIN', required: true, inputmode: 'numeric', hint: 'Stored masked; only the last digits are displayed.' })}${field({ name: 'contactPhone', label: 'Business mobile', type: 'tel', required: true, placeholder: '0917 000 0000' })}
      ${field({ name: 'contactEmail', label: 'Business email', type: 'email', required: true })}${field({ name: 'line1', label: 'Street address', required: true })}
      ${field({ name: 'barangay', label: 'Barangay', required: true })}${field({ name: 'city', label: 'City / municipality', required: true })}${field({ name: 'province', label: 'Province', required: true })}
      <div class="full">${checkbox({ name: 'vat', label: 'We are VAT-registered (prices shown to players will include 12% VAT)' })}${checkbox({ name: 'consent', label: 'I confirm I am authorized to register this business and the information is accurate.', required: true })}</div>
      <div class="full">${btn('Continue to documents', { type: 'submit', variant: 'primary', size: 'lg' })}</div></form>`)}`;
  }
  const docs = app.state<Partial<Record<DocumentType, { fileName: string; sizeBytes: number; mime: string }>>>('onbDocs', {});
  const allTypes: DocumentType[] = [...REQUIRED_DOCUMENTS, 'proof_of_bank_account'];
  return html`${pageHeader(`Documents for ${draft.business.tradeName}`, { subtitle: 'Step 2 of 3 — upload verification documents (PDF, JPG or PNG, up to 10 MB each).' })}${steps(['Business details', 'Documents', 'Review', 'Approved'], 1)}
  ${draft.business.status === 'rejected' ? alertBox('warning', 'Your previous submission was not approved', 'Please review the note in your notifications and upload updated documents.') : ''}
  ${card(html`<div class="stack-sm">${allTypes.map((t) => html`<div class="row-between" style="padding:10px 0;border-bottom:1px solid var(--ck-slate-100)"><div><b>${DOCUMENT_LABEL[t]}</b>${REQUIRED_DOCUMENTS.includes(t) ? html` <span class="req">*</span>` : html` <span class="xs muted">(optional now — needed for payouts)</span>`}<div class="xs muted">${docs[t] ? html`${icon('checkCircle', 12)} ${docs[t]!.fileName} · ${(docs[t]!.sizeBytes / 1024).toFixed(0)} KB · malware scan: clean` : 'Not uploaded'}</div></div><label class="btn btn-secondary btn-sm">${icon('upload', 16)}<span>${docs[t] ? 'Replace' : 'Upload'}</span><input type="file" accept="application/pdf,image/jpeg,image/png" class="sr-only" data-change="onb.file" data-type="${t}"/></label></div>`)}</div>
  <p class="xs muted" style="margin-top:10px">${icon('lock', 12)} Demo: files never leave your browser — only the file name, type and size are recorded. In production, uploads go to a quarantine bucket, are malware-scanned, re-encoded (EXIF/GPS stripped) and encrypted; only compliance reviewers can open them.</p>
  <form data-form="onb.submit" data-biz="${draft.business.id}" style="margin-top:14px">${btn('Submit for verification', { type: 'submit', variant: 'primary', size: 'lg', disabled: !REQUIRED_DOCUMENTS.every((t) => docs[t]) })}</form>`)}`;
}, { auth: true });

form('onb.register', async (fd) => {
  const b = await app.api.write('POST /v1/businesses', { legalName: str(fd, 'legalName'), tradeName: str(fd, 'tradeName'), type: str(fd, 'type') as never, registrationNo: str(fd, 'registrationNo'), tin: str(fd, 'tin'), contactEmail: str(fd, 'contactEmail'), contactPhone: str(fd, 'contactPhone'), line1: str(fd, 'line1'), barangay: str(fd, 'barangay'), city: str(fd, 'city'), province: str(fd, 'province'), vatRegistered: fd.get('vat') === 'on' });
  app.businessId = b.id;
  app.toast('Business registered. Next: upload documents.', 'success');
});
onChange('onb.file', (el) => {
  const input = el as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  const problem = validateUpload({ name: f.name, size: f.size, type: f.type });
  if (problem) return app.toast(problem, 'warning');
  const docs = app.state<Record<string, unknown>>('onbDocs', {});
  docs[input.dataset.type!] = { fileName: f.name, sizeBytes: f.size, mime: f.type };
  input.value = '';
  app.render();
});
form('onb.submit', async (_fd, f) => {
  const docs = app.state<Record<string, { fileName: string; sizeBytes: number; mime: string }>>('onbDocs', {});
  await app.api.write('POST /v1/businesses/{businessId}/verification-submissions', { businessId: f.dataset.biz!, documents: Object.entries(docs).map(([type, d]) => ({ type: type as DocumentType, ...d })) });
  app.ui.onbDocs = {};
  app.toast('Submitted! We will notify you when your business is approved.', 'success');
});

// ---------------------------------------------------------------- overview

bizRoute('/biz', 'Overview', (ctx, b) => {
  const p = (x: string) => b.perms.has(x);
  const ov = app.api.read('GET /v1/businesses/{businessId}', { businessId: b.businessId });
  const now = app.store.now();
  const today = localDate(now);
  const dayStart = localToInstant(today, 0);
  const todays = p('bookings.view') ? app.api.read('GET /v1/businesses/{businessId}/bookings', { businessId: b.businessId, from: dayStart, to: dayStart + DAY, limit: 100 }).data.filter((r) => !['cancelled', 'refunded', 'expired', 'failed'].includes(r.booking.status)) : [];
  const upcoming = todays.filter((r) => r.booking.endMs > now).slice(0, 8);
  const inPlay = todays.filter((r) => r.booking.startMs <= now && r.booking.endMs > now).length;
  const toCheckIn = todays.filter((r) => r.booking.status === 'confirmed' && r.booking.startMs - 30 * 60_000 <= now && r.booking.endMs > now);
  const noShowCandidates = todays.filter((r) => r.booking.status === 'confirmed' && now > r.booking.startMs + 15 * 60_000 && r.booking.endMs > now);
  const refunds = p('payments.view') ? app.api.read('GET /v1/businesses/{businessId}/refunds', { businessId: b.businessId }) : [];
  const pendingApprovals = refunds.filter((r) => r.refund.status === 'pending_approval' && r.refund.needsBusinessApproval);
  const failedRefunds = refunds.filter((r) => r.refund.status === 'failed');
  const orders = p('orders.fulfill') ? app.api.read('GET /v1/businesses/{businessId}/orders', { businessId: b.businessId }).filter((o) => ['paid', 'preparing', 'ready_for_pickup'].includes(o.order.status)) : [];
  const payouts = p('finance.view_payouts') ? app.api.read('GET /v1/businesses/{businessId}/payouts', { businessId: b.businessId }) : null;
  const report = p('reports.view') ? app.api.read('GET /v1/businesses/{businessId}/reports/summary', { businessId: b.businessId, from: now - 7 * DAY, to: now }) : null;
  const restrictionsAppeals = p('restrictions.manage') ? app.api.read('GET /v1/businesses/{businessId}/restrictions', { businessId: b.businessId }).filter((r) => r.restriction.appeal.status === 'submitted') : [];
  const alerts: SafeHtml[] = [];
  if (ov.business.status === 'pending_verification') alerts.push(alertBox('info', 'Verification in progress', 'Your venues go live once CourtKo approves your documents.'));
  if (ov.business.status === 'suspended') alerts.push(alertBox('danger', 'Business suspended', `${ov.business.statusReason ?? ''} New bookings are paused; existing bookings are honored.`));
  if (p('finance.view_payouts') && ov.business.payoutAccount.status !== 'verified') alerts.push(alertBox('warning', 'Connect your payout account', 'Settlements start once your payout account is verified by the payment provider.', btn('Set up payouts', { href: '#/biz/payouts', variant: 'secondary', size: 'sm' })));
  if (pendingApprovals.length) alerts.push(alertBox('warning', `${pendingApprovals.length} refund${pendingApprovals.length > 1 ? 's' : ''} waiting for your approval`, pendingApprovals.map((r) => `${formatPHP(r.refund.amount)} — ${r.refund.reason} (requested by ${r.requestedBy})`).join(' · '), btn('Review', { href: '#/biz/payments', variant: 'secondary', size: 'sm' })));
  if (failedRefunds.length) alerts.push(alertBox('danger', `${failedRefunds.length} refund(s) failed at the provider`, 'Retry them from Payments.', btn('Open payments', { href: '#/biz/payments', variant: 'secondary', size: 'sm' })));
  if (payouts?.payouts.some((x) => x.status === 'failed')) alerts.push(alertBox('danger', 'A payout failed', 'Check your payout account details. CourtKo Finance can retry once it is fixed.', btn('Payouts', { href: '#/biz/payouts', variant: 'secondary', size: 'sm' })));
  if (noShowCandidates.length && p('bookings.mark_no_show')) alerts.push(alertBox('warning', noShowCandidates.length === 1 ? "1 player hasn't checked in" : `${noShowCandidates.length} players haven't checked in`, noShowCandidates.map((r) => `${r.booking.code} ${r.customer.name} (${r.court.name}, ${formatTime(r.booking.startMs)})`).join(' · '), btn('Open calendar', { href: '#/biz/calendar', variant: 'secondary', size: 'sm' })));
  if (restrictionsAppeals.length) alerts.push(alertBox('info', `${restrictionsAppeals.length} restriction appeal(s) to review`, undefined, btn('Review', { href: '#/biz/restrictions', variant: 'secondary', size: 'sm' })));
  return html`${pageHeader(`Good ${new Date(now + 8 * 3_600_000).getUTCHours() < 12 ? 'morning' : new Date(now + 8 * 3_600_000).getUTCHours() < 18 ? 'afternoon' : 'evening'}, ${ctx.me!.profile?.firstName}`, { subtitle: `${b.business.tradeName} · ${formatDateLong(now)}`, actions: html`${p('bookings.create_walkin') ? btn('Walk-in booking', { href: '#/biz/walk-in', variant: 'primary', icon: 'plus' }) : ''}${p('bookings.check_in') ? btn('Check in', { action: 'biz.checkin.open', variant: 'secondary', icon: 'qr' }) : ''}${p('courts.block') ? btn('Block a court', { href: '#/biz/courts', variant: 'ghost', icon: 'ban' }) : ''}` })}
  ${alerts.length ? html`<div class="stack-sm" style="margin-bottom:18px">${alerts}</div>` : ''}
  <div class="grid g4">${p('bookings.view') ? kpi('Bookings today', String(todays.length), `${inPlay} in play now`, { icon: 'calendar', href: '#/biz/calendar' }) : ''}${p('bookings.check_in') ? kpi('Ready to check in', String(toCheckIn.length), 'within the check-in window', { icon: 'qr', tone: 'info' }) : ''}${p('orders.fulfill') ? kpi('Pickup orders', String(orders.length), `${orders.filter((o) => o.order.status === 'ready_for_pickup').length} ready`, { icon: 'bag', tone: 'event', href: '#/biz/orders' }) : ''}${report ? kpi('Revenue · 7 days', formatPHP(report.revenue.gross, { compact: true }), html`venue net ${formatPHP(report.revenue.venueNet, { compact: true })}`, { icon: 'wallet', tone: 'warning', href: '#/biz/reports' }) : ''}</div>
  <div class="split" style="margin-top:18px"><div class="stack">
    ${p('bookings.view') ? card(upcoming.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Court</th><th>Player</th><th>Status</th><th></th></tr></thead><tbody>${upcoming.map((r) => html`<tr><td class="nowrap">${formatTimeRange(r.booking.startMs, r.booking.endMs)}</td><td>${r.court.name}</td><td>${r.customer.name}${r.booking.source === 'walk_in' ? html` ${tag('walk-in')}` : ''}${r.order ? html` ${icon('bag', 14)}` : ''}</td><td>${pill(r.booking.status)}</td><td class="right">${r.booking.status === 'confirmed' && p('bookings.check_in') && r.booking.startMs - 30 * 60_000 <= now ? btn('Check in', { action: 'biz.checkin', data: { code: r.booking.code }, variant: 'primary', size: 'sm' }) : ''}</td></tr>`)}</tbody></table></div>` : empty('No more bookings today', undefined, undefined, 'calendar'), { title: "Today's schedule", actions: btn('Calendar', { href: '#/biz/calendar', variant: 'ghost', size: 'sm' }), pad: !upcoming.length }) : ''}
    ${report ? card(barChart(report.byDay.map((d) => ({ label: d.date.slice(5), value: d.revenue })), { title: 'Revenue by payment date (last 7 days)', format: (n) => formatPHP(n) }), { title: 'Revenue (payment date)', subtitle: 'Gross customer payments captured per day' }) : ''}
  </div><div class="stack">
    ${payouts ? card(dl([['Balance owed to you', html`<b>${formatPHP(payouts.balance)}</b>`], ['Settled, next payout', formatPHP(payouts.settledUnpaid)], ['Awaiting settlement', formatPHP(payouts.pendingSettlement)], ['Last payout', payouts.payouts[0] ? html`${formatPHP(payouts.payouts[0].amount)} ${pill(payouts.payouts[0].status)}` : '—']]), { title: 'Money', actions: btn('Payouts', { href: '#/biz/payouts', variant: 'ghost', size: 'sm' }) }) : ''}
    ${report ? card(dl([['Utilization (7 days)', `${Math.round(report.utilization.rate * 100)}%`], ['Cancellation rate', `${Math.round(report.cancellationRate * 100)}%`], ['No-show rate', `${Math.round(report.noShowRate * 100)}%`], ['Returning players', `${report.returningCustomers} of ${report.customers}`]]), { title: 'This week' }) : ''}
    ${card(html`<div class="stack-sm">${[...b.perms].length ? html`<p class="small">Signed in as <b>${b.roles.join(', ')}</b>. You see the tools your role allows — every action is also checked on the server.</p>` : ''}<p class="xs muted">${b.perms.size} permissions · ${ctx.me!.mfaVerified ? 'two-step verified session' : 'password-only session'}</p></div>`, { title: 'Your access' })}
  </div></div>`;
});

action('biz.checkin.open', () => {
  app.modal({ title: 'Check in a player', body: html`<form data-form="biz.checkin.form" class="stack-sm">${field({ name: 'code', label: 'Booking code or scanned QR', placeholder: 'CK-XXXXXX', required: true, hint: 'Scanning the player’s QR fills this in. Codes are case-insensitive; I/L/O are read as 1/0.' })}${btn('Check in', { type: 'submit', variant: 'primary', block: true })}</form>` });
});
form('biz.checkin.form', async (fd) => {
  const r = await app.api.write('POST /v1/businesses/{businessId}/bookings/check-in', { businessId: app.businessId!, code: str(fd, 'code') });
  app.closeModal();
  app.toast(`${r.customer.name} checked in (${r.booking.code})`, 'success');
});
action('biz.checkin', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/bookings/check-in', { businessId: app.businessId!, code: el.dataset.code! }));
  if (r) app.toast(`${r.customer.name} checked in`, 'success');
});
