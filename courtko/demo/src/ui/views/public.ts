/** Public website: home, find a court, venue details, events, how it works, for business, pricing, help, legal. */

import { applyRate, formatPHP, formatPpm, grossUpFee, parsePesoInput, pesos } from '../../domain/money.ts';
import { formatDateLong, formatTimeRange } from '../../domain/time.ts';
import { FEE_SCHEDULES } from '../../services/seed.ts';
import { action, app, form, onChange, route, str, type ViewCtx } from '../app.ts';
import { venueCover, productTile, avatar } from '../art.ts';
import { alertBox, btn, card, dl, empty, field, pageHeader, priceBreakdown, select, stars, tag } from '../components.ts';
import { html, type SafeHtml } from '../html.ts';
import { icon } from '../icons.ts';
import { availabilityPanel } from './booking.ts';
import { currentLocation, eventCard, locationBar, mapView, venueCard, ENV_LABEL } from './shared.ts';

// ---------------------------------------------------------------- home

route('/', 'public', 'Book pickleball courts in the Philippines', () => {
  const featured = app.api.read('GET /v1/public/venues', { sort: 'recommended' }).rows.slice(0, 6);
  const events = app.api.read('GET /v1/public/events', {}).slice(0, 3);
  const venuesCount = app.api.read('GET /v1/public/venues', {}).rows.length;
  return html`<section class="hero"><div class="hero-inner">
    <div>
      <p class="eyebrow" style="color:var(--ck-color-accent)">Pickleball, sa isang tap</p>
      <h1>Find a court. <em>Book it in seconds.</em> Just play.</h1>
      <p class="lead">Real-time availability at pickleball venues across the Philippines — transparent prices, GCash, Maya and cards, and instant confirmation with a QR check-in.</p>
      <form class="search-card" data-form="home.search" role="search" aria-label="Find a court">
        ${field({ name: 'q', label: 'City, barangay or venue', placeholder: 'e.g. Makati, BGC, Cebu', autocomplete: 'off' })}
        ${field({ name: 'date', label: 'Date', type: 'date', value: todayStr() })}
        ${btn('Search courts', { type: 'submit', variant: 'primary', icon: 'search', size: 'lg' })}
      </form>
      <div class="hero-stats"><div><b>${venuesCount}</b><span>venues live</span></div><div><b>6</b><span>payment options</span></div><div><b>0</b><span>hidden charges</span></div></div>
    </div>
    <div class="hero-art"><div class="phone-mock"><div class="screen">${heroPhone()}</div></div></div>
  </div></section>
  <section class="section"><div class="container">
    <div class="row-between"><div><p class="eyebrow">Popular right now</p><h2>Courts players love</h2></div>${btn('See all courts', { href: '#/courts', variant: 'secondary', icon: 'chevronRight' })}</div>
    <div class="venue-grid" style="margin-top:16px">${featured.map((r) => venueCard(r))}</div>
  </div></section>
  <section class="section" style="background:#fff;border-block:1px solid var(--ck-slate-200)"><div class="container">
    <p class="eyebrow">How it works</p><h2>From search to serve in three steps</h2>
    <div class="steps3" style="margin-top:18px">
      <div class="card"><h3>Pick a venue & time</h3><p class="muted">Search near you or by city. See every court's open slots and the exact price for your time.</p></div>
      <div class="card"><h3>Pay securely</h3><p class="muted">Your slot is held for 10 minutes while you pay with GCash, Maya, cards, QR Ph or online banking. Fees are shown before you pay.</p></div>
      <div class="card"><h3>Show your QR & play</h3><p class="muted">Booking is confirmed only after the payment provider verifies it. Check in with your QR code at the front desk.</p></div>
    </div>
  </div></section>
  <section class="section"><div class="container">
    <div class="row-between"><div><p class="eyebrow">Events & open play</p><h2>Join the community</h2></div>${btn('All events', { href: '#/events', variant: 'secondary', icon: 'chevronRight' })}</div>
    <div class="grid g3" style="margin-top:16px">${events.map((e) => eventCard(e))}</div>
  </div></section>
  <section class="section-sm"><div class="container"><div class="band">
    <div><p class="eyebrow" style="color:var(--ck-color-accent)">For venue owners</p><h2 style="color:#fff">Fill your courts. Get paid automatically.</h2><p>No subscription — CourtKo earns a small commission only on successful bookings. Calendar, walk-ins, pricing rules, events, pro-shop pickup and payouts in one place.</p><div class="row">${btn('List your venue', { href: '#/for-business', variant: 'accent', icon: 'building' })}${btn('See the commission', { href: '#/pricing', variant: 'ghost' })}</div></div>
    <div class="card" style="color:var(--ck-color-ink)"><div class="card-body">${exampleBreakdown()}</div></div>
  </div></div></section>
  <section class="section"><div class="container grid g3">
    ${trust('shield', 'Payments you can trust', 'We never see or store card numbers, CVVs or e-wallet PINs. Payments are processed by a licensed provider and confirmed server-side.')}
    ${trust('receipt', 'No hidden charges', 'Court price, add-ons, discounts, VAT and payment fees are itemized before you pay. What you see is what you pay.')}
    ${trust('refresh', 'Fair, clear refunds', "Every venue's cancellation policy is shown before checkout and saved with your booking, so the rules can't change later.")}
  </div></section>`;
});

