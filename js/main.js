// App shell: menu / editor / play views + campaign wiring.
import { initEditor } from './editor.js';
import { initGame } from './game.js';
import {
  WORLDS, MAP_COUNT, DIFFS, DIFF_IDS, archName, levelDef, mapConfig,
  parseLevelId, loadProgress, completeMap, bestRank,
  isMapUnlocked, isWorldUnlocked, rankStars, loadCampaign, isLoaded,
} from './levels.js';
import { loadContent } from './content.js';
import { initCodex, setVisible as setCodexVisible } from './codex.js';
import { initShowroom, setVisible as setShowroomVisible } from './showroom.js';
import { hideTooltip } from './tooltip.js';
import { createMenuBackdrop } from './menu3d.js';
import {
  getSoundSettings, setSoundEnabled, setSoundVolume, setSoundMuted,
  onSoundChange, playClick,
} from './audio.js';
import { ui, hydrateIcons } from './uiicons.js';
import { enemyIconSVG, towerIconSVG, tileIconSVG } from './icons.js';

hydrateIcons(document);

const panels = {
  menu: document.getElementById('menu-panel'),
  codex: document.getElementById('codex-panel'),
  showroom: document.getElementById('showroom-panel'),
  editor: document.getElementById('editor-panel'),
  play: document.getElementById('play-panel'),
  help: document.getElementById('help-panel'),
};
const tabs = {
  menu: document.getElementById('tab-menu'),
  codex: document.getElementById('tab-codex'),
  showroom: document.getElementById('tab-showroom'),
  editor: document.getElementById('tab-editor'),
  play: document.getElementById('tab-play'),
  help: document.getElementById('tab-help'),
};

let game = null;
let editor = null;
let selectedDiff = 'normal';

function show(which, { fromHistory = false } = {}) {
  if (which === 'play' && !game) return; // game inits after data loads
  hideTooltip();
  hideVictory();
  hideDefeat();
  closePause(false);
  playClick();
  const entering = which !== currentView;
  currentView = which;
  if (!fromHistory) writeHash(which);
  for (const [k, el] of Object.entries(panels)) el.classList.toggle('hidden', k !== which);
  for (const [k, el] of Object.entries(tabs)) el.classList.toggle('active', k === which);
  if (which === 'menu') {
    renderCampaign();
    startMenuBackdrop();
  } else {
    if (menuBackdrop) menuBackdrop.stop();
    document.getElementById('menu3d-container').classList.add('hidden');
  }
  if (which === 'play' && game) {
    game.refreshMapList();
    // Play is always 3D: (re)enter the scene whenever arriving without one.
    if (entering && !mode3d) enable3D();
  }
  if (which === 'editor') editor.start();
  else if (editor) editor.stop();
  setCodexVisible(which === 'codex');
  setShowroomVisible(which === 'showroom');
  if (which !== 'play' && mode3d) exit3d(); // never strand the fullscreen overlay
  // The 2D canvas draws only as an emergency fallback inside Play —
  // never in the background, never underneath 3D.
  if (game) game.setRender2d(which === 'play' && !mode3d && !loading3d);
}

tabs.menu.onclick = () => confirmLeaveRun(() => show('menu'));
document.getElementById('brand-home').onclick = () => confirmLeaveRun(() => show('menu'));

// --- URL routing: each view has a #hash, so Back/Forward and deep links
// work. Leaving an in-progress run via Back still asks first. ---
const VIEW_HASH = { menu: '', play: 'play', editor: 'editor', codex: 'enemies', showroom: 'towers', help: 'help' };
function viewFromHash() {
  const h = location.hash.replace('#', '');
  return Object.keys(VIEW_HASH).find((k) => VIEW_HASH[k] === h) || 'menu';
}
function hashUrl(view) {
  const h = VIEW_HASH[view];
  return h ? `#${h}` : location.pathname + location.search;
}
function writeHash(view) {
  if (location.hash.replace('#', '') === VIEW_HASH[view]) return;
  history.pushState({ view }, '', hashUrl(view));
}
function restoreHash() {
  history.replaceState({ view: currentView }, '', hashUrl(currentView));
}
window.addEventListener('popstate', () => {
  const v = viewFromHash();
  if (v === currentView) return;
  if (v === 'play' && !game) { restoreHash(); return; }
  confirmLeaveRun(() => show(v, { fromHistory: true }), restoreHash);
});
tabs.codex.onclick = () => confirmLeaveRun(() => show('codex'));
tabs.showroom.onclick = () => confirmLeaveRun(() => show('showroom'));
tabs.editor.onclick = () => confirmLeaveRun(() => show('editor'));
tabs.play.onclick = () => show('play');
tabs.help.onclick = () => confirmLeaveRun(() => show('help'));

