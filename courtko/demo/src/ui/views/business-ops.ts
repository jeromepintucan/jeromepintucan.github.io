/** Business operations: calendar, bookings, walk-ins, orders & pickup, customers, restrictions, reviews. */

import { formatPHP } from '../../domain/money.ts';
import { addDays, DAY, formatDateLong, formatDateShort, formatDuration, formatMinuteOfDay, formatTime, formatTimeRange, localDate, localParts, localToInstant, MINUTE } from '../../domain/time.ts';
import { REASON_LABEL } from '../../services/restrictions.ts';
import { action, app, form, onChange, str } from '../app.ts';
import { alertBox, btn, card, dl, empty, field, pageHeader, pill, priceBreakdown, qrCode as qrCodeSafe, select, stars, tabs, tag, textarea, timeline } from '../components.ts';
import { cls, html, type SafeHtml } from '../html.ts';
import { icon } from '../icons.ts';
import { bizRoute } from './business.ts';
import { methodLogo } from './shared.ts';

const today = () => localDate(app.store.now());

// ---------------------------------------------------------------- calendar

bizRoute('/biz/calendar', 'Calendar', (_ctx, b) => {
  const date = app.state<string>('calDate', today());
  if (!b.venueId) return empty('No venues yet', 'Create a venue first.', btn('Venue settings', { href: '#/biz/venues', variant: 'primary' }));
  const cal = app.api.read('GET /v1/businesses/{businessId}/calendar', { businessId: b.businessId, venueId: b.venueId, date });
  const open = cal.schedule.closed ? 6 * 60 : cal.schedule.open;
  const close = cal.schedule.closed ? 22 * 60 : cal.schedule.close;
  const ROW = 28; // px per 30 min
  const rows = (close - open) / 30;
  const dayStart = localToInstant(date, 0);
  const courtIdx = new Map(cal.courts.map((c, i) => [c.id, i]));
  const now = app.store.now();
  const nowTop = date === today() ? ((localParts(now).minute - open) / 30) * ROW : -1;
  const gridCols = `60px repeat(${cal.courts.length}, minmax(140px, 1fr))`;
  const counts = { total: cal.items.filter((i) => i.kind === 'booking').length, held: cal.items.filter((i) => i.kind === 'hold').length, blocks: cal.items.filter((i) => i.kind === 'block').length };
  return html`${pageHeader('Calendar', { subtitle: `${formatDateLong(date)} · ${counts.total} bookings · ${counts.held} checkouts in progress · ${counts.blocks} blocks${cal.schedule.note ? ` · ${cal.schedule.note}` : ''}`, actions: html`<div class="row">${btn('', { action: 'cal.shift', data: { d: -1 }, variant: 'secondary', icon: 'chevronLeft', title: 'Previous day' })}<input type="date" value="${date}" data-change="cal.date" aria-label="Date" style="width:auto"/>${btn('', { action: 'cal.shift', data: { d: 1 }, variant: 'secondary', icon: 'chevronRight', title: 'Next day' })}${btn('Today', { action: 'cal.today', variant: 'ghost' })}</div>` })}
  <div class="legend-row" style="margin:0 0 10px"><span><i style="background:var(--ck-color-success-bg);border-left:3px solid var(--ck-color-success)"></i>Confirmed</span><span><i style="background:var(--ck-color-info-bg)"></i>Checked in</span><span><i style="background:#FDE68A"></i>Checkout in progress</span><span><i style="background:var(--ck-slate-200)"></i>Completed / block</span><span><i style="background:var(--ck-color-event-bg)"></i>Event</span><span><i style="background:var(--ck-color-danger-bg)"></i>No-show</span></div>
  <div class="cal"><div class="cal-grid" style="grid-template-columns:${gridCols};grid-template-rows:auto repeat(${rows}, ${ROW}px)">
    <div class="cal-col-head" style="position:sticky;left:0;z-index:4"></div>${cal.courts.map((c) => html`<div class="cal-col-head">${c.name}<div class="xs muted" style="font-weight:500">${c.environment}${c.status !== 'active' ? ' · inactive' : ''}</div></div>`)}
    ${Array.from({ length: rows }, (_, r) => {
      const m = open + r * 30;
      return html`<div class="cal-time" style="grid-column:1;grid-row:${r + 2}">${m % 60 === 0 ? formatMinuteOfDay(m).replace(':00', '') : ''}</div>${cal.courts.map((c, ci) => html`<div class="cal-cell" style="grid-column:${ci + 2};grid-row:${r + 2}" data-action="cal.slot" data-court="${c.id}" data-start="${dayStart + m * MINUTE}" aria-label="${c.name} ${formatMinuteOfDay(m)}"></div>`)}`;
    })}
    ${cal.items.map((it) => {
      const ci = courtIdx.get(it.courtId);
      if (ci === undefined) return '';
      const startMin = Math.max(open, (it.startMs - dayStart) / MINUTE);
      const endMin = Math.min(close, (it.endMs - dayStart) / MINUTE);
      if (endMin <= open || startMin >= close) return '';
      const top = ((startMin - open) / 30) * ROW;
      const height = ((endMin - startMin) / 30) * ROW - 3;
      const status = it.kind === 'event' ? 'event' : it.kind === 'block' ? 'blocked' : it.status;
      return html`<button class="${cls('cal-item', `cal-${status}`)}" style="grid-column:${ci + 2};grid-row:2 / span ${rows};margin-top:${top + 1}px;height:${Math.max(18, height)}px" ${it.bookingId ? html`data-action="bk.open" data-id="${it.bookingId}"` : it.kind === 'block' ? html`data-action="blk.open" data-slot="${it.id}"` : ''} title="${it.title}"><b>${it.title}</b>${formatTimeRange(it.startMs, it.endMs)}${it.code ? html` · ${it.code}` : ''}${it.source === 'walk_in' ? ' · walk-in' : ''}</button>`;
    })}
    ${nowTop >= 0 && nowTop <= rows * ROW ? html`<div class="cal-now" style="grid-column:2 / -1;grid-row:2 / span ${rows};margin-top:${nowTop}px"></div>` : ''}
  </div></div><p class="small muted" style="margin-top:8px">Tap an empty slot to book a walk-in or block the court. Holds show players currently checking out — the slot frees automatically if they don't pay in time.</p>`;
});
onChange('cal.date', (el) => app.set('calDate', (el as HTMLInputElement).value));
action('cal.shift', (el) => app.set('calDate', addDays(app.state<string>('calDate', today()), Number(el.dataset.d))));
action('cal.today', () => app.set('calDate', today()));
action('cal.slot', (el) => {
  const start = Number(el.dataset.start);
  if (start < app.store.now() - 30 * MINUTE) return app.toast('That time has passed.', 'info');
  app.modal({ title: `${formatDateShort(start)} · ${formatTime(start)}`, body: html`<p>What would you like to do with this slot?</p>`, actions: html`${btn('Block court', { href: `#/biz/courts?block=${el.dataset.court}&start=${start}`, variant: 'secondary', icon: 'ban' })}${btn('Walk-in booking', { href: `#/biz/walk-in?court=${el.dataset.court}&start=${start}`, variant: 'primary', icon: 'plus' })}` });
});
action('blk.open', () => app.navigate('#/biz/courts'));

// ---------------------------------------------------------------- booking detail (modal)

action('bk.open', (el) => openBooking(el.dataset.id!));
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#/biz')) (document.getElementById('modal') as HTMLDialogElement | null)?.open && app.closeModal();
});

