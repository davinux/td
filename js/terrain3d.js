// Diorama terrain builder shared by the game view, editor and menu:
// beveled grass tiles, a sunken continuous road, glossy water with ripples
// and lily pads, tiered pine / round-canopy forests, boulder fields, slate
// cliffs, mud puddles, a stone spawn portal and a crystal-topped keep — all
// sitting on a layered earth slab. Instanced per layer (few draw calls).
// Tile tops: buildable/forest/rock at y=0, road at PATH_TOP, cliffs higher.
import { THREE, std, glow, mk } from './art3d.js';
import { T, TILE_SIZE } from './model.js';

export const PATH_TOP = -1.4;
const WATER_TOP = -2.6;
const TILE_H = 9;       // grass tile depth (top 0 -> bottom -9)
const CLIFF_TOP = 5;

const hash = (c, r, s) => {
  const x = Math.sin(c * 127.1 + r * 311.7 + s * 74.7) * 43758.5453;
  return x - Math.floor(x);
};

// Rounded, beveled tile slab: top face at y=0, bottom at -h.
function tileGeometry(size, h, radius, bevel) {
  const s = size / 2 - bevel;
  const rr = Math.min(radius, s - 0.01);
  const shape = new THREE.Shape();
  shape.moveTo(-s + rr, -s);
  shape.lineTo(s - rr, -s);
  shape.quadraticCurveTo(s, -s, s, -s + rr);
  shape.lineTo(s, s - rr);
  shape.quadraticCurveTo(s, s, s - rr, s);
  shape.lineTo(-s + rr, s);
  shape.quadraticCurveTo(-s, s, -s, s - rr);
  shape.lineTo(-s, -s + rr);
  shape.quadraticCurveTo(-s, -s, -s + rr, -s);
  const depth = h - bevel * 2;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments: 3,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -(depth + bevel), 0);
  return geo;
}

// Instanced layer collector: push transforms, build once at the end.
function makeLayers(group) {
  const layers = new Map();
  const m4 = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  return {
    def(name, geo, mat, { cast = true, receive = true, order = 0 } = {}) {
      layers.set(name, { geo, mat, cast, receive, order, items: [] });
    },
    put(name, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, color = null, rx = 0, rz = 0) {
      layers.get(name).items.push({ x, y, z, sx, sy, sz, ry, rx, rz, color });
    },
    build() {
      const out = {};
      for (const [name, L] of layers) {
        if (!L.items.length) { L.geo.dispose(); L.mat.dispose(); continue; }
        const inst = new THREE.InstancedMesh(L.geo, L.mat, L.items.length);
        L.items.forEach((it, k) => {
          p.set(it.x, it.y, it.z);
          q.setFromEuler(e.set(it.rx, it.ry, it.rz));
          s.set(it.sx, it.sy, it.sz);
          inst.setMatrixAt(k, m4.compose(p, q, s));
          if (it.color != null) inst.setColorAt(k, typeof it.color === 'number' ? col.setHex(it.color) : it.color);
        });
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.castShadow = L.cast;
        inst.receiveShadow = L.receive;
        inst.renderOrder = L.order;
        inst.userData.items = L.items;
        group.add(inst);
        out[name] = inst;
      }
      return out;
    },
  };
}

const WALKABLE = new Set([T.PATH, T.MUD, T.SPAWN, T.BASE]);

// Per-biome ground palettes (campaign maps carry map.biome = world id).
// Buildable ground always stays clearly green; roads and forest floor shift.
const PALETTES = {
  meadow:   { grass: [0x67ad3d, 0x5fa338], forest: 0x4b8a2f, rock: 0x8a8a6a, road: 0xc9a066, lip: 0x4c8a2e },
  crossing: { grass: [0x5eaf4c, 0x55a444], forest: 0x3f8a3a, rock: 0x86907a, road: 0xcfae78, lip: 0x3f8a3a },
  gauntlet: { grass: [0x8fa650, 0x849b48], forest: 0x6a8a3a, rock: 0x9a9070, road: 0xc4935a, lip: 0x6f8a3a },
  mire:     { grass: [0x5f8a3c, 0x567f36], forest: 0x3e6a2c, rock: 0x7a7a60, road: 0x9c7a4e, lip: 0x42652a },
  storm:    { grass: [0x78a36a, 0x6f9862], forest: 0x557f4c, rock: 0x8e949a, road: 0xb8a58a, lip: 0x5a7a52 },
  abyss:    { grass: [0x5a8a4a, 0x517f43], forest: 0x3d6337, rock: 0x6f6a70, road: 0x9a8670, lip: 0x3f5f37 },
};
const ROAD_LEVEL = WALKABLE;

