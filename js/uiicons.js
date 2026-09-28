// Tiny UI line-icon set (24×24, stroke = currentColor) for navigation,
// menus and HUD controls. Consistent on every OS (unlike emoji) and crisp
// at any size. Use ui('name') for markup, or put <i data-ui="name"></i>
// placeholders in HTML and call hydrateIcons(root).
const P = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke-linejoin="round"/>',
  map: '<path d="M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5z"/><path d="M9 4v13M15 6.5v13"/>',
  enemies: '<path d="M5 13a7 7 0 0 1 14 0v5l-2.3-1.6L14.4 18 12 16.4 9.6 18l-2.3-1.6L5 18z"/><circle cx="9.5" cy="11.5" r="1.2" fill="currentColor"/><circle cx="14.5" cy="11.5" r="1.2" fill="currentColor"/>',
  tower: '<path d="M6 21h12M8 21l1-9h6l1 9"/><path d="M7 12h10V6h-2v2h-2V6h-2v2H9V6H7z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 0 1 5 1c0 1.8-2.5 2.2-2.5 3.8"/><circle cx="12" cy="17.2" r="0.6" fill="currentColor"/>',
  volume: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor"/>',
  fast: '<path d="M4 6l8 6-8 6zM12 6l8 6-8 6z" fill="currentColor" stroke-linejoin="round"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  coin: '<ellipse cx="12" cy="12" rx="8" ry="8" fill="#facc15" stroke="#a16207"/><path d="M12 7.5v9M9.8 9.5c0-1 1-1.6 2.2-1.6s2.3.6 2.3 1.6c0 2.3-4.5 1.3-4.5 3.8 0 1 1 1.6 2.2 1.6s2.3-.6 2.3-1.6" stroke="#713f12" stroke-width="1.5"/>',
  heart: '<path d="M12 20s-7.5-4.5-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10C19.5 15.5 12 20 12 20z" fill="#f43f5e" stroke="#9f1239"/>',
  wave: '<path d="M3 9c2 0 2-2 4.5-2S10 9 12 9s2-2 4.5-2S19 9 21 9M3 15c2 0 2-2 4.5-2s2.5 2 4.5 2 2-2 4.5-2 2.5 2 4.5 2" stroke="#38bdf8"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" fill="currentColor" stroke-linejoin="round"/>',
  sell: '<circle cx="12" cy="12" r="8"/><path d="M8.5 12h7"/>',
  upgrade: '<path d="M12 19V6M6.5 11.5L12 6l5.5 5.5"/><path d="M6 20h12"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="15" cy="15" r="1.3" fill="currentColor"/><circle cx="15" cy="9" r="1.3" fill="currentColor"/><circle cx="9" cy="15" r="1.3" fill="currentColor"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7l-1-3h-5z"/>',
  flag: '<path d="M6 21V4"/><path d="M6 4h11l-2.5 4L17 12H6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  levels: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  castle: '<path d="M4 21V9h3V6h2v3h2V4h2v5h2V6h2v3h3v12z" fill="currentColor" opacity="0.18"/><path d="M4 21V9h3V6h2v3h2V4h2v5h2V6h2v3h3v12z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/>',
};

export function ui(name, { size = 18, cls = '' } = {}) {
  const body = P[name] || P.help;
  return `<svg class="ui-ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// Replace every <i data-ui="name" [data-size="n"]></i> under root.
export function hydrateIcons(root = document) {
  root.querySelectorAll('i[data-ui]').forEach((el) => {
    el.outerHTML = ui(el.dataset.ui, { size: +(el.dataset.size || 18) });
  });
}
