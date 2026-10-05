/** View helpers shared across experiences: venue cards, map, event cards, location permission flow. */

import { coarsen, formatDistance, type LatLng } from '../../domain/geo.ts';
import { formatPHP } from '../../domain/money.ts';
import { formatDateShort, formatTime, formatTimeRange, localDate } from '../../domain/time.ts';
import type { ReadResult } from '../../services/api.ts';
import { action, app } from '../app.ts';
import { venueCover } from '../art.ts';
import { btn, dataAttrs, pill, stars, tag } from '../components.ts';
import { escapeHtml, html, raw, type SafeHtml } from '../html.ts';
import { icon } from '../icons.ts';

export type SearchRow = ReadResult<'GET /v1/public/venues'>['rows'][number];
export type EventRow = ReadResult<'GET /v1/public/events'>[number];

export const ENV_LABEL: Record<string, string> = { indoor: 'Indoor', outdoor: 'Outdoor', covered: 'Covered' };
export const DEMO_LOCATION: LatLng = { lat: 14.5515, lng: 121.0475 }; // BGC, Taguig (demo)

// ---------------------------------------------------------------- sports (read from the SuperAdmin catalog — never hard-coded)

export type SportRow = ReadResult<'GET /v1/public/sports'>[number];

export function sportsCatalog(): SportRow[] {
  return app.api.read('GET /v1/public/sports');
}

export function sportName(code: string | null | undefined): string {
  return sportsCatalog().find((x) => x.code === code)?.name ?? (code ? code.replace(/^\w/, (c) => c.toUpperCase()) : 'Any sport');
}

export function sportIcon(code: string | null | undefined, size = 16): SafeHtml {
  const sp = sportsCatalog().find((x) => x.code === code);
  return icon(sp?.icon ?? 'ball', size);
}

export function sportTag(code: string, opts: { small?: boolean } = {}): SafeHtml {
  const sp = sportsCatalog().find((x) => x.code === code);
  return html`<span class="sport-tag${opts.small ? ' sm' : ''}" style="--sport-hue:${sp?.hue ?? 150}">${icon(sp?.icon ?? 'ball', opts.small ? 12 : 14)}<span>${sp?.name ?? code}</span></span>`;
}

/** Sport picker chips. `current` '' = all sports. */
export function sportPicker(current: string, actionName: string, opts: { all?: boolean; only?: string[]; label?: string; data?: Record<string, string> } = {}): SafeHtml {
  const list = sportsCatalog().filter((x) => !opts.only || opts.only.includes(x.code));
  const extra = dataAttrs(opts.data);
  return html`<div class="sport-picker" role="group" aria-label="${opts.label ?? 'Sport'}">${opts.all !== false ? html`<button class="sport-chip${!current ? ' active' : ''}" data-action="${actionName}" data-sport=""${extra} aria-pressed="${!current ? 'true' : 'false'}">${icon('layers', 18)}<span>All sports</span></button>` : ''}${list.map((x) => html`<button class="sport-chip${current === x.code ? ' active' : ''}" style="--sport-hue:${x.hue}" data-action="${actionName}" data-sport="${x.code}"${extra} aria-pressed="${current === x.code ? 'true' : 'false'}">${icon(x.icon, 18)}<span>${x.name}</span></button>`)}</div>`;
}

