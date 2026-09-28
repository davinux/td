// Rich hover cards ("hot-tips") for towers and enemies.
// Replaces plain `title` attributes with graphical cards: live vector art,
// stat bars, ability badges and tactical counters. Pure hover layer
// (pointer-events: none) — it never blocks clicks.
import { TOWERS, ENEMY_STATS } from './content.js';
import { drawEnemyIcon } from './graphics.js';
import { enemyIconSVG } from './icons.js';
import { towerIconSVG } from './towersvg.js';

let el = null;
let showTimer = 0;
let currentTarget = null;
let globalsWired = false;

function ensure() {
  if (!el) {
    el = document.createElement('div');
    el.id = 'game-tooltip';
    el.className = 'hidden';
    document.body.appendChild(el);
  }
  if (!globalsWired) {
    globalsWired = true;
    // Dismiss on anything that changes context.
    document.addEventListener('pointerdown', () => hideTooltip(), true);
    document.addEventListener('scroll', () => hideTooltip(), true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideTooltip();
    });
  }
  return el;
}

// Paint data-icon placeholders inside a card root (used by pinned cards too).
// Tower icons are inline SVG (baked into the markup); only enemy portraits
// still need a canvas paint pass.
export function paintIcons(root) {
  root.querySelectorAll('canvas[data-enemy]').forEach((cv) => {
    const def = ENEMY_STATS[cv.dataset.enemy];
    if (def) drawEnemyIcon(cv, def, 1.2);
  });
}

export function showTooltip(html, x, y) {
  const t = ensure();
  t.innerHTML = html;
  paintIcons(t);
  t.classList.remove('hidden');
  moveTooltip(x, y);
}

export function moveTooltip(x, y) {
  if (!el || el.classList.contains('hidden')) return;
  const pad = 14;
  const r = el.getBoundingClientRect();
  let lx = x + 16;
  let ly = y + 18;
  if (lx + r.width + pad > window.innerWidth) lx = x - r.width - 12;
  if (ly + r.height + pad > window.innerHeight) ly = y - r.height - 12;
  el.style.left = Math.max(pad, lx) + 'px';
  el.style.top = Math.max(pad, ly) + 'px';
}

export function hideTooltip() {
  clearTimeout(showTimer);
  currentTarget = null;
  if (el) el.classList.add('hidden');
}

// Hover wiring for static elements: show the card after a short delay,
// follow the cursor, hide on leave. getHTML() builds fresh markup per show.
export function attachTooltip(target, getHTML, delay = 220) {
  target.addEventListener('pointerenter', (e) => {
    currentTarget = target;
    clearTimeout(showTimer);
    const x = e.clientX, y = e.clientY;
    showTimer = setTimeout(() => {
      if (currentTarget === target) showTooltip(getHTML(), x, y);
    }, delay);
  });
  target.addEventListener('pointermove', (e) => {
    if (currentTarget === target) moveTooltip(e.clientX, e.clientY);
  });
  target.addEventListener('pointerleave', () => {
    if (currentTarget === target) hideTooltip();
  });
}

// --- card builders ---

function maxTowerStats() {
  const vals = Object.values(TOWERS);
  return {
    dmg: Math.max(...vals.map((t) => t.dmg), 1),
    range: Math.max(...vals.map((t) => t.range), 1),
    rate: Math.max(...vals.map((t) => t.rate), 1),
    dps: Math.max(...vals.map((t) => t.dmg * t.rate * (t.chain || 1)), 1),
  };
}

function barRow(label, val, max, display) {
  const pct = Math.max(2, Math.min(100, (val / max) * 100));
  return `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${pct}%"></i></div><b>${display}</b></div>`;
}

export function towerAbilities(def) {
  const out = [];
  if (def.projectile) out.push(['🚀', `Homing rockets · splash ${def.splash || 60}`]);
  else if (def.splash) out.push(['💥', `Splash damage · radius ${def.splash}`]);
  if (def.chain) out.push(['⚡', `Lightning chains ×${def.chain} targets`]);
  if (def.slow) out.push(['❄️', `Slows enemies to ${Math.round(def.slow * 100)}%`]);
  if (def.crit) out.push(['🎯', `${Math.round(def.crit * 100)}% crit ×${def.critMult || 2.5}`]);
  if (def.pierce) out.push(['🔻', 'Shot pierces the whole enemy line']);
  if (def.targets > 1) out.push(['🎯', `Strikes ${def.targets} targets at once`]);
  if (def.minRange) out.push(['📏', `Can't hit closer than ${def.minRange}px`]);
  if (!out.length) out.push(['🎯', 'Reliable single-target shots']);
  return out.map(([icon, text]) => `<div class="ab-badge"><span>${icon}</span>${text}</div>`).join('');
}

