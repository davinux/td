// Procedural map generator shared by the campaign (seeded, deterministic)
// and Quick Play (random). Pure: no DOM, no game state.
//
// Road: a self-avoiding walk on a 2-tile lattice (nodes on even cells).
// Parallel stretches therefore always keep a buildable strip between them,
// and road cells only touch where the walk actually connects them — so the
// BFS in model.findPath follows the exact road, no accidental shortcuts.
//
// Terrain: value-noise fields thresholded by quantile, so every layer gets
// an exact coverage target and forms natural clumps (groves, lakes, boulder
// fields, slate ridges). Optional rivers (noise bands), canyon walls that
// hug the road, and mud stretches painted onto the road itself.
import { T, createGrid } from './model.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// --- road: lattice walk -------------------------------------------------
function walkOnce(rng, NX, NY, start, nMax, straight) {
  const key = (x, y) => y * NX + x;
  const seen = new Set([key(start[0], start[1])]);
  const path = [start];
  let dir = null;
  const free = (x, y) => x >= 0 && y >= 0 && x < NX && y < NY && !seen.has(key(x, y));
  const exits = (x, y) => DIRS.reduce((n, [dx, dy]) => n + (free(x + dx, y + dy) ? 1 : 0), 0);
  while (path.length < nMax) {
    const [x, y] = path[path.length - 1];
    const opts = [];
    DIRS.forEach(([dx, dy], di) => {
      const nx = x + dx, ny = y + dy;
      if (!free(nx, ny)) return;
      seen.add(key(nx, ny));
      const ex = exits(nx, ny);
      seen.delete(key(nx, ny));
      if (ex === 0 && path.length + 1 < nMax) return; // dead end
      let w = 1 + rng() * 0.8;
      if (dir === di) w += straight * 2.2;
      w += (ex === 1 ? 0.12 : 0); // a touch of wall-hugging keeps long walks alive
      const edge = nx === 0 || ny === 0 || nx === NX - 1 || ny === NY - 1;
      if (edge) w *= 0.55; // but prefer crossing the interior
      opts.push({ nx, ny, di, w });
    });
    if (!opts.length) break;
    let pick = opts[0];
    const tot = opts.reduce((a, o) => a + o.w, 0);
    let roll = rng() * tot;
    for (const o of opts) { roll -= o.w; if (roll <= 0) { pick = o; break; } }
    seen.add(key(pick.nx, pick.ny));
    path.push([pick.nx, pick.ny]);
    dir = pick.di;
  }
  return path;
}

function turnsOf(path) {
  let t = 0;
  for (let i = 2; i < path.length; i++) {
    const a = [path[i - 1][0] - path[i - 2][0], path[i - 1][1] - path[i - 2][1]];
    const b = [path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]];
    if (a[0] !== b[0] || a[1] !== b[1]) t++;
  }
  return t;
}

// Best of many walks: close to the target length, well spread, base far
// from the portal, turn count in the requested band.
function makeRoad(rng, cols, rows, { length = [48, 60], straight = 0.55, turns = [5, 12] } = {}) {
  const NX = Math.floor((cols - 1) / 2) + 1;
  const NY = Math.floor((rows - 1) / 2) + 1;
  const target = length[0] + rng() * (length[1] - length[0]);
  const nTarget = Math.round((target + 1) / 2);
  let best = null;
  for (let attempt = 0; attempt < 260; attempt++) {
    const side = Math.floor(rng() * 3); // left, top, bottom edges
    const start = side === 0 ? [0, 1 + Math.floor(rng() * (NY - 2))]
      : side === 1 ? [1 + Math.floor(rng() * (NX - 2)), 0]
        : [1 + Math.floor(rng() * (NX - 2)), NY - 1];
    const p = walkOnce(rng, NX, NY, start, nTarget + 2, straight);
    if (p.length < nTarget - 3) continue;
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    const spread = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1) / (NX * NY);
    const [ex, ey] = p[p.length - 1];
    const far = Math.abs(ex - start[0]) + Math.abs(ey - start[1]);
    const tn = turnsOf(p);
    const turnPen = tn < turns[0] ? turns[0] - tn : tn > turns[1] ? tn - turns[1] : 0;
    // reach: share of lattice nodes within 1 step of the road (the whole
    // map is in play); border: share of road nodes stuck on the rim
    const onRoad = new Set(p.map(([x, y]) => y * NX + x));
    let reach = 0;
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (onRoad.has((y + dy) * NX + (x + dx)) && x + dx >= 0 && x + dx < NX) { near = true; break; }
      }
      if (near) reach++;
    }
    reach /= NX * NY;
    const border = p.filter(([x, y]) => x === 0 || y === 0 || x === NX - 1 || y === NY - 1).length / p.length;
    const score = -Math.abs(p.length - nTarget) * 2 + spread * 4 + reach * 14 - border * 6
      + Math.min(far, 8) * 0.5 - turnPen * 1.5;
    if (!best || score > best.score) best = { p, score };
  }
  // rasterize nodes + edge midpoints
  const cells = [];
  best.p.forEach(([x, y], i) => {
    if (i > 0) {
      const [px, py] = best.p[i - 1];
      cells.push([px + x, py + y]); // midpoint in cell coords: (2px+2x)/2
    }
    cells.push([x * 2, y * 2]);
  });
  return cells;
}

