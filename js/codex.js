// Enemy codex: browse every enemy from data/enemies.json with live stats,
// animated 2D portraits, and a 3D showcase (same meshes as the game).
import { ENEMY_STATS, ENEMY_ORDER, sortedEnemies } from './content.js';
import { enemyIconSVG } from './icons.js';
import { createEnemyViewer } from './view3d.js';

let mode = '3d'; // '2d' | '3d' — 3D showcase is the default
let visible = false;
let built = false;
let cards = []; // { def, canvas, el }
let rafId = 0;
let viewer = null;
let viewerLoading = false;
let selectedId = null;

function getEl(id) {
  return document.getElementById(id);
}

export function initCodex() {
  if (built) return;
  const wrap = getEl('codex-cards');
  wrap.innerHTML = '';
  cards = [];
  // weak -> strong showcase order
  for (const def of sortedEnemies()) {
    const card = document.createElement('div');
    card.className = 'codex-card';
    card.innerHTML = `
      ${enemyIconSVG(def, { size: 72, animated: true })}
      <b>${def.name}</b>
      <small class="codex-desc">${def.desc}</small>
      <div class="codex-stats">
        <span title="Hit points (wave 1, Normal)">❤️ ${def.hp}</span>
        <span title="Movement speed">👟 ${def.speed}</span>
        <span title="Gold per kill">💰 ${def.reward}g</span>
        <span title="Lives lost if it reaches your base">💀 ${def.leak}</span>
      </div>
    `;
    card.onclick = () => selectFor3D(def);
    wrap.appendChild(card);
    cards.push({ def, el: card });
  }
  getEl('codex-2d').onclick = () => setMode('2d');
  getEl('codex-3d').onclick = () => setMode('3d');
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
  getEl('codex-2d').classList.toggle('active', m === '2d');
  getEl('codex-3d').classList.toggle('active', m === '3d');
  getEl('codex-stage').classList.toggle('hidden', m !== '3d');
  getEl('codex-cards').classList.toggle('selectable', m === '3d');
  cancelAnimationFrame(rafId);
  if (viewer) viewer.stop();
  if (!visible) return;
  if (m === '2d') {
    pump();
  } else {
    await startViewer();
  }
}

async function startViewer() {
  const stage = getEl('codex-stage');
  if (!viewer && !viewerLoading) {
    viewerLoading = true;
    stage.innerHTML = '<div class="status">Loading 3D…</div>';
    try {
      viewer = createEnemyViewer(stage);
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
  const def = ENEMY_STATS[selectedId] || ENEMY_STATS[ENEMY_ORDER[0]];
  if (def) selectFor3D(def);
}

// 2D portraits are animated SVG (CSS idle motion) — nothing to repaint.
function pump() {}

export function setVisible(v) {
  visible = v;
  cancelAnimationFrame(rafId);
  if (viewer) viewer.stop();
  if (v && built) {
    if (mode === '2d') pump();
    else startViewer();
  }
}
