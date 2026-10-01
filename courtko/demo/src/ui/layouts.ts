/** Page shells: public site, player app, business/staff portal, SuperAdmin console, plus the support-mode banner. */

import { PLATFORM_ROLE_TEMPLATES, platformRoleHas, type PlatformPermission } from '../domain/rbac.ts';
import { app, layout, action, onChange, type Me, type ViewCtx } from './app.ts';
import { avatar } from './art.ts';
import { btn, countdown } from './components.ts';
import { cls, html, type SafeHtml } from './html.ts';
import { icon, logo } from './icons.ts';

function brand(sub?: string): SafeHtml {
  return html`<a class="brand" href="#/">${logo(30)}<span>CourtKo${sub ? html` <small>${sub}</small>` : ''}</span></a>`;
}

export function supportBanner(me: Me): SafeHtml {
  if (!me?.support) return html``;
  return html`<div class="support-banner" role="alert">${icon('headset', 18)}<span><b>Support mode (read-only)</b> — ${me.realUserName} viewing as ${me.profile?.displayName ?? ''} · ticket ${me.support.ticketRef} · ends in ${countdown(me.support.expiresAt)}</span>${btn('End support session', { action: 'support.end', variant: 'accent', size: 'sm' })}</div>`;
}

function userChip(me: Me): SafeHtml {
  if (!me) return btn('Sign in', { href: '#/login', variant: 'primary', size: 'sm' });
  const name = me.profile?.displayName ?? 'Account';
  return html`<a class="user-chip" href="${me.user.platformRole ? '#/admin' : '#/app/profile'}">${avatar(name, me.profile?.avatarHue ?? 150, 28)}<span class="t">${name}</span></a>`;
}

// ---------------------------------------------------------------- public

const PUBLIC_LINKS: [string, string][] = [
  ['#/courts', 'Find a court'],
  ['#/events', 'Events'],
  ['#/how-it-works', 'How it works'],
  ['#/for-business', 'For venue owners'],
  ['#/pricing', 'Pricing'],
  ['#/help', 'Help'],
];

export function publicFooter(): SafeHtml {
  return html`<footer class="pub-footer"><div class="container"><div class="footer-grid">
    <div>${brand()}<p class="small" style="margin-top:10px">Book pickleball courts across the Philippines. Transparent prices, digital payments, instant confirmation.</p></div>
    <div><h4>Players</h4><ul><li><a href="#/courts">Find a court</a></li><li><a href="#/events">Events & open play</a></li><li><a href="#/how-it-works">How it works</a></li><li><a href="#/help">Help center</a></li></ul></div>
    <div><h4>Venues</h4><ul><li><a href="#/for-business">List your venue</a></li><li><a href="#/pricing">Commission & fees</a></li><li><a href="#/biz/onboarding">Register a business</a></li></ul></div>
    <div><h4>Company</h4><ul><li><a href="#/terms">Terms of Service</a></li><li><a href="#/privacy">Privacy Notice</a></li><li><a href="#/contact">Contact & support</a></li></ul></div>
  </div><p class="disclaimer">Interactive demo — all venues, people and transactions are fictional (synthetic data). Payments use a sandbox provider standing in for Xendit; no real money moves. Prices shown in Philippine pesos (₱); times in Manila time (UTC+08:00).</p></div></footer>`;
}

layout('public', (ctx, content) => {
  const me = ctx.me;
  const cur = `#${ctx.path}`;
  return html`${supportBanner(me)}<header class="pub-header"><nav class="pub-nav" aria-label="Main">${brand()}<div class="pub-links">${PUBLIC_LINKS.map(([href, label]) => html`<a href="${href}" class="${cur.startsWith(href) ? 'active' : ''}">${label}</a>`)}</div><div class="pub-cta">${me ? html`${btn('My bookings', { href: '#/app/bookings', variant: 'ghost', size: 'sm' })}${userChip(me)}` : html`${btn('Sign in', { href: '#/login', variant: 'ghost', size: 'sm' })}${btn('Get started', { href: '#/signup', variant: 'primary', size: 'sm' })}`}</div></nav></header><main id="main">${content}</main>${publicFooter()}`;
});

