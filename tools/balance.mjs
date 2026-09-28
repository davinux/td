#!/usr/bin/env node
// Headless balance simulator for the campaign.
//
// Mirrors the combat rules in js/game.js (movement, frost + mud slow, leaks,
// splash / pierce / chain / multi-target / crit / homing rockets, splitter
// children, rewards, wave bonus, upgrades) and plays every level with a
// greedy "competent player" bot that builds and upgrades by road coverage,
// between waves and mid-wave. Use it to check that difficulty climbs across
// maps and worlds, and that Easy < Normal < Hard.
//
//   node tools/balance.mjs                 # sample maps 1,5,10,15,20 of every world
//   node tools/balance.mjs --all           # all 120 maps × 3 difficulties
//   node tools/balance.mjs --world mire    # one world
//   node tools/balance.mjs --maps 1,2,3 --diffs hard
//
// Output per level: result (WIN/lost at wave N), lives left, towers built.
// The bot is good but not clever (no mud kill-zone planning, no selling), so
// a skilled human should beat Hard where the bot barely scrapes through.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Node has no fetch() for relative files: serve data/*.json from disk.
globalThis.fetch = async (p) => {
  const body = readFileSync(join(ROOT, String(p)), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};

const content = await import('../js/content.js');
const levels = await import('../js/levels.js');
const { T, TILE_SIZE, validateMap, pathToWaypoints, waveHpScale, defaultWaveGroups, MUD_FACTOR } = await import('../js/model.js');
await content.loadContent('data');
// live bindings: read after loading (destructuring would capture the empty pre-load objects)
const TOWERS = content.TOWERS;
const ENEMY_STATS = content.ENEMY_STATS;
await levels.loadCampaign('data');

// --- deterministic RNG (crit rolls, splitter jitter) ---
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildWave(n, custom) {
  const list = Array.isArray(custom) ? custom[n - 1] : null;
  const groups = Array.isArray(list) && list.length ? list : defaultWaveGroups(n);
  return { groups, hpScale: waveHpScale(n) };
}

// Rough value of a tower per gold, used by the bot to rank purchases.
function towerPower(def, dmg, rate) {
  let v = dmg * rate;
  if (def.splash) v *= 2.4;
  if (def.chain) v *= 1 + 0.7 + 0.49;
  if (def.targets > 1) v *= def.targets * 0.85;
  if (def.pierce) v *= 2.2;
  if (def.crit) v *= 1 + def.crit * ((def.critMult || 2.5) - 1);
  if (def.slow) v *= 3.2; // slowing multiplies every other tower's damage
  return v;
}

export function simulate(level, { seed = 1, verbose = false } = {}) {
  const rand = rng32(seed);
  const map = level.build();
  const res = validateMap(map);
  if (!res.ok) return { error: res.msg };
  const wps = pathToWaypoints(res.path);
  const cfg = level;
  const S = {
    gold: cfg.gold, lives: cfg.lives, wave: 0, time: 0,
    towers: [], enemies: [], projectiles: [], spawning: [], spawnTimer: 0, waveActive: false,
  };
  const taken = new Set();

  // --- bot helpers ---
  const buildable = [];
  for (let r = 0; r < map.rows; r++)
    for (let c = 0; c < map.cols; c++)
      if (map.grid[r][c] === T.BUILDABLE) buildable.push({ c, r, x: c * TILE_SIZE + 16, y: r * TILE_SIZE + 16 });
  // path samples: waypoint centres, weighted later toward the base
  const coverCache = new Map();
  function coverage(x, y, range, minRange = 0) {
    const k = `${x},${y},${Math.round(range)},${minRange}`;
    let v = coverCache.get(k);
    if (v !== undefined) return v;
    v = 0;
    for (let i = 0; i < wps.length; i++) {
      const d = Math.hypot(wps[i].x - x, wps[i].y - y);
      if (d <= range && d >= minRange) v += 1;
    }
    coverCache.set(k, v);
    return v;
  }
  const upCost = (tw) => Math.round(TOWERS[tw.type].cost * 0.8 * tw.level);
  const counts = () => {
    const m = {};
    for (const t of S.towers) m[t.type] = (m[t.type] || 0) + 1;
    return m;
  };

  function botSpend() {
    for (let guard = 0; guard < 40; guard++) {
      let best = null;
      const have = counts();
      // new towers
      for (const def of Object.values(TOWERS)) {
        if (def.cost > S.gold) continue;
        let spot = null, cov = 0;
        for (const b of buildable) {
          if (taken.has(`${b.c},${b.r}`)) continue;
          const cv = coverage(b.x, b.y, def.range, def.minRange || 0);
          if (cv > cov) { cov = cv; spot = b; }
        }
        if (!spot || cov < 2) continue;
        let score = (towerPower(def, def.dmg, def.rate) * cov) / def.cost;
        if (!have[def.id]) score *= 1.25;          // players like variety
        if (def.slow && (have[def.id] || 0) >= 2) score *= 0.3; // two frosts is plenty
        if (!best || score > best.score) best = { kind: 'build', def, spot, score };
      }
      // upgrades
      for (const tw of S.towers) {
        const cost = upCost(tw);
        if (cost > S.gold) continue;
        const def = TOWERS[tw.type];
        const cov = coverage(tw.x, tw.y, tw.range * 1.08, def.minRange || 0);
        const gain = towerPower(def, tw.dmg * 1.6, Math.min(10, tw.rate * 1.06)) - towerPower(def, tw.dmg, tw.rate);
        const score = (gain * cov) / cost * 1.05;
        if (!best || score > best.score) best = { kind: 'up', tw, cost, score };
      }
      if (!best) return;
      if (best.kind === 'build') {
        const { def, spot } = best;
        S.gold -= def.cost;
        taken.add(`${spot.c},${spot.r}`);
        S.towers.push({ type: def.id, x: spot.x, y: spot.y, dmg: def.dmg, range: def.range, rate: def.rate, cool: 0, level: 1 });
      } else {
        const tw = best.tw;
        S.gold -= best.cost;
        tw.level++;
        tw.dmg *= 1.6; tw.range *= 1.08; tw.rate = Math.min(tw.rate * 1.06, 10);
      }
    }
  }

  // --- combat (same rules as js/game.js) ---
  function makeEnemy(type, x, y, wp, hpScale) {
    const s = ENEMY_STATS[type];
    if (!s) return null;
    return {
      type, x, y, wp, r: s.r, hp: s.hp * hpScale,
      speed: s.speed * (1 + Math.min(0.5, S.wave * 0.01)),
      reward: Math.round(s.reward * (1 + S.wave * 0.03)),
      slowUntil: 0, slowFactor: 1, slowImmune: !!s.slowImmune,
    };
  }
  function startWave() {
    S.wave++;
    const { groups, hpScale } = buildWave(S.wave, cfg.waves);
    const scaled = hpScale * cfg.hpScale;
    for (const g of groups) for (let i = 0; i < g.count; i++) S.spawning.push({ type: g.type, gap: g.gap, hpScale: scaled * (g.hp || 1) });
    S.waveActive = true;
    S.spawnTimer = 0;
  }
  const inRange = (tw, e) => {
    const d = Math.hypot(e.x - tw.x, e.y - tw.y);
    const def = TOWERS[tw.type];
    if (def.minRange && d < def.minRange) return false;
    return d <= tw.range;
  };
  const score = (tw, e) => e.wp * 10000 - Math.hypot(e.x - tw.x, e.y - tw.y);
  function fire(tw, target) {
    const def = TOWERS[tw.type];
    if (def.projectile) {
      S.projectiles.push({ x: tw.x, y: tw.y - 10, tx: target.x, ty: target.y, target, speed: 240, dmg: tw.dmg, splash: def.splash || 60 });
      return;
    }
    if (def.splash) {
      for (const e of S.enemies) if (Math.hypot(e.x - target.x, e.y - target.y) <= def.splash) e.hp -= tw.dmg;
      return;
    }
    if (def.pierce) {
      const dx = target.x - tw.x, dy = target.y - tw.y;
      const aim = Math.hypot(dx, dy) || 1;
      const sx = (dx / aim) * tw.range, sy = (dy / aim) * tw.range;
      const L = sx * sx + sy * sy || 1;
      for (const e of S.enemies) {
        if (e.hp <= 0) continue;
        const t = Math.max(0, Math.min(1, ((e.x - tw.x) * sx + (e.y - tw.y) * sy) / L));
        if (Math.hypot(e.x - (tw.x + sx * t), e.y - (tw.y + sy * t)) <= 12 + (e.r || 0) * 0.5) e.hp -= tw.dmg;
      }
      return;
    }
    if (def.chain) {
      let cur = target, dmg = tw.dmg;
      const hit = new Set();
      for (let i = 0; i < def.chain && cur; i++) {
        cur.hp -= dmg; hit.add(cur); dmg *= 0.7;
        let nb = null, bd = 75;
        for (const e of S.enemies) {
          if (e.hp <= 0 || hit.has(e)) continue;
          const d = Math.hypot(e.x - cur.x, e.y - cur.y);
          if (d < bd) { nb = e; bd = d; }
        }
        cur = nb;
      }
      return;
    }
    let victims = [target];
    if (def.targets > 1) {
      victims = S.enemies.filter((e) => e.hp > 0 && e.wp > 0 && inRange(tw, e))
        .sort((a, b) => score(tw, b) - score(tw, a)).slice(0, def.targets);
    }
    for (const v of victims) {
      let dmg = tw.dmg;
      if (def.crit && rand() < def.crit) dmg *= def.critMult || 2.5;
      v.hp -= dmg;
      if (def.slow && !v.slowImmune) { v.slowUntil = S.time + def.slowDur; v.slowFactor = def.slow; }
    }
  }

  const dt = 1 / 30;
  let nextSpend = 0;
  const maxT = 60 * 60 * 3; // safety: 3h of game time
  while (S.lives > 0 && S.time < maxT) {
    if (!S.waveActive) {
      if (S.wave >= cfg.maxWave) break;
      botSpend();
      startWave();
    }
    S.time += dt;
    if (S.spawning.length) {
      S.spawnTimer -= dt;
      if (S.spawnTimer <= 0) {
        const n = S.spawning.shift();
        const e = makeEnemy(n.type, wps[0].x, wps[0].y, 1, n.hpScale);
        if (e) S.enemies.push(e);
        S.spawnTimer = n.gap;
      }
    }
    for (const e of S.enemies) {
      let sp = e.speed * (S.time < e.slowUntil ? e.slowFactor : 1);
      if (!e.slowImmune) {
        const mc = Math.floor(e.x / TILE_SIZE), mr = Math.floor(e.y / TILE_SIZE);
        if (map.grid[mr]?.[mc] === T.MUD) sp *= MUD_FACTOR;
      }
      let rem = sp * dt;
      while (rem > 0 && e.wp < wps.length) {
        const wp = wps[e.wp];
        const dx = wp.x - e.x, dy = wp.y - e.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.001) { e.wp++; continue; }
        if (d <= rem) { e.x = wp.x; e.y = wp.y; e.wp++; rem -= d; } else { e.x += (dx / d) * rem; e.y += (dy / d) * rem; rem = 0; }
      }
    }
    for (const e of S.enemies) if (e.wp >= wps.length) S.lives -= ENEMY_STATS[e.type]?.leak ?? 2;
    S.enemies = S.enemies.filter((e) => e.wp < wps.length);
    for (const tw of S.towers) {
      tw.cool -= dt;
      if (tw.cool > 0) continue;
      let target = null, bs = -Infinity;
      for (const e of S.enemies) {
        if (e.hp <= 0 || e.wp <= 0 || !inRange(tw, e)) continue;
        const s = score(tw, e);
        if (s > bs) { bs = s; target = e; }
      }
      if (!target) continue;
      tw.cool = 1 / tw.rate;
      fire(tw, target);
    }
    for (const p of S.projectiles) {
      if (p.target && p.target.hp > 0) { p.tx = p.target.x; p.ty = p.target.y; }
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (d <= Math.max(step, 6)) {
        for (const e of S.enemies) if (Math.hypot(e.x - p.tx, e.y - p.ty) <= p.splash) e.hp -= p.dmg;
        p.done = true;
      } else { p.x += (dx / d) * step; p.y += (dy / d) * step; }
    }
    S.projectiles = S.projectiles.filter((p) => !p.done);
    for (const e of S.enemies.filter((e) => e.hp <= 0)) {
      S.gold += e.reward;
      const sod = ENEMY_STATS[e.type]?.spawnOnDeath;
      if (sod) for (let i = 0; i < sod.count; i++) {
        const ch = makeEnemy(sod.type, e.x + (rand() - 0.5) * 12, e.y + (rand() - 0.5) * 12, e.wp, 1);
        if (ch) S.enemies.push(ch);
      }
    }
    S.enemies = S.enemies.filter((e) => e.hp > 0);
    if (S.time >= nextSpend) { botSpend(); nextSpend = S.time + 2; }
    if (S.waveActive && !S.spawning.length && !S.enemies.length && !S.projectiles.length) {
      S.waveActive = false;
      S.gold += 25 + S.wave * 5;
      if (verbose) console.log(`  wave ${S.wave}: lives ${S.lives}, gold ${Math.floor(S.gold)}, towers ${S.towers.length}`);
    }
  }
  const won = S.lives > 0 && S.wave >= cfg.maxWave && !S.waveActive;
  return {
    won, wave: S.wave, lives: Math.max(0, S.lives), maxLives: cfg.lives,
    towers: S.towers.length, levels: S.towers.reduce((a, t) => a + t.level, 0),
    buildable: buildable.length, path: wps.length,
  };
}