// Catalog card for a tower type (shop, HUD, ...). index = hotkey number.
export function towerTooltipHTML(def, index) {
  const max = maxTowerStats();
  const dps = def.dmg * def.rate * (def.chain || 1);
  return `
    <div class="tt-head">
      ${towerIconSVG(def.id, def.color, { size: 46 })}
      <div><b>${def.name}</b><small>💰 ${def.cost}g · hotkey ${index}</small></div>
    </div>
    <div class="tt-stats">
      ${barRow('DMG', def.dmg, max.dmg, def.dmg)}
      ${barRow('RNG', def.range, max.range, def.range)}
      ${barRow('RATE', def.rate, max.rate, def.rate + '/s')}
      ${barRow('DPS', dps, max.dps, Math.round(dps))}
    </div>
    <div class="ab-row">${towerAbilities(def)}</div>
    <div class="tt-desc">${def.desc}</div>
  `;
}

// Placed-tower card: live level/kills/costs on top of the catalog abilities.
// Rendered both in the sidebar (#sel-info) and pinned on the right side of
// the 3D HUD (.hud-inspector). Upgrade/sell are real <button>s with
// data-act hooks — each host wires them to its own game actions.
export function towerInstanceHTML(tw, insp, def) {
  const max = maxTowerStats();
  const dps = Math.round(tw.dmg * (tw.rate ?? def.rate));
  const upDisabled = insp.canUpgrade ? '' : ' disabled';
  return `
    <div class="tt-inst" style="--tw:${def.color}">
      <div class="tt-inst-head">
        <div class="tt-portrait">${towerIconSVG(tw.type, def.color, { size: 72 })}</div>
        <div class="tt-title">
          <b>${def.name}</b>
          <div class="tt-sub"><span class="tt-lvl">Lv ${tw.level}</span><span class="tt-kills">💀 ${tw.kills} kills</span></div>
          <div class="tt-dps">⚔️ ${dps} DPS</div>
        </div>
      </div>
      <div class="tt-stats">
        ${barRow('DMG', tw.dmg, max.dmg, Math.round(tw.dmg))}
        ${barRow('RNG', tw.range, max.range, Math.round(tw.range))}
        ${barRow('DPS', tw.dmg * (tw.rate ?? def.rate), max.dps, dps)}
      </div>
      <div class="ab-row">${towerAbilities(def)}</div>
      <div class="tt-actions">
        <button type="button" class="tt-upgrade" data-act="upgrade" title="Upgrade this tower [U]"${upDisabled}><span>⬆️</span>Upgrade · ${insp.upgradeCost}g</button>
        <button type="button" class="tt-sell" data-act="sell" title="Sell this tower [X]"><span>💰</span>Sell +${insp.sellRefund}g</button>
      </div>
    </div>
  `;
}

function maxEnemyStats() {
  const vals = Object.values(ENEMY_STATS);
  return {
    hp: Math.max(...vals.map((e) => e.hp), 1),
    speed: Math.max(...vals.map((e) => e.speed), 1),
    reward: Math.max(...vals.map((e) => e.reward), 1),
    leak: Math.max(...vals.map((e) => e.leak ?? 1), 1),
  };
}

// Rule-based tactical counters, derived from stats (no per-enemy hardcoding).
export function enemyCounters(def) {
  const out = [];
  if ((def.leak ?? 1) >= 3) out.push(['🛡️', 'Priority target — must not get through']);
  if (def.slowImmune) out.push(['🚫', 'Immune to slow — use raw damage']);
  if (def.spawnOnDeath) {
    const child = ENEMY_STATS[def.spawnOnDeath.type]?.name || def.spawnOnDeath.type;
    out.push(['🧬', `Splits into ${def.spawnOnDeath.count} ${child}s on death`]);
  }
  if (def.hp >= 100) out.push(['🎯', 'High single-target DPS melts it (Sniper)']);
  if (def.hp <= 25) out.push(['💥', 'Splash & chain clear whole packs (Cannon, Tesla)']);
  if (def.speed >= 80) out.push(['❄️', 'Slow it down first (Frost)']);
  if (def.reward >= 15) out.push(['💰', 'Valuable — worth focusing fire']);
  if (!out.length) out.push(['⚔️', 'Balanced — any tower works']);
  return out.map(([icon, text]) => `<div class="ab-badge"><span>${icon}</span>${text}</div>`).join('');
}

// Catalog card for an enemy type. hpInfo {hp, maxHp} adds a live HP bar (canvas hover).
export function enemyTooltipHTML(def, hpInfo = null) {
  const max = maxEnemyStats();
  const hpBar = hpInfo
    ? `<div class="tt-hpbar"><i style="width:${Math.max(0, (hpInfo.hp / hpInfo.maxHp) * 100)}%"></i></div>
       <div class="tt-hptext">HP ${Math.max(0, Math.ceil(hpInfo.hp))}/${hpInfo.maxHp}</div>`
    : '';
  return `
    <div class="tt-head">
      ${enemyIconSVG(def, { size: 46 })}
      <div><b>${def.name}</b><small>${def.desc}</small></div>
    </div>
    ${hpBar}
    <div class="tt-stats">
      ${barRow('HP', def.hp, max.hp, def.hp)}
      ${barRow('SPD', def.speed, max.speed, def.speed)}
      ${barRow('RWD', def.reward, max.reward, def.reward + 'g')}
      ${barRow('LEAK', def.leak ?? 1, max.leak, '−' + (def.leak ?? 1) + '❤️')}
    </div>
    <div class="ab-row">${enemyCounters(def)}</div>
  `;
}
