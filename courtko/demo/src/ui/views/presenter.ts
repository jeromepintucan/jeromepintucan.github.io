/**
 * PRESENTER PANEL (demo only): switch personas, open side-by-side tabs, time travel, provider/webhook
 * simulations, concurrency demo, forged webhook, API inspector and event feed, reset data.
 */

import { addDays, formatDateTime, formatTime, HOUR, DAY, localDate, localToInstant } from '../../domain/time.ts';
import { Api } from '../../services/api.ts';
import { runJobs, runPayoutsNow, travel } from '../../services/jobs.ts';
import { PERSONAS } from '../../services/seed.ts';
import { action, app, onChange } from '../app.ts';
import { btn, toggle } from '../components.ts';
import { html } from '../html.ts';
import { icon } from '../icons.ts';
import { landingFor, signedIn } from './auth.ts';

function panel(): string {
  const open = app.state('presOpen', false);
  if (!open) return html`<button class="pres-fab" data-action="pres.toggle" aria-expanded="false">${icon('play', 16)} Demo controls</button>`.value;
  const me = app.me();
  const demo = app.store.state.settings.platform!.demo;
  const offset = app.store.state.meta.clockOffsetMs;
  const now = app.store.now();
  const ageDays = Math.floor((Date.now() - app.store.state.meta.seededAt) / DAY);
  const tab = app.state<string>('presTab', 'people');
  const log = app.api.log.slice(0, 40);
  return html`<div class="pres-panel" role="dialog" aria-label="Demo controls">
    <div class="pres-head"><span><b>Demo controls</b> <span class="xs" style="color:#94A3B8">presenter only</span></span><button class="icon-btn" data-action="pres.toggle" aria-label="Close demo controls" style="color:#E2E8F0">${icon('x', 18)}</button></div>
    <div class="pres-sec"><div class="row-between"><span>${icon('clock', 14)} Demo time <b style="color:#fff">${formatDateTime(now)}</b>${offset ? html` <span class="pill pill-warning">+${Math.round(offset / HOUR)}h</span>` : ''}</span></div>
      <div class="row" style="margin-top:8px">${btn('+1 hr', { action: 'pres.time', data: { d: HOUR }, variant: 'secondary' })}${btn('+6 hr', { action: 'pres.time', data: { d: 6 * HOUR }, variant: 'secondary' })}${btn('+1 day', { action: 'pres.time', data: { d: DAY }, variant: 'secondary' })}${btn('Real time', { action: 'pres.time', data: { d: 'reset' }, variant: 'ghost' })}</div>
      ${ageDays >= 2 ? html`<p class="xs" style="color:#FCD34D;margin:8px 0 0">Data was generated ${ageDays} days ago — reset for fresh “today/tomorrow” bookings.</p>` : ''}</div>
    <div class="pres-sec"><div class="seg" role="tablist" style="background:#1E293B">${[['people', 'Personas'], ['sim', 'Simulate'], ['api', 'API log'], ['feed', 'Events']].map(([k, l]) => html`<button class="${tab === k ? 'active' : ''}" data-action="pres.tab" data-k="${k}" style="${tab === k ? '' : 'color:#CBD5E1'}">${l}</button>`)}</div></div>
    ${tab === 'people' ? html`<div class="pres-sec"><h4>Sign in this tab as</h4>${PERSONAS.map((p) => html`<div class="row" style="gap:4px;flex-wrap:nowrap"><button class="persona${me?.user.persona === p.key ? ' current' : ''}" data-action="pres.persona" data-p="${p.key}"><span style="flex:1"><b>${p.first} ${p.last}</b> · ${p.label}<small>${p.description}</small></span></button><button class="icon-btn" style="color:#94A3B8" data-action="pres.newtab" data-p="${p.key}" aria-label="Open ${p.label} in a new tab" title="Open in a new tab (side-by-side demo)">${icon('external', 16)}</button></div>`)}${me ? btn('Sign out', { action: 'auth.logout', variant: 'ghost' }) : ''}
      <p class="xs" style="color:#94A3B8;margin-top:8px">Each browser tab keeps its own session, so you can show the player and the venue side by side — changes sync live across tabs.</p></div>
      <div class="pres-sec"><h4>Presentation</h4>${toggle({ label: 'Phone frame (mobile preview)', checked: document.body.classList.contains('phone-frame'), action: 'pres.phone' })}${toggle({ label: 'Fast API (no simulated latency)', checked: demo.latency === 'fast', action: 'pres.latency' })}</div>` : ''}
    ${tab === 'sim' ? html`<div class="pres-sec"><h4>Payment provider (sandbox)</h4><label class="xs" for="whm">Webhook delivery</label><select id="whm" data-change="pres.webhook" style="width:100%;margin:4px 0 8px">${[['normal', 'Normal (~2.5 s delay)'], ['slow', 'Slow (~25 s delay)'], ['duplicate', 'Send every webhook twice'], ['drop', 'Drop payment webhooks (reconciliation heals)'], ['fail_first', 'Our endpoint fails first try (provider retries)']].map(([v, l]) => html`<option value="${v}"${demo.webhookMode === v ? html` selected` : ''}>${l}</option>`)}</select>
      ${toggle({ label: 'Provider outage (payments unavailable)', checked: demo.providerOutage, action: 'pres.flag', data: { k: 'providerOutage' } })}${toggle({ label: 'Fail the next refund', checked: demo.failNextRefund, action: 'pres.flag', data: { k: 'failNextRefund' } })}${toggle({ label: 'Fail the next payout', checked: demo.failNextPayout, action: 'pres.flag', data: { k: 'failNextPayout' } })}${toggle({ label: 'Provider reports a wrong amount on the next payment', checked: !!demo.amountMismatchNext, action: 'pres.flag', data: { k: 'amountMismatchNext' } })}
      <label class="xs" for="pf">Provider API faults</label><select id="pf" data-change="pres.demoset" data-k="providerFault" style="width:100%;margin:4px 0 8px">${[['none', 'None'], ['flaky', 'Next call fails once (502) — auto-retry'], ['timeout', 'Next call times out after creating the session'], ['down', 'All calls fail (503) — retries exhausted']].map(([v, l]) => html`<option value="${v}"${(demo.providerFault ?? 'none') === v ? html` selected` : ''}>${l}</option>`)}</select>
      <label class="xs" for="cd">Payment channel down</label><select id="cd" data-change="pres.demoset" data-k="channelDown" style="width:100%;margin:4px 0 8px">${[['', 'All channels up'], ['gcash', 'GCash'], ['maya', 'Maya'], ['card', 'Cards'], ['qrph', 'QR Ph'], ['grabpay', 'GrabPay'], ['online_banking', 'Online banking']].map(([v, l]) => html`<option value="${v}"${(demo.channelDown ?? '') === v ? html` selected` : ''}>${l}</option>`)}</select>
      <label class="xs" for="rfc">Next refund failure reason</label><select id="rfc" data-change="pres.demoset" data-k="refundFailureCode" style="width:100%;margin:4px 0 8px">${[['REFUND_REJECTED_BY_CHANNEL', 'Rejected by the channel'], ['REFUND_NOT_SUPPORTED', 'Channel has no API refunds (bank transfer)'], ['INSUFFICIENT_BALANCE', 'Provider balance too low']].map(([v, l]) => html`<option value="${v}"${demo.refundFailureCode === v ? html` selected` : ''}>${l}</option>`)}</select>
      <label class="xs" for="pfc">Next payout failure reason</label><select id="pfc" data-change="pres.demoset" data-k="payoutFailureCode" style="width:100%;margin:4px 0 0">${[['INVALID_DESTINATION_ACCOUNT', 'Bank account not found'], ['ACCOUNT_NAME_MISMATCH', 'Account name mismatch'], ['BANK_TEMPORARILY_UNAVAILABLE', 'Bank temporarily unavailable']].map(([v, l]) => html`<option value="${v}"${demo.payoutFailureCode === v ? html` selected` : ''}>${l}</option>`)}</select></div>
      <div class="pres-sec"><h4>Scenarios</h4><div class="stack-sm">${btn('Two players grab the same slot', { action: 'pres.race', variant: 'secondary', icon: 'users', block: true })}${btn('Full court vs half court race', { action: 'pres.halfrace', variant: 'secondary', icon: 'grid', block: true })}${btn('Start a live Open Play now', { action: 'pres.liveop', variant: 'secondary', icon: 'live', block: true })}${btn('Simulate Open Play arrivals', { action: 'pres.arrivals', variant: 'secondary', icon: 'userCheck', block: true })}${btn('Send a forged webhook', { action: 'pres.forged', variant: 'secondary', icon: 'shield', block: true })}${btn('Run background jobs now', { action: 'pres.jobs', variant: 'secondary', icon: 'refresh', block: true })}${btn('Run payouts now', { action: 'pres.payouts', variant: 'secondary', icon: 'wallet', block: true })}</div></div>
      <div class="pres-sec"><h4>Data</h4><p class="xs" style="color:#94A3B8">Synthetic data · ${(app.store.storageBytes() / 1024).toFixed(0)} KB of demo changes stored in this browser${app.store.driver.persistent ? '' : ' (not persistent in this viewer)'}.</p>${btn('Reset demo data', { action: 'pres.reset', variant: 'danger', icon: 'refresh' })}</div>` : ''}
    ${tab === 'api' ? html`<div class="pres-sec"><h4>API calls (this tab)</h4><ul class="api-log list">${log.map((e) => html`<li><span class="m">${e.method}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.path}">${e.path}</span><span class="s${String(e.status)[0]}">${e.status}</span>${e.code || e.note || e.idempotencyKey ? html`<span class="n">${e.code ?? ''} ${e.note ?? ''} ${e.idempotencyKey ? `Idempotency-Key ${e.idempotencyKey.slice(0, 14)}…` : ''}</span>` : ''}</li>`)}</ul><p class="xs" style="color:#94A3B8">Each call runs through the same authorization, validation, idempotency and transaction layer the production API is designed to have (design doc 13).</p></div>` : ''}
    ${tab === 'feed' ? html`<div class="pres-sec"><h4>Provider & job events</h4><ul class="feed list">${app.feed.map((f) => html`<li><span class="t">${formatTime(f.at)}</span>${f.text}</li>`)}</ul>${app.feed.length ? '' : html`<p class="xs" style="color:#94A3B8">Webhook deliveries and scenario results appear here.</p>`}</div>` : ''}
  </div>`.value;
}

