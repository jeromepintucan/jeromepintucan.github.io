/** SuperAdmin: sport catalog (doc 24 CR-D01) and a platform-wide Open Play view. */

import { formatDateShort, formatTimeRange } from '../../domain/time.ts';
import { app, action, form, str } from '../app.ts';
import { alertBox, btn, card, checkbox, field, pageHeader, pill, select, tag, textarea } from '../components.ts';
import { html } from '../html.ts';
import { icon } from '../icons.ts';
import { adminRoute } from './admin.ts';
import { sportTag } from './shared.ts';

adminRoute('/admin/sports', 'Sports catalog', () => {
  const list = app.api.read('GET /v1/admin/sports');
  const open = app.state<string>('sportOpen', '');
  return html`${pageHeader('Sports catalog', { subtitle: 'The single source of truth for sports, formats, player counts, skill levels and Open Play settings. Venues, search, booking and Open Play read from here — no sport is hard-coded.' })}
  ${alertBox('info', 'Launch scope: four sports', 'Pickleball, basketball, volleyball and tennis. New sports can be added later as catalog entries with their own format templates — badminton, futsal and others are out of scope for the initial release.')}
  <div class="grid g2" style="margin-top:14px">${list.map(({ sport: s, usage }) => card(html`<div class="row" style="gap:10px;align-items:center"><span class="sport-ic" style="--sport-hue:${s.hue}">${icon(s.icon, 26)}</span><div style="flex:1"><div class="row" style="gap:6px"><h3 style="margin:0">${s.name}</h3>${pill(s.status)}<span class="xs muted">v${s.version}</span></div><p class="small muted" style="margin:4px 0 0">${s.description}</p></div></div>
    <div class="op-mini-counts" style="margin:12px 0"><div><b>${usage.venues}</b><span>venues</span></div><div><b>${usage.courts}</b><span>court layouts</span></div><div><b>${usage.upcomingBookings}</b><span>upcoming bookings</span></div><div><b>${usage.openPlay}</b><span>Open Play</span></div></div>
    <div class="small"><b>Court layouts:</b> ${s.courtConfigurations.map((c) => c.label).join(', ')}</div>
    <div class="small"><b>Formats:</b> ${s.formats.map((f) => html`${tag(`${f.label}${f.appliesTo.includes('open_play') && !f.appliesTo.includes('booking') ? ' (Open Play)' : ''}`, 'neutral')} `)}</div>
    <div class="small"><b>Players:</b> ${s.minPlayers}–${s.maxPlayers} · <b>Default booking:</b> ${s.defaultDurationMinutes} min · <b>Team rule:</b> ${s.teamRequirement.replace(/_/g, ' ')}</div>
    <div class="small"><b>Skill levels:</b> ${s.skillLevels.map((l) => l.label).join(' · ')}</div>
    <div class="small"><b>Open Play:</b> ${s.openPlay.enabled ? `on · default ${s.openPlay.defaultCapacity} players · ${s.openPlay.defaultGameMinutes}-min games · ${s.openPlay.registrationModes.join(', ')}` : 'off'}</div>
    <div class="small"><b>Results:</b> ${s.matchResult.enabled ? s.matchResult.label : 'not recorded'}</div>
    <div style="margin-top:10px">${btn(open === s.code ? 'Close' : 'Edit', { action: 'sport.open', data: { code: open === s.code ? '' : s.code }, variant: 'secondary', size: 'sm', icon: 'settings' })}</div>
    ${open === s.code ? html`<form class="stack-sm" data-form="sport.save" data-code="${s.code}" style="margin-top:12px;border-top:1px solid var(--ck-slate-200);padding-top:12px">
      <div class="form-grid">${field({ name: 'name', label: 'Name', value: s.name })}${select({ name: 'status', label: 'Status', value: s.status, options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive (hidden from new bookings)' }] })}
      ${field({ name: 'minPlayers', label: 'Minimum players', type: 'number', value: s.minPlayers, min: 1, max: 40 })}${field({ name: 'maxPlayers', label: 'Maximum players', type: 'number', value: s.maxPlayers, min: 1, max: 40 })}
      ${field({ name: 'defaultDuration', label: 'Default booking (min)', type: 'number', value: s.defaultDurationMinutes, step: 30, min: 30, max: 360 })}${field({ name: 'defaultCapacity', label: 'Default Open Play capacity', type: 'number', value: s.openPlay.defaultCapacity, min: 2, max: 200 })}
      ${field({ name: 'gameMinutes', label: 'Default game length (min)', type: 'number', value: s.openPlay.defaultGameMinutes, min: 5, max: 120 })}${field({ name: 'resultLabel', label: 'Match-result rule', value: s.matchResult.label })}</div>
      ${textarea({ name: 'description', label: 'Description', value: s.description, rows: 2 })}
      <div class="form-grid">${s.skillLevels.map((l) => field({ name: `lvl_${l.code}`, label: `Skill level label (${l.code})`, value: l.label }))}</div>
      <div class="row">${checkbox({ name: 'openPlay', label: 'Open Play enabled', checked: s.openPlay.enabled })}${checkbox({ name: 'results', label: 'Record match results', checked: s.matchResult.enabled })}</div>
      ${field({ name: 'reason', label: 'Reason for the change (required to deactivate)', placeholder: 'e.g. Pausing tennis bookings while courts are resurfaced' })}
      <p class="xs muted">Changes need two-step verification, are versioned and written to the audit log with before/after values. Deactivating a sport never changes existing bookings or registrations.</p>
      ${btn('Save sport', { type: 'submit', variant: 'primary' })}</form>` : ''}`, {}))}</div>`;
});
action('sport.open', (el) => app.set('sportOpen', el.dataset.code ?? ''));
form('sport.save', async (fd, f) => {
  const code = f.dataset.code!;
  const current = app.api.read('GET /v1/admin/sports').find((x) => x.sport.code === code)!.sport;
  await app.api.write('PATCH /v1/admin/sports/{sport}', {
    sport: code,
    name: str(fd, 'name'),
    description: str(fd, 'description'),
    status: str(fd, 'status') as never,
    minPlayers: Number(str(fd, 'minPlayers')),
    maxPlayers: Number(str(fd, 'maxPlayers')),
    defaultDurationMinutes: Number(str(fd, 'defaultDuration')),
    defaultCapacity: Number(str(fd, 'defaultCapacity')),
    defaultGameMinutes: Number(str(fd, 'gameMinutes')),
    matchResultLabel: str(fd, 'resultLabel'),
    openPlayEnabled: fd.get('openPlay') === 'on',
    matchResultEnabled: fd.get('results') === 'on',
    skillLevels: current.skillLevels.map((l) => ({ code: l.code, label: str(fd, `lvl_${l.code}`) || l.label })),
    reason: str(fd, 'reason'),
  });
  app.set('sportOpen', '');
  app.toast('Sport catalog updated (new version recorded in the audit log)', 'success');
});

adminRoute('/admin/open-play', 'Open Play', () => {
  const list = app.api.read('GET /v1/admin/open-play');
  const now = app.store.now();
  return html`${pageHeader('Open Play', { subtitle: 'All sessions across businesses. Counts only — player attendance details stay with each venue.' })}
  ${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Session</th><th>Business</th><th>Sport</th><th>When</th><th>Status</th><th class="num">Registered</th><th class="num">Checked in</th><th class="num">Capacity</th></tr></thead><tbody>${list.map((x) => html`<tr><td><b>${x.session.title}</b><div class="xs muted">${x.venue.name}</div></td><td class="small">${x.business}</td><td>${sportTag(x.session.sport, { small: true })}</td><td class="small nowrap">${formatDateShort(x.session.startMs)} · ${formatTimeRange(x.session.startMs, x.session.endMs)}</td><td>${pill(x.session.status)}${x.live && x.session.endMs > now ? html` <span class="pill pill-danger">Live</span>` : ''}</td><td class="num">${x.registered}</td><td class="num">${x.checkedIn}</td><td class="num">${x.session.capacity}</td></tr>`)}</tbody></table></div>`, { pad: false })}`;
});
