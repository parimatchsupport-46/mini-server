/**
 * Inline SVG icon set — 1.7px stroke, rounded caps, currentColor.
 * No external icon fonts/CDNs, so the dashboard works fully offline.
 */

const S = (paths, { size = 18, fill = 'none', stroke = 'currentColor', sw = 1.7, extra = '' } = {}) => `
<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}"
  stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>
  ${paths}
</svg>`;

export const icons = {
  logo: (o = {}) =>
    `<svg width="${o.size || 22}" height="${o.size || 22}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.2 20.2 8v8L12 20.8 3.8 16V8L12 3.2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M12 8.4 16.2 10.7v4.6L12 17.6 7.8 15.3v-4.6L12 8.4Z" fill="currentColor" opacity=".9"/>
    </svg>`,
  dashboard: (o) => S('<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>', o),
  projects: (o) => S('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2c.7 0 1.3.3 1.8.8l.9 1c.4.5 1 .8 1.7.8h5.4A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-10Z"/>', o),
  database: (o) => S('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>', o),
  files: (o) => S('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>', o),
  settings: (o) => S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>', o),
  plus: (o) => S('<path d="M12 5v14M5 12h14"/>', o),
  search: (o) => S('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>', o),
  copy: (o) => S('<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5.5A2.5 2.5 0 0 1 7.5 3H15"/>', o),
  check: (o) => S('<path d="M20 6 9 17l-5-5"/>', o),
  x: (o) => S('<path d="M18 6 6 18M6 6l12 12"/>', o),
  trash: (o) => S('<path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6"/><path d="M19 6v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>', o),
  edit: (o) => S('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>', o),
  download: (o) => S('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', o),
  upload: (o) => S('<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>', o),
  eye: (o) => S('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>', o),
  eyeOff: (o) => S('<path d="M10.6 5.7A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.9M6.3 6.8A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-1"/><path d="m3 3 18 18"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', o),
  lock: (o) => S('<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>', o),
  shield: (o) => S('<path d="M12 3 5 6v5.5c0 4.3 2.9 8.2 7 9.5 4.1-1.3 7-5.2 7-9.5V6l-7-3Z"/>', o),
  key: (o) => S('<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8-8"/><path d="m17 6 2.5 2.5M14.5 8.5 17 11"/>', o),
  activity: (o) => S('<path d="M3 12h4l2.5-7 4 14L16 12h5"/>', o),
  arrowRight: (o) => S('<path d="M5 12h14M13 6l6 6-6 6"/>', o),
  arrowLeft: (o) => S('<path d="M19 12H5M11 18l-6-6 6-6"/>', o),
  chevronRight: (o) => S('<path d="m9 18 6-6-6-6"/>', o),
  external: (o) => S('<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v4.5A2.5 2.5 0 0 1 15.5 21h-9A2.5 2.5 0 0 1 4 18.5v-9A2.5 2.5 0 0 1 6.5 7H11"/>', o),
  info: (o) => S('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>', o),
  alert: (o) => S('<path d="M12 3.5 21 19.5H3l9-16Z"/><path d="M12 9.5v4"/><path d="M12 16.5h.01"/>', o),
  clock: (o) => S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>', o),
  image: (o) => S('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>', o),
  file: (o) => S('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>', o),
  menu: (o) => S('<path d="M4 7h16M4 12h16M4 17h16"/>', o),
  logout: (o) => S('<path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>', o),
  refresh: (o) => S('<path d="M20 11a8 8 0 1 0-2.3 5.3"/><path d="M20 4.5V11h-6.5"/>', o),
  more: (o) => S('<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>', o),
  filter: (o) => S('<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>', o),
  bolt: (o) => S('<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>', o),
  server: (o) => S('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>', o),
  user: (o) => S('<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a8 8 0 0 1 15 0"/>', o),
  grid: (o) => S('<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>', o),
  list: (o) => S('<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>', o),
  play: (o) => S('<path d="m8 5 11 7-11 7V5Z"/>', o),
  pause: (o) => S('<rect x="7" y="5" width="3.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="3.5" height="14" rx="1.2"/>', o),
  globe: (o) => S('<circle cx="12" cy="12" r="9"/><path d="M3.5 9.5h17M3.5 14.5h17"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/>', o),
  mail: (o) => S('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>', o),
  code: (o) => S('<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>', o),
  spark: (o) => S('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>', o),
};

/** Render an icon by name. */
export function icon(name, opts = {}) {
  const fn = icons[name] || icons.info;
  return fn({ size: 18, ...opts });
}
