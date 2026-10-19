type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration> | string };

/** Tiny hyperscript helper. `on*` attributes become event listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k === 'html') el.innerHTML = String(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function svgIcon(name: keyof typeof ICONS, cls = 'icon'): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.innerHTML = ICONS[name];
  return s;
}

const svg = (path: string, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export const ICONS = {
  credits: svg('<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2m0 8v2"/>'),
  oil: svg('<path d="M12 3c-3 4.5-6 7.8-6 11a6 6 0 0 0 12 0c0-3.2-3-6.5-6-11z" fill="currentColor" fill-opacity=".25"/>'),
  power: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" fill-opacity=".25"/>'),
  pop: svg('<path d="M4 13a8 8 0 0 1 16 0v1H4z" fill="currentColor" fill-opacity=".2"/><path d="M2 14h20M9 18h6"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'),
  play: svg('<path d="M7 5v14l11-7z" fill="currentColor" fill-opacity=".3"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  speed: svg('<path d="M5 6l7 6-7 6zM13 6l7 6-7 6z" fill="currentColor" fill-opacity=".25"/>'),
  build: svg('<path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6"/>'),
  army: svg('<path d="M4 15h13l3-3H8l-1-3H4z"/><circle cx="7" cy="17" r="2"/><circle cx="15" cy="17" r="2"/><path d="M12 9V6h7"/>'),
  market: svg('<path d="M3 17l5-5 4 4 8-9"/><path d="M15 7h5v5"/>'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" fill-opacity=".25"/>'),
  box: svg('<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 3"/><path d="M15 15l5 5"/>'),
  all: svg('<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><circle cx="8" cy="16" r="3"/><circle cx="16" cy="16" r="3"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>'),
  map: svg('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  fullscreen: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
  missile: svg('<path d="M14 3l7 7-9 9-4-1-1-4z"/><path d="M8 14l-4 4M10 16l-3 5M6 12l-3 3"/>'),
  flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  dollar: svg('<path d="M12 2v20M17 6.5c-.8-1.5-2.6-2.5-5-2.5-2.8 0-5 1.5-5 3.5S9.2 11 12 11.5s5 1.5 5 3.5-2.2 3.5-5 3.5c-2.4 0-4.2-1-5-2.5"/>'),
  sell: svg('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>'),
  trophy: svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  book: svg('<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>'),
  medal: svg('<circle cx="12" cy="15" r="5"/><path d="M8.5 11 6 3h4l2 5 2-5h4l-2.5 8"/>'),
  chevron: svg('<path d="M6 15l6-6 6 6"/>'),
  star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor" fill-opacity=".3"/>'),
  alert: svg('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>'),
  sound: svg('<path d="M11 5 6 9H3v6h3l5 4zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>'),
  home: svg('<path d="M3 11 12 4l9 7M5 10v10h14V10"/>'),
  supply: svg('<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>'),
  stability: svg('<path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z"/>'),
  opinion: svg('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>'),
  handshake: svg('<path d="M2 12l4-4 4 2 3-2 4 1 5 3"/><path d="M6 8v6l4 4 2-1 2 1 3-3 3-1"/><path d="M10 14l2 2M13 13l2 2"/>'),
  swords: svg('<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 6.5 17 3h3v3l-3.5 7.5M5 14l-2 7 7-2"/>'),
  flask: svg('<path d="M9 3h6M10 3v6L4 20h16L14 9V3"/><path d="M7 15h10"/>'),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  drone: svg('<circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/><rect x="10" y="10" width="4" height="4" rx="1"/>'),
  jet: svg('<path d="M12 2l2 7 8 4v2l-8-1-1 5 3 2v1h-8v-1l3-2-1-5-8 1v-2l8-4z"/>'),
  ship: svg('<path d="M3 17l2 4h14l2-4H3zM6 17V11h12v6M9 11V7h6v4M12 3v4"/>'),
  infantry: svg('<circle cx="12" cy="5" r="2.5"/><path d="M9 21l1-7-3-2 2-4h6l2 4-3 2 1 7"/>'),
  tank: svg('<rect x="3" y="13" width="18" height="6" rx="3"/><path d="M6 13l1-4h9l1 4M12 9h9"/>'),
  satellite: svg('<path d="M4 10l6-6 4 4-6 6z"/><path d="M14 14l3 3M17 13a4 4 0 0 1 4 4M17 9a8 8 0 0 1 8 8M10 14l-5 5"/>'),
  wrench: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
  parachute: svg('<path d="M3 10a9 7 0 0 1 18 0H3zM3 10l9 9 9-9M8 10l4 9 4-9"/>'),
  cyber: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>'),
  emp: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'),
  artillery: svg('<circle cx="7" cy="17" r="3"/><path d="M9 15 20 6M14 17h7"/>'),
  swarm: svg('<circle cx="6" cy="8" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="18" cy="8" r="1.5"/><circle cx="9" cy="13" r="1.5"/><circle cx="15" cy="13" r="1.5"/><path d="M12 22l-3-6M12 22l3-6"/>'),
  radar: svg('<path d="M12 12 19 5M12 12a7 7 0 1 0 7 7"/><circle cx="12" cy="12" r="2"/>'),
  aps: svg('<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  laser: svg('<path d="M3 21l7-7M12 12l9-9M14 4h6v6"/><circle cx="11" cy="13" r="2"/>'),
  stealth: svg('<path d="M2 14l10-8 10 8-4-1-6 3-6-3z"/>'),
  atom: svg('<circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>'),
  ew: svg('<path d="M4 12a8 8 0 0 1 16 0M7 12a5 5 0 0 1 10 0M10 12a2 2 0 0 1 4 0"/><path d="M12 12v9"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  crosshair: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),
  hold: svg('<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M10 9v6M14 9v6"/>'),
  deploy: svg('<path d="M4 20h16M7 20l5-14 5 14M9.5 13h5"/>'),
  rtb: svg('<path d="M3 11 12 4l9 7"/><path d="M12 20v-9M8 15l4-4 4 4"/>'),
  rally: svg('<path d="M5 21V4h11l-2 4 2 4H5"/><circle cx="5" cy="21" r="1"/>'),
  upgrade: svg('<path d="M12 3l7 7h-4v5H9v-5H5z"/><path d="M6 20h12"/>'),
  focus: svg('<path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/><circle cx="12" cy="12" r="3"/>'),
  builder: svg('<path d="M2 18h20M4 18v-5l4-2h6l3 3h3v4"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M14 11V6l5-2"/>'),
  layers: svg('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  chat: svg('<path d="M21 12a8 8 0 0 1-12 7l-6 2 2-6a8 8 0 1 1 16-3z"/>'),
  link: svg('<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'),
  users: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 4a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.7"/>'),
};
