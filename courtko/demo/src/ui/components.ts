/** Reusable UI components (design doc 17 inventory). All return SafeHtml. */

import { encodeQr, qrToSvg } from '../domain/qr.ts';
import { formatPHP } from '../domain/money.ts';
import { formatDateTime } from '../domain/time.ts';
import { cls, escapeHtml, html, raw, type SafeHtml } from './html.ts';
import { icon } from './icons.ts';

export type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'link';

export function dataAttrs(data?: Record<string, string | number | boolean | null | undefined>): SafeHtml {
  if (!data) return raw('');
  return raw(
    Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null && v !== false)
      .map(([k, v]) => ` data-${k.replace(/[^a-z0-9-]/gi, '')}="${escapeHtml(String(v))}"`)
      .join(''),
  );
}

export function btn(label: string | SafeHtml, opts: { action?: string; data?: Record<string, string | number | boolean | null | undefined>; variant?: Variant; icon?: string; size?: 'sm' | 'md' | 'lg'; type?: 'button' | 'submit'; disabled?: boolean; href?: string; block?: boolean; title?: string; id?: string } = {}): SafeHtml {
  const c = cls('btn', `btn-${opts.variant ?? 'secondary'}`, opts.size && `btn-${opts.size}`, opts.block && 'btn-block');
  const inner = html`${opts.icon ? icon(opts.icon, opts.size === 'sm' ? 16 : 18) : ''}<span>${label}</span>`;
  if (opts.href) return html`<a class="${c}" href="${opts.href}"${opts.title ? raw(` title="${escapeHtml(opts.title)}"`) : ''}>${inner}</a>`;
  return html`<button class="${c}" type="${opts.type ?? 'button'}"${opts.action ? raw(` data-action="${escapeHtml(opts.action)}"`) : ''}${dataAttrs(opts.data)}${opts.disabled ? raw(' disabled') : ''}${opts.title ? raw(` title="${escapeHtml(opts.title)}"`) : ''}${opts.id ? raw(` id="${escapeHtml(opts.id)}"`) : ''}>${inner}</button>`;
}

const STATUS_TONE: Record<string, string> = {
  confirmed: 'success', completed: 'neutral', checked_in: 'info', slot_held: 'warning', payment_pending: 'warning', cancelled: 'neutral', refund_pending: 'warning',
  partially_refunded: 'info', refunded: 'info', no_show: 'danger', disputed: 'danger', failed: 'danger', expired: 'neutral', draft: 'neutral',
  captured: 'success', pending: 'warning', created: 'neutral', authorized: 'info', chargeback: 'danger',
  requested: 'warning', pending_approval: 'warning', approved: 'info', processing: 'warning', succeeded: 'success', rejected: 'neutral',
  scheduled: 'neutral', paid: 'success', reversed: 'danger', open: 'warning', evidence_submitted: 'info', won: 'success', lost: 'danger',
  pending_payment: 'warning', preparing: 'info', ready_for_pickup: 'success', claimed: 'neutral',
  held: 'warning', waitlisted: 'event', offered: 'event', withdrawn: 'neutral',
  active: 'success', pending_verification: 'warning', suspended: 'danger', published: 'success', unpublished: 'neutral', lifted: 'neutral',
  invited: 'warning', removed: 'neutral', verified: 'success', not_connected: 'neutral', pending_provider_setup: 'warning',
  processed: 'success', duplicate: 'info', ignored: 'neutral', info: 'info', warning: 'warning', critical: 'danger', matched: 'success',
  fee_variance: 'info', missing_capture: 'danger', amount_mismatch: 'danger', refund_mismatch: 'warning', unknown_reference: 'danger', event: 'event', blocked: 'neutral',
};