export function createTerrain(map) {
  const group = new THREE.Group();
  const { cols, rows } = map;
  const W = cols * TILE_SIZE, D = rows * TILE_SIZE;
  const pal = PALETTES[map.biome] || PALETTES.meadow;
  const ox = -W / 2, oz = -D / 2;
  const tx = (c) => ox + (c + 0.5) * TILE_SIZE;
  const tz = (r) => oz + (r + 0.5) * TILE_SIZE;
  const at = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? -1 : map.grid[r][c]);
  const col = new THREE.Color();
  const jit = (hex, c, r, s, l = 0.06, h = 0.012) =>
    col.setHex(hex).offsetHSL((hash(c, r, s) - 0.5) * h, 0, (hash(c, r, s + 1) - 0.5) * l).clone();

  // --- earth slab: topsoil band over darker bedrock (diorama sides) ---
  const soil = mk(new THREE.BoxGeometry(W, 9, D), std(0x6b4a2e, { rough: 0.95 }), 0, -8.4 - 4.5, 0, false);
  const bed = mk(new THREE.BoxGeometry(W - 3, 14, D - 3), std(0x3b332c, { rough: 1, flat: true }), 0, -17.9 - 7, 0, false);
  const grassLip = mk(new THREE.BoxGeometry(W + 0.6, 1.2, D + 0.6), std(pal.lip, { rough: 0.9 }), 0, -8.4 + 0.2, 0, false);
  group.add(soil, bed, grassLip);

  const L = makeLayers(group);
  const tileGeo = tileGeometry(TILE_SIZE - 1.1, TILE_H, 3.5, 1.3);
  L.def('grass', tileGeo, std(0xffffff, { rough: 0.92 }));
  L.def('road', new THREE.BoxGeometry(TILE_SIZE, TILE_H + PATH_TOP, TILE_SIZE).translate(0, -(TILE_H + PATH_TOP) / 2, 0), std(0xffffff, { rough: 0.97 }), { cast: false });
  L.def('cliff', tileGeometry(TILE_SIZE - 1.1, TILE_H + CLIFF_TOP, 2.5, 1.6), std(0xffffff, { rough: 0.85, flat: true }));
  L.def('tuft', new THREE.ConeGeometry(0.9, 3.6, 4), std(0xffffff, { rough: 1 }), { cast: false });
  L.def('flower', new THREE.IcosahedronGeometry(0.85, 0), std(0xffffff, { rough: 0.6 }), { cast: false });
  L.def('pebble', new THREE.DodecahedronGeometry(1, 0), std(0xffffff, { rough: 0.9, flat: true }), { cast: false });
  L.def('trunk', new THREE.CylinderGeometry(0.8, 1.15, 1, 6).translate(0, 0.5, 0), std(0x6b4423, { rough: 1 }));
  L.def('pine', new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0), std(0xffffff, { rough: 0.85, flat: true }));
  L.def('canopy', new THREE.IcosahedronGeometry(1, 0), std(0xffffff, { rough: 0.85, flat: true }));
  L.def('boulder', new THREE.DodecahedronGeometry(1, 0), std(0xffffff, { rough: 0.8, flat: true }));
  L.def('moss', new THREE.SphereGeometry(1, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), std(0x5f8f35, { rough: 1 }), { cast: false });
  L.def('waterBed', new THREE.BoxGeometry(TILE_SIZE, 1.6, TILE_SIZE), std(0xffffff, { rough: 1 }), { cast: false });
  L.def('water', new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE).rotateX(-Math.PI / 2),
    std(0x3d93d6, { rough: 0.08, metal: 0.05, opacity: 0.8, emissive: 0x0c3f73, ei: 0.45, depthWrite: false }),
    { cast: false, order: 2 });
  L.def('waterSide', new THREE.PlaneGeometry(TILE_SIZE, 1), std(0x2f7cc0, { rough: 0.2, opacity: 0.75, depthWrite: false, emissive: 0x0c3f73, ei: 0.5 }),
    { cast: false, order: 2 });
  L.def('lily', new THREE.CircleGeometry(3.2, 12, 0.35, Math.PI * 2 - 0.7).rotateX(-Math.PI / 2), std(0x3f9a3a, { rough: 0.6, side: THREE.DoubleSide }), { cast: false, order: 3 });
  L.def('ripple', new THREE.RingGeometry(0.85, 1, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }), { cast: false, receive: false, order: 3 });
  L.def('puddle', new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2), std(0xffffff, { rough: 0.18, metal: 0 }), { cast: false, order: 1 });
  L.def('bubble', new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), std(0x4a3019, { rough: 0.1 }), { cast: false });
  
  const waterTiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = map.grid[r][c];
      const x = tx(c), z = tz(r);
      const h = (s) => hash(c, r, s);
      if (v === T.BUILDABLE || v === T.FOREST || v === T.ROCK) {
        // grass: subtle per-tile hue drift + faint checker for grid reading
        let base = v === T.FOREST ? pal.forest : v === T.ROCK ? pal.rock : pal.grass[(r + c) % 2 ? 0 : 1];
        L.put('grass', x, 0, z, 1, 1, 1, 0, jit(base, c, r, 11, v === T.ROCK ? 0.05 : 0.07, 0.02));
        if (v === T.BUILDABLE) {
          // tufts + wildflowers hugging the tile corners (tower pads stay clear)
          if (h(20) < 0.55) {
            const k = Math.floor(h(21) * 4);
            const cx = x + (k & 1 ? 1 : -1) * 11, cz = z + (k & 2 ? 1 : -1) * 11;
            for (let i = 0; i < 3; i++) {
              const a = i * 2.1 + h(22 + i) * 1.4;
              L.put('tuft', cx + Math.cos(a) * 1.6, 1.5, cz + Math.sin(a) * 1.6,
                1, 0.7 + h(25 + i) * 0.6, 1, a, jit(0x7cc24a, c, r, 30 + i, 0.14), (h(40 + i) - 0.5) * 0.5, (h(43 + i) - 0.5) * 0.5);
            }
          }
          if (h(26) < 0.22) {
            const petals = [0xfef3c7, 0xfde047, 0xf9a8d4, 0xc4b5fd, 0xffffff];
            const k = Math.floor(h(27) * 4);
            L.put('flower', x + (k & 1 ? -1 : 1) * 12, 0.9, z + (k & 2 ? -1 : 1) * 10, 1, 1, 1, 0,
              petals[Math.floor(h(28) * petals.length)]);
          }
        }
        if (v === T.FOREST) {
          const n = 2 + (h(1) < 0.45 ? 1 : 0);
          for (let i = 0; i < n; i++) {
            const a = h(2 + i) * Math.PI * 2 + i * 2.1;
            const d = n === 1 ? 0 : 5.5 + h(5 + i) * 3;
            const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
            const s = 0.75 + h(8 + i) * 0.5;
            const leaf = jit(i % 2 ? 0x2f7d32 : 0x3a8f3a, c, r, 50 + i, 0.14, 0.04);
            if (h(60 + i) < 0.72) {
              // tiered pine
              L.put('trunk', px, 0, pz, s * 1.4, 5 * s, s * 1.4);
              L.put('pine', px, 3.5 * s, pz, 8 * s, 9 * s, 8 * s, a, leaf);
              L.put('pine', px, 8 * s, pz, 6.3 * s, 8 * s, 6.3 * s, a + 0.4, leaf.clone().offsetHSL(0, 0, 0.03));
              L.put('pine', px, 12.3 * s, pz, 4.3 * s, 7 * s, 4.3 * s, a + 0.8, leaf.clone().offsetHSL(0, 0, 0.06));
            } else {
              // round broadleaf
              L.put('trunk', px, 0, pz, s * 1.6, 7 * s, s * 1.6);
              const leafB = jit(0x5aa13a, c, r, 70 + i, 0.12, 0.05);
              L.put('canopy', px, 11 * s, pz, 6.5 * s, 6 * s, 6.5 * s, a, leafB);
              L.put('canopy', px + 2.5 * s, 9 * s, pz + 1.5 * s, 4 * s, 3.8 * s, 4 * s, a + 1, leafB.clone().offsetHSL(0, 0, 0.04));
            }
          }
          L.put('tuft', x + (h(90) - 0.5) * 18, 1.5, z + (h(91) - 0.5) * 18, 1.2, 0.8, 1.2, 0, jit(0x6fb843, c, r, 92, 0.1));
        }
        if (v === T.ROCK) {
          const bx = x + (h(1) - 0.5) * 6, bz = z + (h(2) - 0.5) * 6;
          const s = 8 + h(3) * 3;
          const stone = jit(0xcfc3aa, c, r, 4, 0.1, 0.02);
          L.put('boulder', bx, s * 0.45, bz, s, s * (0.75 + h(5) * 0.3), s * 0.95, h(6) * 6.3, stone);
          L.put('moss', bx - s * 0.1, s * 0.45 + s * (0.75 + h(5) * 0.3) * 0.62, bz + s * 0.1, s * 0.5, s * 0.18, s * 0.45, h(7) * 6);
          for (let i = 0; i < 3; i++) {
            const a = h(10 + i) * Math.PI * 2;
            const ss = 2.2 + h(13 + i) * 2.4;
            L.put('boulder', bx + Math.cos(a) * (s + 2.5), ss * 0.4, bz + Math.sin(a) * (s + 2.5), ss, ss * 0.8, ss, a,
              stone.clone().offsetHSL(0, 0, (h(16 + i) - 0.5) * 0.12));
          }
        }
      } else if (v === T.BLOCKED) {
        // raised slate outcrop with loose scree on top
        L.put('cliff', x, CLIFF_TOP, z, 1, 1, 1, 0, jit(0x6b7280, c, r, 11, 0.1, 0.02));
        for (let i = 0; i < 3; i++) {
          const ss = 1.6 + h(20 + i) * 2.4;
          L.put('pebble', x + (h(23 + i) - 0.5) * 20, CLIFF_TOP + ss * 0.35, z + (h(26 + i) - 0.5) * 20, ss, ss * 0.7, ss, h(29 + i) * 6,
            jit(0x9aa3ad, c, r, 32 + i, 0.14));
        }
        if (h(40) < 0.5) L.put('tuft', x + (h(41) - 0.5) * 18, CLIFF_TOP + 1.5, z + (h(42) - 0.5) * 18, 1, 0.8, 1, 0, jit(0x7aa84a, c, r, 43, 0.1));
      } else if (v === T.WATER) {
        waterTiles.push([c, r]);
        L.put('waterBed', x, -7.6, z, 1, 1, 1, 0, jit(0x2f6a78, c, r, 11, 0.08));
        L.put('water', x, WATER_TOP, z);
        // exposed water column on map edges
        const sideH = WATER_TOP + 8.4;
        const midY = WATER_TOP - sideH / 2;
        if (r === 0) L.put('waterSide', x, midY, oz, 1, sideH, 1, Math.PI);
        if (r === rows - 1) L.put('waterSide', x, midY, oz + D, 1, sideH, 1, 0);
        if (c === 0) L.put('waterSide', ox, midY, z, 1, sideH, 1, -Math.PI / 2);
        if (c === cols - 1) L.put('waterSide', ox + W, midY, z, 1, sideH, 1, Math.PI / 2);
        if (h(1) < 0.3) L.put('lily', x + (h(2) - 0.5) * 16, WATER_TOP + 0.15, z + (h(3) - 0.5) * 16, 1, 1, 1, h(4) * 6.3);
        if (h(5) < 0.4) {
          const pr = 0.8 + h(7) * 0.3;
          L.put('boulder', x + (h(8) - 0.5) * 18, -5.6, z + (h(9) - 0.5) * 18, 3 * pr, 2.2 * pr, 3 * pr, h(6) * 6, jit(0x5b6b66, c, r, 12, 0.1));
        }
      } else if (ROAD_LEVEL.has(v)) {
        // continuous sunken road (mud darker, spawn/base tinted)
        const hex = v === T.MUD ? 0x6a4526 : v === T.SPAWN ? 0x9c6a52 : v === T.BASE ? 0x8f9aa8 : pal.road;
        L.put('road', x, PATH_TOP, z, 1, 1, 1, 0, jit(hex, c, r, 11, 0.05, 0.01));
        if (v === T.PATH) {
          for (let i = 0; i < 3; i++) {
            if (h(20 + i) < 0.4) continue;
            const ss = 0.8 + h(23 + i) * 1.1;
            L.put('pebble', x + (h(26 + i) - 0.5) * 26, PATH_TOP + ss * 0.25, z + (h(29 + i) - 0.5) * 26, ss, ss * 0.55, ss, h(32 + i) * 6,
              jit(0xa08a6e, c, r, 35 + i, 0.18));
          }
        } else if (v === T.MUD) {
          for (let i = 0; i < 2; i++) {
            const s = 5 + h(20 + i) * 5;
            L.put('puddle', x + (h(22 + i) - 0.5) * 12, PATH_TOP + 0.08 + i * 0.02, z + (h(24 + i) - 0.5) * 12, s, 1, s * (0.7 + h(26 + i) * 0.5), h(28 + i) * 3,
              jit(0x5a3c22, c, r, 30 + i, 0.05));
          }
          for (let i = 0; i < 2; i++) {
            const s = 0.7 + h(40 + i) * 0.9;
            L.put('bubble', x + (h(42 + i) - 0.5) * 18, PATH_TOP, z + (h(44 + i) - 0.5) * 18, s, s * 0.8, s);
          }
        }
      }
    }
  }

  // Water ripples: one expanding ring per water tile, animated in tick().
  const ripples = [];
  for (const [c, r] of waterTiles) {
    if (hash(c, r, 70) < 0.35) continue;
    const item = { x: tx(c) + (hash(c, r, 71) - 0.5) * 14, z: tz(r) + (hash(c, r, 72) - 0.5) * 14, ph: hash(c, r, 73) * 3 };
    ripples.push(item);
    L.put('ripple', item.x, WATER_TOP + 0.2, item.z, 0.01, 1, 0.01, 0, 0xffffff);
  }

  const built = L.build();

  // --- spawn portal + base keep ---
  const animated = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = map.grid[r][c];
      if (v !== T.SPAWN && v !== T.BASE) continue;
      // face the adjoining road
      let dir = [1, 0];
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = at(c + dc, r + dr);
        if (n === T.PATH || n === T.MUD) { dir = [dc, dr]; break; }
      }
      const obj = v === T.SPAWN ? buildPortal() : buildKeep();
      obj.position.set(tx(c), PATH_TOP, tz(r));
      obj.rotation.y = Math.atan2(-dir[1], dir[0]);
      group.add(obj);
      animated.push(obj);
    }
  }

  const rippleMesh = built.ripple;
  const waterMesh = built.water;
  const m4 = new THREE.Matrix4();
  const rc = new THREE.Color();
  const water = new THREE.Color(0x3d93d6);
  group.userData.tick = (t) => {
    if (waterMesh) waterMesh.position.y = Math.sin(t * 1.3) * 0.25;
    if (rippleMesh) {
      ripples.forEach((it, k) => {
        const f = ((t * 0.45 + it.ph) % 1);
        const s = 1.5 + f * 9;
        m4.makeScale(s, 1, s).setPosition(it.x, WATER_TOP + 0.2 + Math.sin(t * 1.3) * 0.25, it.z);
        rippleMesh.setMatrixAt(k, m4);
        rippleMesh.setColorAt(k, rc.setRGB(1, 1, 1).lerp(water, f));
      });
      rippleMesh.instanceMatrix.needsUpdate = true;
      rippleMesh.instanceColor.needsUpdate = true;
    }
    for (const o of animated) o.userData.tick?.(t);
  };
  return group;
}

