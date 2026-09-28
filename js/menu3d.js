// Animated 3D diorama behind the main menu: a showcase map with sample
// towers and enemies roaming the road, slow auto-orbit. Decorative only —
// no picking, no game state. Reuses the exact builders as the game view.
import { loadThree, buildTowerMesh, buildEnemyMesh, createTerrain, animateEnemy, animateTower } from './view3d.js';
import { setupLighting } from './art3d.js';
import { demoMap, findPath, pathToWaypoints, TILE_SIZE, T } from './model.js';
import { buildWorldMap, isLoaded as isCampaignLoaded } from './levels.js';
import { TOWERS, ENEMY_STATS, TOWER_ORDER, ENEMY_ORDER, isContentLoaded } from './content.js';

const FALLBACK_TOWERS = [
  { id: 'arrow', color: '#fbbf24' }, { id: 'cannon', color: '#fb923c' },
  { id: 'frost', color: '#67e8f9' }, { id: 'tesla', color: '#fde047' },
  { id: 'gatling', color: '#e2e8f0' },
];
const FALLBACK_ENEMIES = [
  { id: 'grunt', shape: 'brute', color: '#4ade80', r: 9 },
  { id: 'fast', shape: 'dart', color: '#f472b6', r: 7 },
  { id: 'tank', shape: 'armor', color: '#f87171', r: 12 },
  { id: 'swarm', shape: 'beetle', color: '#a3e635', r: 6 },
  { id: 'shield', shape: 'guardian', color: '#60a5fa', r: 10 },
  { id: 'boss', shape: 'warlord', color: '#a855f7', r: 16 },
];

export function createMenuBackdrop(container) {
  let THREE = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let running = false;
  let rafId = 0;
  let built = false;
  let yaw = 0.6;
  let last = 0;
  let spinners = [];
  let terrainTick = null;
  let walkers = [];
  let wps = [];
  let cum = [0];
  let total = 1;
  let ox = 0, oz = 0;
  let fitDist = 900;

  async function ensure() {
    if (built) return;
    THREE = await loadThree();
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0); // hero gradient shows through
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.pointerEvents = 'none';
    container.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b1120, 1700, 4500);
    camera = new THREE.PerspectiveCamera(50, 1, 1, 9000);
    const lights = setupLighting(scene, renderer, { shadows: true });

    // showcase map: spiral campaign map when data is ready, else demo
    let map;
    try {
      map = isCampaignLoaded() ? buildWorldMap('meadow', 5) : demoMap();
    } catch {
      map = demoMap();
    }
    const terrain = createTerrain(map);
    scene.add(terrain);
    terrainTick = terrain.userData.tick;
    lights.fit(Math.max(map.cols, map.rows) * TILE_SIZE);

    ox = -map.cols * TILE_SIZE / 2;
    oz = -map.rows * TILE_SIZE / 2;
    fitDist = Math.max(map.cols, map.rows) * TILE_SIZE * 1.12;
    const pathTiles = findPath(map);
    wps = pathToWaypoints(pathTiles);
    cum = [0];
    for (let i = 1; i < wps.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(wps[i].x - wps[i - 1].x, wps[i].y - wps[i - 1].y));
    }
    total = cum[cum.length - 1] || 1;

    // sample towers on buildable tiles beside the road
    const taken = new Set();
    const towerDefs = isContentLoaded()
      ? TOWER_ORDER.map((id) => ({ id, color: TOWERS[id].color }))
      : FALLBACK_TOWERS;
    const step = Math.max(2, Math.floor(pathTiles.length / 8));
    let placed = 0;
    for (let i = 4; i < pathTiles.length - 2 && placed < 5; i += step) {
      const t = pathTiles[i];
      const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dc, dr]) => [t.c + dc, t.r + dr])
        .find(([c, r]) => c >= 0 && r >= 0 && c < map.cols && r < map.rows
          && map.grid[r][c] === T.BUILDABLE && !taken.has(`${c},${r}`));
      if (!spot) continue;
      taken.add(`${spot[0]},${spot[1]}`);
      const td = towerDefs[placed % towerDefs.length];
      const mesh = buildTowerMesh(td.id, parseInt(td.color.slice(1), 16));
      mesh.position.set(ox + (spot[0] + 0.5) * TILE_SIZE, 0, oz + (spot[1] + 0.5) * TILE_SIZE);
      mesh.rotation.y = -Math.PI / 2 + placed * 0.7;
      scene.add(mesh);
      spinners.push({ obj: mesh.userData.head, speed: 0.0025 + placed * 0.0008, tower: mesh });
      placed++;
    }

    // roaming enemies looping the road
    const enemyDefs = isContentLoaded()
      ? ENEMY_ORDER.map((id) => ENEMY_STATS[id])
      : FALLBACK_ENEMIES;
    for (let i = 0; i < 6; i++) {
      const def = enemyDefs[i % enemyDefs.length];
      const e = { type: def.id, shape: def.shape || def.id, color: def.color, r: def.r, seed: 1.3 + i };
      const group = buildEnemyMesh(e);
      group.userData.slow.visible = false;
      group.userData.bars.visible = false;
      scene.add(group);
      walkers.push({
        group,
        speed: 42 + (i % 4) * 11,
        offset: (total / 6) * i,
        seed: e.seed,
      });
    }

    new ResizeObserver(resize).observe(container);
    resize();
    built = true;
  }

  function resize() {
    if (!renderer) return;
    const w = Math.max(50, container.clientWidth || window.innerWidth);
    const h = Math.max(50, container.clientHeight || window.innerHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    // Wide hero: slide the diorama right so the title overlay sits on open
    // sky at the left. Narrow (phone) layouts keep it centred.
    if (w > 700) camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  function placeWalker(w, dist, t) {
    const d = ((dist % total) + total) % total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const a = wps[i - 1], b = wps[i];
    const seg = cum[i] - cum[i - 1] || 1;
    const f = (d - cum[i - 1]) / seg;
    w.group.position.set(ox + a.x + (b.x - a.x) * f, 0, oz + a.y + (b.y - a.y) * f);
    w.group.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
    animateEnemy(w.group, t);
  }

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const t = now / 1000;
    const dt = Math.min(0.05, t - (last || t));
    last = t;
    yaw += dt * 0.07;
    camera.position.set(
      fitDist * Math.cos(0.95) * Math.cos(yaw),
      fitDist * Math.sin(0.95),
      fitDist * Math.cos(0.95) * Math.sin(yaw)
    );
    camera.lookAt(0, 0, 0);
    for (const s of spinners) {
      s.obj.rotation.y += s.speed;
      if (s.tower) animateTower(s.tower, t, false);
    }
    terrainTick?.(t);
    for (const w of walkers) placeWalker(w, t * w.speed + w.offset, t);
    renderer.render(scene, camera);
  }

  return {
    async start() {
      await ensure();
      if (running) return;
      running = true;
      last = 0;
      resize();
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
  };
}
