/** Business setup: courts & blocks, venue settings, pricing rules & promos, events, products, staff & roles, settings. */

import { formatPHP, formatPpm, parsePesoInput } from '../../domain/money.ts';
import { POLICY_LIBRARY, describePolicy } from '../../domain/policy.ts';
import { RULE_KIND_LABEL, type RuleKind } from '../../domain/pricing.ts';
import { BUSINESS_PERMISSIONS, OWNER_ONLY_PERMISSIONS } from '../../domain/rbac.ts';
import { addDays, DAY, DOW_SHORT, formatDateLong, formatDateShort, formatDuration, formatMinuteOfDay, formatTimeRange, HOUR, localDate, localToInstant, MINUTE } from '../../domain/time.ts';
import type { ReadResult } from '../../services/api.ts';
import { action, app, form, str } from '../app.ts';
import { productTile } from '../art.ts';
import { alertBox, btn, card, checkbox, dl, empty, field, pageHeader, pill, priceBreakdown, select, tabs, tag, textarea } from '../components.ts';
import { html, type SafeHtml } from '../html.ts';
import { icon } from '../icons.ts';
import { bizRoute } from './business.ts';
import { sportName, sportsCatalog, sportTag } from './shared.ts';

const minuteOptions = (from = 0, to = 1440, step = 30) => Array.from({ length: (to - from) / step + 1 }, (_, i) => from + i * step).map((m) => ({ value: String(m), label: m === 1440 ? '12:00 MN (end of day)' : formatMinuteOfDay(m) }));
const parseLocal = (v: string) => {
  const [d, t = '00:00'] = v.split('T');
  const [h, m] = t.split(':').map(Number);
  return localToInstant(d!, h! * 60 + m!);
};
const localInput = (ms: number) => new Date(ms + 8 * HOUR).toISOString().slice(0, 16);

// ---------------------------------------------------------------- courts & blocks

const ENV: Record<string, string> = { indoor: 'Indoor', covered: 'Covered', outdoor: 'Outdoor' };