// Stone archway with a swirling red rift; faces local +x.
function buildPortal() {
  const g = new THREE.Group();
  const stone = std(0x57534e, { rough: 0.85, flat: true });
  const dark = std(0x292524, { rough: 0.9, flat: true });
  const rune = glow(0xff5a36);
  g.add(mk(new THREE.CylinderGeometry(14, 15, 1.2, 10), dark, 0, 0.6, 0));
  for (const z of [-11.5, 11.5]) {
    g.add(mk(new THREE.BoxGeometry(6, 24, 5.5), stone, -1, 12.5, z));
    g.add(mk(new THREE.BoxGeometry(7.5, 3, 7), dark, -1, 1.5, z));
    g.add(mk(new THREE.BoxGeometry(0.6, 3, 1.4), rune, 2.05, 10, z), mk(new THREE.BoxGeometry(0.6, 1.4, 3), rune, 2.05, 16, z));
  }
  const lintel = mk(new THREE.BoxGeometry(7.5, 4.5, 31), stone, -1, 26.5, 0);
  const cap = mk(new THREE.BoxGeometry(5, 3, 8), dark, -1, 30, 0);
  const gem = mk(new THREE.OctahedronGeometry(2.2), glow(0xff7043), 2.8, 26.5, 0, false);
  g.add(lintel, cap, gem);
  // rift: layered additive discs spinning in opposite directions
  const rift = new THREE.Group();
  rift.position.set(-1, 13, 0);
  rift.rotation.y = Math.PI / 2;
  const d1 = new THREE.Mesh(new THREE.CircleGeometry(8.6, 32), glow(0x7f1d1d, 0.95));
  const d2 = new THREE.Mesh(new THREE.RingGeometry(3, 8.6, 5, 1), glow(0xff3b1f, 0.55, true));
  const d3 = new THREE.Mesh(new THREE.RingGeometry(1, 6, 3, 1), glow(0xffa24c, 0.5, true));
  d1.scale.y = d2.scale.y = d3.scale.y = 1.35;
  d2.position.z = 0.2; d3.position.z = 0.4;
  rift.add(d1, d2, d3);
  g.add(rift);
  const floor = new THREE.Mesh(new THREE.RingGeometry(9, 13, 32).rotateX(-Math.PI / 2), glow(0xef4444, 0.45, true));
  floor.position.y = 1.3;
  g.add(floor);
  g.userData.tick = (t) => {
    d2.rotation.z = t * 1.6;
    d3.rotation.z = -t * 2.4;
    const p = 1 + Math.sin(t * 3) * 0.05;
    rift.scale.set(p, p, 1);
    floor.material.opacity = 0.3 + Math.sin(t * 3) * 0.15;
  };
  return g;
}

