// Play mode: towers, enemies, waves, game loop.
// Tower/enemy stats come from external files (data/towers.json,
// data/enemies.json) via js/content.js — initGame requires loadContent().
import { T, TILE_SIZE, findPath, pathToWaypoints, validateMap, getSettings, waveHpScale, defaultWaveGroups, MUD_FACTOR } from './model.js';
import { loadAllMaps } from './storage.js';
import { drawTower, drawEnemy } from './graphics.js';
import { enemyIconSVG } from './icons.js';
import { towerIconSVG } from './towersvg.js';
import { generateRandomMap } from './generator.js';
import { TOWERS, ENEMY_STATS, sortedTowers, hotkeyFor } from './content.js';
import { attachTooltip, showTooltip, moveTooltip, hideTooltip, towerTooltipHTML, towerInstanceHTML, enemyTooltipHTML } from './tooltip.js';
import {
  playShot, playKill, playBoom, playPlace, playSelect, playUpgrade, playSell,
  playError, playWaveStart, playWaveClear, playLeak, playVictory, playDefeat,
  getSoundSettings, setSoundMuted,
} from './audio.js';

// Wave n (1-indexed) -> {groups: [{type, count, gap}], hpScale}.
// Custom editor lists override the composition per wave; the procedural HP
// scale always applies on top. Unknown enemy ids are skipped at spawn time.
function buildWave(n, customWaves) {
  const scale = waveHpScale(n);
  const custom = Array.isArray(customWaves) ? customWaves[n - 1] : null;
  if (Array.isArray(custom) && custom.length) {
    const groups = [];
    for (const g of custom) {
      if (!g || typeof g.type !== 'string' || !g.type) continue;
      const count = Math.max(1, Math.min(500, Math.round(+g.count) || 0));
      if (!count) continue;
      // optional per-group HP multiplier (campaign waves ramp toughness)
      const hp = Math.min(20, Math.max(0.1, +g.hp || 1));
      groups.push({ type: g.type, count, gap: Math.min(5, Math.max(0.05, +g.gap || 0.6)), hp });
    }
    if (groups.length) return { groups, hpScale: scale };
  }
  return { groups: defaultWaveGroups(n), hpScale: scale };
}

const TILE_COLORS = {
  [T.BUILDABLE]: '#16a34a',
  [T.PATH]: '#92600a',
  [T.BLOCKED]: '#475569',
  [T.SPAWN]: '#ef4444',
  [T.BASE]: '#3b82f6',
  [T.WATER]: '#2563eb',
  [T.FOREST]: '#166534',
  [T.ROCK]: '#8d6e63',
  [T.MUD]: '#6b4a2b',
};

