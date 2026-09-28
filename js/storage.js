// localStorage persistence for maps.
import { demoMap } from './model.js';

const KEY = 'tfgame.maps.v1';

export function loadAllMaps() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const seed = { demo: demoMap() };
      localStorage.setItem(KEY, JSON.stringify(seed));
      return seed;
    }
    return JSON.parse(raw);
  } catch {
    return { demo: demoMap() };
  }
}

export function saveAllMaps(all) {
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function saveMap(map) {
  const all = loadAllMaps();
  all[map.name] = map;
  saveAllMaps(all);
  return all;
}

export function deleteMap(name) {
  const all = loadAllMaps();
  delete all[name];
  saveAllMaps(all);
  return all;
}