function openBooking(id: string): void {
  const d = app.api.read('GET /v1/businesses/{businessId}/bookings/{bookingId}', { businessId: app.businessId!, bookingId: id });
  const b = d.booking;
  const perms = new Set(d.perms);
  const now = app.store.now();
  const pay = d.payments.find((p) => p.status !== 'failed' && p.status !== 'cancelled');
  const actions: SafeHtml[] = [];
  if (b.status === 'confirmed' && perms.has('bookings.check_in') && now >= b.startMs - 30 * MINUTE && now < b.endMs) actions.push(btn('Check in', { action: 'bk.checkin', data: { code: b.code }, variant: 'primary', icon: 'check' }));
  if (b.status === 'confirmed' && perms.has('bookings.mark_no_show') && now > b.startMs + 15 * MINUTE) actions.push(btn('Mark no-show', { action: 'bk.noshow', data: { id: b.id }, variant: 'secondary' }));
  if (b.status === 'confirmed' && perms.has('bookings.cancel') && b.startMs > now) actions.push(btn('Cancel (full refund)', { action: 'bk.venueCancel', data: { id: b.id }, variant: 'danger' }));
  if (['completed', 'no_show', 'confirmed', 'checked_in'].includes(b.status) && perms.has('refunds.request') && pay) actions.push(btn('Goodwill refund', { action: 'bk.goodwill', data: { id: b.id }, variant: 'ghost' }));
  app.modal({
    title: `${b.code} · ${d.customer.name}`,
    wide: true,
    body: html`<div class="split"><div class="stack">${d.restriction ? alertBox('warning', `Restricted player (${REASON_LABEL[d.restriction.reasonCategory as keyof typeof REASON_LABEL]})`, d.restriction.notes ?? 'Details visible to managers only.') : ''}${dl([['Status', pill(b.status)], ['Court', `${d.court.name} (${d.court.environment})`], ['When', `${formatDateLong(b.startMs)} · ${formatTimeRange(b.startMs, b.endMs)}`], ['Customer', d.customer.name], ['Contact', d.customer.contact ?? '—'], ['Source', b.source === 'walk_in' ? 'Walk-in' : 'Online'], ['Players', b.participants.length ? b.participants.map((p) => p.name).join(', ') : '—'], ['Policy', `${b.policy.name} v${b.policy.version}`]])}${!perms.has('customers.view_contact') ? html`<p class="xs muted">${icon('lock', 12)} Contact details are masked for your role (customers.view_contact).</p>` : ''}${d.order ? card(html`${d.order.items.map((i) => html`<div>${i.qty}× ${i.name}</div>`)}<div class="xs muted">${d.order.code} · ${d.order.status.replace(/_/g, ' ')}</div>`, { title: 'Add-ons' }) : ''}</div>
    <div class="stack">${d.snapshot ? priceBreakdown(d.lines, d.snapshot.quote.total, { totalLabel: 'Customer paid' }) : ''}${d.snapshot && perms.has('finance.view_summary') ? dl([[`Commission (${d.snapshot.quote.commission.label})`, formatPHP(-d.snapshot.quote.commission.amount)], ['Venue net', html`<b>${formatPHP(d.snapshot.quote.venueNet)}</b>`]]) : ''}${pay ? html`<div class="row small">${methodLogo(pay.method)} ${pay.methodDisplay} · ${pill(pay.status)}</div>` : ''}${d.refunds.map((r) => html`<div class="row-between small"><span>Refund: ${r.reason}</span><span>${formatPHP(r.amount)} ${pill(r.status)}</span></div>`)}<h3>History</h3>${timeline(b.history)}</div></div>`,
    actions: actions.length ? html`${actions}` : html`${btn('Close', { action: 'modal.close', variant: 'secondary' })}`,
  });
}