layout('auth', (ctx, content) => html`${supportBanner(ctx.me)}<header class="pub-header"><nav class="pub-nav">${brand()}<div class="pub-cta">${btn('Back to site', { href: '#/', variant: 'ghost', size: 'sm' })}</div></nav></header><main id="main" class="section-sm"><div class="container-narrow" style="max-width:480px">${content}</div></main>`);

layout('bare', (_ctx, content) => content);

// ---------------------------------------------------------------- shared shell

interface NavItem {
  href: string;
  label: string;
  icon: string;
  count?: number;
  group?: string;
  match?: string;
}

function sideNav(items: NavItem[], cur: string): SafeHtml {
  let lastGroup = '';
  return html`<nav class="side-nav" aria-label="Section">${items.map((i) => {
    const g = i.group && i.group !== lastGroup ? html`<div class="nav-group">${i.group}</div>` : '';
    lastGroup = i.group ?? lastGroup;
    const active = cur === i.href || (i.match ? cur.startsWith(i.match) : cur.startsWith(`${i.href}/`));
    return html`${g}<a href="${i.href}" class="${active ? 'active' : ''}" ${active ? html`aria-current="page"` : ''}>${icon(i.icon, 18)}<span>${i.label}</span>${i.count ? html`<span class="count badge-dot">${i.count}</span>` : ''}</a>`;
  })}</nav>`;
}

function shell(opts: { ctx: ViewCtx; items: NavItem[]; head: SafeHtml; foot: SafeHtml; content: SafeHtml; topbar: SafeHtml; bottom?: SafeHtml; admin?: boolean }): SafeHtml {
  const cur = `#${opts.ctx.path}`;
  const open = app.state('navOpen', false);
  const sidebar = html`<aside class="sidebar"><div class="sidebar-head">${opts.head}</div>${sideNav(opts.items, cur)}<div class="sidebar-foot">${opts.foot}</div></aside>`;
  return html`${supportBanner(opts.ctx.me)}<div class="${cls('shell', opts.admin && 'admin')}">${sidebar}<div class="${cls('drawer-nav', open && 'open', opts.admin && 'admin')}"><div class="scrim" data-action="nav.close"></div>${sidebar}</div><div class="main"><header class="topbar"><button class="icon-btn menu-btn" data-action="nav.open" aria-label="Open menu">${icon('menu', 22)}</button><span class="brand-sm">${logo(26)}</span>${opts.topbar}</header><main id="main" class="content">${opts.content}</main></div></div>${opts.bottom ?? ''}`;
}

action('nav.open', () => app.set('navOpen', true));
action('nav.close', () => app.set('navOpen', false));
window.addEventListener('hashchange', () => {
  app.ui.navOpen = false;
});

// ---------------------------------------------------------------- player

