/**
 * UI runtime: hash router, render loop, delegated actions/forms, modals, toasts, countdown ticker and the
 * background job scheduler. Views are synchronous functions that read through the API layer; writes go through
 * `app.run()` which handles busy state, errors and field-level validation messages.
 */

import { ApiError, type Api, type ReadResult } from '../services/api.ts';
import type { Store } from '../services/store.ts';
import { runJobs } from '../services/jobs.ts';
import { idempotencyKey } from '../domain/ids.ts';
import { formatDuration } from '../domain/time.ts';
import { html, raw, type SafeHtml } from './html.ts';
import { icon } from './icons.ts';
import { btn } from './components.ts';

export type Layout = 'public' | 'player' | 'business' | 'admin' | 'bare' | 'auth';

export interface ViewCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  path: string;
  me: Me;
}

export type Me = ReadResult<'GET /v1/me'>;

export interface RouteDef {
  pattern: string;
  layout: Layout;
  title: string | ((ctx: ViewCtx) => string);
  auth?: boolean;
  view: (ctx: ViewCtx) => SafeHtml;
}

type ActionFn = (el: HTMLElement, ev: Event) => void | Promise<void>;
type FormFn = (data: FormData, form: HTMLFormElement) => void | Promise<void>;
type LayoutFn = (ctx: ViewCtx, content: SafeHtml, route: RouteDef) => SafeHtml;