export function venueCard(r: SearchRow, base = '#/venues', sport = ''): SafeHtml {
  const v = r.venue;
  const next = r.next;
  const today = localDate(app.store.now());
  const nextText = next ? `${localDate(next.startMs) === today ? 'Today' : formatDateShort(next.startMs)} ${formatTime(next.startMs)}` : 'Fully booked for now';
  const coverSport = sport || r.sports[0] || 'pickleball';
  const href = `${base}/${v.slug}${sport ? `?sport=${sport}` : ''}`;
  return html`<article class="venue-card card">
    ${app.me() ? html`<button class="${r.favorite ? 'fav-btn on' : 'fav-btn'}" data-action="fav.toggle" data-venue="${v.id}" aria-label="${r.favorite ? 'Remove from favorites' : 'Save to favorites'}" aria-pressed="${r.favorite ? 'true' : 'false'}">${icon('heart', 18)}</button>` : ''}
    <a href="${href}" class="vc-cover" aria-label="${v.name}">${venueCover(v.art, { label: v.name, sport: coverSport })}<span class="vc-badges">${r.openPlayCount ? html`<span class="pill pill-success">${icon('users', 12)} ${r.openPlayCount} Open Play</span>` : ''}${r.eventsCount ? html`<span class="pill pill-event">${icon('trophy', 12)} ${r.eventsCount} event${r.eventsCount > 1 ? 's' : ''}</span>` : ''}</span></a>
    <div class="vc-body">
      <div class="vc-sports">${r.sports.map((x) => sportTag(x, { small: true }))}</div>
      <a class="vc-title" href="${href}" style="text-decoration:none">${v.name}</a>
      <div class="vc-meta"><span>${icon('pin', 14)} ${v.address.barangay}, ${v.address.city}</span>${r.distanceKm !== null ? html`<span><b>${formatDistance(r.distanceKm)}</b> away</span>` : ''}</div>
      <div class="vc-meta">${stars(v.ratingAvg, v.ratingCount)}<span>${icon('court', 14)} ${r.courts} court${r.courts === 1 ? '' : 's'}</span>${r.hasPartial ? html`<span>${icon('grid', 14)} Half courts</span>` : ''}${r.environments.map((e) => html`<span>${e === 'outdoor' ? icon('sun', 14) : e === 'covered' ? icon('roof', 14) : icon('building', 14)} ${ENV_LABEL[e]}</span>`)}</div>
      <div class="vc-foot"><div class="vc-price">${r.fromRate ? html`<span class="muted small">from</span> <b>${formatPHP(r.fromRate, { compact: true })}</b><span class="muted small">/hr</span>` : ''}</div><div class="vc-next">${next ? icon('clock', 14) : ''} ${nextText}</div></div>
    </div>
  </article>`;
}

/**
 * Schematic map (no tile server): pins are projected from latitude/longitude and the view auto-fits the results.
 * Production uses a commercial map provider behind a port (doc 11); this keeps the demo fully offline.
 */
export function mapView(rows: SearchRow[], opts: { user?: LatLng | null; base?: string } = {}): SafeHtml {
  if (!rows.length) return html``;
  const pts = rows.map((r) => r.venue.geo).concat(opts.user ? [opts.user] : []);
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const padLat = Math.max(0.02, (maxLat - minLat) * 0.15), padLng = Math.max(0.02, (maxLng - minLng) * 0.15);
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
  const W = 800, H = 420;
  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * W;
  const y = (lat: number) => H - ((lat - minLat) / (maxLat - minLat)) * H;
  const grid = Array.from({ length: 9 }, (_, i) => `<path d="M${(i * W) / 8} 0V${H}M0 ${(i * H) / 8}H${W}" stroke="#C5DDD0" stroke-width="1"/>`).join('');
  const base = opts.base ?? '#/venues';
  const pins = rows
    .map((r, i) => {
      const px = x(r.venue.geo.lng), py = y(r.venue.geo.lat);
      const label = escapeHtml(r.venue.name.replace(/^Dink District /, 'DD '));
      return `<a href="${base}/${escapeHtml(r.venue.slug)}" class="map-pin" aria-label="${escapeHtml(r.venue.name)}"><g transform="translate(${px.toFixed(1)} ${py.toFixed(1)})"><path d="M0 0c-9-12-14-18-14-25a14 14 0 0 1 28 0c0 7-5 13-14 25z" fill="#0F7A5A" stroke="#fff" stroke-width="2"/><text x="0" y="-21" text-anchor="middle" style="fill:#fff;stroke:none;font-size:11px">${i + 1}</text><text x="18" y="-18">${label}</text></g></a>`;
    })
    .join('');
  const me = opts.user ? `<g transform="translate(${x(opts.user.lng).toFixed(1)} ${y(opts.user.lat).toFixed(1)})"><circle r="16" fill="#0369A1" opacity=".18"/><circle r="7" fill="#0369A1" stroke="#fff" stroke-width="3"/></g>` : '';
  return raw(`<div class="map"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of ${rows.length} venues"><rect width="${W}" height="${H}" fill="#E4F1EA"/>${grid}<path d="M0 ${H * 0.72}C${W * 0.2} ${H * 0.66} ${W * 0.3} ${H * 0.9} ${W * 0.5} ${H * 0.86}S${W * 0.8} ${H * 0.7} ${W} ${H * 0.78}V${H}H0Z" fill="#CFE6F2" opacity=".6"/>${me}${pins}</svg><span class="map-note">Schematic map · positions approximate</span></div>`);
}

