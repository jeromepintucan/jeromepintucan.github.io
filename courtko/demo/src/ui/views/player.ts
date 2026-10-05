/** Player app: home, discover, venue booking, events, orders, shop, activity, favorites, notifications, profile, payments, settings. */

import { formatPHP } from '../../domain/money.ts';
import { formatDateLong, formatDateShort, formatDateTime, formatRelative, formatTimeRange, localDate } from '../../domain/time.ts';
import { action, app, form, route, str } from '../app.ts';
import { avatar, productTile, venueCover } from '../art.ts';
import { barChart, lineChart } from '../charts.ts';
import { alertBox, btn, card, dl, empty, field, kpi, pageHeader, pill, qrCode, select, tabs, tag, textarea, toggle } from '../components.ts';
import { html, type SafeHtml } from '../html.ts';
import { icon } from '../icons.ts';
import { download } from './booking.ts';
import { discoverView, eventDetailView, eventsView, venueDetailView } from './public.ts';
import { eventCard, openPlayCard, sportTag, venueCard } from './shared.ts';
import { attendancePill } from './openplay.ts';
import { mySportsSection, socialSettingsPanel } from './social.ts';

route('/app', 'player', 'Home', (ctx) => {
  const me = ctx.me!;
  const upcoming = app.api.read('GET /v1/me/bookings', { tab: 'upcoming' });
  const next = upcoming.find((b) => b.booking.status === 'confirmed' || b.booking.status === 'checked_in');
  const nearby = app.api.read('GET /v1/public/venues', { sort: 'next' }).rows.slice(0, 3);
  const events = app.api.read('GET /v1/public/events', {}).slice(0, 2);
  const act = app.api.read('GET /v1/me/activity');
  const past = app.api.read('GET /v1/me/bookings', { tab: 'past' }).filter((b) => b.booking.status === 'completed').slice(0, 1)[0];
  const inv = me.invitations;
  const restr = app.api.read('GET /v1/me/restrictions');
  const myOp = app.api.read('GET /v1/me/open-play/registrations').filter((r) => r.registration.status === 'confirmed' && r.session.endMs > app.store.now());
  // Live now, or the next session you're registered for today (check-in may already be open).
  const liveMine = myOp.find((r) => r.live) ?? myOp.filter((r) => r.session.startMs - app.store.now() < 18 * 3_600_000).sort((a, b) => a.session.startMs - b.session.startMs)[0];
  const opInvites = app.api.read('GET /v1/me/invites').filter((i) => i.invite.status === 'pending');
  const sports = app.api.read('GET /v1/me/sports');
  const opNear = app.api.read('GET /v1/public/open-play', {}).filter((o) => !myOp.some((m) => m.session.id === o.session.id)).slice(0, 2);
  return html`${pageHeader(`Hi, ${me.profile?.firstName ?? 'there'}!`, { subtitle: 'Ready for your next game?', actions: btn('Book a court', { href: '#/app/discover', variant: 'primary', icon: 'search' }) })}
  ${inv.map((i) => alertBox('info', `Invitation to join ${i.business.tradeName}`, `You were invited as ${i.roles.map((r) => r.name).join(', ')}.`, btn('Accept invitation', { action: 'inv.accept', data: { id: i.member.id }, variant: 'primary', size: 'sm' })))}
  ${restr.map((r) => alertBox('warning', `Booking access paused at ${r.where}`, `Until ${r.endAt ? formatDateLong(r.endAt) : 'further notice'}. Other venues are not affected.`, r.appeal === 'none' ? btn('Submit an appeal', { action: 'restr.appeal', data: { id: r.id }, variant: 'secondary', size: 'sm' }) : tag(`Appeal ${r.appeal}`, 'info')))}
  ${opInvites.map((i) => alertBox('info', `${i.from} invited you to ${i.session.title}`, `${i.venue.name} · ${formatDateShort(i.session.startMs)} ${formatTimeRange(i.session.startMs, i.session.endMs)}`, btn('Respond', { href: '#/app/invites', variant: 'primary', size: 'sm' })))}
  ${liveMine ? html`<a class="card live-card" href="#/app/open-play/registrations/${liveMine.registration.id}"><div class="row" style="padding:14px 16px;gap:14px;align-items:center"><span class="live-pulse" data-live="1">${icon('live', 22)}</span><div style="flex:1"><p class="eyebrow" style="margin:0">${liveMine.live ? 'Open Play · live now' : `Open Play · starts ${formatRelative(liveMine.session.startMs, app.store.now())}`}</p><b>${liveMine.session.title}</b><div class="small">${liveMine.venue.name} · <b>${liveMine.checkedIn}</b> ${liveMine.live ? 'here' : 'already checked in'}${liveMine.live ? ` · ${liveMine.playing} playing` : ` · ${liveMine.registered} registered`}</div></div>${attendancePill(liveMine.registration.attendance)}${icon('chevronRight', 20)}</div></a>` : ''}
  ${sports.sports.length ? html`<div class="my-sports-strip">${sports.sports.map((sp) => html`<a href="#/app/profile" class="strip-item">${sportTag(sp.sport)}<b>${sp.sessions}</b><span class="xs muted">sessions</span></a>`)}<a href="#/app/profile" class="strip-item more">My sports ${icon('chevronRight', 14)}</a></div>` : ''}
  <div class="split" style="margin-top:12px"><div class="stack">
    ${next ? html`<a class="card" href="#/app/bookings/${next.booking.id}" style="display:block;overflow:hidden"><div class="row" style="padding:16px;align-items:center;gap:18px"><div style="width:110px;border-radius:12px;overflow:hidden;aspect-ratio:4/3;flex:none">${venueCover(next.venue.art, { sport: next.booking.sport ?? 'pickleball' })}</div><div style="flex:1"><p class="eyebrow">Next game ${formatRelative(next.booking.startMs, app.store.now())}</p><h2 style="margin:0">${next.venue.name}</h2><p class="muted" style="margin:4px 0">${next.court.name} · ${formatDateShort(next.booking.startMs)} · ${formatTimeRange(next.booking.startMs, next.booking.endMs)}</p><span class="pill pill-success">${next.booking.code}</span></div>${icon('chevronRight', 20)}</div></a>` : card(empty('No upcoming games', 'Find a court and book in a few taps.', btn('Find a court', { href: '#/app/discover', variant: 'primary' }), 'calendar'))}
    ${past ? card(html`<div class="row-between"><div><b>${past.venue.name}</b><div class="small muted">${past.court.name} · ${formatDateShort(past.booking.startMs)} · ${formatTimeRange(past.booking.startMs, past.booking.endMs)}</div></div>${btn('Book again', { href: `#/app/book/${past.venue.slug}`, variant: 'secondary', icon: 'refresh' })}</div>`, { title: 'Play again' }) : ''}
    <div><div class="row-between"><h2>Open soonest</h2><a href="#/app/discover" class="small">See all</a></div><div class="venue-grid">${nearby.map((r) => venueCard(r, '#/app/book'))}</div></div>
  </div><div class="stack">
    <div class="grid g2">${kpi('Sessions played', String(act.totals.sessions), `${act.totals.hours.toFixed(1)} hrs on court`, { icon: 'activity' })}${kpi('Venues visited', String(act.totals.venues), `${act.totals.perWeek.toFixed(1)} games / week`, { icon: 'pin', tone: 'info' })}</div>
    ${myOp.length ? card(html`<div class="stack-sm">${myOp.slice(0, 3).map((r) => html`<a class="row-between" href="#/app/open-play/registrations/${r.registration.id}" style="text-decoration:none;color:inherit"><span>${sportTag(r.session.sport, { small: true })} <b class="small">${r.session.title}</b><div class="xs muted">${r.venue.name} · ${formatDateShort(r.session.startMs)} ${formatTimeRange(r.session.startMs, r.session.endMs)}</div></span>${icon('chevronRight', 16)}</a>`)}</div>`, { title: 'My Open Play', actions: btn('All', { href: '#/app/open-play', variant: 'ghost', size: 'sm' }) }) : ''}
    ${opNear.length ? card(html`<div class="stack-sm">${opNear.map((o) => openPlayCard(o, '#/app/open-play'))}</div>`, { title: 'Open Play near you', actions: btn('All', { href: '#/app/open-play', variant: 'ghost', size: 'sm' }) }) : ''}
    ${events.length ? card(html`<div class="stack-sm">${events.map((e) => eventCard(e, '#/app/events'))}</div>`, { title: 'Events for you', actions: btn('All', { href: '#/app/events', variant: 'ghost', size: 'sm' }) }) : ''}
  </div></div>`;
}, { auth: true });

