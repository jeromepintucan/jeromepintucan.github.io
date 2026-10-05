/** Booking experience: availability timeline, hold + checkout, payment return/confirmation, booking details. */

import { formatPHP } from '../../domain/money.ts';
import { addDays, DOW_SHORT, formatDateLong, formatDateShort, formatDuration, formatMinuteOfDay, formatTime, formatTimeRange, localDate, localParts, minuteLabelShort } from '../../domain/time.ts';
import type { Venue } from '../../services/model.ts';
import { action, app, form, onChange, route, str, type ViewCtx } from '../app.ts';
import { productTile, venueCover } from '../art.ts';
import { alertBox, btn, card, checkbox, countdown, dl, empty, field, pageHeader, pill, priceBreakdown, qrCode, stars, tabs, textarea, timeline } from '../components.ts';
import { cls, html, type SafeHtml } from '../html.ts';
import { icon } from '../icons.ts';
import { methodLogo, sportName, sportPicker } from './shared.ts';

interface Pick {
  venueId: string;
  courtId: string;
  startMs: number;
}

// ---------------------------------------------------------------- availability panel

export function availabilityPanel(ctx: ViewCtx, v: Venue, inApp: boolean): SafeHtml {
  const today = localDate(app.store.now());
  const date = app.state<string>(`date:${v.id}`, ctx.query.get('date') && ctx.query.get('date')! >= today ? ctx.query.get('date')! : today);
  const offered = (v.sports?.length ? v.sports : ['pickleball']);
  const sport = app.state<string>(`sport:${v.id}`, ctx.query.get('sport') && offered.includes(ctx.query.get('sport')!) ? ctx.query.get('sport')! : offered[0]!);
  const durKey = `dur:${v.id}:${sport}`;
  const av = app.api.read('GET /v1/public/venues/{venueId}/availability', { venueId: v.id, date, sport, ...(app.ui[durKey] ? { durationMinutes: app.ui[durKey] as number } : {}) });
  const duration = av.durationMinutes;
  const pick = app.ui.pick as Pick | undefined;
  const picked = pick && pick.venueId === v.id ? pick : null;
  const durations: number[] = [];
  for (let d = v.settings.minDurationMinutes; d <= v.settings.maxDurationMinutes; d += Math.min(30, v.settings.incrementMinutes)) if (d % v.settings.incrementMinutes === 0 || d % 30 === 0) durations.push(d);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const cols = av.courts[0]?.cells.map((c) => c.startMs) ?? [];
  const pickedCell = picked ? av.courts.find((c) => c.court.id === picked.courtId)?.cells.find((c) => c.startMs === picked.startMs) : null;
  const inRange = (courtId: string, startMs: number) => !!picked && picked.courtId === courtId && startMs > picked.startMs && startMs < picked.startMs + duration * 60_000;
  const layouts = [...new Set(av.courts.map((c) => c.court.layout ?? 'standard'))];
  const layoutFilter = app.state<string>(`layout:${v.id}:${sport}`, '');
  const shown = av.courts.filter((c) => !layoutFilter || (c.court.layout ?? 'standard') === layoutFilter);
  return html`<div class="stack" data-venue-root="${v.id}">
    ${av.sports.length > 1 ? html`<div><p class="label" style="margin-bottom:6px">What are you playing?</p>${sportPicker(sport, 'av.sport', { all: false, only: av.sports, data: { venue: v.id } })}</div>` : ''}
    ${layouts.length > 1 ? html`<div class="row"><span class="label">Court</span><div class="seg" role="group" aria-label="Full or half court"><button class="${!layoutFilter ? 'active' : ''}" data-action="av.layout" data-venue="${v.id}" data-sport="${sport}" data-layout="">All</button>${layouts.map((l) => html`<button class="${layoutFilter === l ? 'active' : ''}" data-action="av.layout" data-venue="${v.id}" data-sport="${sport}" data-layout="${l}">${l === 'full' ? 'Full court' : l === 'half' ? 'Half court' : 'Standard'}</button>`)}</div><span class="xs muted">${icon('info', 12)} Full and half courts share the same floor — booking one blocks the other.</span></div>` : ''}
    ${av.restricted ? alertBox('warning', "Booking isn't available for your account at this venue", 'If you think this is a mistake, check your notifications to appeal or contact CourtKo Support.') : ''}
    ${!av.businessActive ? alertBox('warning', 'This venue is not taking bookings right now') : ''}
    <div class="date-chips" role="group" aria-label="Choose a date">${days.map((d) => {
      const p = localParts(Date.parse(`${d}T04:00:00Z`));
      return html`<button class="${cls('date-chip', d === date && 'active')}" data-action="av.date" data-venue="${v.id}" data-date="${d}" aria-pressed="${d === date ? 'true' : 'false'}"><small>${d === today ? 'Today' : DOW_SHORT[p.dow]}</small><b>${p.day}</b></button>`;
    })}</div>
    <div class="row-between"><div class="row"><label for="dur" class="label">Duration</label><select id="dur" style="width:auto" data-change="av.duration" data-key="${durKey}">${durations.map((d) => html`<option value="${d}"${d === duration ? html` selected` : ''}>${formatDuration(d)}</option>`)}</select></div>
    <span class="small muted">${formatDateLong(date)} · ${av.schedule.closed ? 'Closed' : `${formatMinuteOfDay(av.schedule.open)} – ${formatMinuteOfDay(av.schedule.close)}`}${av.schedule.note ? ` · ${av.schedule.note}` : ''} · Manila time</span></div>
    ${av.schedule.closed ? empty('Closed on this date', av.schedule.note ?? 'Pick another date.', undefined, 'calendar') : html`<div class="avail" role="region" aria-label="Court availability"><div class="avail-grid">
      <div class="avail-row avail-head" style="grid-template-columns:128px repeat(${cols.length},58px)"><div class="avail-court">Court</div>${cols.map((c) => html`<div class="avail-time">${minuteLabelShort(localParts(c).minute)}${localParts(c).minute % 60 ? html`<span>:30</span>` : ''}</div>`)}</div>
      ${shown.map((c) => html`<div class="avail-row" style="grid-template-columns:128px repeat(${cols.length},58px)"><div class="avail-court">${c.court.name}<small>${c.court.layout === 'half' ? 'Half court · ' : c.court.layout === 'full' && layouts.length > 1 ? 'Full court · ' : ''}${c.court.environment} · ${c.bookableStarts} open</small></div>${c.cells.map((cell) => {
        const sel = picked && picked.courtId === c.court.id && picked.startMs === cell.startMs;
        const state = cell.state === 'available' && !cell.bookable ? 'nofit' : cell.state;
        const label = cell.bookable ? formatPHP(cell.price ?? 0, { compact: true }).replace('₱', '₱') : state === 'booked' ? 'Booked' : state === 'held' ? 'Held' : state === 'blocked' ? 'Closed' : state === 'event' ? 'Event' : state === 'open_play' ? 'Open Play' : state === 'dependent' ? 'In use' : state === 'nofit' ? '—' : '';
        const aria = `${c.court.name} ${formatTime(cell.startMs)}: ${cell.bookable ? `available, ${formatPHP(cell.price ?? 0)} for ${formatDuration(duration)}` : (cell.reason ?? state)}`;
        return html`<button class="${cls('slot', state, sel && 'selected', inRange(c.court.id, cell.startMs) && 'in-range')}" ${cell.bookable && !av.restricted ? html`data-action="av.pick" data-venue="${v.id}" data-court="${c.court.id}" data-start="${cell.startMs}"` : html`disabled`} aria-label="${aria}" title="${aria}">${label}</button>`;
      })}</div>`)}
    </div></div>
    <div class="legend-row"><span><i style="background:var(--ck-color-primary-50)"></i>Available (price for your duration)</span><span><i style="background:var(--ck-slate-200)"></i>Booked</span><span><i style="background:repeating-linear-gradient(45deg,#FEF3C7 0 4px,#FDE68A 4px 8px)"></i>Someone is checking out</span><span><i style="background:var(--ck-color-event-bg)"></i>Event / Open Play</span>${layouts.length > 1 || av.sports.length > 1 ? html`<span><i style="background:repeating-linear-gradient(-45deg,#E0F2FE 0 4px,#BAE6FD 4px 8px)"></i>Shared space in use (e.g. full court booked)</span>` : ''}<span><i style="background:repeating-linear-gradient(45deg,#F1F5F9 0 3px,#CBD5E1 3px 5px)"></i>Maintenance</span></div>`}
    ${picked && pickedCell ? html`<div class="select-bar"><div><b>${av.courts.find((c) => c.court.id === picked.courtId)?.court.name} · ${formatDateShort(picked.startMs)} · ${formatTimeRange(picked.startMs, picked.startMs + duration * 60_000)}</b><div class="small muted">${formatDuration(duration)} · ${formatPHP(pickedCell.price ?? 0)} before add-ons and fees</div></div><div class="row">${btn('Clear', { action: 'av.clear', variant: 'ghost' })}${btn(ctx.me ? 'Continue to checkout' : 'Sign in to book', { action: 'av.hold', data: { venue: v.id, slug: v.slug, inapp: inApp ? '1' : '', duration }, variant: 'primary', icon: 'lock', size: 'lg' })}</div></div>` : html`<p class="small muted">Tap an available time to select it. We'll hold the court for ${v.settings.holdTtlMinutes} minutes while you check out.</p>`}
  </div>`;
}

action('av.date', (el) => {
  app.ui.pick = undefined;
  app.set(`date:${el.dataset.venue}`, el.dataset.date);
});
action('av.sport', (el) => {
  app.ui.pick = undefined;
  app.set(`sport:${el.dataset.venue}`, el.dataset.sport);
});
action('av.layout', (el) => app.set(`layout:${el.dataset.venue}:${el.dataset.sport}`, el.dataset.layout ?? ''));
onChange('av.duration', (el) => {
  app.ui.pick = undefined;
  app.set(el.dataset.key!, Number((el as HTMLSelectElement).value));
});
action('av.pick', (el) => app.set('pick', { venueId: el.dataset.venue!, courtId: el.dataset.court!, startMs: Number(el.dataset.start) }));
action('av.clear', () => app.set('pick', undefined));
action('av.hold', async (el) => {
  const pick = app.ui.pick as Pick | undefined;
  if (!pick) return;
  if (!app.me()) {
    app.toast('Sign in or create an account to book. Your selection is kept.', 'info');
    return app.navigate(`#/login?next=${encodeURIComponent(`/app/book/${el.dataset.slug}`)}`);
  }
  const durationMinutes = Number(el.dataset.duration) || 60;
  const r = await app.run(el, () => app.api.write('POST /v1/me/booking-holds', { venueId: pick.venueId, courtId: pick.courtId, startMs: pick.startMs, durationMinutes }, { idempotencyKey: app.idem() }));
  if (r) {
    app.ui.pick = undefined;
    app.navigate(`#/app/checkout/${r.checkoutId}`);
  }
});

