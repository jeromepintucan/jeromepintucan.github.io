/** Business Open Play: session list, create/edit/publish/cancel, and the live desk (attendance, court board, rotation, log). */

import { formatPHP, parsePesoInput } from '../../domain/money.ts';
import { POLICY_LIBRARY } from '../../domain/policy.ts';
import { OPEN_PLAY_STYLE_LABEL, REGISTRATION_MODE_LABEL, ROTATION_LABEL, type OpenPlayStyle, type RotationStrategy } from '../../domain/sports.ts';
import { addDays, formatDateLong, formatDateShort, formatDateTime, formatTime, formatTimeRange, HOUR, localDate, localToInstant, MINUTE } from '../../domain/time.ts';
import type { ReadResult } from '../../services/api.ts';
import { action, app, form, onChange, str } from '../app.ts';
import { avatar } from '../art.ts';
import { alertBox, btn, card, checkbox, empty, field, pageHeader, pill, select, tabs, tag, textarea } from '../components.ts';
import { cls, html, type SafeHtml } from '../html.ts';
import { icon } from '../icons.ts';
import { bizRoute } from './business.ts';
import { attendancePill } from './openplay.ts';
import { sportName, sportPicker, sportsCatalog, sportTag } from './shared.ts';

type Desk = ReadResult<'GET /v1/businesses/{businessId}/open-play/{sessionId}/desk'>;

// ---------------------------------------------------------------- list

bizRoute('/biz/open-play', 'Open Play', (_ctx, b) => {
  const list = app.api.read('GET /v1/businesses/{businessId}/open-play', { businessId: b.businessId, venueId: b.venueId });
  const canManage = b.perms.has('openplay.manage');
  const now = app.store.now();
  const live = list.filter((x) => x.session.status === 'in_progress' || x.live);
  const upcoming = list.filter((x) => !live.includes(x) && x.session.endMs > now && x.session.status !== 'cancelled');
  const past = list.filter((x) => !live.includes(x) && !upcoming.includes(x));
  const row = (x: (typeof list)[number]) => html`<div class="card op-row"><div class="card-body row" style="gap:14px;align-items:center;flex-wrap:wrap">
    <div style="flex:1;min-width:240px"><div class="row" style="gap:6px">${sportTag(x.session.sport, { small: true })}${pill(x.session.status)}${x.live ? html`<span class="pill pill-danger">${icon('live', 12)} Live</span>` : ''}</div><b style="display:block;margin-top:4px">${x.session.title}</b><div class="small muted">${formatDateShort(x.session.startMs)} · ${formatTimeRange(x.session.startMs, x.session.endMs)} · ${x.courts.join(', ')}</div><div class="xs muted">${x.formatLabel} · ${x.priceLabel} · ${x.levelLabel}</div></div>
    <div class="op-mini-counts"><div><b>${x.registered}</b><span>registered</span></div><div><b>${x.checkedIn}</b><span>here</span></div><div><b>${x.playing}</b><span>playing</span></div><div><b>${x.remaining}</b><span>left</span></div></div>
    <div class="row">${x.session.status !== 'draft' ? btn(x.live ? 'Open live desk' : 'Open desk', { href: `#/biz/open-play/${x.session.id}`, variant: x.live ? 'primary' : 'secondary', icon: 'live' }) : ''}${canManage && x.session.status === 'draft' ? html`${btn('Edit', { href: `#/biz/open-play/edit/${x.session.id}`, variant: 'ghost' })}${btn('Publish', { action: 'opb.publish', data: { id: x.session.id }, variant: 'primary' })}` : ''}${canManage ? btn('Duplicate +7d', { action: 'opb.duplicate', data: { id: x.session.id }, variant: 'ghost', size: 'sm' }) : ''}</div></div></div>`;
  return html`${pageHeader('Open Play', { subtitle: 'Drop-in sessions where players register for a spot instead of booking a whole court.', actions: canManage ? btn('New session', { href: '#/biz/open-play/new', variant: 'primary', icon: 'plus' }) : '' })}
  ${live.length ? html`<h2 class="section-title">${icon('live', 18)} Live now</h2><div class="stack-sm">${live.map(row)}</div>` : ''}
  <h2 class="section-title">Upcoming</h2>${upcoming.length ? html`<div class="stack-sm">${upcoming.map(row)}</div>` : empty('No upcoming sessions', canManage ? 'Create your first Open Play session.' : undefined, canManage ? btn('New session', { href: '#/biz/open-play/new', variant: 'primary' }) : undefined, 'users')}
  ${past.length ? html`<h2 class="section-title">Past & cancelled</h2><div class="stack-sm">${past.slice(0, 8).map(row)}</div>` : ''}`;
});
action('opb.publish', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/publish', { businessId: app.businessId!, sessionId: el.dataset.id! }), { success: 'Published — courts reserved on the calendar.' });
  if (r && location.hash.includes('/edit/')) app.navigate('#/biz/open-play');
});
action('opb.duplicate', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/duplicate', { businessId: app.businessId!, sessionId: el.dataset.id!, days: 7 }), { success: 'Draft copy created for next week' });
  if (r) app.navigate(`#/biz/open-play/edit/${r.id}`);
});

// ---------------------------------------------------------------- create / edit

const localInput = (ms: number) => new Date(ms + 8 * HOUR).toISOString().slice(0, 16);
const parseLocal = (v: string) => {
  const [d, t = '00:00'] = v.split('T');
  const [h, m] = t.split(':').map(Number);
  return localToInstant(d!, h! * 60 + m!);
};