action('inv.accept', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/staff/me/memberships/{memberId}/accept', { memberId: el.dataset.id! }), { success: 'You joined the team. Open the Business portal from the top bar.' });
});
action('restr.appeal', async (el) => {
  const message = window.prompt('Explain why you think this should be reviewed (sent to the venue):');
  if (!message) return;
  await app.run(el, () => app.api.write('POST /v1/me/restrictions/{restrictionId}/appeal', { restrictionId: el.dataset.id!, message }), { success: 'Appeal submitted.' });
});

route('/app/discover', 'player', 'Discover', (ctx) => discoverView(ctx, true), { auth: true });
route('/app/book/:slug', 'player', 'Book a court', (ctx) => html`${btn('Discover', { href: '#/app/discover', variant: 'ghost', size: 'sm', icon: 'chevronLeft' })}<div style="margin-top:8px">${venueDetailView(ctx, true)}</div>`, { auth: true });

// ---------------------------------------------------------------- events

route('/app/events', 'player', 'Events', (ctx) => {
  const regs = app.api.read('GET /v1/me/events/registrations');
  return html`${regs.length ? card(html`<div class="stack-sm">${regs.map((r) => html`<div class="row-between"><div><b>${r.event.name}</b><div class="small muted">${r.venue.name} · ${formatDateShort(r.event.startMs)} · ${formatTimeRange(r.event.startMs, r.event.endMs)}</div></div><div class="row">${pill(r.registration.status)}${r.registration.status === 'waitlisted' ? tag(`#${r.registration.waitlistPosition}`, 'event') : ''}${r.registration.status === 'offered' ? btn('Claim spot', { action: 'ev.accept', data: { id: r.registration.id }, variant: 'primary', size: 'sm' }) : ''}${['confirmed', 'waitlisted', 'offered'].includes(r.registration.status) && r.event.startMs > app.store.now() ? btn(r.registration.status === 'confirmed' ? 'Withdraw' : 'Leave waitlist', { action: 'ev.withdraw', data: { id: r.registration.id }, variant: 'ghost', size: 'sm' }) : ''}</div></div>`)}</div>`, { title: 'My registrations' }) : ''}<div style="margin-top:16px">${eventsView(ctx, '#/app/events')}</div>`;
}, { auth: true });
route('/app/events/:id', 'player', 'Event', (ctx) => eventDetailView(ctx, true), { auth: true });
action('ev.accept', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /v1/me/events/registrations/{registrationId}/accept-offer', { registrationId: el.dataset.id! }, { idempotencyKey: app.idem() }));
  if (r) app.navigate(`#/app/checkout/${r.checkoutId}`);
});
action('ev.withdraw', async (el) => {
  const ok = await app.confirm({ title: 'Withdraw?', body: 'Refunds follow the event cancellation policy. Your spot goes to the next player on the waitlist.', confirmLabel: 'Withdraw', danger: true });
  if (!ok) return;
  const r = await app.run(el, () => app.api.write('POST /v1/me/events/registrations/{registrationId}/withdraw', { registrationId: el.dataset.id! }));
  if (r) app.toast(r.refundTotal ? `Withdrawn. ${formatPHP(r.refundTotal)} refund on its way.` : 'Withdrawn.', 'success');
});

// ---------------------------------------------------------------- orders & shop

route('/app/orders', 'player', 'Orders', () => {
  const list = app.api.read('GET /v1/me/orders');
  return html`${pageHeader('Orders & pickups')}${list.length ? html`<div class="stack-sm">${list.map((o) => html`<a class="card" href="#/app/orders/${o.order.id}" style="display:flex;gap:12px;padding:14px;align-items:center"><span class="kpi-icon">${icon('bag', 18)}</span><div style="flex:1"><b>${o.order.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</b><div class="small muted">${o.venue.name} · ${o.order.code} · ${formatPHP(o.order.total)}</div></div>${pill(o.order.status)}</a>`)}</div>` : empty('No orders yet', 'Add drinks, rentals or gear when you book, or order from a venue shop.', undefined, 'bag')}`;
}, { auth: true });

route('/app/orders/:id', 'player', 'Order', (ctx) => {
  const o = app.api.read('GET /v1/me/orders/{orderId}', { orderId: ctx.params.id! });
  return html`${pageHeader(`Order ${o.order.code}`, { back: '#/app/orders', subtitle: o.venue.name, actions: pill(o.order.status) })}<div class="split"><div class="stack">
  ${o.claimToken ? card(html`<div class="row" style="gap:20px">${qrCode(o.claimToken, 160, 'Pickup QR')}<div><p class="muted small" style="margin:0">Pickup code</p><p style="font-size:1.5rem;font-weight:800;letter-spacing:.06em;margin:0">${o.order.code}</p><p class="small muted">${o.order.status === 'ready_for_pickup' ? 'Ready now — show this at the counter.' : 'We will notify you when it is ready.'} Each code can be claimed once.</p>${o.pickupInstructions.map((p) => html`<p class="small">${icon('info', 14)} ${p}</p>`)}</div></div>`, { title: 'Pickup' }) : ''}
  ${card(html`${o.order.items.map((i) => html`<div class="row-between" style="padding:6px 0"><span>${i.qty}× ${i.name}</span><b>${formatPHP(i.total)}</b></div>`)}<hr/><div class="row-between"><b>Total</b><b>${formatPHP(o.order.total)}</b></div>`, { title: 'Items' })}</div>
  <div>${card(html`<ol class="timeline">${o.order.history.map((h) => html`<li><span class="tl-dot"></span><div>${pill(h.to)} <span class="small muted">${formatDateTime(h.at)}</span></div></li>`)}</ol>`, { title: 'Status' })}</div></div>`;
}, { auth: true });

route('/app/shop/:venueId', 'player', 'Venue shop', (ctx) => {
  const items = app.api.read('GET /v1/public/venues/{venueId}/products', { venueId: ctx.params.venueId! });
  const cart = app.state<Record<string, number>>(`cart:${ctx.params.venueId}`, {});
  const total = items.reduce((a, p) => a + (cart[p.product.id] ?? 0) * p.product.price, 0);
  return html`${pageHeader('Order for pickup', { back: '#/app/discover', subtitle: 'Pay now, pick up at the counter with your code.' })}<div class="grid g3">${items.map((p) => html`<div class="card"><div class="card-body row" style="align-items:flex-start">${productTile(p.product.art, 56)}<div style="flex:1"><b>${p.product.name}</b><div class="small muted">${formatPHP(p.product.price)} · ${p.available} left</div><div class="stepper-input" style="margin-top:8px"><button data-action="cart.add" data-venue="${ctx.params.venueId}" data-product="${p.product.id}" data-d="-1" aria-label="Remove">−</button><span>${cart[p.product.id] ?? 0}</span><button data-action="cart.add" data-venue="${ctx.params.venueId}" data-product="${p.product.id}" data-d="1" aria-label="Add"${(cart[p.product.id] ?? 0) >= Math.min(p.available, p.product.maxPerOrder) ? html` disabled` : ''}>+</button></div>${p.product.variants.length ? html`<div class="xs muted">Size: ${p.product.variants[0]!.name} (change at counter)</div>` : ''}</div></div></div>`)}</div>
  <div class="select-bar" style="margin-top:16px"><b>Total ${formatPHP(total)}</b>${btn('Checkout', { action: 'cart.checkout', data: { venue: ctx.params.venueId }, variant: 'primary', disabled: total === 0 })}</div>`;
}, { auth: true });
action('cart.add', (el) => {
  const cart = app.state<Record<string, number>>(`cart:${el.dataset.venue}`, {});
  cart[el.dataset.product!] = Math.max(0, (cart[el.dataset.product!] ?? 0) + Number(el.dataset.d));
  app.render();
});
action('cart.checkout', async (el) => {
  const venueId = el.dataset.venue!;
  const cart = app.state<Record<string, number>>(`cart:${venueId}`, {});
  const shop = app.api.read('GET /v1/public/venues/{venueId}/products', { venueId });
  const items = Object.entries(cart).filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty, variantId: shop.find((p) => p.product.id === productId)?.product.variants[0]?.id ?? null }));
  const r = await app.run(el, () => app.api.write('POST /v1/me/orders', { venueId, items }, { idempotencyKey: app.idem() }));
  if (r) {
    app.ui[`cart:${venueId}`] = {};
    app.navigate(`#/app/checkout/${r.checkoutId}`);
  }
});