export function eventCard(e: EventRow, base = '#/events'): SafeHtml {
  const ev = e.event;
  const cap = e.divisions.reduce((a, d) => a + d.division.capacity, 0);
  const taken = e.divisions.reduce((a, d) => a + d.taken, 0);
  const full = taken >= cap;
  const fee = Math.min(...e.divisions.map((d) => d.fee));
  return html`<a class="card" href="${base}/${ev.id}" style="display:flex;flex-direction:column;overflow:hidden">
    <div style="display:flex;gap:14px;padding:16px">
      <div style="flex:none;width:58px;text-align:center;border-radius:12px;background:var(--ck-color-event-bg);color:var(--ck-color-event);padding:8px 0"><div class="xs" style="font-weight:800;text-transform:uppercase">${formatDateShort(ev.startMs).split(',')[0]}</div><div style="font-size:1.4rem;font-weight:800;line-height:1">${new Date(ev.startMs + 8 * 3_600_000).getUTCDate()}</div><div class="xs">${formatDateShort(ev.startMs).split(' ')[1]}</div></div>
      <div style="min-width:0"><div class="row" style="gap:6px">${tag(ev.type.replace('_', ' '), 'event')}${full ? tag(ev.waitlistEnabled ? 'Waitlist' : 'Full', 'warning') : tag(`${cap - taken} spots left`, 'success')}</div>
      <h3 style="margin:6px 0 2px">${ev.name}</h3><p class="small muted" style="margin:0">${e.venue.name} · ${formatTimeRange(ev.startMs, ev.endMs)}</p><p class="small" style="margin:6px 0 0"><b>${formatPHP(fee, { compact: true })}</b> ${ev.teamBased ? 'per team' : 'per player'}</p></div>
    </div>
    <div style="padding:0 16px 14px"><div class="bar-inline" aria-label="${taken} of ${cap} spots taken"><span style="width:${Math.min(100, Math.round((taken / Math.max(1, cap)) * 100))}%"></span></div></div>
  </a>`;
}

export type OpenPlayRow = ReadResult<'GET /v1/public/open-play'>[number];

export function openPlayCard(o: OpenPlayRow, base = '#/open-play'): SafeHtml {
  const s = o.session;
  const pct = Math.min(100, Math.round((o.used / Math.max(1, s.capacity)) * 100));
  const day = new Date(s.startMs + 8 * 3_600_000);
  return html`<a class="card op-card" href="${base}/${s.id}" style="--sport-hue:${sportsCatalog().find((x) => x.code === s.sport)?.hue ?? 150}">
    <div class="op-card-top">
      <div class="op-date"><div class="xs">${formatDateShort(s.startMs).split(',')[0]}</div><div class="d">${day.getUTCDate()}</div><div class="xs">${formatDateShort(s.startMs).split(' ')[1]}</div></div>
      <div style="min-width:0;flex:1"><div class="row" style="gap:6px">${sportTag(s.sport, { small: true })}${o.live ? html`<span class="pill pill-danger live-dot">${icon('live', 12)} Live now</span>` : ''}${o.remaining > 0 ? tag(`${o.remaining} ${s.capacityUnit === 'team' ? 'team' : 'spot'}${o.remaining === 1 ? '' : 's'} left`, 'success') : tag(s.waitlistEnabled ? 'Waitlist' : 'Full', 'warning')}</div>
      <h3 style="margin:6px 0 2px">${s.title}</h3><p class="small muted" style="margin:0">${o.venue.name} · ${formatTimeRange(s.startMs, s.endMs)}</p>
      <p class="small" style="margin:6px 0 0"><b>${o.priceLabel}</b> · ${o.formatLabel} · ${o.levelLabel}</p></div>
    </div>
    <div style="padding:0 16px 14px"><div class="bar-inline" aria-label="${o.used} of ${s.capacity} taken"><span style="width:${pct}%"></span></div><div class="row-between xs muted" style="margin-top:4px"><span>${o.registered} registered${o.live ? ` · ${o.checkedIn} here · ${o.playing} playing` : ''}</span><span>${o.capacityLabel}</span></div></div>
  </a>`;
}