function editor(b: { businessId: string; venueId: string; perms: Set<string> }, sessionId: string | null): SafeHtml {
  const venues = app.api.read('GET /v1/businesses/{businessId}/venues', { businessId: b.businessId });
  const v = venues.find((x) => x.venue.id === b.venueId);
  if (!v) return empty('No venue selected');
  const existing = sessionId ? app.api.read('GET /v1/businesses/{businessId}/open-play', { businessId: b.businessId }).find((x) => x.session.id === sessionId)?.session : undefined;
  const venueSports = v.venue.sports?.length ? v.venue.sports : ['pickleball'];
  const sport = app.state<string>(`opdSport:${sessionId ?? 'new'}`, existing?.sport ?? venueSports[0]!);
  const cat = sportsCatalog().find((x) => x.code === sport)!;
  const formats = cat.formats.filter((f) => f.appliesTo.includes('open_play'));
  const courts = v.courts.filter((c) => c.status === 'active' && (c.sport ?? 'pickleball') === sport);
  let members: { member: { id: string; status: string }; name: string }[] = [];
  try {
    members = app.api.read('GET /v1/businesses/{businessId}/members', { businessId: b.businessId }).members;
  } catch {
    members = [];
  }
  const start = existing?.startMs ?? localToInstant(addDays(localDate(app.store.now()), 2), 18 * 60);
  const end = existing?.endMs ?? start + 3 * HOUR;
  const published = !!existing && existing.status !== 'draft';
  const fmt = existing?.formatCode ?? formats[0]?.code ?? '';
  const modes = existing?.registrationModes ?? cat.openPlay.registrationModes.slice(0, 1);
  return html`<form data-form="opb.save" data-id="${sessionId ?? ''}" data-sport="${sport}" class="stack">
    ${published ? alertBox('info', 'This session is published', 'You can update the description, instructions, equipment, staff, rotation, walk-ins, waitlist and increase capacity. To change the time, courts, sport or price, cancel and create a new session (players are refunded in full).') : ''}
    ${card(html`<p class="label" style="margin-bottom:6px">Sport</p>${published ? sportTag(sport) : sportPicker(sport, 'opd.sport', { all: false, only: venueSports, data: { key: sessionId ?? 'new' } })}<p class="xs muted" style="margin-top:6px">Formats, levels and courts below come from the ${cat.name} configuration in the CourtKo sport catalog.</p>`, { title: '1 · Sport' })}
    ${card(html`<div class="form-grid">${field({ name: 'title', label: 'Session title', value: existing?.title ?? `${cat.name} Open Play`, required: true })}${field({ name: 'organizer', label: 'Session organizer', value: existing?.organizer ?? v.venue.name })}<div class="full">${textarea({ name: 'description', label: 'Description', value: existing?.description ?? '', rows: 3 })}</div>
      ${select({ name: 'formatCode', label: 'Game format', value: fmt, options: formats.map((f) => ({ value: f.code, label: f.label })) })}${select({ name: 'style', label: 'Style', value: existing?.style ?? 'recreational', options: cat.openPlay.styles.map((s) => ({ value: s, label: OPEN_PLAY_STYLE_LABEL[s as OpenPlayStyle] })) })}
      ${field({ name: 'customFormatLabel', label: 'Custom format name (for “Custom”)', value: existing?.customFormatLabel ?? '', placeholder: 'e.g. King of the court' })}${field({ name: 'teamSize', label: 'Team size (team formats)', type: 'number', value: existing?.teamSize ?? formats.find((f) => f.code === fmt)?.teamSize?.default ?? 2, min: 1, max: 12 })}
      <div class="full"><span class="label">Skill levels (leave empty for all levels)</span><div class="chips" style="margin-top:6px">${cat.skillLevels.map((l) => html`<label class="chip"><input type="checkbox" name="skillLevels" value="${l.code}"${existing?.skillLevels.includes(l.code) ? html` checked` : ''}/> ${l.label}</label>`)}</div></div>
      <div class="full">${field({ name: 'eligibility', label: 'Player eligibility', value: existing?.eligibility ?? 'Open to all registered players.' })}</div></div>`, { title: '2 · Format & players' })}
    ${card(html`<div class="form-grid">${field({ name: 'start', label: 'Starts', type: 'datetime-local', value: localInput(start), step: 900 })}${field({ name: 'end', label: 'Ends', type: 'datetime-local', value: localInput(end), step: 900 })}
      ${field({ name: 'regOpens', label: 'Registration opens', type: 'datetime-local', value: localInput(existing?.registrationOpensAt ?? app.store.now()), step: 900 })}${field({ name: 'regCloses', label: 'Registration closes', type: 'datetime-local', value: localInput(existing?.registrationClosesAt ?? start - HOUR), step: 900 })}
      ${select({ name: 'checkInBefore', label: 'Check-in opens', value: String(existing ? Math.round((existing.startMs - existing.checkInOpensAt) / MINUTE) : 30), options: [15, 30, 45, 60, 90].map((n) => ({ value: String(n), label: `${n} min before start` })) })}${select({ name: 'lateAfter', label: 'Late-arrival cutoff', value: String(existing ? Math.round((existing.lateCutoffAt - existing.startMs) / MINUTE) : 45), options: [0, 15, 30, 45, 60, 90].map((n) => ({ value: String(n), label: n ? `${n} min after start` : 'At the start' })) })}
      <div class="full"><span class="label">Courts</span><div class="chips" style="margin-top:6px">${courts.map((c) => html`<label class="chip"><input type="checkbox" name="courtIds" value="${c.id}"${existing?.courtIds.includes(c.id) ? html` checked` : ''}/> ${c.name}</label>`)}</div>${courts.length ? html`<p class="hint">Courts are reserved on the calendar when you publish (dependent layouts on the same floor are blocked too).</p>` : html`<p class="hint">No ${cat.name.toLowerCase()} courts at this venue yet — add one in Courts & layouts.</p>`}</div></div>`, { title: '3 · When & where' })}
    ${card(html`<div class="form-grid">${field({ name: 'capacity', label: 'Maximum capacity', type: 'number', value: existing?.capacity ?? cat.openPlay.defaultCapacity, min: 2, max: 200 })}${select({ name: 'capacityUnit', label: 'Capacity counts', value: existing?.capacityUnit ?? 'player', options: [{ value: 'player', label: 'Players' }, { value: 'team', label: 'Teams' }] })}${field({ name: 'minParticipants', label: 'Minimum participants', type: 'number', value: existing?.minParticipants ?? 4, min: 1, max: 200 })}
      <div class="full"><span class="label">Registration types</span><div class="chips" style="margin-top:6px">${cat.openPlay.registrationModes.map((m) => html`<label class="chip"><input type="checkbox" name="modes" value="${m}"${modes.includes(m) ? html` checked` : ''}/> ${REGISTRATION_MODE_LABEL[m]}</label>`)}</div><p class="hint">The server checks these against the format (e.g. partner registration needs a doubles format).</p></div>
      ${select({ name: 'pricing', label: 'Price', value: existing?.pricing ?? 'per_player', options: [{ value: 'free', label: 'Free' }, { value: 'per_player', label: 'Per player' }, { value: 'per_team', label: 'Per team' }] })}${field({ name: 'price', label: 'Amount (₱)', value: existing ? String(existing.price / 100) : '250', inputmode: 'decimal' })}
      ${select({ name: 'partnerFallback', label: 'If an invited partner declines', value: existing?.partnerFallback ?? 'keep_solo', options: [{ value: 'keep_solo', label: 'Keep the player registered (needs partner)' }, { value: 'cancel_both', label: 'Cancel and refund in full' }] })}${select({ name: 'policyKey', label: 'Cancellation & refund policy', value: existing?.policyKey ?? 'standard', options: (Object.keys(POLICY_LIBRARY) as (keyof typeof POLICY_LIBRARY)[]).map((k) => ({ value: k, label: POLICY_LIBRARY[k].name })) })}
      <div class="full">${field({ name: 'refundNote', label: 'Refund note shown to players', value: existing?.refundNote ?? '' })}</div><div class="full">${field({ name: 'noShowPolicy', label: 'No-show policy', value: existing?.noShowPolicy ?? 'No-shows after the late-arrival cutoff are not refunded and are recorded on your venue history.' })}</div>
      <div class="full row">${checkbox({ name: 'waitlist', label: 'Waitlist when full', checked: existing?.waitlistEnabled ?? true })}${checkbox({ name: 'walkIns', label: 'Allow walk-ins', checked: existing?.walkInsAllowed ?? true })}${checkbox({ name: 'equipment', label: 'Equipment included', checked: existing?.equipmentIncluded ?? false })}</div>
      <div class="full">${field({ name: 'equipmentNote', label: 'Equipment note', value: existing?.equipmentNote ?? '', placeholder: 'Paddles and balls provided' })}</div></div>`, { title: '4 · Registration & price' })}
    ${card(html`<div class="form-grid">${select({ name: 'rotation', label: 'Rotation (staff confirm every assignment)', value: existing?.rotation ?? 'first_waiting', options: cat.openPlay.rotationStrategies.map((r) => ({ value: r, label: ROTATION_LABEL[r as RotationStrategy] })) })}${field({ name: 'gameMinutes', label: 'Game length (minutes)', type: 'number', value: existing?.gameMinutes ?? cat.openPlay.defaultGameMinutes, min: 5, max: 120 })}
      <div class="full row">${checkbox({ name: 'scoreRecording', label: 'Record scores', checked: existing?.scoreRecording ?? false })}${checkbox({ name: 'autoQueue', label: 'Add players to the waiting rotation when they check in', checked: existing?.autoQueueOnCheckIn ?? true })}</div>
      <div class="full"><span class="label">Assigned staff</span><div class="chips" style="margin-top:6px">${members.filter((m) => m.member.status === 'active').map((m) => html`<label class="chip"><input type="checkbox" name="staff" value="${m.member.id}"${existing?.staffMemberIds.includes(m.member.id) ? html` checked` : ''}/> ${m.name}</label>`)}</div></div>
      <div class="full">${textarea({ name: 'instructions', label: 'Special instructions', value: existing?.instructions ?? 'Check in at the front desk with your Open Play pass.', rows: 2 })}</div>${select({ name: 'visibility', label: 'Visibility', value: existing?.visibility ?? 'public', options: [{ value: 'public', label: 'Public (listed)' }, { value: 'unlisted', label: 'Unlisted (link only)' }] })}</div>`, { title: '5 · Running the session' })}
    <div class="row" style="justify-content:flex-end">${btn('Cancel', { href: '#/biz/open-play', variant: 'ghost' })}${btn(published ? 'Save changes' : 'Save draft', { type: 'submit', variant: 'primary', icon: 'check' })}${existing && existing.status === 'draft' ? btn('Publish', { action: 'opb.publish', data: { id: existing.id }, variant: 'accent' }) : ''}</div>
  </form>`;
}

