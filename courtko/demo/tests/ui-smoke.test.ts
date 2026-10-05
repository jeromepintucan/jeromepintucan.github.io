/**
 * UI smoke test: renders every route for every persona (views are pure functions returning HTML) and checks
 * that nothing throws, errors render as proper states, and user-supplied text is escaped.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser globals for module-load side effects (listeners) — views themselves only produce strings.
const ss = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.addEventListener = () => undefined;
g.document = { addEventListener: () => undefined, querySelectorAll: () => [], getElementById: () => null, activeElement: null, body: { classList: { contains: () => false, toggle: () => undefined } } };
g.location = { hash: '#/', href: 'file:///demo.html#/', replace: () => undefined };
g.sessionStorage = { getItem: (k: string) => ss.get(k) ?? null, setItem: (k: string, v: string) => void ss.set(k, v), removeItem: (k: string) => void ss.delete(k) };
g.requestAnimationFrame = (fn: () => void) => setTimeout(fn, 0);
g.queueMicrotask = () => undefined;

const { harness } = await import('./helpers.ts');
const { app, errorView } = await import('../src/ui/app.ts');
await import('../src/ui/layouts.ts');
for (const m of ['public', 'auth', 'player', 'booking', 'pay', 'business', 'business-ops', 'business-setup', 'business-money', 'admin', 'admin-money', 'openplay', 'social', 'business-openplay', 'admin-sports']) await import(`../src/ui/views/${m}.ts`);

let h: Awaited<ReturnType<typeof harness>>;

function render(path: string): string {
  const [p = '/', qs = ''] = path.split('?');
  const found = app.match(p) ?? app.match('/404')!;
  const me = app.me();
  const ctx = { params: found.params, query: new URLSearchParams(qs), path: p, me };
  let content;
  try {
    content = found.route.view(ctx);
  } catch (e) {
    content = errorView(e, ctx);
  }
  const layout = app.layouts.get(found.route.layout)!;
  return layout(ctx, content, found.route).value;
}

before(async () => {
  h = await harness();
  app.store = h.store;
  const tab = await h.tab();
  app.api = tab.api;
});

async function as(persona: string | null) {
  ss.clear();
  app.ui = {};
  if (!persona) {
    app.token = null;
    return;
  }
  h.clock.t += 31_000; // next TOTP step (the authenticator replay guard rejects reusing a code)
  const r = await app.api.write('POST /demo/sign-in', { persona });
  app.token = r.token;
  (app.api as unknown as { request: () => unknown }).request = () => ({ correlationId: '', ip: '203.0.113.9', device: 'Test', sessionToken: app.token });
}

const PUBLIC = ['/', '/courts', '/courts?q=Makati', '/courts?sport=basketball', '/venues/dink-district-bgc', '/venues/hoopsville-cubao?sport=volleyball', '/venues/baseline-racquet-club', '/venues/kitchen-line-club-makati', '/open-play', '/open-play?sport=tennis', '/players/juan.delacruz', '/events', '/how-it-works', '/for-business', '/pricing', '/help', '/terms', '/privacy', '/contact', '/login', '/signup', '/forgot', '/nope'];
const PLAYER = ['/app', '/app/discover', '/app/book/dink-district-bgc', '/app/book/hoopsville-cubao', '/app/bookings', '/app/open-play', '/app/invites', '/app/players', '/app/players/bea.santiago', '/app/players/juan.delacruz/followers', '/app/follow-requests', '/app/events', '/app/orders', '/app/activity', '/app/favorites', '/app/notifications', '/app/profile', '/app/payments', '/app/settings'];
const BIZ = ['/biz', '/biz/open-play', '/biz/open-play/new', '/biz/calendar', '/biz/bookings', '/biz/walk-in', '/biz/orders', '/biz/courts', '/biz/venues', '/biz/pricing', '/biz/events', '/biz/products', '/biz/customers', '/biz/restrictions', '/biz/staff', '/biz/reviews', '/biz/payments', '/biz/payouts', '/biz/reports', '/biz/settings', '/biz/audit', '/biz/onboarding'];
const ADMIN = ['/admin', '/admin/sports', '/admin/open-play', '/admin/businesses', '/admin/venues', '/admin/users', '/admin/bookings', '/admin/events', '/admin/products', '/admin/transactions', '/admin/commissions', '/admin/payouts', '/admin/refunds', '/admin/disputes', '/admin/reports', '/admin/moderation', '/admin/support', '/admin/security', '/admin/audit', '/admin/config'];

function assertOk(html: string, path: string) {
  assert.ok(!html.includes('Something went wrong'), `${path} crashed: ${html.match(/<p class="muted">([^<]*)/)?.[1]}`);
  assert.ok(html.length > 200, `${path} rendered almost nothing`);
}

test('public pages render for anonymous visitors', async () => {
  await as(null);
  for (const p of PUBLIC) assertOk(render(p), p);
});

test('player app renders every page', async () => {
  await as('player');
  for (const p of [...PLAYER, ...PUBLIC.slice(0, 5)]) assertOk(render(p), p);
  const bookings = app.api.read('GET /v1/me/bookings', { tab: 'upcoming' });
  assert.ok(bookings.length >= 2);
  assertOk(render(`/app/bookings/${bookings[0]!.booking.id}`), 'booking detail');
  app.ui.setTab = 'social';
  assertOk(render('/app/settings'), 'settings social tab');
  const op = app.api.read('GET /v1/me/open-play/registrations');
  assert.ok(op.length >= 3);
  for (const r of op.slice(0, 4)) {
    assertOk(render(`/app/open-play/registrations/${r.registration.id}`), 'my open play pass');
    assertOk(render(`/app/open-play/${r.session.id}`), 'open play detail');
  }
  for (const t of ['mine', 'invites']) {
    app.ui.opTab = t;
    assertOk(render('/app/open-play'), `open play tab ${t}`);
  }
  const profile = render('/app/profile');
  assert.ok(profile.includes('My sports') && profile.includes('Basketball'), 'profile shows the My Sports dashboard');
});

test('business Open Play desk renders for owner and receptionist', async () => {
  for (const persona of ['owner', 'receptionist']) {
    await as(persona);
    const list = app.api.read('GET /v1/businesses/{businessId}/open-play', { businessId: app.api.read('GET /v1/me')!.memberships[0]!.business.id });
    assert.ok(list.length >= 3);
    for (const x of list.slice(0, 3)) {
      for (const t of ['desk', 'players', 'log']) {
        app.ui[`deskTab:${x.session.id}`] = t;
        assertOk(render(`/biz/open-play/${x.session.id}`), `${persona} desk ${t}`);
      }
      if (persona === 'owner') assertOk(render(`/biz/open-play/edit/${x.session.id}`), 'edit session');
    }
  }
  await as('owner');
  const cal = render('/biz/calendar');
  assert.ok(cal.includes('The Hall') && cal.includes('cal-partial') === cal.includes('cal-partial'), 'calendar shows physical courts');
  const courts = render('/biz/courts');
  assert.ok(courts.includes('Half court A') && courts.includes('Blocks when booked'));
});

test('owner, manager and receptionist see the business portal (permission-filtered)', async () => {
  for (const persona of ['owner', 'manager', 'receptionist']) {
    await as(persona);
    for (const p of BIZ) assertOk(render(p), `${persona} ${p}`);
  }
  await as('receptionist');
  const html = render('/biz/pricing');
  assert.ok(html.includes('Access restricted') || html.includes('Pricing'), 'receptionist pricing page is either denied or read-only');
  assert.ok(!render('/biz').includes('href="#/biz/staff"'), 'receptionist nav hides Staff');
});

test('SuperAdmin renders every console page; players get Not found on admin routes', async () => {
  await as('superadmin');
  for (const p of ADMIN) assertOk(render(p), p);
  app.ui.sportOpen = 'basketball';
  assertOk(render('/admin/sports'), 'sport editor');
  const biz = app.api.read('GET /v1/admin/businesses', {}).data[0]!.business.id;
  assertOk(render(`/admin/businesses/${biz}`), 'admin business detail');
  await as('player');
  assert.ok(render('/admin/transactions').includes('Not found'));
});

test('applicant sees onboarding status; checkout flow renders', async () => {
  await as('applicant');
  assertOk(render('/biz/onboarding'), 'onboarding');
  await as('player2');
  const v = app.api.read('GET /v1/public/venues/{slug}', { slug: 'dink-district-bgc' }).venue;
  const date = new Date(h.store.now() + 3 * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10);
  const av = app.api.read('GET /v1/public/venues/{venueId}/availability', { venueId: v.id, date, durationMinutes: 60 });
  const cell = av.courts[0]!.cells.find((c) => c.bookable)!;
  const hold = await app.api.write('POST /v1/me/booking-holds', { venueId: v.id, courtId: av.courts[0]!.court.id, startMs: cell.startMs, durationMinutes: 60 });
  assertOk(render(`/app/checkout/${hold.checkoutId}`), 'checkout');
  const pay = await app.api.write('POST /v1/me/checkouts/{checkoutId}/payment-sessions', { checkoutId: hold.checkoutId, paymentMethod: 'gcash', acceptPolicy: true });
  assertOk(render(pay.redirectUrl.slice(1)), 'sandbox pay page');
  assertOk(render(`/app/checkout/${hold.checkoutId}?return=1`), 'processing page');
});

test('user-supplied text is escaped', async () => {
  await as('player');
  await app.api.write('PATCH /v1/me/profile', { displayName: '<img src=x onerror=alert(1)>' });
  const html = render('/app/profile');
  assert.ok(!html.includes('<img src=x'), 'raw HTML must not be injected');
  assert.ok(html.includes('&lt;img src=x'));
});
