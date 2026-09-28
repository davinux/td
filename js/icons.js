// Resolution-independent SVG icons for towers, enemies and map tiles.
// Drawn in the same 3/4 view, palette and silhouettes as the 3D models
// (octagonal stone plinths, weapons aimed up-right, creatures facing
// right, isometric tile blocks), so shop / HUD / codex / editor icons
// read as the very things you see on the board. Every icon is a
// 48×48 viewBox centred on 0,0 — crisp at any size or devicePixelRatio.
// { animated: true } adds CSS-driven idle motion (spin / pulse / float / flap).

let uid = 0;

// --- color helpers -------------------------------------------------------
function rgb(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(hex, target, k) {
  const a = rgb(hex), b = rgb(target);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * k));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
const dk = (hex, k) => mix(hex, '#000000', k);
const lt = (hex, k) => mix(hex, '#ffffff', k);

// Gradient factory scoped to one SVG (ids must be unique per document).
function defs(u) {
  const list = [];
  let n = 0;
  return {
    lin(stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) {
      const id = `${u}g${n++}`;
      list.push(`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">`
        + stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')
        + `</linearGradient>`);
      return `url(#${id})`;
    },
    rad(stops, cx = 0.35, cy = 0.3, r = 0.8) {
      const id = `${u}g${n++}`;
      list.push(`<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">`
        + stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')
        + `</radialGradient>`);
      return `url(#${id})`;
    },
    html() { return list.length ? `<defs>${list.join('')}</defs>` : ''; },
  };
}

const f = (v) => +v.toFixed(2);
const pts = (arr) => arr.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');
const cls = (animated, name) => (animated ? ` class="${name}"` : '');
const OUT = '#0b1120'; // shared ink outline

function svg(className, size, body, d, label = '') {
  return `<svg class="${className}" viewBox="-24 -24 48 48" width="${size}" height="${size}" aria-hidden="true">`
    + (label ? `<title>${label}</title>` : '')
    + d.html() + body + `</svg>`;
}

// =========================================================================
// TOWERS
// =========================================================================

