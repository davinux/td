// 3D map editor scene: renders the edited map with the same terrain builder
// as the game, and turns pointer input into tile paints.
// Controls — drag: paint · right-drag or Space-drag: orbit · Shift-drag: pan ·
// wheel: zoom · touch: 1 finger paints, 2 fingers orbit + pinch-zoom.
// api: { getMap() -> live {cols, rows, grid}, getVersion() -> number,
//        getTool() -> tool id, onPaint(c, r), onError(msg) }
import { loadThree, createTerrain } from './view3d.js';
import { setupLighting, gradientBackground } from './art3d.js';
import { TILE_SIZE } from './model.js';

const TOOL_COLORS = {
  path: 0xa16207,
  buildable: 0x22c55e,
  blocked: 0x475569,
  spawn: 0xef4444,
  base: 0x3b82f6,
  water: 0x2563eb,
  forest: 0x166534,
  rock: 0x8d6e63,
  mud: 0x6b4a2b,
  erase: 0x22c55e,
};

export function createEditor3D(container, api) {
  let THREE = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let terrain = null;
  let highlight = null;
  let lights = null;
  let running = false;
  let rafId = 0;
  let built = false;
  let active = false; // true between start() and stop()
  let spaceDown = false;

  const orbit = { yaw: 0.6, pitch: 0.95, dist: 800, target: null };
  const DIST_MIN = 200;
  const DIST_MAX = 2200;

  let seenMap = null;
  let seenVersion = -1;

  const ray = { obj: null, ndc: null, plane: null };

  function mapOrigin(map) {
    return { ox: -map.cols * TILE_SIZE / 2, oz: -map.rows * TILE_SIZE / 2 };
  }

  function pickTile(ev) {
    const map = api.getMap();
    if (!map) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    ray.ndc.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    ray.obj.setFromCamera(ray.ndc, camera);
    const pt = new THREE.Vector3();
    if (!ray.obj.ray.intersectPlane(ray.plane, pt)) return null;
    const { ox, oz } = mapOrigin(map);
    const c = Math.floor((pt.x - ox) / TILE_SIZE);
    const r = Math.floor((pt.z - oz) / TILE_SIZE);
    if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) return null;
    return { c, r };
  }

  function disposeGroup(group) {
    group.traverse((o) => {
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
      else o.material?.dispose?.();
      o.dispose?.();
    });
  }

  function rebuildTerrain(map) {
    if (terrain) {
      scene.remove(terrain);
      disposeGroup(terrain);
    }
    terrain = createTerrain(map);
    scene.add(terrain);
    seenMap = map;
    seenVersion = api.getVersion();
    lights?.fit(Math.max(map.cols, map.rows) * TILE_SIZE);
    // refit distance when the grid size changed
    orbit.dist = Math.min(DIST_MAX, Math.max(DIST_MIN,
      Math.max(map.cols, map.rows) * TILE_SIZE * 1.35));
  }

  function sync() {
    const map = api.getMap();
    if (!map) return;
    if (map !== seenMap || api.getVersion() !== seenVersion) rebuildTerrain(map);
    const tool = api.getTool();
    highlight.material.color.setHex(TOOL_COLORS[tool] ?? 0xffffff);
    terrain.userData.tick?.(performance.now() / 1000);
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
  }

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
    orbit.target.y = 0;
  }

  function setHighlight(c, r) {
    const map = api.getMap();
    if (!map || c == null || r == null) {
      highlight.visible = false;
      return;
    }
    const { ox, oz } = mapOrigin(map);
    highlight.visible = true;
    highlight.position.set(ox + (c + 0.5) * TILE_SIZE, 2, oz + (r + 0.5) * TILE_SIZE);
  }

  function attachInput(el) {
    let painting = false;
    let orbiting = false;
    let panning = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    let paintPointer = null;
    const touches = new Map();
    let pinchDist = 0;

    const onKeyDown = (e) => {
      if (e.code !== 'Space') return;
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      if (!active) return;
      spaceDown = true;
      e.preventDefault();
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space') spaceDown = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    el.addEventListener('pointerdown', (ev) => {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size === 2) {
        // switch to two-finger orbit + pinch; cancel painting
        const [a, b] = [...touches.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        lastX = (a.x + b.x) / 2;
        lastY = (a.y + b.y) / 2;
        painting = false;
        paintPointer = null;
        orbiting = false;
        panning = false;
        return;
      }
      const orbitDrag = ev.button === 2 || ev.button === 1 || spaceDown;
      const panDrag = !orbitDrag && ev.shiftKey;
      moved = 0;
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (orbitDrag) {
        orbiting = true;
      } else if (panDrag) {
        panning = true;
      } else if (ev.button === 0) {
        painting = true;
        paintPointer = ev.pointerId;
        const hit = pickTile(ev);
        if (hit) api.onPaint(hit.c, hit.r);
      }
      try { el.setPointerCapture(ev.pointerId); } catch { /* noop */ }
    });
    el.addEventListener('pointermove', (ev) => {
      if (touches.has(ev.pointerId)) touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        orbit.yaw -= (mx - lastX) * 0.007;
        orbit.pitch = Math.min(1.35, Math.max(0.18, orbit.pitch + (my - lastY) * 0.006));
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) {
          orbit.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, orbit.dist * (pinchDist / Math.max(1, d))));
        }
        pinchDist = d;
        lastX = mx; lastY = my;
        setHighlight(null);
        return;
      }
      if (painting && ev.pointerId === paintPointer) {
        const hit = pickTile(ev);
        if (hit) api.onPaint(hit.c, hit.r);
        setHighlight(hit?.c, hit?.r);
        return;
      }
      if (orbiting) {
        const dx = ev.clientX - lastX;
        const dy = ev.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        orbit.yaw -= dx * 0.006;
        orbit.pitch = Math.min(1.35, Math.max(0.18, orbit.pitch + dy * 0.005));
        lastX = ev.clientX;
        lastY = ev.clientY;
        return;
      }
      if (panning) {
        panBy(ev.clientX - lastX, ev.clientY - lastY);
        lastX = ev.clientX;
        lastY = ev.clientY;
        return;
      }
      const hit = pickTile(ev);
      setHighlight(hit?.c, hit?.r);
    });
    function endPointer(ev) {
      touches.delete(ev.pointerId);
      if (ev.pointerId === paintPointer) {
        painting = false;
        paintPointer = null;
      }
      orbiting = false;
      panning = false;
      void moved;
    }
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
    el.addEventListener('pointerleave', () => {
      touches.clear();
      painting = false;
      paintPointer = null;
      orbiting = false;
      panning = false;
      setHighlight(null);
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
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frame() {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    try {
      sync();
      updateCamera();
      renderer.render(scene, camera);
    } catch {
      // never let a transient bad frame kill the editor loop
    }
  }

  async function ensureBuilt() {
    if (built) return;
    THREE = await loadThree();
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setClearColor(0x0f172a);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 1, 8000);
    scene.background = gradientBackground(0x1e3a5f, 0x0b1120);
    lights = setupLighting(scene, renderer, { shadows: true });

    ray.obj = new THREE.Raycaster();
    ray.ndc = new THREE.Vector2();
    ray.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    highlight = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE_SIZE - 2, TILE_SIZE - 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, side: THREE.DoubleSide })
    );
    highlight.renderOrder = 10;
    highlight.rotation.x = -Math.PI / 2;
    highlight.visible = false;
    scene.add(highlight);

    orbit.target = new THREE.Vector3(0, 0, 0);
    attachInput(renderer.domElement);
    new ResizeObserver(resize).observe(container);
    resize();
    built = true;
  }

  const loadingEl = container.querySelector('.view3d-loading');

  return {
    async start() {
      active = true;
      try {
        if (loadingEl) loadingEl.classList.remove('hidden');
        // Let the loader paint before the heavy Three.js import blocks the thread.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await ensureBuilt();
        if (!active) return; // stopped while loading
        if (running) return;
        running = true;
        resize();
        try {
          // First frame synchronously, so the loader hides onto real pixels.
          sync();
          updateCamera();
          renderer.render(scene, camera);
        } catch {
          // a bad first frame surfaces again in the loop instead of hanging load
        }
        frame();
      } catch (err) {
        api.onError('⚠️ 3D editor failed to start: ' + err.message);
      } finally {
        if (loadingEl) loadingEl.classList.add('hidden');
      }
    },
    stop() {
      active = false;
      running = false;
      cancelAnimationFrame(rafId);
      spaceDown = false;
    },
  };
}
