// 3D view of the tower defense game (Three.js, vendored locally so the game
// — including offline PWA play — never depends on a CDN).
// Reads the live game state (game.getState()) and renders it in 3D.
// Interaction (hover range preview, click to place/select) is forwarded
// to the game via game.interact() / game.setHoverTile().
import { T, TILE_SIZE } from './model.js';
import { TOWERS } from './content.js';

import {
  THREE, loadThree as loadThreeCore, setupLighting, gradientBackground, std, glow,
} from './art3d.js';
import { createTerrain, PATH_TOP } from './terrain3d.js';
import { buildTowerMesh, setTowerLevel, animateTower, flashTower } from './towers3d.js';
import { buildEnemyMesh, animateEnemy, flashEnemy } from './enemies3d.js';
import { createFx, createRangeIndicator, createCoverage } from './fx3d.js';

// Builders live in art3d / terrain3d / towers3d / enemies3d; re-exported
// here so every scene keeps importing from one place.
export { createTerrain, buildTowerMesh, setTowerLevel, buildEnemyMesh, animateEnemy, animateTower, flashTower, flashEnemy, PATH_TOP };

const THREE_URL = '../vendor/three.module.js';
async function ensureThree() { return loadThreeCore(); }

// Resolve the shared THREE module (loads the vendored build on first call).
export async function loadThree() {
  return loadThreeCore();
}

// Free per-instance resources when a pooled mesh leaves the scene.
function disposeInstance(mesh) {
  if (mesh.userData.dispose) { mesh.userData.dispose(); return; }
  if (mesh.userData.shared) return;
  mesh.traverse((o) => {
    o.geometry?.dispose?.();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
    else o.material?.dispose?.();
  });
}

// Homing rocket: body, nose, fins and an additive exhaust flame. One shared
// template; projectiles are cheap clones.
let rocketTpl = null;
function buildRocket() {
  if (!rocketTpl) {
    rocketTpl = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 7, 8).rotateZ(-Math.PI / 2), std(0xf1f5f9, { rough: 0.4, metal: 0.3 }));
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3.4, 8).rotateZ(-Math.PI / 2), std(0xfb7185, { rough: 0.4, emissive: 0x7f1d1d, ei: 0.4 }));
    nose.position.x = 5.2;
    rocketTpl.add(body, nose);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 2.6), std(0xe11d48, { rough: 0.5 }));
      fin.position.set(-3, 0, 0);
      fin.rotation.x = (i * Math.PI) / 2;
      fin.geometry.translate(0, 0, 1.4);
      rocketTpl.add(fin);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(1.2, 6, 8).rotateZ(Math.PI / 2), glow(0xffb347, 0.9, true));
    flame.position.x = -6.5;
    flame.name = 'flame';
    rocketTpl.add(flame);
    rocketTpl.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }
  const g = rocketTpl.clone(true);
  g.userData.shared = true;
  return g;
}