// --- calibration ---
// Target share of the bot's Normal capacity per level: 0.5 at the first
// map, +0.06 per world, +0.08 across a world -> 0.88 at the very end.
// Hard (see DIFFS) lands at ~0.85x capacity early and ~1.15x at the end.
export function targetRatio(wi, mapIdx) {
  return 0.5 + 0.06 * wi + 0.08 * (mapIdx / (levels.MAP_COUNT - 1));
}

// Largest toughness multiplier X (on the level's HP ramp) the bot still
// beats on Normal — binary search in log space.
function capacity(w, m) {
  const saved = w.levelHp;
  const arr = Array.isArray(saved) ? [...saved] : Array(levels.MAP_COUNT).fill(1);
  const winsAt = (x) => {
    arr[m] = x;
    w.levelHp = arr;
    return simulate(levels.levelDef(w.id, m, 'normal'), { seed: m * 7 + 1 }).won;
  };
  let lo = 0.25, hi = 1;
  while (winsAt(hi) && hi < 64) { lo = hi; hi *= 2; }
  if (hi === 1 && !winsAt(lo)) { w.levelHp = saved; return lo; }
  for (let i = 0; i < 7; i++) {
    const mid = Math.sqrt(lo * hi);
    if (winsAt(mid)) lo = mid; else hi = mid;
  }
  w.levelHp = saved;
  return lo;
}