action('bk.checkin', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/bookings/check-in', { businessId: app.businessId!, code: el.dataset.code! }));
  if (r) {
    app.closeModal();
    app.toast(`${r.customer.name} checked in`, 'success');
  }
});
action('bk.noshow', async (el) => {
  const ok = await app.confirm({ title: 'Mark as no-show?', body: 'The player is notified. No refund is issued under the policy.', confirmLabel: 'Mark no-show', danger: true });
  if (ok) await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/bookings/{bookingId}/no-show', { businessId: app.businessId!, bookingId: el.dataset.id! }), { success: 'Marked as no-show' });
});
action('bk.venueCancel', (el) => {
  app.modal({
    title: 'Cancel booking (venue-initiated)',
    body: html`<form data-form="bk.venueCancel" data-id="${el.dataset.id}" class="stack-sm">${alertBox('info', 'The player gets a full refund, including fees', 'Venue-initiated cancellations always refund 100%. The platform commission is reversed.')}${select({ name: 'reason', label: 'Reason', options: [{ value: 'court_unavailable', label: 'Court unavailable' }, { value: 'weather', label: 'Weather' }, { value: 'venue', label: 'Other venue reason' }] })}${field({ name: 'note', label: 'Message to the player (optional)' })}${btn('Cancel and refund', { type: 'submit', variant: 'danger', block: true })}</form>`,
  });
});
form('bk.venueCancel', async (fd, f) => {
  const r = await app.api.write('POST /v1/businesses/{businessId}/bookings/{bookingId}/cancel', { businessId: app.businessId!, bookingId: f.dataset.id!, reason: str(fd, 'reason') as never, note: str(fd, 'note') }, { idempotencyKey: app.idem() });
  app.closeModal();
  app.toast(`Cancelled. ${formatPHP(r.refundTotal)} refund submitted to the provider.`, 'success');
});
action('bk.goodwill', (el) => {
  app.modal({
    title: 'Goodwill refund',
    body: html`<form data-form="bk.goodwill" data-id="${el.dataset.id}" class="stack-sm">${select({ name: 'share', label: 'Refund share of the court price', options: [{ value: '250000', label: '25%' }, { value: '500000', label: '50%' }, { value: '1000000', label: '100%' }] })}${textarea({ name: 'reason', label: 'Reason', required: true, placeholder: 'e.g. Lights failed for 20 minutes' })}<p class="xs muted">Refunds outside the policy need approval by someone with “Approve refunds” (separation of duties). Refunds over ₱5,000 or after payout also need CourtKo Finance approval.</p>${btn('Request refund', { type: 'submit', variant: 'primary', block: true })}</form>`,
  });
});
form('bk.goodwill', async (fd, f) => {
  const r = await app.api.write('POST /v1/businesses/{businessId}/refunds', { businessId: app.businessId!, bookingId: f.dataset.id!, sharePpm: Number(fd.get('share')), reason: str(fd, 'reason') }, { idempotencyKey: app.idem() });
  app.closeModal();
  app.toast(r?.status === 'pending_approval' ? 'Refund requested — waiting for approval.' : 'Refund submitted to the provider.', 'success');
});