// ---------------------------------------------------------------- activity

route('/app/activity', 'player', 'Activity', () => {
  const a = app.api.read('GET /v1/me/activity');
  const srcLabel: Record<string, string> = { self_declared: 'Self-declared', venue_verified: 'Venue-verified', platform_recreational: 'CourtKo recreational (beta)', external: 'External provider' };
  const plat = a.ratings.find((r) => r.source === 'platform_recreational');
  return html`${pageHeader('Your activity', { subtitle: 'Stats from your bookings and officially recorded matches. You control who sees them in Settings.' })}
  <div class="grid g4">${kpi('Sessions', String(a.totals.sessions), 'completed games', { icon: 'activity' })}${kpi('Hours played', a.totals.hours.toFixed(1), `${a.totals.perWeek.toFixed(1)} games / week`, { icon: 'clock', tone: 'info' })}${kpi('Venues visited', String(a.totals.venues), `${a.totals.upcoming} upcoming`, { icon: 'pin', tone: 'event' })}${kpi('Match record', `${a.matches.wins}–${a.matches.losses}`, `${a.matches.played} recorded matches`, { icon: 'trophy', tone: 'warning' })}</div>
  <div class="split" style="margin-top:16px"><div class="stack">
    ${card(barChart(a.byWeek.map((w, i) => ({ label: i === a.byWeek.length - 1 ? 'This wk' : formatDateShort(w.weekStart).split(', ')[1]!, value: w.sessions, highlight: i === a.byWeek.length - 1 })), { title: 'Sessions per week (last 12 weeks)' }), { title: 'Playing frequency', subtitle: 'Sessions per week' })}
    ${plat?.history.length ? card(html`${lineChart(plat.history.map((h) => ({ label: formatDateShort(h.at).split(', ')[1]!, value: h.value })), { title: 'Recreational rating trend', format: (n) => n.toFixed(2) })}<p class="xs muted">Beta rating calculated by CourtKo from recorded match results. Not an official rating.</p>`, { title: 'Rating progress' }) : ''}
    ${card(a.matches.recent.length ? html`${a.matches.recent.map((m) => { const mine = m.match.sideA.length && app.me() && m.match.sideA.includes(app.me()!.user.id); const won = mine ? m.match.scoreA > m.match.scoreB : m.match.scoreB > m.match.scoreA; return html`<div class="row-between" style="padding:6px 0"><span>${m.event} · ${m.match.round}</span><span>${tag(won ? 'W' : 'L', won ? 'success' : 'danger')} <b>${m.match.scoreA}–${m.match.scoreB}</b></span></div>`; })}` : empty('No recorded matches yet'), { title: 'Recent results', subtitle: 'Recorded by event organizers' })}
  </div><div class="stack">
    ${card(html`${a.ratings.map((r) => html`<div class="row-between" style="padding:8px 0;border-bottom:1px solid var(--ck-slate-100)"><div><b>${r.value ?? r.label}</b><div class="xs muted">${r.value ? r.label : ''}</div></div>${tag(srcLabel[r.source] ?? r.source, r.source === 'venue_verified' ? 'success' : r.source === 'self_declared' ? 'neutral' : 'info')}</div>`)}<p class="xs muted" style="margin-top:8px">Every rating shows its source. External ratings (e.g. a national rating system) appear only with an official API and your permission.</p>`, { title: 'Skill ratings' })}
    ${card(html`${a.venues.slice(0, 5).map((v) => html`<div class="row-between" style="padding:6px 0"><a href="#/app/book/${v.venue.slug}">${v.venue.name}</a><span class="small">${v.sessions} sessions</span></div>`)}`, { title: 'Favorite spots' })}
    ${card(html`<div class="stack-sm">${a.badges.map((b) => html`<div class="row" style="opacity:${b.earned ? 1 : 0.45}"><span class="kpi-icon ${b.earned ? '' : 'kpi-info'}">${icon(b.earned ? 'trophy' : 'lock', 16)}</span><div><b class="small">${b.label}</b><div class="xs muted">${b.detail}</div></div></div>`)}</div>`, { title: 'Achievements' })}
    ${card(dl([['Total bookings', String(a.totals.bookings)], ['Cancelled', String(a.totals.cancelled)], ['Event registrations', String(a.events)], ['Total spent', formatPHP(a.totals.spent)]]), { title: 'Booking & spending' })}
  </div></div>`;
}, { auth: true });

