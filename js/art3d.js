// Shared 3D art core: lazy THREE handle, material helpers, and the common
// lighting rig (sun + shadows + soft sky environment) used by every 3D scene
// (game view, editor, menu diorama, codex / showroom viewers).
const THREE_URL = '../vendor/three.module.js';

// Live binding: modules importing THREE see it once loadThree() resolves.
export let THREE = null;
export async function loadThree() {
  if (!THREE) THREE = await import(THREE_URL);
  return THREE;
}

// Standard PBR material with sane low-poly defaults.
export function std(color, o = {}) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: o.rough ?? 0.7,
    metalness: o.metal ?? 0,
    flatShading: !!o.flat,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.ei ?? 1,
    transparent: o.opacity != null && o.opacity < 1,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
  });
  if (o.opacity != null && o.opacity < 1 && o.depthWrite === false) m.depthWrite = false;
  return m;
}

// Unlit glowing material (energy, eyes, portals).
export function glow(color, opacity = 1, additive = false) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1 || additive,
    opacity,
    depthWrite: !(opacity < 1 || additive),
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

export function shade(hex, k) {
  return new THREE.Color(hex).multiplyScalar(k).getHex();
}
export function tint(hex, toward, k) {
  return new THREE.Color(hex).lerp(new THREE.Color(toward), k).getHex();
}

// Mesh helper: geometry + material + position, shadow flags on.
export function mk(geo, mat, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

// Soft sky/ground gradient baked into a PMREM env map, so metals and
// glossy surfaces pick up believable reflections without any asset files.
const envCache = new WeakMap();
function envFor(renderer) {
  let tex = envCache.get(renderer);
  if (tex) return tex;
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(100, 32, 16);
  const cols = [];
  const pos = geo.attributes.position;
  const top = new THREE.Color(0x5d7fa8), mid = new THREE.Color(0x8a8578), bot = new THREE.Color(0x2e2820);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 100;
    if (y > 0) c.copy(mid).lerp(top, Math.min(1, y * 1.6));
    else c.copy(mid).lerp(bot, Math.min(1, -y * 3));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  // a bright "sun" patch for crisp specular glints
  const sun = new THREE.Mesh(new THREE.SphereGeometry(12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  sun.material.color.multiplyScalar(6);
  sun.position.set(45, 70, 30);
  envScene.add(sun);
  const pmrem = new THREE.PMREMGenerator(renderer);
  tex = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
  envCache.set(renderer, tex);
  return tex;
}

// Vertical gradient backdrop (screen-space) for game-style scenes.
export function gradientBackground(topHex, bottomHex) {
  const cv = document.createElement('canvas');
  cv.width = 4;
  cv.height = 256;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#' + new THREE.Color(topHex).getHexString());
  g.addColorStop(1, '#' + new THREE.Color(bottomHex).getHexString());
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Lighting rig: hemisphere fill, warm shadow-casting sun, cool rim light,
// ACES tone mapping and the sky env map. `fit(span)` resizes the sun's
// shadow frustum to cover a map `span` world units across.
export function setupLighting(scene, renderer, { shadows = true, span = 600, mapSize = 2048 } = {}) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  scene.environment = envFor(renderer);

  const hemi = new THREE.HemisphereLight(0xe6f2ff, 0x5a4630, 0.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.castShadow = shadows;
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0x9cc3ff, 0.55);
  scene.add(rim);

  function fit(s) {
    const half = Math.max(80, s * 0.62);
    sun.position.set(-half * 0.45, half * 1.4, half * 0.95);
    sun.target.position.set(0, 0, 0);
    rim.position.set(half * 0.9, half * 0.5, -half * 0.8);
    if (shadows) {
      const cam = sun.shadow.camera;
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
      cam.near = 1;
      cam.far = half * 4;
      cam.updateProjectionMatrix();
      sun.shadow.mapSize.set(mapSize, mapSize);
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.4;
      sun.shadow.radius = 2.5;
    }
  }
  fit(span);
  return { hemi, sun, rim, fit };
}

// Named-part registry: collect objects tagged with userData.part.
export function collectParts(root) {
  const parts = {};
  root.traverse((o) => {
    const p = o.userData.part;
    if (p) (parts[p] ||= []).push(o);
  });
  return parts;
}

// Hit / fire flash on a material that may already glow on its own.
export function setFlash(mat, color, intensity) {
  if (!mat.emissive) return;
  const b = mat.userData.base ||= { c: mat.emissive.getHex(), i: mat.emissiveIntensity };
  if (intensity > 0) {
    mat.emissive.setHex(color);
    mat.emissiveIntensity = intensity;
  } else if (mat.emissiveIntensity !== b.i || mat.emissive.getHex() !== b.c) {
    mat.emissive.setHex(b.c);
    mat.emissiveIntensity = b.i;
  }
}