// Octagonal stone plinth in 3/4 view with the tower's colored trim band.
function plinth(d, color, cy = 10) {
  const rx = 15, ry = 6.2, h = 6.5;
  const P = [];
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    P.push([Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  const down = ([x, y], dy) => [x, y + dy];
  const face = (i, j, fill, y0 = 0, y1 = h) =>
    `<polygon points="${pts([down(P[i], y0), down(P[j], y0), down(P[j], y1), down(P[i], y1)])}" fill="${fill}"/>`;
  let s = `<ellipse cx="0" cy="${cy + h + 3.5}" rx="18" ry="4.2" fill="#000" opacity="0.35"/>`;
  // side faces: right, front-right, front-left, left
  s += face(7, 0, '#6b7280') + face(0, 1, '#8b919c') + face(1, 2, '#7a808b') + face(2, 3, '#5f6570') + face(3, 4, '#4b515b');
  // trim band
  const b0 = 2.2, b1 = 4;
  s += face(0, 1, color, b0, b1) + face(1, 2, dk(color, 0.15), b0, b1) + face(2, 3, dk(color, 0.3), b0, b1)
    + face(7, 0, dk(color, 0.1), b0, b1) + face(3, 4, dk(color, 0.4), b0, b1);
  // top + turntable
  s += `<polygon points="${pts(P)}" fill="${d.lin([[0, '#b3b8c2'], [1, '#8a909b']])}" stroke="${OUT}" stroke-width="0.8" stroke-opacity="0.5"/>`;
  s += `<ellipse cx="0" cy="${cy}" rx="10" ry="4.1" fill="${d.lin([[0, '#9aa3b1'], [1, '#5b6472']])}"/>`;
  s += `<ellipse cx="0" cy="${cy}" rx="10" ry="4.1" fill="none" stroke="${color}" stroke-width="1.1"/>`;
  // silhouette outline around the prism
  s += `<polyline points="${pts([P[4], down(P[4], h), down(P[3], h), down(P[2], h), down(P[1], h), down(P[0], h), down(P[7], h), P[7]])}" fill="none" stroke="${OUT}" stroke-width="1" stroke-opacity="0.55" stroke-linejoin="round"/>`;
  return s;
}

function towerHead(type, color, d, animated) {
  const steel = d.lin([[0, '#e2e8f0'], [1, '#64748b']]);
  const iron = d.lin([[0, '#6b7280'], [0.5, '#374151'], [1, '#111827']]);
  const o = `stroke="${OUT}" stroke-width="0.9" stroke-linejoin="round"`;
  switch (type) {
    case 'arrow': {
      const wood = d.lin([[0, '#a0662f'], [1, '#5a3314']]);
      return `<rect x="-3" y="2" width="6" height="7" rx="1" fill="#4a2c14" ${o}/>`
        + `<g transform="translate(0,1) rotate(-24)">`
        + `<rect x="-11" y="-2" width="22" height="4" rx="1" fill="${wood}" ${o}/>`
        + `<path d="M4,-12 Q13,0 4,12" fill="none" stroke="#3b2210" stroke-width="3.2" stroke-linecap="round"/>`
        + `<path d="M4,-12 Q13,0 4,12" fill="none" stroke="#8a5a2b" stroke-width="1.4" stroke-linecap="round"/>`
        + `<polyline points="4,-12 -3,0 4,12" fill="none" stroke="#f5f5f4" stroke-width="0.8"/>`
        + `<line x1="-7" y1="-0.2" x2="15" y2="-0.2" stroke="#e7dcc0" stroke-width="1.6"/>`
        + `<polygon points="15,-2.4 20,-0.2 15,2" fill="${steel}" ${o}/>`
        + `<polygon points="-9,-0.2 -6,-3.4 -4,-3.4 -6,-0.2 -4,3 -6,3" fill="${color}"/>`
        + `</g>`;
    }
    case 'cannon': {
      const barrel = d.lin([[0, '#6b7280'], [0.45, '#2b3038'], [1, '#0f1216']]);
      return `<polygon points="-9,0 3,-3 5,9 -7,11" fill="${dk(color, 0.35)}" ${o}/>`
        + `<g transform="translate(-1,-1) rotate(-22)">`
        + `<circle cx="-9" cy="0" r="3.6" fill="${iron}" ${o}/>`
        + `<path d="M-9,-5.4 L10,-3.8 L10,3.8 L-9,5.4 Z" fill="${barrel}" ${o}/>`
        + `<rect x="-3" y="-5.2" width="2" height="10.4" fill="${color}"/>`
        + `<rect x="4" y="-4.4" width="2" height="8.8" fill="${color}"/>`
        + `<rect x="10" y="-5.2" width="4" height="10.4" rx="1" fill="${barrel}" ${o}/>`
        + `<ellipse cx="14" cy="0" rx="1.4" ry="3.6" fill="#050505"/>`
        + `<path d="M-8,-3.8 L9,-2.6" stroke="#fff" stroke-opacity="0.35" stroke-width="1.1"/>`
        + `</g>`
        + `<polygon points="-4,2 8,-1 9,10 -3,12" fill="${color}" ${o}/>`
        + `<circle cx="2.5" cy="6" r="2" fill="${iron}"/>`;
    }
    case 'frost': {
      const ice = d.lin([[0, '#f0fdff'], [1, '#67e8f9']], 0, 0, 1, 1);
      const glowC = d.rad([[0, '#a5f3fc', 0.9], [1, '#22d3ee', 0]], 0.5, 0.5, 0.5);
      let spikes = '';
      for (const [x, h, tilt] of [[-8, 9, -18], [-4, 12, -6], [4, 11, 8], [8, 8, 20]]) {
        spikes += `<polygon points="${x - 2},8 ${x},${8 - h} ${x + 2},8" fill="${ice}" ${o} transform="rotate(${tilt} ${x} 8)"/>`;
      }
      return `<ellipse cx="0" cy="-8" rx="13" ry="13" fill="${glowC}"/>`
        + spikes
        + `<g${cls(animated, 'ico-float')}>`
        + `<polygon points="0,-22 7,-10 0,1 -7,-10" fill="#cffafe" ${o}/>`
        + `<polygon points="0,-22 0,1 -7,-10" fill="#7dd3fc"/>`
        + `<polygon points="0,-22 7,-10 0,-8" fill="#ffffff" opacity="0.7"/>`
        + `<ellipse cx="0" cy="-9" rx="11" ry="3.4" fill="none" stroke="#a5f3fc" stroke-width="1.3" opacity="0.9"/>`
        + `</g>`;
    }
    case 'sniper': {
      const body = d.lin([[0, '#5b5475'], [1, '#2a2540']]);
      return `<rect x="-4" y="1" width="8" height="8" rx="1" fill="${dk(color, 0.45)}" ${o}/>`
        + `<g transform="translate(-1,0) rotate(-20)">`
        + `<rect x="-12" y="-1" width="7" height="5" rx="1.2" fill="${color}" ${o}/>`
        + `<rect x="-6" y="-3" width="13" height="6.5" rx="1.5" fill="${body}" ${o}/>`
        + `<rect x="6" y="-1.3" width="15" height="2.6" fill="${iron}" ${o}/>`
        + `<rect x="19" y="-2.2" width="4" height="4.4" rx="0.6" fill="#111827" ${o}/>`
        + `<rect x="-4" y="-7.5" width="11" height="3.6" rx="1.8" fill="#1f2937" ${o}/>`
        + `<ellipse cx="7" cy="-5.7" rx="1" ry="1.8" fill="#ff3b6b"/>`
        + `<circle cx="7.2" cy="-6.3" r="0.5" fill="#fff"/>`
        + `</g>`;
    }
    case 'gatling': {
      const housing = d.lin([[0, '#cbd5e1'], [1, '#64748b']]);
      return `<rect x="-3.5" y="3" width="7" height="6" fill="#374151" ${o}/>`
        + `<g transform="translate(-2,0) rotate(-18)">`
        + `<rect x="-9" y="-5.5" width="12" height="11" rx="2" fill="${housing}" ${o}/>`
        + `<rect x="-8" y="-5.5" width="10" height="2.2" fill="${color}"/>`
        + `<rect x="-6" y="5" width="7" height="4" rx="1" fill="#4d5b2e" ${o}/>`
        + `<rect x="3" y="-4.6" width="14" height="2.4" rx="1" fill="${steel}" ${o}/>`
        + `<rect x="3" y="-1.2" width="14" height="2.4" rx="1" fill="${steel}" ${o}/>`
        + `<rect x="3" y="2.2" width="14" height="2.4" rx="1" fill="${steel}" ${o}/>`
        + `<rect x="6" y="-5.4" width="1.8" height="10.8" fill="#374151"/>`
        + `<g transform="translate(17.5,0)"><g${cls(animated, 'tower-anim-spin')}>`
        + `<ellipse cx="0" cy="0" rx="2.2" ry="5.8" fill="#1f2937" ${o}/>`
        + `<circle cx="0" cy="-3.4" r="0.9" fill="#94a3b8"/><circle cx="0" cy="0" r="0.9" fill="#94a3b8"/><circle cx="0" cy="3.4" r="0.9" fill="#94a3b8"/>`
        + `</g></g></g>`;
    }
    case 'tesla': {
      const copper = d.lin([[0, '#fdba74'], [0.5, '#c2702d'], [1, '#7c3a10']], 0, 0, 1, 0);
      const orb = d.rad([[0, '#ffffff'], [0.35, '#fef08a'], [1, '#eab308']], 0.35, 0.3, 0.7);
      const halo = d.rad([[0, '#fde047', 0.8], [1, '#fde047', 0]], 0.5, 0.5, 0.5);
      let coils = '';
      [[6, 7, 3], [0, 6, 2.6], [-6, 5, 2.2]].forEach(([y, rx, ry]) => {
        coils += `<ellipse cx="0" cy="${y}" rx="${rx}" ry="${ry}" fill="none" stroke="#5a2a0a" stroke-width="3.2"/>`
          + `<ellipse cx="0" cy="${y}" rx="${rx}" ry="${ry}" fill="none" stroke="${copper}" stroke-width="2"/>`;
      });
      return `<rect x="-2.2" y="-12" width="4.4" height="22" fill="${iron}" ${o}/>`
        + coils
        + `<line x1="-9" y1="9" x2="-11" y2="0" stroke="#94a3b8" stroke-width="1.4"/><circle cx="-11" cy="0" r="1.6" fill="${color}"/>`
        + `<line x1="9" y1="9" x2="11" y2="0" stroke="#94a3b8" stroke-width="1.4"/><circle cx="11" cy="0" r="1.6" fill="${color}"/>`
        + `<circle cx="0" cy="-16" r="10" fill="${halo}"${cls(animated, 'tower-anim-pulse')}/>`
        + `<circle cx="0" cy="-16" r="5.6" fill="${orb}" ${o}/>`
        + `<polyline points="-5,-19 -9,-16 -7,-13 -11,-10" fill="none" stroke="#fef9c3" stroke-width="1" stroke-linecap="round"${cls(animated, 'tower-anim-pulse')}/>`
        + `<polyline points="5,-20 9,-17 7,-15 11,-12" fill="none" stroke="#fef9c3" stroke-width="1" stroke-linecap="round"/>`;
    }
    case 'missile': {
      const pod = d.lin([[0, '#c43a4a'], [1, '#6b1420']]);
      let tubes = '';
      for (const y of [-3.4, 3.4]) {
        tubes += `<rect x="8" y="${y - 2}" width="3" height="4" fill="#1f2937" ${o}/>`
          + `<rect x="10" y="${y - 1.4}" width="4" height="2.8" fill="#f1f5f9"/>`
          + `<polygon points="14,${y - 1.4} 17.5,${y} 14,${y + 1.4}" fill="${color}" ${o}/>`;
      }
      return `<rect x="-3" y="2" width="6" height="7" fill="#374151" ${o}/>`
        + `<g transform="translate(-2,-1) rotate(-26)">`
        + `<rect x="-9" y="-7" width="18" height="14" rx="1.5" fill="${pod}" ${o}/>`
        + `<rect x="-9" y="-7" width="18" height="2.4" fill="${color}"/>`
        + `<rect x="-7" y="3" width="12" height="2" fill="#facc15"/>`
        + `<rect x="-7" y="3" width="2" height="2" fill="#1f2937"/><rect x="-3" y="3" width="2" height="2" fill="#1f2937"/><rect x="1" y="3" width="2" height="2" fill="#1f2937"/>`
        + tubes
        + `</g>`;
    }
    case 'mortar': {
      const tube = d.lin([[0, '#8a847c'], [0.5, '#5a554f'], [1, '#2a2724']], 0, 0, 1, 0);
      return `<ellipse cx="0" cy="8" rx="9" ry="3.6" fill="#44403c" ${o}/>`
        + `<rect x="-7" y="0" width="3" height="8" fill="#374151" ${o}/><rect x="4" y="0" width="3" height="8" fill="#374151" ${o}/>`
        + `<g transform="translate(0,4) rotate(38)">`
        + `<path d="M-6,0 L-7.5,-17 L7.5,-17 L6,0 Z" fill="${tube}" ${o}/>`
        + `<rect x="-7.2" y="-11" width="14.4" height="2.4" fill="${color}"/>`
        + `<rect x="-8.6" y="-19.5" width="17.2" height="3.6" rx="1" fill="#44403c" ${o}/>`
        + `<ellipse cx="0" cy="-19.5" rx="8.6" ry="2.6" fill="#57534e" ${o}/>`
        + `<ellipse cx="0" cy="-19.5" rx="6" ry="1.7" fill="#0c0a09"/>`
        + `<circle cx="0" cy="0" r="3" fill="${iron}" ${o}/>`
        + `</g>`;
    }
    case 'railgun': {
      const house = d.lin([[0, '#5b7a9a'], [1, '#243449']]);
      let coils = '';
      for (const x of [2, 7, 12]) {
        coils += `<ellipse cx="${x}" cy="0" rx="1.6" ry="5.2" fill="none" stroke="#0369a1" stroke-width="2.4"/>`
          + `<ellipse cx="${x}" cy="0" rx="1.6" ry="5.2" fill="none" stroke="#7dd3fc" stroke-width="1.1"${cls(animated, 'tower-anim-pulse')}/>`;
      }
      return `<rect x="-3" y="2" width="6" height="7" fill="#374151" ${o}/>`
        + `<g transform="translate(-2,0) rotate(-20)">`
        + `<rect x="-10" y="-5" width="10" height="10" rx="1.5" fill="${house}" ${o}/>`
        + `<rect x="-10" y="-5" width="10" height="2" fill="${color}"/>`
        + `<rect x="-11" y="-2" width="1.6" height="4" fill="#38bdf8"/>`
        + `<rect x="-1" y="-3.6" width="21" height="1.8" fill="${steel}" ${o}/>`
        + `<rect x="-1" y="1.8" width="21" height="1.8" fill="${steel}" ${o}/>`
        + `<line x1="0" y1="0" x2="21" y2="0" stroke="#38bdf8" stroke-width="2.2" opacity="0.5"/>`
        + `<line x1="0" y1="0" x2="21" y2="0" stroke="#e0f2fe" stroke-width="0.9"/>`
        + coils
        + `</g>`;
    }
    case 'tempest': {
      const gem = d.lin([[0, '#ccfbf1'], [1, '#14b8a6']], 0, 0, 1, 1);
      const halo = d.rad([[0, '#5eead4', 0.7], [1, '#2dd4bf', 0]], 0.5, 0.5, 0.5);
      let prongs = '';
      for (const [x2, y2, cx] of [[-11, -12, -9], [0, -16, 0], [11, -12, 9]]) {
        prongs += `<path d="M${x2 * 0.3},8 Q${cx},-2 ${x2},${y2}" fill="none" stroke="#0b3b37" stroke-width="3.6" stroke-linecap="round"/>`
          + `<path d="M${x2 * 0.3},8 Q${cx},-2 ${x2},${y2}" fill="none" stroke="#14766c" stroke-width="2" stroke-linecap="round"/>`
          + `<circle cx="${x2}" cy="${y2}" r="2.2" fill="#99f6e4" ${o}/>`;
      }
      return `<polygon points="-5,9 -3.5,2 3.5,2 5,9" fill="#115e59" ${o}/>`
        + prongs
        + `<circle cx="0" cy="-5" r="10" fill="${halo}"/>`
        + `<g${cls(animated, 'ico-float')}>`
        + `<polygon points="0,-12 5,-5 0,3 -5,-5" fill="${gem}" ${o}/>`
        + `<polygon points="0,-12 0,3 -5,-5" fill="#5eead4" opacity="0.8"/>`
        + `</g>`
        + `<g transform="translate(0,-5)"><g${cls(animated, 'tower-anim-spin')}>`
        + `<polygon points="-10,-1 -8,-3 -7.5,0" fill="#ccfbf1"/><polygon points="9,1 10.5,-1.5 11,1.5" fill="#ccfbf1"/><polygon points="-1,8 1,6.5 1.5,9" fill="#ccfbf1"/>`
        + `</g></g>`;
    }
    default:
      return `<circle cx="0" cy="0" r="6" fill="${color}" ${o}/>`;
  }
}

export function towerIconSVG(type, color, { size = 40, animated = false } = {}) {
  const u = `ic${++uid}`;
  const d = defs(u);
  const body = plinth(d, color) + towerHead(type, color, d, animated);
  return svg('tower-svg', size, body, d);
}

// =========================================================================
// ENEMIES
// =========================================================================

function eye(x, y, r, look = 0.45) {
  return `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${f(r * 1.1)}" fill="#fff" stroke="${OUT}" stroke-width="0.7"/>`
    + `<circle cx="${f(x + r * look)}" cy="${f(y + r * 0.1)}" r="${f(r * 0.55)}" fill="#0b0f19"/>`
    + `<circle cx="${f(x + r * look + r * 0.2)}" cy="${f(y - r * 0.25)}" r="${f(r * 0.18)}" fill="#fff"/>`;
}

function enemyBody(def, d, animated) {
  const base = def.color || '#9ca3af';
  const dark = dk(base, 0.5), darker = dk(base, 0.7), light = lt(base, 0.45);
  const skin = d.rad([[0, light], [0.55, base], [1, dark]], 0.35, 0.3, 0.8);
  const o = `stroke="${OUT}" stroke-width="1.1" stroke-linejoin="round"`;
  switch (def.shape || def.id) {
    case 'dart': {
      const hull = d.lin([[0, light], [0.5, base], [1, darker]]);
      const flame = d.lin([[0, '#fff7ed'], [0.4, '#fdba74'], [1, '#f472b6', 0]], 1, 0, 0, 0);
      return `<g${cls(animated, 'tower-anim-pulse')}><polygon points="-10,2 -23,-1 -23,5" fill="${flame}"/></g>`
        + `<line x1="-20" y1="-7" x2="-12" y2="-7" stroke="${light}" stroke-width="1.2" opacity="0.6"/>`
        + `<line x1="-22" y1="10" x2="-13" y2="10" stroke="${light}" stroke-width="1.2" opacity="0.5"/>`
        + `<polygon points="-6,4 -13,13 -2,7" fill="${dark}" ${o}/>`
        + `<path d="M20,2 L-10,-4 L-11,2 L-10,8 Z" fill="${hull}" ${o}/>`
        + `<polygon points="-8,-3 -13,-11 -3,-3" fill="${dark}" ${o}/>`
        + `<ellipse cx="3" cy="-1" rx="7" ry="3.2" fill="${d.lin([[0, '#ecfeff'], [1, '#22a3c2']])}" ${o}/>`
        + `<ellipse cx="1.5" cy="-2.2" rx="3" ry="1" fill="#fff" opacity="0.8"/>`
        + `<rect x="-12" y="0" width="3" height="4" rx="1" fill="#334155" ${o}/>`;
    }
    case 'armor': {
      const hull = d.lin([[0, light], [0.4, base], [1, dark]]);
      let wheels = '';
      for (const x of [-11, -5.5, 0, 5.5, 11]) wheels += `<circle cx="${x}" cy="12" r="2.6" fill="#78716c" stroke="#1c1917" stroke-width="1"/><circle cx="${x}" cy="12" r="0.9" fill="#1c1917"/>`;
      return `<rect x="-17" y="7.5" width="34" height="9" rx="4.5" fill="#1f1d1b" ${o}/>`
        + wheels
        + `<path d="M-15,8 L-14,-1 L10,-1 L16,4 L15,8 Z" fill="${hull}" ${o}/>`
        + `<rect x="-14" y="5" width="29" height="1.6" fill="${darker}" opacity="0.6"/>`
        + `<rect x="7" y="-6.6" width="15" height="3" rx="1" fill="#292524" ${o}/>`
        + `<path d="M-8,-1 L-7,-7 Q0,-11 7,-7 L8,-1 Z" fill="${d.lin([[0, light], [1, dark]])}" ${o}/>`
        + `<ellipse cx="-1" cy="-8.4" rx="3" ry="1.3" fill="#e7e5e4" ${o}/>`
        + `<circle cx="-10" cy="2" r="0.9" fill="${light}"/><circle cx="6" cy="2" r="0.9" fill="${light}"/>`;
    }
    case 'beetle': {
      const shell = d.rad([[0, lt(base, 0.6)], [0.5, base], [1, dark]], 0.35, 0.25, 0.8);
      let legs = '';
      for (const x of [-7, -1, 5]) {
        legs += `<polyline points="${x},6 ${x - 3},11 ${x - 5},17" fill="none" stroke="#1f2a12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      return legs
        + `<ellipse cx="-2" cy="1" rx="14" ry="9.5" fill="${shell}" ${o}/>`
        + `<path d="M-15,1 Q-2,-4 11,1" fill="none" stroke="${darker}" stroke-width="1.2"/>`
        + `<circle cx="-7" cy="-3" r="1.8" fill="${darker}" opacity="0.7"/><circle cx="0" cy="-4.5" r="1.5" fill="${darker}" opacity="0.7"/><circle cx="-4" cy="5" r="1.6" fill="${darker}" opacity="0.6"/>`
        + `<g${cls(animated, 'ico-flap')}>`
        + `<ellipse cx="-6" cy="-10" rx="9" ry="4" fill="#e0f2fe" opacity="0.6" stroke="#bae6fd" stroke-width="0.7" transform="rotate(-18 -6 -10)"/>`
        + `<ellipse cx="0" cy="-12" rx="8" ry="3.4" fill="#f0f9ff" opacity="0.5" stroke="#bae6fd" stroke-width="0.7" transform="rotate(-8 0 -12)"/>`
        + `</g>`
        + `<circle cx="13" cy="3" r="6" fill="#1f2a12" ${o}/>`
        + `<circle cx="15" cy="1.5" r="1.8" fill="#ff4d4d"/><circle cx="15.4" cy="1" r="0.6" fill="#fff"/>`
        + `<path d="M15,-2.5 Q17,-9 21,-10" fill="none" stroke="#1f2a12" stroke-width="1.2" stroke-linecap="round"/>`
        + `<path d="M12,-2.8 Q12,-10 15,-12" fill="none" stroke="#1f2a12" stroke-width="1.2" stroke-linecap="round"/>`
        + `<path d="M18,6 L21,8" stroke="#1f2a12" stroke-width="1.4" stroke-linecap="round"/>`;
    }
    case 'guardian': {
      const armor = d.rad([[0, lt(base, 0.7)], [0.45, base], [1, dk(base, 0.55)]], 0.35, 0.3, 0.75);
      const bubble = d.rad([[0, '#bfdbfe', 0.05], [0.8, '#93c5fd', 0.25], [1, '#dbeafe', 0.7]], 0.5, 0.5, 0.5);
      return `<g${cls(animated, 'tower-anim-pulse')}><circle cx="0" cy="0" r="20" fill="${bubble}" stroke="#bfdbfe" stroke-width="0.8" stroke-opacity="0.8"/></g>`
        + `<path d="M-19,4 A20,7 0 0 0 19,4" fill="none" stroke="#dbeafe" stroke-width="2" opacity="0.9"/>`
        + `<polygon points="-4,11 4,11 0,18" fill="#93c5fd" opacity="0.8"/>`
        + `<circle cx="0" cy="0" r="12" fill="${armor}" ${o}/>`
        + `<path d="M-12,1 A12,4 0 0 0 12,1" fill="none" stroke="${dk(base, 0.5)}" stroke-width="2.4"/>`
        + `<path d="M-2,-5 L11,-4 L11,1 L-2,0 Z" fill="#0b1220" ${o}/>`
        + `<rect x="1" y="-3.4" width="9" height="1.6" rx="0.8" fill="#7dd3fc"/>`
        + `<ellipse cx="-5" cy="-6" rx="3.5" ry="2" fill="#fff" opacity="0.55"/>`
        + `<path d="M-19,-3 A20,7 0 0 1 19,-3" fill="none" stroke="#dbeafe" stroke-width="2" opacity="0.45"/>`;
    }
    case 'warlord': {
      const hide = d.lin([[0, light], [0.5, base], [1, dark]], 0, 0, 1, 1);
      const gold = d.lin([[0, '#fff3b0'], [0.5, '#f5c542'], [1, '#a16207']]);
      const plate = d.rad([[0, lt(dark, 0.3)], [1, darker]], 0.35, 0.3, 0.8);
      return `<polygon points="0,-10 13,-4 15,9 6,17 -6,17 -15,9 -13,-4" fill="${hide}" ${o}/>`
        + `<polygon points="0,-10 13,-4 0,1 -13,-4" fill="${light}" opacity="0.35"/>`
        + `<path d="M-14,9 Q0,14 14,9" fill="none" stroke="${gold}" stroke-width="2.6"/>`
        + `<circle cx="-15" cy="-2" r="6" fill="${plate}" ${o}/><circle cx="15" cy="-2" r="6" fill="${plate}" ${o}/>`
        + `<polygon points="-19,-4 -22,-13 -15,-7" fill="${gold}" ${o}/><polygon points="19,-4 22,-13 15,-7" fill="${gold}" ${o}/>`
        + `<path d="M-8,-9 Q-15,-16 -13,-22 Q-10,-15 -5,-12 Z" fill="#efe7d6" ${o}/>`
        + `<path d="M8,-9 Q15,-16 13,-22 Q10,-15 5,-12 Z" fill="#efe7d6" ${o}/>`
        + `<polygon points="-7,-9 -7,-15 -4.5,-12 -2,-18 0,-13 2,-18 4.5,-12 7,-15 7,-9" fill="${gold}" ${o}/>`
        + `<circle cx="0" cy="-11" r="1.2" fill="#ef4444"/>`
        + `<path d="M-8,-3 L-2,-1 M8,-3 L2,-1" stroke="${darker}" stroke-width="2" stroke-linecap="round"/>`
        + `<ellipse cx="-4.5" cy="1" rx="2.6" ry="1.9" fill="#fff176"/><ellipse cx="4.5" cy="1" rx="2.6" ry="1.9" fill="#fff176"/>`
        + `<circle cx="-4" cy="1.2" r="0.9" fill="#7c2d12"/><circle cx="5" cy="1.2" r="0.9" fill="#7c2d12"/>`
        + `<path d="M-4,8 L-2,6 L0,8 L2,6 L4,8" fill="none" stroke="#fff" stroke-width="1.1"/>`;
    }
    case 'wisp': {
      const aura = d.rad([[0, '#ffffff', 0.95], [0.35, base, 0.8], [0.7, '#7dd3fc', 0.35], [1, '#7dd3fc', 0]], 0.5, 0.5, 0.5);
      return `<circle cx="-15" cy="4" r="4" fill="#bae6fd" opacity="0.35"/>`
        + `<circle cx="-9" cy="2" r="5.5" fill="#bae6fd" opacity="0.5"/>`
        + `<g${cls(animated, 'tower-anim-pulse')}><circle cx="2" cy="0" r="16" fill="${aura}"/></g>`
        + `<circle cx="2" cy="0" r="9" fill="${base}" opacity="0.55" stroke="#e0f2fe" stroke-width="0.9"/>`
        + `<circle cx="3" cy="-1" r="4.6" fill="#fff"/>`
        + `<g transform="translate(2,0)"><g${cls(animated, 'tower-anim-spin')}>`
        + `<polygon points="13,-2 14.5,0 13,2 11.5,0" fill="#fff"/><polygon points="-9,-10 -8,-8.5 -9,-7 -10,-8.5" fill="#e0f2fe"/><polygon points="-3,13 -2,14.5 -3,16 -4,14.5" fill="#e0f2fe"/>`
        + `</g></g>`;
    }
    case 'mitosis': {
      const memb = d.rad([[0, lt(base, 0.7), 0.95], [0.7, base, 0.85], [1, dark, 0.9]], 0.35, 0.3, 0.8);
      const nuc = dk(base, 0.45);
      return `<g${cls(animated, 'tower-anim-pulse')}><circle cx="-8" cy="3" r="9" fill="${memb}" ${o}/></g>`
        + `<circle cx="-9" cy="3" r="3.4" fill="${nuc}" opacity="0.8"/>`
        + `<circle cx="4" cy="-1" r="12" fill="${memb}" ${o}/>`
        + `<circle cx="3" cy="1" r="4" fill="${nuc}" opacity="0.75"/><circle cx="2" cy="0" r="1.3" fill="#fff" opacity="0.8"/>`
        + `<path d="M-3,-8 Q-5,2 -3,11" fill="none" stroke="${light}" stroke-width="2"/>`
        + `<ellipse cx="0" cy="-8" rx="4" ry="2" fill="#fff" opacity="0.55"/>`
        + eye(8, -4, 2.6) + eye(13, -3, 2.2);
    }
    case 'golem': {
      const rock = d.lin([[0, '#a8a29e'], [1, '#57534e']], 0, 0, 1, 1);
      const rockD = d.lin([[0, '#78716c'], [1, '#3a3632']], 0, 0, 1, 1);
      return `<polygon points="-10,14 -6,7 -2,14" fill="${rockD}" ${o}/><polygon points="2,14 6,7 10,14" fill="${rockD}" ${o}/>`
        + `<polygon points="-13,-6 -4,-12 8,-11 14,-3 13,9 3,14 -9,12 -15,4" fill="${rock}" ${o}/>`
        + `<polygon points="-13,-6 -4,-12 8,-11 1,-4" fill="#d6d3d1" opacity="0.35"/>`
        + `<polyline points="-2,2 2,-1 0,4 5,7" fill="none" stroke="#ff8a3d" stroke-width="1.6" stroke-linecap="round"/>`
        + `<polyline points="-9,-2 -6,2" fill="none" stroke="#ff8a3d" stroke-width="1.4" stroke-linecap="round"/>`
        + `<polygon points="-22,4 -17,-2 -12,2 -13,10 -20,11" fill="${rockD}" ${o}/>`
        + `<polygon points="22,6 17,0 12,4 13,12 20,13" fill="${rockD}" ${o}/>`
        + `<polygon points="0,-12 5,-20 13,-19 15,-12 9,-8 2,-8" fill="${rockD}" ${o}/>`
        + `<rect x="7" y="-16" width="3" height="1.8" fill="#ffb86b"/><rect x="11.5" y="-15.6" width="2.5" height="1.6" fill="#ffb86b"/>`
        + `<ellipse cx="-11" cy="-7" rx="4" ry="1.8" fill="#6a9a3a"/><ellipse cx="17" cy="0" rx="3" ry="1.3" fill="#6a9a3a"/>`;
    }
    case 'phantom': {
      const cloak = d.lin([[0, lt(base, 0.35)], [0.6, base], [1, dk(base, 0.5)]]);
      const badge = def.slowImmune
        ? `<g transform="translate(15,-15)"><circle r="5.5" fill="#0b1120" stroke="#67e8f9" stroke-width="1"/>`
          + `<path d="M-3.5,0 H3.5 M-1.75,-3 L1.75,3 M1.75,-3 L-1.75,3" stroke="#67e8f9" stroke-width="1.1"/>`
          + `<line x1="-4" y1="4" x2="4" y2="-4" stroke="#ef4444" stroke-width="1.6"/></g>`
        : '';
      return `<g${cls(animated, 'ico-float')}>`
        + `<ellipse cx="0" cy="8" rx="17" ry="4.5" fill="none" stroke="#67e8f9" stroke-width="1.4" opacity="0.8"/>`
        + `<path d="M0,-19 Q12,-18 12,-4 L13,14 L9,10 L6,16 L2,11 L-2,16 L-6,11 L-10,15 L-12,9 L-12,-4 Q-12,-18 0,-19 Z" fill="${cloak}" ${o}/>`
        + `<path d="M-3,-10 Q6,-14 9,-5 Q8,4 1,4 Q-5,2 -3,-10 Z" fill="#05030f"/>`
        + `<ellipse cx="2" cy="-4" rx="1.7" ry="2.2" fill="#c7f9ff"/><ellipse cx="6.5" cy="-4" rx="1.5" ry="2" fill="#c7f9ff"/>`
        + `<path d="M11,0 Q18,2 19,8" fill="none" stroke="${base}" stroke-width="3.2" stroke-linecap="round"/>`
        + `<path d="M-6,-16 Q-10,-8 -9,2" fill="none" stroke="${lt(base, 0.5)}" stroke-width="1.2" opacity="0.6"/>`
        + `</g>` + badge;
    }
    default: {
      // grunt / brute
      const belly = lt(base, 0.5);
      return `<ellipse cx="-6" cy="15" rx="5" ry="2.8" fill="${darker}" ${o}/><ellipse cx="6" cy="15" rx="5" ry="2.8" fill="${darker}" ${o}/>`
        + `<polygon points="-15,-4 -20,-9 -13,-9" fill="${darker}"/><polygon points="-16,3 -21,1 -15,-1" fill="${darker}"/>`
        + `<ellipse cx="0" cy="2" rx="15" ry="13.5" fill="${skin}" ${o}/>`
        + `<ellipse cx="3" cy="7" rx="8" ry="6" fill="${belly}" opacity="0.7"/>`
        + `<path d="M-6,-10 Q-12,-17 -9,-22 Q-6,-15 -2,-12 Z" fill="#f1ead8" ${o}/>`
        + `<path d="M6,-10 Q12,-17 10,-22 Q6,-15 3,-12 Z" fill="#f1ead8" ${o}/>`
        + `<circle cx="-15" cy="5" r="4" fill="${skin}" ${o}/><circle cx="15" cy="5" r="4" fill="${skin}" ${o}/>`
        + eye(-1, -3, 3.4) + eye(8, -3, 3.4)
        + `<path d="M-5,-8 L2,-6 M4,-6 L11,-8" stroke="${darker}" stroke-width="2.2" stroke-linecap="round"/>`
        + `<path d="M0,4 Q4,6 9,4" fill="none" stroke="${darker}" stroke-width="1.3" stroke-linecap="round"/>`
        + `<polygon points="0.5,4.2 1.8,1.2 2.8,4.6" fill="#fff"/><polygon points="7,4.6 8,1.4 9.2,4.2" fill="#fff"/>`;
    }
  }
}

// Enemy portrait. def = data/enemies.json entry.
export function enemyIconSVG(def, { size = 40, animated = false } = {}) {
  const u = `ic${++uid}`;
  const d = defs(u);
  const hover = ['dart', 'guardian', 'wisp', 'phantom'].includes(def.shape || def.id);
  const shadow = `<ellipse cx="0" cy="19" rx="${hover ? 11 : 16}" ry="${hover ? 2.6 : 3.6}" fill="#000" opacity="${hover ? 0.25 : 0.35}"/>`;
  return svg('enemy-svg', size, shadow + `<g transform="translate(0,-1)">${enemyBody(def, d, animated)}</g>`, d);
}

// =========================================================================
// TILES (editor palette, legends)
// =========================================================================

// Isometric block: top face centred at (0, top), depth h.
function block(d, top, h, cTop, cL, cR, stroke = true) {
  const T = [[0, top - 9], [18, top], [0, top + 9], [-18, top]];
  const L = [[-18, top], [0, top + 9], [0, top + 9 + h], [-18, top + h]];
  const R = [[0, top + 9], [18, top], [18, top + h], [0, top + 9 + h]];
  const s = stroke ? `stroke="${OUT}" stroke-width="0.8" stroke-opacity="0.45" stroke-linejoin="round"` : '';
  return `<polygon points="${pts(L)}" fill="${cL}" ${s}/>`
    + `<polygon points="${pts(R)}" fill="${cR}" ${s}/>`
    + `<polygon points="${pts(T)}" fill="${cTop}" ${s}/>`;
}
// Map a point on the unit top face (u,v in -1..1) to icon coordinates.
const iso = (u, v, top) => [f((u - v) * 9), f(top + (u + v) * 4.5)];

function tuft(x, y, c = '#86c955') {
  return `<path d="M${x - 2},${y} L${x - 2.6},${y - 3} M${x},${y} L${x},${y - 4} M${x + 2},${y} L${x + 2.6},${y - 3}" stroke="${c}" stroke-width="1.1" stroke-linecap="round"/>`;
}
function pine(x, y, s = 1) {
  const L = (w, hh, yy, c) => `<polygon points="${f(x - w * s)},${f(yy)} ${f(x)},${f(yy - hh * s)} ${f(x + w * s)},${f(yy)}" fill="${c}" stroke="${OUT}" stroke-width="0.6" stroke-opacity="0.5"/>`;
  return `<rect x="${f(x - 1.2 * s)}" y="${f(y - 3 * s)}" width="${f(2.4 * s)}" height="${f(3.5 * s)}" fill="#6b4423"/>`
    + L(6.5, 8, y - 2 * s, '#2f7d32') + L(5, 7, y - 6.5 * s, '#3a8f3a') + L(3.5, 6, y - 10.5 * s, '#48a348');
}

const TILE_ART = {
  buildable(d) {
    const top = -2;
    return block(d, top, 9, d.lin([[0, '#7cc44a'], [1, '#5a9f35']]), '#6b4a2e', '#553a23')
      + `<polygon points="${pts([[-18, top], [0, top + 9], [18, top], [18, top + 1.6], [0, top + 10.6], [-18, top + 1.6]])}" fill="#4c8a2e"/>`
      + tuft(-8, top + 1) + tuft(6, top - 3, '#9bd66a') + tuft(2, top + 5)
      + `<circle cx="-2" cy="${top - 4}" r="1.3" fill="#fde047"/><circle cx="10" cy="${top + 1}" r="1.1" fill="#f9a8d4"/>`;
  },
  path(d) {
    const top = 0;
    let s = block(d, top, 7, d.lin([[0, '#e0bb7e'], [1, '#bf9458']]), '#8a6038', '#6f4b2b');
    for (const [u, v, r] of [[-0.5, -0.3, 1.2], [0.4, 0.5, 1], [0.2, -0.6, 0.8], [-0.2, 0.6, 1.1], [0.7, -0.1, 0.9]]) {
      const [x, y] = iso(u, v, top);
      s += `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${f(r * 0.6)}" fill="#8a7a64"/>`;
    }
    const [a1, b1] = iso(-1, -0.25, top), [a2, b2] = iso(1, -0.25, top);
    const [c1, e1] = iso(-1, 0.25, top), [c2, e2] = iso(1, 0.25, top);
    return s + `<line x1="${a1}" y1="${b1}" x2="${a2}" y2="${b2}" stroke="#a7804c" stroke-width="1.1" opacity="0.6"/>`
      + `<line x1="${c1}" y1="${e1}" x2="${c2}" y2="${e2}" stroke="#a7804c" stroke-width="1.1" opacity="0.6"/>`;
  },
  mud(d) {
    const top = 0;
    let s = block(d, top, 7, d.lin([[0, '#7a5230'], [1, '#5a3a1f']]), '#5a3d26', '#452d1b');
    s += `<ellipse cx="-4" cy="${top - 1}" rx="7" ry="3.2" fill="#2e1c0e"/><ellipse cx="-5.5" cy="${top - 2}" rx="3" ry="0.9" fill="#fff" opacity="0.35"/>`;
    s += `<ellipse cx="7" cy="${top + 3}" rx="4.5" ry="2" fill="#2e1c0e"/><ellipse cx="6" cy="${top + 2.4}" rx="2" ry="0.6" fill="#fff" opacity="0.35"/>`;
    return s + `<circle cx="1" cy="${top + 4}" r="1.3" fill="#4a3019" stroke="#8a6a44" stroke-width="0.5"/><circle cx="-10" cy="${top + 2}" r="0.9" fill="#4a3019" stroke="#8a6a44" stroke-width="0.5"/>`;
  },
  blocked(d) {
    const top = -7;
    let s = block(d, top, 15, d.lin([[0, '#a3acb8'], [1, '#6b7280']]), '#5b6472', '#4a525e');
    s += `<path d="M-10,${top + 3} L-6,${top + 5} L-7,${top + 9}" fill="none" stroke="#475569" stroke-width="0.9"/>`;
    s += `<path d="M-14,${top + 6} L-12,${top + 12} L-9,${top + 14}" fill="none" stroke="#3b4350" stroke-width="0.9"/>`;
    s += `<path d="M8,${top + 11} L11,${top + 15} L10,${top + 19}" fill="none" stroke="#343b46" stroke-width="0.9"/>`;
    for (const [x, y, r] of [[-3, top - 2, 2.4], [5, top + 1, 1.8], [-8, top + 1, 1.4]]) {
      s += `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${f(r * 0.7)}" fill="#c3cad3" stroke="${OUT}" stroke-width="0.5" stroke-opacity="0.5"/>`;
    }
    return s;
  },
  water(d) {
    const top = 1;
    let s = block(d, top, 6, d.lin([[0, '#5fb0ec'], [1, '#2f7cc0']]), d.lin([[0, '#3a86c8', 0.9], [1, '#1f4f7a']]), d.lin([[0, '#2f74b0', 0.9], [1, '#173d60']]));
    s += `<ellipse cx="-3" cy="${top}" rx="8" ry="3.4" fill="none" stroke="#dbeafe" stroke-width="0.9" opacity="0.7"/>`;
    s += `<ellipse cx="-3" cy="${top}" rx="4" ry="1.7" fill="none" stroke="#dbeafe" stroke-width="0.8" opacity="0.55"/>`;
    s += `<path d="M5,${top + 4} a4,2 0 1 1 1,-0.5 L3,${top + 3} Z" fill="#3f9a3a" stroke="#1f5f1f" stroke-width="0.5"/>`;
    return s + `<circle cx="7" cy="${top + 1.5}" r="1" fill="#f9a8d4"/>`
      + `<path d="M-12,${top - 1} q2,-1 4,0" stroke="#fff" stroke-width="0.9" fill="none" opacity="0.7"/>`;
  },
  forest(d) {
    const top = 3;
    return block(d, top, 8, d.lin([[0, '#5e9f3c'], [1, '#447d2a']]), '#5a3d26', '#452d1b')
      + pine(-7, top + 2, 1.05) + pine(6, top - 1, 0.9) + pine(1, top + 6, 1.15)
      + tuft(11, top + 3, '#7cc44a');
  },
  rock(d) {
    const top = 2;
    return block(d, top, 8, d.lin([[0, '#a7a787'], [1, '#85856a']]), '#5a3d26', '#452d1b')
      + `<polygon points="-10,${top + 2} -8,${top - 7} 0,${top - 12} 8,${top - 8} 10,${top + 1} 3,${top + 5} -5,${top + 5}" fill="${d.lin([[0, '#efe7d6'], [1, '#a89e8a']], 0, 0, 1, 1)}" stroke="${OUT}" stroke-width="0.9" stroke-opacity="0.6" stroke-linejoin="round"/>`
      + `<polygon points="0,${top - 12} 8,${top - 8} 10,${top + 1} 2,${top - 3}" fill="#8f8573" opacity="0.55"/>`
      + `<ellipse cx="-3" cy="${top - 9}" rx="4.5" ry="1.8" fill="#6a9a3a"/>`
      + `<polygon points="11,${top + 5} 13,${top + 1} 16,${top + 3} 15,${top + 6}" fill="#b8ae98" stroke="${OUT}" stroke-width="0.6" stroke-opacity="0.5"/>`
      + `<polygon points="-15,${top + 1} -13,${top - 2} -11,${top + 1}" fill="#c8bea8" stroke="${OUT}" stroke-width="0.6" stroke-opacity="0.5"/>`;
  },
  spawn(d) {
    const top = 5;
    return block(d, top, 6, d.lin([[0, '#b58a6c'], [1, '#8f6650']]), '#6b4a2e', '#553a23')
      + `<ellipse cx="0" cy="${top}" rx="13" ry="5" fill="none" stroke="#ef4444" stroke-width="1.2" opacity="0.7"/>`
      + `<rect x="-11" y="${top - 21}" width="5" height="22" fill="#57534e" stroke="${OUT}" stroke-width="0.8"/>`
      + `<rect x="6" y="${top - 21}" width="5" height="22" fill="#44403c" stroke="${OUT}" stroke-width="0.8"/>`
      + `<ellipse cx="0" cy="${top - 10}" rx="6" ry="9" fill="${d.rad([[0, '#ffd08a'], [0.4, '#ff5a36'], [1, '#7f1d1d']], 0.5, 0.5, 0.55)}"/>`
      + `<path d="M0,${top - 16} q4,4 0,6 q-4,2 0,6" fill="none" stroke="#ffe4c4" stroke-width="1" opacity="0.8"/>`
      + `<rect x="-13" y="${top - 25}" width="26" height="5" rx="1" fill="#57534e" stroke="${OUT}" stroke-width="0.8"/>`
      + `<polygon points="0,${top - 25.5} 2,${top - 22.5} 0,${top - 19.5} -2,${top - 22.5}" fill="#ff7043"/>`
      + `<rect x="-9.6" y="${top - 13}" width="1.6" height="3" fill="#ff5a36"/><rect x="7.6" y="${top - 13}" width="1.6" height="3" fill="#ff5a36"/>`;
  },
  base(d) {
    const top = 8;
    const stone = d.lin([[0, '#d9dce2'], [0.5, '#b8bcc4'], [1, '#7c828c']], 0, 0, 1, 0);
    let crenel = '';
    for (const x of [-9, -3, 3, 9]) crenel += `<rect x="${x - 2}" y="${top - 21}" width="4" height="4" fill="${stone}" stroke="${OUT}" stroke-width="0.6"/>`;
    return block(d, top, 5, d.lin([[0, '#aab4c2'], [1, '#7f8a99']]), '#5b6472', '#4a525e')
      + `<ellipse cx="0" cy="${top}" rx="13" ry="5" fill="none" stroke="#60a5fa" stroke-width="1.2" opacity="0.8"/>`
      + `<path d="M-9,${top + 1} L-9,${top - 16} L9,${top - 16} L9,${top + 1} Q0,${top + 5} -9,${top + 1} Z" fill="${stone}" stroke="${OUT}" stroke-width="0.8"/>`
      + `<rect x="-10.5" y="${top - 18}" width="21" height="3" fill="#6b7280" stroke="${OUT}" stroke-width="0.6"/>`
      + crenel
      + `<path d="M-2.5,${top + 2} L-2.5,${top - 4} Q0,${top - 7} 2.5,${top - 4} L2.5,${top + 2} Z" fill="#3f2a1a"/>`
      + `<rect x="-7" y="${top - 12}" width="2.4" height="6" fill="#2563eb"/><rect x="4.6" y="${top - 12}" width="2.4" height="6" fill="#2563eb"/>`
      + `<circle cx="0" cy="${top - 25}" r="7" fill="${d.rad([[0, '#93c5fd', 0.7], [1, '#3b82f6', 0]], 0.5, 0.5, 0.5)}"/>`
      + `<polygon points="0,${top - 31} 4.2,${top - 25} 0,${top - 19} -4.2,${top - 25}" fill="#dbeafe" stroke="#1e3a8a" stroke-width="0.7"/>`
      + `<polygon points="0,${top - 31} 0,${top - 19} -4.2,${top - 25}" fill="#93c5fd"/>`;
  },
  erase(d) {
    const top = 2;
    return block(d, top, 8, d.lin([[0, '#7cc44a'], [1, '#5a9f35']]), '#6b4a2e', '#553a23')
      + `<polygon points="${pts([[0, top - 9], [18, top], [0, top + 9], [-18, top]])}" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="2.5 2" opacity="0.8"/>`
      + `<g transform="translate(3,${top - 8}) rotate(-35)">`
      + `<rect x="-9" y="-4" width="18" height="8" rx="1.6" fill="#f472b6" stroke="${OUT}" stroke-width="0.9"/>`
      + `<rect x="-9" y="-4" width="7" height="8" rx="1.6" fill="#e2e8f0" stroke="${OUT}" stroke-width="0.9"/>`
      + `<rect x="-2" y="-4" width="1.4" height="8" fill="#3b82f6"/>`
      + `</g>`
      + `<path d="M-12,${top + 8} l2,-2 M-8,${top + 10} l2,-2 M-15,${top + 5} l2,-2" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity="0.8"/>`;
  },
};

// Tile ids: buildable, path, mud, blocked, water, forest, rock, spawn, base, erase.
export function tileIconSVG(kind, { size = 24 } = {}) {
  const art = TILE_ART[kind] || TILE_ART.blocked;
  const u = `ic${++uid}`;
  const d = defs(u);
  return svg('tile-svg', size, `<g transform="translate(0,1)">${art(d)}</g>`, d);
}

export const TILE_ICON_KINDS = Object.keys(TILE_ART);