bizRoute('/biz/courts', 'Courts & layouts', (ctx, b) => {
  const list = app.api.read('GET /v1/businesses/{businessId}/venues', { businessId: b.businessId }).find((v) => v.venue.id === b.venueId);
  if (!list) return empty('No venue selected');
  const blocks = app.api.read('GET /v1/businesses/{businessId}/court-blocks', { businessId: b.businessId, venueId: b.venueId });
  const preCourt = ctx.query.get('block');
  const preStart = Number(ctx.query.get('start')) || Math.ceil((app.store.now() + HOUR) / (30 * MINUTE)) * 30 * MINUTE;
  const conflict = app.ui.blockConflict as { conflicts: { kind: string; label: string; when: string }[]; data: Record<string, unknown> } | undefined;
  const active = list.courts.filter((c) => c.status === 'active');
  const byId = new Map(list.courts.map((c) => [c.id, c]));
  const venueSports = list.venue.sports?.length ? list.venue.sports : ['pickleball'];
  return html`${pageHeader('Courts & layouts', { subtitle: html`${list.venue.name} · ${venueSports.map((x) => sportTag(x, { small: true }))}`, actions: b.perms.has('courts.manage') ? btn('Add court', { action: 'court.edit', variant: 'primary', icon: 'plus' }) : '' })}
  ${alertBox('info', 'How shared courts work', 'Each physical court is split into spaces. A layout (full court, half court, volleyball court, pickleball court on a tennis court…) uses one or more spaces. The server blocks any booking that overlaps a space already in use, so a full-court booking automatically blocks both halves, a half-court booking blocks the full court, and a shared floor can only host one sport at a time — with a changeover gap when the sport changes.')}
  <div class="split" style="margin-top:12px"><div class="stack">${[...list.physical].sort((a, b) => b.layouts.length - a.layouts.length || a.court.sortOrder - b.court.sortOrder).map((p) => card(html`<div class="row" style="gap:6px;margin-bottom:8px">${p.court.sports.map((x) => sportTag(x, { small: true }))}${tag(ENV[p.court.environment] ?? p.court.environment)}${p.court.status === 'inactive' ? pill('inactive') : ''}</div>
      <div class="court-diagram">${p.court.unitNames.map((u) => html`<div class="unit"><span>${p.court.unitNames.length > 1 ? `Space ${u}` : 'Whole court'}</span></div>`)}</div>
      <div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>Bookable layout</th><th>Sport</th><th>Uses</th><th>Blocks when booked</th><th>Status</th></tr></thead><tbody>${p.layouts.map((l) => html`<tr><td><b>${l.layoutLabel ?? l.name}</b><div class="xs muted">${l.name}</div></td><td>${sportName(l.sport ?? 'pickleball')}</td><td class="small">${(l.units ?? []).map((u) => (u.split(':')[1] === 'main' ? 'whole court' : `space ${u.split(':')[1]}`)).join(' + ')}</td><td class="small">${(list.dependencies[l.id] ?? []).map((id) => byId.get(id)?.layoutLabel ?? byId.get(id)?.name).join(', ') || '—'}</td><td>${pill(l.status)}</td></tr>`)}</tbody></table></div>
      ${dl([['Surface', p.court.surface], ['Capacity', `${p.court.capacity} people`], ['Changeover between sports', p.court.sports.length > 1 ? `${p.court.changeoverMinutes} min` : '—'], ['Equipment', p.court.equipment.join(', ') || '—'], ['Accessibility', p.court.accessibility || '—'], ['Maintenance', p.court.maintenance.map((m) => `${DOW_SHORT[m.dow]} ${formatMinuteOfDay(m.startMinute)}–${formatMinuteOfDay(m.endMinute)} (${m.note})`).join('; ') || '—']])}`, { title: p.court.name, actions: b.perms.has('courts.manage') ? btn('Edit', { action: 'court.edit', data: { id: p.court.id }, variant: 'ghost', size: 'sm', icon: 'settings' }) : '' }))}
    ${!list.physical.length ? empty('No courts yet', 'Add your first court to start taking bookings.', b.perms.has('courts.manage') ? btn('Add court', { action: 'court.edit', variant: 'primary' }) : undefined, 'court') : ''}</div>
  <div class="stack">${b.perms.has('courts.block') ? card(html`<form data-form="block.create" class="stack-sm">${select({ name: 'courtId', label: 'Court layout', value: preCourt ?? active[0]?.id, options: active.map((c) => ({ value: c.id, label: `${c.name}${c.sport ? ` (${sportName(c.sport)})` : ''}` })) })}<p class="xs muted" style="margin:-4px 0 0">Blocking a full court also blocks its halves and any other layout on the same floor.</p><div class="form-grid">${field({ name: 'start', label: 'From', type: 'datetime-local', value: localInput(preStart), step: 900 })}${field({ name: 'end', label: 'Until', type: 'datetime-local', value: localInput(preStart + 2 * HOUR), step: 900 })}</div>${select({ name: 'reason', label: 'Reason', options: [{ value: 'maintenance', label: 'Maintenance' }, { value: 'private_rental', label: 'Private rental' }, { value: 'event_setup', label: 'Event setup' }, { value: 'weather', label: 'Weather' }, { value: 'other', label: 'Other' }] })}${field({ name: 'note', label: 'Note', placeholder: 'e.g. Net replacement' })}${btn('Block court', { type: 'submit', variant: 'primary', icon: 'ban' })}</form>
    ${conflict ? alertBox('warning', `${conflict.conflicts.length} booking(s) overlap this block`, html`<ul class="bullets small">${conflict.conflicts.map((c) => html`<li>${c.label} · ${c.when}</li>`)}</ul><p class="small">Blocking will cancel them with a <b>full refund including fees</b>, release any checkouts in progress, and notify the players.</p>`, html`${btn('Block anyway & refund', { action: 'block.force', variant: 'danger', size: 'sm' })}${btn('Keep bookings', { action: 'block.dismiss', variant: 'ghost', size: 'sm' })}`) : ''}`, { title: 'Block a court', subtitle: 'Maintenance, closures and private use' }) : ''}
    ${card(blocks.length ? html`${blocks.map((bl) => html`<div class="row-between" style="padding:8px 0;border-bottom:1px solid var(--ck-slate-100)"><div><b class="small">${byId.get(bl.courtId)?.name} · ${bl.reason.replace('_', ' ')}</b><div class="xs muted">${formatDateShort(bl.startMs)} ${formatTimeRange(bl.startMs, bl.endMs)}${bl.note ? ` · ${bl.note}` : ''}</div></div>${b.perms.has('courts.block') ? btn('Remove', { action: 'block.remove', data: { id: bl.id }, variant: 'ghost', size: 'sm' }) : ''}</div>`)}` : empty('No upcoming blocks'), { title: 'Upcoming blocks' })}</div></div>`;
});
action('court.edit', (el) => {
  const id = el.dataset.id;
  const v = app.api.read('GET /v1/businesses/{businessId}/venues', { businessId: app.businessId! }).find((x) => x.venue.id === app.venueId)!;
  const p = id ? v.physical.find((x) => x.court.id === id)?.court : undefined;
  const venueSports = v.venue.sports?.length ? v.venue.sports : ['pickleball'];
  const cat = sportsCatalog().filter((x) => venueSports.includes(x.code));
  app.modal({
    title: p ? `Edit ${p.name}` : 'Add a court',
    wide: true,
    body: html`<form data-form="court.save" data-id="${id ?? ''}" class="stack-sm">
      <div class="form-grid">${field({ name: 'name', label: 'Court name or number', value: p?.name ?? `Court ${v.physical.length + 1}`, required: true })}${select({ name: 'environment', label: 'Type', value: p?.environment ?? 'indoor', options: [{ value: 'indoor', label: 'Indoor' }, { value: 'covered', label: 'Covered' }, { value: 'outdoor', label: 'Outdoor' }] })}</div>
      <div><span class="label">Sports played on this court</span><div class="chips" style="margin-top:6px">${cat.map((x) => html`<label class="chip"><input type="checkbox" name="sports" value="${x.code}"${(p?.sports ?? [venueSports[0]]).includes(x.code) ? html` checked` : ''} style="accent-color:var(--ck-color-primary)"/> ${x.name}</label>`)}</div><p class="xs muted">Only sports your venue offers are listed (Venue settings → Sports).</p></div>
      ${checkbox({ name: 'split', label: 'Split into two spaces (A and B)', checked: (p?.unitNames.length ?? 1) > 1, hint: 'Basketball: adds Half court A and B (each blocks the full court). Tennis + pickleball: two pickleball courts drawn on the tennis court.' })}
      <div class="form-grid">${select({ name: 'surface', label: 'Playing surface', value: p?.surface ?? 'Acrylic hard court', options: ['Cushioned acrylic (indoor)', 'Acrylic hard court', 'Sprung hardwood', 'Synthetic sports tile', 'Clay', 'Sand'].map((x) => ({ value: x, label: x })) })}${field({ name: 'capacity', label: 'Capacity (people)', type: 'number', value: p?.capacity ?? 12, min: 1, max: 60 })}${field({ name: 'changeover', label: 'Changeover between sports (min)', type: 'number', value: p?.changeoverMinutes ?? 15, min: 0, max: 60 })}${select({ name: 'status', label: 'Status', value: p?.status ?? 'active', options: [{ value: 'active', label: 'Active (bookable)' }, { value: 'inactive', label: 'Inactive' }] })}</div>
      ${field({ name: 'equipment', label: 'Available equipment (comma-separated)', value: p?.equipment.join(', ') ?? '', placeholder: 'Balls, nets, scoreboard' })}
      ${field({ name: 'accessibility', label: 'Accessibility', value: p?.accessibility ?? '', placeholder: 'Step-free access, courtside wheelchair space' })}
      ${btn('Save court', { type: 'submit', variant: 'primary', block: true })}</form>`,
  });
});
form('court.save', async (fd, f) => {
  const r = await app.api.write('PUT /v1/businesses/{businessId}/venues/{venueId}/physical-courts', {
    businessId: app.businessId!,
    venueId: app.venueId!,
    ...(f.dataset.id ? { physicalCourtId: f.dataset.id } : {}),
    name: str(fd, 'name'),
    sports: fd.getAll('sports').map(String),
    environment: str(fd, 'environment') as never,
    surface: str(fd, 'surface'),
    split: fd.get('split') === 'on',
    capacity: Number(str(fd, 'capacity')),
    changeoverMinutes: Number(str(fd, 'changeover')),
    status: str(fd, 'status') as never,
    equipment: str(fd, 'equipment').split(',').map((t) => t.trim()).filter(Boolean),
    accessibility: str(fd, 'accessibility'),
  });
  app.closeModal();
  app.toast(`Court saved — ${r.layouts.filter((l) => l.status === 'active').length} bookable layout(s)`, 'success');
});
form('block.create', async (fd) => {
  const data = { businessId: app.businessId!, courtId: str(fd, 'courtId'), startMs: parseLocal(str(fd, 'start')), endMs: parseLocal(str(fd, 'end')), reason: str(fd, 'reason') as never, note: str(fd, 'note') };
  try {
    await app.api.write('POST /v1/businesses/{businessId}/courts/{courtId}/blocks', data);
    app.ui.blockConflict = undefined;
    app.toast('Court blocked', 'success');
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === 'CONFLICT') {
      const found = app.store.read((db) => {
        const court = db.get('courts', data.courtId)!;
        const units = court.units ?? [court.id];
        return db.filter('slots', (x) => (x.units ?? [x.courtId]).some((u) => units.includes(u)) && x.status === 'active' && x.startMs < data.endMs && data.startMs < x.occupiedEndMs && (x.kind === 'booking' || x.kind === 'hold')).map((x) => ({ kind: x.kind, label: `${db.get('bookings', x.sourceId)?.code ?? 'Booking'}${x.kind === 'hold' ? ' (checkout in progress)' : ''}`, when: formatTimeRange(x.startMs, x.endMs) }));
      });
      if (found.length) {
        app.set('blockConflict', { conflicts: found, data });
        return;
      }
    }
    throw e;
  }
});
action('block.force', async (el) => {
  const c = app.ui.blockConflict as { data: { businessId: string; courtId: string; startMs: number; endMs: number; reason: 'maintenance'; note: string } };
  const r = await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/courts/{courtId}/blocks', { ...c.data, resolution: 'cancel_and_refund' }, { idempotencyKey: app.idem() }));
  if (r) {
    app.ui.blockConflict = undefined;
    app.toast(`Court blocked. ${r.cancelled} booking(s) cancelled with full refunds; players notified.`, 'success');
  }
});
action('block.dismiss', () => app.set('blockConflict', undefined));
action('block.remove', async (el) => {
  await app.run(el, () => app.api.write('DELETE /v1/businesses/{businessId}/court-blocks/{blockId}', { businessId: app.businessId!, blockId: el.dataset.id! }), { success: 'Block removed' });
});

// ---------------------------------------------------------------- venue settings