function trust(ic: string, title: string, body: string): SafeHtml {
  return html`<div class="card feature"><span class="ic-wrap">${icon(ic, 22)}</span><h3>${title}</h3><p class="muted">${body}</p></div>`;
}

function heroPhone(): SafeHtml {
  return html`<div style="padding:14px 12px 16px"><div class="row-between" style="margin-bottom:10px"><b>Dink District BGC</b>${tag('Open now', 'success')}</div>
  <div style="border-radius:14px;overflow:hidden;aspect-ratio:16/9">${venueCover({ hue: 158, accent: 298, pattern: 'lines' })}</div>
  <p class="small muted" style="margin:10px 0 6px">Tonight · pick a time</p>
  <div class="chips">${['6:00 PM', '7:00 PM', '8:30 PM', '9:00 PM'].map((t, i) => html`<span class="chip${i === 1 ? ' active' : ''}">${t}</span>`)}</div>
  <div class="card" style="margin-top:12px;padding:12px"><div class="row-between small"><span>Court 2 · 1 hr</span><b>₱600.00</b></div><div class="row-between small muted"><span>GCash processing fee</span><span>₱14.12</span></div><hr style="margin:8px 0"/><div class="row-between"><b>Total</b><b>₱614.12</b></div></div>
  <div class="btn btn-primary btn-block" style="margin-top:12px">Pay with GCash</div></div>`;
}

export function exampleBreakdown(): SafeHtml {
  return html`<p class="eyebrow">Worked example</p><h3>A ₱400 court booking</h3>${priceBreakdown([{ label: 'Court booking (1 hr)', amount: pesos(400), kind: 'court' }, { label: 'Payment processing fee', detail: 'Online banking · passed to the player where permitted', amount: pesos(15), kind: 'fee' }], pesos(415), { totalLabel: 'Player pays' })}
  ${dl([['CourtKo commission (5% of ₱400)', html`<span class="money">${formatPHP(pesos(20))}</span>`], ['Venue receives', html`<b class="money">${formatPHP(pesos(380))}</b>`], ['Paid to the payment provider', formatPHP(pesos(15))]])}
  <p class="xs muted" style="margin-top:8px">Rates and fee pass-through are configurable per payment method and subject to the provider agreement and Philippine regulations.</p>`;
}