// ---------------------------------------------------------------- bookings list

bizRoute('/biz/bookings', 'Bookings', (_ctx, b) => {
  const f = app.state('bkf', { range: 'upcoming', status: '', q: '' });
  const now = app.store.now();
  const dayStart = localToInstant(today(), 0);
  const range = f.range === 'today' ? { from: dayStart, to: dayStart + DAY } : f.range === 'upcoming' ? { from: now - 2 * 3_600_000, to: now + 31 * DAY } : { from: now - 46 * DAY, to: now };
  const res = app.api.read('GET /v1/businesses/{businessId}/bookings', { businessId: b.businessId, venueId: b.venueId || undefined as never, ...range, status: f.status || undefined as never, q: f.q, limit: 100 });
  const rows = f.range === 'past' ? [...res.data].reverse() : res.data;
  return html`${pageHeader('Bookings', { subtitle: `${res.page.total} bookings`, actions: html`${b.perms.has('bookings.check_in') ? btn('Check in by code', { action: 'biz.checkin.open', variant: 'secondary', icon: 'qr' }) : ''}${b.perms.has('bookings.create_walkin') ? btn('Walk-in', { href: '#/biz/walk-in', variant: 'primary', icon: 'plus' }) : ''}` })}
  <div class="filters" style="margin-bottom:12px"><div class="seg">${[['today', 'Today'], ['upcoming', 'Upcoming'], ['past', 'Past 45 days']].map(([k, l]) => html`<button class="${f.range === k ? 'active' : ''}" data-action="bkf.range" data-k="${k}">${l}</button>`)}</div>
  <select data-change="bkf.status" aria-label="Status"><option value="">All statuses</option>${['confirmed', 'checked_in', 'completed', 'no_show', 'cancelled', 'refund_pending', 'refunded', 'partially_refunded', 'slot_held', 'payment_pending', 'disputed'].map((s) => html`<option value="${s}"${f.status === s ? html` selected` : ''}>${s.replace(/_/g, ' ')}</option>`)}</select>
  <form data-form="bkf.q" class="row"><input name="q" type="search" value="${f.q}" placeholder="Code or player name" aria-label="Search bookings" style="width:220px"/></form></div>
  ${card(rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>When</th><th>Court</th><th>Player</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>${rows.map((r) => html`<tr class="clickable" data-action="bk.open" data-id="${r.booking.id}" tabindex="0"><td><code>${r.booking.code}</code></td><td class="nowrap">${formatDateShort(r.booking.startMs)} · ${formatTimeRange(r.booking.startMs, r.booking.endMs)}</td><td>${r.court.name}</td><td>${r.customer.name}${r.booking.source === 'walk_in' ? html` ${tag('walk-in')}` : ''}</td><td class="num">${formatPHP(r.snapshot?.quote.total ?? 0)}</td><td>${pill(r.booking.status)}</td></tr>`)}</tbody></table></div>` : empty('No bookings match'), { pad: !rows.length })}`;
});
action('bkf.range', (el) => {
  app.state<Record<string, string>>('bkf', {}).range = el.dataset.k!;
  app.render();
});
onChange('bkf.status', (el) => {
  app.state<Record<string, string>>('bkf', {}).status = (el as HTMLSelectElement).value;
  app.render();
});
form('bkf.q', (fd) => {
  app.state<Record<string, string>>('bkf', {}).q = str(fd, 'q');
  app.render();
});

// ---------------------------------------------------------------- walk-in

bizRoute('/biz/walk-in', 'Walk-in booking', (ctx, b) => {
  const done = app.ui.walkin as { bookingId: string; code: string; paymentUrl: string; amount: number; expiresAt: number; checkoutId: string } | undefined;
  if (done) {
    const sessionId = done.paymentUrl.split('/').pop()!;
    const st = app.store.read((db) => db.get('providerSessions', sessionId));
    const bk = app.store.read((db) => db.get('bookings', done.bookingId));
    return html`${pageHeader('Walk-in booking', { subtitle: `${done.code} · ${formatPHP(done.amount)}` })}${card(html`<div class="split"><div class="center stack-sm">${bk?.status === 'confirmed' ? html`${icon('checkCircle', 48)}<h2>Paid & confirmed</h2><p class="muted">The customer's receipt was sent by SMS/email.</p>` : html`<p class="small muted">Ask the customer to scan with their phone camera, or send the payment link by SMS.</p><div class="qr" style="margin:0 auto">${qrOf(done.paymentUrl)}</div><p class="small">Waiting for payment · expires in <span class="countdown" data-countdown="${done.expiresAt}"></span></p>${btn('Simulate customer paying on their phone', { href: done.paymentUrl, variant: 'secondary', icon: 'phone' })}`}</div>
    <div>${dl([['Booking', done.code], ['Status', pill(bk?.status ?? 'payment_pending')], ['Payment session', html`<code>${sessionId}</code> ${st ? pill(st.status.toLowerCase() === 'completed' ? 'captured' : st.status.toLowerCase()) : ''}`]])}<p class="xs muted" style="margin-top:10px">Walk-ins still use digital payment — the booking is confirmed only when the provider verifies it, exactly like online bookings. Staff can't mark anything as paid manually.</p>${btn('New walk-in', { action: 'walkin.reset', variant: 'primary' })}</div></div>`)}`;
  }
  const courtPre = ctx.query.get('court');
  const startPre = Number(ctx.query.get('start')) || 0;
  const venue = b.venues.find((v) => v.id === b.venueId);
  const cal = b.venueId ? app.api.read('GET /v1/businesses/{businessId}/calendar', { businessId: b.businessId, venueId: b.venueId, date: today() }) : null;
  const nowHalf = Math.ceil((app.store.now() + 35 * MINUTE) / (30 * MINUTE)) * 30 * MINUTE;
  const startDefault = startPre || nowHalf;
  const local = new Date(startDefault + 8 * 3_600_000).toISOString().slice(0, 16);
  const found = (app.ui.walkinSearch as { userId: string; name: string; contact: string | null }[] | undefined) ?? [];
  return html`${pageHeader('Walk-in booking', { subtitle: `At the counter · ${venue?.name ?? ''}` })}<div class="split"><div>${card(html`<form data-form="walkin.create" class="form-grid">
    ${select({ name: 'courtId', label: 'Court', value: courtPre ?? cal?.courts[0]?.id ?? '', options: (cal?.courts ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.environment})` })) })}
    ${field({ name: 'start', label: 'Start (Manila time)', type: 'datetime-local', value: local, step: 1800 })}
    ${select({ name: 'duration', label: 'Duration', value: '60', options: [60, 90, 120, 180].map((d) => ({ value: String(d), label: formatDuration(d) })) })}
    ${select({ name: 'method', label: 'Customer pays with', value: 'qrph', options: [{ value: 'qrph', label: 'QR Ph (scan at counter)' }, { value: 'gcash', label: 'GCash' }, { value: 'maya', label: 'Maya' }, { value: 'card', label: 'Card (payment link)' }] })}
    <div class="full"><h3>Customer</h3></div>
    ${found.length ? html`<div class="full">${select({ name: 'customerUserId', label: 'Existing customer', options: [{ value: '', label: '— New / walk-in customer —' }, ...found.map((f) => ({ value: f.userId, label: `${f.name}${f.contact ? ` · ${f.contact}` : ''}` }))] })}</div>` : ''}
    ${field({ name: 'customerName', label: 'Name', placeholder: 'Walk-in customer name' })}${field({ name: 'customerPhone', label: 'Mobile (for receipt)', type: 'tel', placeholder: '0917 000 0000' })}
    <div class="full">${btn('Create booking & payment link', { type: 'submit', variant: 'primary', size: 'lg' })}</div></form>
    <form data-form="walkin.search" class="row" style="margin-top:8px"><input name="q" type="search" placeholder="Search existing customers by name" aria-label="Search customers" style="flex:1"/>${btn('Search', { type: 'submit', variant: 'secondary', size: 'sm' })}</form>`, { title: 'New walk-in' })}</div>
    <div>${card(html`<ul class="bullets small"><li>The court is held like an online checkout — nobody else can take it while the customer pays.</li><li>Pricing rules apply automatically (peak, weekend, holiday).</li><li>A lightweight account is created for new customers so they get a receipt and can manage the booking.</li></ul>`, { title: 'How walk-ins work' })}</div></div>`;
});

function qrOf(url: string): SafeHtml {
  return html`${qrCodeSafe(`https://pay.courtko.example/${url.split('/').pop()}`)}`;
}

form('walkin.search', (fd) => {
  const q = str(fd, 'q');
  app.set('walkinSearch', app.api.read('GET /v1/businesses/{businessId}/customers/search', { businessId: app.businessId!, q }));
});
form('walkin.create', async (fd) => {
  const startLocal = str(fd, 'start');
  const [d, t] = startLocal.split('T');
  const [hh, mm] = (t ?? '00:00').split(':').map(Number);
  const startMs = localToInstant(d!, hh! * 60 + mm!);
  const customerUserId = str(fd, 'customerUserId');
  const r = await app.api.write('POST /v1/businesses/{businessId}/bookings/walk-in', { businessId: app.businessId!, venueId: app.venueId!, courtId: str(fd, 'courtId'), startMs, durationMinutes: Number(str(fd, 'duration')), paymentMethod: str(fd, 'method') as never, ...(customerUserId ? { customerUserId } : { customerName: str(fd, 'customerName'), customerPhone: str(fd, 'customerPhone') }) }, { idempotencyKey: app.idem() });
  app.set('walkin', r);
});
action('walkin.reset', () => app.set('walkin', undefined));

// ---------------------------------------------------------------- orders & pickup

bizRoute('/biz/orders', 'Orders & pickup', (_ctx, b) => {
  const status = app.state<string>('ordTab', 'open');
  const all = app.api.read('GET /v1/businesses/{businessId}/orders', { businessId: b.businessId });
  const open = all.filter((o) => ['paid', 'preparing', 'ready_for_pickup'].includes(o.order.status));
  const list = status === 'open' ? open : all.filter((o) => !['paid', 'preparing', 'ready_for_pickup'].includes(o.order.status)).slice(0, 60);
  return html`${pageHeader('Orders & pickup', { subtitle: `${open.length} open orders`, actions: btn('Claim by code', { action: 'ord.claim.open', variant: 'primary', icon: 'qr' }) })}${tabs([{ key: 'open', label: 'Open', count: open.length }, { key: 'done', label: 'Claimed & closed' }], status, 'ord.tab')}
  ${list.length ? html`<div class="grid g2">${list.map((o) => html`<div class="card"><div class="card-body"><div class="row-between"><b>${o.order.code}</b>${pill(o.order.status)}</div><div class="small muted">${o.customer}${o.booking ? ` · booking ${o.booking.code} ${formatTime(o.booking.startMs)}` : ' · standalone order'}</div><div style="margin:8px 0">${o.order.items.map((i) => html`<div class="small">${i.qty}× ${i.name}</div>`)}</div><div class="row-between"><b>${formatPHP(o.order.total)}</b><div class="row">${o.order.status === 'paid' ? btn('Start preparing', { action: 'ord.status', data: { id: o.order.id, s: 'preparing' }, variant: 'secondary', size: 'sm' }) : ''}${['paid', 'preparing'].includes(o.order.status) ? btn('Mark ready', { action: 'ord.status', data: { id: o.order.id, s: 'ready_for_pickup' }, variant: 'primary', size: 'sm' }) : ''}${o.order.status === 'ready_for_pickup' ? btn('Hand over', { action: 'ord.claim', data: { code: o.order.code }, variant: 'primary', size: 'sm' }) : ''}${['paid', 'preparing', 'ready_for_pickup'].includes(o.order.status) ? btn('Cancel', { action: 'ord.cancel', data: { id: o.order.id }, variant: 'ghost', size: 'sm' }) : ''}</div></div></div></div>`)}</div>` : empty('No orders here', undefined, undefined, 'bag')}`;
});
action('ord.tab', (el) => app.set('ordTab', el.dataset.key));
action('ord.status', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/orders/{orderId}/status', { businessId: app.businessId!, orderId: el.dataset.id!, status: el.dataset.s as never }), { success: el.dataset.s === 'ready_for_pickup' ? 'Marked ready — the player was notified.' : 'Preparing' });
});
action('ord.claim', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/orders/claims', { businessId: app.businessId!, code: el.dataset.code! }));
  if (r) app.toast(`Handed over to ${r.customer}. The code can't be used again.`, 'success');
});
action('ord.claim.open', () => app.modal({ title: 'Claim an order', body: html`<form data-form="ord.claim.form" class="stack-sm">${field({ name: 'code', label: 'Pickup code or scanned QR', placeholder: 'PU-XXXXXX', required: true })}${btn('Claim', { type: 'submit', variant: 'primary', block: true })}</form>` }));
form('ord.claim.form', async (fd) => {
  const r = await app.api.write('POST /v1/businesses/{businessId}/orders/claims', { businessId: app.businessId!, code: str(fd, 'code') });
  app.closeModal();
  app.toast(`${r.order.code} handed over to ${r.customer}`, 'success');
});
action('ord.cancel', async (el) => {
  const reason = window.prompt('Reason for cancelling (sent to the player):', 'Item unavailable');
  if (!reason) return;
  const r = await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/orders/{orderId}/cancel', { businessId: app.businessId!, orderId: el.dataset.id!, reason }));
  if (r) app.toast(`Order cancelled. Refund ${formatPHP(r.refunded)}.`, 'success');
});