// --- campaign menu: 6 worlds x 20 maps x 3 difficulties ---
// Step 1: world selector cards (no levels). Step 2: the selected world's
// progress and level grid.
let selectedWorldId = null;

function selectedWorld() {
  if (!isLoaded()) return null;
  let w = WORLDS.find(w => w.id === selectedWorldId);
  if (!w || !isWorldUnlocked(w.id)) {
    // default: first unlocked world that still has maps to finish
    w = WORLDS.find(w => isWorldUnlocked(w.id) && countDone(w.id) < MAP_COUNT)
      || [...WORLDS].reverse().find(w => isWorldUnlocked(w.id))
      || WORLDS[0];
    selectedWorldId = w.id;
  }
  return w;
}

// Per-world accent color + tile art for the world tabs.
const WORLD_STYLE = [
  { color: '#4ade80', tile: 'buildable' },
  { color: '#fbbf24', tile: 'path' },
  { color: '#f87171', tile: 'rock' },
  { color: '#2dd4bf', tile: 'mud' },
  { color: '#a78bfa', tile: 'blocked' },
  { color: '#60a5fa', tile: 'water' },
];
const worldStyle = (wi) => WORLD_STYLE[wi % WORLD_STYLE.length];

function starsHTML(rank) {
  let out = '';
  for (let k = 1; k <= 3; k++) out += `<span class="st${k <= rank ? ' on' : ''}">${ui('star', { size: 12 })}</span>`;
  return out;
}

// First unlocked, unfinished map across the campaign (the "Continue" target).
function nextToPlay() {
  if (!isLoaded()) return null;
  for (const w of WORLDS) {
    if (!isWorldUnlocked(w.id)) break;
    for (let i = 0; i < MAP_COUNT; i++) {
      if (isMapUnlocked(w.id, i) && bestRank(w.id, i) === 0) return { worldId: w.id, mapIdx: i, fresh: true };
    }
  }
  const last = [...WORLDS].reverse().find((w) => isWorldUnlocked(w.id)) || WORLDS[0];
  return { worldId: last.id, mapIdx: MAP_COUNT - 1, fresh: false };
}

function renderHero() {
  const label = document.getElementById('continue-label');
  const sub = document.getElementById('continue-sub');
  const prog = document.getElementById('hero-progress');
  if (!isLoaded()) {
    label.textContent = 'Loading campaign…';
    sub.textContent = '';
    prog.innerHTML = '';
    return;
  }
  const nx = nextToPlay();
  const w = WORLDS.find((x) => x.id === nx.worldId);
  const wi = WORLDS.indexOf(w);
  const anyDone = WORLDS.some((x) => countDone(x.id) > 0);
  label.textContent = !anyDone ? 'Start campaign' : nx.fresh ? 'Continue' : 'Replay finale';
  sub.textContent = `World ${wi + 1} · ${w.name} ${nx.mapIdx + 1} — ${archName(nx.mapIdx, nx.worldId)} · ${DIFFS[selectedDiff].label}`;
  let done = 0, stars = 0;
  for (const x of WORLDS) { done += countDone(x.id); stars += totalStars(x.id); }
  const total = WORLDS.length * MAP_COUNT;
  prog.innerHTML = `
    <div class="hp-row"><span><b>${done}</b>/${total} maps</span><span class="hp-stars">${ui('star', { size: 13 })} <b>${stars}</b>/${total * 3}</span></div>
    <div class="hp-bar"><i style="width:${(done / total) * 100}%"></i></div>`;
}

