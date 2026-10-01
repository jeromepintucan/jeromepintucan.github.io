/** SuperAdmin control center: overview, businesses & verification, venues, users, bookings, events, products, moderation, support mode, security, audit, configuration. */

import { formatPHP, formatPpm, parsePesoInput } from '../../domain/money.ts';
import { formatDateShort, formatDateTime, formatTimeRange } from '../../domain/time.ts';
import { DOCUMENT_LABEL } from '../../services/businesses.ts';
import { action, app, form, route, str, type ViewCtx } from '../app.ts';
import { lineChart } from '../charts.ts';
import { alertBox, btn, card, dl, empty, field, kpi, pageHeader, pill, select, tabs, tag, textarea, toggle } from '../components.ts';
import { html, type SafeHtml } from '../html.ts';
import { icon } from '../icons.ts';

export function adminRoute(pattern: string, title: string, view: (ctx: ViewCtx) => SafeHtml): void {
  route(pattern, 'admin', title, view, { auth: true });
}

adminRoute('/admin', 'Platform overview', () => {
  const o = app.api.read('GET /v1/admin/overview');
  const k = o.kpis;
  return html`${pageHeader('Platform overview', { subtitle: 'Last 30 days · decisions and exceptions first' })}
  ${o.alerts.length ? html`<div class="stack-sm" style="margin-bottom:18px">${o.alerts.map((a) => alertBox(a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warning' : 'info', a.title, a.detail, btn('Open', { href: a.link, variant: 'secondary', size: 'sm' })))}</div>` : alertBox('success', 'No open alerts', 'Payments, payouts and reconciliation are healthy.')}
  <div class="grid g4">${kpi('Gross booking value', formatPHP(k.gbv, { compact: true }), `${k.payments} captured payments`, { icon: 'wallet', href: '#/admin/reports' })}${kpi('Platform commission', formatPHP(k.commission, { compact: true }), 'commission revenue (ledger)', { icon: 'percent', tone: 'info', href: '#/admin/commissions' })}${kpi('Gateway fees', formatPHP(k.fees, { compact: true }), html`recovered from players ${formatPHP(k.feeRecovery, { compact: true })}`, { icon: 'card', tone: 'warning', href: '#/admin/transactions' })}${kpi('Venue net', formatPHP(k.venueNet, { compact: true }), 'owed to venues', { icon: 'building', tone: 'event' })}</div>
  <div class="grid g4" style="margin-top:12px">${kpi('Active businesses', String(k.activeBusinesses), `${k.venues} published venues`, { icon: 'building' })}${kpi('Players', String(k.users), 'active accounts', { icon: 'users', tone: 'info' })}${kpi('Bookings (30 days)', String(k.bookings30d), 'created', { icon: 'ticket', tone: 'event' })}${kpi('Failed payments (7 days)', String(k.failedPayments), 'declines and cancellations', { icon: 'alert', tone: 'danger' })}</div>
  <div style="margin-top:16px">${card(lineChart(o.days.map((d) => ({ label: formatDateShort(d.date).split(', ')[1]!, value: d.gbv })), { title: 'Daily gross booking value', format: (n) => formatPHP(n) }), { title: 'Gross booking value', subtitle: 'Payment date basis' })}</div>`;
});

// ---------------------------------------------------------------- businesses

adminRoute('/admin/businesses', 'Businesses', () => {
  const status = app.state<string>('abStatus', '');
  const res = app.api.read('GET /v1/admin/businesses', { status: status || undefined as never, limit: 100 });
  return html`${pageHeader('Businesses', { subtitle: `${res.page.total} registered` })}<div class="chips" style="margin-bottom:12px">${[['', 'All'], ['pending_verification', 'Awaiting verification'], ['active', 'Active'], ['suspended', 'Suspended'], ['rejected', 'Rejected']].map(([v, l]) => html`<button class="chip${status === v ? ' active' : ''}" data-action="ab.status" data-v="${v}">${l}</button>`)}</div>
  ${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Business</th><th>Owner</th><th class="num">Venues</th><th class="num">Staff</th><th>Registered</th><th>Status</th></tr></thead><tbody>${res.data.map((r) => html`<tr class="clickable" data-action="ab.open" data-id="${r.business.id}" tabindex="0"><td><b>${r.business.tradeName}</b><div class="xs muted">${r.business.legalName}</div></td><td>${r.owner}</td><td class="num">${r.venues}</td><td class="num">${r.staff}</td><td class="small">${formatDateShort(r.business.createdAt)}</td><td>${pill(r.business.status)}</td></tr>`)}</tbody></table></div>`, { pad: false })}`;
});
action('ab.status', (el) => app.set('abStatus', el.dataset.v));
action('ab.open', (el) => app.navigate(`#/admin/businesses/${el.dataset.id}`));

adminRoute('/admin/businesses/:id', 'Business', (ctx) => {
  const d = app.api.read('GET /v1/admin/businesses/{businessId}', { businessId: ctx.params.id! });
  const b = d.business;
  const v = d.verifications[0];
  return html`${pageHeader(b.tradeName, { back: '#/admin/businesses', subtitle: html`${b.legalName} · ${pill(b.status)}`, actions: html`${b.status === 'active' ? btn('Suspend', { action: 'ab.suspend', data: { id: b.id, s: '1' }, variant: 'danger' }) : b.status === 'suspended' ? btn('Reactivate', { action: 'ab.suspend', data: { id: b.id, s: '0' }, variant: 'primary' }) : ''}` })}
  <div class="split"><div class="stack">
    ${v ? card(html`${v.status === 'submitted' ? alertBox('warning', 'Awaiting review', `Submitted ${formatDateTime(v.submittedAt)}. Check each document against the registration details before approving.`) : dl([['Decision', pill(v.status)], ['Reviewed', v.reviewedAt ? formatDateTime(v.reviewedAt) : '—'], ['Note', v.decisionNote ?? '—']])}
      <div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>Document</th><th>File</th><th>Scan</th></tr></thead><tbody>${v.documents.map((doc) => html`<tr><td>${DOCUMENT_LABEL[doc.type]}</td><td class="small">${icon('receipt', 14)} ${doc.fileName} <span class="xs muted">${(doc.sizeBytes / 1024).toFixed(0)} KB</span></td><td>${tag(doc.scanStatus, 'success')}</td></tr>`)}</tbody></table></div>
      <p class="xs muted">${icon('lock', 12)} Documents contain sensitive personal information (government ID). Access is limited to verification reviewers and every view is audited. Demo: files are placeholders.</p>
      ${v.status === 'submitted' && b.status === 'pending_verification' ? html`<form data-form="ab.decide" data-id="${b.id}" class="stack-sm">${textarea({ name: 'note', label: 'Note to the owner (required to reject or request info)', placeholder: 'e.g. Mayor’s permit is for 2025 — please upload the 2026 permit.' })}<div class="row">${btn('Approve business', { type: 'submit', variant: 'primary', icon: 'check' })}<button class="btn btn-secondary" type="submit" name="decision" value="request_info">Request information</button><button class="btn btn-danger" type="submit" name="decision" value="reject">Reject</button></div></form>` : ''}`, { title: 'Verification' }) : card(empty('No verification submitted'))}
    ${card(d.venues.length ? html`${d.venues.map((ven) => html`<div class="row-between" style="padding:6px 0"><a href="#/venues/${ven.slug}">${ven.name}</a>${pill(ven.status)}</div>`)}` : empty('No venues'), { title: 'Venues' })}
  </div><div class="stack">
    ${card(dl([['Owner', d.owner], ['Type', b.type.replace('_', ' ')], ['Registration no.', b.registrationNo], ['TIN', b.tinMasked], ['VAT-registered', b.vatRegistered ? 'Yes' : 'No'], ['Address', `${b.address.line1}, ${b.address.barangay}, ${b.address.city}`], ['Contact', `${b.contactEmail} · ${b.contactPhone}`], ['Payout account', html`${pill(b.payoutAccount.status)} ${b.payoutAccount.accountMasked ?? ''}`]]), { title: 'Details' })}
    ${card(html`${d.agreements.length ? html`${d.agreements.map((a) => html`<div class="row-between small" style="padding:5px 0"><span>${formatPpm(a.ratePpm)} from ${formatDateShort(a.effectiveFrom)}${a.effectiveTo ? ` to ${formatDateShort(a.effectiveTo)}` : ''}</span>${pill(a.status)}</div>`)}` : html`<p class="small muted">Uses the platform default commission.</p>`}${btn('Propose agreement', { href: '#/admin/commissions', variant: 'ghost', size: 'sm' })}`, { title: 'Commission agreements' })}
    ${card(html`${d.members.map((m) => html`<div class="row-between small" style="padding:5px 0"><span>${m.name}</span><span class="muted">${m.roles.join(', ')}</span></div>`)}`, { title: 'Team' })}
  </div></div>`;
});
form('ab.decide', async (fd, f) => {
  const submitter = (document.activeElement as HTMLButtonElement | null)?.value;
  const decision = (submitter === 'reject' || submitter === 'request_info' ? submitter : 'approve') as 'approve' | 'reject' | 'request_info';
  await app.api.write('POST /v1/admin/businesses/{businessId}/verification-decision', { businessId: f.dataset.id!, decision, note: str(fd, 'note') });
  app.toast(decision === 'approve' ? 'Business approved — the owner was notified.' : 'Decision recorded and sent to the owner.', 'success');
});
action('ab.suspend', async (el) => {
  const reason = window.prompt(el.dataset.s === '1' ? 'Reason for suspension (shown to the owner):' : 'Reason for reactivation:');
  if (!reason) return;
  await app.run(el, () => app.api.write('POST /v1/admin/businesses/{businessId}/suspension', { businessId: el.dataset.id!, suspend: el.dataset.s === '1', reason }), { success: 'Updated and audited' });
});

adminRoute('/admin/venues', 'Venues', () => {
  const rows = app.api.read('GET /v1/public/venues', {}).rows;
  return html`${pageHeader('Venues', { subtitle: `${rows.length} published` })}${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Venue</th><th>Business</th><th>City</th><th class="num">Courts</th><th>Rating</th><th class="num">From</th></tr></thead><tbody>${rows.map((r) => html`<tr><td><a href="#/venues/${r.venue.slug}"><b>${r.venue.name}</b></a></td><td class="small">${r.businessName}</td><td>${r.venue.address.city}</td><td class="num">${r.courts}</td><td>${r.venue.ratingAvg.toFixed(1)} (${r.venue.ratingCount})</td><td class="num">${r.fromRate ? formatPHP(r.fromRate, { compact: true }) : '—'}</td></tr>`)}</tbody></table></div>`, { pad: false })}`;
});

adminRoute('/admin/users', 'Users', () => {
  const q = app.state<string>('auQ', '');
  const res = app.api.read('GET /v1/admin/users', { q, limit: 100 });
  return html`${pageHeader('Users', { subtitle: `${res.page.total} accounts · contact details masked` })}<form data-form="au.q" class="row" style="margin-bottom:12px"><input name="q" type="search" value="${q}" placeholder="Search by name" aria-label="Search users" style="max-width:320px"/></form>
  ${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Contact</th><th>Role</th><th class="num">Bookings</th><th>MFA</th><th>Status</th><th></th></tr></thead><tbody>${res.data.map((u) => html`<tr><td><b>${u.name}</b>${u.persona ? html` ${tag('demo persona', 'accent')}` : ''}</td><td class="small">${u.contact}</td><td class="small">${u.platformRole ?? (u.businesses ? `Staff at ${u.businesses}` : 'Player')}</td><td class="num">${u.bookings}</td><td>${u.mfa ? tag('On', 'success') : '—'}</td><td>${pill(u.status)}</td><td class="right nowrap">${u.platformRole ? '' : html`${btn('Support view', { action: 'sup.start', data: { id: u.id, name: u.name }, variant: 'ghost', size: 'sm', icon: 'headset' })}${u.status === 'active' ? btn('Suspend', { action: 'au.suspend', data: { id: u.id, s: '1' }, variant: 'ghost', size: 'sm' }) : u.status === 'suspended' ? btn('Reactivate', { action: 'au.suspend', data: { id: u.id, s: '0' }, variant: 'ghost', size: 'sm' }) : ''}`}</td></tr>`)}</tbody></table></div>`, { pad: false })}`;
});
form('au.q', (fd) => app.set('auQ', str(fd, 'q')));
action('au.suspend', async (el) => {
  const reason = window.prompt('Reason (recorded in the audit log):');
  if (reason) await app.run(el, () => app.api.write('POST /v1/admin/users/{userId}/suspension', { userId: el.dataset.id!, suspend: el.dataset.s === '1', reason }), { success: 'Updated' });
});

adminRoute('/admin/bookings', 'All bookings', () => {
  const status = app.state<string>('abkStatus', '');
  const res = app.api.read('GET /v1/admin/bookings', { status: status || undefined as never, limit: 80 });
  return html`${pageHeader('All bookings', { subtitle: `${res.page.total} bookings across all businesses` })}<div class="chips" style="margin-bottom:12px">${['', 'confirmed', 'completed', 'refund_pending', 'refunded', 'no_show', 'disputed', 'expired'].map((s) => html`<button class="chip${status === s ? ' active' : ''}" data-action="abk.status" data-v="${s}">${s ? s.replace(/_/g, ' ') : 'All'}</button>`)}</div>
  ${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Venue</th><th>When</th><th>Player</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>${res.data.map((r) => html`<tr><td><code>${r.booking.code}</code></td><td class="small">${r.venue} · ${r.court}</td><td class="small nowrap">${formatDateShort(r.booking.startMs)} ${formatTimeRange(r.booking.startMs, r.booking.endMs)}</td><td>${r.player}</td><td class="num">${formatPHP(r.total)}</td><td>${pill(r.booking.status)}</td></tr>`)}</tbody></table></div>`, { pad: false })}`;
});
action('abk.status', (el) => app.set('abkStatus', el.dataset.v));

adminRoute('/admin/events', 'Events', () => {
  const list = app.api.read('GET /v1/public/events', {});
  return html`${pageHeader('Events')}${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Event</th><th>Venue</th><th>When</th><th class="num">Registered</th><th>Status</th></tr></thead><tbody>${list.map((e) => html`<tr><td><b>${e.event.name}</b><div class="xs muted">${e.event.type.replace('_', ' ')}</div></td><td>${e.venue.name}</td><td class="small">${formatDateShort(e.event.startMs)}</td><td class="num">${e.divisions.reduce((a, d) => a + d.taken, 0)}/${e.divisions.reduce((a, d) => a + d.division.capacity, 0)}</td><td>${pill(e.event.status)}</td></tr>`)}</tbody></table></div>`, { pad: false })}`;
});

adminRoute('/admin/products', 'Products', () => {
  const rows = app.api.read('GET /v1/admin/products');
  return html`${pageHeader('Products', { subtitle: `${rows.length} listed across venues` })}${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Venue</th><th>Category</th><th class="num">Price</th><th>Status</th></tr></thead><tbody>${rows.map(({ p, venue }) => html`<tr><td>${p.name}</td><td class="small">${venue}</td><td>${p.category}</td><td class="num">${formatPHP(p.price)}</td><td>${pill(p.status)}</td></tr>`)}</tbody></table></div>`, { pad: false })}`;
});

// ---------------------------------------------------------------- moderation

adminRoute('/admin/moderation', 'Moderation', () => {
  const q = app.api.read('GET /v1/admin/moderation/reports');
  return html`${pageHeader('Moderation', { subtitle: 'Reported reviews, venues and issues' })}<div class="stack-sm">${q.map((r) => html`<div class="card"><div class="card-body"><div class="row-between"><div><b>${r.report.targetType}</b> · ${r.report.reason} ${pill(r.report.status)}</div><span class="xs muted">${formatDateTime(r.report.createdAt)} · reported by ${r.reporter}</span></div>${r.review ? html`<blockquote style="margin:10px 0;padding:10px 14px;border-left:3px solid var(--ck-slate-300);background:var(--ck-slate-50)">${'★'.repeat(r.review.rating)} ${r.review.body}</blockquote>` : html`<p class="small">${r.report.details}</p>`}${r.report.status === 'open' ? html`<div class="row">${btn('Hide content', { action: 'mod.act', data: { id: r.report.id, a: 'hide_content' }, variant: 'danger', size: 'sm' })}${btn('Dismiss report', { action: 'mod.act', data: { id: r.report.id, a: 'dismiss' }, variant: 'secondary', size: 'sm' })}</div>` : html`<p class="xs muted">${r.report.action}</p>`}</div></div>`)}${q.length ? '' : empty('Queue is empty', undefined, undefined, 'flag')}</div>`;
});
action('mod.act', async (el) => {
  const note = window.prompt('Moderation note:', el.dataset.a === 'hide_content' ? 'Violates review guidelines' : 'No violation found') ?? '';
  await app.run(el, () => app.api.write('POST /v1/admin/moderation/reports/{reportId}/actions', { reportId: el.dataset.id!, action: el.dataset.a as never, note }), { success: 'Report handled' });
});

// ---------------------------------------------------------------- support mode

adminRoute('/admin/support', 'Support', () => {
  const sessions = app.api.read('GET /v1/admin/support-sessions');
  const users = app.api.read('GET /v1/admin/users', { limit: 100 }).data.filter((u) => !u.platformRole);
  return html`${pageHeader('Support mode', { subtitle: 'Read-only, time-limited access to a user’s view — with a reason, a ticket and a full audit trail.' })}
  <div class="split"><div>${card(html`<form data-form="sup.form" class="stack-sm">${select({ name: 'userId', label: 'User', options: users.map((u) => ({ value: u.id, label: `${u.name}${u.persona ? ' (demo persona)' : ''}` })) })}${field({ name: 'ticket', label: 'Support ticket', value: 'SUP-1043', required: true })}${textarea({ name: 'reason', label: 'Reason (min. 15 characters)', required: true, value: 'Player reports a refund not received for a cancelled booking.' })}${select({ name: 'minutes', label: 'Duration', value: '15', options: [5, 15, 30].map((m) => ({ value: String(m), label: `${m} minutes` })) })}${btn('Start read-only session', { type: 'submit', variant: 'primary', icon: 'headset' })}</form>`, { title: 'Start a session' })}</div>
  <div class="stack">${card(html`<ul class="bullets small"><li>Read-only: any write returns <code>SUPPORT_MODE_READ_ONLY</code>.</li><li>Never shows passwords, MFA secrets or payment credentials (they aren't stored).</li><li>Visible banner for the whole session; auto-expires (max 30 min).</li><li>Every request is audited with both the admin and the user; the user is notified afterwards.</li></ul>`, { title: 'Safeguards' })}
  ${card(sessions.length ? html`${sessions.map((s) => html`<div class="row-between small" style="padding:6px 0;border-bottom:1px solid var(--ck-slate-100)"><span><b>${s.target}</b> · ${s.session.ticketRef} · by ${s.admin}<div class="xs muted">${formatDateTime(s.session.startedAt)} · ${s.session.reason}</div></span>${s.active ? tag('active', 'warning') : tag('ended')}</div>`)}` : empty('No sessions yet'), { title: 'Session history' })}</div></div>`;
});
form('sup.form', async (fd) => {
  await app.api.write('POST /v1/admin/support-sessions', { targetUserId: str(fd, 'userId'), reason: str(fd, 'reason'), ticketRef: str(fd, 'ticket'), minutes: Number(str(fd, 'minutes')) });
  app.toast('Support session started (read-only)', 'warning');
  app.navigate('#/app');
});
action('sup.start', async (el) => {
  const reason = window.prompt(`Reason for viewing ${el.dataset.name}'s account (min. 15 characters):`, 'Investigating a booking issue reported by the player');
  if (!reason) return;
  const r = await app.run(el, () => app.api.write('POST /v1/admin/support-sessions', { targetUserId: el.dataset.id!, reason, ticketRef: 'SUP-1044', minutes: 15 }));
  if (r) app.navigate('#/app');
});