// --- value noise --------------------------------------------------------
function noiseField(rng, cols, rows, scale) {
  const gx = Math.ceil(cols / scale) + 2, gy = Math.ceil(rows / scale) + 2;
  const g = Array.from({ length: gy }, () => Array.from({ length: gx }, () => rng()));
  const s = (t) => t * t * (3 - 2 * t);
  const field = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const fx = c / scale, fy = r / scale;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = s(fx - x0), ty = s(fy - y0);
      const a = g[y0][x0] + (g[y0][x0 + 1] - g[y0][x0]) * tx;
      const b = g[y0 + 1][x0] + (g[y0 + 1][x0 + 1] - g[y0 + 1][x0]) * tx;
      row.push(a + (b - a) * ty);
    }
    field.push(row);
  }
  return field;
}
function fbm(rng, cols, rows, scale) {
  const a = noiseField(rng, cols, rows, scale);
  const b = noiseField(rng, cols, rows, Math.max(1.5, scale / 2));
  return a.map((row, r) => row.map((v, c) => v * 0.68 + b[r][c] * 0.32));
}

// --- full map -------------------------------------------------------------
// opts: {
//   seed, cols, rows,
//   road: { length: [min,max] tiles, straight: 0..1, turns: [min,max] },
//   terrain: { water, forest, rock, cliff } — fractions of off-road tiles,
//   river: bool (water as winding bands instead of lakes),
//   canyon: 0..1 — share of road-adjacent tiles walled by rock/cliff,
//   prox: 0..0.4 — pull terrain toward the road (fewer good tower spots),
//   decor: 0..1 — scenery density on tiles far (> 3) from the road,
//   mud: { patches, len: [min,max] },
//   minBuild: buildable tiles required within 2 tiles of the road
// }
export function generateMap(opts = {}) {
  const cols = opts.cols || 20, rows = opts.rows || 15;
  const rng = mulberry32(opts.seed ?? Math.floor(Math.random() * 1e9));
  const road = makeRoad(rng, cols, rows, opts.road);
  const roadSet = new Set(road.map(([c, r]) => `${c},${r}`));
  const nearRoad = (c, r, d) => {
    for (let dr = -d; dr <= d; dr++)
      for (let dc = -d; dc <= d; dc++)
        if (roadSet.has(`${c + dc},${r + dr}`)) return true;
    return false;
  };
  const fields = {
    water: fbm(rng, cols, rows, opts.river ? 5 : 4.5),
    cliff: fbm(rng, cols, rows, 3.5),
    rock: fbm(rng, cols, rows, 2.8),
    forest: fbm(rng, cols, rows, 3.2),
  };
  if (opts.river) {
    fields.water = fields.water.map((row) => row.map((v) => 1 - Math.abs(v - 0.5) * 2));
  }
  const terrain = { water: 0, forest: 0, rock: 0, cliff: 0, ...(opts.terrain || {}) };
  const canyon = opts.canyon || 0;
  const prox = opts.prox ?? 0.1;
  const minBuild = opts.minBuild ?? 0;
  const TILE = { water: T.WATER, forest: T.FOREST, rock: T.ROCK, cliff: T.BLOCKED };

  let grid, shrink = 1;
  for (let tries = 0; tries < 8; tries++, shrink *= 0.82) {
    grid = createGrid(cols, rows, T.BUILDABLE);
    for (const [c, r] of road) grid[r][c] = T.PATH;
    const offRoad = cols * rows - road.length;
    for (const layer of ['water', 'cliff', 'rock', 'forest']) {
      const want = Math.round(terrain[layer] * shrink * offRoad);
      if (want <= 0) continue;
      const cand = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (grid[r][c] !== T.BUILDABLE) continue;
          let v = fields[layer][r][c];
          // canyon walls: rock / cliff love the road's shoulders
          if ((layer === 'rock' || layer === 'cliff') && canyon > 0 && nearRoad(c, r, 1)) v += canyon * 0.6;
          // water and forest keep a little off the road so the road stays readable
          if ((layer === 'water' || layer === 'forest') && nearRoad(c, r, 1)) v -= 0.12;
          // terrain that matters: favour the road's surroundings, where it
          // actually steals tower spots (grows with the level via `prox`)
          else if (prox > 0 && nearRoad(c, r, 3)) v += prox;
          cand.push({ c, r, v });
        }
      }
      cand.sort((a, b) => b.v - a.v);
      for (let i = 0; i < Math.min(want, cand.length); i++) grid[cand[i].r][cand[i].c] = TILE[layer];
    }
    let spots = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (grid[r][c] === T.BUILDABLE && nearRoad(c, r, 2)) spots++;
    if (spots >= minBuild) break;
  }

  // Scenery far from the road (> 3 tiles): no gameplay impact there, so
  // dress it generously with the biome's own layers, continuing the same
  // noise clumps. `decor` = share of those far tiles to fill.
  const decor = opts.decor ?? 0.35;
  const layers = Object.keys(terrain).filter((k) => terrain[k] > 0);
  if (decor > 0 && layers.length) {
    const far = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (grid[r][c] === T.BUILDABLE && !nearRoad(c, r, 3)) {
          // strongest biome layer here, weighted by how common it should be
          let bestL = null, bv = -Infinity;
          for (const k of layers) {
            const v = fields[k][r][c] + Math.log(terrain[k] + 0.01) * 0.12;
            if (v > bv) { bv = v; bestL = k; }
          }
          far.push({ c, r, v: bv, layer: bestL });
        }
    far.sort((a, b) => b.v - a.v);
    const n = Math.round(far.length * decor);
    for (let i = 0; i < n; i++) grid[far[i].r][far[i].c] = TILE[far[i].layer];
  }

  // mud stretches on the road (never on the first/last few tiles)
  const mud = opts.mud || { patches: 0 };
  const lo = 4, hi = road.length - 4;
  if (mud.patches > 0 && hi - lo > 6) {
    const span = (hi - lo) / mud.patches;
    for (let k = 0; k < mud.patches; k++) {
      const len = (mud.len?.[0] ?? 2) + Math.floor(rng() * ((mud.len?.[1] ?? 3) - (mud.len?.[0] ?? 2) + 1));
      const at = Math.floor(lo + span * k + rng() * Math.max(1, span - len));
      for (let i = at; i < Math.min(hi, at + len); i++) grid[road[i][1]][road[i][0]] = T.MUD;
    }
  }
  const [sc, sr] = road[0];
  const [bc, br] = road[road.length - 1];
  grid[sr][sc] = T.SPAWN;
  grid[br][bc] = T.BASE;
  return { cols, rows, grid, roadLength: road.length };
}

// Quick Play biome presets (campaign worlds define their own in data).
export const QUICK_PRESETS = [
  { name: 'Meadow', road: { length: [50, 64], straight: 0.55 }, terrain: { forest: 0.12, water: 0.06, rock: 0.03 }, mud: { patches: 1, len: [2, 3] } },
  { name: 'Lakeside', road: { length: [46, 60], straight: 0.6 }, river: true, terrain: { water: 0.14, forest: 0.08, rock: 0.02 }, mud: { patches: 1, len: [2, 3] } },
  { name: 'Canyon', road: { length: [40, 54], straight: 0.7 }, terrain: { rock: 0.1, cliff: 0.1, forest: 0.03 }, canyon: 0.45 },
  { name: 'Marsh', road: { length: [44, 58], straight: 0.45 }, terrain: { water: 0.1, forest: 0.1 }, mud: { patches: 3, len: [2, 4] } },
];
