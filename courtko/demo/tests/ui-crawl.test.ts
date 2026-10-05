/**
 * Headless UI crawler: for each persona, renders every reachable page, then clicks every button (data-action),
 * changes every select (data-change) and submits every form (data-form) — including forms and confirmations that
 * open in modals — exactly like the delegated browser handlers do. Any JavaScript exception, render crash or
 * INTERNAL server error fails the test. Expected business errors (validation, permission) are allowed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, formDataOf, type FakeEl } from './dom-shim.ts';

const { byId } = installDom();
const { harness } = await import('./helpers.ts');
const { app } = await import('../src/ui/app.ts');
await import('../src/ui/layouts.ts');
for (const m of ['public', 'auth', 'player', 'booking', 'pay', 'business', 'business-ops', 'business-setup', 'business-money', 'admin', 'admin-money', 'openplay', 'social', 'business-openplay', 'admin-sports', 'exceptions']) await import(`../src/ui/views/${m}.ts`);
const { mountPresenter } = await import('../src/ui/views/presenter.ts');

type Issue = { persona: string; path: string; what: string; detail: string };
const issues: Issue[] = [];
const apiErrors = new Map<string, number>();
let ctx = { persona: '', path: '', what: '' };
const realError = console.error;
console.error = (...a: unknown[]) => {
  const msg = a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}\n${(x.stack ?? '').split('\n').slice(1, 4).join('\n')}` : String(x))).join(' ');
  issues.push({ ...ctx, detail: msg });
};
const toasts: { m: string; tone: string; code?: string }[] = [];
app.toast = (m: string, tone: 'info' | 'success' | 'warning' | 'danger' = 'info', code?: string) => {
  toasts.push({ m, tone, ...(code ? { code } : {}) });
  if (code && process.env.CRAWL_VERBOSE) realError(`  [${ctx.persona}] ${ctx.path} · ${ctx.what} → ${code}: ${m}`);
  if (code) apiErrors.set(code, (apiErrors.get(code) ?? 0) + 1);
  if (code === 'INTERNAL' || m === 'Something went wrong. Please try again.') issues.push({ ...ctx, detail: `toast: ${m} ${code ?? ''}` });
};

const SKIP = new Set(['sup.start', 'auth.logout', 'pres.reset', 'pres.persona', 'pres.newtab', 'privacy.delete', 'support.end', 'nav.open', 'nav.close', 'pres.toggle', 'pres.time', 'pres.latency', 'pres.phone', 'loc.ask', 'modal.close']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const modal = () => byId.get('modal')!;

async function settle(p: Promise<unknown>): Promise<void> {
  let done = false;
  void p.finally(() => (done = true)).catch(() => undefined);
  const submitted = new Set<string>();
  for (let i = 0; i < 150 && !done; i++) {
    await sleep(10);
    const dlg = modal();
    if (!dlg.open) continue;
    const yes = dlg.querySelector('[data-action="confirm.yes"]');
    if (yes) {
      app.actions.get('confirm.yes')!(yes as unknown as HTMLElement, new Event('click'));
      continue;
    }
    const f = dlg.querySelector('form[data-form]');
    const key = f ? `${f.getAttribute('data-form')}|${dlg.innerHTML.length}` : '';
    if (f && !submitted.has(key)) {
      submitted.add(key);
      await submitForm(f);
    }
  }
  await p.catch(() => undefined);
  if (modal().open) app.closeModal();
}

async function submitForm(f: FakeEl): Promise<void> {
  const name = f.getAttribute('data-form')!;
  const fn = app.forms.get(name);
  if (!fn) {
    issues.push({ ...ctx, detail: `no form handler ${name}` });
    return;
  }
  await app.run(null, async () => fn(formDataOf(f), f as unknown as HTMLFormElement), { form: f as unknown as HTMLFormElement });
}

function render(path: string): FakeEl {
  location.hash = `#${path}`;
  app.render(true);
  const root = byId.get('app')!;
  if (root.textContent.includes('Something went wrong')) issues.push({ ...ctx, what: 'render', detail: `render crash on ${path}: ${root.querySelector('.state-panel p.muted')?.textContent ?? ''}` });
  return root;
}

function sig(el: FakeEl): string {
  return [...el.attrs.entries()].filter(([k]) => k.startsWith('data-')).map(([k, v]) => `${k}=${v}`).join('&');
}

const seenActions = new Map<string, number>();

async function crawlPage(persona: string, path: string, limit = 45): Promise<void> {
  ctx = { persona, path, what: 'render' };
  let root = render(path);
  const targets = [
    ...root.querySelectorAll('[data-action]').map((el) => ({ kind: 'action' as const, sig: sig(el) })),
    ...root.querySelectorAll('[data-change]').map((el) => ({ kind: 'change' as const, sig: sig(el) })),
    ...root.querySelectorAll('form[data-form]').map((el) => ({ kind: 'form' as const, sig: sig(el) })),
  ];
  const unique = [...new Map(targets.map((t) => [`${t.kind}|${t.sig}`, t])).values()];
  let n = 0;
  for (const t of unique) {
    const name = /data-(?:action|change|form)=([^&]+)/.exec(t.sig)?.[1] ?? '';
    if (SKIP.has(name)) continue;
    const count = seenActions.get(`${t.kind}|${name}`) ?? 0;
    if (count >= 3) continue;
    seenActions.set(`${t.kind}|${name}`, count + 1);
    if (n++ >= limit) break;
    (app.api as unknown as { writeTimes: number[] }).writeTimes = []; // the per-tab rate limiter would otherwise throttle the crawler
    root = render(path);
    const sel = t.kind === 'form' ? 'form[data-form]' : t.kind === 'change' ? '[data-change]' : '[data-action]';
    const el = root.querySelectorAll(sel).find((x) => sig(x) === t.sig);
    if (!el) continue;
    ctx = { persona, path, what: `${t.kind} ${name}` };
    if (t.kind === 'action') {
      const fn = app.actions.get(name);
      if (!fn) {
        issues.push({ ...ctx, detail: `no action handler ${name}` });
        continue;
      }
      await settle(Promise.resolve().then(() => fn(el as unknown as HTMLElement, { preventDefault() {}, target: el } as unknown as Event)).catch((e) => app.handleError(e)));
    } else if (t.kind === 'change') {
      const fn = app.changes.get(name);
      if (!fn) {
        issues.push({ ...ctx, detail: `no change handler ${name}` });
        continue;
      }
      if (el.tagName === 'SELECT') {
        const opts = el.querySelectorAll('option');
        const pick = opts.find((o) => (o.getAttribute('value') ?? '') !== '' && !o.hasAttribute('selected')) ?? opts[0];
        if (pick) el.value = pick.getAttribute('value') ?? '';
      }
      await settle(Promise.resolve().then(() => fn(el as unknown as HTMLElement, { target: el } as unknown as Event)).catch((e) => app.handleError(e)));
    } else {
      await settle(submitForm(el));
    }
  }
}

async function signIn(h: Awaited<ReturnType<typeof harness>>, persona: string | null) {
  app.ui = {};
  app.token = null;
  if (!persona) return;
  h.clock.t += 31_000;
  const r = await app.api.write('POST /demo/sign-in', { persona });
  app.token = r.token;
}

const PUBLIC = ['/', '/courts', '/courts?sport=basketball', '/open-play', '/events', '/pricing', '/venues/dink-district-bgc', '/venues/hoopsville-cubao', '/venues/baseline-racquet-club', '/login', '/signup'];
const PLAYER = ['/app', '/app/discover', '/app/book/dink-district-bgc', '/app/book/hoopsville-cubao', '/app/bookings', '/app/open-play', '/app/invites', '/app/players', '/app/follow-requests', '/app/events', '/app/orders', '/app/activity', '/app/favorites', '/app/notifications', '/app/profile', '/app/payments', '/app/settings'];
const BIZ = ['/biz', '/biz/open-play', '/biz/open-play/new', '/biz/calendar', '/biz/bookings', '/biz/walk-in', '/biz/orders', '/biz/courts', '/biz/venues', '/biz/pricing', '/biz/events', '/biz/products', '/biz/customers', '/biz/restrictions', '/biz/staff', '/biz/reviews', '/biz/payments', '/biz/payouts', '/biz/reports', '/biz/settings', '/biz/audit'];
const ADMIN = ['/admin', '/admin/sports', '/admin/open-play', '/admin/businesses', '/admin/venues', '/admin/users', '/admin/bookings', '/admin/events', '/admin/products', '/admin/transactions', '/admin/payment-exceptions', '/admin/commissions', '/admin/payouts', '/admin/refunds', '/admin/disputes', '/admin/reports', '/admin/moderation', '/admin/support', '/admin/security', '/admin/audit', '/admin/config'];

test('every button, select and form works for every persona (headless crawl)', { timeout: 590_000 }, async () => {
  const h = await harness();
  app.store = h.store;
  const tab = await h.tab();
  app.api = tab.api;
  (app.api as unknown as { request: () => unknown }).request = () => ({ correlationId: '', ip: '203.0.113.9', device: 'Crawler', sessionToken: app.token });
  app.root = byId.get('app') as unknown as HTMLElement;
  app.actions.set('modal.close', () => app.closeModal());
  byId.get('modal')!.addEventListener('close', () => {
    const cb = app.ui.__modalClose as (() => void) | null;
    app.ui.__modalClose = null;
    cb?.();
  });

  await signIn(h, null);
  for (const p of PUBLIC) await crawlPage('anon', p);

  await signIn(h, 'player');
  const juanPages = [...PLAYER];
  const bookings = app.api.read('GET /v1/me/bookings', { tab: 'upcoming' });
  juanPages.push(`/app/bookings/${bookings[0]!.booking.id}`);
  for (const r of app.api.read('GET /v1/me/open-play/registrations').slice(0, 3)) juanPages.push(`/app/open-play/registrations/${r.registration.id}`, `/app/open-play/${r.session.id}`);
  juanPages.push('/app/players/bea.santiago');
  for (const p of juanPages) await crawlPage('player', p);

  await signIn(h, 'player2');
  for (const p of ['/app/invites', '/app/open-play', '/app/profile']) await crawlPage('player2', p);

  for (const persona of ['owner', 'receptionist']) {
    await signIn(h, persona);
    const pages = [...BIZ];
    const me = app.api.read('GET /v1/me')!;
    const list = app.api.read('GET /v1/businesses/{businessId}/open-play', { businessId: me.memberships[0]!.business.id });
    for (const x of list.slice(0, 2)) pages.push(`/biz/open-play/${x.session.id}`);
    for (const p of pages) await crawlPage(persona, p);
  }

  await signIn(h, 'superadmin');
  for (const p of ADMIN) await crawlPage('superadmin', p);

  // Presenter panel scenarios
  await signIn(h, 'owner');
  mountPresenter();
  for (const tabKey of ['people', 'sim']) {
    app.ui.presOpen = true;
    app.ui.presTab = tabKey;
    app.presenterRender?.();
    const pr = byId.get('presenter-root')!;
    for (const el of pr.querySelectorAll('[data-action]')) {
      const name = el.getAttribute('data-action')!;
      if (SKIP.has(name) || name === 'pres.tab' || name === 'pres.flag') continue;
      ctx = { persona: 'presenter', path: 'presenter', what: name };
      const fn = app.actions.get(name);
      if (!fn) issues.push({ ...ctx, detail: `no handler ${name}` });
      else await settle(Promise.resolve().then(() => fn(el as unknown as HTMLElement, new Event('click'))).catch((e) => app.handleError(e)));
    }
  }

  const report = issues.map((i) => `[${i.persona}] ${i.path} · ${i.what}\n    ${i.detail}`).join('\n');
  realError(`crawl: ${seenActions.size} distinct controls exercised; API error codes seen: ${JSON.stringify(Object.fromEntries(apiErrors))}`);
  assert.equal(issues.length, 0, `UI issues found:\n${report}`);
});