function renderCampaign() {
  renderDiffPills();
  renderHero();
  const wrap = document.getElementById('world-sections');
  if (!isLoaded()) {
    wrap.innerHTML = '<div class="status">Loading campaign maps…</div>';
    return;
  }
  wrap.innerHTML = '';
  const cur = selectedWorld();

  // --- world tabs ---
  const sel = document.createElement('div');
  sel.className = 'world-selector';
  sel.setAttribute('role', 'tablist');
  WORLDS.forEach((w, wi) => {
    const unlocked = isWorldUnlocked(w.id);
    const doneCount = countDone(w.id);
    const stars = totalStars(w.id);
    const pct = Math.round((doneCount / MAP_COUNT) * 100);
    const st = worldStyle(wi);
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(w.id === cur.id));
    b.className = 'world-card' + (w.id === cur.id ? ' selected' : '') + (unlocked ? '' : ' locked') + (doneCount === MAP_COUNT ? ' complete' : '');
    b.style.setProperty('--wc', st.color);
    b.disabled = !unlocked;
    b.title = unlocked ? `${w.desc} — ${doneCount}/${MAP_COUNT} maps` : `Finish ${WORLDS[wi - 1].name} ${MAP_COUNT} to unlock`;
    b.innerHTML = `
      <span class="wc-art">${tileIconSVG(st.tile, { size: 40 })}${unlocked ? '' : `<span class="wc-lock">${ui('lock', { size: 16 })}</span>`}</span>
      <span class="wc-body">
        <span class="world-num">World ${wi + 1}</span>
        <b>${w.name}</b>
        <span class="world-prog">${doneCount}/${MAP_COUNT} <span class="stars">${ui('star', { size: 11 })}${stars}</span></span>
        <span class="wbar"><i style="width:${pct}%"></i></span>
      </span>`;
    b.onclick = () => { selectedWorldId = w.id; playClick(); renderCampaign(); };
    sel.appendChild(b);
  });
  wrap.appendChild(sel);

  // --- selected world: header + level tiles ---
  const w = cur;
  const wi = WORLDS.findIndex((x) => x.id === w.id);
  const doneCount = countDone(w.id);
  const stars = totalStars(w.id);
  const st = worldStyle(wi);
  const nx = nextToPlay();
  const sec = document.createElement('div');
  sec.className = 'world-section';
  sec.style.setProperty('--wc', st.color);
  sec.innerHTML = `
    <div class="world-head">
      <div>
        <span class="world-num">World ${wi + 1}</span>
        <b>${w.name}</b>
        <small>${w.desc}</small>
      </div>
      <div class="world-prog">${doneCount}/${MAP_COUNT} maps · <span class="stars">${ui('star', { size: 12 })} ${stars}/${MAP_COUNT * 3}</span></div>
    </div>`;
  const grid = document.createElement('div');
  grid.className = 'map-grid';
  for (let i = 0; i < MAP_COUNT; i++) {
    grid.appendChild(mapCard(w, wi, i, nx && nx.fresh && nx.worldId === w.id && nx.mapIdx === i));
  }
  sec.appendChild(grid);
  const legend = document.createElement('p');
  legend.className = 'hint map-legend';
  legend.innerHTML = `Stars = best difficulty cleared (Easy ★ · Normal ★★ · Hard ★★★). Showing <b>${DIFFS[selectedDiff].label}</b> rules.`;
  sec.appendChild(legend);
  wrap.appendChild(sec);
}
function countDone(worldId) {
  const p = loadProgress().done;
  let n = 0;
  for (let i = 0; i < MAP_COUNT; i++) if ((p[`${worldId}:${i}`] || 0) > 0) n++;
  return n;
}

function totalStars(worldId) {
  const p = loadProgress().done;
  let n = 0;
  for (let i = 0; i < MAP_COUNT; i++) n += p[`${worldId}:${i}`] || 0;
  return n; // max 60 per world
}

function renderDiffPills() {
  const row = document.getElementById('diff-pills');
  row.innerHTML = '';
  for (const id of DIFF_IDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(selectedDiff === id));
    b.textContent = DIFFS[id].label;
    b.className = 'diff-pill' + (selectedDiff === id ? ' active' : '');
    b.dataset.diff = id;
    b.title = id === 'easy' ? 'More gold & lives, weaker enemies'
      : id === 'hard' ? 'Less gold & lives, stronger enemies' : 'Standard rules';
    b.onclick = () => { selectedDiff = id; playClick(); renderCampaign(); };
    row.appendChild(b);
  }
}

