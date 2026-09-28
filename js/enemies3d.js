// Enemy mesh factory shared by the game view, codex viewer and menu diorama.
// One cached template per (shape, color, radius); each enemy is a clone that
// shares geometry + most materials, with its own hit-flash and HP-bar
// materials. Layout per enemy:
//   g (positioned / yawed by the caller, faces local +x)
//   └ root (y = road height)
//       ├ rig   — the creature; bobbed / squashed by animateEnemy()
//       ├ slow  — frost ring decal
//       └ bars  — billboard HP bar
import { THREE, std, glow, mk, shade, tint, collectParts, setFlash } from './art3d.js';
import { PATH_TOP } from './terrain3d.js';

const templates = new Map();

function sphere(r, w = 14, h = 10) { return new THREE.SphereGeometry(r, w, h); }

function flashy(mesh) { mesh.userData.flash = true; return mesh; }
function tag(obj, part, extra) { obj.userData.part = part; if (extra) Object.assign(obj.userData, extra); return obj; }

function buildRig(e) {
  const r = e.r;
  const by = 7 + r * 0.4; // body center height (matches the old silhouette)
  const baseHex = parseInt((e.color || '#9ca3af').slice(1), 16);
  const dark = shade(baseHex, 0.5);
  const light = tint(baseHex, 0xffffff, 0.45);
  const shape = e.shape || e.type;
  const rig = new THREE.Group();
  const add = (m, parent = rig) => { parent.add(m); return m; };
  const skin = std(baseHex, { rough: 0.6 });
  const eyeWhite = std(0xffffff, { rough: 0.3 });
  const pupil = std(0x0b0f19, { rough: 0.2 });

  switch (shape) {
    case 'dart': {
      // sleek hover-dart: faceted fuselage, glass canopy, swept fins, thruster
      const hull = std(baseHex, { rough: 0.35, metal: 0.35, flat: true });
      const body = flashy(mk(new THREE.ConeGeometry(r * 0.85, r * 2.8, 6).rotateZ(-Math.PI / 2), hull, 0, by, 0));
      body.scale.set(1, 0.7, 1);
      add(body);
      const canopy = add(mk(sphere(r * 0.42, 12, 8), std(0xcff6ff, { rough: 0.05, metal: 0.4, emissive: 0x0891b2, ei: 0.25 }), r * 0.1, by + r * 0.42, 0));
      canopy.scale.set(1.8, 0.8, 1);
      for (const s of [-1, 1]) {
        const fin = add(mk(new THREE.BoxGeometry(r * 1.1, 0.8, r * 0.9), std(dark, { rough: 0.5, metal: 0.3 }), -r * 0.7, by - r * 0.1, s * r * 0.85));
        fin.rotation.y = s * 0.5;
      }
      const tail = add(mk(new THREE.BoxGeometry(r * 0.8, r * 0.8, 0.8), std(dark, { rough: 0.5 }), -r * 1.05, by + r * 0.45, 0));
      tail.rotation.z = 0.5;
      add(mk(new THREE.CylinderGeometry(r * 0.4, r * 0.5, r * 0.4, 10).rotateZ(-Math.PI / 2), std(0x334155, { metal: 0.7, rough: 0.3 }), -r * 1.45, by, 0));
      add(tag(mk(new THREE.ConeGeometry(r * 0.38, r * 1.3, 10).rotateZ(Math.PI / 2), glow(0xffc0e6, 0.85, true), -r * 2.2, by, 0, false), 'thrust'));
      break;
    }
    case 'armor': {
      // tracked bulwark: road wheels, sloped hull, turret with stubby gun
      const hull = std(baseHex, { rough: 0.5, metal: 0.35, flat: true });
      const tread = std(0x1f1d1b, { rough: 0.9 });
      const wheel = std(0x57534e, { rough: 0.5, metal: 0.6 });
      const body = flashy(mk(new THREE.BoxGeometry(r * 1.8, r * 0.62, r * 1.45), hull, 0, r * 0.66, 0));
      add(body);
      const glacis = add(mk(new THREE.BoxGeometry(r * 0.6, r * 0.5, r * 1.44), hull, r * 0.95, r * 0.6, 0));
      glacis.rotation.z = 0.7;
      for (const s of [-1, 1]) {
        add(mk(new THREE.BoxGeometry(r * 2.05, r * 0.62, r * 0.42), tread, 0, r * 0.31, s * r * 0.9));
        for (let i = 0; i < 4; i++) {
          add(tag(mk(new THREE.CylinderGeometry(r * 0.22, r * 0.22, r * 0.12, 10).rotateX(Math.PI / 2), wheel, -r * 0.72 + i * r * 0.48, r * 0.3, s * r * 1.12), 'wheel'));
        }
        add(mk(new THREE.BoxGeometry(r * 2.1, r * 0.08, r * 0.5), std(dark, { rough: 0.6 }), 0, r * 0.66, s * r * 0.9));
      }
      const turret = add(mk(new THREE.CylinderGeometry(r * 0.5, r * 0.6, r * 0.42, 8), std(tint(baseHex, 0x000000, 0.15), { rough: 0.5, metal: 0.35, flat: true }), -r * 0.1, r * 1.18, 0));
      turret.rotation.y = Math.PI / 8;
      add(mk(new THREE.CylinderGeometry(r * 0.12, r * 0.14, r * 1.1, 8).rotateZ(-Math.PI / 2), std(0x292524, { metal: 0.7, rough: 0.35 }), r * 0.75, r * 1.2, 0));
      add(mk(new THREE.CylinderGeometry(r * 0.2, r * 0.2, r * 0.12, 10), std(0xe7e5e4, { metal: 0.5, rough: 0.3 }), -r * 0.25, r * 1.45, 0));
      break;
    }
    case 'beetle': {
      // mite: domed split carapace, six skittering legs, buzzing wings
      const shell = std(baseHex, { rough: 0.25, metal: 0.25 });
      const body = flashy(mk(sphere(r, 16, 10), shell, 0, by, 0));
      body.scale.set(1.15, 0.72, 0.95);
      add(body);
      add(mk(new THREE.BoxGeometry(r * 2.1, r * 0.1, r * 0.12), std(dark), 0, by + r * 0.7, 0, false));
      for (const s of [-1, 1]) {
        const spot = add(mk(sphere(r * 0.22, 8, 6), std(dark, { rough: 0.4 }), -r * 0.25, by + r * 0.55, s * r * 0.45, false));
        spot.scale.y = 0.35;
      }
      const headMat = std(0x1f2a12, { rough: 0.5 });
      add(mk(sphere(r * 0.52, 10, 8), headMat, r * 1.0, by - r * 0.1, 0));
      for (const s of [-1, 1]) {
        add(mk(sphere(r * 0.16, 8, 6), glow(0xff4d4d), r * 1.38, by + r * 0.08, s * r * 0.25, false));
        const ant = add(mk(new THREE.CylinderGeometry(0.25, 0.3, r * 1.1, 4), headMat, r * 1.55, by + r * 0.55, s * r * 0.3));
        ant.rotation.set(s * 0.5, 0, -0.9);
      }
      const legMat = std(0x1f2a12, { rough: 0.6 });
      for (let i = 0; i < 3; i++) {
        for (const s of [-1, 1]) {
          const leg = tag(new THREE.Group(), 'leg', { phase: i * 2.1 + (s > 0 ? Math.PI : 0) });
          leg.position.set(r * (0.6 - i * 0.6), by - r * 0.2, s * r * 0.6);
          const seg = mk(new THREE.CylinderGeometry(0.35, 0.25, by + r * 0.2, 4), legMat, 0, -(by - r * 0.2) / 2, s * r * 0.35);
          seg.rotation.x = s * 0.55;
          leg.add(seg);
          add(leg);
        }
      }
      const wingMat = new THREE.MeshStandardMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.45, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false });
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.CircleGeometry(r * 0.75, 12), wingMat);
        wing.scale.set(1.5, 0.7, 1);
        wing.position.set(-r * 0.3, by + r * 0.72, s * r * 0.5);
        wing.rotation.x = -Math.PI / 2 + s * 0.5;
        wing.userData.wing = s;
        add(wing);
      }
      break;
    }
    case 'guardian': {
      // aegis: armored orb drone inside a translucent shield bubble
      const armor = std(baseHex, { rough: 0.3, metal: 0.55 });
      const body = flashy(mk(sphere(r * 0.82, 18, 14), armor, 0, by, 0));
      add(body);
      add(mk(new THREE.TorusGeometry(r * 0.83, r * 0.12, 6, 24).rotateX(Math.PI / 2), std(shade(baseHex, 0.45), { metal: 0.6, rough: 0.3 }), 0, by, 0));
      const visor = add(mk(new THREE.BoxGeometry(r * 0.3, r * 0.26, r * 1.0), std(0x0b1220, { rough: 0.1, metal: 0.5 }), r * 0.72, by + r * 0.2, 0));
      visor.rotation.z = -0.25;
      add(mk(new THREE.BoxGeometry(r * 0.1, r * 0.08, r * 0.8), glow(0x7dd3fc), r * 0.88, by + r * 0.22, 0, false));
      add(mk(new THREE.ConeGeometry(r * 0.35, r * 0.6, 10).rotateZ(Math.PI), std(0x334155, { metal: 0.7 }), 0, by - r * 0.9, 0));
      add(tag(mk(new THREE.ConeGeometry(r * 0.25, r * 0.8, 10).rotateZ(Math.PI), glow(0x93c5fd, 0.8, true), 0, by - r * 1.45, 0, false), 'thrust'));
      const bubble = new THREE.Mesh(sphere(r * 1.3, 24, 16), new THREE.MeshStandardMaterial({
        color: 0x93c5fd, emissive: 0x3b82f6, emissiveIntensity: 0.4, transparent: true, opacity: 0.2, roughness: 0.05, depthWrite: false,
      }));
      bubble.position.y = by;
      add(tag(bubble, 'shield'));
      const halo = new THREE.Mesh(new THREE.TorusGeometry(r + 3, 0.9, 8, 36), glow(0xbfdbfe, 0.9, true));
      halo.rotation.x = Math.PI / 2.4;
      halo.position.y = by;
      halo.userData.halo = true;
      add(halo);
      break;
    }
    case 'warlord': {
      // boss: faceted armored hulk, pauldrons with spikes, horned gold crown
      const hide = std(baseHex, { rough: 0.45, metal: 0.2, flat: true });
      const plate = std(shade(baseHex, 0.42), { rough: 0.35, metal: 0.6, flat: true });
      const gold = std(0xf5c542, { rough: 0.25, metal: 0.9, emissive: 0x5c3d00, ei: 0.35 });
      const body = flashy(mk(new THREE.DodecahedronGeometry(r, 0), hide, 0, by, 0));
      add(body);
      add(mk(new THREE.TorusGeometry(r * 0.9, r * 0.13, 6, 20).rotateX(Math.PI / 2), gold, 0, by - r * 0.35, 0));
      for (const s of [-1, 1]) {
        const pad = add(mk(sphere(r * 0.48, 10, 8), plate, -r * 0.05, by + r * 0.35, s * r * 0.92));
        pad.scale.y = 0.75;
        for (let i = 0; i < 2; i++) {
          const sp = add(mk(new THREE.ConeGeometry(r * 0.12, r * 0.55, 6), gold, -r * 0.2 + i * r * 0.3, by + r * 0.72, s * r * 1.05));
          sp.rotation.x = s * 0.4;
        }
        const fist = add(tag(mk(new THREE.DodecahedronGeometry(r * 0.32, 0), plate, r * 0.55, by - r * 0.45, s * r * 0.95), 'arm', { side: s }));
        fist.userData.home = [fist.position.x, fist.position.y, fist.position.z];
        const horn = add(mk(new THREE.ConeGeometry(r * 0.14, r * 0.8, 7), std(0xe7e0d0, { rough: 0.5 }), r * 0.35, by + r * 0.85, s * r * 0.5));
        horn.rotation.set(s * 0.8, 0, -0.35);
        add(mk(sphere(r * 0.17, 8, 6), glow(0xfff176), r * 0.8, by + r * 0.25, s * r * 0.3, false));
      }
      const brow = add(mk(new THREE.BoxGeometry(r * 0.2, r * 0.1, r * 0.8), gold, r * 0.8, by + r * 0.45, 0));
      brow.rotation.z = -0.3;
      add(mk(new THREE.CylinderGeometry(r * 0.46, r * 0.5, r * 0.26, 10), gold, -r * 0.05, by + r * 0.95, 0));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(mk(new THREE.ConeGeometry(r * 0.1, r * 0.4, 5), gold, -r * 0.05 + Math.cos(a) * r * 0.42, by + r * 1.25, Math.sin(a) * r * 0.42));
      }
      add(mk(new THREE.OctahedronGeometry(r * 0.12), glow(0xef4444), r * 0.4, by + r * 1.0, 0, false));
      break;
    }
    case 'wisp': {
      // wisp: glowing core in a pale aura, trailing motes
      const auraMat = new THREE.MeshStandardMaterial({ color: baseHex, emissive: 0x7dd3fc, emissiveIntensity: 0.55, transparent: true, opacity: 0.45, roughness: 0.2, depthWrite: false });
      const body = flashy(new THREE.Mesh(sphere(r, 16, 12), auraMat));
      body.position.y = by;
      add(body);
      add(tag(mk(sphere(r * 0.5, 12, 10), glow(0xffffff), 0, by, 0, false), 'core'));
      for (let i = 1; i <= 3; i++) {
        add(tag(mk(sphere(r * (0.55 - i * 0.12), 8, 6), glow(0xbae6fd, 0.7 - i * 0.15, true), -r * (0.7 + i * 0.75), by, 0, false), 'trail', { i }));
      }
      const motes = tag(new THREE.Group(), 'orbit');
      motes.position.y = by;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        motes.add(mk(new THREE.OctahedronGeometry(r * 0.16), glow(0xe0f2fe), Math.cos(a) * r * 1.4, Math.sin(a * 2) * r * 0.4, Math.sin(a) * r * 1.4, false));
      }
      add(motes);
      break;
    }
    case 'mitosis': {
      // splitter: two translucent cell lobes with visible nuclei
      const memb = new THREE.MeshStandardMaterial({ color: baseHex, emissive: shade(baseHex, 0.35), emissiveIntensity: 0.5, transparent: true, opacity: 0.72, roughness: 0.15 });
      const body = flashy(mk(sphere(r * 0.8, 18, 14), memb, r * 0.3, by, 0));
      add(body);
      const lobe = add(flashy(mk(sphere(r * 0.66, 16, 12), memb, -r * 0.55, by - r * 0.08, 0)));
      lobe.userData.part = 'lobe';
      const nuc = std(shade(baseHex, 0.55), { rough: 0.3, emissive: 0x6b21a8, ei: 0.3 });
      add(mk(sphere(r * 0.3, 10, 8), nuc, r * 0.35, by + r * 0.05, 0, false));
      add(mk(sphere(r * 0.24, 10, 8), nuc, -r * 0.6, by - r * 0.05, 0, false));
      add(mk(new THREE.TorusGeometry(r * 0.46, r * 0.1, 6, 20).rotateY(Math.PI / 2), std(light, { rough: 0.3 }), -r * 0.12, by - r * 0.03, 0, false));
      for (const s of [-1, 1]) {
        add(mk(sphere(r * 0.17, 8, 6), eyeWhite, r * 0.95, by + r * 0.22, s * r * 0.26));
        add(mk(sphere(r * 0.09, 8, 6), pupil, r * 1.08, by + r * 0.24, s * r * 0.26, false));
      }
      break;
    }
    case 'golem': {
      // walking avalanche: stacked boulders, fist rocks, molten cracks
      const rock = std(tint(baseHex, 0x57534e, 0.4), { rough: 0.95, flat: true });
      const rockD = std(0x44403c, { rough: 0.95, flat: true });
      const ember = glow(0xff8a3d);
      const body = flashy(mk(new THREE.DodecahedronGeometry(r * 0.85, 0), rock, 0, by, 0));
      body.scale.set(1, 0.95, 1.1);
      add(body);
      add(mk(new THREE.DodecahedronGeometry(r * 0.42, 0), rockD, r * 0.55, by + r * 0.72, 0));
      for (const s of [-1, 1]) {
        add(mk(new THREE.BoxGeometry(r * 0.12, r * 0.08, r * 0.14), ember, r * 0.93, by + r * 0.78, s * r * 0.15, false));
        const sh = add(mk(new THREE.DodecahedronGeometry(r * 0.38, 0), rockD, 0, by + r * 0.4, s * r * 0.95));
        sh.rotation.set(s, 1, 0);
        const fist = add(tag(mk(new THREE.DodecahedronGeometry(r * 0.42, 0), rock, r * 0.2, by - r * 0.45, s * r * 1.1), 'arm', { side: s }));
        fist.userData.home = [fist.position.x, fist.position.y, fist.position.z];
        add(tag(mk(new THREE.BoxGeometry(r * 0.5, by - r * 0.6, r * 0.5), rockD, 0, (by - r * 0.6) / 2, s * r * 0.45), 'leg', { phase: s > 0 ? Math.PI : 0 }));
        const moss = add(mk(sphere(r * 0.3, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), std(0x5f8f35, { rough: 1 }), -r * 0.05, by + r * 0.65, s * r * 0.9, false));
        moss.scale.y = 0.4;
      }
      for (let i = 0; i < 3; i++) {
        const crack = add(mk(new THREE.BoxGeometry(r * 0.08, r * 0.5, r * 0.08), ember, r * 0.78, by - r * 0.1 + (i - 1) * r * 0.1, (i - 1) * r * 0.3, false));
        crack.rotation.x = (i - 1) * 0.6;
      }
      add(mk(sphere(r * 0.2, 8, 6), ember, r * 0.8, by + r * 0.05, 0, false));
      break;
    }
    case 'phantom': {
      // hooded wraith: flowing lathe cloak, void face, pale eyes, ragged hem
      const cloth = std(baseHex, { rough: 0.8, emissive: shade(baseHex, 0.35), ei: 0.35, side: THREE.DoubleSide });
      const prof = [[1.0, 0], [0.9, 0.35], [0.72, 0.9], [0.62, 1.35], [0.58, 1.7], [0.45, 2.0], [0.22, 2.2], [0, 2.26]]
        .map(([x, y]) => new THREE.Vector2(x * r, y * r));
      const body = flashy(mk(new THREE.LatheGeometry(prof, 12), cloth, 0, by - r * 1.15, 0));
      add(body);
      const face = add(mk(sphere(r * 0.42, 12, 10), std(0x05030f, { rough: 1 }), r * 0.3, by + r * 0.55, 0, false));
      face.scale.set(0.7, 1, 1);
      for (const s of [-1, 1]) add(mk(sphere(r * 0.12, 8, 6), glow(0xc7f9ff), r * 0.56, by + r * 0.6, s * r * 0.17, false));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const rag = add(mk(new THREE.ConeGeometry(r * 0.2, r * 0.6, 4).rotateZ(Math.PI), cloth, Math.cos(a) * r * 0.9, by - r * 1.35, Math.sin(a) * r * 0.9));
        rag.rotation.y = a;
      }
      for (const s of [-1, 1]) {
        const sleeve = add(tag(mk(new THREE.ConeGeometry(r * 0.22, r * 1.0, 6), cloth, r * 0.45, by - r * 0.1, s * r * 0.7), 'arm', { side: s }));
        sleeve.rotation.set(s * 0.3, 0, -1.2);
        sleeve.userData.home = [sleeve.position.x, sleeve.position.y, sleeve.position.z];
      }
      const veil = new THREE.Mesh(new THREE.TorusGeometry(r + 2.5, 0.7, 8, 30), glow(0x67e8f9, 0.7, true));
      veil.rotation.x = Math.PI / 2.3;
      veil.position.y = by - r * 0.6;
      veil.userData.halo = true;
      add(veil);
      break;
    }
    default: {
      // grunt: stocky horned brute with belly, arms, stomping feet, tusks
      const body = flashy(mk(sphere(r, 18, 14), skin, 0, by, 0));
      body.scale.set(1, 0.92, 1);
      add(body);
      const belly = add(mk(sphere(r * 0.72, 14, 10), std(light, { rough: 0.7 }), r * 0.38, by - r * 0.18, 0));
      belly.scale.set(0.6, 0.9, 1);
      for (const s of [-1, 1]) {
        add(mk(sphere(r * 0.25, 10, 8), eyeWhite, r * 0.74, by + r * 0.28, s * r * 0.34));
        add(mk(sphere(r * 0.12, 8, 6), pupil, r * 0.94, by + r * 0.3, s * r * 0.34, false));
        const horn = add(mk(new THREE.ConeGeometry(r * 0.16, r * 0.6, 7), std(0xf1ead8, { rough: 0.5 }), -r * 0.05, by + r * 0.9, s * r * 0.48));
        horn.rotation.x = s * 0.55;
        const tusk = add(mk(new THREE.ConeGeometry(r * 0.08, r * 0.3, 5), std(0xffffff, { rough: 0.4 }), r * 0.9, by - r * 0.28, s * r * 0.22, false));
        tusk.rotation.z = -0.2;
        const arm = add(tag(mk(sphere(r * 0.3, 10, 8), skin, r * 0.1, by - r * 0.15, s * r * 1.02), 'arm', { side: s }));
        arm.userData.home = [arm.position.x, arm.position.y, arm.position.z];
        const foot = add(tag(mk(sphere(r * 0.34, 10, 6), std(dark, { rough: 0.8 }), 0, r * 0.25, s * r * 0.48), 'leg', { phase: s > 0 ? Math.PI : 0, stomp: true }));
        foot.scale.set(1.3, 0.7, 1);
        foot.userData.home = [foot.position.x, foot.position.y, foot.position.z];
      }
      const brow = add(mk(new THREE.BoxGeometry(r * 0.3, r * 0.14, r * 1.05), std(dark), r * 0.74, by + r * 0.55, 0));
      brow.rotation.z = -0.25;
      for (let i = -1; i <= 1; i++) {
        const sp = add(mk(new THREE.ConeGeometry(r * 0.16, r * 0.5, 5), std(dark, { rough: 0.6 }), -r * 0.92, by + r * 0.2, i * r * 0.45));
        sp.rotation.z = Math.PI / 2;
      }
    }
  }
  return rig;
}