// ---------------------------------------------------------------- checkout (review & pay)

route('/app/checkout/:id', 'player', 'Checkout', (ctx) => {
  const co = app.api.read('GET /v1/me/checkouts/{checkoutId}', { checkoutId: ctx.params.id! });
  const c = co.checkout;
  const latestPay = [...co.payments].sort((a, b) => b.createdAt - a.createdAt)[0];
  // Confirmed → go to booking/order/event
  if (c.status === 'completed') {
    return html`<div class="container-narrow">${card(html`<div class="center stack">${icon('checkCircle', 48)}<h1>${c.kind === 'court_booking' ? "You're booked!" : c.kind === 'event_registration' || c.kind === 'open_play_registration' ? "You're registered!" : 'Order placed!'}</h1><p class="muted">Payment verified with the provider${latestPay?.confirmedVia ? ` (via ${latestPay.confirmedVia.replace('_', ' ')})` : ''}. A receipt was sent to your inbox.</p>${co.booking ? btn('View booking & QR code', { href: `#/app/bookings/${co.booking.id}`, variant: 'primary', size: 'lg', icon: 'qr' }) : co.openPlay ? btn('View my Open Play pass', { href: `#/app/open-play/registrations/${co.openPlay.registration.id}`, variant: 'primary', size: 'lg', icon: 'qr' }) : c.orderId ? btn('View order', { href: `#/app/orders/${c.orderId}`, variant: 'primary', size: 'lg' }) : btn('My events', { href: '#/app/events', variant: 'primary', size: 'lg' })}</div>`)}</div>`;
  }
  if (c.status === 'payment_pending' && latestPay?.status === 'pending') {
    const returned = ctx.query.get('return') === '1';
    return html`<div class="container-narrow">${card(html`<div class="center stack"><div class="splash-inline">${icon('refresh', 40)}</div><h1>${returned ? 'Confirming your payment…' : 'Waiting for payment'}</h1><p class="muted">${returned ? "You're back from the payment page. We confirm your booking only after the payment provider verifies it with our server — usually a few seconds." : 'Complete the payment on the provider page. This page updates automatically.'}</p>
    ${dl([['Amount', formatPHP(latestPay.amount)], ['Method', latestPay.methodDisplay], ['Hold expires in', countdown(c.expiresAt)], ['Provider reference', html`<code>${latestPay.providerSessionId}</code>`]])}
    <div class="row" style="justify-content:center">${btn('Open payment page', { href: `#/pay/${latestPay.providerSessionId}`, variant: 'secondary', icon: 'external' })}${btn('Check status now', { action: 'co.verify', data: { id: c.id }, variant: 'primary', icon: 'refresh' })}</div>
    <p class="xs muted">Closed the tab or lost connection? No problem — if the provider confirms your payment, the booking completes on its own and you'll be notified. You will never be charged twice.</p></div>`)}</div>`;
  }
  if (c.status === 'expired' || c.status === 'cancelled' || c.status === 'failed') {
    const refund = co.payments.some((p) => ['captured', 'refunded', 'partially_refunded'].includes(p.status));
    return html`<div class="container-narrow">${card(html`<div class="center stack">${icon('clock', 40)}<h1>${c.status === 'expired' ? 'Your hold expired' : c.status === 'failed' ? "This checkout couldn't be completed" : 'Checkout cancelled'}</h1><p class="muted">${refund ? 'Your payment arrived after the checkout ended, so it is being refunded in full, including fees.' : c.cancelReason ?? 'No payment was taken. The court is available to others again.'}</p>${co.openPlay ? btn('Back to the session', { href: `#/app/open-play/${co.openPlay.session.id}`, variant: 'primary' }) : btn('Pick another time', { href: `#/app/book/${co.venue.slug}`, variant: 'primary' })}</div>`)}</div>`;
  }
  // open (or payment failed → back to open)
  const method = c.paymentMethod ?? (co.methods.find((m) => m.method === 'gcash') ?? co.methods[0])?.method ?? null;
  const failed = latestPay && latestPay.status === 'failed';
  const addOnsAllowed = c.kind !== 'product_order' && c.kind !== 'open_play_registration';
  const shop = addOnsAllowed ? app.api.read('GET /v1/public/venues/{venueId}/products', { venueId: c.venueId, purpose: c.kind === 'event_registration' ? 'event' : 'booking' }) : [];
  const qty = (pid: string) => c.addOns.find((a) => a.productId === pid)?.qty ?? 0;
  const q = co.snapshot.quote;
  if (!c.paymentMethod && method) queueMicrotask(() => void app.api.write('PATCH /v1/me/checkouts/{checkoutId}', { checkoutId: c.id, paymentMethod: method as never }, { silent: true }).catch(() => undefined));
  return html`${pageHeader('Review & pay', { back: co.openPlay ? `#/app/open-play/${co.openPlay.session.id}` : `#/app/book/${co.venue.slug}` })}
  <div class="hold-banner" role="status">${icon('lock', 20)}<div style="flex:1"><b>${co.court ? `${co.court.name} is held for you` : 'Your spot is held'}</b><div class="small">Complete payment before the timer ends — after that the ${co.court ? 'court' : 'spot'} is released to other players.</div></div><div class="row"><span class="countdown" data-countdown="${c.expiresAt}"></span>${c.expiresAt < c.maxExpiresAt ? btn('+5 min', { action: 'co.extend', data: { id: c.id }, variant: 'ghost', size: 'sm', title: 'Need more time? Extend the hold (up to 20 minutes total).' }) : ''}</div></div>
  ${failed ? alertBox('warning', 'The last payment attempt did not go through', `${latestPay!.failureReason ?? 'Payment failed'}. Your hold is still active — try again or choose another method.`) : ''}
  <div class="split" style="margin-top:16px"><div class="stack">
    ${card(html`<div class="row" style="align-items:flex-start"><div style="width:120px;border-radius:12px;overflow:hidden;aspect-ratio:16/10;flex:none">${venueCover(co.venue.art)}</div><div><b>${co.venue.name}</b><div class="small muted">${co.venue.address.barangay}, ${co.venue.address.city}</div>${co.booking ? html`<div style="margin-top:6px"><b>${co.court?.name}</b> · ${formatDateLong(co.booking.startMs)}<br/>${formatTimeRange(co.booking.startMs, co.booking.endMs)} (${formatDuration(co.booking.durationMinutes)}) · Manila time</div>` : ''}${co.registration || co.openPlay ? html`<div style="margin-top:6px">${co.openPlay ? html`<span class="pill pill-success">Open Play · ${sportName(co.openPlay.session.sport)}</span><br/>` : ''}${q.items.find((i) => i.kind === 'event')?.label}<br/><span class="small muted">${q.items.find((i) => i.kind === 'event')?.detail}</span></div>` : ''}</div></div>`, { title: co.openPlay ? 'Your Open Play spot' : 'Your booking' })}
    ${addOnsAllowed && shop.length ? card(html`<div class="stack-sm">${shop.map((p) => html`<div class="row-between"><div class="row">${productTile(p.product.art, 40)}<div><b class="small">${p.product.name}</b><div class="xs muted">${formatPHP(p.product.price)} · ${p.available > 0 ? `${p.available} left` : 'Out of stock'}</div></div></div>${p.product.variants.length ? html`<span class="xs muted">Sizes at the counter</span>` : html`<div class="stepper-input"><button type="button" data-action="co.addon" data-id="${c.id}" data-product="${p.product.id}" data-delta="-1" aria-label="Remove one ${p.product.name}"${qty(p.product.id) ? '' : html` disabled`}>−</button><span aria-live="polite">${qty(p.product.id)}</span><button type="button" data-action="co.addon" data-id="${c.id}" data-product="${p.product.id}" data-delta="1" aria-label="Add one ${p.product.name}"${p.available > qty(p.product.id) && qty(p.product.id) < p.product.maxPerOrder ? '' : html` disabled`}>+</button></div>`}</div>`)}</div><p class="xs muted" style="margin-top:8px">Items are reserved now and ready at the counter. Unclaimed add-ons are refunded in full if you cancel.</p>`, { title: 'Add-ons for pickup', subtitle: 'Optional' }) : ''}
    ${c.kind === 'open_play_registration' ? '' : card(html`<form class="row" data-form="co.promo" data-id="${c.id}" style="align-items:flex-end"><div style="flex:1">${field({ name: 'promoCode', label: 'Promo code', value: c.promoCode ?? '', placeholder: 'e.g. WELCOME10', autocomplete: 'off' })}</div>${btn(c.promoCode ? 'Update' : 'Apply', { type: 'submit', variant: 'secondary' })}${c.promoCode ? btn('Remove', { action: 'co.promo.remove', data: { id: c.id }, variant: 'ghost' }) : ''}</form>${q.discount ? alertBox('success', `${q.discount.code} applied: −${formatPHP(q.discount.amount)}`, q.discount.label) : html`<p class="xs muted">Try <code>WELCOME10</code> (10% off court time, platform-funded) or <code>DINK50</code> (₱50 off at Dink District, venue-funded).</p>`}`, { title: 'Discount' })}
    ${card(html`<div class="method-list" role="radiogroup" aria-label="Payment method">${co.methods.map((m) => html`<button type="button" class="${cls('method', m.method === method && 'active')}" role="radio" aria-checked="${m.method === method ? 'true' : 'false'}" data-action="co.method" data-id="${c.id}" data-method="${m.method}">${methodLogo(m.method)}<span class="method-body"><b>${m.label}</b><span class="method-fee block">${m.preview.fee ? `Processing fee ${formatPHP(m.preview.fee)}` : m.passThroughLockedReason ? 'No processing fee' : 'No processing fee'}</span></span><b class="money">${formatPHP(m.preview.total)}</b></button>`)}</div><p class="xs muted" style="margin-top:10px">${icon('lock', 12)} You'll finish on the payment provider's secure page. CourtKo never sees your card number, CVV, OTP or e-wallet PIN.</p>`, { title: 'Payment method' })}
  </div><div class="stack">
    ${card(html`${priceBreakdown(co.lines, q.total)}<p class="xs muted" style="margin-top:8px">Price locked until your hold ends${q.pricingRuleIds.length ? ' · rates applied: ' + q.courtSegments.map((s) => s.label).filter((x, i, a) => a.indexOf(x) === i).join(', ') : ''}. Snapshot <code>${co.snapshot.hash.slice(0, 12)}</code></p>`, { title: 'Price breakdown' })}
    ${card(html`<ul class="bullets small">${co.policy.lines.map((l) => html`<li>${l}</li>`)}</ul><form data-form="co.pay" data-id="${c.id}" data-method="${method ?? ''}" style="margin-top:12px">${checkbox({ name: 'acceptPolicy', label: html`I accept the <b>${co.policy.name}</b> cancellation policy (v${co.policy.version})`, required: true })}${btn(html`Pay ${formatPHP(q.total)}`, { type: 'submit', variant: 'primary', block: true, size: 'lg', icon: 'lock', disabled: !method })}</form>${btn('Cancel checkout', { action: 'co.cancel', data: { id: c.id }, variant: 'ghost', block: true })}`, { title: 'Cancellation policy' })}
  </div></div>`;
});

action('co.method', async (el) => {
  await app.run(el, () => app.api.write('PATCH /v1/me/checkouts/{checkoutId}', { checkoutId: el.dataset.id!, paymentMethod: el.dataset.method as never }, { silent: true }));
});
action('co.addon', async (el) => {
  const co = app.api.read('GET /v1/me/checkouts/{checkoutId}', { checkoutId: el.dataset.id! });
  const pid = el.dataset.product!;
  const list = co.checkout.addOns.map((a) => ({ ...a }));
  const cur = list.find((a) => a.productId === pid);
  if (cur) cur.qty = Math.max(0, cur.qty + Number(el.dataset.delta));
  else list.push({ productId: pid, variantId: null, qty: 1 });
  await app.run(el, () => app.api.write('PATCH /v1/me/checkouts/{checkoutId}', { checkoutId: co.checkout.id, addOns: list.filter((a) => a.qty > 0) }));
});
form('co.promo', async (fd, f) => {
  await app.api.write('PATCH /v1/me/checkouts/{checkoutId}', { checkoutId: f.dataset.id!, promoCode: str(fd, 'promoCode') || null });
  app.toast('Promo code applied', 'success');
});
action('co.promo.remove', async (el) => {
  await app.run(el, () => app.api.write('PATCH /v1/me/checkouts/{checkoutId}', { checkoutId: el.dataset.id!, promoCode: null }));
});
action('co.extend', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/me/checkouts/{checkoutId}/extend', { checkoutId: el.dataset.id! }), { success: 'Hold extended by 5 minutes' });
});
action('co.cancel', async (el) => {
  const ok = await app.confirm({ title: 'Cancel checkout?', body: 'The court will be released to other players. No payment has been taken.', confirmLabel: 'Release the court', danger: true });
  if (!ok) return;
  await app.run(el, () => app.api.write('DELETE /v1/me/checkouts/{checkoutId}', { checkoutId: el.dataset.id! }));
  history.back();
});
form('co.pay', async (fd, f) => {
  const method = f.dataset.method as never;
  const r = await app.api.write('POST /v1/me/checkouts/{checkoutId}/payment-sessions', { checkoutId: f.dataset.id!, paymentMethod: method, acceptPolicy: fd.get('acceptPolicy') === 'on' }, { idempotencyKey: `pay-${f.dataset.id}-${method}-${app.state<number>(`attempt:${f.dataset.id}`, 1)}` });
  app.ui[`attempt:${f.dataset.id}`] = app.state<number>(`attempt:${f.dataset.id}`, 1) + 1;
  app.navigate(r.redirectUrl);
});
action('co.verify', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /v1/me/checkouts/{checkoutId}/verify-payment', { checkoutId: el.dataset.id! }));
  if (r) app.toast(r.result === 'captured' ? 'Payment verified — booking confirmed!' : r.result === 'pending' ? 'The provider has not confirmed the payment yet.' : `Status: ${r.result}`, r.result === 'captured' ? 'success' : 'info');
});

// ---------------------------------------------------------------- player booking list & details

route('/app/bookings', 'player', 'My bookings', () => {
  const tab = app.state<'upcoming' | 'past' | 'cancelled'>('bkTab', 'upcoming');
  const list = app.api.read('GET /v1/me/bookings', { tab });
  return html`${pageHeader('My bookings', { actions: btn('Book a court', { href: '#/app/discover', variant: 'primary', icon: 'plus' }) })}${tabs([{ key: 'upcoming', label: 'Upcoming' }, { key: 'past', label: 'Past' }, { key: 'cancelled', label: 'Cancelled & refunded' }], tab, 'bk.tab')}
  ${list.length ? html`<div class="stack-sm">${list.map((b) => bookingRow(b))}</div>` : empty(tab === 'upcoming' ? 'No upcoming games' : 'Nothing here yet', tab === 'upcoming' ? 'Find a court and book in a few taps.' : undefined, tab === 'upcoming' ? btn('Find a court', { href: '#/app/discover', variant: 'primary' }) : undefined, 'calendar')}`;
});
action('bk.tab', (el) => app.set('bkTab', el.dataset.key));

function bookingRow(b: { booking: import('../../services/model.ts').Booking; venue: Venue; court: { name: string }; snapshot: { quote: { total: number } } | null }): SafeHtml {
  const bk = b.booking;
  return html`<a class="card" href="#/app/bookings/${bk.id}" style="display:flex;gap:14px;padding:12px;align-items:center"><div style="width:84px;border-radius:10px;overflow:hidden;aspect-ratio:4/3;flex:none">${venueCover(b.venue.art)}</div><div style="flex:1;min-width:0"><div class="row-between"><b>${b.venue.name}</b>${pill(bk.status)}</div><div class="small">${b.court.name} · ${formatDateShort(bk.startMs)} · ${formatTimeRange(bk.startMs, bk.endMs)}</div><div class="xs muted">${bk.code} · ${formatPHP(b.snapshot?.quote.total ?? 0)}</div></div>${icon('chevronRight', 18)}</a>`;
}

route('/app/bookings/:id', 'player', 'Booking', (ctx) => {
  const d = app.api.read('GET /v1/me/bookings/{bookingId}', { bookingId: ctx.params.id! });
  const b = d.booking;
  const pay = d.payments.find((p) => ['captured', 'partially_refunded', 'refunded', 'disputed'].includes(p.status));
  const q = d.snapshot?.quote;
  return html`${pageHeader(html`${d.venue.name}`, { back: '#/app/bookings', subtitle: html`${d.court.name} · ${formatDateLong(b.startMs)} · ${formatTimeRange(b.startMs, b.endMs)}`, actions: pill(b.status) })}
  ${b.lateRecovery ? alertBox('info', 'Late payment recovered', 'Your payment arrived after the hold expired, but the same court and time were still free, so we confirmed your booking.') : ''}
  <div class="split"><div class="stack">
    ${d.qrToken ? card(html`<div class="row" style="align-items:center;gap:20px">${qrCode(d.qrToken, 176, `Check-in QR for ${b.code}`)}<div><p class="muted small" style="margin:0">Booking code</p><p style="font-size:1.6rem;font-weight:800;letter-spacing:.06em;margin:0">${b.code}</p><p class="small muted">Show this QR or code at the front desk. Check-in opens ${d.venue.settings.checkInWindowMinutesBefore} min before your start time.</p><div class="row">${btn('Add to calendar', { action: 'bk.ics', data: { id: b.id }, variant: 'secondary', size: 'sm', icon: 'calendar' })}${btn('Directions', { href: `https://www.google.com/maps/search/?api=1&query=${d.venue.geo.lat},${d.venue.geo.lng}`, variant: 'ghost', size: 'sm', icon: 'pin' })}</div></div></div>`, { title: 'Check-in' }) : ''}
    ${card(html`${dl([['Court', `${d.court.name} (${d.court.environment})`], ['When', `${formatDateLong(b.startMs)}, ${formatTimeRange(b.startMs, b.endMs)} Manila time`], ['Duration', formatDuration(b.durationMinutes)], ['Players', html`${[`You`, ...b.participants.map((p) => p.name)].join(', ')}`], ['Policy', `${b.policy.name} v${b.policy.version} (accepted ${formatDateShort(b.policy.acceptedAt || b.createdAt)})`]])}${d.isOwner && ['confirmed'].includes(b.status) ? html`<form class="row" data-form="bk.participant" data-id="${b.id}" style="margin-top:12px;align-items:flex-end"><div style="flex:1">${field({ name: 'name', label: 'Add a player', placeholder: 'Name' })}</div><div style="flex:1">${field({ name: 'email', label: 'Email (optional, to invite)', type: 'email', placeholder: 'bea.santiago@example.com' })}</div>${btn('Add', { type: 'submit', variant: 'secondary' })}</form>` : ''}`, { title: 'Details' })}
    ${d.order ? card(html`<div class="row-between"><div>${d.order.items.map((i) => html`<div>${i.qty}× ${i.name}</div>`)}<div class="xs muted">Pickup code ${d.order.code}</div></div>${pill(d.order.status)}</div>`, { title: 'Add-ons' }) : ''}
    ${d.canReview ? card(html`<form data-form="bk.review" data-id="${b.id}"><div class="field"><span class="label">Rating</span><div class="chips" role="radiogroup">${[5, 4, 3, 2, 1].map((n) => html`<label class="chip"><input type="radio" name="rating" value="${n}" ${n === 5 ? html`checked` : ''} style="accent-color:var(--ck-color-primary)"/> ${n}★</label>`)}</div></div>${textarea({ name: 'body', label: 'Your review', required: true, maxlength: 1000, placeholder: 'How were the courts, staff and facilities?' })}${btn('Post review', { type: 'submit', variant: 'primary' })}</form>`, { title: 'Rate your visit', subtitle: 'Only verified, completed bookings can be reviewed.' }) : ''}
    ${d.review ? card(html`${stars(d.review.rating)}<p style="margin-top:8px">${d.review.body}</p>${d.review.reply ? alertBox('info', 'Venue reply', d.review.reply.body) : ''}`, { title: 'Your review' }) : ''}
    ${card(timeline(b.history), { title: 'Status history' })}
  </div><div class="stack">
    ${q ? card(html`<div class="receipt">${priceBreakdown(d.lines, q.total, { totalLabel: 'Total paid' })}${pay ? dl([['Paid with', pay.methodDisplay], ['Paid on', formatDateLong(pay.capturedAt ?? pay.createdAt)], ['Internal reference', html`<span class="ref">${pay.id}</span>`], ['Provider reference', html`<span class="ref">${pay.providerPaymentId ?? '—'}</span>`], ['Confirmed via', pay.confirmedVia ? pay.confirmedVia.replace('_', ' ') : '—']]) : ''}${d.refunds.length ? html`<h3 style="margin-top:14px">Refunds</h3>${d.refunds.map((r) => html`<div class="row-between small" style="padding:6px 0"><span>${r.reason}</span><span>${formatPHP(r.amount)} ${pill(r.status)}</span></div>`)}` : ''}<p class="xs muted" style="margin-top:10px">This is a payment acknowledgment. Official invoices for court rentals are issued by the venue (BIR requirements — see design doc 23).</p></div>`, { title: 'Receipt' }) : ''}
    ${d.canCancel || d.reschedule.ok ? card(html`<div class="stack-sm">${d.reschedule.ok ? btn('Reschedule', { action: 'bk.reschedule', data: { id: b.id, venue: d.venue.id }, variant: 'secondary', block: true, icon: 'swap' }) : html`<p class="xs muted">${d.reschedule.reason}</p>`}${d.canCancel ? btn('Cancel booking', { action: 'bk.cancel', data: { id: b.id }, variant: 'danger', block: true }) : ''}</div><ul class="bullets xs muted" style="margin-top:10px">${d.policyLines.slice(0, 3).map((l) => html`<li>${l}</li>`)}</ul>`, { title: 'Change of plans?' }) : ''}
    ${card(html`<p class="small muted">Something wrong with the court or facility?</p>${btn('Report an issue', { action: 'bk.issue', data: { id: b.id }, variant: 'ghost', icon: 'flag' })}`, { title: 'Help' })}
  </div></div>`;
});

action('bk.cancel', async (el) => {
  const id = el.dataset.id!;
  const q = app.api.read('GET /v1/me/bookings/{bookingId}/cancellation-quote', { bookingId: id });
  const ok = await app.confirm({
    title: 'Cancel this booking?',
    body: html`<p><b>${q.tierLabel}</b></p>${q.lines.length ? html`<dl class="breakdown">${q.lines.map((l) => html`<div class="bd-row"><dt>${l.label}</dt><dd>${formatPHP(l.customerAmount)}</dd></div>`)}<div class="bd-row bd-total"><dt>Refund to ${q.method ?? 'your payment method'}</dt><dd>${formatPHP(q.refundTotal)}</dd></div></dl>` : html`<p>No refund applies at this point under the policy you accepted.</p>`}${!q.feeRefundable ? html`<p class="xs muted">The payment processing fee is non-refundable for player cancellations, as shown before you paid.</p>` : ''}<p class="xs muted">This quote is valid until ${formatTime(q.validUntil)} (the next refund-tier boundary).</p>`,
    confirmLabel: q.refundTotal ? `Cancel & refund ${formatPHP(q.refundTotal)}` : 'Cancel without refund',
    danger: true,
  });
  if (!ok) return;
  await app.run(el, () => app.api.write('POST /v1/me/bookings/{bookingId}/cancel', { bookingId: id }, { idempotencyKey: app.idem() }), { success: q.refundTotal ? 'Booking cancelled — your refund is on its way.' : 'Booking cancelled.' });
});

action('bk.reschedule', (el) => {
  const id = el.dataset.id!;
  const d = app.api.read('GET /v1/me/bookings/{bookingId}', { bookingId: id });
  const date = app.state<string>(`rs:${id}`, localDate(d.booking.startMs));
  const av = app.api.read('GET /v1/public/venues/{venueId}/availability', { venueId: d.venue.id, date, durationMinutes: d.booking.durationMinutes });
  const oldPrice = d.snapshot?.quote.items.find((i) => i.kind === 'court')?.amount ?? 0;
  app.modal({
    title: 'Reschedule booking',
    wide: true,
    body: html`<p class="small muted">Pick a new time with the same or lower price (you'll be refunded any difference). ${d.policyLines.find((l) => l.startsWith('You can reschedule')) ?? ''}</p><div class="row" style="margin-bottom:10px"><label class="label" for="rsd">Date</label><input id="rsd" type="date" value="${date}" min="${localDate(app.store.now())}" data-change="rs.date" data-id="${id}" style="width:auto"/></div>
    <div class="stack-sm">${av.courts.map((c) => html`<div><b class="small">${c.court.name}</b><div class="chips" style="margin-top:6px">${c.cells.filter((x) => x.bookable).slice(0, 18).map((x) => html`<button class="chip" data-action="rs.pick" data-id="${id}" data-court="${c.court.id}" data-start="${x.startMs}"${(x.price ?? 0) > oldPrice ? html` disabled title="Costs more than your current booking"` : ''}>${formatTime(x.startMs)} · ${formatPHP(x.price ?? 0, { compact: true })}</button>`)}${c.bookableStarts === 0 ? html`<span class="xs muted">No times</span>` : ''}</div></div>`)}</div>`,
  });
});
onChange('rs.date', (el) => {
  app.ui[`rs:${el.dataset.id}`] = (el as HTMLInputElement).value;
  app.actions.get('bk.reschedule')!(el, new Event('click'));
});
action('rs.pick', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /v1/me/bookings/{bookingId}/reschedule', { bookingId: el.dataset.id!, startMs: Number(el.dataset.start), courtId: el.dataset.court! }, { idempotencyKey: app.idem() }));
  if (r) {
    app.closeModal();
    app.toast(r.refunded ? `Rescheduled. ${formatPHP(r.refunded)} price difference is being refunded.` : 'Booking rescheduled.', 'success');
  }
});
form('bk.participant', async (fd, f) => {
  await app.api.write('POST /v1/me/bookings/{bookingId}/participants', { bookingId: f.dataset.id!, name: str(fd, 'name'), email: str(fd, 'email') || undefined as never });
  app.toast('Player added', 'success');
});
form('bk.review', async (fd, f) => {
  await app.api.write('POST /v1/me/bookings/{bookingId}/review', { bookingId: f.dataset.id!, rating: Number(fd.get('rating')), body: str(fd, 'body') });
  app.toast('Thanks for your review!', 'success');
});
action('bk.issue', async (el) => {
  const details = window.prompt('Describe the issue (the venue and CourtKo Support will see this):');
  if (!details) return;
  await app.run(el, () => app.api.write('POST /v1/me/reports', { targetType: 'issue', targetId: el.dataset.id!, reason: 'Facility issue', details }), { success: 'Thanks — we logged your report.' });
});
action('bk.ics', (el) => {
  const d = app.api.read('GET /v1/me/bookings/{bookingId}', { bookingId: el.dataset.id! });
  const fmt = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CourtKo//Demo//EN', 'BEGIN:VEVENT', `UID:${d.booking.id}@courtko.example`, `DTSTAMP:${fmt(app.store.now())}`, `DTSTART:${fmt(d.booking.startMs)}`, `DTEND:${fmt(d.booking.endMs)}`, `SUMMARY:${sportName(d.booking.sport ?? 'pickleball')} · ${d.venue.name} (${d.court.name})`, `LOCATION:${d.venue.address.line1}, ${d.venue.address.city}`, `DESCRIPTION:Booking code ${d.booking.code}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  download(`courtko-${d.booking.code}.ics`, ics, 'text/calendar');
});

export function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
