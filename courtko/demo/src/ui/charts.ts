/** Dependency-free SVG charts (bar, line/area, heatmap, donut, sparkline). Text alternatives are included. */

import { escapeHtml, raw, type SafeHtml } from './html.ts';

export function barChart(data: { label: string; value: number; highlight?: boolean }[], opts: { height?: number; format?: (n: number) => string; title: string; color?: string } = { title: '' }): SafeHtml {
  // Bars are drawn in a stretchable SVG; axis labels are HTML so text never gets distorted or overlaps.
  const h = opts.height ?? 180;
  const n = Math.max(1, data.length);
  const w = n * 40;
  const max = Math.max(1, ...data.map((d) => d.value));
  const fmt = opts.format ?? ((v: number) => String(v));
  const every = n <= 8 ? 1 : n <= 16 ? 2 : Math.ceil(n / 8);
  const bars = data
    .map((d, i) => {
      const bh = Math.round(((h - 26) * d.value) / max);
      const x = i * 40 + 7;
      const y = h - 4 - bh;
      return `<g><title>${escapeHtml(`${d.label}: ${fmt(d.value)}`)}</title><rect x="${x}" y="${y}" width="26" height="${Math.max(1, bh)}" rx="3" fill="${d.highlight ? 'var(--ck-color-accent-strong)' : opts.color ?? 'var(--ck-color-primary)'}"/></g>`;
    })
    .join('');
  const values = data.map((d) => `<span>${d.value ? escapeHtml(fmt(d.value)) : ''}</span>`).join('');
  const labels = data.map((d, i) => `<span>${i % every === 0 || i === n - 1 ? escapeHtml(d.label) : ''}</span>`).join('');
  return raw(`<figure class="chart chart-bars" style="--n:${n}"><div class="chart-values" aria-hidden="true">${values}</div><svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(opts.title)}"><line x1="0" y1="${h - 4}" x2="${w}" y2="${h - 4}" class="chart-axis"/>${bars}</svg><div class="chart-xlabels" aria-hidden="true">${labels}</div><figcaption class="sr-only">${escapeHtml(opts.title)}: ${data.map((d) => `${d.label} ${fmt(d.value)}`).join(', ')}</figcaption></figure>`);
}

export function lineChart(series: { label: string; value: number }[], opts: { height?: number; title: string; format?: (n: number) => string }): SafeHtml {
  const h = opts.height ?? 160;
  const w = 600;
  const max = Math.max(1, ...series.map((d) => d.value));
  const step = (w - 20) / Math.max(1, series.length - 1);
  const pts = series.map((d, i) => [10 + i * step, h - 22 - ((h - 40) * d.value) / max] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const area = `${line}L${pts[pts.length - 1]![0].toFixed(1)} ${h - 22}L10 ${h - 22}Z`;
  const fmt = opts.format ?? String;
  const labels = series.map((d, i) => (i % Math.ceil(series.length / 6) === 0 || i === series.length - 1 ? `<text x="${pts[i]![0].toFixed(1)}" y="${h - 6}" text-anchor="middle" class="chart-label">${escapeHtml(d.label)}</text>` : '')).join('');
  return raw(`<figure class="chart"><svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(opts.title)}"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--ck-color-primary)" stop-opacity=".25"/><stop offset="1" stop-color="var(--ck-color-primary)" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#lg)"/><path d="${line}" fill="none" stroke="var(--ck-color-primary)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>${pts.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="var(--ck-color-primary)"><title>${escapeHtml(`${series[i]!.label}: ${fmt(series[i]!.value)}`)}</title></circle>`).join('')}${labels}</svg><figcaption class="sr-only">${escapeHtml(opts.title)}</figcaption></figure>`);
}

export function heatmap(grid: number[][], opts: { title: string; rowLabels: string[]; colLabels: string[] }): SafeHtml {
  const max = Math.max(1, ...grid.flat());
  const rows = grid
    .map((row, r) => `<div class="hm-row"><span class="hm-rl">${escapeHtml(opts.rowLabels[r]!)}</span>${row.map((v, c) => `<span class="hm-cell" style="--v:${(v / max).toFixed(2)}" title="${escapeHtml(`${opts.rowLabels[r]} ${opts.colLabels[c]}: ${v}`)}"></span>`).join('')}</div>`)
    .join('');
  const header = `<div class="hm-row hm-head"><span class="hm-rl"></span>${opts.colLabels.map((l, i) => `<span class="hm-cl">${i % 3 === 0 ? escapeHtml(l) : ''}</span>`).join('')}</div>`;
  return raw(`<figure class="heatmap" role="img" aria-label="${escapeHtml(opts.title)}">${header}${rows}<figcaption class="hm-legend"><span>Less</span><span class="hm-cell" style="--v:.1"></span><span class="hm-cell" style="--v:.4"></span><span class="hm-cell" style="--v:.7"></span><span class="hm-cell" style="--v:1"></span><span>More</span></figcaption></figure>`);
}

export function donut(parts: { label: string; value: number; color: string }[], opts: { title: string; center?: string }): SafeHtml {
  const total = Math.max(1, parts.reduce((a, p) => a + p.value, 0));
  let acc = 0;
  const r = 15.915;
  const arcs = parts
    .map((p) => {
      const pct = (p.value / total) * 100;
      const s = `<circle cx="21" cy="21" r="${r}" fill="none" stroke="${p.color}" stroke-width="6" stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}" stroke-dashoffset="${(25 - acc).toFixed(2)}"><title>${escapeHtml(`${p.label}: ${Math.round(pct)}%`)}</title></circle>`;
      acc += pct;
      return s;
    })
    .join('');
  const legend = parts.map((p) => `<li><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.label)} <b>${Math.round((p.value / total) * 100)}%</b></li>`).join('');
  return raw(`<figure class="donut"><svg viewBox="0 0 42 42" width="120" height="120" role="img" aria-label="${escapeHtml(opts.title)}"><circle cx="21" cy="21" r="${r}" fill="none" stroke="var(--ck-slate-100)" stroke-width="6"/>${arcs}${opts.center ? `<text x="21" y="23" text-anchor="middle" class="donut-center">${escapeHtml(opts.center)}</text>` : ''}</svg><ul class="legend">${legend}</ul></figure>`);
}

export function sparkline(values: number[], width = 90, height = 28): SafeHtml {
  const max = Math.max(1, ...values);
  const step = width / Math.max(1, values.length - 1);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(height - 2 - ((height - 4) * v) / max).toFixed(1)}`).join('');
  return raw(`<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`);
}
