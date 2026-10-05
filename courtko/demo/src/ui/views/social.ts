/** Social player profiles (doc 24 SOC) and the My Sports dashboard. Other players are only ever shown through the public-profile projection. */

import { formatDateShort, formatRelative, formatTime } from '../../domain/time.ts';
import type { ReadResult } from '../../services/api.ts';
import { action, app, form, route, str, type ViewCtx } from '../app.ts';
import { avatar } from '../art.ts';
import { sparkline } from '../charts.ts';
import { alertBox, btn, card, empty, field, pageHeader, select, tag, textarea } from '../components.ts';
import { html, type SafeHtml } from '../html.ts';
import { icon } from '../icons.ts';
import { sportsCatalog } from './shared.ts';

type Card = ReadResult<'GET /v1/players'>[number];

function playerCard(c: Card, opts: { reason?: string } = {}): SafeHtml {
  const btnLabel = c.following === 'accepted' ? 'Following' : c.following === 'pending' ? 'Requested' : c.followsYou ? 'Follow back' : 'Follow';
  return html`<div class="player-card card"><a href="#/app/players/${c.username}" class="row" style="text-decoration:none;color:inherit;flex:1;min-width:0">${avatar(c.displayName, c.avatarHue, 44)}<div style="min-width:0"><b>${c.displayName}</b><div class="xs muted">@${c.username}${c.followsYou ? ' · follows you' : ''}</div>${opts.reason || c.reason ? html`<div class="xs muted">${opts.reason ?? c.reason}</div>` : ''}</div></a>${btn(btnLabel, { action: c.following ? 'soc.unfollow' : 'soc.follow', data: { u: c.username }, variant: c.following ? 'secondary' : 'primary', size: 'sm', icon: c.following === 'accepted' ? 'userCheck' : 'userPlus' })}</div>`;
}

// ---------------------------------------------------------------- My Sports dashboard (profile)

