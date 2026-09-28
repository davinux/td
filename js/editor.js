// Map editor: paint tiles in the 3D scene, tweak run rules, compose waves, validate, save/load JSON.
import { T, createGrid, cloneMap, demoMap, validateMap, getSettings, sanitizeSettings, defaultWaveGroups, customWaveProblems, CUSTOM_GAP } from './model.js';
import { ENEMY_STATS, ENEMY_ORDER } from './content.js';
import { loadAllMaps, saveMap, deleteMap } from './storage.js';
import { createEditor3D } from './editor3d.js';
import { tileIconSVG } from './icons.js';

// Enemy ids used for the type dropdown until data/enemies.json loads
// (main.js re-renders the composer once content arrives).
const FALLBACK_ENEMY_IDS = ['grunt', 'wisp', 'fast', 'shield', 'swarm', 'tank', 'splitter', 'phantom', 'golem', 'boss'];

export function initEditor({ onPlayMap }) {
  let map = demoMap();
  if (!map.settings) map.settings = getSettings(map);
  let tool = 'path';
  let version = 0;
  const bump = () => { version++; };

  // Tile palette icons (isometric SVG blocks matching the 3D terrain).
  document.querySelectorAll('.tile-ico[data-tile]').forEach((el) => {
    el.innerHTML = tileIconSVG(el.dataset.tile, { size: el.classList.contains('inline') ? 24 : 28 });
  });

  const els = {
    tools: document.getElementById('editor-tools'),
    cols: document.getElementById('ed-cols'),
    rows: document.getElementById('ed-rows'),
    name: document.getElementById('ed-name'),
    json: document.getElementById('ed-json'),
    status: document.getElementById('ed-status'),
    gold: document.getElementById('ed-gold'),
    lives: document.getElementById('ed-lives'),
    waves: document.getElementById('ed-waves'),
    hp: document.getElementById('ed-hp'),
    rulesSummary: document.getElementById('ed-rules-summary'),
    customWaves: document.getElementById('ed-custom-waves'),
    waveList: document.getElementById('ed-wave-list'),
    waveTools: document.getElementById('ed-wave-tools'),
    waveHint: document.getElementById('ed-wave-hint'),
  };

  // --- run rules (per-map settings) ---
  function syncSettingsInputs() {
    const s = getSettings(map);
    if (els.gold) els.gold.value = s.gold;
    if (els.lives) els.lives.value = s.lives;
    if (els.waves) els.waves.value = s.maxWave;
    if (els.hp) els.hp.value = Math.round(s.hpScale * 100);
    updateRulesSummary();
  }

  function updateRulesSummary() {
    if (!els.rulesSummary) return;
    const s = getSettings(map);
    const custom = Array.isArray(s.waves);
    const tag = custom
      ? ` (custom · ${s.waves.flat().reduce((a, g) => a + (g.count || 0), 0)} foes)`
      : '';
    els.rulesSummary.textContent =
      `${s.maxWave} wave${s.maxWave === 1 ? '' : 's'}${tag} · ${s.gold}g · ${s.lives}❤️ · foes ${Math.round(s.hpScale * 100)}%`;
  }

  function readSettingsInputs() {
    const raw = {
      gold: els.gold ? +els.gold.value : undefined,
      lives: els.lives ? +els.lives.value : undefined,
      maxWave: els.waves ? +els.waves.value : undefined,
      hpScale: els.hp ? (+els.hp.value) / 100 : undefined,
    };
    const cur = getSettings(map);
    const nextMax = Number.isFinite(raw.maxWave)
      ? Math.round(Math.min(100, Math.max(1, raw.maxWave)))
      : cur.maxWave;
    // Keep the custom list length in sync with the Waves count.
    let waves = Array.isArray(cur.waves) ? cur.waves.map((w) => [...w]) : null;
    if (waves) {
      while (waves.length < nextMax) waves.push(defaultWaveGroups(waves.length + 1).map((g) => ({ ...g })));
      waves.length = nextMax;
    }
    map.settings = sanitizeSettings({
      gold: Number.isFinite(raw.gold) ? raw.gold : cur.gold,
      lives: Number.isFinite(raw.lives) ? raw.lives : cur.lives,
      maxWave: nextMax,
      hpScale: Number.isFinite(raw.hpScale) ? raw.hpScale : cur.hpScale,
      waves,
    });
    updateRulesSummary();
  }

  for (const key of ['gold', 'lives', 'hp']) {
    els[key]?.addEventListener('input', readSettingsInputs);
    els[key]?.addEventListener('change', () => { readSettingsInputs(); syncSettingsInputs(); });
  }
  // The Waves count reshapes the custom list, so re-render the composer too.
  els.waves?.addEventListener('input', () => { readSettingsInputs(); renderWaveList(); });
  els.waves?.addEventListener('change', () => { readSettingsInputs(); syncSettingsInputs(); renderWaveList(); });

  // --- custom wave composer: enemy types + counts for every wave ---
  const customEnabled = () => Array.isArray(map.settings?.waves);

  function enemyTypeOptions() {
    if (ENEMY_ORDER.length) return ENEMY_ORDER.map((id) => ({ id, name: ENEMY_STATS[id]?.name || id }));
    return FALLBACK_ENEMY_IDS.map((id) => ({ id, name: id }));
  }

  function enemyName(id) {
    return ENEMY_STATS[id]?.name || id;
  }

  function ensureCustomWaves() {
    const s = getSettings(map);
    const waves = [];
    for (let n = 1; n <= s.maxWave; n++) waves.push(defaultWaveGroups(n).map((g) => ({ ...g })));
    map.settings = { ...s, waves };
  }

  function waveSummaryText(groups) {
    const total = groups.reduce((a, g) => a + (g.count || 0), 0);
    const parts = groups.map((g) => `${enemyName(g.type)} ×${g.count}`);
    return { total, text: `${total} ${total === 1 ? 'enemy' : 'enemies'}${parts.length ? ' · ' + parts.join(', ') : ''}` };
  }

  function refreshWaveSummary(wi) {
    const det = els.waveList?.children[wi];
    const span = det?.querySelector('.wsum');
    if (span) span.textContent = waveSummaryText(map.settings.waves[wi]).text;
    updateRulesSummary();
  }

  function groupRow(wi, gi, types) {
    const g = map.settings.waves[wi][gi];
    const row = document.createElement('div');
    row.className = 'wgroup';
    const sel = document.createElement('select');
    sel.title = 'Enemy type';
    sel.setAttribute('aria-label', `Wave ${wi + 1} group ${gi + 1} enemy type`);
    for (const t of types) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      if (t.id === g.type) opt.selected = true;
      sel.appendChild(opt);
    }
    // Custom type ids (e.g. from a newer data file) survive as an option.
    if (!types.some((t) => t.id === g.type)) {
      const opt = document.createElement('option');
      opt.value = g.type;
      opt.textContent = g.type;
      opt.selected = true;
      sel.appendChild(opt);
    }
    sel.onchange = () => {
      map.settings.waves[wi][gi].type = sel.value;
      refreshWaveSummary(wi);
    };
    const count = document.createElement('input');
    count.type = 'number';
    count.min = '1';
    count.max = '500';
    count.value = g.count;
    count.title = 'How many';
    count.setAttribute('aria-label', `Wave ${wi + 1} group ${gi + 1} count`);
    count.oninput = () => {
      const v = Math.round(Math.min(500, Math.max(1, +count.value || 0)));
      if (v) {
        map.settings.waves[wi][gi].count = v;
        refreshWaveSummary(wi);
      }
    };
    count.onchange = () => { count.value = map.settings.waves[wi][gi].count; };
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '✕';
    del.title = 'Remove this group';
    del.onclick = () => {
      map.settings.waves[wi].splice(gi, 1);
      renderWaveList(wi + 1);
      refresh();
    };
    row.append(sel, count, del);
    return row;
  }

  function renderWaveList(forceOpenN = null) {
    const list = els.waveList;
    if (!list) return;
    // Preserve which waves the user had expanded across re-renders.
    const wasOpen = new Set();
    list.querySelectorAll('details.wave-item').forEach((d, i) => { if (d.open) wasOpen.add(i); });
    if (els.customWaves) els.customWaves.checked = customEnabled();
    if (els.waveTools) els.waveTools.hidden = !customEnabled();
    if (els.waveHint) {
      els.waveHint.textContent = customEnabled()
        ? 'Edit every wave: enemy types + counts. HP still scales up each wave.'
        : 'Off = classic auto curve. Turn on to edit every wave below.';
    }
    list.innerHTML = '';
    if (!customEnabled()) return;
    const types = enemyTypeOptions();
    const waves = map.settings.waves;
    waves.forEach((groups, wi) => {
      const n = wi + 1;
      const det = document.createElement('details');
      det.className = 'wave-item';
      if (forceOpenN === n || (forceOpenN === null && wasOpen.has(wi))) det.open = true;
      const sum = document.createElement('summary');
      const title = document.createElement('b');
      title.textContent = `Wave ${n}`;
      const span = document.createElement('span');
      span.className = 'wsum';
      span.textContent = waveSummaryText(groups).text;
      sum.append(title, document.createTextNode(' '), span);
      det.appendChild(sum);
      const body = document.createElement('div');
      body.className = 'wave-body';
      groups.forEach((_, gi) => body.appendChild(groupRow(wi, gi, types)));
      const addRow = document.createElement('div');
      addRow.className = 'row wave-foot';
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = '＋ Add enemy';
      add.title = 'Add an enemy group to this wave';
      add.onclick = () => {
        map.settings.waves[wi].push({ type: 'grunt', count: 5, gap: CUSTOM_GAP });
        renderWaveList(n);
        refresh();
      };
      addRow.appendChild(add);
      if (wi > 0) {
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = '⧉ Copy previous';
        copy.title = `Copy wave ${wi}'s groups`;
        copy.onclick = () => {
          map.settings.waves[wi] = map.settings.waves[wi - 1].map((g) => ({ ...g }));
          renderWaveList(n);
          refresh();
        };
        addRow.appendChild(copy);
      }
      if (groups.length) {
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.textContent = 'Clear';
        clear.title = 'Remove all groups from this wave';
        clear.onclick = () => {
          map.settings.waves[wi] = [];
          renderWaveList(n);
          refresh();
        };
        addRow.appendChild(clear);
      }
      body.appendChild(addRow);
      det.appendChild(body);
      list.appendChild(det);
    });
  }

  els.customWaves?.addEventListener('change', () => {
    if (els.customWaves.checked) ensureCustomWaves();
    else map.settings = { ...getSettings(map), waves: null };
    updateRulesSummary();
    renderWaveList(1);
    refresh();
  });
  document.getElementById('ed-waves-reset')?.addEventListener('click', () => {
    ensureCustomWaves();
    updateRulesSummary();
    renderWaveList(1);
    refresh();
  });
  document.getElementById('ed-wave-add')?.addEventListener('click', () => {
    if (!customEnabled()) ensureCustomWaves();
    const s = getSettings(map);
    const waves = [...s.waves, defaultWaveGroups(s.waves.length + 1).map((g) => ({ ...g }))];
    map.settings = { ...s, maxWave: waves.length, waves };
    syncSettingsInputs();
    renderWaveList(waves.length);
    refresh();
  });

  const viewer3d = createEditor3D(document.getElementById('editor3d-container'), {
    getMap: () => map,
    getVersion: () => version,
    getTool: () => tool,
    onPaint: (c, r) => paintTile(c, r),
    onError: (msg) => {
      els.status.textContent = msg;
      els.status.className = 'status err';
    },
  });

  function refresh() {
    const res = validateMap(map);
    const badWaves = customWaveProblems(getSettings(map));
    if (!res.ok) {
      els.status.textContent = res.msg;
      els.status.className = 'status err';
    } else if (badWaves.length) {
      els.status.textContent = `Wave ${badWaves[0]} has no enemies — add at least one group or turn Custom waves off.`;
      els.status.className = 'status err';
    } else {
      els.status.textContent = res.msg;
      els.status.className = 'status ok';
    }
    bump();
  }

  function toolToTile(t) {
    switch (t) {
      case 'path': return T.PATH;
      case 'buildable': return T.BUILDABLE;
      case 'blocked': return T.BLOCKED;
      case 'spawn': return T.SPAWN;
      case 'base': return T.BASE;
      case 'water': return T.WATER;
      case 'forest': return T.FOREST;
      case 'rock': return T.ROCK;
      case 'mud': return T.MUD;
      case 'erase': return T.BUILDABLE;
      default: return T.PATH;
    }
  }

  function paintTile(c, r) {
    if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) return;
    const tile = toolToTile(tool);
    if (map.grid[r][c] === tile) return; // no-op: avoids rebuild churn
    // keep spawn/base unique: demote old one to path
    if ((tile === T.SPAWN || tile === T.BASE) && map.grid[r][c] !== tile) {
      for (let rr = 0; rr < map.rows; rr++)
        for (let cc = 0; cc < map.cols; cc++)
          if (map.grid[rr][cc] === tile) map.grid[rr][cc] = T.PATH;
    }
    map.grid[r][c] = tile;
    refresh();
  }

  els.tools.addEventListener('click', e => {
    const btn = e.target.closest('button[data-tool]');
    if (!btn) return;
    tool = btn.dataset.tool;
    els.tools.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b === btn));
  });

  document.getElementById('ed-resize').onclick = () => {
    const cols = Math.max(8, Math.min(30, +els.cols.value || 20));
    const rows = Math.max(8, Math.min(20, +els.rows.value || 15));
    const next = createGrid(cols, rows);
    for (let r = 0; r < Math.min(rows, map.rows); r++)
      for (let c = 0; c < Math.min(cols, map.cols); c++)
        next[r][c] = map.grid[r][c];
    map = { name: map.name, cols, rows, grid: next, settings: getSettings(map) };
    refresh();
  };
  document.getElementById('ed-clear').onclick = () => {
    map.grid = createGrid(map.cols, map.rows);
    refresh();
  };
  document.getElementById('ed-default').onclick = () => {
    const d = demoMap();
    map = { ...cloneMap(d), name: els.name.value.trim() || d.name };
    els.cols.value = map.cols; els.rows.value = map.rows;
    syncSettingsInputs();
    renderWaveList();
    refresh();
  };
  document.getElementById('ed-save').onclick = () => {
    readSettingsInputs();
    map.name = els.name.value.trim() || 'my-map';
    saveMap(cloneMap(map));
    els.status.textContent = `Saved "${map.name}".`;
    els.status.className = 'status ok';
  };
  document.getElementById('ed-load').onclick = () => {
    const all = loadAllMaps();
    const name = els.name.value.trim();
    if (all[name]) {
      map = cloneMap(all[name]);
      if (!map.settings) map.settings = getSettings(map);
      els.cols.value = map.cols; els.rows.value = map.rows;
      syncSettingsInputs();
      renderWaveList();
      refresh();
    } else {
      els.status.textContent = `No saved map named "${name}". Available: ${Object.keys(all).join(', ')}`;
      els.status.className = 'status err';
    }
  };
  document.getElementById('ed-delete').onclick = () => {
    deleteMap(els.name.value.trim());
    els.status.textContent = 'Deleted (if it existed).';
  };
  document.getElementById('ed-export').onclick = () => {
    readSettingsInputs();
    map.name = els.name.value.trim() || map.name;
    els.json.value = JSON.stringify(map);
  };
  document.getElementById('ed-import').onclick = () => {
    try {
      const m = JSON.parse(els.json.value);
      if (!m.grid || !m.cols || !m.rows) throw new Error('bad shape');
      map = cloneMap(m);
      if (!map.settings) map.settings = getSettings(map);
      els.name.value = m.name || 'imported';
      els.cols.value = m.cols; els.rows.value = m.rows;
      syncSettingsInputs();
      renderWaveList();
      refresh();
    } catch (err) {
      els.status.textContent = 'Import failed: ' + err.message;
      els.status.className = 'status err';
    }
  };
  document.getElementById('ed-play').onclick = () => {
    readSettingsInputs();
    const res = validateMap(map);
    if (!res.ok) { els.status.textContent = 'Fix map first: ' + res.msg; els.status.className = 'status err'; return; }
    const badWaves = customWaveProblems(getSettings(map));
    if (badWaves.length) { els.status.textContent = `Fix waves first: wave ${badWaves[0]} has no enemies.`; els.status.className = 'status err'; return; }
    onPlayMap(cloneMap({ ...map, name: els.name.value.trim() || map.name }));
  };

  els.cols.value = map.cols; els.rows.value = map.rows;
  syncSettingsInputs();
  renderWaveList();
  refresh();

  return {
    getMap: () => cloneMap(map),
    setMap: (m) => { map = cloneMap(m); if (!map.settings) map.settings = getSettings(map); els.name.value = m.name; els.cols.value = m.cols; els.rows.value = m.rows; syncSettingsInputs(); renderWaveList(); refresh(); },
    // Re-render the composer once data/enemies.json arrives (type names).
    refreshWaves: () => renderWaveList(),
    start: () => viewer3d.start(),
    stop: () => viewer3d.stop(),
  };
}