bizRoute('/biz/open-play/new', 'New Open Play session', (_ctx, b) => {
  if (!b.perms.has('openplay.manage')) return alertBox('warning', 'You need the “Manage Open Play” permission to create sessions.');
  return html`${pageHeader('New Open Play session', { back: '#/biz/open-play' })}${editor(b, null)}`;
});
bizRoute('/biz/open-play/edit/:id', 'Edit Open Play session', (ctx, b) => html`${pageHeader('Edit Open Play session', { back: '#/biz/open-play' })}${editor(b, ctx.params.id!)}`);

action('opd.sport', (el) => app.set(`opdSport:${el.dataset.key}`, el.dataset.sport));
form('opb.save', async (fd, f) => {
  const start = parseLocal(str(fd, 'start'));
  const price = str(fd, 'pricing') === 'free' ? 0 : parsePesoInput(str(fd, 'price')) ?? 0;
  const r = await app.api.write('PUT /v1/businesses/{businessId}/open-play', {
    businessId: app.businessId!,
    ...(f.dataset.id ? { sessionId: f.dataset.id } : {}),
    venueId: app.venueId!,
    sport: f.dataset.sport!,
    title: str(fd, 'title'),
    description: str(fd, 'description'),
    courtIds: fd.getAll('courtIds').map(String),
    startMs: start,
    endMs: parseLocal(str(fd, 'end')),
    registrationOpensAt: parseLocal(str(fd, 'regOpens')),
    registrationClosesAt: parseLocal(str(fd, 'regCloses')),
    checkInOpensAt: start - Number(str(fd, 'checkInBefore')) * MINUTE,
    lateCutoffAt: start + Number(str(fd, 'lateAfter')) * MINUTE,
    minParticipants: Number(str(fd, 'minParticipants')),
    capacity: Number(str(fd, 'capacity')),
    capacityUnit: str(fd, 'capacityUnit') as never,
    formatCode: str(fd, 'formatCode'),
    style: str(fd, 'style') as never,
    customFormatLabel: str(fd, 'customFormatLabel'),
    skillLevels: fd.getAll('skillLevels').map(String),
    eligibility: str(fd, 'eligibility'),
    pricing: str(fd, 'pricing') as never,
    price,
    registrationModes: fd.getAll('modes').map(String) as never,
    teamSize: Number(str(fd, 'teamSize')),
    walkInsAllowed: fd.get('walkIns') === 'on',
    waitlistEnabled: fd.get('waitlist') === 'on',
    equipmentIncluded: fd.get('equipment') === 'on',
    equipmentNote: str(fd, 'equipmentNote'),
    policyKey: str(fd, 'policyKey') as never,
    refundNote: str(fd, 'refundNote'),
    noShowPolicy: str(fd, 'noShowPolicy'),
    partnerFallback: str(fd, 'partnerFallback') as never,
    instructions: str(fd, 'instructions'),
    organizer: str(fd, 'organizer'),
    staffMemberIds: fd.getAll('staff').map(String),
    rotation: str(fd, 'rotation') as never,
    autoQueueOnCheckIn: fd.get('autoQueue') === 'on',
    scoreRecording: fd.get('scoreRecording') === 'on',
    gameMinutes: Number(str(fd, 'gameMinutes')),
    visibility: str(fd, 'visibility') as never,
  });
  app.toast(r.status === 'draft' ? 'Draft saved — publish it when you are ready.' : 'Session updated', 'success');
  app.navigate(r.status === 'draft' ? `#/biz/open-play/edit/${r.id}` : `#/biz/open-play/${r.id}`);
});

