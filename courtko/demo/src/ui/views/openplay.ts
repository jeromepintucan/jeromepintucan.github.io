/** Open Play for players (doc 24 OPP/ATT): discovery, session details, registration (individual / partner / team), my pass with a rotating QR, invites, cancellation. */

import { formatPHP } from '../../domain/money.ts';
import { addDays, DOW_SHORT, formatDateLong, formatDateShort, formatDateTime, formatTime, formatTimeRange, localDate, localParts } from '../../domain/time.ts';
import type { ReadResult } from '../../services/api.ts';
import { action, app, form, onChange, route, str, type ViewCtx } from '../app.ts';
import { venueCover } from '../art.ts';
import { alertBox, btn, card, checkbox, countdown, dl, empty, field, pageHeader, pill, qrCode, select, tabs, tag } from '../components.ts';
import { cls, html, type SafeHtml } from '../html.ts';
import { icon } from '../icons.ts';
import { openPlayCard, sportName, sportPicker, sportsCatalog, sportTag } from './shared.ts';

type SessionView = ReadResult<'GET /v1/public/open-play/{sessionId}'>;

const ATT_LABEL: Record<string, string> = {
  not_arrived: 'Not checked in yet',
  checked_in: 'Checked in',
  waiting: 'Waiting to play',
  on_court: 'On court',
  temp_off: 'Taking a break',
  checked_out: 'Checked out',
  completed: 'Completed',
  no_show: 'No-show',
};
const ATT_TONE: Record<string, string> = { not_arrived: 'neutral', checked_in: 'info', waiting: 'warning', on_court: 'success', temp_off: 'neutral', checked_out: 'neutral', completed: 'neutral', no_show: 'danger' };

export function attendancePill(a: string): SafeHtml {
  return html`<span class="pill pill-${ATT_TONE[a] ?? 'neutral'}">${ATT_LABEL[a] ?? a}</span>`;
}

// ---------------------------------------------------------------- discovery

function openPlayList(ctx: ViewCtx, base: string): SafeHtml {
  const f = app.state('opFilters', { sport: ctx.query.get('sport') ?? '', date: '', level: '', format: '', maxPrice: 0, available: false, q: '' });
  const list = app.api.read('GET /v1/public/open-play', { sport: f.sport || undefined, date: f.date || undefined, level: f.level || undefined, format: f.format || undefined, maxPrice: f.maxPrice || undefined, available: f.available, q: f.q || undefined } as never);
  const sport = sportsCatalog().find((x) => x.code === f.sport);
  const today = localDate(app.store.now());
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, i));
  const levels = sport ? sport.skillLevels : [{ code: 'beginner', label: 'Beginner' }, { code: 'intermediate', label: 'Intermediate' }, { code: 'advanced', label: 'Advanced' }];
  const formats = sport ? sport.formats.filter((x) => x.appliesTo.includes('open_play')) : [];
  const live = list.filter((x) => x.live);
  return html`<div class="card" style="margin-bottom:16px"><div class="card-body stack-sm">
    ${sportPicker(f.sport, 'op.f.sport')}
    <form class="row" data-form="op.f.q" role="search"><div style="flex:1;min-width:200px"><label class="sr-only" for="opq">Search</label><input id="opq" name="q" type="search" value="${f.q}" placeholder="Venue, city or session name" autocomplete="off"/></div>${btn('Search', { type: 'submit', variant: 'primary', icon: 'search' })}</form>
    <div class="date-chips" role="group" aria-label="Date"><button class="${cls('date-chip', !f.date && 'active')}" data-action="op.f.date" data-date=""><small>Any</small><b>${icon('calendar', 16)}</b></button>${days.map((d) => {
      const p = localParts(Date.parse(`${d}T04:00:00Z`));
      return html`<button class="${cls('date-chip', d === f.date && 'active')}" data-action="op.f.date" data-date="${d}"><small>${d === today ? 'Today' : DOW_SHORT[p.dow]}</small><b>${p.day}</b></button>`;
    })}</div>
    <div class="filters">
      <select aria-label="Level" data-change="op.f" data-key="level"><option value="">Any level</option>${levels.map((l) => html`<option value="${l.code}"${l.code === f.level ? html` selected` : ''}>${l.label}</option>`)}</select>
      ${formats.length ? html`<select aria-label="Format" data-change="op.f" data-key="format"><option value="">Any format</option>${formats.map((x) => html`<option value="${x.code}"${x.code === f.format ? html` selected` : ''}>${x.label}</option>`)}</select>` : ''}
      <select aria-label="Price" data-change="op.f" data-key="maxPrice">${[[0, 'Any price'], [20000, 'Up to ₱200'], [30000, 'Up to ₱300'], [50000, 'Up to ₱500']].map(([v, l]) => html`<option value="${v}"${Number(v) === f.maxPrice ? html` selected` : ''}>${l}</option>`)}</select>
      <button class="chip${f.available ? ' active' : ''}" data-action="op.f.available">${icon('check', 14)} Spots available</button>
    </div>
  </div></div>
  ${live.length && !f.date ? html`<div class="live-strip">${icon('live', 18)}<b>${live.length} session${live.length === 1 ? '' : 's'} live right now</b><span class="muted small">${live.map((x) => `${x.session.title} at ${x.venue.name}`).join(' · ')}</span></div>` : ''}
  ${list.length ? html`<div class="grid g2">${list.map((o) => openPlayCard(o, base))}</div>` : empty('No Open Play sessions match', 'Try another sport, date or level.', btn('Clear filters', { action: 'op.f.clear', variant: 'secondary' }), 'users')}`;
}

