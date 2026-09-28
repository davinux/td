// Fullscreen 3D HUD: every play control overlaid inside the 3D view.
// Mirrors the sidebar (identity, stats, wave preview, towers, actions) by
// reading game state and calling the same game API as the sidebar buttons.
import { TOWERS, ENEMY_STATS, sortedTowers, hotkeyFor } from './content.js';
import { enemyIconSVG } from './icons.js';
import { towerIconSVG } from './towersvg.js';
import { getSoundSettings, setSoundMuted, onSoundChange, playClick } from './audio.js';
import { ui } from './uiicons.js';
import { attachTooltip, towerTooltipHTML, enemyTooltipHTML, towerInstanceHTML, paintIcons } from './tooltip.js';

export function createHud3D(container, game, opts = {}) {
  const root = document.createElement('div');
  root.id = 'hud3d';
  root.className = 'hidden';
  root.innerHTML = `
    <div class="hud-top">
      <div class="hud-left">
      <div class="hud-panel hud-id">
        <div class="hud-stats">
          <span class="hs" title="Gold">${ui('coin', { size: 16 })}<b class="hs-gold">0</b></span>
          <span class="hs" title="Lives">${ui('heart', { size: 16 })}<b class="hs-lives">0</b></span>
          <span class="hs" title="Wave">${ui('wave', { size: 16 })}<b class="hs-wave">0</b></span>
        </div>
      </div>
      <div class="hud-panel hud-maps hidden">
        <select class="hud-map-select" aria-label="Custom map"></select>
        <button class="hud-map-load" title="Load the selected custom map">Load</button>
        <button class="hud-map-generate" title="New random map [G]">${ui('dice', { size: 16 })}<span>Random</span></button>
      </div>
      </div>
      <div class="hud-panel hud-wave">
        <div class="wp-row"></div>
      </div>
      <div class="hud-top-right">
        <button class="hud-home" title="Pause menu [Esc]">${ui('menu')}<span>Menu</span></button>
      </div>
    </div>
    <div class="hud-mid">
      <div class="hud-panel hud-inspector hidden"></div>
    </div>
    <div class="hud-bottom">
      <div class="hud-bar">
        <div class="hud-towers"></div>
        <div class="hud-actions">
          <button data-act="start" class="primary hud-start" title="Start wave [Space]">${ui('play')}<span>Start wave</span><kbd>Space</kbd></button>
          <span class="hud-sep"></span>
          <button data-act="upgrade" class="hud-labeled" title="Upgrade selected tower [U]">${ui('upgrade')}<span>Upgrade</span></button>
          <button data-act="sell" class="hud-labeled" title="Sell selected tower [X]">${ui('sell')}<span>Sell</span></button>
          <span class="hud-sep"></span>
          <button data-act="pause" class="hud-icon" title="Pause [P]" aria-label="Pause">${ui('pause')}</button>
          <button data-act="speed" class="hud-icon hud-speed" title="Cycle speed [F]" aria-label="Speed">1x</button>
          <button data-act="mute" class="hud-icon" title="Mute / unmute [M]" aria-label="Mute">${ui('volume')}</button>
          <button data-act="center" class="hud-icon" title="Recenter view [C]" aria-label="Recenter">${ui('target')}</button>
          <button data-act="restart" class="hud-icon" title="Restart [R]" aria-label="Restart">${ui('restart')}</button>
        </div>
      </div>
    </div>
  `;
  container.appendChild(root);

  const els = {
    gold: root.querySelector('.hs-gold'),
    lives: root.querySelector('.hs-lives'),
    wave: root.querySelector('.hs-wave'),
    wpRow: root.querySelector('.hud-wave .wp-row'),
    wavePanel: root.querySelector('.hud-wave'),
    maps: root.querySelector('.hud-maps'),
    mapSelect: root.querySelector('.hud-map-select'),
    inspector: root.querySelector('.hud-inspector'),
    towers: root.querySelector('.hud-towers'),
    actions: {},
  };
  root.querySelectorAll('.hud-actions button').forEach((b) => { els.actions[b.dataset.act] = b; });

  // sandbox map controls (hidden during campaign runs)
  function rebuildMapSelect(names) {
    const cur = game.getState().map ? game.getState().map.name : null;
    if (cur && !names.includes(cur)) names = [...names, cur];
    const prev = els.mapSelect.value;
    els.mapSelect.innerHTML = '';
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      els.mapSelect.appendChild(opt);
    }
    // snap to the loaded map (covers freshly generated, unsaved maps)
    if (cur && names.includes(cur)) els.mapSelect.value = cur;
    else if (names.includes(prev)) els.mapSelect.value = prev;
  }
  rebuildMapSelect(game.getMapNames());
  game.onMapList((names) => rebuildMapSelect(names));
  root.querySelector('.hud-map-load').onclick = () => {
    const replace = opts.confirmReplace || ((action) => action());
    replace(() => { game.loadMapByName(els.mapSelect.value); });
  };
  root.querySelector('.hud-map-generate').onclick = () => {
    const replace = opts.confirmReplace || ((action) => action());
    replace(() => { game.generateMap(); });
  };

  // tower buttons in weak -> strong order (icons rendered once; state synced)
  const towerEls = {};
  sortedTowers().forEach((t, i) => {
    const key = t.id;
    const b = document.createElement('button');
    b.className = 'hud-tower';
    const icon = document.createElement('span');
    icon.className = 'tower-svg';
    icon.innerHTML = towerIconSVG(key, t.color, { size: 34 });
    const label = document.createElement('span');
    label.className = 'ht-label';
    label.innerHTML = `<b>${t.name}</b><small>${t.cost}g</small>`;
    const hk = document.createElement('kbd');
    hk.className = 'ht-key';
    hk.textContent = hotkeyFor(i);
    b.appendChild(hk);
    b.appendChild(icon);
    b.appendChild(label);
    b.onclick = () => game.selectTowerType(key);
    attachTooltip(b, () => towerTooltipHTML(t, hotkeyFor(i)));
    els.towers.appendChild(b);
    towerEls[key] = b;
  });

  els.actions.sell.onclick = () => game.sellSelected();
  els.actions.upgrade.onclick = () => game.upgradeSelected();
  els.actions.start.onclick = () => game.startWave();
  els.actions.pause.onclick = () => game.togglePause();
  els.actions.speed.onclick = () => game.cycleSpeed();
  els.actions.mute.onclick = () => {
    const s = getSoundSettings();
    setSoundMuted(!s.muted);
    playClick();
  };
  // keep the mute glyph in sync without rebuilding (driven by audio settings)
  const soundState = getSoundSettings();
  let soundOff = soundState.muted || !soundState.enabled;
  onSoundChange((s) => { soundOff = s.muted || !s.enabled; });
  els.actions.center.onclick = () => opts.onRecenter && opts.onRecenter();
  els.actions.restart.onclick = () => game.restartRun();
  root.querySelector('.hud-home').onclick = () => opts.onMenu && opts.onMenu();

  // change-cached sync: DOM writes only happen on actual changes
  const cache = {};
  function setText(el, key, val) {
    if (cache[key] !== val) { cache[key] = val; el.textContent = val; }
  }
  function setHTML(el, key, val) {
    if (cache[key] !== val) { cache[key] = val; el.innerHTML = val; }
  }

  let previewKey = null;
  let inspKey = null;

  // Pinned details card: selected tower first, else inspected enemy.
  // Rebuilds only when the underlying facts change (keyed).
  function syncInspector(s) {
    const tw = s.selectedTower;
    const foe = tw ? null : game.getInspectedEnemy();
    if (!tw && !foe) {
      els.inspector.classList.add('hidden');
      inspKey = null;
      return;
    }
    els.inspector.classList.remove('hidden');
    if (tw) {
      const insp = game.getInspector(tw);
      // Rebuild on level/kills AND on affordability/cost changes so the
      // upgrade button enables/disables live as gold changes.
      const key = `t:${tw.type}:${tw.level}:${tw.kills}:${insp.upgradeCost}:${insp.canUpgrade}:${insp.sellRefund}`;
      if (key === inspKey) return;
      inspKey = key;
      els.inspector.innerHTML = `<button class="hud-insp-close" title="Close [Esc]">✕</button>`
        + towerInstanceHTML(tw, insp, TOWERS[tw.type]);
      els.inspector.querySelector('[data-act="upgrade"]')?.addEventListener('click', () => game.upgradeSelected());
      els.inspector.querySelector('[data-act="sell"]')?.addEventListener('click', () => game.sellSelected());
    } else {
      const def = ENEMY_STATS[foe.type];
      if (!def) { els.inspector.classList.add('hidden'); inspKey = null; return; }
      const key = `e:${foe.type}:${Math.ceil(foe.hp / 5)}:${foe.maxHp}`;
      if (key === inspKey) return;
      inspKey = key;
      els.inspector.innerHTML = `<button class="hud-insp-close" title="Close [Esc]">✕</button>`
        + enemyTooltipHTML(def, { hp: foe.hp, maxHp: foe.maxHp });
    }
    paintIcons(els.inspector);
    const close = els.inspector.querySelector('.hud-insp-close');
    if (close) close.onclick = () => game.deselect();
  }
  function syncPreview() {
    const data = game.getWavePreviewData();
    const key = JSON.stringify(data);
    if (key === previewKey) return;
    previewKey = key;
    els.wpRow.innerHTML = '';
    // No title: the enemy icons (+ counts) carry the wave info on their own.
    // Nothing to preview once the run is over or fully cleared.
    if (data.kind === 'over' || data.kind === 'done') {
      els.wavePanel.classList.add('hidden');
      return;
    }
    els.wavePanel.classList.remove('hidden');
    for (const c of data.counts) {
      const def = ENEMY_STATS[c.type];
      if (!def) continue;
      // same out/queued states as the sidebar: ✓ = already out, dimmed = yet to come
      const cls = c.queued === undefined ? '' : c.queued <= 0 ? 'is-out' : c.out > 0 ? 'is-partial' : 'is-queued';
      const text = c.queued === undefined ? `×${c.count}` : cls === 'is-out' ? `✓${c.count}` : cls === 'is-partial' ? `${c.out}/${c.count}` : `×${c.count}`;
      const chip = document.createElement('div');
      chip.className = `wp-chip ${cls}`.trim();
      attachTooltip(chip, () => enemyTooltipHTML(def));
      const icon = document.createElement('span');
      icon.className = 'wp-ico';
      icon.innerHTML = enemyIconSVG(def, { size: 26 });
      const label = document.createElement('small');
      label.textContent = text;
      chip.appendChild(icon);
      chip.appendChild(label);
      els.wpRow.appendChild(chip);
    }
  }

  function sync() {
    const s = game.getState();
    const cfg = game.getConfig();
    setText(els.gold, 'gold', String(Math.floor(s.gold)));
    setText(els.lives, 'lives', String(s.lives));
    setText(els.wave, 'wave', `${s.wave}/${cfg.maxWave}`);
    els.lives.parentElement.classList.toggle('low', s.lives <= 5);
    for (const [key, t] of Object.entries(TOWERS)) {
      const el = towerEls[key];
      if (!el) continue;
      el.classList.toggle('selected', s.selectedType === key && !s.selectedTower);
      el.classList.toggle('disabled', s.gold < t.cost);
    }
    const insp = game.getInspector();
    els.actions.sell.disabled = !insp.hasTower;
    els.actions.upgrade.disabled = !insp.hasTower || !insp.canUpgrade;
    els.actions.start.disabled = s.waveActive || s.gameOver || (s.won && !!cfg.levelId);
    setHTML(els.actions.pause, 'pause', ui(s.running ? 'pause' : 'play'));
    els.actions.pause.classList.toggle('on', !s.running);
    setText(els.actions.speed, 'speed', `${s.speed}x`);
    els.actions.speed.classList.toggle('on', s.speed > 1);
    setHTML(els.actions.mute, 'mute', ui(soundOff ? 'mute' : 'volume'));
    els.maps.classList.toggle('hidden', !!cfg.levelId);
    syncInspector(s);
    syncPreview();
  }

  let running = false;
  let rafId = 0;
  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    try {
      sync();
    } catch {
      // HUD must never break the game loop
    }
  }

  return {
    show() {
      root.classList.remove('hidden');
      previewKey = null;
      inspKey = null;
      for (const k of Object.keys(cache)) delete cache[k];
      if (!running) {
        running = true;
        loop();
      }
    },
    hide() {
      running = false;
      cancelAnimationFrame(rafId);
      root.classList.add('hidden');
    },
  };
}