// ---------------------------------------------------------------- live desk

const COUNT_LABELS: [keyof Desk['counts'], string, string][] = [
  ['capacity', 'Capacity', 'neutral'],
  ['registered', 'Registered', 'neutral'],
  ['waitlisted', 'Waitlisted', 'event'],
  ['eligible', 'Eligible for check-in', 'info'],
  ['checkedIn', 'Checked in', 'info'],
  ['waiting', 'Waiting to play', 'warning'],
  ['onCourt', 'On court', 'success'],
  ['tempOff', 'Temporarily off', 'neutral'],
  ['checkedOut', 'Checked out', 'neutral'],
  ['completed', 'Completed', 'neutral'],
  ['cancelled', 'Cancelled', 'neutral'],
  ['noShow', 'No-show', 'danger'],
  ['rejected', 'Check-in rejected', 'danger'],
  ['adjusted', 'Manually adjusted', 'warning'],
  ['remaining', 'Remaining capacity', 'success'],
];

bizRoute('/biz/open-play/:id', 'Open Play desk', (ctx, b) => {
  const d = app.api.read('GET /v1/businesses/{businessId}/open-play/{sessionId}/desk', { businessId: b.businessId, sessionId: ctx.params.id! });
  const o = d.session;
  const tab = app.state<string>(`deskTab:${o.id}`, 'desk');
  const lastScan = app.ui[`lastScan:${o.id}`] as { ok: boolean; text: string; at: number } | undefined;
  const can = d.perms;
  return html`${pageHeader(o.title, { back: '#/biz/open-play', eyebrow: `Open Play · ${d.sportName}`, subtitle: html`${formatDateLong(o.startMs)} · ${formatTimeRange(o.startMs, o.endMs)} · ${d.courts.join(', ')} · ${d.formatLabel} · ${d.rotationLabel}`, actions: html`${pill(o.status)}<span class="last-updated">${icon('live', 14)} Last update ${formatTime(d.lastUpdatedAt)}</span>${can.manage && o.status !== 'cancelled' && o.status !== 'completed' ? btn('Edit', { href: `#/biz/open-play/edit/${o.id}`, variant: 'ghost', size: 'sm' }) : ''}${can.manage && ['published', 'in_progress', 'draft'].includes(o.status) ? btn('Cancel session', { action: 'opb.cancel', data: { id: o.id }, variant: 'ghost', size: 'sm' }) : ''}` })}
  <div class="desk-counts">${COUNT_LABELS.map(([k, label, tone]) => html`<div class="dc dc-${tone}"><b>${d.counts[k]}</b><span>${label}</span></div>`)}</div>
  ${tabs([{ key: 'desk', label: 'Live desk' }, { key: 'players', label: 'Players', count: d.players.length }, { key: 'log', label: 'Attendance log' }], tab, 'desk.tab')}
  ${tab === 'desk' ? deskTab(d, lastScan) : ''}
  ${tab === 'players' ? playersTab(d) : ''}
  ${tab === 'log' ? logTab(d) : ''}`;
});
action('desk.tab', (el) => {
  const id = location.hash.split('/').pop()!.split('?')[0];
  app.set(`deskTab:${id}`, el.dataset.key);
});