function mapCard(w, wi, i, isNext) {
  const open = isWorldUnlocked(w.id) && isMapUnlocked(w.id, i);
  const rank = bestRank(w.id, i);
  const cfg = mapConfig(w.id, i, selectedDiff);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'level-tile' + (open ? '' : ' locked') + (rank > 0 ? ' done' : '') + (isNext ? ' next' : '');
  b.disabled = !open;
  b.title = open
    ? `Map ${i + 1} · ${archName(i, w.id)} — ${cfg.maxWave} waves · ${cfg.gold}g · ${cfg.lives} lives (${DIFFS[selectedDiff].label})`
    : 'Finish the previous map to unlock';
  b.innerHTML = `
    ${isNext ? '<span class="lt-badge">Next</span>' : ''}
    <span class="lt-num">${open ? i + 1 : ui('lock', { size: 18 })}</span>
    <span class="lt-name">${open ? archName(i, w.id) : `Map ${i + 1}`}</span>
    <span class="lt-meta">${open ? `${cfg.maxWave} waves` : '&nbsp;'}</span>
    <span class="lt-stars">${starsHTML(rank)}</span>`;
  b.onclick = () => startMap(w.id, i);
  return b;
}

function renderExplore() {
  const grid = document.getElementById('explore-grid');
  const items = [
    { view: 'codex', title: 'Enemy Codex', sub: '10 foes, their stats and tricks',
      art: enemyIconSVG({ id: 'grunt', shape: 'brute', color: '#4ade80' }, { size: 56, animated: true }) },
    { view: 'showroom', title: 'Tower Showroom', sub: '10 towers and every ability',
      art: towerIconSVG('tesla', '#fde047', { size: 56, animated: true }) },
    { view: 'editor', title: 'Map Editor', sub: 'Paint roads, set waves, share JSON',
      art: tileIconSVG('forest', { size: 56 }) },
    { view: 'help', title: 'How to Play', sub: 'Rules, tiles and hotkeys',
      art: `<span class="ex-help">${ui('help', { size: 34 })}</span>` },
  ];
  grid.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'explore-card';
    b.innerHTML = `<span class="ex-art">${it.art}</span><span class="ex-body"><b>${it.title}</b><small>${it.sub}</small></span>${ui('chevron', { size: 18, cls: 'ex-go' })}`;
    b.onclick = () => show(it.view);
    grid.appendChild(b);
  }
}
renderExplore();

function setCampaignBar(levelId) {
  const bar = document.getElementById('campaign-bar');
  const name = document.getElementById('campaign-name');
  const meta = document.getElementById('campaign-meta');
  const nextBtn = document.getElementById('btn-next-level');
  const sandboxBlock = document.getElementById('sandbox-map-block');
  if (!levelId) {
    // sandbox / quick play: custom map picker visible, campaign bar hidden
    bar.classList.add('hidden');
    sandboxBlock.classList.remove('hidden');
    return;
  }
  // campaign: level info visible, custom map picker hidden
  sandboxBlock.classList.add('hidden');
  const { worldId, mapIdx, diffId } = parseLevelId(levelId);
  const wi = WORLDS.findIndex(w => w.id === worldId);
  const d = DIFFS[diffId] || DIFFS.normal;
  const cfg = mapConfig(worldId, mapIdx, diffId);
  name.textContent = `🎮 ${WORLDS[wi].name} ${mapIdx + 1} · ${archName(mapIdx, worldId)}`;
  meta.textContent = `${d.label} · 🌊 ${cfg.maxWave} waves · 💰 ${cfg.gold}g start · ❤️ ${cfg.lives}`;
  // next: same world/difficulty, or first map of next world
  const next = nextLevel(worldId, mapIdx, diffId);
  if (next) {
    const nw = WORLDS.find(w => w.id === next.worldId);
    const open = isWorldUnlocked(next.worldId) && isMapUnlocked(next.worldId, next.mapIdx);
    nextBtn.style.display = '';
    nextBtn.disabled = !open;
    nextBtn.textContent = open ? `➡️ ${nw.name} ${next.mapIdx + 1}` : '🔒 Next';
    nextBtn.title = open
      ? `Next: ${nw.name} ${next.mapIdx + 1} · ${archName(next.mapIdx, next.worldId)} (${(DIFFS[next.diffId] || DIFFS.normal).label})`
      : 'Finish this map to unlock the next one';
    nextBtn.onclick = () => startMap(next.worldId, next.mapIdx, next.diffId);
  } else {
    nextBtn.style.display = 'none';
  }
  bar.classList.remove('hidden');
}