layout('player', (ctx, content) => {
  const me = ctx.me;
  const unread = me?.unread ?? 0;
  const items: NavItem[] = [
    { href: '#/app', label: 'Home', icon: 'home', match: '#/app/__' },
    { href: '#/app/discover', label: 'Discover', icon: 'search' },
    { href: '#/app/bookings', label: 'Bookings', icon: 'calendar' },
    { href: '#/app/events', label: 'Events', icon: 'trophy' },
    { href: '#/app/orders', label: 'Orders', icon: 'bag' },
    { href: '#/app/activity', label: 'Activity', icon: 'activity' },
    { href: '#/app/favorites', label: 'Favorites', icon: 'heart' },
    { href: '#/app/notifications', label: 'Notifications', icon: 'bell', count: unread },
    { href: '#/app/profile', label: 'Profile', icon: 'user' },
    { href: '#/app/payments', label: 'Payments', icon: 'wallet' },
    { href: '#/app/settings', label: 'Settings', icon: 'settings' },
  ];
  const cur = `#${ctx.path}`;
  const bottom: [string, string, string][] = [['#/app', 'Home', 'home'], ['#/app/discover', 'Discover', 'search'], ['#/app/bookings', 'Bookings', 'calendar'], ['#/app/events', 'Events', 'trophy'], ['#/app/profile', 'Me', 'user']];
  const biz = me?.memberships.length ? html`<a class="btn btn-ghost btn-sm" href="#/biz">${icon('building', 16)}<span>Business portal</span></a>` : '';
  const adminLink = me?.user.platformRole ? html`<a class="btn btn-ghost btn-sm" href="#/admin">${icon('shield', 16)}<span>Control center</span></a>` : '';
  return shell({
    ctx,
    items,
    head: brand(),
    foot: html`<a href="#/courts">${icon('external', 14)} Public site</a>`,
    content,
    topbar: html`<div class="topbar-right">${biz}${adminLink}<a class="icon-btn" href="#/app/notifications" aria-label="Notifications (${unread} unread)">${icon('bell', 20)}${unread ? html`<span class="badge-dot" style="position:absolute;margin:-18px 0 0 16px">${unread}</span>` : ''}</a>${userChip(me)}</div>`,
    bottom: html`<nav class="bottom-nav" aria-label="App">${bottom.map(([href, label, ic]) => html`<a href="${href}" class="${cur === href || (href !== '#/app' && cur.startsWith(href)) || (href === '#/app/profile' && ['#/app/settings', '#/app/payments', '#/app/activity', '#/app/favorites', '#/app/orders', '#/app/notifications'].some((p) => cur.startsWith(p))) ? 'active' : ''}">${icon(ic, 22)}<span>${label}</span></a>`)}</nav>`,
  });
});

// ---------------------------------------------------------------- business

export interface BizContext {
  businessId: string;
  business: NonNullable<Me>['memberships'][number]['business'];
  perms: Set<string>;
  roles: string[];
  venues: { id: string; name: string }[];
  venueId: string;
}

export function bizContext(me: Me): BizContext | null {
  if (!me) return null;
  const list = me.memberships;
  if (!list.length) return null;
  let m = list.find((x) => x.business.id === app.businessId) ?? list[0]!;
  app.businessId = m.business.id;
  let venues: { id: string; name: string }[] = [];
  try {
    venues = app.api.read('GET /v1/businesses/{businessId}/venues', { businessId: m.business.id }).map((v) => ({ id: v.venue.id, name: v.venue.name }));
  } catch {
    venues = [];
  }
  const venueId = venues.find((v) => v.id === app.venueId)?.id ?? venues[0]?.id ?? '';
  if (venueId) app.venueId = venueId;
  m = list.find((x) => x.business.id === app.businessId)!;
  return { businessId: m.business.id, business: m.business, perms: new Set(m.permissions), roles: m.roles.map((r) => r.name), venues, venueId };
}

onChange('biz.switch', (el) => {
  app.businessId = (el as HTMLSelectElement).value;
  app.venueId = null;
  app.render(true);
});
onChange('venue.switch', (el) => {
  app.venueId = (el as HTMLSelectElement).value;
  app.render(true);
});