route('/open-play', 'public', 'Open Play', (ctx) => html`<div class="container section-sm">${pageHeader('Open Play', { subtitle: 'Register for a spot, check in with your QR pass and rotate into games — pickleball, basketball, volleyball and tennis.' })}${openPlayList(ctx, '#/open-play')}</div>`);

route('/app/open-play', 'player', 'Open Play', (ctx) => {
  const tab = app.state<'find' | 'mine' | 'invites'>('opTab', 'find');
  const mine = app.api.read('GET /v1/me/open-play/registrations');
  const invites = app.api.read('GET /v1/me/invites');
  const pendingInv = invites.filter((i) => i.invite.status === 'pending').length;
  const upcoming = mine.filter((r) => r.session.endMs > app.store.now() && !['cancelled', 'refunded'].includes(r.registration.status));
  return html`${pageHeader('Open Play', { subtitle: 'Drop-in sessions for every sport. Your spot, your QR pass, your place in the rotation.' })}
  ${tabs([{ key: 'find', label: 'Find sessions' }, { key: 'mine', label: 'My Open Play', count: upcoming.length }, { key: 'invites', label: 'Invites', count: pendingInv }], tab, 'op.tab')}
  ${tab === 'find' ? openPlayList(ctx, '#/app/open-play') : ''}
  ${tab === 'mine' ? (mine.length ? html`<div class="stack-sm">${mine.map((r) => myRow(r))}</div>` : empty('No Open Play yet', 'Find a session and register in a few taps.', btn('Find sessions', { action: 'op.tab', data: { key: 'find' }, variant: 'primary' }), 'users')) : ''}
  ${tab === 'invites' ? invitesList(invites) : ''}`;
});
action('op.tab', (el) => app.set('opTab', el.dataset.key));

function myRow(r: ReadResult<'GET /v1/me/open-play/registrations'>[number]): SafeHtml {
  const reg = r.registration;
  const past = r.session.endMs < app.store.now();
  return html`<a class="card" href="#/app/open-play/registrations/${reg.id}" style="display:flex;gap:14px;padding:12px;align-items:center"><div style="width:84px;border-radius:10px;overflow:hidden;aspect-ratio:4/3;flex:none">${venueCover(r.venue.art, { sport: r.session.sport })}</div><div style="flex:1;min-width:0"><div class="row-between"><b>${r.session.title}</b><span class="row" style="gap:6px">${r.live && !past ? html`<span class="pill pill-danger">${icon('live', 12)} Live</span>` : ''}${pill(reg.status)}</span></div><div class="small">${sportName(r.session.sport)} · ${r.venue.name} · ${formatDateShort(r.session.startMs)} · ${formatTimeRange(r.session.startMs, r.session.endMs)}</div><div class="xs muted">${reg.status === 'confirmed' ? ATT_LABEL[reg.attendance] : ''}${reg.needsPartner ? ' · needs a partner' : ''}${reg.gamesPlayed ? ` · ${reg.gamesPlayed} games` : ''}</div></div>${icon('chevronRight', 18)}</a>`;
}

function invitesList(invites: ReadResult<'GET /v1/me/invites'>): SafeHtml {
  if (!invites.length) return empty('No invitations', 'When a friend invites you as their partner or teammate, it shows up here.', undefined, 'mail');
  return html`<div class="stack-sm">${invites.map((i) => card(html`<div class="row-between"><div><b>${i.from}</b> invited you ${i.party.kind === 'pair' ? 'as their partner' : `to team ${i.party.name}`}<div class="small">${i.session.title} · ${i.venue.name} · ${formatDateShort(i.session.startMs)} ${formatTimeRange(i.session.startMs, i.session.endMs)}</div><div class="xs muted">${i.price ? `Your share: ${formatPHP(i.price)}` : 'No payment needed for your spot'}${i.invite.status === 'pending' ? ` · respond by ${formatTime(i.invite.expiresAt)}` : ''}</div></div>${i.invite.status === 'pending' ? html`<div class="row">${btn('Decline', { action: 'op.invite', data: { id: i.invite.id, accept: '' }, variant: 'ghost' })}${btn(i.price ? `Accept & pay ${formatPHP(i.price)}` : 'Accept', { action: 'op.invite', data: { id: i.invite.id, accept: '1' }, variant: 'primary' })}</div>` : pill(i.invite.status)}</div>`))}</div>`;
}

