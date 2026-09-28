// Tower mesh factory shared by the game view, menu diorama and showroom.
// Every tower = static octagonal stone plinth with a colored trim band +
// a rotating head (turntable + weapon) that faces local +x. Animated parts
// (spinning barrels, floating crystals, orbiting shards, recoil) are tagged
// via userData.part and driven by animateTower().
import { THREE, std, glow, mk, shade, tint, collectParts, setFlash } from './art3d.js';

const IRON = 0x2f343b;
const STEEL = 0x9aa4b2;
const WOOD = 0x7a4a24;
const GOLD = 0xf5c542;

function cyl(rt, rb, h, seg = 12) { return new THREE.CylinderGeometry(rt, rb, h, seg); }
// Cylinder lying along +x (for barrels).
function barrelGeo(rt, rb, len, seg = 12) {
  return new THREE.CylinderGeometry(rt, rb, len, seg).rotateZ(-Math.PI / 2);
}
function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

export function buildTowerMesh(type, colorHex) {
  const g = new THREE.Group();
  const accent = std(colorHex, { rough: 0.45, metal: 0.25 });
  const accentDark = std(shade(colorHex, 0.55), { rough: 0.55, metal: 0.2 });
  const stone = std(0x8b8f98, { rough: 0.85, flat: true });
  const stoneDark = std(0x6e737d, { rough: 0.9, flat: true });
  const iron = std(IRON, { rough: 0.4, metal: 0.75 });
  const steel = std(STEEL, { rough: 0.3, metal: 0.85 });

  // --- static plinth ---
  const base = new THREE.Group();
  const plinth = mk(cyl(12.4, 14, 5, 8), stone, 0, 2.5, 0);
  plinth.rotation.y = Math.PI / 8;
  const band = mk(cyl(12.9, 12.9, 1.6, 8), accent, 0, 4.2, 0);
  band.rotation.y = Math.PI / 8;
  const cap = mk(cyl(11, 12.4, 1.4, 8), stoneDark, 0, 5.6, 0);
  cap.rotation.y = Math.PI / 8;
  base.add(plinth, band, cap);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const b = mk(box(3.4, 5.6, 3.4), stoneDark, Math.cos(a) * 13, 2.8, Math.sin(a) * 13);
    b.rotation.y = -a;
    base.add(b);
  }
  g.add(base);

  // --- rotating head ---
  const head = new THREE.Group();
  head.position.y = 6.3;
  const turn = mk(cyl(9, 10, 2, 16), std(0x7c8594, { rough: 0.45, metal: 0.55 }), 0, 1, 0);
  head.add(mk(new THREE.TorusGeometry(9.3, 0.5, 6, 24).rotateX(Math.PI / 2), accent, 0, 1.9, 0, false));
  head.add(turn);
  const add = (mesh, parent = head) => { parent.add(mesh); return mesh; };
  const part = (obj, name, extra = {}) => { obj.userData.part = name; Object.assign(obj.userData, extra); return obj; };
  const Y = 2; // head deck height
  // muzzle marker: where shots leave the weapon (read by the shot FX)
  const muzzle = (parent, x, y, z = 0) => {
    const m = new THREE.Object3D();
    m.position.set(x, y, z);
    m.userData.part = 'muzzle';
    parent.add(m);
  };

  switch (type) {
    case 'arrow': {
      // ballista: wooden stock, swept bow, loaded bolt with gold fletching
      const wood = std(WOOD, { rough: 0.8 });
      const woodDark = std(0x4a2c14, { rough: 0.85 });
      add(mk(box(5, 5, 5), woodDark, 0, Y + 2.5, 0));
      const rig = part(new THREE.Group(), 'recoil', { amt: 1.2 });
      rig.position.set(0, Y + 6, 0);
      rig.rotation.z = 0.08;
      head.add(rig);
      add(mk(box(20, 2.2, 3.4), wood, 2, 0, 0), rig);
      const arc = Math.PI * 0.72;
      const bow = mk(new THREE.TorusGeometry(10, 0.9, 6, 18, arc), woodDark, -1.5, 0.6, 0);
      bow.rotation.set(Math.PI / 2, 0, -arc / 2);
      add(bow, rig);
      const tipX = -1.5 + 10 * Math.cos(arc / 2), tipZ = 10 * Math.sin(arc / 2);
      add(mk(box(0.35, 0.35, tipZ * 2), std(0xe7e5e4), tipX - 3, 0.6, 0, false), rig);
      add(mk(barrelGeo(0.55, 0.55, 18, 6), std(0xd6c7a1), 3, 1.8, 0), rig);
      add(mk(new THREE.ConeGeometry(1.3, 3.2, 6).rotateZ(-Math.PI / 2), steel, 13.4, 1.8, 0), rig);
      for (const s of [-1, 1]) add(mk(box(3.2, 0.2, 1.6), accent, -4.5, 1.8, s * 0.9, false), rig);
      muzzle(rig, 16, 1.8);
      break;
    }
    case 'cannon': {
      const cheekMat = accentDark;
      for (const z of [-5.5, 5.5]) add(mk(box(11, 7, 2), cheekMat, -1, Y + 3.5, z));
      add(mk(barrelGeo(1.2, 1.2, 13, 8), iron, -1, Y + 5.5, 0));
      const rig = part(new THREE.Group(), 'recoil', { amt: 2.6 });
      rig.position.set(0, Y + 6.5, 0);
      rig.rotation.z = 0.12;
      head.add(rig);
      const prof = [[0, -8], [2.8, -8], [3.6, -7], [5, -6], [5.2, -3], [4.4, 6], [4.2, 8.5], [5.4, 9], [5.4, 11], [3.3, 11], [3.2, 4]]
        .map(([r, y]) => new THREE.Vector2(r, y));
      const barrel = mk(new THREE.LatheGeometry(prof, 16).rotateZ(-Math.PI / 2), std(0x3a3f47, { rough: 0.35, metal: 0.8 }), 1, 0, 0);
      add(barrel, rig);
      add(mk(new THREE.SphereGeometry(2, 10, 8), iron, -8.5, 0, 0), rig);
      for (const x of [-3, 5]) add(mk(new THREE.TorusGeometry(5.1, 0.6, 6, 20).rotateY(Math.PI / 2), accent, x, 0, 0), rig);
      muzzle(rig, 13, 0);
      break;
    }
    case 'frost': {
      const ice = std(0xbfefff, { rough: 0.15, metal: 0.1, emissive: 0x0e7490, ei: 0.35, flat: true });
      add(mk(cyl(4.5, 7, 5, 6), std(0xd9f3fb, { rough: 0.4, flat: true }), 0, Y + 2.5, 0));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const sh = mk(new THREE.ConeGeometry(1.6, 7 + (i % 2) * 3, 5), ice, Math.cos(a) * 6, Y + 4, Math.sin(a) * 6);
        sh.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        add(sh);
      }
      const fl = part(new THREE.Group(), 'float', { baseY: Y + 15, spin: 0.015 });
      fl.position.y = Y + 15;
      head.add(fl);
      const crystal = mk(new THREE.OctahedronGeometry(5.2), std(0x9befff, {
        rough: 0.05, metal: 0.2, emissive: 0x22d3ee, ei: 0.6, flat: true, opacity: 0.92,
      }), 0, 0, 0);
      crystal.scale.y = 1.7;
      add(crystal, fl);
      const ring = part(new THREE.Mesh(new THREE.TorusGeometry(8, 0.45, 6, 36), glow(0xa5f3fc, 0.8, true)), 'spin', { axis: 'z', speed: 0.03 });
      ring.rotation.x = Math.PI / 2.4;
      add(ring, fl);
      muzzle(fl, 0, 0);
      break;
    }
    case 'sniper': {
      const body = std(0x3b3552, { rough: 0.45, metal: 0.5 });
      add(mk(box(6, 5, 6), accentDark, 0, Y + 2.5, 0));
      const rig = part(new THREE.Group(), 'recoil', { amt: 2.2 });
      rig.position.set(0, Y + 6.5, 0);
      head.add(rig);
      add(mk(box(12, 4, 4.4), body, 0, 0, 0), rig);
      add(mk(box(7, 3, 3), accent, -8, -0.6, 0), rig);
      add(mk(barrelGeo(1.1, 1.3, 20, 10), iron, 15, 0.4, 0), rig);
      add(mk(box(3.6, 2.2, 2.2), iron, 25, 0.4, 0), rig);
      add(mk(barrelGeo(1.6, 1.6, 9, 12), iron, 1, 4, 0), rig);
      add(mk(new THREE.CylinderGeometry(1.35, 1.35, 0.4, 12).rotateZ(-Math.PI / 2), glow(0xff3b6b), 5.6, 4, 0, false), rig);
      for (const x of [-1, 3]) add(mk(box(1, 2.2, 1), iron, x, 2.4, 0), rig);
      muzzle(rig, 27, 0.4);
      break;
    }
    case 'gatling': {
      const housing = std(0x8a96a8, { rough: 0.4, metal: 0.6 });
      add(mk(box(6, 4, 7), iron, 0, Y + 2, 0));
      const rig = part(new THREE.Group(), 'recoil', { amt: 0.6 });
      rig.position.set(0, Y + 6.5, 0);
      head.add(rig);
      add(mk(box(9, 6.5, 8.5), housing, -1, 0, 0), rig);
      for (const z of [-4.5, 4.5]) add(mk(box(7, 5, 0.6), accent, -1, 0, z), rig);
      add(mk(box(4, 4.5, 3.6), std(0x4d5b2e, { rough: 0.8 }), -2, -1, -6.8), rig);
      const spinner = part(new THREE.Group(), 'spin', { axis: 'x', speed: 0.05, fireSpeed: 0.7 });
      spinner.position.set(9, 0, 0);
      rig.add(spinner);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        spinner.add(mk(barrelGeo(0.75, 0.75, 13, 8), steel, 0, Math.cos(a) * 2.3, Math.sin(a) * 2.3));
      }
      for (const x of [-5, 5.5]) spinner.add(mk(barrelGeo(3.4, 3.4, 1.2, 12), iron, x, 0, 0));
      spinner.add(mk(barrelGeo(1, 1, 14, 8), iron, 0, 0, 0));
      muzzle(rig, 17, 0);
      break;
    }
    case 'tesla': {
      const copper = std(0xc2702d, { rough: 0.3, metal: 0.9 });
      add(mk(cyl(2, 3.4, 16, 10), iron, 0, Y + 8, 0));
      [5.2, 4.4, 3.6].forEach((rad, i) => add(mk(new THREE.TorusGeometry(rad, 1, 8, 20).rotateX(Math.PI / 2), copper, 0, Y + 4 + i * 4.2, 0)));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const rod = mk(cyl(0.45, 0.6, 9, 6), steel, Math.cos(a) * 6.5, Y + 4.5, Math.sin(a) * 6.5);
        rod.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
        add(rod);
        add(mk(new THREE.SphereGeometry(1.1, 8, 6), accent, Math.cos(a) * 8, Y + 8.8, Math.sin(a) * 8));
      }
      const orb = part(mk(new THREE.SphereGeometry(4.2, 18, 14), std(0xfff3a0, { rough: 0.2, emissive: 0xfacc15, ei: 0.9 }), 0, Y + 19, 0), 'pulse');
      add(orb);
      const arcs = part(new THREE.Mesh(new THREE.IcosahedronGeometry(6, 0), new THREE.MeshBasicMaterial({ color: 0xfef08a, wireframe: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })), 'spin', { axis: 'y', speed: 0.09 });
      arcs.position.y = Y + 19;
      add(arcs);
      muzzle(head, 0, Y + 19);
      break;
    }
    case 'missile': {
      add(mk(box(4, 5, 10), iron, 0, Y + 2.5, 0));
      for (const z of [-5.8, 5.8]) add(mk(box(4, 8, 1.2), accentDark, 0, Y + 5, z));
      const rig = part(new THREE.Group(), 'recoil', { amt: 1.4 });
      rig.position.set(0, Y + 8, 0);
      rig.rotation.z = 0.42;
      head.add(rig);
      add(mk(box(11, 8, 10.5), std(0x8f2430, { rough: 0.5, metal: 0.3 }), 0, 0, 0), rig);
      add(mk(box(11.4, 1, 10.9), accent, 0, 4.2, 0), rig);
      for (const z of [-5.6, 5.6]) add(mk(box(8, 2.2, 0.6), std(0xfacc15, { rough: 0.5 }), -0.5, -1.5, z), rig);
      add(mk(box(3, 1.6, 3), iron, -3.5, 4.8, 0), rig);
      const warhead = std(0xf1f5f9, { rough: 0.4, metal: 0.2 });
      const tip = std(colorHex, { rough: 0.4 });
      for (const y of [-2, 2]) {
        for (const z of [-2.6, 2.6]) {
          add(mk(barrelGeo(1.9, 1.9, 1.4, 12), iron, 6.2, y, z), rig);
          add(mk(barrelGeo(1.3, 1.3, 4, 10), warhead, 7.6, y, z), rig);
          add(mk(new THREE.ConeGeometry(1.3, 3, 10).rotateZ(-Math.PI / 2), tip, 11.1, y, z), rig);
        }
      }
      muzzle(rig, 12, 0);
      break;
    }
    case 'mortar': {
      add(mk(cyl(8, 9, 2.5, 16), stoneDark, 0, Y + 1.25, 0));
      for (const z of [-5, 5]) add(mk(box(6, 6, 1.4), iron, 0, Y + 5, z));
      const rig = part(new THREE.Group(), 'recoil', { amt: 1.6, axis: 'y' });
      rig.position.set(0, Y + 7, 0);
      head.add(rig);
      const tube = new THREE.Group();
      tube.rotation.z = -0.78;
      rig.add(tube);
      const prof = [[0, -4], [4.6, -4], [5.6, -2], [5.4, 7], [6.6, 7.6], [6.6, 10], [4.4, 10], [4.3, 0]]
        .map(([r, y]) => new THREE.Vector2(r, y));
      tube.add(mk(new THREE.LatheGeometry(prof, 18), std(0x6b665f, { rough: 0.4, metal: 0.65 })));
      tube.add(mk(new THREE.TorusGeometry(6.2, 0.8, 6, 20).rotateX(Math.PI / 2), std(0x44403c, { metal: 0.6, rough: 0.4 }), 0, 8.8, 0));
      tube.add(mk(new THREE.TorusGeometry(5.6, 0.7, 6, 20).rotateX(Math.PI / 2), accent, 0, 3, 0));
      tube.add(mk(new THREE.CircleGeometry(4.3, 16).rotateX(-Math.PI / 2), glow(0x0c0a09), 0, 6, 0, false));
      add(mk(barrelGeo(1.3, 1.3, 12, 8).rotateY(Math.PI / 2), iron, 0, Y + 5.5, 0));
      muzzle(tube, 0, 10);
      break;
    }
    case 'railgun': {
      add(mk(box(6, 4, 6), iron, 0, Y + 2, 0));
      const rig = part(new THREE.Group(), 'recoil', { amt: 1.8 });
      rig.position.set(0, Y + 6.5, 0);
      head.add(rig);
      add(mk(box(9, 5.5, 9), std(0x3d5a78, { rough: 0.35, metal: 0.6 }), -4, 0, 0), rig);
      add(mk(box(9.4, 0.8, 9.4), accent, -4, 2.2, 0), rig);
      for (const z of [-5, 5]) add(mk(box(6, 3, 1), std(0x1e293b, { metal: 0.5, rough: 0.4 }), -4, 0, z), rig);
      for (const z of [-3.2, 3.2]) add(mk(box(22, 1.8, 1.4), steel, 10, 0, z), rig);
      const beam = mk(barrelGeo(0.7, 0.7, 22, 8), glow(0x7dd3fc), 10, 0, 0, false);
      add(beam, rig);
      const coilMat = std(0x38bdf8, { rough: 0.2, metal: 0.4, emissive: 0x0ea5e9, ei: 0.8 });
      for (const x of [3, 8, 13, 18]) add(mk(new THREE.TorusGeometry(4.3, 0.8, 6, 16).rotateY(Math.PI / 2), coilMat, x, 0, 0), rig);
      add(mk(box(1, 3, 5), glow(0x38bdf8), -8.6, 0, 0, false), rig);
      muzzle(rig, 21, 0);
      break;
    }
    case 'tempest': {
      const teal = std(0x115e59, { rough: 0.4, metal: 0.5 });
      add(mk(cyl(3.6, 6, 6, 6), teal, 0, Y + 3, 0));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const prong = mk(cyl(0.8, 1.5, 13, 6), teal, Math.cos(a) * 5, Y + 10, Math.sin(a) * 5);
        prong.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
        add(prong);
        add(mk(new THREE.SphereGeometry(1.4, 8, 6), glow(0x99f6e4), Math.cos(a) * 7.7, Y + 16, Math.sin(a) * 7.7, false));
      }
      const fl = part(new THREE.Group(), 'float', { baseY: Y + 14, spin: 0.03 });
      fl.position.y = Y + 14;
      head.add(fl);
      const gem = mk(new THREE.OctahedronGeometry(4.2), std(0x5eead4, { rough: 0.1, metal: 0.2, emissive: 0x14b8a6, ei: 0.8, flat: true }), 0, 0, 0);
      gem.scale.y = 1.4;
      add(gem, fl);
      const orbit = part(new THREE.Group(), 'spin', { axis: 'y', speed: 0.06 });
      orbit.position.y = Y + 14;
      head.add(orbit);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const shard = mk(new THREE.TetrahedronGeometry(1.6), std(0xccfbf1, { emissive: 0x2dd4bf, ei: 0.7, flat: true }), Math.cos(a) * 8.5, 0, Math.sin(a) * 8.5);
        shard.rotation.set(a, a * 2, 0);
        orbit.add(shard);
      }
      muzzle(fl, 0, 0);
      break;
    }
    default:
      add(mk(new THREE.SphereGeometry(5, 12, 10), accent, 0, Y + 5, 0));
      muzzle(head, 0, Y + 5);
  }
  g.add(head);

  g.userData.head = head;
  g.userData.parts = collectParts(head);
  g.userData.muzzle = g.userData.parts.muzzle?.[0] || head;
  for (const r of g.userData.parts.recoil || []) r.userData.home = r.position.clone();
  const mats = new Set();
  head.traverse((o) => { if (o.isMesh && o.material.emissive) mats.add(o.material); });
  g.userData.flashMats = [...mats];
  g.userData.glow = tint(colorHex, 0xffffff, 0.2);
  g.userData.level = 1;
  g.userData.levelGroup = null;
  g.userData.recoil = 0;
  return g;
}