layout('business', (ctx, content) => {
  const me = ctx.me;
  const b = bizContext(me);
  if (!b) {
    return html`${supportBanner(me)}<header class="pub-header"><nav class="pub-nav">${brand('for venues')}<div class="pub-cta">${userChip(me)}</div></nav></header><main class="content">${content}</main>`;
  }
  const p = (x: string) => b.perms.has(x);
  const pendingRefunds = p('refunds.approve') ? safeCount(() => app.api.read('GET /v1/businesses/{businessId}/refunds', { businessId: b.businessId }).filter((r) => r.refund.status === 'pending_approval').length) : 0;
  const items: NavItem[] = [
    { href: '#/biz', label: 'Overview', icon: 'home', match: '#/biz/__' },
    ...(p('bookings.view') ? [{ href: '#/biz/calendar', label: 'Calendar', icon: 'calendar', group: 'Operations' }, { href: '#/biz/bookings', label: 'Bookings', icon: 'ticket' }] : []),
    ...(p('bookings.create_walkin') ? [{ href: '#/biz/walk-in', label: 'Walk-in booking', icon: 'plus' }] : []),
    ...(p('orders.fulfill') ? [{ href: '#/biz/orders', label: 'Orders & pickup', icon: 'bag' }] : []),
    ...(p('courts.manage') || p('courts.block') || p('venues.manage') ? [{ href: '#/biz/courts', label: 'Courts', icon: 'court', group: 'Setup' }] : []),
    ...(p('venues.manage') || p('business.settings.manage') ? [{ href: '#/biz/venues', label: 'Venue settings', icon: 'building' }] : []),
    ...(p('pricing.manage') || p('promotions.manage') ? [{ href: '#/biz/pricing', label: 'Pricing', icon: 'tag' }] : []),
    ...(p('events.manage') || p('events.check_in') ? [{ href: '#/biz/events', label: 'Events', icon: 'trophy' }] : []),
    ...(p('products.manage') || p('inventory.manage') ? [{ href: '#/biz/products', label: 'Products', icon: 'box' }] : []),
    ...(p('customers.view') ? [{ href: '#/biz/customers', label: 'Customers', icon: 'users', group: 'People' }] : []),
    ...(p('restrictions.view') ? [{ href: '#/biz/restrictions', label: 'Restrictions', icon: 'ban' }] : []),
    ...(p('staff.manage') ? [{ href: '#/biz/staff', label: 'Staff & roles', icon: 'key' }] : []),
    { href: '#/biz/reviews', label: 'Reviews', icon: 'star' },
    ...(p('payments.view') ? [{ href: '#/biz/payments', label: 'Payments', icon: 'card', group: 'Money', count: pendingRefunds }] : []),
    ...(p('finance.view_payouts') ? [{ href: '#/biz/payouts', label: 'Payouts', icon: 'wallet' }] : []),
    ...(p('reports.view') ? [{ href: '#/biz/reports', label: 'Reports', icon: 'chart' }] : []),
    ...(p('business.settings.manage') ? [{ href: '#/biz/settings', label: 'Settings', icon: 'settings', group: 'Admin' }] : []),
    ...(p('audit.view') ? [{ href: '#/biz/audit', label: 'Audit log', icon: 'history' }] : []),
  ];
  const head = html`${brand('for venues')}<div class="biz-switch" style="padding:12px 0 0">${me!.memberships.length > 1 ? html`<select aria-label="Business" data-change="biz.switch">${me!.memberships.map((m) => html`<option value="${m.business.id}"${m.business.id === b.businessId ? html` selected` : ''}>${m.business.tradeName}</option>`)}</select>` : html`<strong>${b.business.tradeName}</strong>`}${b.venues.length > 1 ? html`<select aria-label="Venue" data-change="venue.switch">${b.venues.map((v) => html`<option value="${v.id}"${v.id === b.venueId ? html` selected` : ''}>${v.name}</option>`)}</select>` : b.venues[0] ? html`<span class="small muted">${b.venues[0].name}</span>` : ''}<span class="role-badge">${icon('key', 12)} ${b.roles.join(', ')}</span></div>`;
  return shell({
    ctx,
    items,
    head,
    foot: html`<div class="stack-sm"><a href="#/app">${icon('user', 14)} Player app</a>${b.business.status !== 'active' ? html`<div>${statusNote(b.business.status)}</div>` : ''}</div>`,
    content,
    topbar: html`<strong class="hide-sm">${b.business.tradeName}</strong><div class="topbar-right">${me?.mfaVerified ? html`<span class="pill pill-success hide-sm">${icon('shield', 12)} MFA verified</span>` : html`<span class="pill pill-warning hide-sm">MFA not verified</span>`}${userChip(me)}</div>`,
  });
});