// Next level in the campaign flow (same difficulty), or null at the very end.
function nextLevel(worldId, mapIdx, diffId) {
  const wi = WORLDS.findIndex(w => w.id === worldId);
  if (wi < 0) return null;
  if (mapIdx + 1 < MAP_COUNT) return { worldId, mapIdx: mapIdx + 1, diffId };
  if (wi + 1 < WORLDS.length) return { worldId: WORLDS[wi + 1].id, mapIdx: 0, diffId };
  return null;
}

function startMap(worldId, mapIdx, diffId = selectedDiff) {
  // hard guard: locked maps can never load, whatever calls this
  if (!isWorldUnlocked(worldId) || !isMapUnlocked(worldId, mapIdx)) {
    renderCampaign();
    show('menu');
    return;
  }
  hideVictory();
  const def = levelDef(worldId, mapIdx, diffId);
  if (game.loadLevel(def)) {
    setCampaignBar(def.id);
    show('play');
  }
}

document.getElementById('btn-menu-campaign').onclick = () => {
  playClick();
  document.getElementById('campaign-anchor').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('btn-menu-continue').onclick = () => {
  const nx = nextToPlay();
  if (nx && game) startMap(nx.worldId, nx.mapIdx);
};
document.getElementById('btn-menu-editor').onclick = () => show('editor');
document.getElementById('btn-menu-quick').onclick = () => {
  setCampaignBar(null);
  show('play');
};
document.getElementById('btn-back-levels').onclick = () => confirmLeaveRun(() => show('menu'));

// --- leave-run guard: confirm before abandoning an in-progress run ---
// In progress = at least one wave started, run neither won nor lost.
// dismissedKey stops repeat asks for a run the user already chose to leave.
let pendingLeave = null;
let pendingCancel = null;
let dismissedKey = null;

function runKey() {
  const s = game.getState();
  return `${s.config.levelId || 'sandbox'}:${s.map ? s.map.name : '?'}:${s.wave}`;
}

function runInProgress() {
  if (!game) return false;
  const s = game.getState();
  return !!(s.map && s.wave > 0 && !s.won && !s.gameOver);
}

function confirmLeaveRun(action, onCancel = null) {
  if (!runInProgress() || dismissedKey === runKey()) {
    action();
    return;
  }
  const s = game.getState();
  document.getElementById('leave-wave').textContent = `${s.wave}/${s.config.maxWave}`;
  pendingLeave = action;
  pendingCancel = onCancel;
  document.getElementById('leave-modal').classList.remove('hidden');
}

function closeLeaveModal(cancelled = true) {
  const cancel = pendingCancel;
  pendingLeave = null;
  pendingCancel = null;
  document.getElementById('leave-modal').classList.add('hidden');
  if (cancelled && cancel) cancel();
}

document.getElementById('leave-stay').onclick = () => { playClick(); closeLeaveModal(); };
document.getElementById('leave-go').onclick = () => {
  const a = pendingLeave;
  dismissedKey = game ? runKey() : null;
  closeLeaveModal(false);
  playClick();
  if (a) a();
};

// --- victory modal: congratulations + Next Level / Back to Levels ---
function hideVictory() {
  document.getElementById('victory-modal')?.classList.add('hidden');
}

function showVictory(levelId) {
  const { worldId, mapIdx, diffId } = parseLevelId(levelId);
  const wi = WORLDS.findIndex(w => w.id === worldId);
  const d = DIFFS[diffId] || DIFFS.normal;
  const cfg = mapConfig(worldId, mapIdx, diffId);
  const s = game ? game.getState() : null;
  document.getElementById('victory-title').textContent =
    `🎮 ${WORLDS[wi]?.name ?? worldId} ${mapIdx + 1} · ${archName(mapIdx, worldId)} (${d.label})`;
  document.getElementById('victory-sub').textContent =
    `You survived all ${cfg.maxWave} waves with ❤️ ${s ? s.lives : cfg.lives} left. Progress saved!`;
  document.getElementById('victory-stars').textContent = rankStars(bestRank(worldId, mapIdx));
  const nextBtn = document.getElementById('victory-next');
  const next = nextLevel(worldId, mapIdx, diffId);
  if (next) {
    const nw = WORLDS.find(w => w.id === next.worldId);
    const open = isWorldUnlocked(next.worldId) && isMapUnlocked(next.worldId, next.mapIdx);
    nextBtn.style.display = '';
    nextBtn.disabled = !open;
    nextBtn.textContent = open ? `➡️ Next: ${nw.name} ${next.mapIdx + 1}` : '🔒 Next locked';
    nextBtn.title = open
      ? `${nw.name} ${next.mapIdx + 1} · ${archName(next.mapIdx, next.worldId)} (${(DIFFS[next.diffId] || DIFFS.normal).label})`
      : 'Finish this map to unlock the next one';
    nextBtn.onclick = () => { playClick(); startMap(next.worldId, next.mapIdx, next.diffId); };
  } else {
    // very last campaign map: the whole campaign is done
    nextBtn.style.display = 'none';
    document.getElementById('victory-sub').textContent += ' 🏁 Entire campaign complete!';
  }
  document.getElementById('victory-modal').classList.remove('hidden');
}

document.getElementById('victory-menu').onclick = () => {
  playClick();
  hideVictory();
  show('menu');
};

// --- defeat modal: base destroyed -> Retry the run / back to Main menu ---
function hideDefeat() {
  document.getElementById('defeat-modal')?.classList.add('hidden');
}

function showDefeat() {
  if (!game) return;
  const s = game.getState();
  const cfg = game.getConfig();
  const where = cfg.levelName || (s.map ? s.map.name : 'Quick Play');
  document.getElementById('defeat-title').textContent =
    `💀 ${where} — fell on wave ${s.wave}/${cfg.maxWave}.`;
  document.getElementById('defeat-sub').textContent =
    'The base has fallen. Rebuild your defenses and try again.';
  document.getElementById('defeat-modal').classList.remove('hidden');
  document.getElementById('defeat-retry').focus();
}

function retryFromDefeat() {
  if (!isOpen('defeat-modal')) return;
  playClick();
  hideDefeat();
  game.restartRun();
}

document.getElementById('defeat-retry').onclick = retryFromDefeat;
document.getElementById('defeat-menu').onclick = () => {
  playClick();
  hideDefeat();
  show('menu');
};
const isOpen = (id) => !document.getElementById(id).classList.contains('hidden');
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (isOpen('leave-modal')) closeLeaveModal();
  else if (isOpen('settings-modal')) closeSettings();
  else if (isOpen('pause-modal')) closePause(true);
  else if (isOpen('victory-modal')) hideVictory(); // stay on the finished board; sidebar Next still works
  else if (isOpen('defeat-modal')) retryFromDefeat(); // never strand the player on a dead board
  else if (currentView === 'play' && mode3d && game) {
    // Esc with nothing selected opens the pause menu (game.js handles deselect)
    const s = game.getState();
    if (!s.selectedTower && !s.selectedType && !game.getInspectedEnemy()) openPause();
  }
});

