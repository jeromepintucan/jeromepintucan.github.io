/**
 * Minimal, XSS-safe templating. Every interpolated value is HTML-escaped unless it is already SafeHtml.
 * Never interpolate into unquoted attributes, inline event handlers or URLs without `safeUrl`.
 */

export class SafeHtml {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"'`]/g, (c) => ESC[c]!);
}

type Value = SafeHtml | string | number | boolean | null | undefined | Value[];

function render(v: Value): string {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(String(v));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): SafeHtml {
  let out = strings[0]!;
  for (let i = 0; i < values.length; i++) out += render(values[i]!) + strings[i + 1]!;
  return new SafeHtml(out);
}

/** Trusted markup produced by our own code (SVG from the QR encoder, icons). */
export function raw(s: string): SafeHtml {
  return new SafeHtml(s);
}

export function join(parts: Value[], sep: SafeHtml | string = ''): SafeHtml {
  return new SafeHtml(parts.map(render).filter(Boolean).join(render(sep)));
}

export function cls(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/** Only internal hash routes, https, mailto and tel links are allowed. */
export function safeUrl(url: string): string {
  if (/^#\//.test(url) || /^https:\/\//.test(url) || /^mailto:/.test(url) || /^tel:/.test(url)) return url;
  return '#/';
}

export function when(cond: unknown, v: () => Value): Value {
  return cond ? v() : '';
}