function todayStr(): string {
  return new Date(app.store.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

form('home.search', (fd) => {
  const q = str(fd, 'q');
  const date = str(fd, 'date');
  app.navigate(`#/courts?q=${encodeURIComponent(q)}&date=${encodeURIComponent(date)}`);
});

// ---------------------------------------------------------------- find a court

export function discoverView(ctx: ViewCtx, inApp: boolean): SafeHtml {
  const q = ctx.query.get('q') ?? '';
  const f = app.state('discover', { environment: '', amenity: '', minRating: 0, maxPrice: 0, hasEvents: false, sort: '', view: 'list' as 'list' | 'map' });
  const loc = currentLocation();
  const res = app.api.read('GET /v1/public/venues', {
    q,
    near: loc,
    environment: f.environment as never,
    amenities: f.amenity ? [f.amenity] : [],
    minRating: f.minRating,
    maxPrice: f.maxPrice || undefined as never,
    hasEvents: f.hasEvents,
    sort: (f.sort || (loc ? 'distance' : 'recommended')) as never,
  });
  const suggestions = q.length >= 2 ? app.api.read('GET /v1/public/locations', { q }) : [];
  const base = inApp ? '#/app/book' : '#/venues';
  const amenities = app.store.state.settings.platform!.amenities;
  return html`${pageHeader(inApp ? 'Discover courts' : 'Find a pickleball court', { subtitle: `${res.rows.length} venue${res.rows.length === 1 ? '' : 's'}${q ? ` matching “${q}”` : ' across the Philippines'}` })}
  <div class="card" style="margin-bottom:16px"><div class="card-body stack-sm">
    <form class="row" data-form="discover.search" role="search"><div style="flex:1;min-width:220px"><label class="sr-only" for="dq">Search</label><input id="dq" name="q" type="search" value="${q}" placeholder="City, municipality, barangay, landmark or venue" autocomplete="off"/></div>${btn('Search', { type: 'submit', variant: 'primary', icon: 'search' })}</form>
    ${suggestions.length ? html`<div class="chips">${suggestions.map((s) => html`<a class="chip" href="#${ctx.path}?q=${encodeURIComponent(s.query)}">${icon('pin', 14)} ${s.label} <span class="muted xs">${s.kind}</span></a>`)}</div>` : ''}
    ${locationBar()}
    <div class="filters">
      <select aria-label="Court type" data-change="discover.filter" data-key="environment">${[['', 'Any court type'], ['indoor', 'Indoor'], ['covered', 'Covered'], ['outdoor', 'Outdoor']].map(([v, l]) => html`<option value="${v}"${v === f.environment ? html` selected` : ''}>${l}</option>`)}</select>
      <select aria-label="Amenity" data-change="discover.filter" data-key="amenity"><option value="">Any amenities</option>${amenities.map((a) => html`<option value="${a.code}"${a.code === f.amenity ? html` selected` : ''}>${a.label}</option>`)}</select>
      <select aria-label="Rating" data-change="discover.filter" data-key="minRating">${[[0, 'Any rating'], [4, '4★ & up'], [4.5, '4.5★ & up']].map(([v, l]) => html`<option value="${v}"${Number(v) === f.minRating ? html` selected` : ''}>${l}</option>`)}</select>
      <select aria-label="Max price" data-change="discover.filter" data-key="maxPrice">${[[0, 'Any price'], [30000, 'Up to ₱300/hr'], [40000, 'Up to ₱400/hr'], [50000, 'Up to ₱500/hr']].map(([v, l]) => html`<option value="${v}"${Number(v) === f.maxPrice ? html` selected` : ''}>${l}</option>`)}</select>
      <select aria-label="Sort" data-change="discover.filter" data-key="sort">${[['', loc ? 'Nearest first' : 'Recommended'], ['next', 'Soonest available'], ['price', 'Lowest price'], ['rating', 'Top rated'], ...(loc ? [['distance', 'Distance']] : [])].map(([v, l]) => html`<option value="${v}"${v === f.sort ? html` selected` : ''}>${l}</option>`)}</select>
      <button class="chip${f.hasEvents ? ' active' : ''}" data-action="discover.events">${icon('trophy', 14)} Has events</button>
      <div class="seg" style="margin-left:auto" role="group" aria-label="View"><button class="${f.view === 'list' ? 'active' : ''}" data-action="discover.view" data-v="list">${icon('list', 14)} List</button><button class="${f.view === 'map' ? 'active' : ''}" data-action="discover.view" data-v="map">${icon('map', 14)} Map</button></div>
    </div>
  </div></div>
  ${res.rows.length === 0 ? empty('No venues match these filters', 'Try another city or clear a filter.', btn('Clear filters', { action: 'discover.clear', variant: 'secondary' }), 'search') : f.view === 'map' ? html`<div class="split"><div>${mapView(res.rows, { user: loc, base })}</div><ol class="list card" style="padding:0 16px">${res.rows.map((r, i) => html`<li><a href="${base}/${r.venue.slug}" class="row" style="text-decoration:none;color:inherit"><span class="pill pill-success">${i + 1}</span><span style="flex:1"><b>${r.venue.name}</b><br/><span class="small muted">${r.venue.address.city}${r.distanceKm !== null ? ` · ${r.distanceKm.toFixed(1)} km` : ''}</span></span>${r.fromRate ? html`<span class="small">from <b>${formatPHP(r.fromRate, { compact: true })}</b></span>` : ''}</a></li>`)}</ol></div>` : html`<div class="venue-grid">${res.rows.map((r) => venueCard(r, base))}</div>`}`;
}

route('/courts', 'public', 'Find a court', (ctx) => html`<div class="container section-sm">${discoverView(ctx, false)}</div>`);

form('discover.search', (fd) => {
  const path = location.hash.replace(/^#/, '').split('?')[0];
  app.navigate(`#${path}?q=${encodeURIComponent(str(fd, 'q'))}`);
});
onChange('discover.filter', (el) => {
  const f = app.state<Record<string, unknown>>('discover', {});
  const key = el.dataset.key!;
  const v = (el as HTMLSelectElement).value;
  f[key] = key === 'minRating' || key === 'maxPrice' ? Number(v) : v;
  app.render();
});
action('discover.view', (el) => {
  app.state<Record<string, unknown>>('discover', {}).view = el.dataset.v;
  app.render();
});
action('discover.events', () => {
  const f = app.state<Record<string, unknown>>('discover', {});
  f.hasEvents = !f.hasEvents;
  app.render();
});
action('discover.clear', () => {
  delete app.ui.discover;
  app.navigate(location.hash.split('?')[0]!);
});

// ---------------------------------------------------------------- venue details

export function venueDetailView(ctx: ViewCtx, inApp: boolean): SafeHtml {
  const d = app.api.read('GET /v1/public/venues/{slug}', { slug: ctx.params.slug! });
  const v = d.venue;
  const loc = currentLocation();
  const dist = loc ? Math.round(Math.hypot((v.geo.lat - loc.lat) * 111, (v.geo.lng - loc.lng) * 108) * 10) / 10 : null;
  const tab = app.state<string>(`vtab:${v.id}`, 'book');
  return html`
  ${d.preview ? alertBox('warning', 'Preview — this venue is not published yet', 'Only your team can see this page.') : ''}
  <div class="venue-hero">${venueCover(v.art, { label: v.name })}<div class="overlay"><div class="row" style="gap:6px;margin-bottom:6px">${d.courts.map((c) => c.environment).filter((e, i, a) => a.indexOf(e) === i).map((e) => tag(ENV_LABEL[e]!, 'accent'))}</div><h1>${v.name}</h1><p>${v.tagline}</p></div>
  ${ctx.me ? html`<button class="${d.favorite ? 'fav-btn on' : 'fav-btn'}" data-action="fav.toggle" data-venue="${v.id}" aria-label="${d.favorite ? 'Remove from favorites' : 'Save to favorites'}">${icon('heart', 18)}</button>` : ''}</div>
  <div class="row" style="margin:14px 0 18px">${stars(v.ratingAvg, v.ratingCount)}<span class="small">${icon('pin', 14)} ${v.address.line1}, ${v.address.barangay}, ${v.address.city}${dist !== null ? ` · ~${dist} km away` : ''}</span>${d.fromRate ? html`<span class="small">from <b>${formatPHP(d.fromRate, { compact: true })}</b>/hr</span>` : ''}${btn('Directions', { href: `https://www.google.com/maps/search/?api=1&query=${v.geo.lat},${v.geo.lng}`, variant: 'ghost', size: 'sm', icon: 'external' })}</div>
  <div class="tabs" role="tablist">${[['book', 'Book a court'], ['about', 'About & rules'], ['rates', 'Rates'], ['events', `Events (${d.events.length})`], ['shop', 'Shop'], ['reviews', `Reviews (${v.ratingCount})`]].map(([k, l]) => html`<button class="tab${tab === k ? ' active' : ''}" role="tab" aria-selected="${tab === k ? 'true' : 'false'}" data-action="vtab" data-venue="${v.id}" data-key="${k}">${l}</button>`)}</div>
  ${tab === 'book' ? availabilityPanel(ctx, v, inApp) : ''}
  ${tab === 'about' ? html`<div class="split"><div class="stack">${card(html`<p>${v.description}</p><h3>Amenities</h3><div class="amenities">${d.amenities.map((a) => html`<span class="amenity">${icon('check', 14)} ${a}</span>`)}</div>`, { title: 'About this venue' })}${card(html`<ul class="bullets">${v.rules.map((r) => html`<li>${r}</li>`)}</ul>`, { title: 'Venue rules' })}</div><div class="stack">${card(dl([['Parking', v.parking], ['Accessibility', v.accessibility], ['Operating hours', 'Daily 6:00 AM – 11:00 PM'], ['Contact', v.contactPhone], ['Operated by', d.business.tradeName]]), { title: 'Good to know' })}${card(html`<p class="small muted">Policy v${d.policy.version} · shown again before you pay and saved with your booking.</p><ul class="bullets small">${d.policy.lines.map((l) => html`<li>${l}</li>`)}</ul>`, { title: `${d.policy.name} cancellation policy` })}</div></div>` : ''}
  ${tab === 'rates' ? card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Rate</th><th>When</th><th>Courts</th><th class="num">Price</th></tr></thead><tbody>${d.rates.map((r) => html`<tr><td><b>${r.name}</b><br/><span class="xs muted">${r.kind}</span></td><td>${r.when}</td><td>${r.courts}</td><td class="num"><b>${r.price}</b></td></tr>`)}</tbody></table></div><p class="small muted" style="margin-top:10px">When rules overlap, the highest-priority rule applies; bookings that span two rates are priced per 15-minute slice. ${d.business.vatRegistered ? 'Prices include 12% VAT.' : 'This venue is not VAT-registered.'} Your exact total is shown before you pay.</p>`, { title: 'Court rates' }) : ''}
  ${tab === 'events' ? (d.events.length ? html`<div class="grid g2">${d.events.map((e) => eventCard(app.api.read('GET /v1/public/events/{eventId}', { eventId: e.id }), inApp ? '#/app/events' : '#/events'))}</div>` : empty('No upcoming events', 'Check back soon for open play and clinics.', undefined, 'trophy')) : ''}
  ${tab === 'shop' ? html`<p class="muted">Pre-order drinks, rentals and gear for pickup at the counter — or add them while booking a court.</p><div class="grid g3">${d.products.map((p) => html`<div class="card"><div class="card-body row" style="align-items:flex-start">${productTile(p.product.art, 56)}<div style="flex:1"><b>${p.product.name}</b><div class="small muted">${p.product.pickupInstructions}</div><div class="row-between" style="margin-top:8px"><b>${formatPHP(p.product.price)}</b><span class="xs ${p.available > 5 ? 'muted' : ''}">${p.available > 0 ? `${p.available} in stock` : 'Out of stock'}</span></div></div></div></div>`)}</div>${d.products.some((p) => p.product.fulfillment.standalone) ? html`<div style="margin-top:14px">${btn('Order for pickup', { href: `#/app/shop/${v.id}`, variant: 'primary', icon: 'bag' })}</div>` : ''}` : ''}
  ${tab === 'reviews' ? (d.reviews.length ? html`<div class="grid g2">${d.reviews.map(({ review: r, author }) => html`<div class="card"><div class="card-body"><div class="row-between"><div class="row">${avatar(author, (author.charCodeAt(0) * 7) % 360, 32)}<b>${author}</b></div>${stars(r.rating)}</div><p style="margin-top:10px">${r.body}</p><p class="xs muted">${formatDateLong(r.createdAt)} · verified booking</p>${r.reply ? html`<div class="alert alert-info small"><div class="alert-body"><b>Reply from the venue</b><div>${r.reply.body}</div></div></div>` : ''}${ctx.me ? btn('Report', { action: 'review.report', data: { review: r.id }, variant: 'link', size: 'sm', icon: 'flag' }) : ''}</div></div>`)}</div><p class="small muted" style="margin-top:12px">Only players with a completed booking can review, so every review comes from a real visit.</p>` : empty('No reviews yet', 'Reviews come only from verified, completed bookings.', undefined, 'star')) : ''}`;
}

route('/venues/:slug', 'public', 'Venue', (ctx) => html`<div class="container section-sm">${btn('All courts', { href: '#/courts', variant: 'ghost', size: 'sm', icon: 'chevronLeft' })}<div style="margin-top:8px">${venueDetailView(ctx, false)}</div></div>`);

action('vtab', (el) => app.set(`vtab:${el.dataset.venue}`, el.dataset.key));
action('review.report', async (el) => {
  const ok = await app.confirm({ title: 'Report this review?', body: 'Our Trust & Safety team will review it. The author is not told who reported it.', confirmLabel: 'Report review' });
  if (!ok) return;
  await app.run(el, () => app.api.write('POST /v1/me/reports', { targetType: 'review', targetId: el.dataset.review!, reason: 'Inaccurate or inappropriate' }), { success: 'Thanks — the review was sent for moderation.' });
});

// ---------------------------------------------------------------- events

export function eventsView(ctx: ViewCtx, base: string): SafeHtml {
  const type = app.state<string>('evType', '');
  const list = app.api.read('GET /v1/public/events', { type: type as never });
  const types = app.store.state.settings.platform!.eventTypes.filter((t) => t.code !== 'private');
  void ctx;
  return html`${pageHeader('Events, clinics & open play', { subtitle: 'Tournaments, leagues, clinics and social play at CourtKo venues.' })}
  <div class="chips" style="margin-bottom:16px"><button class="chip${!type ? ' active' : ''}" data-action="ev.type" data-t="">All</button>${types.map((t) => html`<button class="chip${type === t.code ? ' active' : ''}" data-action="ev.type" data-t="${t.code}">${t.label}</button>`)}</div>
  ${list.length ? html`<div class="grid g2">${list.map((e) => eventCard(e, base))}</div>` : empty('No events of this type yet', 'Try another category.', undefined, 'trophy')}`;
}
route('/events', 'public', 'Events', (ctx) => html`<div class="container section-sm">${eventsView(ctx, '#/events')}</div>`);
action('ev.type', (el) => app.set('evType', el.dataset.t ?? ''));

export function eventDetailView(ctx: ViewCtx, inApp: boolean): SafeHtml {
  const e = app.api.read('GET /v1/public/events/{eventId}', { eventId: ctx.params.id! });
  const ev = e.event;
  const mine = e.mine.filter((r) => r.status !== 'withdrawn');
  return html`${pageHeader(ev.name, { eyebrow: ev.type.replace('_', ' '), subtitle: html`${e.venue.name} · ${formatDateLong(ev.startMs)} · ${formatTimeRange(ev.startMs, ev.endMs)}`, back: inApp ? '#/app/events' : '#/events' })}
  <div class="split"><div class="stack">
    ${card(html`<p>${ev.description}</p>${dl([['Organizer', ev.organizer], ['Format', ev.format || '—'], ['Prizes', ev.prizes || '—'], ['Registration closes', formatDateLong(ev.registrationClosesAt)], ['Eligibility', ev.ageNote]])}`, { title: 'About' })}
    ${card(html`<p class="small">${ev.rules}</p>`, { title: 'Rules' })}
  </div><div class="stack">
    ${card(html`<div class="stack-sm">${e.divisions.map((d) => {
      const full = d.taken >= d.division.capacity;
      const mineHere = mine.find((r) => r.divisionId === d.division.id);
      return html`<div class="card" style="padding:12px"><div class="row-between"><div><b>${d.division.name}</b><div class="xs muted">${d.division.skill} · ${d.division.format.replace('_', ' ')}</div></div><b>${formatPHP(d.fee)}</b></div>
      <div class="bar-inline" style="margin:10px 0 6px"><span style="width:${Math.min(100, (d.taken / d.division.capacity) * 100)}%"></span></div><div class="row-between xs muted"><span>${d.taken}/${d.division.capacity} registered</span>${d.waitlist ? html`<span>${d.waitlist} on waitlist</span>` : ''}</div>
      <div style="margin-top:10px">${mineHere ? html`${tag(`You: ${mineHere.status.replace(/_/g, ' ')}`, 'success')}` : !e.registrationOpen ? tag('Registration closed') : full ? (ev.waitlistEnabled ? btn('Join waitlist', { action: 'ev.waitlist', data: { event: ev.id, division: d.division.id }, variant: 'secondary', block: true }) : tag('Full', 'warning')) : btn(ev.teamBased ? 'Register a team' : 'Register', { action: 'ev.register', data: { event: ev.id, division: d.division.id, team: ev.teamBased ? '1' : '' }, variant: 'primary', block: true })}</div></div>`;
    })}</div><p class="xs muted" style="margin-top:10px">Your spot is held for 10 minutes while you pay, so it can't be taken mid-checkout. ${ev.waitlistEnabled ? 'If a spot opens, the next player on the waitlist gets 2 hours to claim it.' : ''}</p>`, { title: 'Divisions' })}
  </div></div>`;
}
route('/events/:id', 'public', 'Event', (ctx) => html`<div class="container section-sm">${eventDetailView(ctx, false)}</div>`);

action('ev.register', async (el) => {
  if (!app.me()) return app.navigate(`#/login?next=${encodeURIComponent(location.hash.slice(1))}`);
  let partnerName: string | undefined;
  if (el.dataset.team) {
    partnerName = window.prompt('Partner’s name for this doubles division:')?.trim();
    if (!partnerName) return;
  }
  const r = await app.run(el, () => app.api.write('POST /v1/me/events/{eventId}/registrations', { eventId: el.dataset.event!, divisionId: el.dataset.division!, ...(partnerName ? { partnerName } : {}) }, { idempotencyKey: app.idem() }));
  if (r) app.navigate(`#/app/checkout/${r.checkoutId}`);
});
action('ev.waitlist', async (el) => {
  if (!app.me()) return app.navigate(`#/login?next=${encodeURIComponent(location.hash.slice(1))}`);
  const r = await app.run(el, () => app.api.write('POST /v1/me/events/{eventId}/waitlist', { eventId: el.dataset.event!, divisionId: el.dataset.division! }));
  if (r) app.toast(`You're #${r.position} on the waitlist. We'll notify you if a spot opens.`, 'success');
});

// ---------------------------------------------------------------- static pages

route('/how-it-works', 'public', 'How it works', () => html`<div class="container-narrow section-sm prose">${pageHeader('How CourtKo works')}
  <h2>For players</h2><ol><li><b>Search</b> by city, barangay or venue — or allow location to sort by distance (optional, never stored).</li><li><b>Pick a court and time</b> on the live availability grid. You'll see the exact price for your slot, including peak or weekend rates.</li><li><b>Hold & pay.</b> We hold the court for 10 minutes while you pay with GCash, Maya, GrabPay, cards, QR Ph or online banking. The full breakdown — court, add-ons, discounts, VAT and processing fee — is shown before you pay.</li><li><b>Confirmation.</b> Your booking is confirmed only when the payment provider verifies the payment on our servers (not just when your browser comes back). You get a receipt and a QR code.</li><li><b>Check in & play.</b> Show your QR code or booking code (e.g. <code>CK-7F3K9Q</code>) at the front desk.</li></ol>
  <h2>If plans change</h2><p>Each venue's cancellation policy is shown before you pay and saved with your booking. Refunds go back to your original payment method. If the venue cancels, you always get a full refund, including fees.</p>
  <h2>For venues</h2><p>Venues manage courts, hours, pricing rules, events and pickup orders; staff get only the permissions they need. Payouts are settled through the payment provider's sub-account for the venue. See <a href="#/for-business">For venue owners</a>.</p></div>`);

route('/for-business', 'public', 'For venue owners', () => html`<div class="container section-sm">${pageHeader('Grow your pickleball business with CourtKo', { subtitle: 'No subscription. A small commission only when a booking is paid.', actions: btn('Register your business', { href: '#/biz/onboarding', variant: 'primary', icon: 'building' }) })}
  <div class="features">${[['calendar', 'Live calendar', 'Every court, booking, hold, event and maintenance block in one day view. Check players in with a QR scan.'], ['tag', 'Flexible pricing', 'Standard, peak, weekend, holiday and promotional rules with priorities and a price simulator. Past bookings keep their price.'], ['users', 'Staff roles', 'Receptionist, Court Manager, Finance Viewer and more — or build custom roles. Staff only see what they need.'], ['trophy', 'Events & open play', 'Capacity-safe registration, waitlists that fill themselves, and results that feed player stats.'], ['bag', 'Pro shop & pickup', 'Sell drinks, rentals and gear as booking add-ons or pickup orders with single-use claim codes.'], ['wallet', 'Automatic settlement', 'Your share settles to your own payment sub-account. Statements show every fee and commission line.']].map(([i, t, d]) => html`<div class="card feature"><span class="ic-wrap">${icon(i!, 22)}</span><h3>${t}</h3><p class="muted">${d}</p></div>`)}</div>
  <div class="section-sm"><div class="split"><div class="card"><div class="card-body prose"><h2 style="margin-top:0">Getting started</h2><ol><li>Create a CourtKo account and register your business.</li><li>Upload your DTI/SEC registration, BIR Form 2303, Mayor's permit and the owner's valid ID. We review within 1–2 business days.</li><li>Add your venue, courts, hours and rates, then publish.</li><li>Connect your payout account (via the payment provider's secure onboarding).</li></ol><p class="small muted">Verification helps keep the marketplace safe and supports e-commerce rules for online merchants.</p></div></div><div class="card"><div class="card-body">${exampleBreakdown()}</div></div></div></div></div>`);

route('/pricing', 'public', 'Pricing & commission', () => {
  const calc = app.state('calc', { price: 40000, method: 'online_banking' });
  const f = FEE_SCHEDULES.find((x) => x.method === calc.method)!;
  const pass = f.passThrough && !f.passThroughLockedReason;
  const fee = pass ? grossUpFee(calc.price, f.percentPpm, f.fixed) : 0;
  const providerFee = applyRate(calc.price + fee, f.percentPpm) + f.fixed;
  const commission = applyRate(calc.price, 50_000);
  return html`<div class="container section-sm">${pageHeader('Simple, transparent pricing', { subtitle: 'For players: the price you see is the price you pay. For venues: no subscription — a commission on successful bookings.' })}
  <div class="split"><div class="stack">${card(html`<p>CourtKo earns a <b>configurable commission</b> (currently <b>5%</b> by default) on the court booking amount after any venue-funded discount and before payment fees. Businesses may have a different rate under an approved commercial agreement. The rate that applied is saved on each booking.</p>
  <h3>Payment processing fees</h3><p class="small">Fees depend on the payment method and the provider contract. Where the provider agreement and Philippine rules allow, the fee is shown as a separate line and paid by the player; otherwise CourtKo absorbs it. <b>QR Ph</b> payments never carry a customer fee, and <b>card</b> surcharging stays off until the acquirer and counsel confirm it.</p>
  <div class="table-wrap"><table class="table"><thead><tr><th>Method</th><th>Provider fee (sample)</th><th>Paid by</th></tr></thead><tbody>${FEE_SCHEDULES.map((x) => html`<tr><td>${x.label}</td><td>${x.percentPpm ? formatPpm(x.percentPpm) : ''}${x.percentPpm && x.fixed ? ' + ' : ''}${x.fixed ? formatPHP(x.fixed) : ''}</td><td>${x.passThrough && !x.passThroughLockedReason ? tag('Player (shown before paying)', 'info') : tag('CourtKo', 'success')}</td></tr>`)}</tbody></table></div>
  <p class="xs muted">Sample placeholder rates — the real rates come from the payment provider contract.</p>`, { title: 'How the commission works' })}</div>
  <div class="stack">${card(html`<form class="stack-sm" data-form="calc">${field({ name: 'price', label: 'Court price (₱)', value: (calc.price / 100).toFixed(2), inputmode: 'decimal' })}${select({ name: 'method', label: 'Payment method', value: calc.method, options: FEE_SCHEDULES.map((x) => ({ value: x.method, label: x.label })), change: 'calc.method' })}${btn('Calculate', { type: 'submit', variant: 'secondary' })}</form><hr/>
  ${priceBreakdown([{ label: 'Court booking', amount: calc.price, kind: 'court' }, { label: 'Payment processing fee', detail: pass ? f.label : `${f.label} · covered by CourtKo`, amount: fee, kind: 'fee' }], calc.price + fee, { totalLabel: 'Player pays' })}
  ${dl([['Commission (5%)', formatPHP(commission)], ['Venue receives', html`<b>${formatPHP(calc.price - commission)}</b>`], ['Provider fee (estimate)', formatPHP(providerFee)], ['CourtKo keeps', formatPHP(commission + fee - providerFee)]])}`, { title: 'Try the calculator' })}</div></div></div>`;
});
form('calc', (fd) => {
  const price = parsePesoInput(str(fd, 'price'));
  if (price === null || price <= 0) return app.toast('Enter a valid peso amount.', 'warning');
  app.set('calc', { price, method: str(fd, 'method') });
});
onChange('calc.method', (el) => {
  const c = app.state<{ price: number; method: string }>('calc', { price: 40000, method: 'online_banking' });
  c.method = (el as HTMLSelectElement).value;
  app.render();
});

route('/help', 'public', 'Help center', () => html`<div class="container-narrow section-sm">${pageHeader('Help center')}
  ${[['How do I cancel a booking?', 'Open Bookings, choose the booking and tap Cancel. You will see exactly how much will be refunded under the policy you accepted before confirming.'], ['When will I get my refund?', 'Refunds are sent to your original payment method as soon as the provider confirms them. Depending on your bank or e-wallet, it can take 1–7 banking days to appear.'], ['My payment went through but the booking says pending', 'We confirm bookings only after the payment provider verifies the payment. This usually takes a few seconds. If a confirmation message is delayed, our reconciliation checks the provider automatically and confirms it — you never need to pay twice.'], ["Why can't I book at a venue?", 'Some venues pause booking access for specific accounts. Check your notifications for details and how to appeal, or contact support.'], ['Is my card information safe?', 'Card details are entered on the payment provider’s secure page. CourtKo never sees or stores full card numbers, CVVs, OTPs or e-wallet PINs.'], ['How do I delete my account or download my data?', 'Go to Settings → Privacy. You can download a copy of your data at any time and request deletion (14-day grace period). Financial records are kept as required by law, without your contact details.']].map(([q, a]) => html`<details class="card" style="margin-bottom:10px"><summary style="padding:14px 16px;cursor:pointer;font-weight:650">${q}</summary><div style="padding:0 16px 16px" class="muted">${a}</div></details>`)}
  ${card(html`<p>Still need help? Contact CourtKo Support at <a href="mailto:support@courtko.example">support@courtko.example</a>. We reply within one business day.</p>`, { title: 'Contact support' })}</div>`);

route('/contact', 'public', 'Contact', () => html`<div class="container-narrow section-sm">${pageHeader('Contact & support')}${card(html`<form class="stack-sm" data-form="contact">${field({ name: 'name', label: 'Your name', required: true })}${field({ name: 'email', label: 'Email', type: 'email', required: true })}<div class="field"><label for="f-msg">Message</label><textarea id="f-msg" name="msg" rows="4" required></textarea></div>${btn('Send message', { type: 'submit', variant: 'primary' })}</form>`)}</div>`);
form('contact', () => app.toast('Thanks! (Demo) Your message would go to the support queue as ticket SUP-1051.', 'success'));

route('/terms', 'public', 'Terms of Service', () => html`<div class="container-narrow section-sm prose">${pageHeader('Terms of Service', { subtitle: 'Demo summary — the final terms require review by Philippine counsel.' })}<h2>1. The service</h2><p>CourtKo is an online marketplace connecting players with independent venues. Each venue is responsible for its courts, services and venue rules.</p><h2>2. Bookings & payments</h2><p>A booking is confirmed only after the payment provider verifies payment. Prices, fees and the venue's cancellation policy are shown before you pay and form part of your booking.</p><h2>3. Cancellations & refunds</h2><p>Refunds follow the policy version you accepted and are returned to the original payment method. Venue-initiated cancellations are refunded in full, including fees.</p><h2>4. Conduct</h2><p>Venues may pause booking access for accounts that breach venue rules; you'll be notified and can appeal.</p><h2>5. Reviews</h2><p>Reviews may only be posted after a completed booking and must be honest and respectful.</p></div>`);

route('/privacy', 'public', 'Privacy Notice', () => html`<div class="container-narrow section-sm prose">${pageHeader('Privacy Notice', { subtitle: 'Demo summary aligned with the Data Privacy Act of 2012 (RA 10173) — final text requires DPO and counsel review.' })}
  <h2>What we collect and why</h2><ul><li><b>Account:</b> name, email and/or mobile number — to create your account, verify it and send booking messages (contract).</li><li><b>Bookings & payments:</b> what you booked, amounts and masked payment details (e.g. “GCash •••• 0001”) — to provide the service and keep financial records required by law. We never receive full card numbers, CVVs, OTPs or PINs.</li><li><b>Activity:</b> sessions played and officially recorded results — to show your stats; you control who can see them.</li></ul>
  <h2>Location</h2><p>Location is <b>optional</b>. If you allow it, your browser shares your approximate position <b>only while you search</b>, rounded to about 100 meters, to sort venues by distance. We do not track you in the background and we do not store your precise location. You can always search by city, barangay or landmark instead, and you can revoke permission in your browser settings at any time.</p>
  <h2>Your rights</h2><p>You can access, correct, download and delete your data, object to processing, and withdraw consent for marketing — from Settings → Privacy or by contacting our Data Protection Officer at <a href="mailto:dpo@courtko.example">dpo@courtko.example</a>. You may also file a complaint with the National Privacy Commission.</p>
  <h2>Sharing</h2><p>We share booking details with the venue you booked, and payment data with our payment provider. Processors (cloud hosting, email, SMS) act under data processing agreements.</p><h2>Retention</h2><p>We keep financial records for the period required by tax law; other data is deleted or anonymized when no longer needed, or 14 days after you request account deletion.</p></div>`);

route('/404', 'public', 'Not found', () => html`<div class="state-panel">${icon('search', 36)}<h1>Page not found</h1><p class="muted">That page doesn't exist.</p>${btn('Go home', { href: '#/', variant: 'primary' })}</div>`);