export function createView3D(container, game) {
  let renderer = null;
  let scene = null;
  let camera = null;
  let running = false;
  let rafId = 0;
  let built = false;

  // --- camera orbit state ---
  const orbit = { yaw: 0.6, pitch: 0.95, dist: 800, target: null };
  const DIST_MIN = 250;
  const DIST_MAX = 2200;

  // --- scene graph handles ---
  let staticGroup = null;
  let currentMap = null;
  const towerMeshes = new Map();  // tower object -> Group
  const enemyMeshes = new Map();  // enemy object -> Group
  const projMeshes = new Map();   // projectile object -> Mesh
  let fx = null;             // combat VFX (shots, impacts, explosions)
  let coverage = null;       // glow on road tiles inside a placement preview
  let selRing = null;
  let hoverRing = null;
  let lastFxTime = 0;
  const seenBeams = new WeakSet();
  const towerAt = new Map(); // "x,y" -> tower mesh (shot origins)
  let ghostMesh = null;
  let ghostType = null;
  let lights = null;
  // pooled rings for fellow same-type towers + the mortar-style dead zone
  const typeRings = [];
  function typeRing(i) {
    while (typeRings.length <= i) typeRings.push(createRangeIndicator(scene, { dashes: false }));
    return typeRings[i];
  }
  function hideTypeRings(from = 0) {
    for (let i = from; i < typeRings.length; i++) typeRings[i].hide();
  }

  const raycaster = { obj: null, ndc: null, plane: null };

  function tileToWorld(c, r) {
    const s = game.getState();
    const ox = -s.map.cols * TILE_SIZE / 2;
    const oz = -s.map.rows * TILE_SIZE / 2;
    return { x: ox + (c + 0.5) * TILE_SIZE, z: oz + (r + 0.5) * TILE_SIZE, ox, oz };
  }

  async function ensureBuilt() {
    if (built) return;
    await ensureThree();
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x0f172a);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = gradientBackground(0x1e3a5f, 0x0b1120);
    camera = new THREE.PerspectiveCamera(50, 1, 1, 8000);
    lights = setupLighting(scene, renderer, { shadows: true });

    raycaster.obj = new THREE.Raycaster();
    raycaster.ndc = new THREE.Vector2();
    raycaster.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    staticGroup = new THREE.Group();
    scene.add(staticGroup);

    // range indicators (flat on the ground) + combat VFX
    selRing = createRangeIndicator(scene);
    hoverRing = createRangeIndicator(scene);
    coverage = createCoverage(scene, TILE_SIZE);
    fx = createFx(scene);
    ghostMesh = new THREE.Group();
    ghostMesh.visible = false;
    scene.add(ghostMesh);

    attachInput(renderer.domElement);
    new ResizeObserver(resize).observe(container);
    resize();
    orbit.target = new THREE.Vector3(0, 0, 0);
    built = true;
  }

  // Road tile centres in world space (coverage preview), cached per map.
  let roadPts = null, roadPtsFor = null;
  function roadPoints(s) {
    if (roadPtsFor === s.waypoints) return roadPts;
    const { ox, oz } = tileToWorld(0, 0);
    roadPts = (s.waypoints || []).map((w) => ({ x: ox + w.x, z: oz + w.y }));
    roadPtsFor = s.waypoints;
    return roadPts;
  }

  // --- static map geometry (instanced tiles + spawn/base markers) ---
  function rebuildStatic() {
    const s = game.getState();
    for (const child of [...staticGroup.children]) {
      staticGroup.remove(child);
      child.traverse((o) => {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else o.material?.dispose?.();
        if (o.isInstancedMesh) o.dispose(); // instance buffers
      });
    }
    staticGroup.add(createTerrain(s.map));
    currentMap = s.map;
    fx?.clear();
    lights.fit(Math.max(s.map.cols, s.map.rows) * TILE_SIZE);
    // refit camera distance to map size
    orbit.dist = fitDist();
  }

  function syncPool(pool, items, create, update, onRemove) {
    const alive = new Set(items);
    for (const [obj, mesh] of pool) {
      if (!alive.has(obj)) {
        onRemove?.(obj, mesh);
        scene.remove(mesh);
        disposeInstance(mesh);
        pool.delete(obj);
      }
    }
    for (const obj of items) {
      let mesh = pool.get(obj);
      if (!mesh) {
        mesh = create(obj);
        pool.set(obj, mesh);
        scene.add(mesh);
      }
      update(obj, mesh);
    }
  }

  // --- per-frame sync ---
  // Enemy body height (world y) for shot endpoints / impacts.
  const bodyY = (r) => PATH_TOP + 7 + (r || 9) * 0.4 + 2;
  const hexOf = (c) => parseInt(String(c || '#ffffff').replace('#', ''), 16);

  function sync() {
    const s = game.getState();
    if (!s.map) return;
    if (currentMap !== s.map) rebuildStatic();
    const { ox, oz } = tileToWorld(0, 0);
    const px = (x) => ox + x;
    const pz = (y) => oz + y;
    // effects run on game time: they freeze on pause and speed up with 2x/3x
    let fdt = s.time - lastFxTime;
    if (fdt < 0) { fx.clear(); fdt = 0; } // restart rewound the clock
    fdt = Math.min(fdt, 0.1);
    lastFxTime = s.time;

    towerAt.clear();
    syncPool(towerMeshes, s.towers, (tw) => {
      const def = TOWERS[tw.type];
      const m = buildTowerMesh(tw.type, parseInt(def.color.slice(1), 16));
      m.userData.lastFlash = tw.flashUntil ?? -1;
      fx.placed({ x: px(tw.x), z: pz(tw.y) }, def.color);
      return m;
    }, (tw, mesh) => {
      mesh.position.set(px(tw.x), 0, pz(tw.y));
      towerAt.set(`${tw.x},${tw.y}`, mesh);
      // only the head turns to aim; the stone plinth stays put
      mesh.userData.head.rotation.y = -(tw.angle ?? -Math.PI / 2);
      setTowerLevel(mesh, tw.level);
      const flash = s.time < (tw.flashUntil ?? -1);
      flashTower(mesh, flash);
      animateTower(mesh, s.time, flash);
      // new fire / level-up pulse (level-ups set a longer glow window)
      const fu = tw.flashUntil ?? -1;
      if (fu > mesh.userData.lastFlash) {
        mesh.userData.lastFlash = fu;
        mesh.updateMatrixWorld(true);
        const p = mesh.userData.muzzle.getWorldPosition(new THREE.Vector3());
        if (fu - s.time > 0.25) fx.levelUp(mesh.position);
        else fx.muzzle(p, tw.type, TOWERS[tw.type].color);
      }
    });

    syncPool(enemyMeshes, s.enemies, (e) => {
      const m = buildEnemyMesh(e);
      m.userData.lastHit = e.flashUntil ?? -1;
      m.userData.nextSpark = 0;
      return m;
    }, (e, mesh) => {
      mesh.position.set(px(e.x), 0, pz(e.y));
      mesh.rotation.y = -(e.angle ?? 0);
      mesh.userData.enemyRef = e; // click-to-inspect picking
      const slowed = s.time < e.slowUntil;
      mesh.userData.slow.visible = slowed;
      const pct = Math.max(0, e.hp / e.maxHp);
      const w = mesh.userData.barW;
      mesh.userData.barFg.scale.x = Math.max(0.001, w * pct);
      mesh.userData.barFg.position.x = -w * (1 - pct) / 2;
      mesh.userData.barFg.material.color.setHex(pct > 0.5 ? 0x22c55e : pct > 0.25 ? 0xfacc15 : 0xef4444);
      mesh.userData.bars.quaternion.copy(mesh.quaternion).invert().multiply(camera.quaternion);
      // white damage hit-flash + impact sparks (rate-limited per enemy)
      const fu = e.flashUntil ?? -1;
      flashEnemy(mesh, s.time < fu);
      if (fu > mesh.userData.lastHit) {
        mesh.userData.lastHit = fu;
        if (s.time >= mesh.userData.nextSpark) {
          mesh.userData.nextSpark = s.time + 0.07;
          // impact FX in the shooter's tower color, sized to the enemy
          const twType = e.lastHit?.type;
          const hitColor = (twType && TOWERS[twType]?.color) || e.color || '#ffd08a';
          fx.hit({ x: mesh.position.x, y: bodyY(e.r), z: mesh.position.z }, hitColor, e.r >= 12, e.r || 9);
        }
        mesh.userData.hitKick = 1;
      }
      animateEnemy(mesh, s.time);
      // tiny impact squash on each hit (volume-preserving: flatten Y, widen
      // XZ — never a net "growth", unlike the old uniform 1+kick*0.1 pop)
      const kick = mesh.userData.hitKick || 0;
      if (kick > 0.01) {
        const rig = mesh.userData.rig;
        const sxz = 1 + kick * 0.05, sy = 1 - kick * 0.07;
        if (mesh.userData.kind === 'mitosis') {
          // splitters breathe via rig.scale each frame: ride on top of it
          rig.scale.x *= sxz; rig.scale.y *= sy; rig.scale.z *= sxz;
        } else rig.scale.set(sxz, sy, sxz);
        mesh.userData.hitKick = kick * 0.7;
      } else if (kick) {
        if (mesh.userData.kind !== 'mitosis') mesh.userData.rig.scale.set(1, 1, 1);
        mesh.userData.hitKick = 0;
      }
    }, (e, mesh) => {
      const p = { x: mesh.position.x, y: bodyY(e.r), z: mesh.position.z };
      if (e.hp <= 0) fx.death(p, hexOf(e.color), e.type === 'boss' || e.type === 'golem');
      else if (s.waypoints && e.wp >= s.waypoints.length) fx.leak(p); // not on restart
    });

    syncPool(projMeshes, s.projectiles, () => buildRocket(), (p, mesh) => {
      mesh.position.set(px(p.x), 16, pz(p.y));
      mesh.rotation.y = -(p.angle ?? 0);
      const flame = mesh.children[mesh.children.length - 1];
      flame.scale.x = 0.8 + Math.random() * 0.5;
      const a = p.angle ?? 0;
      fx.rocketTrail({ x: mesh.position.x - Math.cos(a) * 7, y: 16, z: mesh.position.z - Math.sin(a) * 7 });
    }, (p) => {
      if (!p.done) return; // cleared by a restart, not an impact
      fx.explosion({ x: px(p.tx ?? p.x), y: 10, z: pz(p.ty ?? p.y) }, p.splash || TOWERS.missile?.splash || 60, 0xfb7185);
    });

    // new shots -> per-tower shot effects (beams live ~0.1-0.2 s in game)
    for (const b of s.beams) {
      if (seenBeams.has(b)) continue;
      seenBeams.add(b);
      const towerMesh = towerAt.get(`${b.x1},${b.y1}`);
      let a;
      if (towerMesh && !b.hop) {
        towerMesh.updateMatrixWorld(true);
        a = towerMesh.userData.muzzle.getWorldPosition(new THREE.Vector3());
      } else {
        a = new THREE.Vector3(px(b.x1), bodyY(9), pz(b.y1));
      }
      const hitX = b.hx ?? b.x2, hitY = b.hy ?? b.y2;
      const end = new THREE.Vector3(px(hitX), bodyY(b.r), pz(hitY));
      const full = b.type === 'railgun' ? new THREE.Vector3(px(b.x2), bodyY(9), pz(b.y2)) : null;
      fx.shot(b.type, a, end, { color: hexOf(b.color), crit: !!b.crit, splash: b.splash || 0, hop: b.hop || 0, bFull: full });
    }

    // --- range indicators ---
    const tNow = performance.now() / 1000;
    selRing.tick(fdt || 1 / 60);
    hoverRing.tick(fdt || 1 / 60);
    coverage.pulse(tNow);
    if (s.selectedTower) {
      const t = s.selectedTower;
      const def = TOWERS[t.type];
      selRing.set(px(t.x), pz(t.y), t.range, hexOf(def.color), { minRadius: def.minRange || 0 });
    } else {
      selRing.hide();
    }
    let coverShown = false;
    const hov = s.hover;
    const boardLocked = s.gameOver || (s.won && game.getConfig().levelId);
    const buildDef = s.selectedType ? TOWERS[s.selectedType] : null;
    if (!s.selectedTower && !boardLocked && buildDef && hov && s.map) {
      // fellow towers of the type being placed: faint tower-colored discs so
      // the green/red preview stays unmistakably the new one
      const fellowHex = hexOf(buildDef.color);
      let ri = 0;
      for (const tw of s.towers) {
        if (tw.type !== s.selectedType) continue;
        typeRing(ri++).set(px(tw.x), pz(tw.y), tw.range, fellowHex, { opacity: 0.15, y: 1.0 });
      }
      hideTypeRings(ri);
      if (hov.c >= 0 && hov.r >= 0 && hov.c < s.map.cols && hov.r < s.map.rows) {
        const under = s.towers.find((t) => t.c === hov.c && t.r === hov.r);
        const { x, z } = tileToWorld(hov.c, hov.r);
        if (under) {
          const ud = TOWERS[under.type];
          hoverRing.set(px(under.x), pz(under.y), under.range, 0xffffff, { minRadius: ud.minRange || 0, opacity: 0.8 });
          ghostMesh.visible = false;
        } else {
          const def = buildDef;
          const ok = s.map.grid[hov.r][hov.c] === T.BUILDABLE && s.gold >= def.cost;
          const col = ok ? 0x4ade80 : 0xef4444;
          hoverRing.set(x, z, def.range, col, { minRadius: def.minRange || 0 });
          if (ok) {
            coverage.set(roadPoints(s), x, z, def.range, def.minRange || 0, 0x4ade80);
            coverShown = true;
          }
          setGhost(s.selectedType);
          ghostMesh.visible = true;
          ghostMesh.position.set(x, 0, z);
        }
      } else {
        hoverRing.hide();
        ghostMesh.visible = false;
      }
    } else {
      hoverRing.hide();
      ghostMesh.visible = false;
      hideTypeRings();
    }
    if (!coverShown) coverage.hide();

    // particles / beams / shells advance on game time
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
    // point sprites attenuate with zoom too (HUD framing zooms out < 1)
    fx.update(fdt, ((buf.y * 0.5) / Math.tan((camera.fov * Math.PI) / 360)) * camera.zoom);

    // water ripples, portal swirl, keep crystal
    for (const child of staticGroup.children) child.userData.tick?.(tNow);
  }

  // Placement preview: the real tower model, translucent.
  function setGhost(type) {
    if (ghostType === type) return;
    ghostType = type;
    for (const c of [...ghostMesh.children]) { ghostMesh.remove(c); disposeInstance(c); }
    const def = TOWERS[type];
    if (!def) return;
    const g = buildTowerMesh(type, parseInt(def.color.slice(1), 16));
    g.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.material.transparent = true;
      o.material.opacity = 0.5;
      o.material.depthWrite = false;
    });
    ghostMesh.add(g);
  }

  // --- camera ---
  const HOME = { yaw: 0.6, pitch: 0.95 };
  function fitDist() {
    const s = game.getState();
    if (!s.map) return 800;
    return Math.min(DIST_MAX, Math.max(DIST_MIN, Math.max(s.map.cols, s.map.rows) * TILE_SIZE * 1.35));
  }
  function resetView() {
    orbit.yaw = HOME.yaw;
    orbit.pitch = HOME.pitch;
    orbit.dist = fitDist();
    if (orbit.target) orbit.target.set(0, 0, 0);
  }
  function updateCamera() {
    const { yaw, pitch, dist, target } = orbit;
    const t = target || { x: 0, y: 0, z: 0 };
    camera.position.set(
      t.x + dist * Math.cos(pitch) * Math.cos(yaw),
      t.y + dist * Math.sin(pitch),
      t.z + dist * Math.cos(pitch) * Math.sin(yaw)
    );
    camera.lookAt(t.x, t.y, t.z);
    // The fullscreen HUD bars overlay the canvas, so refresh the
    // compensation (throttled + cached inside; cheap per frame).
    refreshHudCompensation();
  }

  // Raycast enemy bodies (topmost first) for click-to-inspect.
  function pickEnemy(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.ndc.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.obj.setFromCamera(raycaster.ndc, camera);
    const meshes = [...enemyMeshes.values()];
    if (!meshes.length) return null;
    const hits = raycaster.obj.intersectObjects(meshes, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.enemyRef) o = o.parent;
      if (o && o.userData.enemyRef && o.userData.enemyRef.hp > 0) return o.userData.enemyRef;
    }
    return null;
  }

  // --- picking + orbit input ---
  function pickTile(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.ndc.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.obj.setFromCamera(raycaster.ndc, camera);
    const pt = new THREE.Vector3();
    if (!raycaster.obj.ray.intersectPlane(raycaster.plane, pt)) return null;
    const s = game.getState();
    if (!s.map) return null;
    const { ox, oz } = tileToWorld(0, 0);
    const c = Math.floor((pt.x - ox) / TILE_SIZE);
    const r = Math.floor((pt.z - oz) / TILE_SIZE);
    if (c < 0 || r < 0 || c >= s.map.cols || r >= s.map.rows) return null;
    return { c, r };
  }

  function attachInput(el) {
    let dragging = false;
    let panMode = false;
    let downButton = 0;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    // double-click (or double-tap) on the same tower upgrades it
    let lastTowerClick = { tower: null, time: 0 };
    // multi-touch: two fingers pan + pinch-zoom
    const touches = new Map();
    let pinchDist = 0;

    // Pan the look-at target across the ground (grab-style), clamped to the map.
    function panBy(dx, dy) {
      if (!orbit.target) return;
      const k = orbit.dist * 0.0011;
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      orbit.target.addScaledVector(right, -dx * k);
      orbit.target.addScaledVector(fwd, dy * k);
      const s = game.getState();
      const mx = s.map ? (s.map.cols * TILE_SIZE) / 2 + 150 : 600;
      const mz = s.map ? (s.map.rows * TILE_SIZE) / 2 + 150 : 600;
      orbit.target.x = Math.max(-mx, Math.min(mx, orbit.target.x));
      orbit.target.z = Math.max(-mz, Math.min(mz, orbit.target.z));
      orbit.target.y = 0;
    }

    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    el.addEventListener('pointerdown', (ev) => {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size === 2) {
        // switch to two-finger gesture; cancel rotate/click
        const [a, b] = [...touches.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        lastX = (a.x + b.x) / 2;
        lastY = (a.y + b.y) / 2;
        dragging = false;
        moved = 999;
        return;
      }
      dragging = true;
      panMode = ev.button === 2 || ev.shiftKey;
      downButton = ev.button;
      moved = 0;
      lastX = ev.clientX;
      lastY = ev.clientY;
      el.setPointerCapture(ev.pointerId);
    });
    el.addEventListener('pointermove', (ev) => {
      if (touches.has(ev.pointerId)) touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        panBy(mx - lastX, my - lastY);
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) {
          orbit.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, orbit.dist * (pinchDist / Math.max(1, d))));
        }
        pinchDist = d;
        lastX = mx; lastY = my;
        return;
      }
      if (dragging) {
        const dx = ev.clientX - lastX;
        const dy = ev.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        if (panMode) {
          panBy(dx, dy);
        } else {
          // Grab-style orbit: the map follows the pointer on both axes
          // (drag left -> map moves left), matching pan + vertical tilt.
          orbit.yaw += dx * 0.006;
          orbit.pitch = Math.min(1.35, Math.max(0.18, orbit.pitch + dy * 0.005));
        }
        lastX = ev.clientX;
        lastY = ev.clientY;
      } else {
        const hit = pickTile(ev);
        if (hit) game.setHoverTile(hit.c, hit.r);
        else game.setHoverTile(null);
      }
    });
    function endPointer(ev) {
      touches.delete(ev.pointerId);
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        lastX = (a.x + b.x) / 2;
        lastY = (a.y + b.y) / 2;
        return;
      }
      if (touches.size > 0) return; // still in a gesture
      dragging = false;
      if (moved < 6 && downButton === 0 && !panMode) {
        const hit = pickTile(ev);
        if (!hit) return;
        // towers first: select the placed tower (clears enemy inspection);
        // a second quick click on the same tower upgrades it instead
        const s = game.getState();
        const towerHere = s.towers.find((t) => t.c === hit.c && t.r === hit.r);
        if (towerHere) {
          game.interact(hit.c, hit.r);
          const now = performance.now();
          if (lastTowerClick.tower === towerHere && now - lastTowerClick.time < 400) {
            lastTowerClick.tower = null;
            game.upgradeSelected();
          } else {
            lastTowerClick = { tower: towerHere, time: now };
          }
          return;
        }
        // enemies live on path tiles: inspect (also clears tower selection)
        const foe = pickEnemy(ev);
        if (foe) {
          game.interact(hit.c, hit.r);
          game.setInspectedEnemy(foe);
          return;
        }
        game.interact(hit.c, hit.r);
      }
    }
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
    el.addEventListener('pointerleave', () => {
      touches.clear();
      dragging = false;
      game.setHoverTile(null);
    });
    el.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      orbit.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, orbit.dist * (1 + ev.deltaY * 0.001)));
    }, { passive: false });
  }

  function resize() {
    if (!renderer) return;
    const w = Math.max(50, container.clientWidth);
    const h = Math.max(50, container.clientHeight || 480);
    renderer.setSize(w, h);
    applyHudCompensation(w, h, true);
  }

  // --- HUD-aware framing (play mode) ---
  // In immersive play the HUD top/bottom bars overlay the canvas, with the
  // bottom bars far taller than the top ones — the map's lower part hides
  // behind the tower/action bars until the player pans it out. So (a) lift
  // the projection by a fixed 15% of the viewport height, and (b) zoom out
  // just enough that the map fits between the bars instead of under them.
  let lastViewW = 0, lastViewH = 0, lastShift = -1, lastZoom = -1;
  let lastHudCheck = 0;
  function hudBars() {
    const bottom = container.querySelector('.hud-bottom')?.offsetHeight || 0;
    if (!bottom) return { top: 0, bottom: 0 };
    const top = container.querySelector('.hud-top')?.offsetHeight || 0;
    return { top, bottom };
  }
  function applyHudCompensation(w, h, force = false) {
    const { top, bottom } = hudBars();
    // (a) fixed lift: 15% of the viewport height whenever the HUD overlays
    // the canvas (measured centering never looked right — the bottom bars
    // dwarf the top ones).
    const shift = bottom ? Math.round(h * 0.15) : 0;
    // (b) scale the picture to the visible fraction so the map fits
    // between the bars; never zoom in, never shrink to a postage stamp.
    const zoom = bottom ? Math.max(0.55, Math.min(1, (h - top - bottom) / h)) : 1;
    const zr = Math.round(zoom * 200) / 200; // quantize: avoid matrix churn
    if (!force && w === lastViewW && h === lastViewH && shift === lastShift && zr === lastZoom) return;
    lastViewW = w; lastViewH = h; lastShift = shift; lastZoom = zr;
    camera.aspect = w / h;
    camera.zoom = zr;
    if (shift < 1) {
      if (camera.view?.enabled) camera.clearViewOffset();
      else camera.updateProjectionMatrix();
    } else {
      // offsetY is in pixels and moves the image up (see menu3d for the
      // horizontal equivalent): the map centre lands `shift` px higher.
      camera.setViewOffset(w, h, 0, shift, w, h);
    }
  }
  // HUD content rewraps (wave chips, tower rows) without the container
  // itself resizing, so re-measure on a timer rather than only on resize.
  function refreshHudCompensation() {
    if (!renderer || !camera) return;
    const now = performance.now();
    if (now - lastHudCheck < 250) return;
    lastHudCheck = now;
    const w = Math.max(50, container.clientWidth);
    const h = Math.max(50, container.clientHeight || 480);
    applyHudCompensation(w, h);
  }

  function frame() {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    try {
      sync();
      updateCamera();
      renderer.render(scene, camera);
    } catch {
      // never let the 3D loop kill itself on a transient bad frame
    }
  }

  // One full render outside the loop: used for the first frame on start()
  // and for warming up the scene while hidden before first entry.
  function renderOnce() {
    resize();
    sync();
    updateCamera();
    renderer.render(scene, camera);
  }

  return {
    async start() {
      await ensureBuilt();
      if (running) return;
      // rebuild on next frame if the map changed while 3D was off
      running = true;
      try {
        // Render the first frame synchronously: callers hide their loader
        // when start() resolves, so real pixels must exist by then —
        // never reveal an empty scene.
        renderOnce();
      } catch {
        // a bad first frame surfaces again in the loop instead of hanging load
      }
      frame();
    },
    // Build everything (renderer, scene, first pixels) without starting the
    // loop, so entering Play later drops straight into the live game.
    async prepare() {
      await ensureBuilt();
      try {
        renderOnce();
      } catch {
        // the loop will surface it on entry instead of hanging preload
      }
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
    resetView,
  };
}

