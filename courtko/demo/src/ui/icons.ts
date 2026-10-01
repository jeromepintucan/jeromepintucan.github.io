/** Original line icons (24×24, 2px stroke, currentColor). */

import { raw, type SafeHtml } from './html.ts';

const P: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  ticket: 'M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM12 7v10',
  trophy: 'M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 13.5a6 6 0 0 1 4 6',
  bag: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  heart: 'M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  wallet: 'M4 7h15a1 1 0 0 1 1 1v11H4a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2h12M16 13h2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  key: 'M14 10a4 4 0 1 0-3.9 4.9L3 22M7 18l2 2M9 16l2 2',
  pin: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  court: 'M3 5h18v14H3zM12 5v14M3 9h4M3 15h4M17 9h4M17 15h4',
  building: 'M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 8h2M14 8h2M8 12h2M14 12h2',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4',
  refresh: 'M20 11a8 8 0 0 0-14-5l-2 2M4 13a8 8 0 0 0 14 5l2-2M4 4v4h4M20 20v-4h-4',
  alert: 'M12 3l10 18H2zM12 10v4M12 17.5v.5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.5v.5',
  check: 'M4 12l5 5L20 6',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6',
  x: 'M6 6l12 12M18 6L6 18',
  chevronRight: 'M9 5l7 7-7 7',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronDown: 'M5 9l7 7 7-7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.5M3.5 12h.5M3.5 18h.5',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2M14 18h2v2M18 18h2v2',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h11',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  star: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.3L12 17.5 6.5 20.4l1-6.3L3 9.7l6.2-.9z',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5',
  gift: 'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7s-1.5-4-4-4a2 2 0 0 0 0 4zM12 7s1.5-4 4-4a2 2 0 0 1 0 4z',
  zap: 'M13 2L4 14h7l-1 8 9-12h-7z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  roof: 'M3 11l9-6 9 6M5 10v10h14V10',
  cloud: 'M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  phone: 'M8 3h8v18H8zM11 18h2',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  message: 'M4 5h16v11H9l-5 4z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  play: 'M7 5l12 7-12 7z',
  pause: 'M8 5v14M16 5v14',
  fastForward: 'M4 6l8 6-8 6zM12 6l8 6-8 6z',
  terminal: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h3',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.5',
  percent: 'M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  scale: 'M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0zM8 21h8',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  headset: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1zM20 14h-3v6h2a1 1 0 0 0 1-1z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  paddle: 'M14.5 3.5a5 5 0 0 1 0 7l-3 3-5-5 3-3a5 5 0 0 1 5-2zM6.5 8.5l5 5M8.5 15.5L4 20',
  ball: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 8h.5M15 9h.5M8 14h.5M12 12h.5M16 15h.5M12 17h.5',
};

export function icon(name: keyof typeof P | string, size = 20, label?: string): SafeHtml {
  const d = P[name] ?? P.info!;
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '')}"` : 'aria-hidden="true" focusable="false"';
  return raw(`<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${a11y}><path d="${d}"/></svg>`);
}

export function logo(size = 28): SafeHtml {
  return raw(
    `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#0F7A5A"/><rect x="6" y="8" width="20" height="16" rx="2" fill="none" stroke="#C8F169" stroke-width="2"/><path d="M16 8v16M6 13h5M6 19h5M21 13h5M21 19h5" stroke="#C8F169" stroke-width="1.6"/><circle cx="22.5" cy="10.5" r="3.2" fill="#C8F169"/><circle cx="21.6" cy="9.8" r=".55" fill="#0F7A5A"/><circle cx="23.4" cy="11.2" r=".55" fill="#0F7A5A"/></svg>`,
  );
}
