// Towers & enemies catalog, loaded from external files:
// data/towers.json, data/enemies.json (via loadContent()).
// Gameplay, shop and renderers read the live bindings below, so tuning or
// adding entries is a data edit — no code changes needed for stats.
// (New visuals for brand-new ids still need a renderer case; see graphics.js.)

export let TOWERS = {};      // id -> {id,name,cost,range,dmg,rate,color,desc,splash?,slow?,slowDur?,crit?,critMult?,chain?,projectile?,minRange?,pierce?,targets?}
export let ENEMY_STATS = {}; // id -> {id,name,hp,speed,reward,color,r,leak,shape,desc,spawnOnDeath?,slowImmune?}
export let TOWER_ORDER = []; // tower ids in file order (shop + hotkeys)
export let ENEMY_ORDER = [];

export function isContentLoaded() {
  return TOWER_ORDER.length > 0 && ENEMY_ORDER.length > 0;
}

// Weak -> strong orderings, shared by showcases, shop, HUD and hotkeys.
// Towers sort by cost (the catalog's power tier); enemies by threat (hp x speed).
// Computed, so future data/towers.json + data/enemies.json entries slot in.
export function sortedTowers() {
  return TOWER_ORDER.map((id) => TOWERS[id]).sort((a, b) => a.cost - b.cost);
}

export function sortedEnemies() {
  return ENEMY_ORDER.map((id) => ENEMY_STATS[id]).sort((a, b) => (a.hp * a.speed) - (b.hp * b.speed));
}

// Hotkey label for a position in a weak->strong list (1-9 then 0).
export function hotkeyFor(i) {
  return i === 9 ? '0' : String(i + 1);
}

function need(obj, key, where) {
  if (obj[key] === undefined)
    throw new Error(`${where}: entry "${obj.id || '?'}' is missing required field "${key}"`);
}

export async function loadContent(basePath = 'data') {
  let towersRaw, enemiesRaw;
  try {
    const [tRes, eRes] = await Promise.all([
      fetch(`${basePath}/towers.json`),
      fetch(`${basePath}/enemies.json`),
    ]);
    if (!tRes.ok) throw new Error(`HTTP ${tRes.status} for ${basePath}/towers.json`);
    if (!eRes.ok) throw new Error(`HTTP ${eRes.status} for ${basePath}/enemies.json`);
    towersRaw = await tRes.json();
    enemiesRaw = await eRes.json();
  } catch (err) {
    throw new Error(`Could not load tower/enemy data (${err.message}). Play at https://td.davinux.net or serve locally with ./start-server.sh`);
  }

  if (!Array.isArray(towersRaw.towers) || !towersRaw.towers.length)
    throw new Error('data/towers.json: need a non-empty "towers" array');
  if (!Array.isArray(enemiesRaw.enemies) || !enemiesRaw.enemies.length)
    throw new Error('data/enemies.json: need a non-empty "enemies" array');

  const towers = {};
  const order = [];
  for (const t of towersRaw.towers) {
    for (const k of ['id', 'name', 'cost', 'range', 'dmg', 'rate', 'color', 'desc']) need(t, k, 'data/towers.json');
    if (towers[t.id]) throw new Error(`data/towers.json: duplicate id "${t.id}"`);
    towers[t.id] = { ...t };
    order.push(t.id);
  }

  const enemies = {};
  const eorder = [];
  for (const e of enemiesRaw.enemies) {
    for (const k of ['id', 'name', 'hp', 'speed', 'reward', 'color', 'r', 'leak', 'desc']) need(e, k, 'data/enemies.json');
    if (enemies[e.id]) throw new Error(`data/enemies.json: duplicate id "${e.id}"`);
    enemies[e.id] = { shape: e.id, ...e };
    eorder.push(e.id);
  }

  TOWERS = towers;
  ENEMY_STATS = enemies;
  TOWER_ORDER = order;
  ENEMY_ORDER = eorder;
  return { TOWERS, ENEMY_STATS };
}