function buildTemplate(e) {
  const r = e.r;
  const by = 7 + r * 0.4;
  const g = new THREE.Group();
  const root = new THREE.Group();
  root.name = 'root';
  root.position.y = PATH_TOP;
  g.add(root);
  const rig = buildRig(e);
  rig.name = 'rig';
  root.add(rig);

  const slow = new THREE.Mesh(
    new THREE.RingGeometry(r + 1, r + 3.5, 28),
    new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
  );
  slow.rotation.x = -Math.PI / 2;
  slow.position.y = 1;
  slow.visible = false;
  slow.name = 'slow';
  root.add(slow);

  const barW = Math.max(20, r * 2.4);
  const bars = new THREE.Group();
  bars.name = 'bars';
  const frame = new THREE.Mesh(new THREE.BoxGeometry(barW + 1.2, 3.6, 0.8), new THREE.MeshBasicMaterial({ color: 0xf8fafc }));
  const bg = new THREE.Mesh(new THREE.BoxGeometry(barW, 2.6, 1), new THREE.MeshBasicMaterial({ color: 0x1e1b24 }));
  const fg = new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 1.2), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
  fg.name = 'barFg';
  bars.add(frame, bg, fg);
  bars.position.y = by + r + 7;
  bars.userData.barW = barW;
  root.add(bars);
  g.userData.kind = e.shape || e.type;
  return g;
}