bizRoute('/biz/venues', 'Venue settings', (_ctx, b) => {
  const all = app.api.read('GET /v1/businesses/{businessId}/venues', { businessId: b.businessId });
  const v = all.find((x) => x.venue.id === b.venueId);
  const tab = app.state<string>('venTab', 'profile');
  if (!v) return html`${pageHeader('Venues')}${card(newVenueForm())}`;
  const ven = v.venue;
  const amen = app.store.state.settings.platform!.amenities;
  const s = ven.settings;
  const canEdit = b.perms.has('venues.manage');
  return html`${pageHeader(ven.name, { subtitle: html`${pill(ven.status)} · ${ven.address.barangay}, ${ven.address.city}`, actions: html`${btn('View public page', { href: `#/venues/${ven.slug}`, variant: 'ghost', icon: 'eye' })}${!canEdit ? '' : ven.status === 'published' ? btn('Unpublish', { action: 'ven.publish', data: { p: '0' }, variant: 'secondary' }) : btn('Publish venue', { action: 'ven.publish', data: { p: '1' }, variant: 'primary' })}${canEdit ? btn('Add venue', { action: 'ven.new', variant: 'ghost', icon: 'plus' }) : ''}` })}
  ${canEdit ? '' : alertBox('info', 'View only', 'You can see the venue settings. Changing them needs the “Manage venues” permission.')}
  ${tabs([{ key: 'profile', label: 'Profile & amenities' }, { key: 'sports', label: 'Sports' }, { key: 'hours', label: 'Hours & closures' }, { key: 'rules', label: 'Booking rules' }, { key: 'policy', label: 'Policy & payments' }], tab, 'ven.tab')}<fieldset class="plain-fieldset"${canEdit ? '' : html` disabled`}>
  ${tab === 'sports' ? card(html`<form data-form="ven.sports" class="stack-sm"><p class="small muted">Choose which sports players can book and join at this venue. Only sports enabled in the CourtKo catalog are available.</p>${sportsCatalog().map((x) => html`<label class="method${(ven.sports ?? []).includes(x.code) ? ' active' : ''}" style="--sport-hue:${x.hue}"><input type="checkbox" name="sports" value="${x.code}"${(ven.sports ?? []).includes(x.code) ? html` checked` : ''} style="accent-color:var(--ck-color-primary)"/>${icon(x.icon, 22)}<span class="method-body"><b>${x.name}</b><span class="method-fee block">${x.description}</span></span></label>`)}${field({ name: 'changeover', label: 'Default changeover time between sports (minutes)', type: 'number', value: ven.settings.changeoverMinutes ?? 15, min: 0, max: 60 })}<p class="xs muted">Removing a sport hides it from new bookings. Courts keep their layouts, and existing bookings are never changed.</p>${btn('Save sports', { type: 'submit', variant: 'primary' })}</form>`, { title: 'Sports offered' }) : ''}
  ${tab === 'profile' ? card(html`<form data-form="ven.profile" class="form-grid">${field({ name: 'name', label: 'Venue name', value: ven.name, required: true })}${field({ name: 'tagline', label: 'Tagline', value: ven.tagline })}<div class="full">${textarea({ name: 'description', label: 'Description', value: ven.description, rows: 4 })}</div>${field({ name: 'parking', label: 'Parking', value: ven.parking })}${field({ name: 'accessibility', label: 'Accessibility', value: ven.accessibility })}<div class="full">${textarea({ name: 'rules', label: 'Venue rules (one per line)', value: ven.rules.join('\n'), rows: 4 })}</div><div class="full"><span class="label">Amenities</span><div class="chips" style="margin-top:6px">${amen.map((a) => html`<label class="chip"><input type="checkbox" name="amenities" value="${a.code}"${ven.amenities.includes(a.code) ? html` checked` : ''} style="accent-color:var(--ck-color-primary)"/> ${a.label}</label>`)}</div></div><div class="full">${btn('Save profile', { type: 'submit', variant: 'primary' })}</div></form>`) : ''}
  ${tab === 'hours' ? html`<div class="split"><div>${card(html`<form data-form="ven.hours" class="stack-sm">${ven.hours.days.map((d, i) => html`<div class="row" style="flex-wrap:nowrap"><b style="width:44px">${DOW_SHORT[i]}</b><label class="check" style="margin:0"><input type="checkbox" name="open${i}"${d ? html` checked` : ''}/> Open</label><select name="o${i}" aria-label="${DOW_SHORT[i]} opens" style="width:auto">${minuteOptions(0, 1410).map((o) => html`<option value="${o.value}"${Number(o.value) === (d?.open ?? 360) ? html` selected` : ''}>${o.label}</option>`)}</select><span>–</span><select name="c${i}" aria-label="${DOW_SHORT[i]} closes" style="width:auto">${minuteOptions(30, 1440).map((o) => html`<option value="${o.value}"${Number(o.value) === (d?.close ?? 1380) ? html` selected` : ''}>${o.label}</option>`)}</select></div>`)}${btn('Save hours', { type: 'submit', variant: 'primary' })}</form>`, { title: 'Weekly hours', subtitle: 'Manila time' })}</div>
    <div class="stack">${card(html`<form data-form="ven.special" class="stack-sm">${field({ name: 'date', label: 'Date', type: 'date', value: addDays(localDate(app.store.now()), 7), required: true })}${select({ name: 'kind', label: 'Type', options: [{ value: 'closed', label: 'Closed all day' }, { value: 'holiday_hours', label: 'Holiday hours' }, { value: 'special_hours', label: 'Special hours' }] })}<div class="form-grid">${select({ name: 'open', label: 'Opens', value: '480', options: minuteOptions(0, 1410) })}${select({ name: 'close', label: 'Closes', value: '1200', options: minuteOptions(30, 1440) })}</div>${field({ name: 'reason', label: 'Reason (shown to players)', required: true, placeholder: 'e.g. Court resurfacing' })}${btn('Add', { type: 'submit', variant: 'secondary' })}</form>`, { title: 'Holidays, closures & special schedules' })}
    ${card(v.specialHours.length ? html`${v.specialHours.map((sp) => html`<div class="row-between" style="padding:6px 0"><span><b>${formatDateShort(sp.date)}</b> · ${sp.kind === 'closed' ? 'Closed' : `${formatMinuteOfDay(sp.open!)}–${formatMinuteOfDay(sp.close!)}`} · ${sp.reason}</span>${btn('Remove', { action: 'ven.special.remove', data: { id: sp.id }, variant: 'ghost', size: 'sm' })}</div>`)}` : empty('None scheduled'), { title: 'Scheduled' })}</div></div>` : ''}
  ${tab === 'rules' ? card(html`<form data-form="ven.rules" class="form-grid">${select({ name: 'incrementMinutes', label: 'Start-time increments', value: String(s.incrementMinutes), options: [30, 60, 90].map((n) => ({ value: String(n), label: `Every ${n} minutes` })) })}${select({ name: 'minDurationMinutes', label: 'Minimum booking', value: String(s.minDurationMinutes), options: [30, 60, 90, 120].map((n) => ({ value: String(n), label: formatDuration(n) })) })}${select({ name: 'maxDurationMinutes', label: 'Maximum booking', value: String(s.maxDurationMinutes), options: [120, 180, 240, 360].map((n) => ({ value: String(n), label: formatDuration(n) })) })}${select({ name: 'advanceBookingDays', label: 'Book up to', value: String(s.advanceBookingDays), options: [7, 14, 30, 60, 90].map((n) => ({ value: String(n), label: `${n} days ahead` })) })}${select({ name: 'minLeadMinutes', label: 'Minimum notice', value: String(s.minLeadMinutes), options: [0, 15, 30, 60, 120].map((n) => ({ value: String(n), label: n ? `${n} minutes` : 'None' })) })}${select({ name: 'bufferMinutes', label: 'Cleanup buffer between bookings', value: String(s.bufferMinutes), options: [0, 5, 10, 15, 30].map((n) => ({ value: String(n), label: n ? `${n} minutes` : 'None' })) })}${select({ name: 'holdTtlMinutes', label: 'Checkout hold time', value: String(s.holdTtlMinutes), options: [5, 10, 15].map((n) => ({ value: String(n), label: `${n} minutes` })) })}${select({ name: 'requireCheckIn', label: 'Check-in', value: s.requireCheckIn ? '1' : '0', options: [{ value: '0', label: 'Optional (bookings auto-complete)' }, { value: '1', label: 'Required' }] })}<div class="full">${btn('Save booking rules', { type: 'submit', variant: 'primary' })}</div></form>`, { title: 'Booking rules', subtitle: 'Enforced by the server on every booking request' }) : ''}
  ${tab === 'policy' ? html`<div class="split">${card(html`<form data-form="ven.policy" class="stack-sm">${(Object.keys(POLICY_LIBRARY) as (keyof typeof POLICY_LIBRARY)[]).filter((k) => k !== 'non_refundable').map((k) => html`<label class="method${ven.policyKey === k ? ' active' : ''}"><input type="radio" name="policyKey" value="${k}"${ven.policyKey === k ? html` checked` : ''} style="accent-color:var(--ck-color-primary)"/><span class="method-body"><b>${POLICY_LIBRARY[k].name}</b> <span class="xs muted">v${POLICY_LIBRARY[k].version}</span><span class="method-fee block">${describePolicy(POLICY_LIBRARY[k])[0]}</span></span></label>`)}<p class="xs muted">Changing the policy affects new bookings only — each booking keeps the version the player accepted.</p>${btn('Save policy', { type: 'submit', variant: 'primary' })}</form>`, { title: 'Cancellation policy' })}${card(html`<form data-form="ven.methods" class="stack-sm">${app.store.state.settings.platform!.feeSchedules.map((f) => checkbox({ name: 'methods', value: f.method, label: f.label, checked: ven.acceptedMethods.includes(f.method), hint: f.passThrough && !f.passThroughLockedReason ? 'Processing fee shown to players' : 'Fee covered by CourtKo' }))}${btn('Save payment methods', { type: 'submit', variant: 'primary' })}</form>`, { title: 'Accepted payment methods' })}</div>` : ''}</fieldset>`;
});
function newVenueForm(): SafeHtml {
  return html`<form data-form="ven.create" class="form-grid">${field({ name: 'name', label: 'Venue name', required: true })}${field({ name: 'line1', label: 'Street address', required: true })}${field({ name: 'barangay', label: 'Barangay', required: true })}${field({ name: 'city', label: 'City / municipality', required: true })}${field({ name: 'province', label: 'Province', required: true, value: 'Iloilo' })}<div class="form-grid full">${field({ name: 'lat', label: 'Map pin latitude', value: '10.6970', required: true })}${field({ name: 'lng', label: 'Map pin longitude', value: '122.5640', required: true })}</div><div class="full">${btn('Create venue', { type: 'submit', variant: 'primary' })}</div></form>`;
}
action('ven.tab', (el) => app.set('venTab', el.dataset.key));
action('ven.new', () => app.modal({ title: 'Add a venue', body: newVenueForm() }));
form('ven.create', async (fd) => {
  const v = await app.api.write('POST /v1/businesses/{businessId}/venues', { businessId: app.businessId!, name: str(fd, 'name'), line1: str(fd, 'line1'), barangay: str(fd, 'barangay'), city: str(fd, 'city'), province: str(fd, 'province'), lat: Number(str(fd, 'lat')), lng: Number(str(fd, 'lng')) });
  app.venueId = v.id;
  app.closeModal();
  app.toast('Venue created as a draft. Add courts and a standard rate, then publish.', 'success');
});
action('ven.publish', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/venues/{venueId}/publish', { businessId: app.businessId!, venueId: app.venueId!, publish: el.dataset.p === '1' }), { success: el.dataset.p === '1' ? 'Venue published' : 'Venue unpublished' });
});
form('ven.sports', async (fd) => {
  await app.api.write('PUT /v1/businesses/{businessId}/venues/{venueId}/sports', { businessId: app.businessId!, venueId: app.venueId!, sports: fd.getAll('sports').map(String), changeoverMinutes: Number(str(fd, 'changeover')) });
  app.toast('Sports updated', 'success');
});
form('ven.profile', async (fd) => {
  await app.api.write('PATCH /v1/businesses/{businessId}/venues/{venueId}', { businessId: app.businessId!, venueId: app.venueId!, name: str(fd, 'name'), tagline: str(fd, 'tagline'), description: str(fd, 'description'), parking: str(fd, 'parking'), accessibility: str(fd, 'accessibility'), rules: str(fd, 'rules').split('\n'), amenities: fd.getAll('amenities').map(String) });
  app.toast('Venue profile saved', 'success');
});
form('ven.hours', async (fd) => {
  const days = Array.from({ length: 7 }, (_, i) => (fd.get(`open${i}`) ? { open: Number(fd.get(`o${i}`)), close: Number(fd.get(`c${i}`)) } : null));
  await app.api.write('PUT /v1/businesses/{businessId}/venues/{venueId}/operating-hours', { businessId: app.businessId!, venueId: app.venueId!, hours: { days } });
  app.toast('Operating hours saved', 'success');
});
form('ven.special', async (fd) => {
  const kind = str(fd, 'kind') as never;
  const r = await app.api.write('POST /v1/businesses/{businessId}/venues/{venueId}/special-hours', { businessId: app.businessId!, venueId: app.venueId!, date: str(fd, 'date'), kind, open: Number(str(fd, 'open')), close: Number(str(fd, 'close')), reason: str(fd, 'reason') });
  app.toast(r.conflicts.length ? `Saved. ${r.conflicts.length} existing booking(s) fall outside the new hours: ${r.conflicts.map((c) => c.code).join(', ')} — contact or reschedule them.` : 'Special schedule saved', r.conflicts.length ? 'warning' : 'success');
});
action('ven.special.remove', async (el) => {
  await app.run(el, () => app.api.write('DELETE /v1/businesses/{businessId}/special-hours/{specialHoursId}', { businessId: app.businessId!, specialHoursId: el.dataset.id! }), { success: 'Removed' });
});
form('ven.rules', async (fd) => {
  await app.api.write('PUT /v1/businesses/{businessId}/venues/{venueId}/booking-rules', { businessId: app.businessId!, venueId: app.venueId!, settings: { incrementMinutes: Number(str(fd, 'incrementMinutes')) as never, minDurationMinutes: Number(str(fd, 'minDurationMinutes')), maxDurationMinutes: Number(str(fd, 'maxDurationMinutes')), advanceBookingDays: Number(str(fd, 'advanceBookingDays')), minLeadMinutes: Number(str(fd, 'minLeadMinutes')), bufferMinutes: Number(str(fd, 'bufferMinutes')), holdTtlMinutes: Number(str(fd, 'holdTtlMinutes')), requireCheckIn: str(fd, 'requireCheckIn') === '1' } });
  app.toast('Booking rules saved', 'success');
});
form('ven.policy', async (fd) => {
  await app.api.write('PATCH /v1/businesses/{businessId}/venues/{venueId}', { businessId: app.businessId!, venueId: app.venueId!, policyKey: str(fd, 'policyKey') as never });
  app.toast('Policy saved for new bookings', 'success');
});
form('ven.methods', async (fd) => {
  await app.api.write('PATCH /v1/businesses/{businessId}/venues/{venueId}', { businessId: app.businessId!, venueId: app.venueId!, acceptedMethods: fd.getAll('methods').map(String) as never });
  app.toast('Payment methods saved', 'success');
});