export const THREE_URL_LOCAL = THREE_URL;

// Standalone single-enemy showcase for the codex: one enemy on a pedestal,
// slowly rotating, with flapping wings / halo animation. Shares the exact
// same builder as the game view, so codex 3D always matches the game.
export function createEnemyViewer(container) {
  let renderer = null;
  let scene = null;
  let camera = null;
  let group = null;
  let running = false;
  let rafId = 0;
  let built = false;
  let currentId = null;

  async function ensure() {
    await ensureThree();
    if (built) return;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x020617, 1);
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 1, 2000);
    camera.position.set(0, 46, 128);
    camera.lookAt(0, 18, 0);
    setupLighting(scene, renderer, { shadows: true, span: 110, mapSize: 1024 });
    // pedestal disc
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(30, 34, 4, 32),
      std(0x334155, { rough: 0.6, metal: 0.3 })
    );
    disc.receiveShadow = true;
    disc.position.y = -2;
    scene.add(disc);
    const trim = new THREE.Mesh(
      new THREE.TorusGeometry(31, 1.4, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.5;
    scene.add(trim);
    new ResizeObserver(resize).observe(container);
    resize();
    built = true;
  }

  function resize() {
    if (!renderer) return;
    const w = Math.max(50, container.clientWidth);
    const h = Math.max(50, container.clientHeight || 300);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const t = now / 1000;
    if (group) {
      group.rotation.y += 0.02;
      animateEnemy(group, t);
      group.userData.bars.quaternion.copy(group.quaternion).invert().multiply(camera.quaternion);
    }
    renderer.render(scene, camera);
  }

  return {
    async start() {
      await ensure();
      if (running) return;
      running = true;
      resize();
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
    show(def) {
      if (!built) return;
      if (currentId === def.id && group) return;
      if (group) { scene.remove(group); disposeInstance(group); }
      const e = {
        type: def.id, shape: def.shape || def.id, color: def.color, r: def.r,
        seed: 1.7, slowUntil: -1, flashUntil: -1, hp: 1, maxHp: 1, angle: 0,
      };
      group = buildEnemyMesh(e);
      group.userData.slow.visible = false;
      group.userData.barFg.scale.x = group.userData.barW; // full health
      const fit = 44 / (e.r * 2 + 22);
      group.scale.setScalar(fit);
      scene.add(group);
      currentId = def.id;
    },
  };
}

// Standalone single-tower showcase for the showroom: one tower on a
// pedestal, slowly rotating. Same builder as the game view.
export function createTowerViewer(container) {
  let renderer = null;
  let scene = null;
  let camera = null;
  let group = null;
  let running = false;
  let rafId = 0;
  let built = false;
  let currentId = null;

  async function ensure() {
    await ensureThree();
    if (built) return;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x020617, 1);
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 1, 2000);
    camera.position.set(0, 42, 118);
    camera.lookAt(0, 12, 0);
    setupLighting(scene, renderer, { shadows: true, span: 110, mapSize: 1024 });
    // pedestal disc
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(26, 30, 4, 32),
      std(0x334155, { rough: 0.6, metal: 0.3 })
    );
    disc.receiveShadow = true;
    disc.position.y = -2;
    scene.add(disc);
    const trim = new THREE.Mesh(
      new THREE.TorusGeometry(27, 1.4, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 })
    );
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.5;
    scene.add(trim);
    new ResizeObserver(resize).observe(container);
    resize();
    built = true;
  }

  function resize() {
    if (!renderer) return;
    const w = Math.max(50, container.clientWidth);
    const h = Math.max(50, container.clientHeight || 300);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (group) {
      group.rotation.y += 0.025;
      animateTower(group, now / 1000, false);
    }
    renderer.render(scene, camera);
  }

  return {
    async start() {
      await ensure();
      if (running) return;
      running = true;
      resize();
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
    show(def) {
      if (!built) return;
      if (currentId === def.id && group) return;
      if (group) { scene.remove(group); disposeInstance(group); }
      group = buildTowerMesh(def.id, parseInt(def.color.slice(1), 16));
      group.scale.setScalar(1.5);
      scene.add(group);
      currentId = def.id;
    },
  };
}
