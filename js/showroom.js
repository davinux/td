// Tower showroom: browse every tower from data/towers.json with live stats,
// crisp SVG portraits (CSS-animated), and a 3D showcase (same meshes as the game).
// Mirrors js/codex.js (the enemy codex).
import { TOWERS, TOWER_ORDER, sortedTowers } from './content.js';
import { towerIconSVG } from './towersvg.js';
import { towerAbilities } from './tooltip.js';
import { createTowerViewer } from './view3d.js';

let mode = '3d'; // '2d' | '3d' — 3D showcase is the default
let visible = false;
let built = false;
let cards = []; // { def, el }
let viewer = null;
let viewerLoading = false;
let selectedId = null;

function getEl(id) {
  return document.getElementById(id);
}

export function initShowroom() {
  if (built) return;
  const wrap = getEl('showroom-cards');
  wrap.innerHTML = '';
  cards = [];
  // weak -> strong showcase order
  for (const def of sortedTowers()) {
    const dps = Math.round(def.dmg * def.rate * (def.chain || 1));
    const card = document.createElement('div');
    card.className = 'codex-card';
    card.innerHTML = `
      ${towerIconSVG(def.id, def.color, { size: 72, animated: true })}
      <b>${def.name} — ${def.cost}g</b>
      <small class="codex-desc">${def.desc}</small>
      <div class="codex-stats">
        <span title="Damage per shot">💥 ${def.dmg}</span>
        <span title="Range in pixels">📏 ${def.range}</span>
        <span title="Shots per second">🔥 ${def.rate}/s</span>
        <span title="Damage per second">⚔️ ${dps}</span>
      </div>
      <div class="ab-row">${towerAbilities(def)}</div>
    `;
    card.onclick = () => selectFor3D(def);
    wrap.appendChild(card);
    cards.push({ def, el: card });
  }
  getEl('showroom-2d').onclick = () => setMode('2d');
  getEl('showroom-3d').onclick = () => setMode('3d');
  built = true;
  setMode('3d'); // default view; viewer itself starts on first setVisible(true)
}

function selectFor3D(def) {
  selectedId = def.id;
  for (const c of cards) c.el.classList.toggle('selected', c.def.id === def.id);
  if (mode === '3d' && viewer) viewer.show(def);
}

async function setMode(m) {
  mode = m;
  getEl('showroom-2d').classList.toggle('active', m === '2d');
  getEl('showroom-3d').classList.toggle('active', m === '3d');
  getEl('showroom-stage').classList.toggle('hidden', m !== '3d');
  getEl('showroom-cards').classList.toggle('selectable', m === '3d');
  if (viewer) viewer.stop();
  if (!visible) return;
  if (m === '3d') {
    await startViewer();
  }
  // '2d' portraits are inline SVG with CSS motion — no repaint loop needed.
}

async function startViewer() {
  const stage = getEl('showroom-stage');
  if (!viewer && !viewerLoading) {
    viewerLoading = true;
    stage.innerHTML = '<div class="status">Loading 3D…</div>';
    try {
      viewer = createTowerViewer(stage);
      await viewer.start(); // appends its own canvas to the stage
      stage.querySelector('.status')?.remove();
    } catch (err) {
      stage.innerHTML = `<div class="status err">⚠️ Couldn't start the 3D viewer: ${err.message}</div>`;
      viewer = null;
    } finally {
      viewerLoading = false;
    }
  } else if (viewer) {
    viewer.start();
  }
  const def = TOWERS[selectedId] || TOWERS[TOWER_ORDER[0]];
  if (def) selectFor3D(def);
}

export function setVisible(v) {
  visible = v;
  if (viewer) viewer.stop();
  if (v && built) {
    if (mode === '3d') startViewer();
  }
}