// ---------------------------------------------------------------- pricing

bizRoute('/biz/pricing', 'Pricing', (_ctx, b) => {
  const data = app.api.read('GET /v1/businesses/{businessId}/pricing-rules', { businessId: b.businessId, venueId: b.venueId });
  const promos = app.api.read('GET /v1/businesses/{businessId}/promotions', { businessId: b.businessId });
  const sim = app.ui.sim as ReadResult<'GET /v1/businesses/{businessId}/pricing-rules/preview'> | undefined;
  const canEdit = b.perms.has('pricing.manage');
  const when = (r: (typeof data.rules)[number]) => [r.conditions.daysOfWeek?.length ? r.conditions.daysOfWeek.map((d) => DOW_SHORT[d]).join(' ') : '', r.conditions.startMinute !== undefined ? `${formatMinuteOfDay(r.conditions.startMinute)}–${formatMinuteOfDay(r.conditions.endMinute ?? 1440)}` : '', r.conditions.holidaysOnly ? 'Holidays' : '', r.conditions.dateFrom ? `${r.conditions.dateFrom} → ${r.conditions.dateTo ?? '…'}` : ''].filter(Boolean).join(' · ') || 'Always';
  const effect = (r: (typeof data.rules)[number]) => (r.effect.type === 'rate' ? `${formatPHP(r.effect.ratePerHour, { compact: true })}/hr` : r.effect.type === 'adjust_percent' ? `${r.effect.percentPpm > 0 ? '+' : '−'}${formatPpm(Math.abs(r.effect.percentPpm))}` : `${r.effect.amountPerHour > 0 ? '+' : '−'}${formatPHP(Math.abs(r.effect.amountPerHour), { compact: true })}/hr`);
  const date = addDays(localDate(app.store.now()), 1);
  return html`${pageHeader('Pricing', { subtitle: `${data.venue.name} · highest priority wins; adjustments apply on top of the winning rate`, actions: canEdit ? btn('New rule', { action: 'rule.edit', variant: 'primary', icon: 'plus' }) : '' })}
  <div class="split"><div class="stack">${card(html`<div class="table-wrap"><table class="table"><thead><tr><th class="num">Priority</th><th>Rule</th><th>Sport</th><th>When</th><th>Courts</th><th class="num">Price</th><th></th></tr></thead><tbody>${data.rules.map((r) => html`<tr><td class="num"><b>${r.priority}</b></td><td><b>${r.name}</b><div class="xs muted">${RULE_KIND_LABEL[r.kind]} · v${r.version}${r.minChargeCentavos ? ` · min ${formatPHP(r.minChargeCentavos, { compact: true })}` : ''}</div></td><td class="small">${r.sports?.length ? r.sports.map((x) => sportName(x)).join(', ') : 'All'}</td><td class="small">${when(r)}</td><td class="small">${r.courtIds ? data.courts.filter((c) => r.courtIds!.includes(c.id)).map((c) => c.name).join(', ') : 'All'}</td><td class="num"><b>${effect(r)}</b></td><td class="right">${canEdit ? html`${btn('Edit', { action: 'rule.edit', data: { id: r.id }, variant: 'ghost', size: 'sm' })}${btn('Archive', { action: 'rule.archive', data: { id: r.id }, variant: 'ghost', size: 'sm' })}` : ''}</td></tr>`)}</tbody></table></div>`, { title: 'Rate rules', pad: false })}
  ${card(html`${data.history.slice(0, 8).map((h) => html`<div class="row-between small" style="padding:5px 0;border-bottom:1px solid var(--ck-slate-100)"><span>${h.change} <b>${h.snapshot.name}</b> v${h.version}</span><span class="muted">${formatDateShort(h.changedAt)}</span></div>`)}<p class="xs muted" style="margin-top:8px">Every change is versioned and audited. Confirmed bookings keep an immutable price snapshot, so edits never change past receipts.</p>`, { title: 'Change history' })}</div>
  <div class="stack">${card(html`<form data-form="sim" class="stack-sm">${select({ name: 'courtId', label: 'Court', options: data.courts.map((c) => ({ value: c.id, label: c.name })) })}${field({ name: 'start', label: 'Start', type: 'datetime-local', value: `${date}T17:30`, step: 1800 })}${select({ name: 'duration', label: 'Duration', value: '90', options: [60, 90, 120, 180].map((d) => ({ value: String(d), label: formatDuration(d) })) })}${select({ name: 'method', label: 'Payment method', value: 'gcash', options: app.store.state.settings.platform!.feeSchedules.map((f) => ({ value: f.method, label: f.label })) })}${btn('Simulate price', { type: 'submit', variant: 'secondary', icon: 'play' })}</form>
    ${sim ? html`<hr/>${sim.segments.map((s) => html`<div class="row-between small" style="padding:4px 0"><span>${formatTimeRange(s.startMs, s.endMs)} · ${s.rateRule}${s.adjustRule ? ` + ${s.adjustRule}` : ''}</span><b>${formatPHP(s.amount)}</b></div>`)}${priceBreakdown(sim.lines, sim.quote.total, { totalLabel: 'Player pays' })}${dl([[`Commission (${sim.quote.commission.label})`, formatPHP(sim.quote.commission.amount)], ['You receive', html`<b>${formatPHP(sim.quote.venueNet)}</b>`]])}` : html`<p class="xs muted">See exactly what a player would pay — per slice — before you publish a change.</p>`}`, { title: 'Price simulator' })}
  ${card(html`${promos.map((p) => html`<div class="row-between" style="padding:6px 0;border-bottom:1px solid var(--ck-slate-100)"><div><code>${p.code}</code> <b class="small">${p.name}</b><div class="xs muted">${p.type === 'percent' ? formatPpm(p.value) : formatPHP(p.value)} off · used ${p.usedCount}/${p.usageLimit ?? '∞'} · until ${formatDateShort(p.validTo)} · venue-funded</div></div>${pill(p.status)}</div>`)}${b.perms.has('promotions.manage') ? html`<form data-form="promo.create" class="form-grid" style="margin-top:10px">${field({ name: 'code', label: 'Code', placeholder: 'SUMMER20', required: true })}${field({ name: 'value', label: 'Amount off (₱)', placeholder: '50', required: true })}${field({ name: 'name', label: 'Description', required: true, placeholder: '₱50 off weekday mornings' })}${field({ name: 'limit', label: 'Usage limit', value: '100' })}<div class="full">${btn('Create promo', { type: 'submit', variant: 'secondary' })}</div></form>` : ''}<p class="xs muted">Venue-funded discounts reduce your commissionable base; platform-funded promos (like WELCOME10) don't reduce what you receive.</p>`, { title: 'Promo codes' })}</div></div>`;
});
form('sim', async (fd) => {
  const r = app.api.read('GET /v1/businesses/{businessId}/pricing-rules/preview', { businessId: app.businessId!, venueId: app.venueId!, courtId: str(fd, 'courtId'), startMs: parseLocal(str(fd, 'start')), durationMinutes: Number(str(fd, 'duration')), method: str(fd, 'method') });
  app.set('sim', r);
});
action('rule.edit', (el) => {
  const data = app.api.read('GET /v1/businesses/{businessId}/pricing-rules', { businessId: app.businessId!, venueId: app.venueId! });
  const r = el.dataset.id ? data.rules.find((x) => x.id === el.dataset.id) : undefined;
  const e = r?.effect;
  const effectType = e?.type ?? 'rate';
  const effectValue = !e ? '500' : e.type === 'rate' ? (e.ratePerHour / 100).toString() : e.type === 'adjust_percent' ? (e.percentPpm / 10_000).toString() : (e.amountPerHour / 100).toString();
  app.modal({
    title: r ? `Edit “${r.name}”` : 'New pricing rule',
    wide: true,
    body: html`<form data-form="rule.save" data-id="${r?.id ?? ''}" class="form-grid">${field({ name: 'name', label: 'Rule name', value: r?.name ?? 'Weekday lunch special', required: true })}${select({ name: 'kind', label: 'Type', value: r?.kind ?? 'promotional', options: (Object.keys(RULE_KIND_LABEL) as RuleKind[]).map((k) => ({ value: k, label: RULE_KIND_LABEL[k] })) })}
    ${select({ name: 'effectType', label: 'Effect', value: effectType, options: [{ value: 'rate', label: 'Set hourly rate (₱)' }, { value: 'adjust_percent', label: 'Adjust by % (e.g. −15)' }, { value: 'adjust_amount', label: 'Adjust by ₱ per hour' }] })}${field({ name: 'value', label: 'Value', value: effectValue, required: true })}
    ${field({ name: 'priority', label: 'Priority (0–100)', type: 'number', value: r?.priority ?? 25, min: 0, max: 100 })}${field({ name: 'minCharge', label: 'Minimum charge (₱, optional)', value: r?.minChargeCentavos ? String(r.minChargeCentavos / 100) : '' })}
    <div class="full"><span class="label">Days</span><div class="chips" style="margin-top:6px">${DOW_SHORT.map((d, i) => html`<label class="chip"><input type="checkbox" name="days" value="${i}"${r?.conditions.daysOfWeek?.includes(i) ?? (i > 0 && i < 6) ? html` checked` : ''}/> ${d}</label>`)}</div></div>
    ${select({ name: 'startMinute', label: 'From', value: String(r?.conditions.startMinute ?? 660), options: [{ value: '', label: 'Any time' }, ...minuteOptions(0, 1410)] })}${select({ name: 'endMinute', label: 'Until', value: String(r?.conditions.endMinute ?? 780), options: [{ value: '', label: 'Any time' }, ...minuteOptions(30, 1440)] })}
    ${field({ name: 'dateFrom', label: 'Effective from (optional)', type: 'date', value: r?.conditions.dateFrom ?? '' })}${field({ name: 'dateTo', label: 'Effective until (optional)', type: 'date', value: r?.conditions.dateTo ?? '' })}
    <div class="full"><span class="label">Sports</span><div class="chips" style="margin-top:6px">${(data.venue.sports ?? ['pickleball']).map((x) => html`<label class="chip"><input type="checkbox" name="sports" value="${x}"${r?.sports?.includes(x) ? html` checked` : ''}/> ${sportName(x)}</label>`)}</div><p class="hint">Sport-specific rates beat venue-wide rates at the same priority. Leave unchecked for every sport.</p></div>
    <div class="full"><span class="label">Courts</span><div class="chips" style="margin-top:6px">${data.courts.filter((c) => c.status === 'active').map((c) => html`<label class="chip"><input type="checkbox" name="courts" value="${c.id}"${r?.courtIds?.includes(c.id) ? html` checked` : ''}/> ${c.name}</label>`)}</div><p class="hint">Leave all unchecked to apply to every court.</p></div>
    <div class="full">${checkbox({ name: 'holidaysOnly', label: 'Public holidays only', checked: !!r?.conditions.holidaysOnly })}${checkbox({ name: 'nonRefundable', label: 'Non-refundable rate (players see this before paying)', checked: !!r?.nonRefundable })}</div>
    <div class="full">${btn('Save rule', { type: 'submit', variant: 'primary' })}</div></form>`,
  });
});
form('rule.save', async (fd, f) => {
  const type = str(fd, 'effectType');
  const raw = str(fd, 'value');
  const effect = type === 'rate' ? { type: 'rate' as const, ratePerHour: parsePesoInput(raw) ?? 0 } : type === 'adjust_percent' ? { type: 'adjust_percent' as const, percentPpm: Math.round(Number(raw) * 10_000) } : { type: 'adjust_amount' as const, amountPerHour: Math.round(Number(raw) * 100) };
  const courts = fd.getAll('courts').map(String);
  const sm = str(fd, 'startMinute');
  const em = str(fd, 'endMinute');
  await app.api.write('PUT /v1/businesses/{businessId}/pricing-rules', {
    businessId: app.businessId!,
    venueId: app.venueId!,
    ...(f.dataset.id ? { ruleId: f.dataset.id } : {}),
    name: str(fd, 'name'),
    kind: str(fd, 'kind') as RuleKind,
    courtIds: courts.length ? courts : null,
    sports: fd.getAll('sports').map(String),
    effect,
    conditions: { daysOfWeek: fd.getAll('days').map(Number), ...(sm ? { startMinute: Number(sm) } : {}), ...(em ? { endMinute: Number(em) } : {}), ...(str(fd, 'dateFrom') ? { dateFrom: str(fd, 'dateFrom') } : {}), ...(str(fd, 'dateTo') ? { dateTo: str(fd, 'dateTo') } : {}), ...(fd.get('holidaysOnly') ? { holidaysOnly: true } : {}) },
    priority: Number(str(fd, 'priority')),
    ...(str(fd, 'minCharge') ? { minChargeCentavos: parsePesoInput(str(fd, 'minCharge')) ?? 0 } : {}),
    nonRefundable: !!fd.get('nonRefundable'),
  });
  app.closeModal();
  app.toast('Pricing rule saved (new version recorded in the audit log).', 'success');
});
action('rule.archive', async (el) => {
  const ok = await app.confirm({ title: 'Archive this rule?', body: 'It stops applying to new bookings immediately. Existing bookings keep their price.', confirmLabel: 'Archive rule', danger: true });
  if (ok) await app.run(el, () => app.api.write('DELETE /v1/businesses/{businessId}/pricing-rules/{ruleId}', { businessId: app.businessId!, ruleId: el.dataset.id! }), { success: 'Rule archived' });
});
form('promo.create', async (fd) => {
  const now = app.store.now();
  await app.api.write('PUT /v1/businesses/{businessId}/promotions', { businessId: app.businessId!, code: str(fd, 'code'), name: str(fd, 'name'), type: 'fixed', value: parsePesoInput(str(fd, 'value')) ?? 0, appliesTo: 'court', validFrom: now, validTo: now + 60 * DAY, usageLimit: Number(str(fd, 'limit')) || null, perUserLimit: 1 });
  app.toast('Promo code created', 'success');
});