// ---------------------------------------------------------------- security & audit

adminRoute('/admin/security', 'Security', () => {
  const type = app.state<string>('secType', '');
  const list = app.api.read('GET /v1/admin/security-events', { type: type || undefined as never });
  const types = ['', 'login_failed', 'account_locked', 'mfa_failed', 'double_booking_blocked', 'webhook_token_invalid', 'authz_denied', 'support_session_started', 'reconciliation_healed', 'rate_limited', 'data_export'];
  return html`${pageHeader('Security events', { subtitle: 'Centralized security monitoring (production: CloudWatch + SIEM alerts)' })}<div class="chips" style="margin-bottom:12px">${types.map((t) => html`<button class="chip${type === t ? ' active' : ''}" data-action="sec.type" data-v="${t}">${t ? t.replace(/_/g, ' ') : 'All'}</button>`)}</div>
  ${card(list.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Type</th><th>Severity</th><th>User</th><th>Detail</th><th>IP</th></tr></thead><tbody>${list.map((e) => html`<tr><td class="small nowrap">${formatDateTime(e.event.at)}</td><td><code class="xs">${e.event.type}</code></td><td>${pill(e.event.severity)}</td><td class="small">${e.user ?? '—'}</td><td class="small">${e.event.detail}</td><td class="xs">${e.event.ip}</td></tr>`)}</tbody></table></div>` : empty('No events of this type yet', 'Try the presenter scenarios: forged webhook, two players same slot, or wrong passwords.', undefined, 'shield'), { pad: !list.length })}`;
});
action('sec.type', (el) => app.set('secType', el.dataset.v));

adminRoute('/admin/audit', 'Audit logs', () => {
  const q = app.state<string>('aaQ', '');
  const res = app.api.read('GET /v1/admin/audit-logs', { q, limit: 100 });
  const verify = app.ui.auditVerify as { ok: boolean; count: number; brokenAt: number | null } | undefined;
  return html`${pageHeader('Audit logs', { subtitle: 'Append-only and hash-chained: each entry includes the hash of the previous one.', actions: btn('Verify hash chain', { action: 'aa.verify', variant: 'secondary', icon: 'shield' }) })}
  ${verify ? alertBox(verify.ok ? 'success' : 'danger', verify.ok ? `Chain intact — ${verify.count} entries verified` : `Chain broken at entry #${verify.brokenAt}`, 'Production also archives daily digests to S3 Object Lock (WORM) so history cannot be rewritten.') : ''}
  <form data-form="aa.q" class="row" style="margin:12px 0"><input name="q" type="search" value="${q}" placeholder="Search action, actor or detail" aria-label="Search audit" style="max-width:360px"/></form>
  ${card(html`<div class="table-wrap"><table class="table"><thead><tr><th class="num">#</th><th>When</th><th>Actor</th><th>Action</th><th>Summary</th><th>Hash</th></tr></thead><tbody>${res.data.map((a) => html`<tr><td class="num xs">${a.seq}</td><td class="small nowrap">${formatDateTime(a.at)}</td><td class="small">${a.actorLabel}</td><td><code class="xs">${a.action}</code></td><td class="small">${a.summary}${a.reason ? html`<div class="xs muted">Reason: ${a.reason}</div>` : ''}<div class="xs muted">${a.ip} · ${a.correlationId}</div></td><td class="xs"><code>${a.hash.slice(0, 10)}…</code></td></tr>`)}</tbody></table></div>`, { pad: false })}`;
});
form('aa.q', (fd) => app.set('aaQ', str(fd, 'q')));
action('aa.verify', () => app.set('auditVerify', app.api.read('GET /v1/admin/audit-logs/verify')));

// ---------------------------------------------------------------- configuration

adminRoute('/admin/config', 'Platform configuration', () => {
  const cfg = app.api.read('GET /v1/admin/config');
  const tab = app.state<string>('cfgTab', 'payments');
  return html`${pageHeader('Platform configuration', { subtitle: 'Fee schedules and commission changes require a second administrator (maker-checker).' })}${tabs([{ key: 'payments', label: 'Payment methods & fees' }, { key: 'flags', label: 'Feature flags' }, { key: 'policy', label: 'Policies & limits' }, { key: 'catalog', label: 'Catalogs' }], tab, 'cfg.tab')}
  ${tab === 'payments' ? html`${alertBox('warning', 'PLACEHOLDER rates', 'Fee schedules are samples until the Xendit contract is signed. Fee pass-through is subject to the provider agreement and Philippine rules: QR Ph P2M customer fees are not allowed, and card surcharging stays off until confirmed with the acquirer and counsel (doc 23 D-05).')}${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Method</th><th>Fee</th><th>Pass-through</th><th>Enabled</th><th></th></tr></thead><tbody>${cfg.feeSchedules.map((f) => html`<tr><td><b>${f.label}</b></td><td>${f.percentPpm ? formatPpm(f.percentPpm) : ''}${f.percentPpm && f.fixed ? ' + ' : ''}${f.fixed ? formatPHP(f.fixed) : ''}</td><td>${f.passThroughLockedReason ? html`${tag('Locked off', 'danger')}<div class="xs muted" style="max-width:260px">${f.passThroughLockedReason}</div>` : f.passThrough ? tag('Player pays', 'info') : tag('CourtKo absorbs', 'success')}</td><td>${f.enabled ? tag('Yes', 'success') : tag('No')}</td><td class="right">${btn('Propose change', { action: 'fee.edit', data: { m: f.method }, variant: 'ghost', size: 'sm' })}</td></tr>`)}</tbody></table></div>`, { pad: false })}` : ''}
  ${tab === 'flags' ? card(html`${Object.entries(cfg.featureFlags).map(([k, f]) => html`<div style="padding:6px 0;border-bottom:1px solid var(--ck-slate-100)">${toggle({ label: k, checked: f.enabled, action: 'flag.toggle', data: { k, on: f.enabled ? '0' : '1' }, hint: f.description })}</div>`)}`, { title: 'Feature flags', subtitle: 'Kill switches and phased rollouts (audited)' }) : ''}
  ${tab === 'policy' ? card(html`<form data-form="cfg.threshold" class="row" style="align-items:flex-end"><div>${field({ name: 'amount', label: 'Refunds above this need platform approval (₱)', value: (cfg.refundPlatformApprovalThreshold / 100).toFixed(0) })}</div>${btn('Save', { type: 'submit', variant: 'secondary' })}</form>${dl([['Checkout hold', '10 minutes (venue-configurable 5–15)'], ['Max hold lifetime', `${cfg.maxHoldLifetimeMinutes} minutes`], ['Provider session minimum', `${cfg.providerSessionMinMinutes} minutes`], ['Late webhook grace', `${cfg.lateWebhookGraceMinutes} minutes`], ['VAT rate', formatPpm(cfg.vatPpm)], ['Session idle timeout', 'Players 30 min · Admin 15 min'], ['Cancellation policy templates', 'Standard v3 · Flexible v2 · Strict v2 · Non-refundable v1']])}`, { title: 'Policies & limits' }) : ''}
  ${tab === 'catalog' ? html`<div class="grid g2">${card(html`<div class="chips">${cfg.amenities.map((a) => tag(a.label))}</div>`, { title: 'Amenities' })}${card(html`<div class="chips">${cfg.eventTypes.map((e) => tag(e.label, 'event'))}</div>`, { title: 'Event types' })}${card(html`<div class="chips">${['Full court', 'Half court', 'Indoor', 'Outdoor', 'Covered', 'Custom tags'].map((t) => tag(t, 'info'))}</div>`, { title: 'Court types' })}</div>` : ''}`;
});
action('cfg.tab', (el) => app.set('cfgTab', el.dataset.key));
action('flag.toggle', async (el) => {
  await app.run(el, () => app.api.write('PATCH /v1/admin/config/feature-flags/{key}', { key: el.dataset.k!, enabled: el.dataset.on === '1' }), { success: 'Flag updated (audited)' });
});
form('cfg.threshold', async (fd) => {
  await app.api.write('PATCH /v1/admin/config/refund-threshold', { amount: parsePesoInput(str(fd, 'amount')) ?? 0 });
  app.toast('Threshold saved', 'success');
});
action('fee.edit', (el) => {
  const cfg = app.api.read('GET /v1/admin/config');
  const f = cfg.feeSchedules.find((x) => x.method === el.dataset.m)!;
  app.modal({ title: `Propose change: ${f.label}`, body: html`<form data-form="fee.propose" data-m="${f.method}" class="stack-sm"><div class="form-grid">${field({ name: 'pct', label: 'Percent', value: (f.percentPpm / 10_000).toString() })}${field({ name: 'fixed', label: 'Fixed (₱)', value: (f.fixed / 100).toFixed(2) })}</div>${f.passThroughLockedReason ? alertBox('info', 'Pass-through locked', f.passThroughLockedReason) : html`<label class="check"><input type="checkbox" name="pass"${f.passThrough ? html` checked` : ''}/> Pass the fee to the player (shown before payment)</label>`}<label class="check"><input type="checkbox" name="enabled"${f.enabled ? html` checked` : ''}/> Method enabled</label>${field({ name: 'note', label: 'Reference / reason', value: 'Per provider contract amendment' })}${btn('Submit for second approval', { type: 'submit', variant: 'primary', block: true })}</form>` });
});
form('fee.propose', async (fd, f) => {
  const cfg = app.api.read('GET /v1/admin/config');
  const cur = cfg.feeSchedules.find((x) => x.method === f.dataset.m)!;
  await app.api.write('POST /v1/admin/fee-schedules', { schedule: { ...cur, percentPpm: Math.round(Number(str(fd, 'pct')) * 10_000), fixed: parsePesoInput(str(fd, 'fixed')) ?? 0, passThrough: !!fd.get('pass'), enabled: !!fd.get('enabled') }, note: str(fd, 'note') });
  app.closeModal();
  app.toast('Change submitted. Another administrator must approve it (Commissions → Approvals).', 'success');
});