// ---------------------------------------------------------------- customers

bizRoute('/biz/customers', 'Customers', (_ctx, b) => {
  const q = app.state<string>('custQ', '');
  const list = app.api.read('GET /v1/businesses/{businessId}/customers', { businessId: b.businessId, q });
  return html`${pageHeader('Customers', { subtitle: `${list.length} players have booked with you` })}<form data-form="cust.q" class="row" style="margin-bottom:12px"><input name="q" type="search" value="${q}" placeholder="Search by name" aria-label="Search customers" style="max-width:320px"/></form>
  ${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Player</th><th>Contact</th><th class="num">Bookings</th><th class="num">No-shows</th><th>Last visit</th><th class="num">Spent</th><th></th></tr></thead><tbody>${list.slice(0, 80).map((c) => html`<tr><td><b>${c.name}</b>${c.bookings > 1 ? html` ${tag('returning', 'success')}` : ''}${c.restricted ? html` ${tag('restricted', 'danger')}` : ''}</td><td class="small">${c.contact ?? '—'}</td><td class="num">${c.bookings}</td><td class="num">${c.noShows}</td><td class="nowrap">${c.lastVisit ? formatDateShort(c.lastVisit) : '—'}</td><td class="num">${formatPHP(c.spent)}</td><td class="right">${b.perms.has('restrictions.manage') && !c.restricted ? btn('Restrict', { action: 'rst.new', data: { user: c.userId, name: c.name }, variant: 'ghost', size: 'sm' }) : ''}</td></tr>`)}</tbody></table></div>`, { pad: false })}
  ${!b.perms.has('customers.view_contact') ? html`<p class="xs muted" style="margin-top:8px">${icon('lock', 12)} Contact details are masked for your role.</p>` : ''}`;
});
form('cust.q', (fd) => app.set('custQ', str(fd, 'q')));

// ---------------------------------------------------------------- restrictions

bizRoute('/biz/restrictions', 'Restrictions', (_ctx, b) => {
  const list = app.api.read('GET /v1/businesses/{businessId}/restrictions', { businessId: b.businessId });
  return html`${pageHeader('Player restrictions', { subtitle: 'Restrictions are private. Players see a neutral notice with how to appeal — never the reason or your notes.' })}
  ${card(list.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Player</th><th>Scope</th><th>Reason</th><th>Period</th><th>Status</th><th>Appeal</th><th></th></tr></thead><tbody>${list.map((r) => html`<tr><td><b>${r.player}</b><div class="xs muted">by ${r.createdBy}</div></td><td>${r.venue}</td><td>${REASON_LABEL[r.restriction.reasonCategory]}${r.canManage && r.restriction.internalNotes ? html`<div class="xs muted" style="max-width:280px">${r.restriction.internalNotes}</div>` : ''}</td><td class="nowrap small">${formatDateShort(r.restriction.startAt)} → ${r.restriction.endAt ? formatDateShort(r.restriction.endAt) : 'permanent'}</td><td>${pill(r.restriction.status)}</td><td>${r.restriction.appeal.status === 'none' ? '—' : html`${pill(r.restriction.appeal.status === 'submitted' ? 'pending' : r.restriction.appeal.status, r.restriction.appeal.status)}${r.restriction.appeal.message && r.canManage ? html`<div class="xs muted">“${r.restriction.appeal.message}”</div>` : ''}`}</td><td class="right">${r.canManage && r.restriction.status === 'active' ? html`${r.restriction.appeal.status === 'submitted' ? btn('Uphold', { action: 'rst.uphold', data: { id: r.restriction.id }, variant: 'secondary', size: 'sm' }) : ''}${btn('Lift', { action: 'rst.lift', data: { id: r.restriction.id }, variant: 'ghost', size: 'sm' })}` : ''}</td></tr>`)}</tbody></table></div>` : empty('No restrictions', 'Restrict a player from Customers when needed.', undefined, 'ban'), { pad: !list.length })}
  ${!b.perms.has('restrictions.manage') ? html`<p class="xs muted" style="margin-top:8px">${icon('lock', 12)} Your role can see restriction status and reason category only.</p>` : ''}`;
});
action('rst.new', (el) => {
  app.modal({
    title: `Restrict ${el.dataset.name}`,
    body: html`<form data-form="rst.create" data-user="${el.dataset.user}" class="stack-sm">${select({ name: 'reason', label: 'Reason category', options: Object.entries(REASON_LABEL).map(([value, label]) => ({ value, label })) })}${textarea({ name: 'notes', label: 'Internal notes (visible to managers only)', required: true, placeholder: 'What happened, when, and any warnings given' })}${select({ name: 'days', label: 'Duration', options: [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '0', label: 'Permanent (owner only)' }] })}${field({ name: 'evidence', label: 'Incident / evidence reference', placeholder: 'e.g. Front desk log FD-2026-0930' })}${btn('Restrict player', { type: 'submit', variant: 'danger', block: true })}</form>`,
  });
});
form('rst.create', async (fd, f) => {
  const days = Number(str(fd, 'days'));
  await app.api.write('POST /v1/businesses/{businessId}/restrictions', { businessId: app.businessId!, userId: f.dataset.user!, reasonCategory: str(fd, 'reason') as never, internalNotes: str(fd, 'notes'), endAt: days ? app.store.now() + days * DAY : null, evidenceRef: str(fd, 'evidence') });
  app.closeModal();
  app.toast('Player restricted. They received a neutral notice.', 'success');
});
action('rst.lift', async (el) => {
  const reason = window.prompt('Reason for lifting the restriction:');
  if (!reason) return;
  await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/restrictions/{restrictionId}/lift', { businessId: app.businessId!, restrictionId: el.dataset.id!, reason }), { success: 'Restriction lifted' });
});
action('rst.uphold', async (el) => {
  const note = window.prompt('Note to record with the decision:', 'Pattern of no-shows confirmed');
  if (!note) return;
  await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/restrictions/{restrictionId}/appeal-decision', { businessId: app.businessId!, restrictionId: el.dataset.id!, decision: 'upheld', note }), { success: 'Appeal decided' });
});