function deskTab(d: Desk, lastScan: { ok: boolean; text: string; at: number } | undefined): SafeHtml {
  const o = d.session;
  const can = d.perms;
  const now = app.store.now();
  const q = app.state<string>(`deskQ:${o.id}`, '');
  const results = can.checkIn && q.length >= 2 ? app.api.read('GET /v1/businesses/{businessId}/open-play/{sessionId}/search', { businessId: app.businessId!, sessionId: o.id, q }) : [];
  const notArrived = d.players.filter((p) => p.attendance === 'not_arrived');
  const tempOff = d.players.filter((p) => p.attendance === 'temp_off');
  const checkedOnly = d.players.filter((p) => p.attendance === 'checked_in');
  return html`<div class="desk"><div class="stack">
    ${can.checkIn ? card(html`<div class="checkin-window ${d.checkInWindow.open ? 'open' : ''}">${icon('clock', 14)} Check-in ${d.checkInWindow.open ? 'open' : now < d.checkInWindow.opensAt ? `opens ${formatTime(d.checkInWindow.opensAt)}` : 'closed'} · late-arrival cutoff ${formatTime(d.checkInWindow.lateCutoffAt)}</div>
      <form class="row" data-form="desk.scan" data-id="${o.id}" style="align-items:flex-end;margin-top:10px"><div style="flex:1">${field({ name: 'token', label: 'Scan or paste the player’s Open Play pass', placeholder: 'OP1.… or REG1.…', autocomplete: 'off' })}</div>${btn('Check in', { type: 'submit', variant: 'primary', icon: 'scan' })}</form>
      ${lastScan ? html`<div class="scan-result ${lastScan.ok ? 'ok' : 'bad'}" role="status">${icon(lastScan.ok ? 'checkCircle' : 'alert', 18)}<span>${lastScan.text}</span><span class="xs muted">${formatTime(lastScan.at)}</span></div>` : ''}
      <div class="demo-pass"><span class="xs muted">${icon('info', 12)} Demo: camera scanning isn't available here. Load a sample pass to scan —</span>${['valid', 'duplicate', 'expired', 'wrong_session', 'tampered'].map((k) => btn(k.replace('_', ' '), { action: 'desk.sample', data: { id: o.id, kind: k }, variant: 'ghost', size: 'sm' }))}</div>
      <hr/>
      <form class="row" data-form="desk.search" data-id="${o.id}" style="align-items:flex-end"><div style="flex:1">${field({ name: 'q', label: 'Find a registered player', value: q, placeholder: 'Name or @username (this session only)' })}</div>${btn('Search', { type: 'submit', variant: 'secondary', icon: 'search' })}</form>
      ${results.length ? html`<div class="stack-sm" style="margin-top:8px">${results.map((r) => html`<div class="row-between"><span><b>${r.name}</b>${r.username ? html` <span class="xs muted">@${r.username}</span>` : ''}</span><span class="row">${attendancePill(r.attendance)}${r.attendance === 'not_arrived' ? btn('Check in', { action: 'desk.checkin', data: { session: o.id, reg: r.registrationId, method: 'search' }, variant: 'primary', size: 'sm' }) : ''}</span></div>`)}</div>` : q.length >= 2 ? html`<p class="xs muted">No registered player matches.</p>` : ''}
      <div class="row" style="margin-top:10px;gap:8px">${btn('Manual check-in…', { action: 'desk.manual', data: { id: o.id }, variant: 'ghost', size: 'sm', icon: 'userCheck' })}${o.walkInsAllowed ? btn('Add walk-in…', { action: 'desk.walkin', data: { id: o.id }, variant: 'ghost', size: 'sm', icon: 'userPlus' }): ''}</div>`, { title: 'Check-in' }) : ''}
    <div class="court-board">${d.board.map((c) => html`<div class="court-tile${c.game ? ' live' : ''}"><header><b>${c.name}</b>${c.game ? html`<span class="pill ${c.game.overtime ? 'pill-danger' : 'pill-success'}">${icon('timer', 12)} ${Math.max(0, Math.round((now - c.game.startedAt) / MINUTE))} min${c.game.overtime ? ' · over time' : ''}</span>` : html`<span class="pill pill-neutral">Free</span>`}</header>
      ${c.game ? html`<div class="sides"><div class="side">${c.game.sideA.map((p) => html`<span class="pchip">${avatar(p.name, (p.name.charCodeAt(0) * 9) % 360, 22)}${p.name}</span>`)}</div><span class="vs">vs</span><div class="side">${c.game.sideB.map((p) => html`<span class="pchip">${avatar(p.name, (p.name.charCodeAt(0) * 9) % 360, 22)}${p.name}</span>`)}</div></div>` : c.assigned.length ? html`<div class="side">${c.assigned.map((p) => html`<span class="pchip">${p.name}</span>`)}</div>` : html`<p class="xs muted">No players assigned.</p>`}
      ${c.lastGame?.score ? html`<p class="xs muted" style="margin:6px 0 0">Last game: ${c.lastGame.score.a}–${c.lastGame.score.b}</p>` : ''}
      ${can.run ? html`<div class="row" style="gap:6px;margin-top:8px">${c.game ? btn('End game', { action: 'desk.end', data: { session: o.id, game: c.game.id, score: o.scoreRecording ? '1' : '' }, variant: 'primary', size: 'sm' }) : btn('Next game', { action: 'desk.suggest', data: { session: o.id, court: c.courtId }, variant: 'primary', size: 'sm', icon: 'shuffle' })}</div>` : ''}
    </div>`)}</div>
  </div><div class="stack">
    ${card(d.queue.length ? html`<ol class="queue">${d.queue.map((p) => html`<li><span class="qpos">${p.position}</span><div style="flex:1;min-width:0"><b>${p.name}</b><div class="xs muted">${p.skillLabel} · ${p.gamesPlayed} games · waiting ${Math.max(0, Math.round((now - p.since) / MINUTE))} min</div></div>${can.run ? html`<select aria-label="Assign ${p.name} to a court" data-change="desk.assign" data-session="${o.id}" data-reg="${p.registrationId}" style="width:auto"><option value="">Assign…</option>${d.board.map((c) => html`<option value="${c.courtId}">${c.name}</option>`)}<option value="__temp_off">Take a break</option><option value="__check_out">Check out</option></select>` : ''}</li>`)}</ol>` : html`<p class="small muted">Nobody is waiting.</p>`, { title: html`Waiting rotation <span class="tab-count">${d.queue.length}</span>`, subtitle: d.rotationLabel })}
    ${checkedOnly.length ? card(html`${checkedOnly.map((p) => html`<div class="row-between small"><b>${p.name}</b>${can.run ? btn('Add to queue', { action: 'desk.move', data: { session: o.id, reg: p.registrationId, to: 'to_waiting' }, variant: 'ghost', size: 'sm' }) : ''}</div>`)}`, { title: 'Checked in, not queued' }) : ''}
    ${tempOff.length ? card(html`${tempOff.map((p) => html`<div class="row-between small"><b>${p.name}</b>${can.run ? btn('Back to queue', { action: 'desk.move', data: { session: o.id, reg: p.registrationId, to: 'to_waiting' }, variant: 'ghost', size: 'sm' }) : ''}</div>`)}`, { title: 'Taking a break' }) : ''}
    ${card(d.exceptions.length ? html`<ul class="exceptions">${d.exceptions.map((e) => html`<li class="exc-${e.kind}">${icon(e.kind === 'rejected' ? 'ban' : e.kind === 'needs_partner' ? 'userPlus' : e.kind === 'overtime' ? 'timer' : 'alert', 14)} ${e.text}</li>`)}</ul>` : html`<p class="small muted">No exceptions.</p>`, { title: 'Attendance exceptions' })}
    ${card(html`<p class="small">${notArrived.length} registered player${notArrived.length === 1 ? '' : 's'} not here yet.</p>${notArrived.slice(0, 6).map((p) => html`<div class="xs">${p.name}${p.party ? ` · ${p.party.name}` : ''}</div>`)}`, { title: 'Not arrived' })}
  </div></div>`;
}

