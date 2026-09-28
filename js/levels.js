// Campaign: 6 worlds x 20 maps, each playable on 3 difficulties.
// World themes (biome, road style, terrain mix, enemy roster, balance
// curves, map names) live in data/campaign.json. Maps are generated from
// those themes by js/mapgen.js with a fixed seed per level, so every map is
// hand-tunable through data yet identical on every load. Difficulty climbs
// inside each world (shorter roads, less build room, tougher waves) and
// from world to world; Easy / Normal / Hard scale gold, lives, enemy HP,
// counts and spacing. Tune with: node tools/balance.mjs
import { generateMap, mulberry32 } from './mapgen.js';

export const COLS = 20;
export const ROWS = 15;
export const MAP_COUNT = 20;       // playable levels per world

// Loaded store: WORLDS is a live binding populated by loadCampaign().
let store = null;
// Global wave curve (overridable from campaign.json "tuning"):
//   budget  — wave-1 threat budget (threat-cost units, see COST)
//   growth  — linear budget growth per wave; growth2 — quadratic term
//   hpRamp  — scales every world's hpFactor (enemy toughness at the finale)
//   hpCurve — how early the toughness ramps in (lower = earlier)
const TUNING_DEFAULT = { budget: 360, growth: 0.5, growth2: 0.02, hpRamp: 1, hpCurve: 0.85 };
let tuning = { ...TUNING_DEFAULT };
export let WORLDS = [];

export function isLoaded() {
  return !!store;
}

// Fetch the campaign file. Throws with a helpful message when the game
// isn't served over http (e.g. opened via file://).
export async function loadCampaign(basePath = 'data') {
  try {
    const res = await fetch(`${basePath}/campaign.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${basePath}/campaign.json`);
    const data = await res.json();
    const worlds = data && data.worlds;
    if (!Array.isArray(worlds) || !worlds.length) throw new Error('campaign.json has no worlds');
    for (const w of worlds) {
      if (!w.id || !Array.isArray(w.maps) || w.maps.length !== MAP_COUNT)
        throw new Error(`World "${w && w.id}" needs ${MAP_COUNT} map names`);
    }
    tuning = { ...TUNING_DEFAULT, ...(data.tuning || {}) };
    store = worlds;
    WORLDS = store;
    mapCache.clear();
    return store;
  } catch (err) {
    throw new Error(`Could not load campaign data (${err.message}). Play at https://td.davinux.net or serve locally with ./tools/start-server.sh`);
  }
}

function requireStore() {
  if (!store) throw new Error('Campaign data not loaded — call loadCampaign() first');
  return store;
}

// Difficulty presets: economy, enemy toughness, wave size and spacing.
// hp / count may be [first level, last level] ranges over the whole
// campaign: Hard is far tougher than Normal early on (where the base game
// is gentle) and narrows to ~1.3x at the end, where Normal is already tense.
export const DIFFS = {
  easy:   { label: 'Easy',   gold: 1.2,  lives: 5,  hp: [0.85, 0.8], count: 0.92, gap: 1.1,  rank: 1 },
  normal: { label: 'Normal', gold: 1.0,  lives: 0,  hp: 1.0,         count: 1.0,  gap: 1.0,  rank: 2 },
  hard:   { label: 'Hard',   gold: 0.88, lives: -5, hp: [1.5, 1.25], count: [1.15, 1.05], gap: 0.88, rank: 3 },
};
// global campaign progress 0..1 for difficulty ranges
const campaignT = (wi, mapIdx) => (wi * MAP_COUNT + mapIdx) / (MAP_COUNT * Math.max(1, WORLDS.length) - 1);
export const DIFF_IDS = Object.keys(DIFFS);

// [a, b] -> value at t in 0..1 (plain numbers pass through; nested ranges
// like road.length [[min,max] at map 1, [min,max] at map 20] lerp per item).
function at(v, t) {
  if (!Array.isArray(v)) return v;
  if (Array.isArray(v[0])) return v[0].map((a, i) => a + (v[1][i] - a) * t);
  if (v.length === 2 && typeof v[0] === 'number') return v[0] + (v[1] - v[0]) * t;
  return v;
}
const progressT = (mapIdx) => mapIdx / (MAP_COUNT - 1);

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function getWorld(worldId) {
  return WORLDS.find(w => w.id === worldId) || null;
}