route('/app/favorites', 'player', 'Favorites', () => {
  const favs = app.api.read('GET /v1/me/favorites');
  const rows = app.api.read('GET /v1/public/venues', {}).rows.filter((r) => favs.some((f) => f?.id === r.venue.id));
  return html`${pageHeader('Favorite venues')}${rows.length ? html`<div class="venue-grid">${rows.map((r) => venueCard(r, '#/app/book'))}</div>` : empty('No favorites yet', 'Tap the heart on any venue to save it here.', btn('Discover courts', { href: '#/app/discover', variant: 'primary' }), 'heart')}`;
}, { auth: true });

route('/app/notifications', 'player', 'Notifications', () => {
  const list = app.api.read('GET /v1/me/notifications');
  const msgs = app.api.read('GET /v1/me/messages');
  const tab = app.state<string>('ntTab', 'inbox');
  return html`${pageHeader('Notifications', { actions: btn('Mark all read', { action: 'nt.readAll', variant: 'secondary', size: 'sm', icon: 'check' }) })}${tabs([{ key: 'inbox', label: 'In-app', count: list.filter((n) => !n.readAt).length }, { key: 'sent', label: 'Emails & SMS (demo outbox)', count: msgs.length }], tab, 'nt.tab')}
  ${tab === 'inbox' ? (list.length ? html`<div class="card"><ul class="list" style="padding:0 16px">${list.map((n) => html`<li class="row" style="align-items:flex-start;${n.readAt ? '' : 'font-weight:600'}"><span class="kpi-icon">${icon(n.category === 'payment_updates' ? 'wallet' : n.category === 'events' ? 'trophy' : n.category === 'account_security' ? 'shield' : 'bell', 16)}</span><div style="flex:1"><div>${n.title}</div><div class="small muted" style="font-weight:400">${n.body}</div><div class="xs muted" style="font-weight:400">${formatRelative(n.createdAt, app.store.now())} · email ${n.channels.email} · SMS ${n.channels.sms}</div></div>${n.link ? btn('Open', { href: n.link, variant: 'ghost', size: 'sm' }) : ''}</li>`)}</ul></div>` : empty('You are all caught up', undefined, undefined, 'bell')) : html`${alertBox('info', 'Demo outbox', 'These are the emails and SMS that would be sent through the email provider and PH SMS aggregator. Destinations are masked. SMS never contain links (telco rules).')}<div class="stack-sm" style="margin-top:12px">${msgs.map((m) => html`<div class="card"><div class="card-body"><div class="row-between"><span class="row">${icon(m.channel === 'sms' ? 'message' : m.channel === 'push' ? 'bell' : 'mail', 16)}<b class="small">${m.channel.toUpperCase()} → ${m.to}</b></span><span class="xs muted">${formatDateTime(m.createdAt)}</span></div>${m.subject ? html`<div style="margin-top:6px"><b>${m.subject}</b></div>` : ''}<div class="small">${m.body}</div></div></div>`)}</div>`}`;
}, { auth: true });
action('nt.tab', (el) => app.set('ntTab', el.dataset.key));
action('nt.readAll', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/me/notifications/read', {}, { silent: true }));
});