// --- CLI ---
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
if (import.meta.url === `file://${process.argv[1]}` && args.includes('--calibrate')) {
  // Writes { worldId: [levelHp x 20] } as JSON to stdout (merge into data/campaign.json).
  const worlds = opt('world') ? levels.WORLDS.filter((w) => w.id === opt('world')) : levels.WORLDS;
  const out = {};
  for (const w of worlds) {
    const wi = levels.WORLDS.indexOf(w);
    out[w.id] = [];
    for (let m = 0; m < levels.MAP_COUNT; m++) {
      const cap = capacity(w, m);
      const v = +(cap * targetRatio(wi, m)).toFixed(3);
      out[w.id].push(v);
      process.stderr.write(`${w.id} ${m + 1}: capacity ${cap.toFixed(2)} -> levelHp ${v}\n`);
    }
  }
  console.log(JSON.stringify(out));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const all = args.includes('--all');
  const worlds = opt('world') ? levels.WORLDS.filter((w) => w.id === opt('world')) : levels.WORLDS;
  const maps = all ? [...Array(levels.MAP_COUNT).keys()] : (opt('maps') || '1,5,10,15,20').split(',').map((n) => +n - 1);
  const diffs = (opt('diffs') || 'easy,normal,hard').split(',');
  const verbose = args.includes('--verbose');
  const summary = {};
  for (const w of worlds) {
    console.log(`\n== ${w.name} ==`);
    for (const m of maps) {
      const row = [];
      let info = null;
      for (const d of diffs) {
        const def = levels.levelDef(w.id, m, d);
        const r = simulate(def, { seed: m * 7 + 1, verbose });
        if (r.error) { row.push(`${d}: ERROR ${r.error}`); continue; }
        info = r;
        const tag = r.won ? `WIN ${String(r.lives).padStart(2)}/${r.maxLives}` : `lost w${r.wave}/${def.maxWave}`;
        row.push(`${d.padEnd(6)} ${tag.padEnd(12)}`);
        (summary[d] ||= { won: 0, n: 0 }).n++;
        if (r.won) summary[d].won++;
      }
      console.log(`${String(m + 1).padStart(2)} ${(levels.archName(m, w.id) || '').padEnd(22)} path ${String(info?.path ?? 0).padStart(3)} build ${String(info?.buildable ?? 0).padStart(3)} | ${row.join(' | ')}`);
    }
  }
  console.log('\nBot win rate:', Object.entries(summary).map(([d, s]) => `${d} ${s.won}/${s.n}`).join(' · '));
}