// ---------------------------------------------------------------- events

bizRoute('/biz/events', 'Events', (_ctx, b) => {
  const list = app.api.read('GET /v1/businesses/{businessId}/events', { businessId: b.businessId });
  const open = app.ui.evOpen as string | undefined;
  const regs = open ? app.api.read('GET /v1/businesses/{businessId}/events/{eventId}/registrations', { businessId: b.businessId, eventId: open }) : [];
  return html`${pageHeader('Events', { actions: b.perms.has('events.manage') ? btn('Create event', { action: 'ev.new', variant: 'primary', icon: 'plus' }) : '' })}
  <div class="split"><div class="stack-sm">${list.map((e) => { const cap = e.divisions.reduce((a, d) => a + d.division.capacity, 0); const taken = e.divisions.reduce((a, d) => a + d.taken, 0); return html`<div class="card"><div class="card-body"><div class="row-between"><div><b>${e.event.name}</b> ${pill(e.event.status)}<div class="small muted">${e.event.type.replace('_', ' ')} · ${formatDateShort(e.event.startMs)} ${formatTimeRange(e.event.startMs, e.event.endMs)} · ${e.venue.name}</div></div><div class="row">${e.event.status === 'draft' && b.perms.has('events.manage') ? btn('Publish', { action: 'ev.publish', data: { id: e.event.id }, variant: 'primary', size: 'sm' }) : ''}${btn('Registrations', { action: 'ev.open', data: { id: e.event.id }, variant: 'secondary', size: 'sm' })}${e.event.status === 'published' && b.perms.has('events.manage') ? btn('Cancel', { action: 'ev.cancel', data: { id: e.event.id }, variant: 'ghost', size: 'sm' }) : ''}</div></div><div class="bar-inline" style="margin-top:10px"><span style="width:${Math.min(100, (taken / Math.max(1, cap)) * 100)}%"></span></div><div class="xs muted" style="margin-top:4px">${taken}/${cap} registered · ${e.divisions.reduce((a, d) => a + d.waitlist, 0)} waitlisted</div></div></div>`; })}${list.length ? '' : empty('No events yet', undefined, undefined, 'trophy')}</div>
  <div>${open ? card(regs.length ? html`${regs.map((r) => html`<div class="row-between" style="padding:6px 0;border-bottom:1px solid var(--ck-slate-100)"><div><b class="small">${r.player}</b>${r.registration.partnerName ? html` <span class="xs muted">+ ${r.registration.partnerName}</span>` : ''}<div class="xs muted">${r.division}${r.registration.waitlistPosition ? ` · waitlist #${r.registration.waitlistPosition}` : ''}</div></div><div class="row">${pill(r.registration.status)}${r.registration.status === 'confirmed' && b.perms.has('events.check_in') ? btn('Check in', { action: 'reg.checkin', data: { id: r.registration.id }, variant: 'ghost', size: 'sm' }) : ''}</div></div>`)}` : empty('No registrations yet'), { title: 'Registrations' }) : card(html`<p class="small muted">Select an event to see registrations and check players in. Seats are held during checkout so events can't be oversold; when someone withdraws, the next waitlisted player gets a 2-hour offer automatically.</p>`, { title: 'How capacity works' })}</div></div>`;
});
action('ev.open', (el) => app.set('evOpen', el.dataset.id));
action('ev.publish', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/events/{eventId}/publish', { businessId: app.businessId!, eventId: el.dataset.id! }), { success: 'Event published — courts reserved on the calendar.' });
});
action('ev.cancel', async (el) => {
  const reason = window.prompt('Reason (sent to all participants):', 'Weather advisory — rescheduling soon');
  if (!reason) return;
  const r = await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/events/{eventId}/cancel', { businessId: app.businessId!, eventId: el.dataset.id!, reason }, { idempotencyKey: app.idem() }));
  if (r) app.toast(`Event cancelled. Full refunds submitted: ${formatPHP(r.refunded)}.`, 'success');
});
action('reg.checkin', async (el) => {
  await app.run(el, () => app.api.write('POST /v1/businesses/{businessId}/registrations/{registrationId}/check-in', { businessId: app.businessId!, registrationId: el.dataset.id! }), { success: 'Checked in' });
});
action('ev.new', () => {
  const v = app.api.read('GET /v1/businesses/{businessId}/venues', { businessId: app.businessId! }).find((x) => x.venue.id === app.venueId)!;
  const d = addDays(localDate(app.store.now()), 10);
  app.modal({ title: 'Create event', wide: true, body: html`<form data-form="ev.create" class="form-grid">${field({ name: 'name', label: 'Event name', value: 'Sunday Doubles Round-Robin', required: true })}${select({ name: 'type', label: 'Type', value: 'tournament', options: app.store.state.settings.platform!.eventTypes.map((t) => ({ value: t.code, label: t.label })) })}${select({ name: 'sport', label: 'Sport', value: v.venue.sports?.[0] ?? 'pickleball', options: (v.venue.sports?.length ? v.venue.sports : ['pickleball']).map((x) => ({ value: x, label: sportName(x) })) })}<div class="full">${textarea({ name: 'description', label: 'Description', value: 'Friendly round-robin — partners rotate every game.' })}</div>${field({ name: 'start', label: 'Starts', type: 'datetime-local', value: `${d}T15:00` })}${field({ name: 'end', label: 'Ends', type: 'datetime-local', value: `${d}T18:00` })}${field({ name: 'fee', label: 'Fee per player (₱)', value: '350' })}${field({ name: 'capacity', label: 'Capacity', type: 'number', value: 16, min: 2 })}<div class="full"><span class="label">Courts to reserve</span><div class="chips" style="margin-top:6px">${v.courts.map((c, i) => html`<label class="chip"><input type="checkbox" name="courts" value="${c.id}"${i < 2 ? html` checked` : ''}/> ${c.name}</label>`)}</div></div><div class="full">${checkbox({ name: 'waitlist', label: 'Enable waitlist', checked: true })}</div><div class="full">${btn('Create draft', { type: 'submit', variant: 'primary' })}</div></form>` });
});
form('ev.create', async (fd) => {
  const startMs = parseLocal(str(fd, 'start'));
  await app.api.write('PUT /v1/businesses/{businessId}/events', { businessId: app.businessId!, venueId: app.venueId!, sport: str(fd, 'sport'), type: str(fd, 'type') as never, name: str(fd, 'name'), description: str(fd, 'description'), startMs, endMs: parseLocal(str(fd, 'end')), courtIds: fd.getAll('courts').map(String), organizer: '', fee: parsePesoInput(str(fd, 'fee')) ?? 0, divisions: [{ name: 'Open', skill: 'All levels', capacity: Number(str(fd, 'capacity')), format: 'open' }], registrationOpensAt: app.store.now(), registrationClosesAt: startMs - 2 * HOUR, waitlistEnabled: !!fd.get('waitlist'), visibility: 'public', rules: 'Games to 11, win by 2.', prizes: '', format: 'Round-robin', teamBased: false });
  app.closeModal();
  app.toast('Draft created. Publish it to reserve the courts and open registration.', 'success');
});

// ---------------------------------------------------------------- products

bizRoute('/biz/products', 'Products', (_ctx, b) => {
  const list = app.api.read('GET /v1/businesses/{businessId}/products', { businessId: b.businessId, venueId: b.venueId });
  return html`${pageHeader('Products & inventory', { subtitle: 'Drinks, rentals and gear for pickup at the counter', actions: b.perms.has('products.manage') ? btn('Add product', { action: 'prod.new', variant: 'primary', icon: 'plus' }) : '' })}
  ${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th class="num">Price</th><th>Sold as</th><th class="num">On hand</th><th class="num">Reserved</th><th class="num">Available</th><th></th></tr></thead><tbody>${list.map((p) => html`<tr><td><div class="row">${productTile(p.product.art, 36)}<div><b>${p.product.name}</b>${p.product.variants.length ? html`<div class="xs muted">${p.variants.map((v) => `${v.variant.name}: ${v.stock.available}`).join(' · ')}</div>` : ''}</div></div></td><td class="num">${formatPHP(p.product.price)}</td><td class="small">${[p.product.fulfillment.bookingAddOn && 'Booking add-on', p.product.fulfillment.eventAddOn && 'Event add-on', p.product.fulfillment.standalone && 'Pickup order'].filter(Boolean).join(', ')}</td><td class="num">${p.stock.onHand}</td><td class="num">${p.stock.reserved}</td><td class="num">${p.stock.available <= 5 ? tag(String(p.stock.available), 'warning') : p.stock.available}</td><td class="right">${b.perms.has('inventory.manage') ? btn('Adjust stock', { action: 'prod.adjust', data: { id: p.product.id, v: p.product.variants[0]?.id ?? '' }, variant: 'ghost', size: 'sm' }) : ''}</td></tr>`)}</tbody></table></div>`, { pad: false })}
  <p class="xs muted" style="margin-top:8px">Stock is an append-only movement log. Items are reserved when a checkout starts, so they can't sell out mid-payment; stock can't be reduced below what is reserved.</p>`;
});
action('prod.adjust', (el) => app.modal({ title: 'Adjust stock', body: html`<form data-form="prod.adjust" data-id="${el.dataset.id}" data-v="${el.dataset.v ?? ''}" class="stack-sm">${field({ name: 'delta', label: 'Change (e.g. 24 or −3)', type: 'number', value: 24, required: true })}${field({ name: 'note', label: 'Reason', required: true, value: 'Delivery from supplier' })}${btn('Record movement', { type: 'submit', variant: 'primary', block: true })}</form>` }));
form('prod.adjust', async (fd, f) => {
  const r = await app.api.write('POST /v1/businesses/{businessId}/products/{productId}/inventory-adjustments', { businessId: app.businessId!, productId: f.dataset.id!, variantId: f.dataset.v || null, delta: Number(str(fd, 'delta')), note: str(fd, 'note') });
  app.closeModal();
  app.toast(`Stock updated — ${r.available} available`, 'success');
});
action('prod.new', () => app.modal({ title: 'Add product', body: html`<form data-form="prod.create" class="stack-sm">${field({ name: 'name', label: 'Name', required: true, value: 'Coconut water' })}<div class="form-grid">${field({ name: 'price', label: 'Price (₱)', value: '70', required: true })}${select({ name: 'category', label: 'Category', options: ['drinks', 'food', 'rental', 'balls', 'merch', 'equipment', 'service'].map((c) => ({ value: c, label: c })) })}</div>${field({ name: 'stock', label: 'Opening stock', type: 'number', value: 48 })}${checkbox({ name: 'addon', label: 'Offer as a booking add-on', checked: true })}${checkbox({ name: 'standalone', label: 'Allow standalone pickup orders', checked: true })}${btn('Create product', { type: 'submit', variant: 'primary', block: true })}</form>` }));
form('prod.create', async (fd) => {
  await app.api.write('PUT /v1/businesses/{businessId}/products', { businessId: app.businessId!, venueId: app.venueId!, name: str(fd, 'name'), description: '', category: str(fd, 'category') as never, price: parsePesoInput(str(fd, 'price')) ?? 0, variants: [], maxPerOrder: 8, fulfillment: { pickup: true, bookingAddOn: !!fd.get('addon'), eventAddOn: !!fd.get('addon'), standalone: !!fd.get('standalone') }, pickupInstructions: 'Front desk', taxable: true, status: 'active', initialStock: Number(str(fd, 'stock')) });
  app.closeModal();
  app.toast('Product created', 'success');
});

// ---------------------------------------------------------------- staff & roles

bizRoute('/biz/staff', 'Staff & roles', (_ctx, b) => {
  const data = app.api.read('GET /v1/businesses/{businessId}/members', { businessId: b.businessId });
  const tab = app.state<string>('staffTab', 'team');
  const mine = new Set(data.myPermissions);
  const groups = [...new Set(BUSINESS_PERMISSIONS.map((p) => p.group))];
  return html`${pageHeader('Staff & roles', { subtitle: 'Least privilege: give each person only what their job needs.', actions: btn('Invite staff', { action: 'staff.invite', variant: 'primary', icon: 'plus' }) })}${tabs([{ key: 'team', label: 'Team', count: data.members.length }, { key: 'roles', label: 'Roles & permissions', count: data.roles.length }], tab, 'staff.tab')}
  ${tab === 'team' ? card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Roles</th><th>Venues</th><th>MFA</th><th>Status</th><th></th></tr></thead><tbody>${data.members.map((m) => html`<tr><td><b>${m.name}</b><div class="xs muted">${m.member.title} · ${m.contact}</div></td><td>${m.roles.map((r) => tag(r.name, r.system ? 'info' : 'event'))}</td><td class="small">${m.venues ? m.venues.join(', ') : 'All venues'}</td><td>${m.mfa ? tag('On', 'success') : tag('Off', 'warning')}</td><td>${pill(m.member.status)}</td><td class="right">${btn('Edit access', { action: 'staff.edit', data: { id: m.member.id }, variant: 'ghost', size: 'sm' })}</td></tr>`)}</tbody></table></div>`, { pad: false }) : ''}
  ${tab === 'roles' ? html`<div class="stack">${card(html`<div class="table-wrap"><table class="table"><thead><tr><th>Permission</th>${data.roles.map((r) => html`<th class="center" title="${r.description}">${r.name.replace('Product / Inventory Manager', 'Inventory')}</th>`)}</tr></thead><tbody>${groups.map((g) => html`<tr><td colspan="${data.roles.length + 1}" class="xs" style="background:var(--ck-slate-50);font-weight:700;text-transform:uppercase;letter-spacing:.05em">${g}</td></tr>${BUSINESS_PERMISSIONS.filter((p) => p.group === g).map((p) => html`<tr><td><span class="small">${p.label}</span> <code class="xs">${p.code}</code>${p.risk === 'high' || p.risk === 'critical' ? html` ${tag(p.risk, 'danger')}` : ''}</td>${data.roles.map((r) => html`<td class="center">${r.permissions.includes(p.code) ? icon('check', 16, 'granted') : html`<span class="muted">—</span>`}</td>`)}</tr>`)}`)}</tbody></table></div>`, { title: 'Permission matrix', pad: false })}
    ${card(html`<form data-form="role.create" class="stack-sm">${field({ name: 'name', label: 'Role name', value: 'Weekend Supervisor', required: true })}${field({ name: 'description', label: 'Description', value: 'Front desk plus court blocks on weekends' })}<div class="grid g3">${BUSINESS_PERMISSIONS.map((p) => { const blocked = !mine.has(p.code) || (OWNER_ONLY_PERMISSIONS as string[]).includes(p.code); return html`<label class="check small" style="margin:2px 0;opacity:${blocked ? 0.45 : 1}" title="${blocked ? 'You can only grant permissions you hold; owner-only permissions cannot go into custom roles.' : ''}"><input type="checkbox" name="perms" value="${p.code}"${blocked ? html` disabled` : ''}${['bookings.view', 'bookings.check_in', 'courts.block'].includes(p.code) ? html` checked` : ''}/> ${p.label}</label>`; })}</div>${btn('Create custom role', { type: 'submit', variant: 'primary' })}</form>`, { title: 'Create a custom role', subtitle: 'Greyed-out permissions can’t be granted by you (privilege-escalation guard).' })}</div>` : ''}`;
});
action('staff.tab', (el) => app.set('staffTab', el.dataset.key));
action('staff.invite', () => {
  const data = app.api.read('GET /v1/businesses/{businessId}/members', { businessId: app.businessId! });
  const venues = app.api.read('GET /v1/businesses/{businessId}/venues', { businessId: app.businessId! });
  app.modal({ title: 'Invite a team member', body: html`<form data-form="staff.invite" class="stack-sm">${field({ name: 'email', label: 'Their CourtKo email', type: 'email', required: true, value: 'bea.santiago@example.com', hint: 'They must have a CourtKo account (demo: Bea is a player persona).' })}${field({ name: 'title', label: 'Job title', value: 'Front Desk (weekends)' })}${select({ name: 'roleId', label: 'Role', options: data.roles.filter((r) => r.key !== 'business_owner').map((r) => ({ value: r.id, label: r.name })) })}${select({ name: 'venueId', label: 'Venue access', options: [{ value: '', label: 'All venues' }, ...venues.map((v) => ({ value: v.venue.id, label: v.venue.name }))] })}${btn('Send invitation', { type: 'submit', variant: 'primary', block: true })}</form>` });
});
form('staff.invite', async (fd) => {
  await app.api.write('POST /v1/businesses/{businessId}/members', { businessId: app.businessId!, email: str(fd, 'email'), roleIds: [str(fd, 'roleId')], venueIds: str(fd, 'venueId') ? [str(fd, 'venueId')] : null, title: str(fd, 'title') });
  app.closeModal();
  app.toast('Invitation sent. They accept it from their notifications.', 'success');
});
action('staff.edit', (el) => {
  const data = app.api.read('GET /v1/businesses/{businessId}/members', { businessId: app.businessId! });
  const m = data.members.find((x) => x.member.id === el.dataset.id)!;
  app.modal({ title: `Access for ${m.name}`, body: html`<form data-form="staff.update" data-id="${m.member.id}" class="stack-sm">${data.roles.map((r) => checkbox({ name: 'roles', value: r.id, label: r.name, checked: m.member.roleIds.includes(r.id), hint: r.description }))}${select({ name: 'status', label: 'Status', value: m.member.status, options: [{ value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended (signs them out now)' }] })}${btn('Save access', { type: 'submit', variant: 'primary', block: true })}</form>`, actions: btn('Remove from team', { action: 'staff.remove', data: { id: m.member.id }, variant: 'danger' }) });
});
form('staff.update', async (fd, f) => {
  await app.api.write('PATCH /v1/businesses/{businessId}/members/{memberId}', { businessId: app.businessId!, memberId: f.dataset.id!, roleIds: fd.getAll('roles').map(String), status: str(fd, 'status') as never });
  app.closeModal();
  app.toast('Access updated (audited)', 'success');
});
action('staff.remove', async (el) => {
  const ok = await app.confirm({ title: 'Remove this person?', body: 'They lose access to your business immediately.', confirmLabel: 'Remove', danger: true });
  if (ok) {
    await app.run(el, () => app.api.write('DELETE /v1/businesses/{businessId}/members/{memberId}', { businessId: app.businessId!, memberId: el.dataset.id! }), { success: 'Removed from team' });
    app.closeModal();
  }
});
form('role.create', async (fd) => {
  await app.api.write('PUT /v1/businesses/{businessId}/roles', { businessId: app.businessId!, name: str(fd, 'name'), description: str(fd, 'description'), permissions: fd.getAll('perms').map(String) });
  app.toast('Custom role created', 'success');
});