// ---------------------------------------------------------------- profile

route('/app/profile', 'player', 'Profile', (ctx) => {
  const me = ctx.me!;
  const p = me.profile!;
  const pub = p.username ? app.api.read('GET /v1/players/{username}', { username: p.username }) : null;
  const vis = (name: string, value: string, label: string) => select({ name, label, value, options: [{ value: 'private', label: 'Only me' }, { value: 'followers', label: 'My followers' }, { value: 'organizers', label: 'Venues & organizers I play with' }, { value: 'public', label: 'Everyone' }] });
  return html`${pageHeader('Profile', { actions: html`${btn('Settings', { href: '#/app/settings', variant: 'secondary', icon: 'settings' })}${btn('Sign out', { action: 'auth.logout', variant: 'ghost', icon: 'logout' })}` })}
  <div class="profile-hero card"><div class="card-body row" style="gap:16px;align-items:center;flex-wrap:wrap">${avatar(p.displayName, p.avatarHue, 64)}<div style="flex:1;min-width:200px"><h2 style="margin:0">${p.displayName}</h2><div class="muted small">${p.username ? `@${p.username}` : 'No username yet'}${p.city ? ` · ${p.city}` : ''}</div>${pub ? html`<div class="row small" style="margin-top:6px;gap:14px"><a href="#/app/players/${p.username}/followers"><b>${pub.counts.followers ?? 0}</b> followers</a><a href="#/app/players/${p.username}/following"><b>${pub.counts.following ?? 0}</b> following</a></div>` : ''}</div><div class="row">${p.username ? btn('View public profile', { href: `#/app/players/${p.username}`, variant: 'secondary', icon: 'eye' }) : ''}${btn('Find players', { href: '#/app/players', variant: 'ghost', icon: 'userPlus' })}</div></div></div>
  <div style="margin:16px 0">${mySportsSection()}</div>
  <div class="split"><div>${card(html`<form data-form="profile.save" class="form-grid">${field({ name: 'firstName', label: 'First name', value: p.firstName })}${field({ name: 'lastName', label: 'Last name', value: p.lastName })}${field({ name: 'displayName', label: 'Display name', value: p.displayName, hint: 'Shown to venues and other players.' })}${field({ name: 'city', label: 'Home city', value: p.city })}
  ${select({ name: 'skillSelf', label: 'Self-declared skill level', value: p.skillSelf ?? '', options: [{ value: '', label: 'Prefer not to say' }, ...['beginner', 'novice', 'intermediate', 'advanced', 'expert'].map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))], hint: 'Always labeled “self-declared”.' })}
  <div class="full">${textarea({ name: 'bio', label: 'About you', value: p.bio, maxlength: 300 })}</div>
  <div class="full"><h3>Who can see…</h3><p class="xs muted" style="margin:0">Your contact details, payments and check-in records are never shown to other players. Social controls (search, follows, blocks) are in Settings → Social.</p></div>${vis('v_profile', p.visibility.profile, 'My profile (bio, city)')}${vis('v_activity', p.visibility.activity, 'My sports & activity')}${vis('v_ratings', p.visibility.ratings, 'My skill levels')}
  <div class="full">${btn('Save profile', { type: 'submit', variant: 'primary' })}</div></form>`, { title: 'Your details' })}</div>
  <div class="stack">${card(dl([['Email', me.user.email ?? '—'], ['Mobile', me.user.phone ?? '—'], ['Member since', formatDateLong(me.user.createdAt)], ['Two-step verification', me.user.mfaEnabled ? 'On' : 'Off']]), { title: 'Account' })}
  ${card(html`<div class="stack-sm">${['open-play', 'players', 'orders', 'activity', 'favorites', 'payments', 'notifications'].map((k) => html`<a class="row-between" href="#/app/${k}" style="text-decoration:none;color:inherit;padding:6px 0"><span>${k === 'open-play' ? 'Open Play' : k[0]!.toUpperCase() + k.slice(1)}</span>${icon('chevronRight', 16)}</a>`)}</div>`, { title: 'More' })}</div></div>`;
}, { auth: true });
form('profile.save', async (fd) => {
  await app.api.write('PATCH /v1/me/profile', { firstName: str(fd, 'firstName'), lastName: str(fd, 'lastName'), displayName: str(fd, 'displayName'), city: str(fd, 'city'), bio: str(fd, 'bio'), skillSelf: (str(fd, 'skillSelf') || null) as never, visibility: { profile: str(fd, 'v_profile') as never, activity: str(fd, 'v_activity') as never, ratings: str(fd, 'v_ratings') as never } });
  app.toast('Profile saved', 'success');
});

// ---------------------------------------------------------------- payments

route('/app/payments', 'player', 'Payments', () => {
  const pays = app.api.read('GET /v1/me/payments');
  const refunds = app.api.read('GET /v1/me/refunds');
  const methods = [...new Set(pays.filter((p) => p.status !== 'failed').map((p) => p.methodDisplay))].slice(0, 4);
  return html`${pageHeader('Payments & refunds')}<div class="split"><div class="stack">${card(pays.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>For</th><th>Method</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>${pays.map((p) => html`<tr><td class="nowrap">${formatDateShort(p.createdAt)}</td><td>${p.summary}</td><td class="nowrap">${p.methodDisplay}</td><td class="num">${formatPHP(p.amount)}</td><td>${pill(p.status)}</td></tr>`)}</tbody></table></div>` : empty('No payments yet'), { title: 'Payment history', pad: pays.length ? false : true })}
  ${card(refunds.length ? html`${refunds.map((r) => html`<div class="row-between" style="padding:8px 0;border-bottom:1px solid var(--ck-slate-100)"><div><b>${formatPHP(r.amount)}</b><div class="small muted">${r.reason}</div><div class="xs muted">Requested ${formatDateShort(r.createdAt)}${r.completedAt ? ` · completed ${formatDateShort(r.completedAt)}` : ''}</div></div>${pill(r.status)}</div>`)}` : empty('No refunds'), { title: 'Refunds' })}</div>
  <div>${card(html`${methods.length ? methods.map((m) => html`<div class="row" style="padding:6px 0">${icon('card', 18)}<span>${m}</span></div>`) : html`<p class="muted small">None yet.</p>`}<p class="xs muted" style="margin-top:8px">Only provider tokens and masked details are kept (brand and last 4). Full card numbers, CVVs and e-wallet PINs never reach CourtKo.</p>`, { title: 'Payment methods used' })}</div></div>`;
}, { auth: true });

// ---------------------------------------------------------------- settings

route('/app/settings', 'player', 'Settings', (ctx) => {
  const me = ctx.me!;
  const prefs = me.preferences!;
  const sessions = app.api.read('GET /v1/me/sessions');
  const history = app.api.read('GET /v1/me/login-history');
  const tab = app.state<string>('setTab', 'notifications');
  const enroll = app.ui.enroll as { secret: string; otpauthUri: string } | undefined;
  const recovery = app.ui.recovery as string[] | undefined;
  const cats: [keyof typeof prefs.notifications, string, boolean][] = [['account_security', 'Account & security alerts', true], ['booking_updates', 'Booking confirmations & changes', true], ['payment_updates', 'Payments & refunds', true], ['reminders', 'Game reminders', false], ['events', 'Events, Open Play & invites', false], ['social', 'Followers & follow requests', false], ['orders', 'Order pickup updates', false], ['marketing', 'Promos & news', false]];
  return html`${pageHeader('Settings')}${tabs([{ key: 'notifications', label: 'Notifications' }, { key: 'social', label: 'Social' }, { key: 'security', label: 'Security' }, { key: 'privacy', label: 'Privacy & data' }], tab, 'set.tab')}
  ${tab === 'social' ? socialSettingsPanel() : ''}
  ${tab === 'notifications' ? card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Topic</th><th>In-app</th><th>Email</th><th>SMS</th><th>Push</th></tr></thead><tbody>${cats.map(([k, label, locked]) => html`<tr><td><b>${label}</b>${locked ? html`<div class="xs muted">Required for your bookings and account security</div>` : ''}</td>${(['inApp', 'email', 'sms', 'push'] as const).map((ch) => html`<td>${toggle({ label: '', checked: (prefs.notifications[k] ?? { inApp: true, email: false, sms: false, push: false })[ch], action: 'pref.toggle', data: { cat: k, ch, on: (prefs.notifications[k] ?? { inApp: true, email: false, sms: false, push: false })[ch] ? '0' : '1' }, disabled: locked && (ch === 'inApp' || ch === 'email') })}</td>`)}</tr>`)}</tbody></table></div>`, { title: 'What we send you' }) : ''}
  ${tab === 'security' ? html`<div class="split"><div class="stack">${card(html`${me.user.mfaEnabled ? alertBox('success', 'Two-step verification is on', 'You need a code from your authenticator app when you sign in.') : enroll ? html`<p>Scan this QR code with Google Authenticator, Microsoft Authenticator or 1Password, then enter the 6-digit code.</p><div class="row" style="gap:18px">${qrCode(enroll.otpauthUri, 170, 'Authenticator setup QR')}<div><p class="xs muted">Can't scan? Enter this key:</p><code>${enroll.secret}</code></div></div><form data-form="mfa.confirm" class="row" style="margin-top:12px;align-items:flex-end"><div style="flex:1">${field({ name: 'code', label: 'Code from the app', inputmode: 'numeric', maxlength: 6, required: true })}</div>${btn('Turn on', { type: 'submit', variant: 'primary' })}</form>` : html`<p class="muted">Add a second step at sign-in using an authenticator app (TOTP). Required for venue owners and platform staff.</p>${btn('Set up authenticator app', { action: 'mfa.start', variant: 'primary', icon: 'shield' })}`}${recovery ? alertBox('warning', 'Save your recovery codes', html`Each works once if you lose your phone. They won't be shown again.<div class="code-block" style="margin-top:8px">${recovery.join('\n')}</div>`) : ''}`, { title: 'Two-step verification' })}
  ${card(html`<form data-form="pw.change" class="stack-sm">${field({ name: 'currentPassword', label: 'Current password', type: 'password', autocomplete: 'current-password', required: true })}${field({ name: 'newPassword', label: 'New password', type: 'password', autocomplete: 'new-password', required: true, hint: 'At least 12 characters. Other devices will be signed out.' })}${btn('Change password', { type: 'submit', variant: 'secondary' })}</form>`, { title: 'Password' })}</div>
  <div class="stack">${card(html`${sessions.map((s) => html`<div class="row-between" style="padding:8px 0;border-bottom:1px solid var(--ck-slate-100)"><div><b class="small">${s.device}</b> ${s.current ? tag('This device', 'success') : ''}<div class="xs muted">${s.ip} · signed in ${formatDateTime(s.createdAt)} · ${s.mfaVerifiedAt ? 'MFA verified' : 'password only'}</div></div>${s.current ? '' : btn('Sign out', { action: 'sess.revoke', data: { id: s.id }, variant: 'ghost', size: 'sm' })}</div>`)}${btn('Sign out of all other devices', { action: 'sess.revokeAll', variant: 'secondary', size: 'sm', icon: 'logout' })}`, { title: 'Active sessions' })}
  ${card(html`${history.map((h) => html`<div class="row-between small" style="padding:5px 0"><span>${formatDateTime(h.at)} · ${h.device}</span>${tag(h.outcome.replace('_', ' '), h.outcome.includes('fail') || h.outcome === 'locked' ? 'danger' : 'success')}</div>`)}`, { title: 'Recent sign-ins' })}</div></div>` : ''}
  ${tab === 'privacy' ? html`<div class="split"><div class="stack">${card(html`<p class="small">Location is used only while you search, rounded to ~100 m, and never stored. Current preference: <b>${prefs.locationConsent}</b>. To revoke, use your browser's site settings — CourtKo will fall back to manual search.</p>${toggle({ label: 'Analytics cookies', checked: !!prefs.cookieAnalytics, action: 'cookie.toggle', data: { on: prefs.cookieAnalytics ? '0' : '1' }, hint: 'Essential cookies are always on; analytics only with your consent.' })}${toggle({ label: 'Marketing messages', checked: prefs.marketingOptIn, action: 'pref.toggle', data: { cat: 'marketing', ch: 'email', on: prefs.marketingOptIn ? '0' : '1' } })}`, { title: 'Consent & preferences' })}
  ${card(html`<p class="small">Download a copy of your personal data (profile, bookings, payments, notifications, login history) as JSON.</p>${btn('Download my data', { action: 'privacy.export', variant: 'secondary', icon: 'download' })}`, { title: 'Data export' })}</div>
  <div>${card(me.user.deletion?.status === 'scheduled' ? html`${alertBox('warning', `Deletion scheduled for ${formatDateLong(me.user.deletion.scheduledFor)}`, 'Changed your mind? You can cancel until then.')}${btn('Cancel deletion', { action: 'privacy.cancelDelete', variant: 'secondary' })}` : html`<p class="small">We'll delete your account after a 14-day grace period. Your name and contact details are removed; financial records are kept (anonymized) for the period tax law requires.</p>${btn('Request account deletion', { action: 'privacy.delete', variant: 'danger' })}`, { title: 'Delete account' })}</div></div>` : ''}`;
}, { auth: true });

action('set.tab', (el) => app.set('setTab', el.dataset.key));
action('pref.toggle', async (el) => {
  await app.run(el, () => app.api.write('PUT /v1/me/preferences/notifications', { category: el.dataset.cat as never, channel: el.dataset.ch as never, enabled: el.dataset.on === '1' }, { silent: true }));
});
action('cookie.toggle', async (el) => {
  await app.run(el, () => app.api.write('PUT /v1/me/preferences/cookies', { analytics: el.dataset.on === '1' }, { silent: true }));
});
action('mfa.start', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /v1/me/mfa/totp', undefined as never));
  if (r) app.set('enroll', r);
});
form('mfa.confirm', async (fd) => {
  const r = await app.api.write('POST /v1/me/mfa/totp/confirm', { code: str(fd, 'code') });
  app.ui.enroll = undefined;
  app.set('recovery', r.recoveryCodes);
  app.toast('Two-step verification is on', 'success');
});
form('pw.change', async (fd, f) => {
  await app.api.write('POST /v1/me/password', { currentPassword: String(fd.get('currentPassword') ?? ''), newPassword: String(fd.get('newPassword') ?? '') });
  f.reset();
  app.toast('Password changed. Other devices were signed out.', 'success');
});
action('sess.revoke', async (el) => {
  await app.run(el, () => app.api.write('DELETE /v1/me/sessions/{sessionId}', { sessionId: el.dataset.id! }), { success: 'Session signed out' });
});
action('sess.revokeAll', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /v1/me/sessions/revoke-all', { keepCurrent: true }));
  if (r) app.toast(`Signed out of ${r.revoked} other session(s).`, 'success');
});
action('privacy.export', async (el) => {
  const data = await app.run(el, () => app.api.write('POST /v1/me/privacy/data-exports', undefined as never));
  if (data) download(`courtko-my-data-${localDate(app.store.now())}.json`, JSON.stringify(data, null, 2), 'application/json');
});
action('privacy.delete', async (el) => {
  const ok = await app.confirm({ title: 'Delete your account?', body: 'Your account will be deleted after 14 days. You can cancel before then.', confirmLabel: 'Schedule deletion', danger: true });
  if (ok) await app.run(el, () => app.api.write('POST /v1/me/privacy/deletion-requests', undefined as never), { success: 'Deletion scheduled.' });
});
action('privacy.cancelDelete', async (el) => {
  await app.run(el, () => app.api.write('DELETE /v1/me/privacy/deletion-requests', undefined as never), { success: 'Deletion cancelled.' });
});

export function venueThumb(art: Parameters<typeof venueCover>[0]): SafeHtml {
  return html`<div style="width:64px;border-radius:10px;overflow:hidden;aspect-ratio:4/3;flex:none">${venueCover(art)}</div>`;
}