export function buildEnemyMesh(e) {
  const key = `${e.shape || e.type}|${e.color}|${e.r}`;
  let tpl = templates.get(key);
  if (!tpl) {
    tpl = buildTemplate(e);
    templates.set(key, tpl);
  }
  const g = tpl.clone(true);
  const u = g.userData;
  u.seed = e.seed || 0;
  u.wings = [];
  u.halo = null;
  u.flashMats = [];
  const owned = [];
  g.traverse((o) => {
    if (o.name === 'rig') u.rig = o;
    else if (o.name === 'slow') u.slow = o;
    else if (o.name === 'bars') { u.bars = o; u.barW = o.userData.barW; }
    else if (o.name === 'barFg') { o.material = o.material.clone(); owned.push(o.material); u.barFg = o; }
    if (o.userData.wing) u.wings.push(o);
    if (o.userData.halo) u.halo = o;
    if (o.userData.flash) {
      o.material = o.material.clone();
      owned.push(o.material);
      u.flashMats.push(o.material);
      if (!u.body) u.body = o;
    }
  });
  u.parts = collectParts(u.rig);
  u.dispose = () => owned.forEach((m) => m.dispose());
  return g;
}

export function flashEnemy(g, on) {
  for (const m of g.userData.flashMats) setFlash(m, 0xffffff, on ? 0.9 : 0);
}