// --- in-game pause menu (HUD Menu button / Esc) ---
let pauseResume = false;
function openPause() {
  if (!game) return;
  const s = game.getState();
  const cfg = game.getConfig();
  pauseResume = s.running && !s.gameOver;
  if (s.running) game.togglePause();
  document.getElementById('pause-title').textContent = cfg.levelName || (s.map ? s.map.name : 'Quick Play');
  document.getElementById('pause-stats').innerHTML =
    `<span>${ui('coin', { size: 16 })}<b>${Math.floor(s.gold)}</b></span>`
    + `<span>${ui('heart', { size: 16 })}<b>${s.lives}</b></span>`
    + `<span>${ui('wave', { size: 16 })}<b>${s.wave}/${cfg.maxWave}</b></span>`;
  document.getElementById('pause-levels').style.display = cfg.levelId ? '' : 'none';
  document.getElementById('pause-modal').classList.remove('hidden');
  playClick();
  document.getElementById('pause-resume').focus();
}
function closePause(resume) {
  const m = document.getElementById('pause-modal');
  if (!m || m.classList.contains('hidden')) return;
  m.classList.add('hidden');
  if (resume && pauseResume && game && !game.getState().running) game.togglePause();
  pauseResume = false;
}
function leaveFromPause(action) {
  const wasPausedByMenu = pauseResume;
  closePause(false);
  confirmLeaveRun(() => { if (mode3d) exit3d(); action(); }, () => {
    if (wasPausedByMenu && game && !game.getState().running) game.togglePause();
  });
}
document.getElementById('pause-resume').onclick = () => { playClick(); closePause(true); };
document.getElementById('pause-restart').onclick = () => { closePause(false); game.restartRun(); };
document.getElementById('pause-sound').onclick = () => openSettings();
document.getElementById('pause-levels').onclick = () => leaveFromPause(() => {
  show('menu');
  requestAnimationFrame(() => document.getElementById('campaign-anchor').scrollIntoView({ block: 'start' }));
});
document.getElementById('pause-home').onclick = () => leaveFromPause(() => show('menu'));
document.getElementById('pause-modal').addEventListener('click', (e) => {
  if (e.target.id === 'pause-modal') closePause(true); // click the backdrop to resume
});

