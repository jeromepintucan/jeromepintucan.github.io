/**
 * Minimal DOM for headless UI testing (no browser available in CI/sandbox). Parses the HTML the views generate
 * into a tree that supports the subset of DOM APIs the app uses: dataset, closest/matches/querySelector(All) with
 * simple selectors, innerHTML, values of form controls, dialogs and FormData extraction.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function decode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export class FakeEl {
  tagName: string;
  attrs = new Map<string, string>();
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  text = '';
  open = false;
  isConnected = true;
  private listeners = new Map<string, ((e: unknown) => void)[]>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  // ---- attributes
  getAttribute(n: string): string | null {
    return this.attrs.has(n) ? this.attrs.get(n)! : null;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, String(v));
  }
  removeAttribute(n: string): void {
    this.attrs.delete(n);
  }
  hasAttribute(n: string): boolean {
    return this.attrs.has(n);
  }
  get id(): string {
    return this.attrs.get('id') ?? '';
  }
  get className(): string {
    return this.attrs.get('class') ?? '';
  }
  set className(v: string) {
    this.attrs.set('class', v);
  }
  get classList() {
    const get = () => (this.attrs.get('class') ?? '').split(/\s+/).filter(Boolean);
    const set = (a: string[]) => this.attrs.set('class', a.join(' '));
    return {
      add: (...c: string[]) => set([...new Set([...get(), ...c])]),
      remove: (...c: string[]) => set(get().filter((x) => !c.includes(x))),
      toggle: (c: string, on?: boolean) => {
        const has = get().includes(c);
        const want = on ?? !has;
        if (want && !has) set([...get(), c]);
        if (!want && has) set(get().filter((x) => x !== c));
        return want;
      },
      contains: (c: string) => get().includes(c),
    };
  }
  get dataset(): Record<string, string | undefined> {
    const self = this;
    return new Proxy({} as Record<string, string | undefined>, {
      get(_t, k: string) {
        const attr = `data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
        return self.attrs.get(attr);
      },
      set(_t, k: string, v: string) {
        self.attrs.set(`data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, String(v));
        return true;
      },
      deleteProperty(_t, k: string) {
        self.attrs.delete(`data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
        return true;
      },
      has(_t, k: string) {
        return self.attrs.has(`data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
      },
    });
  }

  // ---- content
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.children = [];
    this.text = v;
  }
  set innerHTML(html: string) {
    this.children = [];
    this.text = '';
    parseInto(this, html);
  }
  get innerHTML(): string {
    return this.textContent;
  }
  appendChild(c: FakeEl): FakeEl {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.isConnected = false;
  }

  // ---- form controls
  get value(): string {
    if (this.tagName === 'SELECT') {
      const opts = this.querySelectorAll('option');
      const sel = opts.find((o) => o.hasAttribute('selected')) ?? opts[0];
      return sel ? (sel.getAttribute('value') ?? sel.textContent) : '';
    }
    if (this.tagName === 'TEXTAREA') return decode(this.textContent);
    return this.attrs.get('value') ?? '';
  }
  set value(v: string) {
    if (this.tagName === 'SELECT') {
      for (const o of this.querySelectorAll('option')) {
        if ((o.getAttribute('value') ?? o.textContent) === v) o.setAttribute('selected', '');
        else o.removeAttribute('selected');
      }
    } else if (this.tagName === 'TEXTAREA') this.textContent = v;
    else this.attrs.set('value', v);
  }
  get checked(): boolean {
    return this.attrs.has('checked');
  }
  set checked(v: boolean) {
    if (v) this.attrs.set('checked', '');
    else this.attrs.delete('checked');
  }

  // ---- events & misc
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  dispatch(type: string, e: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
  focus(): void {}
  blur(): void {}
  click(): void {}
  reset(): void {}
  scrollIntoView(): void {}
  showModal(): void {
    this.open = true;
  }
  close(): void {
    this.open = false;
    this.dispatch('close', {});
  }

  // ---- selectors
  matches(sel: string): boolean {
    return sel.split(',').some((part) => matchSimple(this, part.trim()));
  }
  closest(sel: string): FakeEl | null {
    let el: FakeEl | null = this;
    while (el) {
      if (el.tagName !== '#ROOT' && el.matches(sel)) return el;
      el = el.parent;
    }
    return null;
  }
  querySelectorAll(sel: string): FakeEl[] {
    const out: FakeEl[] = [];
    for (const part of sel.split(',').map((x) => x.trim())) {
      const chain = splitDescendant(part);
      const walk = (el: FakeEl) => {
        for (const c of el.children) {
          if (matchChain(c, chain, this)) out.push(c);
          walk(c);
        }
      };
      walk(this);
    }
    return [...new Set(out)];
  }
  querySelector(sel: string): FakeEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  get elements(): FakeEl[] {
    return this.querySelectorAll('input,select,textarea');
  }
}

function splitDescendant(sel: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ' ' && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.filter((x) => x !== '>');
}

function matchChain(el: FakeEl, chain: string[], root: FakeEl): boolean {
  if (!matchSimple(el, chain[chain.length - 1]!)) return false;
  let i = chain.length - 2;
  let p = el.parent;
  while (i >= 0 && p && p !== root.parent) {
    if (matchSimple(p, chain[i]!)) i--;
    p = p.parent;
  }
  return i < 0;
}

function matchSimple(el: FakeEl, sel: string): boolean {
  if (!sel || el.tagName === '#ROOT') return false;
  const m = /^([a-zA-Z][a-zA-Z0-9-]*)?((?:[.#][a-zA-Z0-9_-]+)*)((?:\[[^\]]+\])*)((?::not\([^)]*\))*)$/.exec(sel);
  if (!m) return false;
  const [, tag, clsIds, attrPart, nots] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  for (const t of (clsIds ?? '').match(/[.#][a-zA-Z0-9_-]+/g) ?? []) {
    if (t[0] === '.' && !el.classList.contains(t.slice(1))) return false;
    if (t[0] === '#' && el.id !== t.slice(1)) return false;
  }
  for (const a of (attrPart ?? '').match(/\[[^\]]+\]/g) ?? []) {
    const am = /^\[([^\]=^$*]+)(?:([\^$*]?=)"?([^"\]]*)"?)?\]$/.exec(a);
    if (!am) return false;
    const [, name, op, val] = am;
    const v = el.getAttribute(name!);
    if (v === null) return false;
    if (op === '=' && v !== val) return false;
    if (op === '^=' && !v.startsWith(val!)) return false;
    if (op === '$=' && !v.endsWith(val!)) return false;
    if (op === '*=' && !v.includes(val!)) return false;
  }
  for (const n of (nots ?? '').match(/:not\(([^)]*)\)/g) ?? []) {
    if (matchSimple(el, n.slice(5, -1))) return false;
  }
  return true;
}

export function parseInto(root: FakeEl, html: string): void {
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=/>]+(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s>]+)?)*)\s*(\/?)>|([^<]+)/g;
  let cur = root;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {
      const tag = m[1].toUpperCase();
      let p: FakeEl | null = cur;
      while (p && p.tagName !== tag) p = p.parent;
      if (p) cur = p.parent ?? root;
      continue;
    }
    if (m[2]) {
      const el = new FakeEl(m[2]);
      const ar = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a: RegExpExecArray | null;
      while ((a = ar.exec(m[3] ?? ''))) el.attrs.set(a[1]!, decode(a[2] ?? a[3] ?? a[4] ?? ''));
      cur.appendChild(el);
      if (!VOID.has(m[2].toLowerCase()) && !m[4]) cur = el;
      continue;
    }
    if (m[5]) {
      const t = new FakeEl('#text');
      t.text = decode(m[5]);
      cur.appendChild(t);
    }
  }
}

export function formDataOf(form: FakeEl): FormData {
  const fd = new FormData();
  for (const el of form.querySelectorAll('input,select,textarea')) {
    const name = el.getAttribute('name');
    if (!name) continue;
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'submit' || type === 'button') continue;
      if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;
      fd.append(name, type === 'checkbox' || type === 'radio' ? (el.getAttribute('value') ?? 'on') : el.value);
    } else fd.append(name, el.value);
  }
  return fd;
}

export function installDom(): { document: FakeEl & Record<string, unknown>; byId: Map<string, FakeEl> } {
  const byId = new Map<string, FakeEl>();
  const doc = new FakeEl('#document') as FakeEl & Record<string, unknown>;
  for (const id of ['app', 'modal', 'toast-root', 'presenter-root']) {
    const el = new FakeEl(id === 'modal' ? 'dialog' : 'div');
    el.setAttribute('id', id);
    byId.set(id, el);
  }
  Object.assign(doc, {
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: (tag: string) => new FakeEl(tag),
    body: new FakeEl('body'),
    activeElement: null,
    scrollingElement: { scrollTop: 0 },
    title: '',
    readyState: 'complete',
  });
  const g = globalThis as Record<string, unknown>;
  g.document = doc;
  g.window = globalThis;
  g.addEventListener = () => undefined;
  const loc = { hash: '#/', href: 'file:///demo.html#/', replace(h: string) { loc.hash = h.startsWith('#') ? h : `#${h}`; } };
  g.location = loc;
  const ss = new Map<string, string>();
  g.sessionStorage = { getItem: (k: string) => ss.get(k) ?? null, setItem: (k: string, v: string) => void ss.set(k, v), removeItem: (k: string) => void ss.delete(k) };
  g.requestAnimationFrame = (fn: () => void) => setTimeout(fn, 0);
  g.history = { back: () => undefined };
  g.prompt = () => 'Automated test reason text';
  g.alert = () => undefined;
  g.CSS = { escape: (s: string) => s.replace(/["\\]/g, '\\$&') };
  if (!('open' in g)) g.open = () => null;
  (g.URL as unknown as Record<string, unknown>).createObjectURL = () => 'blob:test';
  (g.URL as unknown as Record<string, unknown>).revokeObjectURL = () => undefined;
  return { document: doc, byId };
}