export function mySportsSection(): SafeHtml {
  const d = app.api.read('GET /v1/me/sports');
  const sportCfg = sportsCatalog();
  return html`<section class="my-sports">
    <div class="row-between" style="margin-bottom:10px"><div><h2 style="margin:0">My sports</h2><p class="muted small" style="margin:2px 0 0">${d.totals.sports} sport${d.totals.sports === 1 ? '' : 's'} · ${d.totals.sessions} sessions · ${d.totals.hours} hours on court</p></div>${d.otherSports.length ? html`<div class="row" style="gap:6px">${d.otherSports.map((x) => btn(`+ ${x.name}`, { action: 'sp.add', data: { sport: x.sport }, variant: 'ghost', size: 'sm' }))}</div>` : ''}</div>
    ${d.sports.length ? html`<div class="sport-dash">${d.sports.map((sp) => {
      const hue = sportCfg.find((x) => x.code === sp.sport)?.hue ?? 150;
      return html`<article class="sport-card card" style="--sport-hue:${hue}">
        <header class="sport-card-head"><span class="sport-ic">${icon(sp.icon, 22)}</span><div style="flex:1"><h3 style="margin:0">${sp.name}${sp.pinned ? html` <span title="Pinned">${icon('star', 14)}</span>` : ''}</h3><div class="xs">${sp.lastPlayedAt ? `Last played ${formatRelative(sp.lastPlayedAt, app.store.now())}` : sp.interested ? 'Interested — not played yet' : ''}</div></div>
          <div class="row" style="gap:2px">${btn('', { action: 'sp.pin', data: { sport: sp.sport, on: sp.pinned ? '' : '1' }, variant: 'ghost', size: 'sm', icon: 'star', title: sp.pinned ? 'Unpin' : 'Pin to top' })}${btn('', { action: 'sp.hide', data: { sport: sp.sport }, variant: 'ghost', size: 'sm', icon: 'eye', title: 'Hide from my profile' })}</div></header>
        <div class="sport-stats"><div><b>${sp.sessions}</b><span>sessions</span></div><div><b>${sp.hours}</b><span>hours</span></div><div><b>${sp.games}</b><span>games</span></div><div><b>${sp.wins}–${sp.losses}</b><span>W–L</span></div></div>
        <div class="row-between xs muted" style="margin:6px 0 4px"><span>${sp.bookings} booking${sp.bookings === 1 ? "" : "s"} · ${sp.openPlay} Open Play · ${sp.events} event${sp.events === 1 ? "" : "s"}</span><span title="Sessions per month, last 6 months">${sparkline(sp.monthly, 90, 24)}</span></div>
        <form class="row" data-form="sp.skill" data-sport="${sp.sport}" style="align-items:flex-end;gap:8px">${select({ name: 'skill', id: `sk-${sp.sport}`, label: 'My level (self-declared)', value: sp.skill ?? '', options: [{ value: '', label: 'Not set' }, ...sp.skillLevels.map((l) => ({ value: l.code, label: l.label }))] })}${btn('Save', { type: 'submit', variant: 'secondary', size: 'sm' })}</form>
        ${sp.ratings.length ? html`<div class="xs" style="margin-top:6px">${sp.ratings.map((r) => html`<span class="pill pill-info" style="margin-right:4px">${r.value ?? ''} ${r.source === 'venue_verified' ? 'venue-verified' : 'CourtKo beta'}</span>`)}</div>` : ''}
        ${sp.venues.length ? html`<div class="small" style="margin-top:8px"><span class="muted">Plays most at </span>${sp.venues.map((v, i) => html`${i ? ', ' : ''}<a href="#/app/book/${v.slug}">${v.name}</a>`)}</div>` : ''}
        <div class="sport-upcoming">${sp.upcoming.length ? sp.upcoming.map((u) => html`<a href="${u.href}" class="row-between small"><span>${icon(u.kind === 'booking' ? 'calendar' : 'users', 14)} ${u.title} · ${u.venue}</span><span class="muted">${formatDateShort(u.startMs)} ${formatTime(u.startMs)}</span></a>`) : html`<span class="xs muted">Nothing booked yet.</span>`}
        <div class="row" style="gap:6px;margin-top:6px">${btn('Book a court', { href: `#/app/discover?sport=${sp.sport}`, variant: 'ghost', size: 'sm', icon: 'search' })}${btn('Open Play', { action: 'sp.openplay', data: { sport: sp.sport }, variant: 'ghost', size: 'sm', icon: 'users' })}</div></div>
      </article>`;
    })}</div>` : empty('No sports yet', 'Book a court or join Open Play — your sports appear here automatically.', btn('Find a court', { href: '#/app/discover', variant: 'primary' }), 'activity')}
    ${d.hiddenSports.length ? html`<p class="xs muted" style="margin-top:8px">Hidden: ${d.hiddenSports.map((h) => html`<button class="link-btn" data-action="sp.unhide" data-sport="${h.sport}">${h.name}</button> `)} — hidden sports never appear on your public profile.</p>` : ''}
  </section>`;
}

form('sp.skill', async (fd, f) => {
  await app.api.write('PUT /v1/me/sports/{sport}', { sport: f.dataset.sport!, skill: str(fd, 'skill') || null });
  app.toast('Level saved (self-declared)', 'success');
});
action('sp.pin', async (el) => {
  await app.run(el, () => app.api.write('PUT /v1/me/sports/{sport}', { sport: el.dataset.sport!, pinned: !!el.dataset.on }, { silent: true }));
});
action('sp.hide', async (el) => {
  await app.run(el, () => app.api.write('PUT /v1/me/sports/{sport}', { sport: el.dataset.sport!, hidden: true }, { silent: true }), { success: 'Hidden from your profile' });
});
action('sp.unhide', async (el) => {
  await app.run(el, () => app.api.write('PUT /v1/me/sports/{sport}', { sport: el.dataset.sport!, hidden: false }, { silent: true }));
});
action('sp.add', async (el) => {
  await app.run(el, () => app.api.write('PUT /v1/me/sports/{sport}', { sport: el.dataset.sport!, interested: true, hidden: false }, { silent: true }), { success: 'Added to My sports' });
});
action('sp.openplay', (el) => {
  app.ui.opFilters = { sport: el.dataset.sport ?? '', date: '', level: '', format: '', maxPrice: 0, available: false, q: '' };
  app.ui.opTab = 'find';
  app.navigate('#/app/open-play');
});

// ---------------------------------------------------------------- player search & suggestions

route('/app/players', 'player', 'Players', () => {
  const q = app.state<string>('plQ', '');
  const results = q.length >= 2 ? app.api.read('GET /v1/players', { q }) : [];
  const sugg = app.api.read('GET /v1/me/player-suggestions');
  const req = app.api.read('GET /v1/me/follow-requests');
  const me = app.me()!;
  return html`${pageHeader('Players', { subtitle: 'Find friends and players you meet on court. Search by display name or username.', actions: html`${btn(`Follow requests${req.incoming.length ? ` (${req.incoming.length})` : ''}`, { href: '#/app/follow-requests', variant: 'secondary', icon: 'userPlus' })}${me.profile?.username ? btn('My public profile', { href: `#/app/players/${me.profile.username}`, variant: 'ghost', icon: 'eye' }) : ''}` })}
  <div class="split"><div class="stack">
    ${card(html`<form class="row" data-form="pl.search" role="search"><div style="flex:1"><label class="sr-only" for="plq">Search players</label><input id="plq" name="q" type="search" value="${q}" placeholder="Name or @username" autocomplete="off"/></div>${btn('Search', { type: 'submit', variant: 'primary', icon: 'search' })}</form>
    ${q.length >= 2 ? (results.length ? html`<div class="stack-sm" style="margin-top:12px">${results.map((c) => playerCard(c))}</div>` : html`<p class="muted small" style="margin-top:12px">No players found. Some players choose not to appear in search.</p>`) : html`<p class="xs muted" style="margin-top:8px">${icon('shield', 12)} Search never matches emails or phone numbers, and players can turn off discovery in their privacy settings.</p>`}`, { title: 'Search' })}
  </div><div class="stack">
    ${card(sugg.length ? html`<div class="stack-sm">${sugg.map((c) => playerCard(c))}</div>` : html`<p class="small muted">Join Open Play to meet players — suggestions appear here.</p>`, { title: 'People you may know', subtitle: 'From Open Play and events you joined' })}
  </div></div>`;
}, { auth: true });
form('pl.search', (fd) => app.set('plQ', str(fd, 'q')));

action('soc.follow', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /v1/me/follows/{username}', { username: el.dataset.u! }));
  if (r) app.toast(r.status === 'pending' ? 'Follow request sent' : 'Following', 'success');
});
action('soc.unfollow', async (el) => {
  await app.run(el, () => app.api.write('DELETE /v1/me/follows/{username}', { username: el.dataset.u! }), { success: 'Unfollowed' });
});

// ---------------------------------------------------------------- public profile

export function publicProfileView(ctx: ViewCtx, inApp: boolean): SafeHtml {
  const p = app.api.read('GET /v1/players/{username}', { username: ctx.params.username! });
  const base = inApp ? '#/app/players' : '#/players';
  const rel = p.relationship;
  const followBtn = p.me
    ? btn('Edit profile', { href: '#/app/profile', variant: 'secondary', icon: 'settings' })
    : !ctx.me
      ? btn('Sign in to follow', { href: `#/login?next=${encodeURIComponent(`/app/players/${p.username}`)}`, variant: 'primary' })
      : rel.following === 'accepted'
        ? btn('Following', { action: 'soc.unfollow', data: { u: p.username! }, variant: 'secondary', icon: 'userCheck' })
        : rel.following === 'pending'
          ? btn('Requested — cancel', { action: 'soc.unfollow', data: { u: p.username! }, variant: 'secondary' })
          : p.canFollow
            ? btn(p.requiresApproval ? 'Request to follow' : rel.followsYou ? 'Follow back' : 'Follow', { action: 'soc.follow', data: { u: p.username! }, variant: 'primary', icon: 'userPlus' })
            : tag('Not accepting followers');
  return html`<div class="profile-hero card"><div class="card-body row" style="gap:18px;align-items:center;flex-wrap:wrap">${avatar(p.displayName, p.avatarHue, 76)}
    <div style="flex:1;min-width:200px"><h1 style="margin:0">${p.displayName}</h1><div class="muted">@${p.username}${rel.followsYou ? html` · ${tag('Follows you', 'info')}` : ''}${p.city ? ` · ${p.city}` : ''}</div>${p.bio ? html`<p style="margin:8px 0 0">${p.bio}</p>` : ''}
    <div class="row small" style="margin-top:8px;gap:14px">${p.counts.followers !== null ? html`<a href="${base}/${p.username}/followers"><b>${p.counts.followers}</b> followers</a>` : ''}${p.counts.following !== null ? html`<a href="${base}/${p.username}/following"><b>${p.counts.following}</b> following</a>` : ''}${p.memberSince ? html`<span class="muted">Member since ${p.memberSince}</span>` : ''}</div></div>
    <div class="row">${followBtn}${!p.me && ctx.me ? html`${btn('', { action: 'soc.report', data: { u: p.username! }, variant: 'ghost', icon: 'flag', title: 'Report profile' })}${btn('', { action: 'soc.block', data: { u: p.username! }, variant: 'ghost', icon: 'ban', title: 'Block' })}` : ''}</div></div></div>
  ${p.limited ? alertBox('info', 'This profile is private', p.requiresApproval ? 'Follow requests need approval. Once accepted you can see their sports and activity.' : 'Only some details are shared publicly.') : ''}
  <h2 style="margin-top:18px">Sports</h2>
  ${p.sports.length ? html`<div class="grid g4">${p.sports.map((s) => html`<div class="card sport-mini" style="--sport-hue:${sportsCatalog().find((x) => x.code === s.sport)?.hue ?? 150}"><div class="card-body"><div class="row"><span class="sport-ic">${icon(s.icon, 20)}</span><b>${s.name}</b></div><div class="sport-stats" style="margin-top:8px"><div><b>${s.sessions}</b><span>sessions</span></div><div><b>${s.games}</b><span>games</span></div></div>${s.skillLabel ? html`<div class="xs muted" style="margin-top:6px">${s.skillLabel}</div>` : ''}${s.lastPlayedAt ? html`<div class="xs muted">Last played ${formatRelative(s.lastPlayedAt, app.store.now())}</div>` : ''}</div></div>`)}</div>` : html`<p class="muted small">${p.limited ? 'Hidden by privacy settings.' : 'No sports to show yet.'}</p>`}
  <p class="xs muted" style="margin-top:14px">${icon('shield', 12)} Profiles never show contact details, payment information, venue restrictions or check-in records.</p>`;
}

route('/app/players/:username', 'player', 'Player', (ctx) => publicProfileView(ctx, true), { auth: true });
route('/players/:username', 'public', 'Player', (ctx) => html`<div class="container section-sm">${publicProfileView(ctx, false)}</div>`);

function followListView(ctx: ViewCtx, kind: 'followers' | 'following'): SafeHtml {
  const list = app.api.read('GET /v1/players/{username}/{kind}', { username: ctx.params.username!, kind });
  return html`${pageHeader(kind === 'followers' ? 'Followers' : 'Following', { back: `#/app/players/${ctx.params.username}`, subtitle: `@${ctx.params.username}` })}${list.length ? html`<div class="grid g2">${list.map((c) => playerCard(c))}</div>` : empty(kind === 'followers' ? 'No followers yet' : 'Not following anyone yet', undefined, undefined, 'users')}`;
}
route('/app/players/:username/followers', 'player', 'Followers', (ctx) => followListView(ctx, 'followers'), { auth: true });
route('/app/players/:username/following', 'player', 'Following', (ctx) => followListView(ctx, 'following'), { auth: true });
route('/players/:username/followers', 'public', 'Followers', (ctx) => html`<div class="container section-sm">${followListView(ctx, 'followers')}</div>`);
route('/players/:username/following', 'public', 'Following', (ctx) => html`<div class="container section-sm">${followListView(ctx, 'following')}</div>`);

action('soc.block', async (el) => {
  const ok = await app.confirm({ title: `Block @${el.dataset.u}?`, body: 'You will stop following each other, they can’t follow you or find your profile, and you won’t see each other in search or suggestions. They are not notified. Blocking does not cancel any bookings or Open Play registrations.', confirmLabel: 'Block', danger: true });
  if (!ok) return;
  await app.run(el, () => app.api.write('POST /v1/me/blocks/{username}', { username: el.dataset.u! }), { success: 'Blocked' });
  app.navigate('#/app/players');
});
action('soc.report', (el) => {
  app.modal({
    title: `Report @${el.dataset.u}`,
    body: html`<form class="stack-sm" data-form="soc.report" data-u="${el.dataset.u}">${select({ name: 'reason', label: 'Reason', options: [{ value: 'Harassment or bullying', label: 'Harassment or bullying' }, { value: 'Impersonation', label: 'Impersonation' }, { value: 'Inappropriate profile content', label: 'Inappropriate profile content' }, { value: 'Spam', label: 'Spam' }, { value: 'Other', label: 'Other' }] })}${textarea({ name: 'details', label: 'Details (optional)', maxlength: 600 })}<p class="xs muted">Trust & Safety reviews every report. The player is not told who reported them.</p><div class="row" style="justify-content:flex-end">${btn('Cancel', { action: 'modal.close', variant: 'ghost' })}${btn('Send report', { type: 'submit', variant: 'primary' })}</div></form>`,
  });
});
form('soc.report', async (fd, f) => {
  await app.api.write('POST /v1/me/reports', { targetType: 'profile', targetId: f.dataset.u!, reason: str(fd, 'reason'), details: str(fd, 'details') });
  app.closeModal();
  app.toast('Thanks — the report was sent to Trust & Safety.', 'success');
});

// ---------------------------------------------------------------- follow requests

route('/app/follow-requests', 'player', 'Follow requests', () => {
  const r = app.api.read('GET /v1/me/follow-requests');
  return html`${pageHeader('Follow requests', { back: '#/app/players' })}<div class="split"><div>${card(r.incoming.length ? html`<div class="stack-sm">${r.incoming.map((x) => html`<div class="row-between"><a class="row" href="#/app/players/${x.from.username}" style="text-decoration:none;color:inherit">${avatar(x.from.displayName, x.from.avatarHue, 36)}<div><b>${x.from.displayName}</b><div class="xs muted">@${x.from.username} · ${formatRelative(x.createdAt, app.store.now())}</div></div></a><div class="row">${btn('Decline', { action: 'fr.respond', data: { id: x.id, ok: '' }, variant: 'ghost', size: 'sm' })}${btn('Accept', { action: 'fr.respond', data: { id: x.id, ok: '1' }, variant: 'primary', size: 'sm' })}</div></div>`)}</div>` : empty('No pending requests', undefined, undefined, 'userPlus'), { title: 'Waiting for you' })}</div>
  <div>${card(r.outgoing.length ? html`<div class="stack-sm">${r.outgoing.map((x) => html`<div class="row-between"><span class="row">${avatar(x.to.displayName, x.to.avatarHue, 32)}<b>${x.to.displayName}</b></span>${x.to.username ? btn('Cancel', { action: 'soc.unfollow', data: { u: x.to.username }, variant: 'ghost', size: 'sm' }) : ''}</div>`)}</div>` : html`<p class="small muted">None.</p>`, { title: 'You requested' })}</div></div>`;
}, { auth: true });
action('fr.respond', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/me/follow-requests/{followId}/response', { followId: el.dataset.id!, accept: !!el.dataset.ok }), { success: el.dataset.ok ? 'Request accepted' : 'Request declined' });
});

// ---------------------------------------------------------------- social privacy settings (rendered inside Settings)

export function socialSettingsPanel(): SafeHtml {
  const me = app.me()!;
  const p = me.profile!;
  const blocks = app.api.read('GET /v1/me/blocks');
  const t = (k: keyof typeof p.social, label: string, hint: string) => html`<button type="button" class="switch${p.social[k] ? ' on' : ''}" role="switch" aria-checked="${p.social[k] ? 'true' : 'false'}" data-action="soc.setting" data-k="${k}" data-on="${p.social[k] ? '' : '1'}"><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">${label}<span class="hint block">${hint}</span></span></button>`;
  return html`<div class="split"><div class="stack">
    ${card(html`<form class="row" data-form="soc.username" style="align-items:flex-end"><div style="flex:1">${field({ name: 'username', label: 'Username', value: p.username ?? '', hint: '3–20 letters, numbers, dots or underscores. You can change it once every 30 days. Never use your phone number or email.' })}</div>${btn('Save', { type: 'submit', variant: 'secondary' })}</form>`, { title: 'Your handle' })}
    ${card(html`<div class="stack-sm">${t('discoverable', 'Show me in player search & suggestions', 'Off = people can still open your profile from a link or a shared session.')}${t('allowFollows', 'Allow people to follow me', 'Existing followers stay until you remove them.')}${t('requireApproval', 'Approve follow requests', 'New followers need your OK (pending → accepted / declined).')}${t('showFollowers', 'Show my followers list', '')}${t('showFollowing', 'Show who I follow', '')}${t('showSports', 'Show my sports on my profile', 'Also controlled by “Who can see my activity” in Profile.')}</div>`, { title: 'Social privacy' })}
  </div><div class="stack">
    ${card(blocks.length ? html`<div class="stack-sm">${blocks.map((b) => html`<div class="row-between"><span><b>${b.displayName}</b>${b.username ? html` <span class="xs muted">@${b.username}</span>` : ''}<div class="xs muted">Blocked ${formatDateShort(b.since)}</div></span>${b.username ? btn('Unblock', { action: 'soc.unblock', data: { u: b.username }, variant: 'ghost', size: 'sm' }) : ''}</div>`)}</div>` : html`<p class="small muted">You haven't blocked anyone.</p>`, { title: 'Blocked players', subtitle: 'Blocked players can’t follow you or find you, and aren’t told they were blocked.' })}
  </div></div>`;
}
action('soc.setting', async (el) => {
  await app.run(el, () => app.api.write('PATCH /v1/me/social-settings', { [el.dataset.k!]: !!el.dataset.on } as never, { silent: true }));
});
form('soc.username', async (fd) => {
  await app.api.write('PATCH /v1/me/social-settings', { username: str(fd, 'username') });
  app.toast('Username updated', 'success');
});
action('soc.unblock', async (el) => {
  await app.run(el, () => app.api.write('DELETE /v1/me/blocks/{username}', { username: el.dataset.u! }), { success: 'Unblocked' });
});