export function worldIndex(worldId) {
  return WORLDS.findIndex(w => w.id === worldId);
}

// Map name. worldId defaults to the first world for old callers.
export function archName(mapIdx, worldId) {
  const s = requireStore();
  const w = (worldId && s.find((x) => x.id === worldId)) || s[0];
  return w.maps[mapIdx] || `Map ${mapIdx + 1}`;
}

// --- maps ---
const mapCache = new Map();

function mapOptions(w, mapIdx) {
  const t = progressT(mapIdx);
  const terrain = {};
  for (const [k, v] of Object.entries(w.terrain || {})) terrain[k] = at(v, t);
  return {
    seed: hashStr(w.id) + mapIdx * 7919,
    cols: COLS, rows: ROWS,
    road: {
      length: at(w.road?.length ?? [[60, 66], [44, 50]], t),
      straight: w.road?.straight ?? 0.55,
      turns: w.road?.turns ?? [6, 12],
    },
    river: !!w.river,
    terrain,
    canyon: at(w.canyon ?? 0, t),
    prox: at(w.prox ?? [0.05, 0.22], t),
    decor: at(w.decor ?? [0.3, 0.45], t),
    mud: { patches: Math.round(at(w.mud?.patches ?? 0, t)), len: w.mud?.len ?? [2, 3] },
    minBuild: Math.round(at(w.minBuild ?? 40, t)),
  };
}

// Full map object ({name, cols, rows, grid}) for world/map.
export function buildWorldMap(worldId, mapIdx) {
  const w = getWorld(worldId);
  if (!w || mapIdx < 0 || mapIdx >= MAP_COUNT) throw new Error(`Unknown map ${worldId}:${mapIdx}`);
  const key = `${worldId}:${mapIdx}`;
  let base = mapCache.get(key);
  if (!base) {
    base = generateMap(mapOptions(w, mapIdx));
    mapCache.set(key, base);
  }
  return { name: `${w.name} ${mapIdx + 1}`, cols: base.cols, rows: base.rows, biome: w.id, grid: base.grid.map((r) => [...r]) };
}

// --- waves ---
// Enemy types unlock gradually across the whole campaign (global level
// index), so new foes are introduced one at a time; world weights then set
// each world's flavour. Every wave has a kind (light / rush / mixed / heavy)
// and a threat budget in base-HP units that grows with the wave number;
// the game multiplies HP by the usual per-wave curve on top.
const UNLOCK = { grunt: 0, fast: 1, swarm: 2, shield: 4, wisp: 6, splitter: 9, tank: 12, phantom: 15, golem: 18 };
const KINDS = {
  light: ['grunt', 'swarm', 'splitter'],
  rush: ['fast', 'wisp', 'swarm'],
  mixed: ['grunt', 'fast', 'swarm', 'shield', 'wisp', 'splitter', 'tank', 'phantom', 'golem'],
  heavy: ['shield', 'tank', 'golem', 'phantom', 'splitter'],
};
const GAP = { grunt: 0.7, fast: 0.42, swarm: 0.22, shield: 0.85, wisp: 0.38, splitter: 0.9, tank: 1.2, phantom: 0.62, golem: 1.5, boss: 3 };
// base HP per type (mirrors data/enemies.json; used only to turn a budget
// into head counts, so small drift there is harmless)
const BASE_HP = { grunt: 32, fast: 20, tank: 150, swarm: 14, shield: 95, boss: 1300, wisp: 16, splitter: 60, golem: 320, phantom: 70 };
// Threat cost per head: HP weighted by speed, plus the lives it takes if it
// leaks (splitters also pay for their two mites). Turning a budget into
// counts with this keeps fast fodder from flooding the road.
const COST = {
  grunt: 52, fast: 37, swarm: 26, shield: 106, wisp: 33,
  splitter: 124, tank: 148, phantom: 94, golem: 277, boss: 1300,
};