const SS = {
  get(k: string): string | null {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null): void {
    try {
      if (v === null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

export interface FeedItem {
  at: number;
  text: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
}

class App {
  store!: Store;
  api!: Api;
  root!: HTMLElement;
  ui: Record<string, unknown> = {};
  routes: RouteDef[] = [];
  layouts = new Map<Layout, LayoutFn>();
  actions = new Map<string, ActionFn>();
  forms = new Map<string, FormFn>();
  changes = new Map<string, ActionFn>();
  feed: FeedItem[] = [];
  private renderQueued = false;
  private pendingExternal = false;
  private lastPath = '';
  presenterRender: (() => void) | null = null;
  ip = `203.0.113.${10 + Math.floor(Math.random() * 200)}`;
  device = describeDevice();

  get token(): string | null {
    return SS.get('ck-token');
  }
  set token(v: string | null) {
    SS.set('ck-token', v);
  }
  get businessId(): string | null {
    return SS.get('ck-biz');
  }
  set businessId(v: string | null) {
    SS.set('ck-biz', v);
  }
  get venueId(): string | null {
    return SS.get('ck-venue');
  }
  set venueId(v: string | null) {
    SS.set('ck-venue', v);
  }

  state<T>(key: string, init: T): T {
    if (!(key in this.ui)) this.ui[key] = init;
    return this.ui[key] as T;
  }
  set(key: string, value: unknown, rerender = true): void {
    this.ui[key] = value;
    if (rerender) this.render();
  }

  me(): Me {
    try {
      return this.api.read('GET /v1/me');
    } catch {
      return null;
    }
  }

  navigate(hash: string): void {
    if (location.hash === hash) this.render(true);
    else location.hash = hash;
  }

  // ---------------------------------------------------------------- rendering

  render(force = false): void {
    if (force) {
      this.draw();
      return;
    }
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.draw();
    });
  }

  private externalChange(): void {
    const a = document.activeElement as HTMLElement | null;
    if (a && this.root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) {
      this.pendingExternal = true; // don't wipe what the user is typing
      return;
    }
    this.render();
    this.presenterRender?.();
  }

  match(path: string): { route: RouteDef; params: Record<string, string> } | null {
    for (const r of this.routes) {
      const names: string[] = [];
      const re = new RegExp(`^${r.pattern.replace(/:[a-zA-Z]+/g, (m) => (names.push(m.slice(1)), '([^/]+)'))}$`);
      const m = re.exec(path);
      if (m) return { route: r, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)])) };
    }
    return null;
  }

  private draw(): void {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [path = '/', qs = ''] = hash.split('?');
    const query = new URLSearchParams(qs);
    const found = this.match(path) ?? this.match('/404')!;
    const me = this.me();
    const ctx: ViewCtx = { params: found.params, query, path, me };
    const scrollEl = document.scrollingElement;
    const keepScroll = path === this.lastPath;
    const y = scrollEl?.scrollTop ?? 0;
    const focusId = (document.activeElement as HTMLElement | null)?.id;
    let content: SafeHtml;
    if (found.route.auth && !me) {
      location.replace(`#/login?next=${encodeURIComponent(hash)}`);
      return;
    }
    try {
      content = found.route.view(ctx);
    } catch (e) {
      content = errorView(e, ctx);
    }
    const layout = this.layouts.get(found.route.layout);
    let page: SafeHtml;
    try {
      page = layout ? layout(ctx, content, found.route) : content;
    } catch (e) {
      page = errorView(e, ctx);
    }
    this.root.innerHTML = page.value;
    const title = typeof found.route.title === 'function' ? found.route.title(ctx) : found.route.title;
    document.title = `${title} · CourtKo`;
    if (keepScroll && scrollEl) scrollEl.scrollTop = y;
    else if (scrollEl) scrollEl.scrollTop = 0;
    if (!keepScroll) {
      const h1 = this.root.querySelector('h1');
      if (h1) {
        h1.setAttribute('tabindex', '-1');
        (h1 as HTMLElement).focus({ preventScroll: true });
      }
    } else if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    this.lastPath = path;
    this.tick();
  }

  // ---------------------------------------------------------------- actions & forms

  async run<T>(el: HTMLElement | null, fn: () => Promise<T>, opts: { success?: string; form?: HTMLFormElement } = {}): Promise<T | undefined> {
    const target = (el?.closest('button') as HTMLButtonElement | null) ?? (opts.form?.querySelector('button[type=submit]') as HTMLButtonElement | null);
    if (target?.dataset.busy === '1') return undefined;
    if (target) {
      target.dataset.busy = '1';
      target.classList.add('busy');
      target.setAttribute('aria-busy', 'true');
    }
    if (opts.form) clearFieldErrors(opts.form);
    try {
      const r = await fn();
      if (opts.success) this.toast(opts.success, 'success');
      return r;
    } catch (e) {
      this.handleError(e, opts.form);
      return undefined;
    } finally {
      if (target && target.isConnected) {
        delete target.dataset.busy;
        target.classList.remove('busy');
        target.removeAttribute('aria-busy');
      }
      this.render();
    }
  }

  handleError(e: unknown, form?: HTMLFormElement): void {
    if (e instanceof ApiError) {
      if (form && e.fields.length) showFieldErrors(form, e.fields);
      if (e.code === 'UNAUTHENTICATED' && !location.hash.startsWith('#/login') && !form) {
        this.toast('Your session ended. Please sign in again.', 'warning');
        this.navigate(`#/login?next=${encodeURIComponent(location.hash.slice(1))}`);
        return;
      }
      this.toast(e.problem.detail || e.problem.title, e.problem.status >= 500 ? 'danger' : 'warning', e.problem.code);
      return;
    }
    console.error(e);
    this.toast('Something went wrong. Please try again.', 'danger');
  }

  idem(): string {
    return idempotencyKey();
  }

  // ---------------------------------------------------------------- toasts & modals

  toast(message: string, tone: 'info' | 'success' | 'warning' | 'danger' = 'info', code?: string): void {
    const rootEl = document.getElementById('toast-root');
    if (!rootEl) return;
    const el = document.createElement('div');
    el.className = `toast toast-${tone}`;
    el.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
    el.innerHTML = html`${icon(tone === 'success' ? 'checkCircle' : tone === 'info' ? 'info' : 'alert', 18)}<div><div>${message}</div>${code ? html`<div class="toast-code">${code}</div>` : ''}</div><button class="toast-x" aria-label="Dismiss">${icon('x', 16)}</button>`.value;
    el.querySelector('.toast-x')!.addEventListener('click', () => el.remove());
    rootEl.appendChild(el);
    setTimeout(() => el.classList.add('out'), tone === 'danger' ? 7000 : 4200);
    setTimeout(() => el.remove(), tone === 'danger' ? 7600 : 4800);
  }

  pushFeed(text: string, tone: FeedItem['tone'] = 'info'): void {
    this.feed.unshift({ at: this.store.now(), text, tone });
    if (this.feed.length > 40) this.feed.length = 40;
    this.presenterRender?.();
  }

  modal(opts: { title: string; body: SafeHtml; actions?: SafeHtml; wide?: boolean; onClose?: () => void }): void {
    const dlg = document.getElementById('modal') as HTMLDialogElement;
    dlg.className = opts.wide ? 'modal wide' : 'modal';
    dlg.innerHTML = html`<form method="dialog" class="modal-inner" data-form-dialog><header class="modal-head"><h2>${opts.title}</h2><button class="icon-btn" type="button" data-action="modal.close" aria-label="Close">${icon('x', 20)}</button></header><div class="modal-body">${opts.body}</div>${opts.actions ? html`<footer class="modal-foot">${opts.actions}</footer>` : ''}</form>`.value;
    this.ui.__modalClose = opts.onClose ?? null;
    if (!dlg.open) dlg.showModal();
    const first = dlg.querySelector<HTMLElement>('input,select,textarea,button:not([data-action="modal.close"])');
    first?.focus();
  }

  closeModal(): void {
    const dlg = document.getElementById('modal') as HTMLDialogElement;
    if (dlg.open) dlg.close();
    const cb = this.ui.__modalClose as (() => void) | null;
    this.ui.__modalClose = null;
    cb?.();
  }

  confirm(opts: { title: string; body: SafeHtml | string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: boolean) => {
        if (done) return;
        done = true;
        resolve(v);
      };
      this.actions.set('confirm.yes', () => {
        finish(true);
        this.closeModal();
      });
      this.modal({
        title: opts.title,
        body: typeof opts.body === 'string' ? html`<p>${opts.body}</p>` : opts.body,
        actions: html`${btn('Cancel', { action: 'modal.close', variant: 'ghost' })}${btn(opts.confirmLabel, { action: 'confirm.yes', variant: opts.danger ? 'danger' : 'primary' })}`,
        onClose: () => finish(false),
      });
    });
  }

  // ---------------------------------------------------------------- ticker

  private lastLiveRender = 0;

  tick(): void {
    const now = this.store.now();
    // Live Open Play panels refresh every 10 s (production: Server-Sent Events push the same aggregates).
    if (document.querySelector('[data-live]') && Date.now() - this.lastLiveRender > 10_000) {
      this.lastLiveRender = Date.now();
      const a = document.activeElement;
      const modalOpen = (document.getElementById('modal') as HTMLDialogElement | null)?.open;
      if (!modalOpen && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) this.render();
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-countdown]')) {
      const until = Number(el.dataset.countdown);
      const left = Math.max(0, until - now);
      const m = Math.floor(left / 60_000);
      const s = Math.floor((left % 60_000) / 1000);
      el.textContent = left > 3_600_000 ? formatDuration(Math.round(left / 60_000)) : `${m}:${String(s).padStart(2, '0')}`;
      el.classList.toggle('urgent', left < 120_000);
      if (left === 0 && el.dataset.expired !== '1') {
        el.dataset.expired = '1';
        this.render();
      }
    }
  }

  async start(store: Store, api: Api, root: HTMLElement): Promise<void> {
    this.store = store;
    this.api = api;
    this.root = root;
    store.subscribe((external) => (external ? this.externalChange() : (this.render(), this.presenterRender?.())));
    window.addEventListener('hashchange', () => this.render(true));
    document.addEventListener('focusout', () => {
      if (this.pendingExternal) {
        setTimeout(() => {
          const a = document.activeElement;
          if (!a || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) {
            this.pendingExternal = false;
            this.render();
          }
        }, 50);
      }
    });
    document.addEventListener('click', (ev) => {
      const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!el) return;
      const name = el.dataset.action!;
      const fn = this.actions.get(name);
      if (!fn) return;
      ev.preventDefault();
      void Promise.resolve(fn(el, ev)).catch((e) => this.handleError(e));
    });
    document.addEventListener('keydown', (ev) => {
      const el = ev.target as HTMLElement;
      if ((ev.key === 'Enter' || ev.key === ' ') && el.matches('tr[data-action]')) {
        ev.preventDefault();
        el.click();
      }
    });
    document.addEventListener('change', (ev) => {
      const el = ev.target as HTMLElement;
      const name = el.dataset.change;
      if (!name) return;
      const fn = this.changes.get(name);
      if (fn) void Promise.resolve(fn(el, ev)).catch((e) => this.handleError(e));
    });
    document.addEventListener('submit', (ev) => {
      const form = ev.target as HTMLFormElement;
      const name = form.dataset.form;
      if (!name) return;
      ev.preventDefault();
      const fn = this.forms.get(name);
      if (fn) void this.run(null, async () => fn(new FormData(form), form), { form });
    });
    this.actions.set('modal.close', () => this.closeModal());
    (document.getElementById('modal') as HTMLDialogElement).addEventListener('close', () => {
      const cb = this.ui.__modalClose as (() => void) | null;
      this.ui.__modalClose = null;
      cb?.();
    });
    setInterval(() => this.tick(), 1000);
    const loop = async () => {
      try {
        await runJobs(store, (d) => {
          this.pushFeed(`Webhook ${d.type} → ${d.status} · ${d.result}`, d.status >= 400 ? 'warning' : d.duplicate ? 'info' : 'success');
          this.api.recordExternal({ method: 'POST', path: '/v1/webhooks/xendit', status: d.status, ms: 4, correlationId: 'provider', note: `${d.type}: ${d.result}` });
        });
      } catch (e) {
        console.error(e);
      }
      setTimeout(loop, 1500);
    };
    setTimeout(loop, 800);
    this.render(true);
  }
}