action('op.invite', async (el) => {
  const accept = !!el.dataset.accept;
  const r = await app.run(el, () => app.api.write('POST /v1/me/invites/{inviteId}/response', { inviteId: el.dataset.id!, accept }, { idempotencyKey: app.idem() }));
  if (!r) return;
  if (r.checkoutId) app.navigate(`#/app/checkout/${r.checkoutId}`);
  else if (r.registrationId) {
    app.toast("You're in! Your partner has been notified.", 'success');
    app.navigate(`#/app/open-play/registrations/${r.registrationId}`);
  } else app.toast('Invitation declined. They have been notified.', 'info');
});

onChange('op.f', (el) => {
  const f = app.state<Record<string, unknown>>('opFilters', {});
  const k = el.dataset.key!;
  const v = (el as HTMLSelectElement).value;
  f[k] = k === 'maxPrice' ? Number(v) : v;
  app.render();
});
action('op.f.sport', (el) => {
  const f = app.state<Record<string, unknown>>('opFilters', {});
  f.sport = el.dataset.sport ?? '';
  f.format = '';
  f.level = '';
  app.render();
});
action('op.f.date', (el) => {
  app.state<Record<string, unknown>>('opFilters', {}).date = el.dataset.date ?? '';
  app.render();
});
action('op.f.available', () => {
  const f = app.state<Record<string, unknown>>('opFilters', {});
  f.available = !f.available;
  app.render();
});
action('op.f.clear', () => {
  delete app.ui.opFilters;
  app.render();
});
form('op.f.q', (fd) => {
  app.state<Record<string, unknown>>('opFilters', {}).q = str(fd, 'q');
  app.render();
});

// ---------------------------------------------------------------- session details

type LiveView = SessionView['liveSummary'];