export function mountPresenter(): void {
  const root = document.getElementById('presenter-root')!;
  const draw = () => {
    const scroll = root.querySelector('.pres-panel')?.scrollTop ?? 0;
    root.innerHTML = panel();
    const p = root.querySelector('.pres-panel');
    if (p) p.scrollTop = scroll;
  };
  app.presenterRender = draw;
  app.api.onLog(() => {
    if (app.ui.presOpen && app.ui.presTab === 'api') draw();
  });
  window.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'd') {
      app.ui.presOpen = !app.ui.presOpen;
      draw();
    }
  });
  draw();
}

const redraw = () => app.presenterRender?.();

action('pres.toggle', () => {
  app.ui.presOpen = !app.ui.presOpen;
  redraw();
});
action('pres.tab', (el) => {
  app.ui.presTab = el.dataset.k;
  redraw();
});
action('pres.persona', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /demo/sign-in', { persona: el.dataset.p! }));
  if (r) {
    app.ui.presOpen = true;
    signedIn(r.token, false);
    app.navigate(landingFor());
    redraw();
  }
});
action('pres.newtab', (el) => {
  const p = el.dataset.p!;
  const dest = ['superadmin', 'finance'].includes(p) ? '/admin' : ['owner', 'owner2', 'manager', 'receptionist', 'applicant'].includes(p) ? '/biz' : '/app';
  window.open(`${location.href.split('#')[0]}#${dest}?as=${p}`, `_blank`);
});
action('pres.phone', () => {
  document.body.classList.toggle('phone-frame');
  redraw();
});
action('pres.latency', async () => {
  const fast = app.store.state.settings.platform!.demo.latency !== 'fast';
  await app.store.transact((tx) => tx.db.update('settings', 'platform', (x) => void (x.demo.latency = fast ? 'fast' : 'realistic')));
  app.api.latency = !fast;
  redraw();
});
action('pres.time', async (el) => {
  const d = el.dataset.d === 'reset' ? 'reset' : Number(el.dataset.d);
  await travel(app.store, d);
  await runJobs(app.store);
  app.pushFeed(d === 'reset' ? 'Clock reset to real time' : `Time travel +${Math.round((d as number) / HOUR)}h — jobs ran (expiries, completions, reminders, settlements)`, 'info');
  app.render();
  redraw();
});
onChange('pres.webhook', async (el) => {
  const v = (el as HTMLSelectElement).value;
  await app.store.transact((tx) => tx.db.update('settings', 'platform', (x) => void (x.demo.webhookMode = v as never)));
  app.pushFeed(`Webhook mode: ${v}`, 'info');
});
action('pres.flag', async (el) => {
  const k = el.dataset.k as 'providerOutage' | 'failNextRefund' | 'failNextPayout' | 'amountMismatchNext';
  await app.store.transact((tx) => tx.db.update('settings', 'platform', (x) => void (x.demo[k] = !x.demo[k])));
  redraw();
});
onChange('pres.demoset', async (el) => {
  const k = el.dataset.k as 'providerFault' | 'channelDown' | 'refundFailureCode' | 'payoutFailureCode';
  const v = (el as HTMLSelectElement).value;
  await app.store.transact((tx) => tx.db.update('settings', 'platform', (x) => void ((x.demo as unknown as Record<string, unknown>)[k] = k === 'channelDown' ? v || null : v)));
  app.pushFeed(`Sandbox: ${k} = ${v || 'none'}`, 'info');
  redraw();
});
action('pres.jobs', async (el) => {
  const r = await app.run(el, () => runJobs(app.store));
  app.pushFeed(r && r.length ? `Jobs: ${r.map((x) => `${x.name} (${x.count})`).join(', ')}` : 'Jobs ran — nothing due', 'info');
});
action('pres.payouts', async (el) => {
  const n = await app.run(el, () => runPayoutsNow(app.store));
  app.pushFeed(`Payouts created: ${n ?? 0} (settled funds only; settlement is T+1 h in the demo)`, 'success');
});
action('pres.reset', async (el) => {
  const ok = await app.confirm({ title: 'Reset demo data?', body: 'This regenerates the synthetic data relative to today and removes every change made during the demo, in every tab.', confirmLabel: 'Reset', danger: true });
  if (!ok) return;
  await app.run(el, () => app.store.reset());
  app.token = null;
  app.ui = { presOpen: true };
  app.navigate('#/');
  app.toast('Demo data reset', 'success');
});
action('pres.forged', async (el) => {
  const r = await app.run(el, () => app.api.webhook({ 'x-callback-token': 'attacker-guess' }, { id: `evt-forged-${Date.now()}`, event: 'payment.succeeded', data: { reference_id: 'pay_does_not_matter', amount: 100 } }));
  if (r) {
    app.pushFeed(`Forged webhook → HTTP ${r.status}: ${r.result}. Security event raised.`, 'danger');
    app.toast(`Forged webhook rejected (HTTP ${r.status}). See Control Center → Security.`, 'warning');
  }
});
action('pres.liveop', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /demo/open-play/live', undefined as never));
  if (!r) return;
  app.pushFeed('Started a live pop-up Open Play at Dink District BGC (6 players checked in)', 'success');
  app.toast('Live Open Play started. Sign in as Paolo or Maria to run the desk; Juan and Bea are registered.', 'success');
  const me = app.me();
  if (me?.memberships.some((m) => m.business.tradeName === 'Dink District')) app.navigate(`#/biz/open-play/${r.sessionId}`);
  else app.navigate(`#/open-play/${r.sessionId}`);
});
action('pres.arrivals', async (el) => {
  const m = /open-play\/(?:registrations\/)?([a-z0-9_]+)/.exec(location.hash);
  let sessionId: string | undefined;
  if (m && location.hash.includes('/registrations/')) sessionId = app.store.read((db) => db.get('opRegistrations', m[1]!)?.sessionId);
  else if (m && m[1]!.startsWith('ops_')) sessionId = m[1];
  const r = await app.run(el, () => app.api.write('POST /demo/open-play/arrivals', sessionId ? { sessionId } : {}));
  if (!r) return;
  app.pushFeed(`${r.checkedIn} player(s) checked in to ${r.title}${r.started ? `; a new game started on ${r.started}` : ''}`, 'success');
  app.toast(`${r.checkedIn} player(s) just arrived${r.started ? ` · game started on ${r.started}` : ''}. Live counts update everywhere.`, 'success');
});
action('pres.halfrace', async (el) => {
  await app.run(el, async () => {
    const venue = app.store.read((db) => db.find('venues', (v) => v.slug === 'hoopsville-cubao')!);
    const [full, half] = app.store.read((db) => [db.find('courts', (c) => c.venueId === venue.id && c.name === 'Gym 1 · Full court')!, db.find('courts', (c) => c.venueId === venue.id && c.name === 'Gym 1 · Half court A')!]);
    const tokens: string[] = [];
    const mk = () => {
      const i = tokens.length;
      return new Api(app.store, () => ({ correlationId: '', ip: `203.0.113.${210 + i}`, device: `Phone ${i + 1}`, sessionToken: tokens[i] ?? null }), { latency: false });
    };
    const a = mk();
    tokens.push((await a.write('POST /demo/sign-in', { persona: 'player' }, { silent: true })).token);
    const b = mk();
    tokens.push((await b.write('POST /demo/sign-in', { persona: 'player2' }, { silent: true })).token);
    let startMs = 0;
    for (let d = 1; d < 8 && !startMs; d++) {
      const date = addDays(localDate(app.store.now()), d);
      const av = a.read('GET /v1/public/venues/{venueId}/availability', { venueId: venue.id, date, durationMinutes: 60, sport: 'basketball' });
      const fullCells = av.courts.find((x) => x.court.id === full.id)?.cells ?? [];
      const halfCells = av.courts.find((x) => x.court.id === half.id)?.cells ?? [];
      startMs = fullCells.find((c) => c.bookable && c.startMs > localToInstant(date, 9 * 60) && halfCells.find((h) => h.startMs === c.startMs)?.bookable)?.startMs ?? 0;
    }
    const results = await Promise.allSettled([
      a.write('POST /v1/me/booking-holds', { venueId: venue.id, courtId: full.id, startMs, durationMinutes: 60 }),
      b.write('POST /v1/me/booking-holds', { venueId: venue.id, courtId: half.id, startMs, durationMinutes: 60 }),
    ]);
    const lines = results.map((r, i) => `${i === 0 ? `Juan (${full.layoutLabel})` : `Bea (${half.layoutLabel})`}: ${r.status === 'fulfilled' ? 'hold created ✓' : `rejected — ${(r.reason as Error).message}`}`);
    for (const [i, r] of results.entries()) if (r.status === 'fulfilled') await (i === 0 ? a : b).write('DELETE /v1/me/checkouts/{checkoutId}', { checkoutId: r.value.checkoutId }, { silent: true });
    await a.write('POST /v1/auth/logout', undefined as never, { silent: true });
    await b.write('POST /v1/auth/logout', undefined as never, { silent: true });
    app.pushFeed(`Full vs half race on Hoopsville Gym 1 ${formatDateTime(startMs)} → ${lines.join(' · ')}`, 'info');
    app.modal({
      title: 'Full court vs half court',
      body: html`<p>At <b>${formatDateTime(startMs)}</b>, Juan tried to hold the <b>full basketball court</b> while Bea tried to hold <b>half court A</b> on the same floor.</p><ul class="bullets">${lines.map((l) => html`<li>${l}</li>`)}</ul><p class="small muted">The full court occupies spaces A and B; the half court occupies space A. Because the no-overlap rule is keyed on <b>space units</b>, only one of them can win — the same rule stops a basketball and a volleyball booking on a shared floor. The test hold was released again.</p>`,
    });
  });
});
action('pres.race', async (el) => {
  await app.run(el, async () => {
    const venue = app.store.read((db) => db.find('venues', (v) => v.slug === 'dink-district-bgc')!);
    const court = app.store.read((db) => db.filter('courts', (c) => c.venueId === venue.id).sort((a, b) => a.sortOrder - b.sortOrder)[3]!);
    const tokens: string[] = [];
    const mk = () => {
      const i = tokens.length;
      return new Api(app.store, () => ({ correlationId: '', ip: `203.0.113.${200 + i}`, device: `Phone ${i + 1}`, sessionToken: tokens[i] ?? null }), { latency: false });
    };
    const a = mk();
    tokens.push((await a.write('POST /demo/sign-in', { persona: 'player' }, { silent: true })).token);
    const b = mk();
    tokens.push((await b.write('POST /demo/sign-in', { persona: 'player2' }, { silent: true })).token);
    // find a free 1-hour slot tomorrow or later
    let startMs = 0;
    for (let d = 1; d < 6 && !startMs; d++) {
      const date = addDays(localDate(app.store.now()), d);
      const av = a.read('GET /v1/public/venues/{venueId}/availability', { venueId: venue.id, date, durationMinutes: 60 });
      startMs = av.courts.find((x) => x.court.id === court.id)?.cells.find((c) => c.bookable && c.startMs > localToInstant(date, 9 * 60))?.startMs ?? 0;
    }
    const results = await Promise.allSettled([
      a.write('POST /v1/me/booking-holds', { venueId: venue.id, courtId: court.id, startMs, durationMinutes: 60 }),
      b.write('POST /v1/me/booking-holds', { venueId: venue.id, courtId: court.id, startMs, durationMinutes: 60 }),
    ]);
    const lines = results.map((r, i) => `${i === 0 ? 'Juan' : 'Bea'}: ${r.status === 'fulfilled' ? 'hold created ✓' : `rejected — ${(r.reason as Error).message}`}`);
    for (const [i, r] of results.entries()) if (r.status === 'fulfilled') await (i === 0 ? a : b).write('DELETE /v1/me/checkouts/{checkoutId}', { checkoutId: r.value.checkoutId }, { silent: true });
    await a.write('POST /v1/auth/logout', undefined as never, { silent: true });
    await b.write('POST /v1/auth/logout', undefined as never, { silent: true });
    app.pushFeed(`Race on ${court.name} ${formatDateTime(startMs)} → ${lines.join(' · ')}`, 'info');
    app.modal({
      title: 'Two players, one slot',
      body: html`<p>Two sessions tried to hold <b>${court.name}</b> at <b>${formatDateTime(startMs)}</b> at the same instant.</p><ul class="bullets">${lines.map((l) => html`<li>${l}</li>`)}</ul><p class="small muted">The store enforces the same rule as the production PostgreSQL exclusion constraint (<code>EXCLUDE USING gist (space_unit_id WITH =, occupied_range WITH &&)</code>): overlapping active slots can never both exist, no matter how requests interleave. The rejected attempt is logged as a security event. The winning test hold was released again.</p>`,
    });
  });
});