export function waveCount(worldIdx, mapIdx) {
  return 8 + Math.round(mapIdx * 0.6) + worldIdx; // 8..24
}

function hasBoss(worldIdx, mapIdx) {
  return mapIdx === 9 || mapIdx === 19 || (worldIdx >= 2 && (mapIdx === 4 || mapIdx === 14));
}

export function campaignWaves(worldId, mapIdx, diffId) {
  const wi = worldIndex(worldId);
  const w = WORLDS[wi];
  const d = DIFFS[diffId] || DIFFS.normal;
  const t = progressT(mapIdx);
  const N = waveCount(wi, mapIdx);
  const L = wi * MAP_COUNT + mapIdx;
  const rng = mulberry32(hashStr(`${worldId}:${mapIdx}:waves`));
  const weights = w.enemies || { grunt: 1 };
  const unlocked = Object.keys(UNLOCK).filter((k) => L >= UNLOCK[k] && (weights[k] ?? 0) > 0);
  const base = tuning.budget * at(w.budget ?? 1, t) * at(d.count, campaignT(wi, mapIdx));
  // world toughness ramps in over the level: wave 1 is fair, the finale
  // carries the full multiplier (difficulty HP rides on config.hpScale)
  // levelHp: per-map toughness written by `node tools/balance.mjs --calibrate`
  // so every map sits on a smooth difficulty curve whatever its layout
  const H = at(w.hpFactor ?? 1, t) * tuning.hpRamp * (w.levelHp?.[mapIdx] ?? 1);
  const waves = [];
  for (let n = 1; n <= N; n++) {
    const p = N > 1 ? (n - 1) / (N - 1) : 1;
    const finale = n === N;
    let budget = base * (1 + tuning.growth * (n - 1) + tuning.growth2 * (n - 1) ** 2) * (finale ? 1.3 : 1);
    const hp = +(1 + (H - 1) * Math.pow(p, tuning.hpCurve)).toFixed(3);
    const kind = finale ? 'mixed' : ['light', 'rush', 'mixed', 'heavy'][(n - 1) % 4];
    // wave 1 is always a readable intro: plain grunts
    let pool = n === 1 ? ['grunt'] : KINDS[kind].filter((k) => unlocked.includes(k));
    if (!pool.length) pool = unlocked.length ? unlocked : ['grunt'];
    const groups = [];
    const gapK = d.gap * (1 - 0.3 * p);
    if (finale && hasBoss(wi, mapIdx)) {
      const bosses = 1 + (wi >= 3 && mapIdx === 19 ? 1 : 0) + (diffId === 'hard' && wi >= 4 ? 1 : 0);
      groups.push({ type: 'boss', count: bosses, gap: GAP.boss, hp });
      budget *= 0.55; // escorts
    }
    // weighted pick of 1-3 types without replacement
    const k = Math.min(pool.length, n === 1 ? 1 : 1 + (n >= 3 ? 1 : 0) + (n >= 6 && rng() < 0.6 ? 1 : 0));
    const picks = [];
    const left = [...pool];
    for (let i = 0; i < k; i++) {
      const tot = left.reduce((a, x) => a + weights[x], 0);
      let roll = rng() * tot, idx = 0;
      for (; idx < left.length - 1; idx++) { roll -= weights[left[idx]]; if (roll <= 0) break; }
      picks.push(left.splice(idx, 1)[0]);
    }
    const wsum = picks.reduce((a, x) => a + weights[x], 0);
    for (const type of picks) {
      const share = budget * (weights[type] / wsum);
      const count = Math.max(1, Math.min(45, Math.round(share / COST[type])));
      groups.push({ type, count, gap: +Math.max(0.12, GAP[type] * gapK).toFixed(2), hp });
    }
    // heavies lead, swarms trail: fodder soaks towers behind the tanks
    groups.sort((a, b) => (b.type === 'boss') - (a.type === 'boss') || BASE_HP[b.type] - BASE_HP[a.type]);
    waves.push(groups);
  }
  return waves;
}

