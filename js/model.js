// Shared map model: tiles, validation, pathfinding.
export const T = {
  BUILDABLE: 0,
  PATH: 1,
  BLOCKED: 2,
  SPAWN: 3,
  BASE: 4,
  // Decorative variants: look different, behave exactly like BLOCKED
  // (no building, no walking).
  WATER: 5,
  FOREST: 6,
  ROCK: 7,
  // Gameplay tile: walkable road that slows enemies crossing it.
  MUD: 8,
};

// Enemies on mud move at this fraction of their speed (frost-style slow,
// so slow-immune enemies are unaffected — same promise as Frost towers).
export const MUD_FACTOR = 0.55;

// Clamp any foreign value (hand-edited JSON, older saves) to a known tile.
// Unknown ids become BLOCKED: never walkable, never buildable — the safe
// choice that can neither open shortcuts nor grant tower spots.
export function sanitizeTile(v) {
  return Number.isInteger(v) && v >= 0 && v <= 8 ? v : T.BLOCKED;
}

export function sanitizeGrid(grid) {
  return grid.map((row) => row.map(sanitizeTile));
}

export const TILE_SIZE = 32;

export function createGrid(cols, rows, fill = T.BUILDABLE) {
  return Array.from({ length: rows }, () => Array(cols).fill(fill));
}

export function cloneMap(map) {
  const out = { name: map.name, cols: map.cols, rows: map.rows, grid: sanitizeGrid(map.grid.map(r => [...r])) };
  if (map.settings) out.settings = { ...sanitizeSettings(map.settings) };
  if (typeof map.biome === 'string') out.biome = map.biome; // ground palette
  return out;
}

// --- per-map game settings (editable in the Map Editor) ---
// Waves themselves stay procedural (buildWave scales with wave number);
// the map controls the run rules: starting gold, lives, wave count and
// enemy strength multiplier.
export const DEFAULT_SETTINGS = { gold: 220, lives: 20, maxWave: 20, hpScale: 1 };

const clampNum = (v, lo, hi, fb) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
};

export function sanitizeSettings(s = {}) {
  return {
    gold: Math.round(clampNum(s.gold, 0, 9999, DEFAULT_SETTINGS.gold)),
    lives: Math.round(clampNum(s.lives, 1, 999, DEFAULT_SETTINGS.lives)),
    maxWave: Math.round(clampNum(s.maxWave, 1, 100, DEFAULT_SETTINGS.maxWave)),
    hpScale: Math.round(clampNum(s.hpScale, 0.1, 5, DEFAULT_SETTINGS.hpScale) * 100) / 100,
    waves: sanitizeWaves(s.waves),
  };
}

// --- custom wave lists (per-wave enemy compositions) ---
// waves = array indexed by wave-1; each wave = array of {type, count, gap}.
// Absent (null) = classic procedural curve. Present = custom groups for the
// listed waves; the procedural HP scale still applies on top.
export const CUSTOM_GAP = 0.6;

export function sanitizeWaveGroup(g) {
  if (!g || typeof g.type !== 'string' || !g.type) return null;
  const count = Math.round(clampNum(g.count, 1, 500, 0));
  if (!count) return null;
  return { type: g.type, count, gap: clampNum(g.gap, 0.05, 5, CUSTOM_GAP) };
}

export function sanitizeWaves(waves) {
  if (waves == null) return null; // custom list disabled
  if (!Array.isArray(waves)) return null;
  // Unknown enemy ids are kept (data may simply not be loaded in the
  // editor yet); the game skips unknown ids at spawn time.
  return waves.slice(0, 100).map((w) =>
    (Array.isArray(w) ? w : []).slice(0, 20).map(sanitizeWaveGroup).filter(Boolean)
  );
}

// Wave numbers (1-based) whose custom list exists but holds no valid groups.
export function customWaveProblems(settings) {
  const out = [];
  if (!settings || !Array.isArray(settings.waves)) return out;
  const n = Math.min(settings.maxWave || settings.waves.length, settings.waves.length);
  for (let i = 0; i < n; i++) {
    if (!settings.waves[i] || !settings.waves[i].length) out.push(i + 1);
  }
  return out;
}

// Procedural difficulty scale for wave n (1-indexed). Applies to custom
// waves too — custom lists change composition, not the power curve.
export function waveHpScale(n) {
  return 1 + (n - 1) * 0.18 + Math.max(0, n - 10) * 0.12;
}

// Default composition for wave n (1-indexed) -> list of {type, count, gap}.
// Used by the game when no custom list exists, and by the editor to seed
// the composer and to "Reset to default curve".
export function defaultWaveGroups(n) {
  const groups = [];
  const push = (type, count, gap = 0.7) => groups.push({ type, count, gap });
  if (n <= 20) {
    push('grunt', 5 + n * 2, 0.8);
    if (n >= 2) push('wisp', 1 + Math.floor(n / 2), 0.45);
    if (n >= 3) push('fast', 2 + n, 0.5);
    if (n >= 4) push('shield', 2 + Math.floor(n / 2), 0.9);
    if (n >= 5) push('swarm', 4 + n * 2, 0.25);
    if (n >= 6 && n % 2 === 0) push('tank', Math.floor(n / 3), 1.2);
    if (n >= 6) push('splitter', Math.floor(n / 3), 1.0);
    if (n >= 7) {
      push('phantom', Math.floor(n / 2), 0.7);
      if (n % 2 === 1) push('golem', 1 + Math.floor((n - 7) / 4), 1.5);
    }
    if (n >= 10) push('fast', n, 0.35);
    if (n === 10 || n === 20) push('boss', n === 20 ? 2 : 1, 2.0);
  } else {
    push('grunt', 15 + n, 0.5);
    push('fast', 10 + n, 0.3);
    push('wisp', 8 + Math.floor(n / 2), 0.3);
    push('shield', 6 + Math.floor(n / 2), 0.5);
    push('tank', Math.floor(n / 2), 0.8);
    push('splitter', Math.floor(n / 3), 0.7);
    push('phantom', Math.floor(n / 2), 0.5);
    push('golem', Math.floor(n / 6), 1.2);
    push('swarm', 20 + n, 0.15);
    if (n % 5 === 0) push('boss', Math.floor(n / 10), 2.0);
  }
  return groups;
}