// --- sound settings: single global control in the header + HUD mute ---
// (the old Play-sidebar duplicates were removed to keep one source of truth)
function syncSoundUI(s) {
  const off = s.muted || !s.enabled;
  const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
  set('set-enabled', (el) => { el.checked = s.enabled; });
  set('set-volume', (el) => { el.value = Math.round(s.volume * 100); });
  set('set-volume-val', (el) => { el.textContent = `${Math.round(s.volume * 100)}%`; });
  set('set-mute', (el) => { el.textContent = s.muted ? '🔊 Unmute' : '🔇 Mute'; });
  set('btn-sound-open', (el) => {
    el.innerHTML = ui(off ? 'mute' : 'volume');
    el.classList.toggle('off', off);
  });
}

function openSettings() {
  playClick();
  syncSoundUI(getSoundSettings());
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

document.getElementById('btn-sound-open').onclick = openSettings;
document.getElementById('set-close').onclick = () => { playClick(); closeSettings(); };
document.getElementById('set-enabled').onchange = (e) => { setSoundEnabled(e.target.checked); playClick(); };
document.getElementById('set-volume').oninput = (e) => setSoundVolume(e.target.value / 100);
document.getElementById('set-mute').onclick = () => {
  const s = getSoundSettings();
  setSoundMuted(!s.muted);
  playClick();
};
onSoundChange(syncSoundUI);
syncSoundUI(getSoundSettings());

editor = initEditor({
  onPlayMap: (map) => {
    if (!game) return;
    setCampaignBar(null);
    game.loadMap(map);
    show('play');
  },
});
// Deferred: shop/waves need TOWERS/ENEMY_STATS from data files.
function initGameOnce() {
  if (game) return;
  game = initGame({
    onLevelEnd: (levelId) => {
      const { worldId, mapIdx, diffId } = parseLevelId(levelId);
      completeMap(worldId, mapIdx, diffId);
      setCampaignBar(levelId);
      showVictory(levelId);
    },
    onGameOver: () => showDefeat(),
    // sidebar Load/Generate replace the current run: confirm first
    confirmReplaceRun: (action) => confirmLeaveRun(action),
  });
}

// --- Play view is 3D-only (Three.js vendored locally, works offline) ---
// The 2D canvas remains purely as an emergency fallback if the 3D scene
// ever fails to start; there is no UI option to play in 2D.
let view3d = null;
let hud = null;
let mode3d = false;
let loading3d = false;
let currentView = 'menu';
const canvas2d = document.getElementById('game-canvas');
const container3d = document.getElementById('view3d-container');
const loading3dEl = document.getElementById('view3d-loading');

function set3dLoading(v) {
  loading3dEl.classList.toggle('hidden', !v);
}

// Emergency fallback only (no UI leads here): park Play in the 2D canvas.
function fallback2d(msg) {
  set3dLoading(false);
  container3d.classList.add('hidden');
  canvas2d.style.display = 'block';
  if (game) game.setRender2d(true);
  if (msg) document.getElementById('play-status').textContent = msg;
}

async function enter3d() {
  // unhide first so the renderer measures the real container size
  container3d.classList.remove('hidden');
  canvas2d.style.display = 'none';
  try {
    await view3d.start();
  } catch (err) {
    container3d.classList.add('hidden');
    canvas2d.style.display = 'block';
    throw err;
  }
  set3dLoading(false);
  mode3d = true;
  document.body.classList.add('immersive');
  game.setRender2d(false);
  hud.show();
}

// Called when leaving Play for another view: stop the 3D loop and drop the
// fullscreen overlay. The final render gating in show() decides drawing.
function exit3d() {
  mode3d = false;
  if (view3d) view3d.stop();
  if (hud) hud.hide();
  document.body.classList.remove('immersive');
  set3dLoading(false);
  container3d.classList.add('hidden');
}

async function enable3D() {
  if (mode3d || loading3d || !game) return;
  loading3d = true;
  // Hide 2D synchronously — before any await — so not a single 2D frame
  // flashes while the 3D scene boots.
  game.setRender2d(false);
  canvas2d.style.display = 'none';
  container3d.classList.remove('hidden');
  // Fast path: the scene was pre-warmed at boot, so Play drops straight
  // into the live game with no loading screen at all.
  if (!viewReady) {
    set3dLoading(true);
    // Let the loader actually paint before the heavy imports below block the
    // main thread (three.js parse); otherwise the screen sits dead dark.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  try {
    await ensureViewBuilt();
    if (currentView !== 'play') {
      // Player navigated away mid-load: park everything, no overlay.
      exit3d();
      return;
    }
    await enter3d();
  } catch (err) {
    viewBuild = null; viewReady = false; // allow a retry on next entry
    fallback2d('⚠️ 3D failed to start, using fallback view: ' + err.message);
  } finally {
    loading3d = false;
  }
}

// Shared builder for the play 3D scene (view + HUD + warmup render), used
// both by the boot-time preloader and by Play entry — never built twice.
let viewBuild = null;
let viewReady = false;

function ensureViewBuilt() {
  if (!viewBuild) viewBuild = buildPlayView();
  return viewBuild;
}

async function buildPlayView() {
  const mod = await import('./view3d.js');
  if (!view3d) view3d = mod.createView3D(container3d, game);
  if (!hud) {
    const { createHud3D } = await import('./hud3d.js');
    hud = createHud3D(container3d, game, {
      onRecenter: () => { if (view3d) view3d.resetView(); },
      onMenu: () => openPause(),
      confirmReplace: (action) => confirmLeaveRun(action),
    });
  }
  await view3d.prepare(); // renderer + first pixels while still hidden
  viewReady = true;
}

// C recenters the 3D camera (game.js owns the other play-view keys).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'c' && e.key !== 'C') return;
  const tag = (document.activeElement?.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (mode3d && view3d) view3d.resetView();
});