// Difficulty-adjusted campaign config for a world/map/difficulty.
export function mapConfig(worldId, mapIdx, diffId) {
  const wi = worldIndex(worldId);
  const w = WORLDS[wi];
  const d = DIFFS[diffId] || DIFFS.normal;
  const t = progressT(mapIdx);
  return {
    maxWave: waveCount(wi, mapIdx),
    hpScale: +at(d.hp, campaignT(wi, mapIdx)).toFixed(3),
    gold: Math.round(at(w.baseGold ?? 220, t) * d.gold),
    lives: Math.max(8, (w.baseLives ?? 20) + d.lives),
  };
}

// Level definition consumable by game.loadLevel().
export function levelDef(worldId, mapIdx, diffId) {
  const w = getWorld(worldId);
  const d = DIFFS[diffId] || DIFFS.normal;
  const cfg = mapConfig(worldId, mapIdx, diffId);
  return {
    id: `${worldId}:${mapIdx}:${diffId}`,
    name: `${w.name} ${mapIdx + 1} · ${archName(mapIdx, worldId)} (${d.label})`,
    ...cfg,
    waves: campaignWaves(worldId, mapIdx, diffId),
    build: () => buildWorldMap(worldId, mapIdx),
  };
}

export function parseLevelId(id) {
  const [worldId, mapIdx, diffId] = (id || '').split(':');
  return { worldId, mapIdx: +(mapIdx || 0), diffId: diffId || 'normal' };
}

// --- progress: done["world:idx"] = best rank (1 easy, 2 normal, 3 hard) ---
const PROG_KEY = 'tfgame.progress.v1';

export function loadProgress() {
  try {
    const raw = localStorage.getItem(PROG_KEY);
    if (!raw) return { done: {} };
    // migrate legacy {unlocked, done:{levelId:true}} shape; preserve new numeric ranks
    const p = JSON.parse(raw);
    const done = {};
    for (const [id, v] of Object.entries((p && p.done) || {})) {
      if (!v) continue;
      if (typeof v === 'number') {
        const [w, m] = id.split(':');
        if (getWorld(w)) done[`${w}:${+m || 0}`] = Math.min(3, Math.max(1, v));
      } else if (id.includes(':')) {
        const [w, m] = id.split(':');
        if (getWorld(w)) done[`${w}:${+m || 0}`] = 2;
      } else if (getWorld(id)) {
        done[`${id}:0`] = 2; // old single-level campaigns -> first map, Normal
      }
    }
    return { done };
  } catch {
    return { done: {} };
  }
}

export function saveProgress(p) {
  localStorage.setItem(PROG_KEY, JSON.stringify(p));
}

// Record completion at a difficulty; keeps the best rank.
export function completeMap(worldId, mapIdx, diffId) {
  const p = loadProgress();
  const key = `${worldId}:${mapIdx}`;
  const rank = (DIFFS[diffId] || DIFFS.normal).rank;
  p.done[key] = Math.max(p.done[key] || 0, rank);
  saveProgress(p);
  return p;
}

export function bestRank(worldId, mapIdx) {
  return loadProgress().done[`${worldId}:${mapIdx}`] || 0;
}

export function isMapUnlocked(worldId, mapIdx) {
  if (mapIdx === 0) return isWorldUnlocked(worldId);
  return (loadProgress().done[`${worldId}:${mapIdx - 1}`] || 0) > 0;
}

export function isWorldUnlocked(worldId) {
  const wi = worldIndex(worldId);
  if (wi <= 0) return true;
  const prev = WORLDS[wi - 1].id;
  return (loadProgress().done[`${prev}:${MAP_COUNT - 1}`] || 0) > 0;
}

// "★★☆" style: filled = difficulties completed at or below best rank.
export function rankStars(rank) {
  return '★'.repeat(rank) + '☆'.repeat(3 - rank);
}