// Merged, valid settings for any map (old saves without settings get defaults).
export function getSettings(map) {
  return sanitizeSettings(map?.settings || {});
}

// Demo map: S-shaped road.
export function demoMap() {
  const cols = 20, rows = 15;
  const grid = createGrid(cols, rows, T.BUILDABLE);
  const paint = (c, r, v) => { grid[r][c] = v; };
  // horizontal corridors
  for (let c = 0; c <= 16; c++) paint(c, 2, T.PATH);
  for (let r = 2; r <= 6; r++) paint(16, r, T.PATH);
  for (let c = 3; c <= 16; c++) paint(c, 6, T.PATH);
  for (let r = 6; r <= 10; r++) paint(3, r, T.PATH);
  for (let c = 3; c <= 19; c++) paint(c, 10, T.PATH);
  paint(0, 2, T.SPAWN);
  // connect spawn to road start
  paint(19, 10, T.BASE);
  // some rocks, water and forest for variety
  paint(5, 4, T.ROCK); paint(6, 4, T.BLOCKED);
  paint(10, 8, T.WATER); paint(11, 8, T.WATER); paint(10, 9, T.FOREST);
  paint(14, 12, T.FOREST); paint(15, 4, T.ROCK);
  // a muddy stretch on the road: enemies crawl through here
  paint(8, 6, T.MUD); paint(9, 6, T.MUD);
  return { name: 'demo', cols, rows, grid, settings: { ...DEFAULT_SETTINGS } };
}

export function findTiles(map, type) {
  const out = [];
  for (let r = 0; r < map.rows; r++)
    for (let c = 0; c < map.cols; c++)
      if (map.grid[r][c] === type) out.push({ c, r });
  return out;
}

const WALKABLE = new Set([T.PATH, T.SPAWN, T.BASE, T.MUD]);

export function validateMap(map) {
  const spawns = findTiles(map, T.SPAWN);
  const bases = findTiles(map, T.BASE);
  if (spawns.length !== 1) return { ok: false, msg: `Need exactly 1 Spawn (found ${spawns.length}).` };
  if (bases.length !== 1) return { ok: false, msg: `Need exactly 1 Base (found ${bases.length}).` };
  const path = findPath(map);
  if (!path) return { ok: false, msg: 'Spawn and Base are not connected by Path tiles.' };
  // check for orphan path tiles not reachable
  const reachable = new Set(path.map(p => `${p.c},${p.r}`));
  // BFS full reachable region
  const q = [spawns[0]];
  const seen = new Set([`${spawns[0].c},${spawns[0].r}`]);
  while (q.length) {
    const cur = q.pop();
    for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nc = cur.c + dc, nr = cur.r + dr;
      if (nc < 0 || nr < 0 || nc >= map.cols || nr >= map.rows) continue;
      if (!WALKABLE.has(map.grid[nr][nc])) continue;
      const k = `${nc},${nr}`;
      if (!seen.has(k)) { seen.add(k); q.push({ c: nc, r: nr }); }
    }
  }
  for (let r = 0; r < map.rows; r++)
    for (let c = 0; c < map.cols; c++)
      if (WALKABLE.has(map.grid[r][c]) && !seen.has(`${c},${r}`))
        return { ok: false, msg: `Orphan path tile at (${c},${r}). All road must connect Spawn→Base.` };
  void reachable;
  return { ok: true, msg: `Valid! Path length ${path.length} tiles.`, path };
}

// BFS shortest path spawn -> base over walkable tiles.
export function findPath(map) {
  const spawns = findTiles(map, T.SPAWN);
  const bases = findTiles(map, T.BASE);
  if (spawns.length !== 1 || bases.length !== 1) return null;
  const start = spawns[0], goal = bases[0];
  const key = (c, r) => `${c},${r}`;
  const prev = new Map();
  const visited = new Set([key(start.c, start.r)]);
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    if (cur.c === goal.c && cur.r === goal.r) {
      const path = [cur];
      let k = key(cur.c, cur.r);
      while (prev.has(k)) {
        const p = prev.get(k);
        path.unshift(p);
        k = key(p.c, p.r);
      }
      return path;
    }
    for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nc = cur.c + dc, nr = cur.r + dr;
      if (nc < 0 || nr < 0 || nc >= map.cols || nr >= map.rows) continue;
      if (!WALKABLE.has(map.grid[nr][nc])) continue;
      const k = key(nc, nr);
      if (visited.has(k)) continue;
      visited.add(k);
      prev.set(k, cur);
      q.push({ c: nc, r: nr });
    }
  }
  return null;
}

// Pixel waypoints (centers) for enemies to follow.
export function pathToWaypoints(path) {
  return path.map(p => ({
    x: p.c * TILE_SIZE + TILE_SIZE / 2,
    y: p.r * TILE_SIZE + TILE_SIZE / 2,
  }));
}