function describeDevice(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : 'Linux';
  return `${browser} on ${os}`;
}

function clearFieldErrors(form: HTMLFormElement): void {
  for (const el of form.querySelectorAll('[aria-invalid="true"]')) el.removeAttribute('aria-invalid');
  for (const el of form.querySelectorAll<HTMLElement>('.field-error')) el.textContent = '';
}

function showFieldErrors(form: HTMLFormElement, fields: { field: string; message: string }[]): void {
  let first: HTMLElement | null = null;
  for (const f of fields) {
    const input = form.querySelector<HTMLElement>(`[name="${CSS.escape(f.field)}"]`);
    const err = form.querySelector<HTMLElement>(`#f-${CSS.escape(f.field)}-err`);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      first ??= input;
    }
    if (err) err.textContent = f.message;
  }
  first?.focus();
}

export function errorView(e: unknown, ctx: ViewCtx): SafeHtml {
  if (e instanceof ApiError) {
    if (e.code === 'FORBIDDEN' || e.code === 'MFA_REQUIRED')
      return html`<div class="state-panel">${icon('lock', 36)}<h1>Access restricted</h1><p>${e.problem.detail}</p><p class="muted small">Authorization is checked on the server for every request — hiding a button is never the only control. Correlation ID: <code>${e.problem.correlationId}</code></p>${btn('Go back', { href: '#/', variant: 'secondary' })}</div>`;
    if (e.code === 'NOT_FOUND')
      return html`<div class="state-panel">${icon('search', 36)}<h1>Not found</h1><p>${e.problem.detail}</p><p class="muted small">Records from other businesses return “not found” rather than “forbidden”, so IDs can't be probed.</p>${btn('Home', { href: '#/', variant: 'secondary' })}</div>`;
    if (e.code === 'UNAUTHENTICATED')
      return html`<div class="state-panel">${icon('user', 36)}<h1>Please sign in</h1>${btn('Sign in', { href: `#/login?next=${encodeURIComponent(ctx.path)}`, variant: 'primary' })}</div>`;
    return html`<div class="state-panel">${icon('alert', 36)}<h1>${e.problem.title}</h1><p>${e.problem.detail}</p></div>`;
  }
  console.error(e);
  return html`<div class="state-panel">${icon('alert', 36)}<h1>Something went wrong</h1><p class="muted">${e instanceof Error ? e.message : String(e)}</p>${btn('Reload', { href: '#/', variant: 'secondary' })}</div>`;
}

export const app = new App();

export function route(pattern: string, layout: Layout, title: RouteDef['title'], view: RouteDef['view'], opts: { auth?: boolean } = {}): void {
  app.routes.push({ pattern, layout, title, view, ...(opts.auth ? { auth: true } : {}) });
}

export function action(name: string, fn: ActionFn): void {
  app.actions.set(name, fn);
}

export function form(name: string, fn: FormFn): void {
  app.forms.set(name, fn);
}

export function onChange(name: string, fn: ActionFn): void {
  app.changes.set(name, fn);
}

export function layout(name: Layout, fn: LayoutFn): void {
  app.layouts.set(name, fn);
}

export function str(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === 'string' ? v.trim() : '';
}

export { raw };