function playersTab(d: Desk): SafeHtml {
  const o = d.session;
  const can = d.perms;
  const solo = d.players.filter((p) => !p.party && p.attendance !== 'no_show');
  return card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Player</th><th>Level</th><th>Partner / team</th><th>Attendance</th><th>Court</th><th class="num">Games</th><th>Checked in</th><th></th></tr></thead><tbody>${d.players.map((p) => html`<tr><td><b>${p.name}</b>${p.username ? html`<div class="xs muted">@${p.username}</div>` : ''}${p.walkIn ? tag('walk-in', 'info') : ''}${p.manuallyAdjusted ? tag('adjusted', 'warning') : ''}${p.restricted ? tag('restricted', 'danger') : ''}</td><td class="small">${p.skillLabel}</td><td class="small">${p.party ? html`${p.party.name} ${pill(p.party.status)}` : '—'}${p.needsPartner ? html`<div>${tag('Needs partner', 'warning')}</div>` : ''}</td><td>${attendancePill(p.attendance)}</td><td class="small">${p.court ?? '—'}</td><td class="num">${p.gamesPlayed}</td><td class="small">${p.checkedInAt ? `${formatTime(p.checkedInAt)} · ${(p.method ?? '').replace('_', ' ')}` : '—'}</td><td class="right">${can.checkIn && p.attendance === 'not_arrived' ? btn('Check in', { action: 'desk.checkin', data: { session: o.id, reg: p.registrationId, method: 'search' }, variant: 'secondary', size: 'sm' }) : ''}${can.correct ? btn('Correct…', { action: 'desk.correct', data: { session: o.id, reg: p.registrationId, name: p.name }, variant: 'ghost', size: 'sm' }) : ''}${can.manage && p.needsPartner && p.party ? btn('Assign partner…', { action: 'desk.replace', data: { session: o.id, reg: p.registrationId }, variant: 'ghost', size: 'sm' }) : ''}</td></tr>`)}</tbody></table></div>
  ${can.run && solo.length >= 2 ? html`<form class="row" data-form="desk.party" data-id="${o.id}" style="margin-top:12px;align-items:flex-end;flex-wrap:wrap"><div><span class="label">Create a pair or team from solo players</span><div class="chips" style="margin-top:6px">${solo.map((p) => html`<label class="chip"><input type="checkbox" name="regs" value="${p.registrationId}"/> ${p.name}</label>`)}</div></div>${field({ name: 'name', label: 'Name', placeholder: 'Team Blue' })}${btn('Create', { type: 'submit', variant: 'secondary' })}</form>` : ''}
  <p class="xs muted" style="margin-top:8px">${icon('shield', 12)} Contact details are not shown here. Use Customers (with the right permission) if you must contact a player.</p>`, { title: 'Registered players', pad: true });
}

function logTab(d: Desk): SafeHtml {
  const o = d.session;
  const log = app.api.read('GET /v1/businesses/{businessId}/open-play/{sessionId}/attendance-events', { businessId: app.businessId!, sessionId: o.id });
  return card(html`<p class="small muted">Append-only: corrections and reversals are added as new entries — nothing is edited or deleted.</p><div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Time</th><th>Event</th><th>Player</th><th>Change</th><th>By</th><th>Reason</th><th></th></tr></thead><tbody>${log.map((e) => html`<tr class="${cls(e.type === 'check_in_rejected' && 'row-danger', e.reversed && 'row-muted')}"><td class="num">${e.seq}</td><td class="nowrap small">${formatDateTime(e.at)}</td><td><b class="small">${e.type.replace(/_/g, ' ')}</b>${e.method ? html`<div class="xs muted">${String(e.method).replace('_', ' ')}</div>` : ''}${e.rejectCode ? html`<div class="xs">${tag(e.rejectCode.replace(/_/g, ' '), 'danger')}</div>` : ''}</td><td class="small">${e.player ?? '—'}</td><td class="small">${e.from ? `${e.from.replace('_', ' ')} → ${(e.to ?? '').replace('_', ' ')}` : ''}${e.court ? ` · ${e.court}` : ''}</td><td class="small">${e.actorLabel}</td><td class="small">${e.reason ?? ''}${e.reversed ? html` ${tag('reversed', 'neutral')}` : ''}</td><td>${d.perms.correct && !e.reversed && ['check_in', 'no_show', 'check_out', 'walk_in'].includes(e.type) ? btn('Reverse…', { action: 'desk.reverse', data: { session: o.id, event: e.id }, variant: 'ghost', size: 'sm' }) : ''}</td></tr>`)}</tbody></table></div>`, { title: 'Attendance history' });
}

// ---------------------------------------------------------------- desk actions

const bid = () => app.businessId!;

form('desk.scan', async (fd, f) => {
  const token = str(fd, 'token');
  const id = f.dataset.id!;
  try {
    const r = await app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/check-ins', { businessId: bid(), sessionId: id, token });
    app.ui[`lastScan:${id}`] = { ok: true, text: `${r.name} checked in${r.party ? ` (${r.party})` : ''}${r.needsPartner ? ' — needs a partner' : ''} · ${r.method === 'registration_qr' ? 'registration QR' : 'live pass'}`, at: app.store.now() };
    (f.querySelector('input[name=token]') as HTMLInputElement).value = '';
    app.render();
  } catch (e) {
    app.ui[`lastScan:${id}`] = { ok: false, text: (e as Error).message, at: app.store.now() };
    app.render();
  }
});
action('desk.sample', async (el) => {
  try {
    const r = app.api.read('GET /demo/open-play/{sessionId}/sample-pass', { businessId: bid(), sessionId: el.dataset.id!, kind: el.dataset.kind as never });
    const input = document.querySelector<HTMLInputElement>('form[data-form="desk.scan"] input[name=token]');
    if (input) {
      input.value = r.token;
      input.focus();
    }
    app.toast(`Sample ${r.kind.replace('_', ' ')} pass loaded (${r.player}). Press “Check in”.`, 'info');
  } catch (e) {
    app.handleError(e);
  }
});
form('desk.search', (fd, f) => app.set(`deskQ:${f.dataset.id}`, str(fd, 'q')));
action('desk.checkin', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/check-ins', { businessId: bid(), sessionId: el.dataset.session!, registrationId: el.dataset.reg!, method: 'search' }), { success: 'Checked in' });
});
action('desk.manual', (el) => {
  const d = app.api.read('GET /v1/businesses/{businessId}/open-play/{sessionId}/desk', { businessId: bid(), sessionId: el.dataset.id! });
  const list = d.players.filter((p) => p.attendance === 'not_arrived');
  app.modal({
    title: 'Manual check-in',
    body: html`<form class="stack-sm" data-form="desk.manual" data-id="${el.dataset.id}">${list.length ? select({ name: 'reg', label: 'Registered player', options: list.map((p) => ({ value: p.registrationId, label: p.name })) }) : html`<p>Everyone registered is already checked in.</p>`}${textarea({ name: 'reason', label: 'Reason (required, kept in the attendance log)', required: true, placeholder: 'e.g. Phone battery dead — name and ID checked' })}<p class="xs muted">Manual check-ins are flagged as manually adjusted and work after the late-arrival cutoff.</p><div class="row" style="justify-content:flex-end">${btn('Cancel', { action: 'modal.close', variant: 'ghost' })}${list.length ? btn('Check in', { type: 'submit', variant: 'primary' }) : ''}</div></form>`,
  });
});
form('desk.manual', async (fd, f) => {
  await app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/check-ins', { businessId: bid(), sessionId: f.dataset.id!, registrationId: str(fd, 'reg'), method: 'manual', reason: str(fd, 'reason') });
  app.closeModal();
  app.toast('Checked in manually (logged with your reason)', 'success');
});
action('desk.walkin', (el) => {
  const methods = app.store.state.settings.platform!.feeSchedules.filter((f) => f.enabled);
  app.modal({
    title: 'Add a walk-in',
    body: html`<form class="stack-sm" data-form="desk.walkin" data-id="${el.dataset.id}">${field({ name: 'name', label: 'Player name', required: true })}${field({ name: 'phone', label: 'PH mobile (for the receipt)', placeholder: '0917 123 4567', required: true, inputmode: 'tel' })}${select({ name: 'method', label: 'Payment (player pays on their phone)', value: 'qrph', options: methods.map((m) => ({ value: m.method, label: m.label })) })}<p class="xs muted">Paid sessions send a secure payment link; the player is checked in automatically once the provider confirms payment. Cash isn't recorded as paid on CourtKo.</p><div class="row" style="justify-content:flex-end">${btn('Cancel', { action: 'modal.close', variant: 'ghost' })}${btn('Add walk-in', { type: 'submit', variant: 'primary' })}</div></form>`,
  });
});
form('desk.walkin', async (fd, f) => {
  const r = await app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/walk-ins', { businessId: bid(), sessionId: f.dataset.id!, customerName: str(fd, 'name'), customerPhone: str(fd, 'phone'), paymentMethod: str(fd, 'method') as never });
  app.closeModal();
  if (r.paymentUrl) {
    app.toast(`Payment link created (${formatPHP(r.amount)}). Opening the player's payment page…`, 'info');
    app.navigate(r.paymentUrl);
  } else app.toast('Walk-in added and checked in', 'success');
});
onChange('desk.assign', async (el) => {
  const v = (el as HTMLSelectElement).value;
  if (!v) return;
  const action = v === '__temp_off' ? 'temp_off' : v === '__check_out' ? 'check_out' : 'assign';
  await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/attendance', { businessId: bid(), sessionId: el.dataset.session!, registrationIds: [el.dataset.reg!], action, ...(action === 'assign' ? { courtId: v } : {}) }, { silent: true }));
});
action('desk.move', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/attendance', { businessId: bid(), sessionId: el.dataset.session!, registrationIds: [el.dataset.reg!], action: el.dataset.to as never }, { silent: true }));
});
action('desk.suggest', (el) => {
  const sessionId = el.dataset.session!;
  const courtId = el.dataset.court!;
  const sug = app.api.read('GET /v1/businesses/{businessId}/open-play/{sessionId}/rotation-suggestion', { businessId: bid(), sessionId, courtId });
  const d = app.api.read('GET /v1/businesses/{businessId}/open-play/{sessionId}/desk', { businessId: bid(), sessionId });
  const pool = d.players.filter((p) => ['waiting', 'checked_in', 'on_court'].includes(p.attendance) && (p.attendance !== 'on_court' || p.courtId === courtId));
  const sideOf = (id: string) => (sug.sideA.includes(id) ? 'a' : sug.sideB.includes(id) ? 'b' : '');
  app.modal({
    title: `Next game · ${d.board.find((c) => c.courtId === courtId)?.name ?? 'Court'}`,
    wide: true,
    body: html`<form class="stack-sm" data-form="desk.start" data-session="${sessionId}" data-court="${courtId}"><p class="small">${icon('shuffle', 14)} <b>${sug.note}</b> · needs ${sug.need} players${sug.short ? html` — ${tag(`${sug.short} short`, 'warning')}` : ''}. Adjust the sides, then start. Staff always confirm the assignment.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Player</th><th>Status</th><th>Side</th></tr></thead><tbody>${pool.map((p) => html`<tr><td><b>${p.name}</b><div class="xs muted">${p.skillLabel}${p.queuePosition ? ` · #${p.queuePosition} in queue` : ''}</div></td><td>${attendancePill(p.attendance)}</td><td><select name="side_${p.registrationId}" aria-label="Side for ${p.name}" style="width:auto"><option value="">Not playing</option><option value="a"${sideOf(p.registrationId) === 'a' ? html` selected` : ''}>Side A</option><option value="b"${sideOf(p.registrationId) === 'b' ? html` selected` : ''}>Side B</option></select></td></tr>`)}</tbody></table></div>
      <div class="row" style="justify-content:flex-end">${btn('Cancel', { action: 'modal.close', variant: 'ghost' })}${btn('Start game', { type: 'submit', variant: 'primary', icon: 'play' })}</div></form>`,
  });
});
form('desk.start', async (fd, f) => {
  const sideA: string[] = [];
  const sideB: string[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith('side_')) continue;
    if (v === 'a') sideA.push(k.slice(5));
    if (v === 'b') sideB.push(k.slice(5));
  }
  await app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/games', { businessId: bid(), sessionId: f.dataset.session!, courtId: f.dataset.court!, sideA, sideB });
  app.closeModal();
  app.toast('Game started — players are now counted as on court', 'success');
});
action('desk.end', (el) => {
  const scoring = !!el.dataset.score;
  app.modal({
    title: 'End game',
    body: html`<form class="stack-sm" data-form="desk.end" data-session="${el.dataset.session}" data-game="${el.dataset.game}">${scoring ? html`<div class="form-grid">${field({ name: 'a', label: 'Side A score', type: 'number', min: 0, max: 99 })}${field({ name: 'b', label: 'Side B score', type: 'number', min: 0, max: 99 })}</div><p class="xs muted">Leave blank to end without a score.</p>` : html`${select({ name: 'winner', label: 'Winner (optional)', options: [{ value: '', label: 'No result' }, { value: 'a', label: 'Side A' }, { value: 'b', label: 'Side B' }] })}<p class="xs muted">Score recording is off for this session.</p>`}<p class="small">Players go back to the waiting rotation${scoring ? ' (winners stay on court with “Winner stays”)' : ''}.</p><div class="row" style="justify-content:flex-end">${btn('Cancel', { action: 'modal.close', variant: 'ghost' })}${btn('End game', { type: 'submit', variant: 'primary' })}</div></form>`,
  });
});
form('desk.end', async (fd, f) => {
  const a = str(fd, 'a');
  const b = str(fd, 'b');
  await app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/games/{gameId}/completion', { businessId: bid(), sessionId: f.dataset.session!, gameId: f.dataset.game!, ...(a !== '' && b !== '' ? { scoreA: Number(a), scoreB: Number(b) } : {}), ...(str(fd, 'winner') ? { winner: str(fd, 'winner') as never } : {}) });
  app.closeModal();
  app.toast('Game ended — players returned to the rotation', 'success');
});
action('desk.correct', (el) => {
  app.modal({
    title: `Correct attendance · ${el.dataset.name}`,
    body: html`<form class="stack-sm" data-form="desk.correct" data-session="${el.dataset.session}" data-reg="${el.dataset.reg}">${select({ name: 'to', label: 'Set attendance to', options: [['not_arrived', 'Not arrived'], ['checked_in', 'Checked in'], ['waiting', 'Waiting to play'], ['temp_off', 'Temporarily off court'], ['checked_out', 'Checked out'], ['completed', 'Completed'], ['no_show', 'No-show']].map(([value, label]) => ({ value: value!, label: label! })) })}${textarea({ name: 'reason', label: 'Reason (required)', required: true })}<p class="xs muted">Needs the “Correct attendance” permission and two-step verification. Recorded as a new attendance event and in the audit log.</p><div class="row" style="justify-content:flex-end">${btn('Cancel', { action: 'modal.close', variant: 'ghost' })}${btn('Save correction', { type: 'submit', variant: 'primary' })}</div></form>`,
  });
});
form('desk.correct', async (fd, f) => {
  await app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/attendance-corrections', { businessId: bid(), sessionId: f.dataset.session!, registrationId: f.dataset.reg!, to: str(fd, 'to') as never, reason: str(fd, 'reason') });
  app.closeModal();
  app.toast('Attendance corrected', 'success');
});
action('desk.reverse', (el) => {
  app.modal({
    title: 'Reverse attendance event',
    body: html`<form class="stack-sm" data-form="desk.reverse" data-session="${el.dataset.session}" data-event="${el.dataset.event}">${textarea({ name: 'reason', label: 'Reason (required)', required: true, placeholder: 'e.g. Checked in the wrong player' })}<div class="row" style="justify-content:flex-end">${btn('Cancel', { action: 'modal.close', variant: 'ghost' })}${btn('Reverse', { type: 'submit', variant: 'danger' })}</div></form>`,
  });
});
form('desk.reverse', async (fd, f) => {
  await app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/attendance-events/{eventId}/reversal', { businessId: bid(), sessionId: f.dataset.session!, eventId: f.dataset.event!, reason: str(fd, 'reason') });
  app.closeModal();
  app.toast('Reversed — a new event was added to the log', 'success');
});
action('desk.replace', (el) => {
  const d = app.api.read('GET /v1/businesses/{businessId}/open-play/{sessionId}/desk', { businessId: bid(), sessionId: el.dataset.session! });
  const me = d.players.find((p) => p.registrationId === el.dataset.reg);
  const solo = d.players.filter((p) => !p.party && p.registrationId !== el.dataset.reg && p.attendance !== 'no_show');
  const partyId = (me as unknown as { party: { name: string } | null }).party ? app.store.read((db) => db.get('opRegistrations', el.dataset.reg!)?.partyId ?? '') : '';
  app.modal({
    title: `Assign a partner for ${me?.name ?? 'player'}`,
    body: solo.length ? html`<form class="stack-sm" data-form="desk.replace" data-session="${el.dataset.session}" data-party="${partyId}">${select({ name: 'reg', label: 'Registered solo player', options: solo.map((p) => ({ value: p.registrationId, label: `${p.name} · ${p.skillLabel}` })) })}<p class="xs muted">Both players are notified in the app.</p><div class="row" style="justify-content:flex-end">${btn('Cancel', { action: 'modal.close', variant: 'ghost' })}${btn('Assign', { type: 'submit', variant: 'primary' })}</div></form>` : html`<p>No solo players are registered right now.</p>`,
  });
});
form('desk.replace', async (fd, f) => {
  await app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/parties/{partyId}/replacement', { businessId: bid(), sessionId: f.dataset.session!, partyId: f.dataset.party!, registrationId: str(fd, 'reg') });
  app.closeModal();
  app.toast('Partner assigned', 'success');
});
form('desk.party', async (fd, f) => {
  await app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/parties', { businessId: bid(), sessionId: f.dataset.id!, registrationIds: fd.getAll('regs').map(String), name: str(fd, 'name') });
  app.toast('Group created', 'success');
});
action('opb.cancel', async (el) => {
  const reason = window.prompt('Tell participants why the session is cancelled (they get a full refund, including fees):');
  if (!reason) return;
  const r = await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/open-play/{sessionId}/cancellation', { businessId: bid(), sessionId: el.dataset.id!, reason }, { idempotencyKey: app.idem() }));
  if (r) app.toast(`Session cancelled. ${formatPHP(r.refunded)} refunded; players notified.`, 'success');
});

void sportName;