export function statusLabel(status: string): string {
  const special: Record<string, string> = { no_show: 'No-show', slot_held: 'Slot held', ready_for_pickup: 'Ready for pickup', pending_provider_setup: 'Pending provider setup', not_connected: 'Not connected', checked_in: 'Checked in' };
  return special[status] ?? status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function pill(status: string, label?: string): SafeHtml {
  return html`<span class="pill pill-${STATUS_TONE[status] ?? 'neutral'}">${label ?? statusLabel(status)}</span>`;
}

export function tag(text: string, tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'event' | 'accent' = 'neutral'): SafeHtml {
  return html`<span class="pill pill-${tone}">${text}</span>`;
}

export function money(c: number, opts: { signed?: boolean; compact?: boolean; strong?: boolean } = {}): SafeHtml {
  const t = formatPHP(c, opts);
  return opts.strong ? html`<strong class="money">${t}</strong>` : html`<span class="money">${t}</span>`;
}

export function kpi(label: string, value: string | SafeHtml, sub?: string | SafeHtml, opts: { icon?: string; tone?: string; href?: string } = {}): SafeHtml {
  const body = html`<div class="kpi-top">${opts.icon ? html`<span class="kpi-icon kpi-${opts.tone ?? 'primary'}">${icon(opts.icon, 18)}</span>` : ''}<span class="kpi-label">${label}</span></div><div class="kpi-value">${value}</div>${sub ? html`<div class="kpi-sub">${sub}</div>` : ''}`;
  return opts.href ? html`<a class="kpi card" href="${opts.href}">${body}</a>` : html`<div class="kpi card">${body}</div>`;
}

export function card(body: SafeHtml | string, opts: { title?: string | SafeHtml; actions?: SafeHtml | string; subtitle?: string | SafeHtml; pad?: boolean; cls?: string; id?: string } = {}): SafeHtml {
  return html`<section class="${cls('card', opts.pad === false && 'card-flush', opts.cls)}"${opts.id ? raw(` id="${escapeHtml(opts.id)}"`) : ''}>${opts.title || opts.actions ? html`<header class="card-head"><div>${opts.title ? html`<h3>${opts.title}</h3>` : ''}${opts.subtitle ? html`<p class="muted small">${opts.subtitle}</p>` : ''}</div>${opts.actions ? html`<div class="card-actions">${opts.actions}</div>` : ''}</header>` : ''}<div class="card-body">${body}</div></section>`;
}

export interface Column<T> {
  label: string;
  cell: (row: T) => SafeHtml | string | number;
  cls?: string;
  hideSm?: boolean;
}

export function table<T>(columns: Column<T>[], rows: T[], opts: { empty?: SafeHtml | string; rowAction?: (row: T) => { action: string; data: Record<string, string> } | null; caption?: string } = {}): SafeHtml {
  if (!rows.length) return opts.empty ? (typeof opts.empty === 'string' ? empty(opts.empty) : opts.empty) : empty('Nothing here yet');
  return html`<div class="table-wrap"><table class="table">${opts.caption ? html`<caption class="sr-only">${opts.caption}</caption>` : ''}<thead><tr>${columns.map((c) => html`<th class="${cls(c.cls, c.hideSm && 'hide-sm')}" scope="col">${c.label}</th>`)}</tr></thead><tbody>${rows.map((r) => {
    const ra = opts.rowAction?.(r);
    return html`<tr${ra ? raw(` class="clickable" data-action="${escapeHtml(ra.action)}" tabindex="0"`) : ''}${ra ? dataAttrs(ra.data) : ''}>${columns.map((c) => html`<td class="${cls(c.cls, c.hideSm && 'hide-sm')}" data-label="${c.label}">${c.cell(r) as SafeHtml}</td>`)}</tr>`;
  })}</tbody></table></div>`;
}

export function empty(title: string, text?: string, action?: SafeHtml, ic = 'sparkle'): SafeHtml {
  return html`<div class="empty">${icon(ic, 28)}<p class="empty-title">${title}</p>${text ? html`<p class="muted">${text}</p>` : ''}${action ?? ''}</div>`;
}

export function alertBox(kind: 'info' | 'success' | 'warning' | 'danger', title: string | SafeHtml, body?: string | SafeHtml, actions?: SafeHtml): SafeHtml {
  const ic = kind === 'success' ? 'checkCircle' : kind === 'info' ? 'info' : 'alert';
  return html`<div class="alert alert-${kind}" role="${kind === 'danger' ? 'alert' : 'status'}">${icon(ic, 20)}<div class="alert-body"><strong>${title}</strong>${body ? html`<div>${body}</div>` : ''}${actions ? html`<div class="alert-actions">${actions}</div>` : ''}</div></div>`;
}

export function field(opts: { name: string; label: string; type?: string; value?: string | number | null; required?: boolean; hint?: string | SafeHtml; placeholder?: string; autocomplete?: string; min?: string | number; max?: string | number; step?: string | number; inputmode?: string; pattern?: string; maxlength?: number; readonly?: boolean; id?: string }): SafeHtml {
  const id = opts.id ?? `f-${opts.name}`;
  const attrs = [
    opts.required && 'required',
    opts.readonly && 'readonly',
    opts.placeholder && `placeholder="${escapeHtml(opts.placeholder)}"`,
    opts.autocomplete && `autocomplete="${escapeHtml(opts.autocomplete)}"`,
    opts.min !== undefined && `min="${escapeHtml(String(opts.min))}"`,
    opts.max !== undefined && `max="${escapeHtml(String(opts.max))}"`,
    opts.step !== undefined && `step="${escapeHtml(String(opts.step))}"`,
    opts.inputmode && `inputmode="${escapeHtml(opts.inputmode)}"`,
    opts.pattern && `pattern="${escapeHtml(opts.pattern)}"`,
    opts.maxlength && `maxlength="${opts.maxlength}"`,
  ]
    .filter(Boolean)
    .join(' ');
  return html`<div class="field"><label for="${id}">${opts.label}${opts.required ? html`<span class="req" aria-hidden="true"> *</span>` : ''}</label><input id="${id}" name="${opts.name}" type="${opts.type ?? 'text'}" value="${opts.value ?? ''}" ${raw(attrs)} aria-describedby="${id}-hint ${id}-err"/>${opts.hint ? html`<p class="hint" id="${id}-hint">${opts.hint}</p>` : ''}<p class="field-error" id="${id}-err" role="alert"></p></div>`;
}

export function textarea(opts: { name: string; label: string; value?: string; required?: boolean; hint?: string; rows?: number; maxlength?: number; placeholder?: string }): SafeHtml {
  const id = `f-${opts.name}`;
  return html`<div class="field"><label for="${id}">${opts.label}${opts.required ? html`<span class="req" aria-hidden="true"> *</span>` : ''}</label><textarea id="${id}" name="${opts.name}" rows="${opts.rows ?? 3}"${opts.required ? raw(' required') : ''}${opts.maxlength ? raw(` maxlength="${opts.maxlength}"`) : ''}${opts.placeholder ? raw(` placeholder="${escapeHtml(opts.placeholder)}"`) : ''} aria-describedby="${id}-err">${opts.value ?? ''}</textarea>${opts.hint ? html`<p class="hint">${opts.hint}</p>` : ''}<p class="field-error" id="${id}-err" role="alert"></p></div>`;
}

export function select(opts: { name: string; label: string; options: { value: string; label: string }[]; value?: string | null; required?: boolean; hint?: string; change?: string; id?: string }): SafeHtml {
  const id = opts.id ?? `f-${opts.name}`;
  return html`<div class="field"><label for="${id}">${opts.label}</label><select id="${id}" name="${opts.name}"${opts.required ? raw(' required') : ''}${opts.change ? raw(` data-change="${escapeHtml(opts.change)}"`) : ''}>${opts.options.map((o) => html`<option value="${o.value}"${o.value === (opts.value ?? '') ? raw(' selected') : ''}>${o.label}</option>`)}</select>${opts.hint ? html`<p class="hint">${opts.hint}</p>` : ''}<p class="field-error" id="${id}-err" role="alert"></p></div>`;
}

export function checkbox(opts: { name: string; label: string | SafeHtml; checked?: boolean; required?: boolean; value?: string; change?: string; hint?: string }): SafeHtml {
  const id = `f-${opts.name}${opts.value ? `-${opts.value}` : ''}`;
  return html`<div class="check"><input type="checkbox" id="${id}" name="${opts.name}" value="${opts.value ?? 'on'}"${opts.checked ? raw(' checked') : ''}${opts.required ? raw(' required') : ''}${opts.change ? raw(` data-change="${escapeHtml(opts.change)}"`) : ''}/><label for="${id}">${opts.label}${opts.hint ? html`<span class="hint block">${opts.hint}</span>` : ''}</label><p class="field-error" id="f-${opts.name}-err" role="alert"></p></div>`;
}

export function toggle(opts: { label: string; checked: boolean; action: string; data?: Record<string, string>; disabled?: boolean; hint?: string }): SafeHtml {
  return html`<button type="button" class="${cls('switch', opts.checked && 'on')}" role="switch" aria-checked="${opts.checked ? 'true' : 'false'}" data-action="${opts.action}"${dataAttrs(opts.data)}${opts.disabled ? raw(' disabled') : ''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">${opts.label}${opts.hint ? html`<span class="hint block">${opts.hint}</span>` : ''}</span></button>`;
}

export function priceBreakdown(lines: { label: string; detail?: string; amount: number; kind: string; informational?: boolean }[], total: number, opts: { totalLabel?: string } = {}): SafeHtml {
  return html`<dl class="breakdown">${lines.map((l) => html`<div class="${cls('bd-row', l.kind === 'discount' && 'bd-discount', l.informational && 'bd-info')}"><dt>${l.label}${l.detail ? html`<span class="bd-detail">${l.detail}</span>` : ''}</dt><dd>${l.informational ? html`<span class="muted">${formatPHP(l.amount)}</span>` : money(l.amount)}</dd></div>`)}<div class="bd-row bd-total"><dt>${opts.totalLabel ?? 'Total'}</dt><dd>${money(total, { strong: true })}</dd></div></dl>`;
}

const qrCache = new Map<string, string>();
export function qrCode(text: string, size = 180, label = 'QR code'): SafeHtml {
  const key = `${text}|${size}`;
  if (!qrCache.has(key)) qrCache.set(key, qrToSvg(encodeQr(text, 'M'), { size, label }));
  return raw(`<div class="qr">${qrCache.get(key)}</div>`);
}

export function stars(rating: number, count?: number): SafeHtml {
  const full = Math.round(rating);
  return html`<span class="stars" aria-label="${rating.toFixed(1)} out of 5${count !== undefined ? ` from ${count} reviews` : ''}">${Array.from({ length: 5 }, (_, i) => html`<span class="${i < full ? 'star on' : 'star'}">${icon('star', 14)}</span>`)}${count !== undefined ? html`<span class="muted small">${rating ? rating.toFixed(1) : 'New'} (${count})</span>` : ''}</span>`;
}

export function tabs(items: { key: string; label: string; count?: number }[], active: string, action: string): SafeHtml {
  return html`<div class="tabs" role="tablist">${items.map((t) => html`<button role="tab" class="${cls('tab', t.key === active && 'active')}" aria-selected="${t.key === active ? 'true' : 'false'}" data-action="${action}" data-key="${t.key}">${t.label}${t.count !== undefined ? html`<span class="tab-count">${t.count}</span>` : ''}</button>`)}</div>`;
}

export function pageHeader(title: string | SafeHtml, opts: { subtitle?: string | SafeHtml; actions?: SafeHtml | string; back?: string; eyebrow?: string } = {}): SafeHtml {
  return html`<header class="page-head">${opts.back ? html`<a class="back" href="${opts.back}">${icon('chevronLeft', 16)} Back</a>` : ''}<div class="page-head-row"><div>${opts.eyebrow ? html`<p class="eyebrow">${opts.eyebrow}</p>` : ''}<h1>${title}</h1>${opts.subtitle ? html`<p class="muted">${opts.subtitle}</p>` : ''}</div>${opts.actions ? html`<div class="page-actions">${opts.actions}</div>` : ''}</div></header>`;
}

export function timeline(history: { from: string; to: string; at: number; by: string; reason?: string }[]): SafeHtml {
  if (!history.length) return html`<p class="muted small">No status changes yet.</p>`;
  return html`<ol class="timeline">${history.map((h) => html`<li><span class="tl-dot"></span><div><div>${pill(h.to)} <span class="muted small">${formatDateTime(h.at)}</span></div>${h.reason ? html`<div class="small">${h.reason}</div>` : ''}</div></li>`)}</ol>`;
}

export function dl(items: [string, SafeHtml | string | number | null | undefined][]): SafeHtml {
  return html`<dl class="dl">${items.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => html`<div><dt>${k}</dt><dd>${v as SafeHtml}</dd></div>`)}</dl>`;
}

export function steps(items: string[], current: number): SafeHtml {
  return html`<ol class="stepper">${items.map((s, i) => html`<li class="${cls(i < current && 'done', i === current && 'current')}" aria-current="${i === current ? 'step' : 'false'}"><span class="step-n">${i < current ? icon('check', 14) : i + 1}</span><span class="step-l">${s}</span></li>`)}</ol>`;
}

export function countdown(untilMs: number, label = ''): SafeHtml {
  return html`<span class="countdown" data-countdown="${untilMs}" aria-live="off">${label}</span>`;
}

export function skeleton(lines = 3): SafeHtml {
  return html`<div class="skeleton">${Array.from({ length: lines }, () => html`<span></span>`)}</div>`;
}