// --- animated 3D menu backdrop (decorative diorama, starts with the menu) ---
let menuBackdrop = null;
let menuBackdropStarting = false;
let menuBackdropFailed = false;
async function startMenuBackdrop() {
  if (menuBackdropStarting || menuBackdropFailed) return;
  if (menuBackdrop) {
    document.getElementById('menu3d-container').classList.remove('hidden');
    await menuBackdrop.start().catch(() => { menuBackdropFailed = true; });
    return;
  }
  menuBackdropStarting = true;
  try {
    menuBackdrop = createMenuBackdrop(document.getElementById('menu3d-container'));
    document.getElementById('menu3d-container').classList.remove('hidden');
    await menuBackdrop.start();
  } catch {
    menuBackdropFailed = true; // offline CDN: menu works fine in 2D
    document.getElementById('menu3d-container').classList.add('hidden');
  } finally {
    menuBackdropStarting = false;
  }
}

// Async boot: menu shows loading placeholders; game inits once towers,
// enemies and campaign maps have loaded from data/.
{
  // boot into the view named by the URL (Play needs data: start at Home)
  const v = viewFromHash();
  show(v === 'play' ? 'menu' : v, { fromHistory: true });
  restoreHash();
}

// --- PWA: register the service worker for offline play (Three.js is
// vendored locally, so the full 3D game works offline once visited). ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // offline-first is a bonus: the game runs fine without it
    });
  });
}

Promise.all([loadContent(), loadCampaign()])
  .then(() => {
    initGameOnce();
    initCodex();
    initShowroom();
    renderCampaign();
    // Enemy data arrived after boot: refresh the editor's wave composer so
    // the type dropdowns show real names instead of raw ids.
    editor.refreshWaves?.();
    // Pre-warm the play 3D scene once the menu has settled: entering Play
    // later drops straight into the live game with no loading screen.
    // Delayed so boot stays snappy; skipped if Play already started it.
    setTimeout(() => {
      if (!viewBuild && !mode3d) ensureViewBuilt().catch(() => { viewBuild = null; });
    }, 1200);
  })
  .catch((err) => {
    document.getElementById('world-sections').innerHTML =
      `<div class="status err">⚠️ ${err.message}</div>`;
  });