// Per-frame creature animation (gait, hover, wing flap, halos, pulses).
export function animateEnemy(g, t) {
  const u = g.userData;
  const rig = u.rig;
  if (!rig) return;
  const s = u.seed || 0;
  const P = u.parts;
  let bob = 0, roll = 0, pitch = 0;
  const gait = t * 9 + s;
  switch (u.kind) {
    case 'dart': bob = 2 + Math.sin(t * 6 + s) * 0.8; roll = Math.sin(t * 3 + s) * 0.18; break;
    case 'armor': bob = Math.abs(Math.sin(t * 22 + s)) * 0.25; break;
    case 'beetle': bob = Math.abs(Math.sin(t * 16 + s)) * 0.6; break;
    case 'guardian': bob = 1.5 + Math.sin(t * 2.4 + s) * 1.3; break;
    case 'warlord': bob = Math.abs(Math.sin(t * 4 + s)) * 1.6; roll = Math.sin(t * 4 + s) * 0.06; break;
    case 'wisp': bob = 3 + Math.sin(t * 5 + s) * 2; break;
    case 'golem': bob = Math.abs(Math.sin(t * 3.2 + s)) * 1.2; roll = Math.sin(t * 3.2 + s) * 0.07; break;
    case 'phantom': bob = 2.5 + Math.sin(t * 2.2 + s) * 1.6; pitch = Math.sin(t * 1.7 + s) * 0.06; break;
    case 'mitosis': {
      const q = Math.sin(t * 6 + s) * 0.08;
      rig.scale.set(1 + q, 1 - q, 1 + q * 0.5);
      bob = Math.max(0, q) * 6;
      break;
    }
    default: bob = Math.abs(Math.sin(gait)) * 1.6; roll = Math.sin(gait) * 0.08;
  }
  rig.position.y = bob;
  rig.rotation.x = roll;
  rig.rotation.z = pitch;

  for (const w of u.wings) w.rotation.x = -Math.PI / 2 + w.userData.wing * (0.5 + Math.sin(t * 40 + s) * 0.45);
  if (u.halo) u.halo.rotation.z = t * 2;
  if (!P) return;
  for (const o of P.leg || []) {
    const ph = o.userData.phase || 0;
    if (u.kind === 'beetle') o.rotation.z = Math.sin(t * 16 + s + ph) * 0.35;
    else if (o.userData.home) {
      const h = o.userData.home;
      o.position.x = h[0] + Math.sin(gait + ph) * 2.2;
      o.position.y = h[1] + Math.max(0, Math.sin(gait + ph)) * 1.4 - bob;
    } else {
      o.rotation.z = Math.sin(t * 3.2 + s + ph) * 0.3;
    }
  }
  for (const o of P.arm || []) {
    const h = o.userData.home;
    if (!h) continue;
    const sw = Math.sin(gait + (o.userData.side > 0 ? 0 : Math.PI));
    o.position.x = h[0] + sw * (u.kind === 'phantom' ? 0.6 : 1.6);
    o.position.y = h[1] + (u.kind === 'phantom' ? Math.sin(t * 2.2 + s + o.userData.side) * 1.2 : 0);
  }
  for (const o of P.thrust || []) o.scale.set(1 + Math.sin(t * 40 + s) * 0.25, 1, 1);
  for (const o of P.shield || []) {
    const k = 1 + Math.sin(t * 3 + s) * 0.04;
    o.scale.setScalar(k);
    o.material.opacity = 0.16 + Math.sin(t * 3 + s) * 0.06;
  }
  for (const o of P.core || []) o.scale.setScalar(1 + Math.sin(t * 9 + s) * 0.15);
  for (const o of P.orbit || []) o.rotation.y = t * 3 + s;
  for (const o of P.trail || []) o.position.z = Math.sin(t * 7 + s - o.userData.i * 0.7) * o.userData.i * 0.8;
  for (const o of P.lobe || []) o.scale.setScalar(1 - Math.sin(t * 6 + s) * 0.06);
}