// Per-frame tower animation. `fire` = tower fired within its flash window.
export function animateTower(g, t, fire = false) {
  const u = g.userData;
  const parts = u.parts || {};
  for (const o of parts.spin || []) {
    const sp = fire && o.userData.fireSpeed ? o.userData.fireSpeed : o.userData.speed;
    o.rotation[o.userData.axis || 'y'] += sp;
  }
  for (const o of parts.float || []) {
    o.position.y = o.userData.baseY + Math.sin(t * 2 + g.id) * 1.1;
    o.rotation.y += o.userData.spin || 0.02;
  }
  for (const o of parts.pulse || []) o.scale.setScalar(1 + Math.sin(t * 7 + g.id) * 0.07 + (fire ? 0.2 : 0));
  u.recoil = fire ? 1 : u.recoil * 0.82;
  for (const o of parts.recoil || []) {
    const h = o.userData.home;
    if (o.userData.axis === 'y') o.position.y = h.y - u.recoil * o.userData.amt;
    else o.position.x = h.x - u.recoil * o.userData.amt;
  }
}

// Fire / level-up glow on every head material.
export function flashTower(g, on) {
  for (const m of g.userData.flashMats) setFlash(m, g.userData.glow, on ? 0.9 : 0);
}

// Level dressing: gold studs on the trim band (one per level above 1,
// max 5), a gold crown ring from level 4, a pennant from level 6, and a
// slightly grander stature — level reads at a glance from any angle.
export function setTowerLevel(g, level) {
  if (g.userData.level === level) return;
  g.userData.level = level;
  const old = g.userData.levelGroup;
  if (old) {
    g.remove(old);
    old.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
  const lg = new THREE.Group();
  const gold = std(GOLD, { rough: 0.25, metal: 0.9, emissive: 0x6b4a00, ei: 0.4 });
  const n = Math.min(Math.max(0, level - 1), 5);
  for (let i = 0; i < n; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 8 + Math.PI / 5;
    const pip = mk(new THREE.OctahedronGeometry(1.9), gold, Math.cos(a) * 13.3, 4.2, Math.sin(a) * 13.3);
    pip.scale.y = 1.35;
    lg.add(pip);
  }
  if (level >= 4) {
    const crown = mk(new THREE.TorusGeometry(11.4, 0.7, 6, 32).rotateX(Math.PI / 2), gold, 0, 6.4, 0);
    lg.add(crown);
  }
  if (level >= 6) {
    const pole = mk(cyl(0.4, 0.4, 16, 6), gold, -10, 13, -10);
    const flag = mk(new THREE.PlaneGeometry(6, 3.6), std(0xdc2626, { side: THREE.DoubleSide, rough: 0.8 }), -10, 19, -7, true);
    flag.rotation.y = Math.PI / 2;
    lg.add(pole, flag);
  }
  g.userData.levelGroup = lg;
  g.add(lg);
  g.scale.setScalar(Math.min(1.3, 1 + (level - 1) * 0.06));
}