// ---------------------------------------------------------------- reviews

bizRoute('/biz/reviews', 'Reviews', (_ctx, b) => {
  const list = app.api.read('GET /v1/businesses/{businessId}/reviews', { businessId: b.businessId });
  const avg = list.length ? list.reduce((a, r) => a + r.review.rating, 0) / list.length : 0;
  return html`${pageHeader('Reviews', { subtitle: html`${stars(avg, list.length)} · verified bookings only` })}<div class="stack-sm">${list.slice(0, 40).map((r) => html`<div class="card"><div class="card-body"><div class="row-between"><div><b>${r.author}</b> <span class="xs muted">${r.venue} · ${formatDateShort(r.review.createdAt)}</span></div><div class="row">${stars(r.review.rating)}${r.review.status !== 'published' ? pill(r.review.status === 'flagged' ? 'pending' : 'removed', r.review.status) : ''}</div></div><p style="margin:8px 0">${r.review.body}</p>${r.review.reply ? html`<div class="alert alert-info small"><div class="alert-body"><b>Your reply</b><div>${r.review.reply.body}</div></div></div>` : b.perms.has('reviews.respond') ? html`<form data-form="rev.reply" data-id="${r.review.id}" class="row"><input name="body" placeholder="Write a public reply…" aria-label="Reply" style="flex:1"/>${btn('Reply', { type: 'submit', variant: 'secondary', size: 'sm' })}</form>` : ''}</div></div>`)}${list.length ? '' : empty('No reviews yet', undefined, undefined, 'star')}</div>`;
});
form('rev.reply', async (fd, f) => {
  await app.api.write('POST /v1/businesses/{businessId}/reviews/{reviewId}/reply', { businessId: app.businessId!, reviewId: f.dataset.id!, body: str(fd, 'body') });
  app.toast('Reply posted', 'success');
});