const ago = (at: number | null): string => {
  if (at === null) return '—';
  const m = Math.max(0, Math.round((app.store.now() - at) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};

function phaseLine(l: LiveView): SafeHtml {
  switch (l.phase) {
    case 'upcoming':
      return html`<span class="lp lp-upcoming">${icon('clock', 14)} Check-in opens ${formatDateShort(l.checkInOpensAt)} ${formatTime(l.checkInOpensAt)}</span><span class="xs muted">Starts in ${countdown(l.startsAt)}</span>`;
    case 'check_in':
      return html`<span class="lp lp-checkin"><span class="live-dot">${icon('live', 14)}</span> Check-in open</span><span class="xs muted">Starts in ${countdown(l.startsAt)} · late cutoff ${formatTime(l.lateCutoffAt)}</span>`;
    case 'live':
      return html`<span class="lp lp-live"><span class="live-dot">${icon('live', 14)}</span> In progress</span><span class="xs muted">Ends ${formatTime(l.endsAt)} · ${l.gamesCompleted} game${l.gamesCompleted === 1 ? '' : 's'} played so far</span>`;
    case 'cancelled':
      return html`<span class="lp lp-ended">${icon('ban', 14)} Cancelled</span>`;
    default:
      return html`<span class="lp lp-ended">${icon('checkCircle', 14)} Session ended</span><span class="xs muted">${l.gamesCompleted} games played</span>`;
  }
}

function meLine(l: LiveView): SafeHtml {
  const me = l.me;
  if (!me || me.registrationStatus !== 'confirmed') return html``;
  const open = l.phase === 'check_in' || l.phase === 'live';
  let text: SafeHtml;
  if (me.attendance === 'not_arrived') text = open ? html`You're not checked in yet. Show your pass at the front desk — <b>${l.checkedIn}</b> player${l.checkedIn === 1 ? ' is' : 's are'} already here.` : l.phase === 'upcoming' ? html`You're registered. Check-in opens at <b>${formatTime(l.checkInOpensAt)}</b>.` : html`You didn't check in for this session.`;
  else if (me.attendance === 'waiting') text = me.waitingPosition ? html`You're <b>#${me.waitingPosition}</b> in line${me.estWaitMinutes === 0 ? html` — <b>you're up when the next court frees</b>` : me.estWaitMinutes ? html` · about <b>${me.estWaitMinutes} min</b> to your next game` : ''}.` : html`You're in the waiting rotation.`;
  else if (me.attendance === 'on_court') text = html`You're playing on <b>${me.court ?? 'court'}</b>. Have fun!`;
  else if (me.attendance === 'checked_in') text = html`You're checked in. Staff will add you to the rotation.`;
  else if (me.attendance === 'temp_off') text = html`You're taking a break. Tell the desk when you want back in.`;
  else text = html`${ATT_LABEL[me.attendance] ?? me.attendance}.`;
  return html`<div class="me-status">${attendancePill(me.attendance)}<span class="small">${text}</span>${me.gamesPlayed ? html`<span class="xs muted">${me.gamesPlayed} game${me.gamesPlayed === 1 ? '' : 's'} played</span>` : ''}</div>`;
}

/** Always-on, privacy-safe live status: arrivals, waiting, playing, per-court occupancy and the viewer's own place. */
export function livePanel(l: LiveView, opts: { title?: string } = {}): SafeHtml {
  const ended = l.phase === 'ended' || l.phase === 'cancelled';
  const pct = l.registered ? Math.round((l.checkedIn / l.registered) * 100) : 0;
  const started = l.phase === 'live';
  return card(
    html`<div class="live-panel" data-live="1">
    <div class="live-phase">${phaseLine(l)}</div>
    <div class="arrivals"><div class="row-between"><span><b class="big-num">${l.checkedIn}</b> <span class="small">of ${l.registered} registered ${ended ? 'checked in' : 'are here'}</span></span><span class="xs muted">${l.remaining} spot${l.remaining === 1 ? '' : 's'} left</span></div>
      <div class="bar-inline arrivals-bar" role="img" aria-label="${l.checkedIn} of ${l.registered} checked in"><span style="width:${pct}%"></span></div>
      ${!ended && l.lastArrivalAt ? html`<p class="xs muted" style="margin:6px 0 0">${l.arrivedLast15 ? html`<b>${l.arrivedLast15}</b> arrived in the last 15 min · ` : ''}last check-in ${ago(l.lastArrivalAt)}</p>` : ''}</div>
    <div class="live-counts live-counts-4">${[
      ['Here now', l.checkedIn],
      ['Waiting', l.waiting],
      ['Playing', l.playing],
      [ended ? 'No-show / absent' : 'Not here yet', l.notArrived],
    ].map(([k, v]) => html`<div><b>${v}</b><span>${k}</span></div>`)}</div>
    ${!ended ? html`<div class="live-courts">${l.courts.map((c) => html`<div class="lc ${c.inGame ? 'busy' : 'free'}"><b>${c.name}</b><span>${c.inGame ? `Game on · ${c.minutes} min` : started ? 'Free — next game soon' : 'Opens at the start'}</span></div>`)}</div>` : ''}
    ${meLine(l)}
    <p class="xs muted live-foot">${ended ? '' : html`<span class="live-dot">${icon('live', 12)}</span> Live · `}Updated ${formatTime(l.updatedAt)}${ended ? '' : ' · refreshes automatically'}. ${icon('shield', 12)} Counts only — never other players' names, contacts or check-in records.</p>
  </div>`,
    { title: html`<span class="row" style="gap:6px">${icon('live', 16)} ${opts.title ?? (ended ? 'Session summary' : 'Live status')}</span>` },
  );
}

export function openPlayDetailView(ctx: ViewCtx, inApp: boolean): SafeHtml {
  const d = app.api.read('GET /v1/public/open-play/{sessionId}', { sessionId: ctx.params.id! });
  const o = d.session;
  const mine = d.mine;
  const now = app.store.now();
  const full = d.remaining <= 0;
  const regBtn = (mode: string, label: string, variant: 'primary' | 'secondary' = 'secondary', extra: Record<string, string> = {}) => btn(label, { action: 'op.register', data: { id: o.id, mode, ...extra }, variant, block: true });
  const actions = mine
    ? html`${alertBox(mine.registration.status === 'confirmed' ? 'success' : 'info', mine.registration.status === 'confirmed' ? "You're registered" : `Registration: ${mine.registration.status.replace(/_/g, ' ')}`, mine.registration.needsPartner ? 'You are marked as needing a partner.' : undefined)}${btn('Open my pass', { href: `#/app/open-play/registrations/${mine.registration.id}`, variant: 'primary', block: true, icon: 'qr' })}`
    : !d.registrationOpen
      ? html`${tag(now < o.registrationOpensAt ? `Registration opens ${formatDateShort(o.registrationOpensAt)} ${formatTime(o.registrationOpensAt)}` : 'Registration closed')}`
      : d.restricted
        ? alertBox('warning', "Registration isn't available for your account at this venue")
        : full
          ? o.waitlistEnabled
            ? html`${alertBox('warning', 'This session is full')}${btn('Join the waitlist', { action: 'op.waitlist', data: { id: o.id }, variant: 'secondary', block: true })}`
            : tag('Full', 'warning')
          : html`<div class="stack-sm">${o.registrationModes.includes('individual') ? regBtn('individual', o.registrationModes.includes('team') ? 'Register solo (we’ll place you)' : 'Register', 'primary') : ''}${o.registrationModes.includes('partner') ? regBtn('partner', 'Register with a partner', o.registrationModes.includes('individual') ? 'secondary' : 'primary') : ''}${o.registrationModes.includes('team') ? regBtn('team', 'Register a team', o.registrationModes.includes('individual') ? 'secondary' : 'primary') : ''}${d.joinableTeams.length ? html`<p class="xs muted" style="margin:4px 0 0">Or join a team that has open spots:</p>${d.joinableTeams.map((t) => btn(`Join ${t.name} (${t.members}/${t.size})`, { action: 'op.register', data: { id: o.id, mode: 'team', party: t.id }, variant: 'ghost', block: true, icon: 'userPlus' }))}` : ''}</div>`;
  return html`<div class="op-hero" style="--sport-hue:${sportsCatalog().find((x) => x.code === o.sport)?.hue ?? 150}">${venueCover(d.venue.art, { sport: o.sport, label: o.title })}<div class="overlay"><div class="row" style="gap:6px;margin-bottom:6px">${sportTag(o.sport)}${d.live ? html`<span class="pill pill-danger">${icon('live', 12)} Live now</span>` : ''}${tag(d.styleLabel, 'accent')}</div><h1>${o.title}</h1><p>${d.venue.name} · ${formatDateLong(o.startMs)} · ${formatTimeRange(o.startMs, o.endMs)}</p></div></div>
  ${btn('All Open Play', { href: inApp ? '#/app/open-play' : '#/open-play', variant: 'ghost', size: 'sm', icon: 'chevronLeft' })}
  <div class="split" style="margin-top:8px"><div class="stack">
    ${livePanel(d.liveSummary)}
    ${card(html`<p>${o.description}</p>${dl([['Sport', d.sportName], ['Format', d.formatLabel], ['Style', d.styleLabel], ['Level', d.levelLabel], ['Eligibility', o.eligibility], ['Courts', d.courts.join(', ')], ['Registration', o.registrationModes.map((m) => (m === 'individual' ? 'Individual' : m === 'partner' ? 'With a partner' : `Team (${o.teamSize} players)`)).join(' · ')], ['Rotation', d.rotationLabel], ['Equipment', o.equipmentIncluded ? o.equipmentNote || 'Provided' : 'Bring your own'], ['Organizer', o.organizer]])}`, { title: 'About this session' })}
    ${card(dl([['Check-in opens', `${formatTime(o.checkInOpensAt)} (${formatDateShort(o.checkInOpensAt)})`], ['Late-arrival cutoff', formatTime(o.lateCutoffAt)], ['No-shows', o.noShowPolicy], ['Walk-ins', o.walkInsAllowed ? 'Welcome if spots remain' : 'Registration required'], ['Instructions', o.instructions || '—']]), { title: 'On the day' })}
  </div><div class="stack">
    ${card(html`<div class="row-between"><b style="font-size:1.4rem">${d.priceLabel}</b>${d.remaining > 0 ? tag(`${d.remaining} of ${o.capacity} ${o.capacityUnit === 'team' ? 'team spots' : 'spots'} left`, 'success') : tag('Full', 'warning')}</div>
    <div class="bar-inline" style="margin:12px 0 6px"><span style="width:${Math.min(100, Math.round((d.used / Math.max(1, o.capacity)) * 100))}%"></span></div><div class="row-between xs muted"><span>${d.registered} registered</span>${d.waitlisted ? html`<span>${d.waitlisted} on the waitlist</span>` : ''}</div>
    <div style="margin-top:14px">${ctx.me ? actions : btn('Sign in to register', { href: `#/login?next=${encodeURIComponent(`/app/open-play/${o.id}`)}`, variant: 'primary', block: true })}</div>
    <p class="xs muted" style="margin-top:10px">Your spot is held for 10 minutes while you pay. Registering doesn't count as attendance — you check in at the venue with your QR pass.</p>`, { title: 'Join' })}
    ${card(html`<ul class="bullets small">${d.policy.lines.map((l) => html`<li>${l}</li>`)}</ul>${o.refundNote ? html`<p class="xs muted">${o.refundNote}</p>` : ''}`, { title: `${d.policy.name} cancellation policy` })}
  </div></div>`;
}

route('/open-play/:id', 'public', 'Open Play session', (ctx) => html`<div class="container section-sm">${openPlayDetailView(ctx, false)}</div>`);
route('/app/open-play/:id', 'player', 'Open Play session', (ctx) => openPlayDetailView(ctx, true));

action('op.register', (el) => {
  if (!app.me()) return app.navigate(`#/login?next=${encodeURIComponent(`/app/open-play/${el.dataset.id}`)}`);
  const d = app.api.read('GET /v1/public/open-play/{sessionId}', { sessionId: el.dataset.id! });
  const mode = el.dataset.mode!;
  const party = el.dataset.party ?? '';
  const sport = sportsCatalog().find((x) => x.code === d.session.sport)!;
  const myLevel = app.api.read('GET /v1/me/sports').sports.find((x) => x.sport === d.session.sport)?.skill ?? '';
  const range = d.format?.teamSize ?? { min: 2, max: 10, default: d.session.teamSize };
  const price = d.session.pricing === 'free' ? 0 : d.session.pricing === 'per_team' ? (mode === 'team' && !party ? d.session.price : 0) : d.session.price;
  app.modal({
    title: party ? 'Join team' : mode === 'partner' ? 'Register with a partner' : mode === 'team' ? 'Register a team' : 'Register for Open Play',
    body: html`<form class="stack-sm" data-form="op.register" data-id="${d.session.id}" data-mode="${mode}" data-party="${party}">
      <p class="small muted">${d.session.title} · ${formatDateShort(d.session.startMs)} ${formatTimeRange(d.session.startMs, d.session.endMs)}</p>
      ${select({ name: 'skill', label: `Your ${sport.name.toLowerCase()} level (self-declared)`, value: myLevel, options: [{ value: '', label: 'Prefer not to say' }, ...sport.skillLevels.map((l) => ({ value: l.code, label: l.label }))] })}
      ${mode === 'partner' ? html`${field({ name: 'partnerUsername', label: 'Partner’s CourtKo username', placeholder: '@bea.santiago', required: true, hint: 'We send them an invitation in the app. Only usernames work — we never look players up by email or phone.' })}${d.session.pricing === 'per_player' ? html`<p class="xs muted">Each player pays their own spot (${formatPHP(d.session.price)}). If your partner declines, you stay registered and are marked as needing a partner.</p>` : ''}` : ''}
      ${mode === 'team' && !party ? html`${field({ name: 'teamName', label: 'Team name', required: true, placeholder: 'e.g. Weekend Warriors' })}${field({ name: 'teamSize', label: `Team size (${range.min}–${range.max})`, type: 'number', value: d.session.teamSize, min: range.min, max: range.max })}${field({ name: 'teammates', label: 'Invite teammates (optional)', placeholder: '@miguel.reyes, @carlo.bautista', hint: 'Comma-separated usernames. You can invite more later.' })}${checkbox({ name: 'joinable', label: 'Let other registered players join my team', checked: true })}<p class="xs muted">${d.session.pricing === 'per_team' ? `One fee for the whole team (${formatPHP(d.session.price)}), paid by you.` : `Each player pays their own spot (${formatPHP(d.session.price)}).`}</p>` : ''}
      ${party ? html`<p class="small">${price ? `Your spot: ${formatPHP(price)}` : 'The team captain already paid the team fee — your spot is free.'}</p>` : ''}
      <div class="row" style="justify-content:flex-end">${btn('Cancel', { action: 'modal.close', variant: 'ghost' })}${btn(price ? `Continue to pay ${formatPHP(price)}` : 'Register', { type: 'submit', variant: 'primary' })}</div>
    </form>`,
  });
});

form('op.register', async (fd, f) => {
  const mode = f.dataset.mode as 'individual' | 'partner' | 'team';
  const r = await app.api.write(
    'POST /v1/me/open-play/{sessionId}/registrations',
    {
      sessionId: f.dataset.id!,
      mode,
      skill: str(fd, 'skill') || null,
      ...(f.dataset.party ? { joinPartyId: f.dataset.party } : {}),
      ...(mode === 'partner' ? { partnerUsername: str(fd, 'partnerUsername') } : {}),
      ...(mode === 'team' && !f.dataset.party ? { teamName: str(fd, 'teamName'), teamSize: Number(str(fd, 'teamSize')), teammateUsernames: str(fd, 'teammates').split(',').map((x) => x.trim()).filter(Boolean), joinable: fd.get('joinable') === 'on' } : {}),
    },
    { idempotencyKey: app.idem() },
  );
  app.closeModal();
  if (r.checkoutId) app.navigate(`#/app/checkout/${r.checkoutId}`);
  else {
    app.toast("You're registered!", 'success');
    app.navigate(`#/app/open-play/registrations/${r.registrationId}`);
  }
});

action('op.waitlist', async (el) => {
  if (!app.me()) return app.navigate('#/login');
  const r = await app.run(el, () => app.api.write('POST /v1/me/open-play/{sessionId}/waitlist', { sessionId: el.dataset.id! }));
  if (r) app.toast(`You're #${r.position} on the waitlist. We'll notify you if a spot opens.`, 'success');
});

// ---------------------------------------------------------------- my registration & pass

route('/app/open-play/registrations/:id', 'player', 'My Open Play pass', (ctx) => {
  const d = app.api.read('GET /v1/me/open-play/registrations/{registrationId}', { registrationId: ctx.params.id! });
  const reg = d.registration;
  const o = d.session;
  const now = app.store.now();
  const showReg = app.state<boolean>(`regqr:${reg.id}`, false);
  const tok = reg.status === 'confirmed' && d.canCheckIn ? app.api.read('GET /v1/me/open-play/registrations/{registrationId}/checkin-token', { registrationId: reg.id }) : null;
  const party = d.party;
  const isCaptain = reg.role === 'captain';
  const past = o.endMs < now;
  return html`${pageHeader(o.title, { back: '#/app/open-play', eyebrow: `Open Play · ${d.sportName}`, subtitle: html`${d.venue.name} · ${formatDateLong(o.startMs)} · ${formatTimeRange(o.startMs, o.endMs)}`, actions: html`${pill(reg.status)}${reg.status === 'confirmed' ? attendancePill(reg.attendance) : ''}` })}
  ${reg.needsPartner ? alertBox('warning', 'You need a partner', 'Your invited partner declined or cancelled. You are still registered. Invite someone else below, or the front desk can pair you on the day.') : ''}
  ${reg.status === 'held' || reg.status === 'pending_payment' ? alertBox('info', 'Finish your payment to confirm your spot', html`Your spot is held until ${formatTime(d.checkout?.expiresAt ?? now)}. ${d.checkout ? btn('Go to checkout', { href: `#/app/checkout/${d.checkout.id}`, variant: 'primary', size: 'sm' }) : ''}`) : ''}
  ${reg.status === 'waitlisted' ? alertBox('info', `You're #${reg.waitlistPosition} on the waitlist`, 'We will notify you if a spot opens. You will have 1 hour to claim it.') : ''}
  ${reg.status === 'offered' ? alertBox('success', 'A spot opened for you!', html`Claim it before ${formatTime(reg.offerExpiresAt ?? now)}. ${btn('Claim my spot', { action: 'op.offer', data: { id: reg.id }, variant: 'primary', size: 'sm' })}`) : ''}
  <div class="split"><div class="stack">
    ${reg.status === 'confirmed' || reg.status === 'waitlisted' || reg.status === 'offered' ? livePanel(d.live, past ? { title: 'Session summary' } : {}) : ''}
    ${tok ? card(html`<div class="pass">
      <div class="pass-qr">${qrCode(showReg ? tok.registrationToken : tok.token, 200, showReg ? 'Registration QR code' : 'Open Play check-in pass')}</div>
      <div class="stack-sm" style="flex:1;min-width:200px">
        <div class="seg" role="group" aria-label="Pass type"><button class="${!showReg ? 'active' : ''}" data-action="op.qrtype" data-id="${reg.id}" data-reg="">Live pass</button><button class="${showReg ? 'active' : ''}" data-action="op.qrtype" data-id="${reg.id}" data-reg="1">Registration QR</button></div>
        ${showReg ? html`<p class="small">Your registration QR (from your confirmation) — valid until the late-arrival cutoff at <b>${formatTime(tok.validUntil)}</b>.</p>` : html`<p class="small">Show this at the front desk. It refreshes automatically every 10 minutes — screenshots stop working.</p><p class="small">Refreshes in ${countdown(tok.expiresAt)}</p>`}
        <p class="xs muted">${icon('shield', 12)} The code is signed and time-limited. It contains no name, phone or account number — the venue's scanner checks it with CourtKo's server. Check-in opens ${formatTime(d.checkInOpensAt)}.</p>
      </div></div>`, { title: 'Check-in pass' }) : ''}
    ${party ? card(html`<div class="stack-sm">${party.members.map((m) => html`<div class="row-between"><div class="row">${icon(m.role === 'captain' ? 'star' : 'user', 16)}<b>${m.name}${m.me ? ' (you)' : ''}</b>${m.username ? html`<a class="xs" href="#/players/${m.username}">@${m.username}</a>` : ''}</div><span class="row" style="gap:6px">${pill(m.status)}${m.status === 'confirmed' ? attendancePill(m.attendance) : ''}</span></div>`)}${party.invites.filter((i) => i.status !== 'accepted').map((i) => html`<div class="row-between small"><span>${icon('mail', 14)} Invited ${i.name}</span>${pill(i.status === 'pending' && i.expiresAt < now ? 'expired' : i.status)}</div>`)}</div>
      ${isCaptain && party.openSeats > 0 && reg.status === 'confirmed' && !past ? html`<form class="row" data-form="op.invitePartner" data-id="${reg.id}" style="margin-top:12px;align-items:flex-end"><div style="flex:1">${field({ name: 'username', label: party.party.kind === 'pair' ? 'Invite a partner' : `Invite a teammate (${party.openSeats} open)`, placeholder: '@username', required: true })}</div>${btn('Send invite', { type: 'submit', variant: 'secondary', icon: 'userPlus' })}</form>` : ''}
      <p class="xs muted" style="margin-top:8px">Teammates see each other's display names only — never contact details.</p>`, { title: party.party.kind === 'pair' ? 'Your pair' : `Team ${party.party.name}`, subtitle: `${party.party.status.replace(/_/g, ' ')}${party.party.joinable ? ' · open for others to join' : ''}` }) : ''}
    ${d.attendanceHistory.length ? card(html`<ol class="timeline">${d.attendanceHistory.map((e) => html`<li><span class="tl-dot"></span><div><div><b>${e.type.replace(/_/g, ' ')}</b>${e.to ? html` → ${ATT_LABEL[e.to] ?? e.to}` : ''}${e.court ? ` · ${e.court}` : ''}</div><div class="xs muted">${formatDateTime(e.at)}</div></div></li>`)}</ol>`, { title: 'Your attendance history' }) : ''}
  </div><div class="stack">
    ${card(dl([['Sport', d.sportName], ['Format', d.formatLabel], ['Level', d.levelLabel], ['Courts', d.courts.join(', ')], ['Registered as', reg.mode === 'individual' ? 'Individual' : reg.mode === 'partner' ? 'Pair' : 'Team'], ['Your level', reg.skill ? reg.skill.replace(/^\w/, (c) => c.toUpperCase()) + ' (self-declared)' : 'Not set'], ['Check-in', reg.checkedInAt ? `${formatTime(reg.checkedInAt)} (${(reg.checkInMethod ?? '').replace(/_/g, ' ')})` : `Opens ${formatTime(d.checkInOpensAt)} · cutoff ${formatTime(d.lateCutoffAt)}`], ['Games played', reg.gamesPlayed || '—']]), { title: 'Registration' })}
    ${d.payment ? card(html`${dl([['Paid', formatPHP(d.payment.amount)], ['Method', d.payment.methodDisplay], ['Status', pill(d.payment.status)]])}${d.refunds.map((r) => html`<div class="row-between small" style="padding-top:6px"><span>${r.reason}</span><span>${formatPHP(r.amount)} ${pill(r.status)}</span></div>`)}`, { title: 'Payment' }) : reg.status === 'confirmed' ? card(html`<p class="small muted">${reg.role === 'member' || reg.role === 'partner' ? 'No payment needed for your spot.' : 'Free session — no payment.'}</p>`, { title: 'Payment' }) : ''}
    ${['confirmed', 'waitlisted', 'offered', 'held', 'pending_payment'].includes(reg.status) && o.startMs > now ? card(html`${btn('Cancel registration', { action: 'op.cancel', data: { id: reg.id }, variant: 'danger', block: true })}<p class="xs muted" style="margin-top:8px">Refunds follow the session's cancellation policy, shown before you confirm.</p>`, { title: 'Change of plans?' }) : ''}
    ${card(html`${btn('View session', { href: `#/app/open-play/${o.id}`, variant: 'secondary', block: true })}`, {})}
  </div></div>`;
});

action('op.qrtype', (el) => app.set(`regqr:${el.dataset.id}`, !!el.dataset.reg));
action('op.offer', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /v1/me/open-play/registrations/{registrationId}/accept-offer', { registrationId: el.dataset.id! }, { idempotencyKey: app.idem() }));
  if (r?.checkoutId) app.navigate(`#/app/checkout/${r.checkoutId}`);
  else if (r) app.toast("You're in!", 'success');
});
form('op.invitePartner', async (fd, f) => {
  await app.api.write('POST /v1/me/open-play/registrations/{registrationId}/invitations', { registrationId: f.dataset.id!, username: str(fd, 'username') });
  app.toast('Invitation sent', 'success');
});
action('op.cancel', async (el) => {
  const id = el.dataset.id!;
  const q = app.api.read('GET /v1/me/open-play/registrations/{registrationId}/cancellation-quote', { registrationId: id });
  const ok = await app.confirm({
    title: 'Cancel your registration?',
    body: html`<p><b>${q.tier}</b> (${q.policy} policy)</p>${q.paid ? html`<dl class="breakdown"><div class="bd-row"><dt>You paid</dt><dd>${formatPHP(q.paid)}</dd></div><div class="bd-row bd-total"><dt>Refund</dt><dd>${formatPHP(q.refund)}</dd></div></dl>` : ''}${q.teamNote ? html`<p class="small">${q.teamNote}</p>` : ''}<p class="xs muted">This quote is valid until ${formatTime(q.validUntil)}.</p>`,
    confirmLabel: q.refund ? `Cancel & refund ${formatPHP(q.refund)}` : 'Cancel registration',
    danger: true,
  });
  if (!ok) return;
  await app.run(el, () => app.api.write('POST /v1/me/open-play/registrations/{registrationId}/cancellation', { registrationId: id }, { idempotencyKey: app.idem() }), { success: q.refund ? 'Cancelled — your refund is on its way.' : 'Registration cancelled.' });
});

route('/app/invites', 'player', 'Invitations', () => html`${pageHeader('Open Play invitations', { back: '#/app/open-play' })}${invitesList(app.api.read('GET /v1/me/invites'))}`);