// ---------------------------------------------------------------- settings

bizRoute('/biz/settings', 'Settings', (_ctx, b) => {
  const ov = app.api.read('GET /v1/businesses/{businessId}', { businessId: b.businessId });
  const biz = ov.business;
  return html`${pageHeader('Business settings')}<div class="split"><div>${card(html`<form data-form="biz.profile" class="form-grid">${field({ name: 'tradeName', label: 'Trade name', value: biz.tradeName })}${field({ name: 'contactEmail', label: 'Business email', value: biz.contactEmail, type: 'email' })}${field({ name: 'contactPhone', label: 'Business mobile', value: biz.contactPhone })}<div class="full">${textarea({ name: 'description', label: 'About the business', value: biz.description })}</div><div class="full">${checkbox({ name: 'vat', label: 'VAT-registered (prices include 12% VAT; shown as a separate line)', checked: biz.vatRegistered })}</div><div class="full">${btn('Save', { type: 'submit', variant: 'primary' })}</div></form>`, { title: 'Profile' })}</div>
  <div class="stack">${card(dl([['Registered name', biz.legalName], ['Registration no.', biz.registrationNo], ['TIN', biz.tinMasked], ['Status', pill(biz.status)], ['Approved', biz.approvedAt ? formatDateLong(biz.approvedAt) : '—'], ['Settlement model', biz.settlementModel === 'provider_split' ? 'Provider split (sub-account)' : 'Platform payout']]), { title: 'Verified details', subtitle: 'Contact CourtKo to change verified details.' })}
  ${card(html`<p class="small">Two-step verification is <b>required</b> for owners and managers. Sensitive actions (refund approvals, payout account, roles, pricing) ask for a verified session.</p>${btn('Security settings', { href: '#/app/settings', variant: 'secondary', icon: 'shield' })}`, { title: 'Security' })}</div></div>`;
});
form('biz.profile', async (fd) => {
  await app.api.write('PATCH /v1/businesses/{businessId}', { businessId: app.businessId!, tradeName: str(fd, 'tradeName'), contactEmail: str(fd, 'contactEmail'), contactPhone: str(fd, 'contactPhone'), description: str(fd, 'description'), vatRegistered: !!fd.get('vat') });
  app.toast('Saved', 'success');
});