// Round stone keep crowned by a floating, spinning blue crystal.
function buildKeep() {
  const g = new THREE.Group();
  const stone = std(0xb8bcc4, { rough: 0.8, flat: true });
  const dark = std(0x4b5563, { rough: 0.85, flat: true });
  const blue = std(0x2563eb, { rough: 0.5, metal: 0.2 });
  g.add(mk(new THREE.CylinderGeometry(14, 15, 2, 12), dark, 0, 1, 0));
  g.add(mk(new THREE.CylinderGeometry(9.5, 11, 15, 12), stone, 0, 9.5, 0));
  g.add(mk(new THREE.CylinderGeometry(11, 11, 2.2, 12), dark, 0, 17.6, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const m = mk(new THREE.BoxGeometry(3.2, 3, 3.2), stone, Math.cos(a) * 9.8, 20.2, Math.sin(a) * 9.8);
    m.rotation.y = -a;
    g.add(m);
  }
  // gate + banners facing the road (+x)
  g.add(mk(new THREE.BoxGeometry(1.2, 7, 5.5), std(0x3f2a1a), 10.2, 5.5, 0));
  g.add(mk(new THREE.CylinderGeometry(2.75, 2.75, 1.2, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), std(0x3f2a1a), 10.2, 9, 0));
  for (const z of [-6, 6]) g.add(mk(new THREE.BoxGeometry(0.6, 7, 3.2), blue, 10.4, 11, z));
  const crystal = new THREE.Group();
  crystal.position.y = 30;
  const core = mk(new THREE.OctahedronGeometry(6), std(0xbfdbfe, { rough: 0.15, metal: 0.1, emissive: 0x3b82f6, ei: 0.9, flat: true }), 0, 0, 0, false);
  core.scale.y = 1.5;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(9, 0.6, 6, 40), glow(0x93c5fd, 0.8, true));
  halo.rotation.x = Math.PI / 2;
  crystal.add(core, halo);
  g.add(crystal);
  const floor = new THREE.Mesh(new THREE.RingGeometry(14.5, 15.5, 40).rotateX(-Math.PI / 2), glow(0x60a5fa, 0.6, true));
  floor.position.y = 0.3;
  g.add(floor);
  g.userData.tick = (t) => {
    core.rotation.y = t * 0.9;
    crystal.position.y = 30 + Math.sin(t * 1.8) * 1.4;
    halo.rotation.z = t * 0.5;
    halo.rotation.x = Math.PI / 2 + Math.sin(t * 1.1) * 0.15;
  };
  return g;
}
