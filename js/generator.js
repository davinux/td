// Random map generator for Quick Play: the campaign's map generator
// (js/mapgen.js) with a random biome preset — lattice road, clumpy
// terrain, canyon walls, mud stretches — plus a fresh random seed.
import { validateMap, DEFAULT_SETTINGS } from './model.js';
import { generateMap, QUICK_PRESETS } from './mapgen.js';

export function generateRandomMap(rng = Math.random) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const preset = QUICK_PRESETS[Math.floor(rng() * QUICK_PRESETS.length)];
    const seed = Math.floor(rng() * 1e9);
    const gen = generateMap({ ...preset, seed, cols: 20, rows: 15, prox: 0.1, decor: 0.35, minBuild: 45 });
    const map = {
      name: `${preset.name.toLowerCase()}-${(seed & 0xffff).toString(16).padStart(4, '0')}`,
      cols: gen.cols, rows: gen.rows, grid: gen.grid,
      settings: { ...DEFAULT_SETTINGS },
    };
    if (validateMap(map).ok) return map;
  }
  throw new Error('Random map generator failed (highly unlikely — try again)');
}