export function methodLogo(method: string): SafeHtml {
  const map: Record<string, [string, string]> = { gcash: ['#0B57D0', 'GCash'], maya: ['#12A150', 'maya'], grabpay: ['#00B14F', 'Grab'], card: ['#334155', 'CARD'], qrph: ['#C1121F', 'QR Ph'], online_banking: ['#7C2D12', 'BANK'] };
  const [bg, t] = map[method] ?? ['#334155', method];
  return html`<span class="method-logo" style="background:${bg}">${t}</span>`;
}

export function statusPill(s: string): SafeHtml {
  return pill(s);
}

// ---------------------------------------------------------------- location permission (never persisted)

export function currentLocation(): LatLng | null {
  return (app.ui.loc as LatLng | undefined) ?? null;
}

export function locationBar(): SafeHtml {
  const loc = currentLocation();
  const state = app.state<'idle' | 'asking' | 'denied' | 'granted'>('locState', loc ? 'granted' : 'idle');
  if (loc) return html`<div class="row small">${icon('pin', 16)}<span>Showing distance from your ${app.ui.locDemo ? 'demo location (BGC)' : 'current location'} — used only on this page, never stored.</span>${btn('Stop using location', { action: 'loc.clear', variant: 'link', size: 'sm' })}</div>`;
  if (state === 'denied') return html`<div class="row small">${icon('info', 16)}<span>Location is off. Search by city, barangay or venue — everything else works the same.</span>${btn('Use demo location (BGC)', { action: 'loc.demo', variant: 'link', size: 'sm' })}</div>`;
  return html`<div class="row small">${btn(state === 'asking' ? 'Locating…' : 'Use my location', { action: 'loc.ask', variant: 'secondary', size: 'sm', icon: 'pin', disabled: state === 'asking' })}<span class="muted">Optional. We only use it to sort venues by distance.</span></div>`;
}

action('loc.ask', () => {
  app.set('locState', 'asking');
  const done = (ok: boolean, p?: LatLng) => {
    if (ok && p) {
      app.ui.loc = coarsen(p);
      app.ui.locDemo = false;
      app.ui.locState = 'granted';
    } else app.ui.locState = 'denied';
    if (app.me()) void app.api.write('PUT /v1/me/preferences/location', { consent: ok ? 'granted' : 'denied' }, { silent: true }).catch(() => undefined);
    app.render();
  };
  if (!navigator.geolocation) return done(false);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      // Outside the Philippines (e.g. presenting abroad) → fall back to the demo location.
      if (p.lat < 4 || p.lat > 22 || p.lng < 116 || p.lng > 127.5) {
        app.ui.loc = DEMO_LOCATION;
        app.ui.locDemo = true;
        app.ui.locState = 'granted';
        app.toast('You appear to be outside the Philippines, so the demo location (BGC) is used instead.', 'info');
        app.render();
        return;
      }
      done(true, p);
    },
    () => done(false),
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
  );
});
action('loc.demo', () => {
  app.ui.loc = DEMO_LOCATION;
  app.ui.locDemo = true;
  app.set('locState', 'granted');
});
action('loc.clear', () => {
  delete app.ui.loc;
  app.set('locState', 'idle');
});
action('fav.toggle', async (el) => {
  const venueId = el.dataset.venue!;
  const r = await app.run(el, () => app.api.write('POST /v1/me/favorites/{venueId}/toggle', { venueId }));
  if (r) app.toast(r.favorite ? 'Saved to favorites' : 'Removed from favorites', 'success');
});
