/** Generated, original artwork (no photos): venue covers drawn as stylized courts, product tiles, avatars. */

import { raw, type SafeHtml } from './html.ts';

export function venueCover(art: { hue: number; accent: number; pattern: 'lines' | 'dots' | 'waves' }, opts: { label?: string; height?: number; compact?: boolean } = {}): SafeHtml {
  const h = art.hue;
  const a = art.accent;
  const id = `g${h}${a}${art.pattern}`;
  const pattern =
    art.pattern === 'dots'
      ? `<pattern id="p${id}" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.4" fill="hsla(${a},70%,85%,.18)"/></pattern>`
      : art.pattern === 'waves'
        ? `<pattern id="p${id}" width="40" height="14" patternUnits="userSpaceOnUse"><path d="M0 7q10-7 20 0t20 0" fill="none" stroke="hsla(${a},70%,85%,.16)" stroke-width="2"/></pattern>`
        : `<pattern id="p${id}" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0v14" stroke="hsla(${a},70%,85%,.14)" stroke-width="3"/></pattern>`;
  return raw(`<svg class="cover" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${(opts.label ?? 'Venue illustration').replace(/"/g, '')}">
<defs><linearGradient id="bg${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,26%)"/><stop offset="1" stop-color="hsl(${(h + 25) % 360},60%,16%)"/></linearGradient>${pattern}</defs>
<rect width="320" height="180" fill="url(#bg${id})"/><rect width="320" height="180" fill="url(#p${id})"/>
<g transform="translate(160 96) rotate(-12) skewX(-14)"><rect x="-96" y="-50" width="192" height="100" rx="3" fill="hsl(${h},48%,36%)" stroke="#fff" stroke-opacity=".9" stroke-width="2.4"/>
<rect x="-26" y="-50" width="52" height="100" fill="hsl(${h},52%,30%)"/><path d="M0 -50v100M-96 0h70M26 0h70M-26 -50v100M26 -50v100" stroke="#fff" stroke-opacity=".85" stroke-width="2"/>
<path d="M0 -58v116" stroke="#E2E8F0" stroke-width="4"/><path d="M0 -58v116" stroke="#0B1B2B" stroke-opacity=".5" stroke-width="1" stroke-dasharray="3 3"/></g>
<circle cx="236" cy="54" r="11" fill="#C8F169"/><circle cx="232" cy="50" r="1.5" fill="hsl(${h},55%,26%)"/><circle cx="240" cy="55" r="1.5" fill="hsl(${h},55%,26%)"/><circle cx="235" cy="59" r="1.5" fill="hsl(${h},55%,26%)"/><circle cx="238" cy="48" r="1.2" fill="hsl(${h},55%,26%)"/>
<path d="M226 64q-20 20-50 18" fill="none" stroke="#C8F169" stroke-opacity=".5" stroke-width="2" stroke-dasharray="2 5" stroke-linecap="round"/>
</svg>`);
}

const GLYPH: Record<string, string> = {
  drinks: '<path d="M22 14h20l-3 34a3 3 0 0 1-3 3H28a3 3 0 0 1-3-3z" fill="#fff" fill-opacity=".9"/><path d="M24 24h16" stroke="currentColor" stroke-width="3"/>',
  food: '<path d="M16 40q16-30 32 0z" fill="#fff" fill-opacity=".9"/><path d="M14 42h36" stroke="#fff" stroke-width="4" stroke-linecap="round"/>',
  rental: '<ellipse cx="28" cy="26" rx="12" ry="14" fill="#fff" fill-opacity=".9"/><path d="M36 36l12 12" stroke="#fff" stroke-width="6" stroke-linecap="round"/>',
  balls: '<circle cx="24" cy="36" r="10" fill="#C8F169"/><circle cx="40" cy="36" r="10" fill="#C8F169"/><circle cx="32" cy="22" r="10" fill="#C8F169"/>',
  merch: '<path d="M20 16l8-4h8l8 4 6 8-6 4-3-3v23H23V25l-3 3-6-4z" fill="#fff" fill-opacity=".9"/>',
  equipment: '<rect x="18" y="20" width="28" height="24" rx="4" fill="#fff" fill-opacity=".9"/>',
  service: '<circle cx="32" cy="32" r="14" fill="#fff" fill-opacity=".9"/>',
};

export function productTile(art: { hue: number; glyph: string }, size = 64): SafeHtml {
  return raw(`<svg class="ptile" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="hsl(${art.hue},55%,38%)"/><g color="hsl(${art.hue},55%,38%)">${GLYPH[art.glyph] ?? GLYPH.service}</g></svg>`);
}

export function avatar(name: string, hue: number, size = 36): SafeHtml {
  const initials = name
    .replace(/[^A-Za-zÀ-ÿñÑ .]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return raw(`<span class="avatar" style="width:${size}px;height:${size}px;background:hsl(${hue},45%,35%);font-size:${Math.round(size * 0.38)}px" aria-hidden="true">${initials || '?'}</span>`);
}