function statusNote(status: string): SafeHtml {
  return html`<span class="pill ${status === 'suspended' ? 'pill-danger' : 'pill-warning'}">${status.replace(/_/g, ' ')}</span>`;
}

function safeCount(fn: () => number): number {
  try {
    return fn();
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------- admin

export function adminCan(me: Me, perm: PlatformPermission): boolean {
  return platformRoleHas(me?.user.platformRole ?? null, perm);
}

layout('admin', (ctx, content) => {
  const me = ctx.me;
  const role = me?.user.platformRole;
  const can = (x: PlatformPermission) => adminCan(me, x);
  const items: NavItem[] = [
    { href: '#/admin', label: 'Platform overview', icon: 'home', match: '#/admin/__' },
    ...(can('platform.businesses.view') ? [{ href: '#/admin/businesses', label: 'Businesses', icon: 'building', group: 'Marketplace' }, { href: '#/admin/venues', label: 'Venues', icon: 'court' }] : []),
    ...(can('platform.users.view') ? [{ href: '#/admin/users', label: 'Users', icon: 'users' }] : []),
    ...(can('platform.bookings.view') ? [{ href: '#/admin/bookings', label: 'Bookings', icon: 'ticket' }, { href: '#/admin/events', label: 'Events', icon: 'trophy' }, { href: '#/admin/products', label: 'Products', icon: 'box' }] : []),
    ...(can('platform.transactions.view') ? [{ href: '#/admin/transactions', label: 'Transactions', icon: 'receipt', group: 'Money' }] : []),
    ...(can('platform.commissions.manage') ? [{ href: '#/admin/commissions', label: 'Commissions', icon: 'percent' }] : []),
    ...(can('platform.transactions.view') ? [{ href: '#/admin/payouts', label: 'Payouts', icon: 'wallet' }, { href: '#/admin/refunds', label: 'Refunds', icon: 'refresh' }] : []),
    ...(can('platform.disputes.manage') ? [{ href: '#/admin/disputes', label: 'Disputes', icon: 'scale' }] : []),
    ...(can('platform.reports.view') ? [{ href: '#/admin/reports', label: 'Reports', icon: 'chart' }] : []),
    ...(can('platform.moderation.manage') ? [{ href: '#/admin/moderation', label: 'Moderation', icon: 'flag', group: 'Trust & safety' }] : []),
    ...(can('platform.support.impersonate') ? [{ href: '#/admin/support', label: 'Support', icon: 'headset' }] : []),
    ...(can('platform.security.view') ? [{ href: '#/admin/security', label: 'Security', icon: 'shield' }] : []),
    ...(can('platform.audit.view') ? [{ href: '#/admin/audit', label: 'Audit logs', icon: 'history' }] : []),
    ...(can('platform.config.manage') ? [{ href: '#/admin/config', label: 'Platform config', icon: 'settings', group: 'System' }] : []),
  ];
  return shell({
    ctx,
    items,
    admin: true,
    head: html`<a class="brand" href="#/admin">${logo(30)}<span>CourtKo <small style="color:#94A3B8">Control Center</small></span></a>`,
    foot: html`<div>${role ? PLATFORM_ROLE_TEMPLATES[role].name : ''}</div><div class="xs">Admin sessions expire after 15 min idle · MFA enforced</div>`,
    content,
    topbar: html`<span class="pill pill-danger hide-sm">${icon('lock', 12)} Restricted: platform staff only</span><div class="topbar-right">${userChip(me)}</div>`,
  });
});

action('support.end', async (el) => {
  await app.run(el, () => app.api.write('DELETE /v1/admin/support-sessions/current', undefined as never), { success: 'Support session ended. The user was notified.' });
  app.navigate('#/admin/support');
});