export function initGame(opts = {}) {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const onLevelEnd = opts.onLevelEnd || null;
  const onGameOver = opts.onGameOver || null;
  // Runs that replace the current one (Load/Generate) confirm first via main.
  const confirmReplaceRun = opts.confirmReplaceRun || ((action) => action());

  const SANDBOX = { gold: 220, lives: 20, maxWave: 20, hpScale: 1, waves: null, levelId: null, levelName: null };

  const state = {
    map: null, waypoints: [], path: null,
    towers: [], enemies: [], beams: [], particles: [], projectiles: [],
    gold: 220, lives: 20, wave: 0,
    config: { ...SANDBOX },
    spawning: [], spawnTimer: 0, waveActive: false,
    running: true, speed: 1, selectedType: sortedTowers()[0].id,
    selectedTower: null, inspectedEnemy: null, gameOver: false, won: false, levelEndFired: false,
    time: 0, hover: null,
  };

  const els = {
    select: document.getElementById('play-map-select'),
    gold: document.getElementById('st-gold'),
    lives: document.getElementById('st-lives'),
    wave: document.getElementById('st-wave'),
    shop: document.getElementById('tower-shop'),
    info: document.getElementById('sel-info'),
    status: document.getElementById('play-status'),
    btnWave: document.getElementById('btn-start-wave'),
  };

  // --- shop UI ---
  const cardEls = {};
  function renderShop() {
    els.shop.innerHTML = '';
    for (const key of Object.keys(cardEls)) delete cardEls[key];
    // Shop order is weak -> strong (same as showroom, HUD and hotkeys).
    sortedTowers().forEach((t, i) => {
      const key = t.id;
      const hotkey = hotkeyFor(i);
      const div = document.createElement('div');
      div.className = 'tower-card' + (state.selectedType === key && !state.selectedTower ? ' selected' : '');
      div.style.display = 'flex';
      div.style.gap = '0.5rem';
      div.style.alignItems = 'center';
      attachTooltip(div, () => towerTooltipHTML(t, hotkey));
      const icon = document.createElement('span');
      icon.className = 'tower-svg';
      icon.innerHTML = towerIconSVG(key, t.color, { size: 40 });
      const txt = document.createElement('div');
      const extra = t.chain ? ` · chain x${t.chain}` : t.splash && !t.projectile ? ` · splash ${t.splash}` : t.projectile ? ` · rockets` : t.slow ? ` · slow` : t.crit ? ` · crit` : t.pierce ? ` · pierce` : t.targets > 1 ? ` · x${t.targets} targets` : t.minRange ? ` · min rng ${t.minRange}` : '';
      txt.innerHTML = `<b>[${hotkey}] ${t.name} — ${t.cost}g</b><small>${t.desc} · dmg ${t.dmg} · rng ${t.range}${extra}</small>`;
      div.appendChild(icon);
      div.appendChild(txt);
      div.onclick = () => selectTowerType(key);
      els.shop.appendChild(div);
      cardEls[key] = div;
    });
    refreshShopAffordability();
  }

  // Grey out towers we can't afford; re-enable as soon as funds allow.
  // Cheap class toggles only — called every HUD update, no DOM rebuild.
  function refreshShopAffordability() {
    for (const [key, t] of Object.entries(TOWERS)) {
      const el = cardEls[key];
      if (!el) continue;
      const afford = state.gold >= t.cost;
      el.classList.toggle('disabled', !afford);
    }
    refreshActionButtons();
  }

  function refreshActionButtons() {
    const btnSell = document.getElementById('btn-sell');
    const btnUp = document.getElementById('btn-upgrade');
    if (btnSell) btnSell.disabled = !state.selectedTower;
    if (btnUp) btnUp.disabled = !state.selectedTower || (state.selectedTower ? state.gold < upgradeCost(state.selectedTower) : true);
    // Keep the pinned card's own upgrade button in sync as gold changes
    // (the card itself only rebuilds on selection/level/kill changes).
    const cardUp = els.info.querySelector('[data-act="upgrade"]');
    if (cardUp && state.selectedTower) cardUp.disabled = state.gold < upgradeCost(state.selectedTower);
  }

  // Inspector model shared by the sidebar and the 3D HUD.
  // Pass an explicit tower for hover cards; defaults to the selection.
  function getInspector(tw = state.selectedTower) {
    if (tw) {
      const def = TOWERS[tw.type];
      const upCost = upgradeCost(tw);
      return {
        hasTower: true,
        text: `${def.name} lv${tw.level} · dmg ${Math.round(tw.dmg)} · rng ${Math.round(tw.range)} · kills ${tw.kills} · upgrade ${upCost}g`,
        upgradeCost: upCost,
        canUpgrade: state.gold >= upCost,
        sellRefund: Math.round(totalSpent(tw) * 0.7),
      };
    }
    const def = state.selectedType ? TOWERS[state.selectedType] : null;
    if (!def) return { hasTower: false, text: 'Select a tower, then click green tiles.', upgradeCost: 0, canUpgrade: false, sellRefund: 0 };
    return { hasTower: false, text: `${def.name}: click a green tile to build (${def.cost}g).`, upgradeCost: 0, canUpgrade: false, sellRefund: 0 };
  }

  // Sidebar details card: a placed tower shows its live SVG portrait, stats
  // and Upgrade/Sell buttons; otherwise the selected buildable
  // tower's catalog card. Same builders as the hover + HUD inspector cards.
  function updateInfo() {
    const tw = state.selectedTower;
    if (tw && TOWERS[tw.type]) {
      const def = TOWERS[tw.type];
      els.info.innerHTML = towerInstanceHTML(tw, getInspector(tw), def);
      els.info.querySelector('[data-act="upgrade"]')?.addEventListener('click', doUpgrade);
      els.info.querySelector('[data-act="sell"]')?.addEventListener('click', doSell);
    } else if (state.selectedType && TOWERS[state.selectedType]) {
      const def = TOWERS[state.selectedType];
      const idx = sortedTowers().findIndex((t) => t.id === state.selectedType);
      els.info.innerHTML = towerTooltipHTML(def, hotkeyFor(Math.max(0, idx)));
    } else {
      els.info.textContent = 'Select a tower, then click green tiles.';
    }
    refreshActionButtons();
  }

  function upgradeCost(tw) {
    return Math.round(TOWERS[tw.type].cost * 0.8 * tw.level);
  }

  // --- map loading ---
  const mapListSubs = [];
  function refreshMapList() {
    const all = loadAllMaps();
    els.select.innerHTML = '';
    for (const name of Object.keys(all)) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      els.select.appendChild(opt);
    }
    for (const fn of mapListSubs) {
      try { fn(Object.keys(all)); } catch { /* HUD sync must never break the game */ }
    }
  }

  function loadMap(map) {
    const res = validateMap(map);
    if (!res.ok) {
      els.status.textContent = 'Invalid map: ' + res.msg;
      return false;
    }
    state.map = map;
    state.path = res.path;
    state.waypoints = pathToWaypoints(res.path);
    canvas.width = map.cols * TILE_SIZE;
    canvas.height = map.rows * TILE_SIZE;
    // Custom maps bring their own rules from the editor (old saves fall
    // back to sandbox defaults via getSettings).
    const s = getSettings(map);
    state.config = {
      ...SANDBOX,
      gold: s.gold, lives: s.lives, maxWave: s.maxWave, hpScale: s.hpScale,
      waves: Array.isArray(s.waves) && s.waves.length ? s.waves : null,
    };
    restart(true);
    refreshMapList();
    if (![...els.select.options].some(o => o.value === map.name)) {
      const opt = document.createElement('option');
      opt.value = map.name; opt.textContent = map.name + ' (unsaved)';
      els.select.appendChild(opt);
    }
    els.select.value = map.name;
    els.status.textContent = `Loaded "${map.name}". Press Start wave!`;
    return true;
  }

  // Campaign level: map + difficulty config bundled in `def`
  // ({ id, name, gold, lives, maxWave, hpScale, build() }).
  function loadLevel(def) {
    const map = def.build();
    const res = validateMap(map);
    if (!res.ok) {
      els.status.textContent = 'Invalid level map: ' + res.msg;
      return false;
    }
    state.map = map;
    state.path = res.path;
    state.waypoints = pathToWaypoints(res.path);
    canvas.width = map.cols * TILE_SIZE;
    canvas.height = map.rows * TILE_SIZE;
    state.config = {
      gold: def.gold, lives: def.lives, maxWave: def.maxWave,
      hpScale: def.hpScale, waves: def.waves || null, levelId: def.id, levelName: def.name,
    };
    restart(true);
    els.status.textContent = `${def.name}: survive ${def.maxWave} waves! Press Start wave!`;
    return true;
  }

  function restart(keepMap = true) {
    void keepMap;
    state.towers = []; state.enemies = []; state.beams = []; state.particles = []; state.projectiles = [];
    state.gold = state.config.gold; state.lives = state.config.lives; state.wave = 0;
    state.spawning = []; state.waveActive = false;
    state.gameOver = false; state.won = false; state.selectedTower = null;
    state.inspectedEnemy = null;
    state.levelEndFired = false;
    state.hover = null;
    state.running = true;    document.getElementById('btn-pause').textContent = '⏸️ Pause (P)';
    els.btnWave.disabled = false;
    renderShop(); updateInfo(); updateHud(); refreshWavePreview();
  }

  // Upcoming-wave preview: enemy lineup before the player presses Start.
  // Data model shared by the sidebar panel and the 3D HUD.
  // kind: 'upcoming' | 'active' | 'done' | 'over'
  // Spawn progress of the wave currently being fought: per-type totals from
  // buildWave(state.wave) vs what's still sitting in the spawn queue.
  // out = already spawned ("out on the road"), queued = yet to come.
  function waveSpawnProgress() {
    const { groups } = buildWave(state.wave, state.config.waves);
    const totalBy = new Map();
    for (const g of groups) {
      if (!ENEMY_STATS[g.type]) continue;
      totalBy.set(g.type, (totalBy.get(g.type) || 0) + g.count);
    }
    const queuedBy = new Map();
    for (const q of state.spawning) queuedBy.set(q.type, (queuedBy.get(q.type) || 0) + 1);
    const counts = [];
    let out = 0, total = 0;
    for (const [type, count] of totalBy) {
      const queued = queuedBy.get(type) || 0;
      const spawned = count - queued;
      counts.push({ type, count, out: spawned, queued });
      out += spawned; total += count;
    }
    return { counts, out, total };
  }

  // Chip visual state for a wave entry: fully spawned ("out"), partially
  // out, or still entirely queued. Entries without progress info (upcoming
  // waves) render neutrally.
  function chipState(c) {
    if (c.queued === undefined) return { cls: '', label: `×${c.count}` };
    if (c.queued <= 0) return { cls: 'is-out', label: `✓${c.count}` };
    if (c.out > 0) return { cls: 'is-partial', label: `${c.out}/${c.count}` };
    return { cls: 'is-queued', label: `×${c.count}` };
  }

  function getWavePreviewData() {
    const isCampaign = !!state.config.levelId;
    const maxW = state.config.maxWave;
    if (state.gameOver) return { kind: 'over' };
    if (!state.waveActive && state.wave >= maxW && isCampaign)
      return { kind: 'done', won: state.won };
    if (state.waveActive) {
      // fighting right now: show THIS wave's lineup with live spawn progress
      const { counts, out, total } = waveSpawnProgress();
      return { kind: 'active', target: state.wave, maxW, endless: !isCampaign, total, out, counts };
    }
    const target = state.wave + 1;
    const { groups } = buildWave(target, state.config.waves);
    const counts = [];
    const seen = new Map();
    for (const g of groups) {
      if (!ENEMY_STATS[g.type]) continue;
      seen.set(g.type, (seen.get(g.type) || 0) + g.count);
    }
    let total = 0;
    for (const [type, count] of seen) {
      counts.push({ type, count });
      total += count;
    }
    return {
      kind: 'upcoming',
      target, maxW, endless: !isCampaign, total, counts,
    };
  }

  function refreshWavePreview() {
    const el = document.getElementById('wave-preview');
    if (!el) return;
    const data = getWavePreviewData();
    el.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'wp-title';
    if (data.kind === 'over') {
      title.textContent = 'No upcoming waves';
      el.appendChild(title);
      return;
    }
    if (data.kind === 'done') {
      title.textContent = data.won ? '🏆 All waves cleared!' : '—';
      el.appendChild(title);
      return;
    }
    if (data.kind === 'active') {
      title.textContent = `⚔️ Wave ${data.target}/${data.maxW}${data.endless ? '+' : ''} · ${data.out}/${data.total} out`;
      el.appendChild(title);
      const legend = document.createElement('div');
      legend.className = 'wp-legend';
      legend.textContent = '✓ already out · dimmed = yet to come';
      el.appendChild(legend);
    } else {
      title.textContent = `Upcoming · Wave ${data.target}/${data.maxW}${data.endless ? '+' : ''} · ${data.total} enemies`;
      el.appendChild(title);
    }
    const row = document.createElement('div');
    row.className = 'wp-row';
    for (const c of data.counts) {
      const def = ENEMY_STATS[c.type];
      if (!def) continue;
      const st = chipState(c);
      const chip = document.createElement('div');
      chip.className = `wp-chip ${st.cls}`.trim();
      chip.title = st.cls === 'is-out' ? 'All out on the road'
        : st.cls === 'is-partial' ? 'Spawning now' : st.cls === 'is-queued' ? 'Yet to come' : '';
      attachTooltip(chip, () => enemyTooltipHTML(def));
      const icon = document.createElement('span');
      icon.className = 'wp-ico';
      icon.innerHTML = enemyIconSVG(def, { size: 30 });
      const label = document.createElement('small');
      label.textContent = st.label;
      chip.appendChild(icon);
      chip.appendChild(label);
      row.appendChild(chip);
    }
    el.appendChild(row);
  }

  function updateHud() {
    els.gold.textContent = Math.floor(state.gold);
    els.lives.textContent = state.lives;
    els.wave.textContent = state.wave;
    document.getElementById('st-maxwave').textContent = state.config.maxWave;
    refreshShopAffordability();
  }

  // --- waves ---
  function startWave() {
    if (state.gameOver || !state.map) return;
    if (state.waveActive) return;
    // campaign runs end at maxWave — no waves beyond it
    if (state.won && state.config.levelId) return;
    state.wave++;
    const { groups, hpScale } = buildWave(state.wave, state.config.waves);
    const scaled = hpScale * state.config.hpScale;
    state.spawning = [];
    for (const g of groups)
      for (let i = 0; i < g.count; i++)
        state.spawning.push({ type: g.type, gap: g.gap, hpScale: scaled * (g.hp || 1) });
    state.spawnTimer = 0;
    state.waveActive = true;
    els.status.textContent = `Wave ${state.wave} incoming! (${state.spawning.length} enemies)`;
    els.btnWave.disabled = true;
    playWaveStart();
    updateHud(); refreshWavePreview();
  }

  function spawnEnemy(type, hpScale) {
    const [wp0] = state.waypoints;
    const e = makeEnemy(type, wp0.x, wp0.y, 1, hpScale);
    if (e) state.enemies.push(e);
  }

  function makeEnemy(type, x, y, wp, hpScale) {
    const s = ENEMY_STATS[type];
    if (!s) return null; // unknown id in data — skip instead of crashing
    return {
      type, shape: s.shape || type, x, y, wp,
      hp: s.hp * hpScale, maxHp: s.hp * hpScale,
      speed: s.speed * (1 + Math.min(0.5, state.wave * 0.01)),
      reward: Math.round(s.reward * (1 + state.wave * 0.03)),
      slowUntil: 0, slowFactor: 1, flashUntil: -1, r: s.r, color: s.color,
      slowImmune: !!s.slowImmune,
      angle: 0, seed: Math.random() * 10, lastHit: null,
    };
  }

  // --- combat ---
  function towerAt(c, r) {
    return state.towers.find(t => t.c === c && t.r === r);
  }

  function tryPlace(c, r) {
    if (!state.map || state.gameOver) return;
    if (state.won && state.config.levelId) return; // finished campaign run: board is locked
    if (c < 0 || r < 0 || c >= state.map.cols || r >= state.map.rows) return;
    const existing = towerAt(c, r);
    if (existing) { state.selectedTower = existing; state.inspectedEnemy = null; renderShop(); updateInfo(); playSelect(); return; }
    if (!state.selectedType || !TOWERS[state.selectedType]) return; // no build selection: map clicks place nothing
    if (state.map.grid[r][c] !== T.BUILDABLE) {
      els.info.textContent = 'Towers only go on green tiles.';
      state.selectedTower = null;
      state.inspectedEnemy = null;
      playError();
      return;
    }
    const def = TOWERS[state.selectedType];
    if (state.gold < def.cost) { els.info.textContent = 'Not enough gold!'; playError(); return; }
    state.gold -= def.cost;
    state.towers.push({
      type: state.selectedType, c, r,
      x: c * TILE_SIZE + 16, y: r * TILE_SIZE + 16,
      dmg: def.dmg, range: def.range, rate: def.rate,
      cool: 0, level: 1, kills: 0, angle: -Math.PI / 2, flashUntil: -1,
    });
    playPlace();
    updateHud(); updateInfo();
  }

  canvas.addEventListener('pointerdown', e => {
    tipKey = null;
    hideTooltip();
    const { c, r } = eventTile(e);
    tryPlace(c, r);
  });
  // double-click a placed tower: upgrade it (single click only selects)
  canvas.addEventListener('dblclick', e => {
    const { c, r } = eventTile(e);
    const tw = towerAt(c, r);
    if (!tw) return;
    state.selectedTower = tw;
    state.inspectedEnemy = null;
    renderShop();
    doUpgrade();
  });
  canvas.addEventListener('pointermove', e => {
    state.hover = eventTile(e);
    updateCanvasTooltip(e);
  });
  canvas.addEventListener('pointerleave', () => {
    state.hover = null;
    tipKey = null;
    hideTooltip();
  });

  // Rich hover cards over the board: placed towers show their live card,
  // enemies show stats + counters, empty tiles show nothing (rings say it).
  let tipKey = null;
  function updateCanvasTooltip(e) {
    if (!state.map || state.gameOver) { tipKey = null; hideTooltip(); return; }
    const hov = state.hover;
    const tw = hov ? towerAt(hov.c, hov.r) : null;
    if (tw) {
      const key = `t:${tw.c},${tw.r}:${tw.level}:${tw.kills}`;
      if (tipKey !== key) {
        tipKey = key;
        showTooltip(towerInstanceHTML(tw, getInspector(tw), TOWERS[tw.type]), e.clientX, e.clientY);
      } else {
        moveTooltip(e.clientX, e.clientY);
      }
      return;
    }
    const foe = enemyAtEvent(e);
    const def = foe ? ENEMY_STATS[foe.type] : null;
    if (foe && def) {
      tipKey = foe; // rebuild each move: live HP bar
      showTooltip(enemyTooltipHTML(def, { hp: foe.hp, maxHp: foe.maxHp }), e.clientX, e.clientY);
      return;
    }
    tipKey = null;
    hideTooltip();
  }

  function enemyAtEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top) * sy;
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const en = state.enemies[i];
      if (en.hp <= 0) continue;
      const dx = en.x - px, dy = en.y - py;
      if (dx * dx + dy * dy <= (en.r + 6) * (en.r + 6)) return en;
    }
    return null;
  }

  function eventTile(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top) * sy;
    const c = Math.floor(px / TILE_SIZE);
    const r = Math.floor(py / TILE_SIZE);
    return { c, r, x: c * TILE_SIZE + TILE_SIZE / 2, y: r * TILE_SIZE + TILE_SIZE / 2 };
  }

  function placementValid(c, r) {
    if (!state.map || state.gameOver) return { ok: false };
    if (!state.selectedType || !TOWERS[state.selectedType]) return { ok: false };
    if (c < 0 || r < 0 || c >= state.map.cols || r >= state.map.rows) return { ok: false };
    if (towerAt(c, r)) return { ok: false };
    if (state.map.grid[r][c] !== T.BUILDABLE) return { ok: false };
    if (state.gold < TOWERS[state.selectedType].cost) return { ok: false };
    return { ok: true };
  }

  function doSell() {
    const tw = state.selectedTower;
    if (!tw) return;
    const refund = Math.round(totalSpent(tw) * 0.7);
    state.gold += refund;
    state.towers = state.towers.filter(t => t !== tw);
    els.info.textContent = `Sold for ${refund}g.`;
    state.selectedTower = null;
    playSell();
    renderShop(); updateHud();
  }

  function doUpgrade() {
    const tw = state.selectedTower;
    if (!tw) return;
    const cost = upgradeCost(tw);
    if (state.gold < cost) { els.info.textContent = 'Not enough gold to upgrade.'; playError(); return; }
    state.gold -= cost;
    tw.level++;
    tw.dmg *= 1.6; tw.range *= 1.08; tw.rate = Math.min(tw.rate * 1.06, 10);
    tw.flashUntil = state.time + 0.4; // level-up glow pulse on both renderers
    playUpgrade();
    updateHud(); updateInfo();
  }

  document.getElementById('btn-sell').onclick = doSell;
  document.getElementById('btn-upgrade').onclick = doUpgrade;

  function totalSpent(tw) {
    let sum = TOWERS[tw.type].cost;
    for (let l = 1; l < tw.level; l++) sum += Math.round(TOWERS[tw.type].cost * 0.8 * l);
    return sum;
  }

  function loadMapByName(name) {
    const all = loadAllMaps();
    const m = all[name];
    if (!m) return false;
    return loadMap(JSON.parse(JSON.stringify(m)));
  }
  document.getElementById('play-load').onclick = () => {
    confirmReplaceRun(() => { loadMapByName(els.select.value); });
  };
  function generateMap() {
    try {
      // sandbox only: campaign bar is hidden here, but guard anyway
      if (state.config.levelId) return false;
      return loadMap(generateRandomMap());
    } catch (err) {
      els.status.textContent = 'Generate failed: ' + err.message;
      return false;
    }
  }
  document.getElementById('btn-generate').onclick = () => { confirmReplaceRun(() => { generateMap(); }); };
  els.btnWave.onclick = startWave;
  function restartRun() {
    restart();
    els.status.textContent = 'Restarted.';
  }
  document.getElementById('btn-restart').onclick = restartRun;
  const btnPause = document.getElementById('btn-pause');
  const btnSpeed = document.getElementById('btn-speed');
  function togglePause() {
    state.running = !state.running;
    btnPause.textContent = state.running ? '⏸️ Pause (P)' : '▶️ Resume (P)';
  }
  function cycleSpeed() {
    state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 4 : state.speed === 4 ? 8 : 1;
    btnSpeed.textContent = `${state.speed}x speed (F)`;
  }
  btnPause.onclick = togglePause;
  btnSpeed.onclick = cycleSpeed;

  // Unified tower-type selection (shop cards, hotkeys, 3D HUD).
  // Returns false when the type can't be afforded (selection unchanged).
  // Clicking the already-selected type (card or hotkey) toggles build
  // selection off so map clicks place nothing.
  function selectTowerType(key) {
    const t = TOWERS[key];
    if (!t) return false;
    if (key === state.selectedType && !state.selectedTower) {
      state.selectedType = null;
      state.inspectedEnemy = null;
      playSelect();
      renderShop(); updateInfo();
      return true;
    }
    if (state.gold < t.cost) {
      els.info.textContent = `Not enough gold for ${t.name} (${t.cost}g).`;
      playError();
      return false;
    }
    state.selectedType = key;
    state.selectedTower = null;
    state.inspectedEnemy = null;
    playSelect();
    renderShop(); updateInfo();
    return true;
  }

  function selectTowerByIndex(i) {
    const keys = sortedTowers().map((t) => t.id);
    if (i >= 0 && i < keys.length) selectTowerType(keys[i]);
  }

  // --- keyboard shortcuts (playing) ---
  // Space/Enter/N start wave · P pause · F speed · R restart · G generate (sandbox)
  // 1-9,0 select tower · U upgrade · X sell · M mute · Esc deselect
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.getElementById('play-panel')?.classList.contains('hidden')) return;
    // pause menu / confirm / victory / defeat / settings dialogs own the keyboard
    if (document.querySelector('.modal:not(.hidden)')) return;
    const k = e.key;
    if (k === ' ' || k === 'Enter') {
      if (k === ' ') e.preventDefault();
      if (!els.btnWave.disabled) startWave();
      return;
    }
    switch (k.toLowerCase()) {
      case 'n': if (!els.btnWave.disabled) startWave(); break;
      case 'p': togglePause(); break;
      case 'f': cycleSpeed(); break;
      case 'm': {
        const s = getSoundSettings();
        setSoundMuted(!s.muted);
        break;
      }
      case 'g':
        if (!state.config.levelId) document.getElementById('btn-generate').click();
        break;
      case 'r': restart(); els.status.textContent = 'Restarted.'; break;
      case 'u': doUpgrade(); break;
      case 'x': case 'backspace': case 'delete': e.preventDefault(); doSell(); break;
      case 'escape':
        if (state.selectedTower) state.selectedTower = null;
        else state.selectedType = null;
        state.inspectedEnemy = null;
        renderShop(); updateInfo();
        break;
      default: {
        const idx = k === '0' ? 9 : parseInt(k, 10) - 1;
        if (idx >= 0 && idx < Object.keys(TOWERS).length) selectTowerByIndex(idx);
      }
    }
  });

  // --- update ---
  function update(dt) {
    state.time += dt;
    if (state.spawning.length) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        const next = state.spawning.shift();
        spawnEnemy(next.type, next.hpScale);
        state.spawnTimer = next.gap;
        refreshWavePreview(); // wave list ticks over: freshly spawned types flip to "out"
      }
    }
    // enemies move (+ facing angle)
    for (const e of state.enemies) {
      const slowed = state.time < e.slowUntil;
      let sp = e.speed * (slowed ? e.slowFactor : 1);
      // muddy road: frost-style slow while standing on mud (slow-immune
      // enemies plow through, same promise as Frost towers make)
      if (!e.slowImmune && state.map) {
        const mc = Math.floor(e.x / TILE_SIZE), mr = Math.floor(e.y / TILE_SIZE);
        if (mr >= 0 && mc >= 0 && mr < state.map.rows && mc < state.map.cols
          && state.map.grid[mr][mc] === T.MUD) sp *= MUD_FACTOR;
      }
      let remaining = sp * dt;
      while (remaining > 0 && e.wp < state.waypoints.length) {
        const wp = state.waypoints[e.wp];
        const dx = wp.x - e.x, dy = wp.y - e.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.001) { e.wp++; continue; }
        e.angle = Math.atan2(dy, dx);
        if (d <= remaining) { e.x = wp.x; e.y = wp.y; e.wp++; remaining -= d; }
        else { e.x += (dx / d) * remaining; e.y += (dy / d) * remaining; remaining = 0; }
      }
    }
    // reached base
    let leaked = false;
    for (const e of state.enemies.filter(e => e.wp >= state.waypoints.length)) {
      state.lives -= ENEMY_STATS[e.type]?.leak ?? 2;
      burst(e.x, e.y, '#ef4444', 10);
      leaked = true;
    }
    if (leaked) playLeak();
    state.enemies = state.enemies.filter(e => e.wp < state.waypoints.length);

    // towers shoot
    for (const tw of state.towers) {
      tw.cool -= dt;
      if (tw.cool > 0) continue;
      const target = acquire(tw);
      if (!target) continue;
      tw.angle = Math.atan2(target.y - tw.y, target.x - tw.x);
      tw.cool = 1 / tw.rate;
      tw.flashUntil = state.time + 0.12;
      fire(tw, target);
    }

    updateProjectiles(dt);

    // cleanup dead (splitters release their children first)
    for (const e of state.enemies.filter(e => e.hp <= 0)) {
      state.gold += e.reward;
      burst(e.x, e.y, e.color, 8);
      playKill();
      if (e.lastHit) e.lastHit.kills++;
      const sod = ENEMY_STATS[e.type]?.spawnOnDeath;
      if (sod && ENEMY_STATS[sod.type]) {
        for (let i = 0; i < sod.count; i++) {
          const child = makeEnemy(
            sod.type,
            e.x + (Math.random() - 0.5) * 12,
            e.y + (Math.random() - 0.5) * 12,
            e.wp, 1
          );
          if (child) state.enemies.push(child);
        }
      }
    }
    state.enemies = state.enemies.filter(e => e.hp > 0);

    state.beams = state.beams.filter(b => state.time < b.until);
    state.particles = state.particles.filter(p => state.time < p.until);
    for (const p of state.particles) { p.x += p.vx * dt; p.y += p.vy * dt; }

    if (state.waveActive && !state.spawning.length && !state.enemies.length && !state.projectiles.length) {
      state.waveActive = false;
      const bonus = 25 + state.wave * 5;
      state.gold += bonus;
      const isCampaign = !!state.config.levelId;
      if (state.lives <= 0) { /* handled below */ }
      else if (state.wave >= state.config.maxWave) {
        state.won = true;
        if (isCampaign) {
          // campaign ends here: no endless waves, Start stays disabled
          els.btnWave.disabled = true;
          els.status.textContent = `🏆 ${state.config.levelName} complete! (+${bonus}g bonus)`;
          playVictory();
          if (!state.levelEndFired) {
            state.levelEndFired = true;
            if (onLevelEnd) onLevelEnd(state.config.levelId);
          }
        } else {
          els.btnWave.disabled = false;
          els.status.textContent = `🏆 You beat all ${state.config.maxWave} waves! Endless mode continues — keep going! (+${bonus}g)`;
          playVictory();
        }
      } else {
        els.btnWave.disabled = false;
        els.status.textContent = `Wave ${state.wave} cleared! +${bonus}g bonus.`;
        playWaveClear();
      }
      refreshWavePreview();
    }

    if (state.lives <= 0 && !state.gameOver) {
      state.gameOver = true;
      els.status.textContent = `💀 Game over at wave ${state.wave}. Press Restart to try again.`;
      els.btnWave.disabled = true;
      playDefeat();
      refreshWavePreview();
      if (onGameOver) onGameOver();
    }
    updateHud();
  }

  function inRange(tw, e) {
    const d = Math.hypot(e.x - tw.x, e.y - tw.y);
    const def = TOWERS[tw.type];
    if (def.minRange && d < def.minRange) return false; // e.g. Mortar can't hit close up
    return d <= tw.range;
  }

  function acquire(tw) {
    let best = null, bestScore = -Infinity;
    for (const e of state.enemies) {
      if (e.hp <= 0 || e.wp <= 0 || !inRange(tw, e)) continue;
      const score = e.wp * 10000 - Math.hypot(e.x - tw.x, e.y - tw.y); // furthest along
      if (score > bestScore) { best = e; bestScore = score; }
    }
    return best;
  }

  // Top-N targets by the same furthest-along score (multishot towers).
  function acquireTargets(tw, n) {
    return state.enemies
      .filter((e) => e.hp > 0 && e.wp > 0 && inRange(tw, e))
      .map((e) => ({ e, score: e.wp * 10000 - Math.hypot(e.x - tw.x, e.y - tw.y) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map((s) => s.e);
  }

  function damageEnemy(e, amount, tw) {
    e.hp -= amount;
    e.lastHit = tw;
    e.flashUntil = state.time + 0.09; // hit-flash for both renderers
  }

  // Capability-based combat: behavior comes from the tower def fields
  // (splash / projectile / pierce / chain / targets / crit / slow / minRange),
  // so data/towers.json entries combine freely without code changes.
  function fire(tw, target) {
    const def = TOWERS[tw.type];
    target.lastHit = tw;
    playShot(tw.type);
    if (def.splash && !def.projectile) playBoom();
    if (def.projectile) {
      // homing rocket toward target's current spot, explodes with splash
      state.projectiles.push({
        x: tw.x, y: tw.y - 10, tx: target.x, ty: target.y,
        target, speed: 240, dmg: tw.dmg, splash: def.splash || 60,
        color: def.color, tower: tw,
      });
      return;
    }
    if (def.splash) {
      for (const e of state.enemies) {
        if (Math.hypot(e.x - target.x, e.y - target.y) <= def.splash) {
          damageEnemy(e, tw.dmg, tw);
        }
      }
      state.beams.push({ x1: tw.x, y1: tw.y, x2: target.x, y2: target.y, color: def.color, until: state.time + 0.12, w: 4, type: tw.type, splash: def.splash });
      burst(target.x, target.y, def.color, 6);
      return;
    }
    if (def.pierce) {
      // rail spike: damage everything near the tower->target line, extended
      // to full range so lined-up enemies behind the target also fall
      const dx = target.x - tw.x, dy = target.y - tw.y;
      const aim = Math.hypot(dx, dy) || 1;
      const ex = tw.x + (dx / aim) * tw.range, ey = tw.y + (dy / aim) * tw.range;
      const sx = ex - tw.x, sy = ey - tw.y;
      const segLenSq = sx * sx + sy * sy || 1;
      for (const e of state.enemies) {
        if (e.hp <= 0) continue;
        const t = Math.max(0, Math.min(1, ((e.x - tw.x) * sx + (e.y - tw.y) * sy) / segLenSq));
        const cx = tw.x + sx * t, cy = tw.y + sy * t;
        if (Math.hypot(e.x - cx, e.y - cy) <= 12 + (e.r || 0) * 0.5) damageEnemy(e, tw.dmg, tw);
      }
      state.beams.push({ x1: tw.x, y1: tw.y, x2: ex, y2: ey, color: def.color, until: state.time + 0.16, w: 4, type: tw.type, hx: target.x, hy: target.y });
      burst(target.x, target.y, def.color, 5);
      return;
    }
    if (def.chain) {
      // chain lightning: hit target then jump to nearest unhit in 75px
      let current = target;
      const hit = new Set();
      let dmg = tw.dmg;
      let px = tw.x, py = tw.y;
      const jumps = def.chain;
      for (let i = 0; i < jumps && current; i++) {
        damageEnemy(current, dmg, tw);
        state.beams.push({ x1: px, y1: py, x2: current.x, y2: current.y, color: def.color, until: state.time + 0.15, w: 3, zap: true, type: tw.type, hop: i });
        burst(current.x, current.y, def.color, 3);
        hit.add(current);
        dmg *= 0.7;
        px = current.x; py = current.y;
        current = nearestEnemy(px, py, 75, hit);
      }
      return;
    }
    // single- or multi-target shot, optional crit + slow
    const victims = def.targets > 1 ? acquireTargets(tw, def.targets) : [target];
    for (const v of victims) {
      let dmg = tw.dmg;
      let crit = false;
      if (def.crit && Math.random() < def.crit) { dmg *= def.critMult || 2.5; crit = true; }
      damageEnemy(v, dmg, tw);
      if (def.slow && !v.slowImmune) { v.slowUntil = state.time + def.slowDur; v.slowFactor = def.slow; }
      state.beams.push({ x1: tw.x, y1: tw.y, x2: v.x, y2: v.y, color: crit ? '#fef08a' : def.color, until: state.time + (crit ? 0.18 : 0.1), w: crit ? 3 : def.slow ? 3 : 2, type: tw.type, crit, r: v.r });
      if (crit) burst(v.x, v.y, '#fef08a', 5);
    }
  }

  function nearestEnemy(x, y, maxDist, exclude) {
    let best = null, bestD = maxDist;
    for (const e of state.enemies) {
      if (e.hp <= 0 || exclude.has(e)) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bestD) { best = e; bestD = d; }
    }
    return best;
  }

  function updateProjectiles(dt) {
    for (const p of state.projectiles) {
      // home toward live target
      if (p.target && p.target.hp > 0) { p.tx = p.target.x; p.ty = p.target.y; }
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      p.angle = Math.atan2(dy, dx);
      if (d <= Math.max(step, 6)) {
        // explode
        playBoom();
        for (const e of state.enemies) {
          if (Math.hypot(e.x - p.tx, e.y - p.ty) <= p.splash) damageEnemy(e, p.dmg, p.tower);
        }
        burst(p.tx, p.ty, p.color, 12);
        burst(p.tx, p.ty, '#fff', 4);
        p.done = true;
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
    }
    state.projectiles = state.projectiles.filter(p => !p.done);
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 60;
      state.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, color, until: state.time + 0.4 });
    }
  }

  // --- render ---
  function draw() {
    if (!state.map) {
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, canvas.width || 640, canvas.height || 480);
      return;
    }
    const m = state.map;
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        ctx.fillStyle = TILE_COLORS[m.grid[r][c]];
        if (m.grid[r][c] === T.BUILDABLE && (r + c) % 2 === 0) ctx.fillStyle = '#15803d';
        ctx.fillRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        // path texture: darker center line (mud is road too)
        if (m.grid[r][c] === T.PATH || m.grid[r][c] === T.MUD) {
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.fillRect(c * TILE_SIZE + 3, r * TILE_SIZE + 3, TILE_SIZE - 6, TILE_SIZE - 6);
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(c * TILE_SIZE + 6, r * TILE_SIZE + 6, TILE_SIZE - 12, TILE_SIZE - 12);
        }
        // tile pictograms so every tile reads even in the 2D fallback view
        const px = c * TILE_SIZE, py = r * TILE_SIZE, pv = m.grid[r][c];
        if (pv === T.WATER) {
          ctx.strokeStyle = 'rgba(219,234,254,0.7)';
          ctx.lineWidth = 1.5;
          for (const oy of [11, 21]) {
            ctx.beginPath();
            ctx.moveTo(px + 6, py + oy);
            ctx.quadraticCurveTo(px + 11, py + oy - 4, px + 16, py + oy);
            ctx.quadraticCurveTo(px + 21, py + oy + 4, px + 26, py + oy);
            ctx.stroke();
          }
        } else if (pv === T.FOREST) {
          ctx.fillStyle = '#052e16';
          ctx.fillRect(px + 14, py + 20, 4, 7);
          ctx.beginPath();
          ctx.moveTo(px + 16, py + 5); ctx.lineTo(px + 24, py + 21); ctx.lineTo(px + 8, py + 21);
          ctx.closePath(); ctx.fill();
        } else if (pv === T.ROCK) {
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.beginPath();
          ctx.moveTo(px + 16, py + 7); ctx.lineTo(px + 24, py + 15); ctx.lineTo(px + 20, py + 25);
          ctx.lineTo(px + 12, py + 25); ctx.lineTo(px + 8, py + 15);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(px + 13, py + 12, 4, 3);
        } else if (pv === T.MUD) {
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.ellipse(px + 11, py + 12, 6, 3.5, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.ellipse(px + 21, py + 21, 5, 3, 0, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.strokeRect(c * TILE_SIZE + 0.5, r * TILE_SIZE + 0.5, TILE_SIZE, TILE_SIZE);
      }
    }
    // spawn / base emblems
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        const v = m.grid[r][c];
        if (v === T.SPAWN || v === T.BASE) {
          const cx = c * TILE_SIZE + 16, cy = r * TILE_SIZE + 16;
          ctx.save();
          ctx.translate(cx, cy);
          if (v === T.SPAWN) {
            // dark portal
            ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2);
            ctx.fillStyle = '#450a0a'; ctx.fill();
            ctx.beginPath(); ctx.arc(0, 0, 6 + Math.sin(state.time * 4) * 1.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ef4444'; ctx.fill();
          } else {
            // crystal heart
            ctx.beginPath();
            ctx.moveTo(0, -10); ctx.lineTo(7, -2); ctx.lineTo(0, 10); ctx.lineTo(-7, -2);
            ctx.closePath();
            ctx.fillStyle = '#dbeafe'; ctx.fill();
            ctx.strokeStyle = '#1e3a8a'; ctx.lineWidth = 2; ctx.stroke();
          }
          ctx.restore();
        }
      }
    }
    // direction dots on path
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (const w of state.waypoints) ctx.fillRect(w.x - 1, w.y - 1, 2, 2);

    // range preview of selected tower
    if (state.selectedTower) {
      const t = state.selectedTower;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2);
      const selGrad = ctx.createRadialGradient(t.x, t.y, t.range * 0.55, t.x, t.y, t.range);
      selGrad.addColorStop(0, 'rgba(255,255,255,0)');
      selGrad.addColorStop(1, 'rgba(255,255,255,0.10)');
      ctx.fillStyle = selGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // placement preview: ghost tower + range while hovering to build
    // (hidden with no build selection, once a tower is selected, the run is
    // over, or a campaign is won)
    // Fellow towers of the type being placed show their ranges too, in the
    // tower's own color — the new one stays green/red for instant distinction.
    if (!state.selectedTower && state.selectedType && TOWERS[state.selectedType] && !state.gameOver && !(state.won && state.config.levelId) && state.hover && state.map) {
      const fellowColor = TOWERS[state.selectedType].color;
      for (const tw of state.towers) {
        if (tw.type !== state.selectedType) continue;
        ctx.beginPath();
        ctx.arc(tw.x, tw.y, tw.range, 0, Math.PI * 2);
        ctx.fillStyle = fellowColor + '1F';
        ctx.fill();
        ctx.strokeStyle = fellowColor + '8C';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      const { c, r, x, y } = state.hover;
      const inBounds = c >= 0 && r >= 0 && c < state.map.cols && r < state.map.rows;
      if (inBounds) {
        const under = towerAt(c, r);
        if (under) {
          // hovering an existing tower: show its range
          ctx.beginPath();
          ctx.arc(under.x, under.y, under.range, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          const def = TOWERS[state.selectedType];
          const ok = placementValid(c, r).ok;
          // highlight tile
          ctx.fillStyle = ok ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)';
          ctx.fillRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = ok ? '#22c55e' : '#ef4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(c * TILE_SIZE + 1, r * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
          // range circle
          ctx.beginPath();
          ctx.arc(x, y, def.range, 0, Math.PI * 2);
          ctx.fillStyle = ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.10)';
          ctx.fill();
          ctx.strokeStyle = ok ? 'rgba(34,197,94,0.8)' : 'rgba(239,68,68,0.8)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
          // minimum-range dead zone (e.g. Mortar)
          if (def.minRange) {
            ctx.beginPath();
            ctx.arc(x, y, def.minRange, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(239,68,68,0.7)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          // ghost tower
          ctx.save();
          ctx.globalAlpha = 0.75;
          drawTower(ctx, { x, y, type: state.selectedType, level: 1, angle: -Math.PI / 2, flashUntil: -1 }, def, state.time);
          ctx.restore();
        }
      }
    }
    // towers (vector art)
    for (const tw of state.towers) {
      drawTower(ctx, tw, TOWERS[tw.type], state.time);
      if (state.selectedTower === tw) {
        ctx.beginPath();
        ctx.arc(tw.x, tw.y, 15 + Math.sin(state.time * 5) * 1.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    // enemies (vector art)
    for (const e of state.enemies) drawEnemy(ctx, e, state.time);

    // projectiles (rockets)
    for (const p of state.projectiles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.angle ?? 0) + Math.PI / 2);
      ctx.fillStyle = '#fecaca';
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(3.5, 3); ctx.lineTo(-3.5, 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fb7185';
      ctx.fillRect(-2, 1, 4, 3);
      // flame
      ctx.fillStyle = '#fde047';
      ctx.beginPath(); ctx.moveTo(-2, 4); ctx.lineTo(0, 8 + Math.random() * 3); ctx.lineTo(2, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // beams (with glow; tesla zigzag)
    ctx.save();
    for (const b of state.beams) {
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.w || 2;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      if (b.zap) {
        // lightning polyline
        const segs = 4;
        ctx.moveTo(b.x1, b.y1);
        for (let i = 1; i < segs; i++) {
          const t = i / segs;
          const mx = b.x1 + (b.x2 - b.x1) * t + (Math.random() - 0.5) * 10;
          const my = b.y1 + (b.y2 - b.y1) * t + (Math.random() - 0.5) * 10;
          ctx.lineTo(mx, my);
        }
        ctx.lineTo(b.x2, b.y2);
      } else {
        ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2);
      }
      ctx.stroke();
    }
    ctx.restore();
    // particles
    for (const p of state.particles) {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    if (state.gameOver) {
      const goGrad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 40, canvas.width/2, canvas.height/2, canvas.width * 0.6);
      goGrad.addColorStop(0, 'rgba(127,29,29,0.55)');
      goGrad.addColorStop(1, 'rgba(2,6,23,0.88)');
      ctx.fillStyle = goGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f87171'; ctx.font = 'bold 38px system-ui';
      ctx.shadowColor = 'rgba(248,113,113,0.7)'; ctx.shadowBlur = 18;
      ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 8);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#e2e8f0'; ctx.font = '14px system-ui';
      ctx.fillText(`Survived to wave ${state.wave} — press R to restart`, canvas.width / 2, canvas.height / 2 + 22);
    } else if (state.won && state.config.levelId) {
      // campaign victory banner — game is finished, Next is unlocked
      const winGrad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 40, canvas.width/2, canvas.height/2, canvas.width * 0.6);
      winGrad.addColorStop(0, 'rgba(120,112,32,0.55)');
      winGrad.addColorStop(1, 'rgba(2,6,23,0.88)');
      ctx.fillStyle = winGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#facc15';
      ctx.shadowColor = 'rgba(250,204,21,0.7)'; ctx.shadowBlur = 18;
      ctx.font = 'bold 32px system-ui';
      ctx.fillText('★ LEVEL COMPLETE ★', canvas.width / 2, canvas.height / 2 - 26);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = '16px system-ui';
      ctx.fillText(state.config.levelName, canvas.width / 2, canvas.height / 2 + 6);
      ctx.fillStyle = '#bbf7d0';
      ctx.font = '13px system-ui';
      ctx.fillText('Use Next in the sidebar — or replay on a harder difficulty', canvas.width / 2, canvas.height / 2 + 32);
    }
    void findPath;
  }

  let last = performance.now();
  let render2d = true;
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 0.05);
    if (state.running && !state.gameOver && state.map) {
      for (let i = 0; i < state.speed; i++) update(dt);
    }
    if (render2d) draw();
  }

  renderShop();
  refreshMapList();
  const all = loadAllMaps();
  loadMap(JSON.parse(JSON.stringify(all.demo || Object.values(all)[0])));
  requestAnimationFrame(loop);

  // External view API (used by the 3D view): live state + interaction.
  function setHoverTile(c, r) {
    if (c == null || r == null) { state.hover = null; return; }
    state.hover = { c, r, x: c * TILE_SIZE + TILE_SIZE / 2, y: r * TILE_SIZE + TILE_SIZE / 2 };
  }

  // Pinned enemy inspection for the 3D HUD card (stale refs never escape).
  function getInspectedEnemy() {
    const e = state.inspectedEnemy;
    if (!e || e.hp <= 0 || !state.enemies.includes(e)) return null;
    return e;
  }

  function deselect() {
    state.selectedTower = null;
    state.inspectedEnemy = null;
    renderShop(); updateInfo();
  }

  return {
    loadMap, loadLevel, loadMapByName, generateMap, refreshMapList, startWave,
    getConfig: () => ({ ...state.config }),
    getState: () => state,
    getMapNames: () => Object.keys(loadAllMaps()),
    onMapList: (fn) => { mapListSubs.push(fn); },
    interact: (c, r) => tryPlace(c, r),
    setHoverTile,
    setRender2d: (v) => { render2d = !!v; },
    // HUD / external controls (same handlers as the sidebar buttons)
    togglePause, cycleSpeed, restartRun,
    sellSelected: doSell, upgradeSelected: doUpgrade,
    selectTowerType, deselect,
    setInspectedEnemy: (e) => { state.inspectedEnemy = e || null; },
    getInspectedEnemy,
    getWavePreviewData, getInspector,
  };
}
