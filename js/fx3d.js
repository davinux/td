// Combat VFX + range indicators for the 3D game view.
//
// - GPU point-sprite particle systems (one draw call each: additive glow
//   and alpha smoke) with per-particle size, colour fade, gravity and drag.
// - Pooled meshes for beams, tracers, shells and shockwave rings.
// - Per-tower shot styles: arrow/gatling tracers, sniper & frost & railgun
//   beams, cannon shells, high-arc mortar rounds, forked tesla/tempest
//   lightning; splash explosions sized to the tower's real splash radius.
// - Impacts: hit sparks, frost mist, crit bursts, death bursts, muzzle
//   flashes, level-up sparkles, rocket smoke trails.
// - Range indicators: soft filled disc + bright rim + rotating dashes,
//   hatched dead zone (mortar min range), and glow on covered road tiles.
import { THREE } from './art3d.js';

// --- shared textures ------------------------------------------------------
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const canvasTex = (size, draw) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    draw(cv.getContext('2d'), size);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  TEX = {
    soft: canvasTex(64, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
    }),
    smoke: canvasTex(64, (c, s) => {
      for (let i = 0; i < 6; i++) {
        const x = s / 2 + (Math.random() - 0.5) * s * 0.25, y = s / 2 + (Math.random() - 0.5) * s * 0.25;
        const g = c.createRadialGradient(x, y, 0, x, y, s * 0.42);
        g.addColorStop(0, 'rgba(255,255,255,0.45)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(0, 0, s, s);
      }
    }),
    rangeFill: canvasTex(512, (c, s) => {
      const r = s / 2;
      const g = c.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, 'rgba(255,255,255,0.05)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.08)');
      g.addColorStop(0.93, 'rgba(255,255,255,0.26)');
      g.addColorStop(0.965, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.975, 'rgba(255,255,255,1)');
      g.addColorStop(0.992, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
    }),
    rangeDash: canvasTex(512, (c, s) => {
      const r = s / 2;
      c.translate(r, r);
      c.fillStyle = '#fff';
      for (let i = 0; i < 48; i++) {
        c.save();
        c.rotate((i / 48) * Math.PI * 2);
        c.fillRect(r * 0.885, -2.5, r * 0.05, 5);
        c.restore();
      }
    }),
    hatch: canvasTex(256, (c, s) => {
      const r = s / 2;
      c.save();
      c.beginPath(); c.arc(r, r, r * 0.985, 0, Math.PI * 2); c.clip();
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(0, 0, s, s);
      c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 5;
      for (let x = -s; x < s * 2; x += 18) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + s, s); c.stroke(); }
      c.restore();
      c.strokeStyle = 'rgba(255,255,255,1)'; c.lineWidth = 6;
      c.beginPath(); c.arc(r, r, r * 0.96, 0, Math.PI * 2); c.stroke();
    }),
  };
  return TEX;
}

// --- particle system ------------------------------------------------------
const VERT = `
  attribute float aSize;
  attribute vec4 aColor;
  varying vec4 vColor;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(1.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = `
  uniform sampler2D uMap;
  varying vec4 vColor;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vColor.a;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor.rgb, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

class Particles {
  constructor(scene, cap, { additive = true, map }) {
    this.cap = cap;
    this.next = 0;
    const f = () => new Float32Array(cap);
    Object.assign(this, {
      px: f(), py: f(), pz: f(), vx: f(), vy: f(), vz: f(), life: f(), max: f(),
      s0: f(), s1: f(), a0: f(), r0: f(), g0: f(), b0: f(), r1: f(), g1: f(), b1: f(), grav: f(), drag: f(),
    });
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: 400 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 19;
    this.alive = 0;
    scene.add(this.points);
  }
  // o: {x,y,z, vx,vy,vz, life, size:[s0,s1], color:hex|Color, color2, alpha, grav, drag}
  emit(o) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0; this.vz[i] = o.vz || 0;
    this.life[i] = this.max[i] = o.life || 0.4;
    this.s0[i] = o.size?.[0] ?? 4; this.s1[i] = o.size?.[1] ?? this.s0[i];
    this.a0[i] = o.alpha ?? 1;
    const c0 = TMP.set(o.color ?? 0xffffff);
    this.r0[i] = c0.r; this.g0[i] = c0.g; this.b0[i] = c0.b;
    const c1 = TMP.set(o.color2 ?? o.color ?? 0xffffff);
    this.r1[i] = c1.r; this.g1[i] = c1.g; this.b1[i] = c1.b;
    this.grav[i] = o.grav || 0; this.drag[i] = o.drag || 0;
  }
  update(dt, scale) {
    this.mat.uniforms.uScale.value = scale;
    const { pos, col, size } = this;
    let alive = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        if (size[i] !== 0) size[i] = 0;
        continue;
      }
      alive++;
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.max[i];
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= k; this.vy[i] = this.vy[i] * k - this.grav[i] * dt; this.vz[i] *= k;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      pos[i * 3] = this.px[i]; pos[i * 3 + 1] = this.py[i]; pos[i * 3 + 2] = this.pz[i];
      col[i * 4] = this.r0[i] + (this.r1[i] - this.r0[i]) * t;
      col[i * 4 + 1] = this.g0[i] + (this.g1[i] - this.g0[i]) * t;
      col[i * 4 + 2] = this.b0[i] + (this.b1[i] - this.b0[i]) * t;
      // quick fade-in, smooth fade-out
      col[i * 4 + 3] = this.a0[i] * Math.min(1, t * 12) * (1 - t) * (1 - t * 0.3);
      size[i] = this.life[i] > 0 ? this.s0[i] + (this.s1[i] - this.s0[i]) * t : 0;
    }
    if (alive || this.alive) {
      const g = this.points.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.aColor.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
    }
    this.alive = alive;
  }
  clear() { this.life.fill(0); }
}
let TMP = null;

// --- mesh pools -------------------------------------------------------------
function pool(make) {
  const free = [];
  return {
    get() { const m = free.pop() || make(); m.visible = true; return m; },
    put(m) { m.visible = false; free.push(m); },
  };
}

const rnd = (a, b) => a + Math.random() * (b - a);
function randDir(out, up = 0) {
  const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  out.set(s * Math.cos(th), Math.abs(u) * up + u * (1 - up), s * Math.sin(th));
  return out;
}

export function createFx(scene) {
  TMP = TMP || new THREE.Color();
  const tex = textures();
  const glowP = new Particles(scene, 2600, { additive: true, map: tex.soft });
  const smokeP = new Particles(scene, 700, { additive: false, map: tex.smoke });
  const effects = []; // { update(dt) -> alive }
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), dir = new THREE.Vector3();

  // beam / tracer: unit cylinder along +Z, additive
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  const beams = pool(() => {
    const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    m.renderOrder = 18;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  });
  const placeBeam = (m, a, b, r) => {
    m.position.copy(a);
    const len = Math.max(0.01, a.distanceTo(b));
    m.scale.set(r, r, len);
    m.lookAt(b);
  };
  const shellGeo = new THREE.SphereGeometry(1, 10, 8);
  const shells = pool(() => {
    const m = new THREE.Mesh(shellGeo, new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4, metalness: 0.6, emissive: 0xff7a1a, emissiveIntensity: 0.35 }));
    m.castShadow = true;
    scene.add(m);
    return m;
  });
  const ringGeo = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
  const rings = pool(() => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    m.renderOrder = 17;
    scene.add(m);
    return m;
  });

  // --- building blocks ---
  function sparks(p, color, n = 6, speed = 90, { size = [3, 1], life = 0.28, grav = 160, color2 } = {}) {
    for (let i = 0; i < n; i++) {
      randDir(dir, 0.5).multiplyScalar(speed * rnd(0.5, 1.1));
      glowP.emit({ x: p.x, y: p.y, z: p.z, vx: dir.x, vy: dir.y + speed * 0.3, vz: dir.z,
        life: life * rnd(0.7, 1.3), size, color: color2 ? 0xffffff : color, color2: color2 ?? color, grav, drag: 2 });
    }
  }
  function flash(p, color, size, life = 0.12) {
    glowP.emit({ x: p.x, y: p.y, z: p.z, life, size: [size * 0.6, size], color: 0xffffff, color2: color, alpha: 1 });
  }
  function shockwave(p, radius, color, life = 0.35) {
    const m = rings.get();
    m.material.color.set(color);
    m.position.set(p.x, Math.max(p.y - 6, 0.8), p.z);
    let t = 0;
    effects.push({ update(dt) {
      t += dt;
      const k = Math.min(1, t / life);
      const r = 3 + (radius - 3) * (1 - (1 - k) ** 3);
      m.scale.set(r, 1, r);
      m.material.opacity = 0.9 * (1 - k);
      if (k >= 1) { rings.put(m); return false; }
      return true;
    } });
  }
  function explosion(p, radius, color, big = false) {
    const R = radius || 40;
    flash(p, 0xffc070, R * (big ? 2.4 : 1.9), 0.16);
    const nFire = big ? 26 : 16;
    for (let i = 0; i < nFire; i++) {
      randDir(dir, 0.35).multiplyScalar(R * rnd(1.2, 2.6));
      glowP.emit({ x: p.x, y: p.y, z: p.z, vx: dir.x, vy: dir.y * 0.7 + 20, vz: dir.z,
        life: rnd(0.3, 0.55), size: [rnd(9, 14), rnd(16, 24)], color: 0xffe0a0, color2: 0xd9361a, drag: 4.5 });
    }
    for (let i = 0; i < (big ? 16 : 10); i++) {
      randDir(dir, 0.7).multiplyScalar(rnd(120, 230));
      glowP.emit({ x: p.x, y: p.y, z: p.z, vx: dir.x, vy: Math.abs(dir.y) + 90, vz: dir.z,
        life: rnd(0.5, 0.9), size: [3, 1.5], color: 0xfff1a8, color2: 0xff6a00, grav: 380, drag: 1 });
    }
    for (let i = 0; i < (big ? 9 : 5); i++) {
      randDir(dir, 0.2).multiplyScalar(R * 0.5);
      smokeP.emit({ x: p.x + dir.x * 0.3, y: p.y + 4, z: p.z + dir.z * 0.3, vx: dir.x, vy: rnd(14, 30), vz: dir.z,
        life: rnd(0.9, 1.5), size: [R * 0.5, R * 1.1], color: 0x575250, color2: 0x2a2a2a, alpha: 0.55, drag: 1.6 });
    }
    shockwave(p, R, color || 0xffa640, big ? 0.45 : 0.33);
  }
  function lightning(a, b, color, life = 0.16, thick = 1) {
    // two re-rolled forks over the lifetime
    const bolt = () => {
      const len = a.distanceTo(b);
      const n = Math.max(3, Math.round(len / 7));
      dir.subVectors(b, a);
      const side = v2.set(-dir.z, 0, dir.x).normalize();
      let prev = a.clone();
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const amp = Math.sin(t * Math.PI) * Math.min(9, len * 0.12);
        const q = new THREE.Vector3().lerpVectors(a, b, t)
          .addScaledVector(side, (Math.random() - 0.5) * 2 * amp)
          .add(v.set(0, (Math.random() - 0.5) * amp, 0));
        if (i === n) q.copy(b);
        const steps = Math.max(1, Math.round(prev.distanceTo(q) / 2.2));
        for (let s = 0; s < steps; s++) {
          const pp = v.lerpVectors(prev, q, s / steps);
          glowP.emit({ x: pp.x, y: pp.y, z: pp.z, life: life * rnd(0.5, 0.8), size: [3.4 * thick, 2 * thick], color: 0xffffff, color2: color });
        }
        prev = q;
      }
    };
    bolt();
    let t = 0, rerolled = false;
    effects.push({ update(dt) {
      t += dt;
      if (!rerolled && t > life * 0.45) { rerolled = true; bolt(); }
      return t < life;
    } });
    flash(b, color, 16 * thick, 0.1);
    sparks(b, color, 4, 70, { life: 0.2, color2: color });
  }
  function beam(a, b, color, { r = 1.2, life = 0.18, core = true } = {}) {
    const outer = beams.get();
    outer.material.color.set(color);
    placeBeam(outer, a, b, r * 2.4);
    const inner = core ? beams.get() : null;
    if (inner) { inner.material.color.set(0xffffff); placeBeam(inner, a, b, r * 0.7); }
    // lingering glow along the beam path + hot impact point
    const n = Math.max(2, Math.round(a.distanceTo(b) / 9));
    for (let i = 0; i < n; i++) {
      v.lerpVectors(a, b, i / Math.max(1, n - 1));
      glowP.emit({ x: v.x, y: v.y, z: v.z, life: life * rnd(0.7, 1), size: [r * 4, r * 1.5], color: 0xffffff, color2: color, alpha: 0.7 });
    }
    flash(b, color, 14 + r * 8, 0.12);
    let t = 0;
    effects.push({ update(dt) {
      t += dt;
      const k = Math.min(1, t / life);
      outer.material.opacity = 0.55 * (1 - k);
      outer.scale.x = outer.scale.y = r * 2.4 * (1 - k * 0.6);
      if (inner) { inner.material.opacity = 1 - k; inner.scale.x = inner.scale.y = r * 0.7 * (1 - k * 0.8); }
      if (k >= 1) { beams.put(outer); if (inner) beams.put(inner); return false; }
      return true;
    } });
  }
  function tracer(a, b, color, { speed = 900, len = 14, r = 0.7, onHit } = {}) {
    const m = beams.get();
    m.material.color.set(color);
    m.material.opacity = 1;
    // white-hot core so the bolt reads at any distance/angle
    const core = beams.get();
    core.material.color.set(0xffffff);
    core.material.opacity = 1;
    const total = a.distanceTo(b);
    const dur = total / speed;
    let t = 0;
    const from = a.clone(), to = b.clone();
    const head = new THREE.Vector3(), tail = new THREE.Vector3();
    effects.push({ update(dt) {
      t += dt;
      const k = Math.min(1, t / dur);
      head.lerpVectors(from, to, k);
      tail.lerpVectors(from, to, Math.max(0, k - len / Math.max(1, total)));
      placeBeam(m, tail, head, r);
      // slimmer bright core inside the colored bolt
      v.lerpVectors(tail, head, 0.15);
      placeBeam(core, v, head, r * 0.45);
      // glowing head so fast shots don't look like static sticks
      glowP.emit({ x: head.x, y: head.y, z: head.z, life: 0.12, size: [r * 6, r * 2], color: 0xffffff, color2: color, alpha: 0.9 });
      if (k >= 1) { beams.put(m); beams.put(core); if (onHit) onHit(to); return false; }
      return true;
    } });
  }
  function shell(a, b, { apex = 14, speed = 420, dur, size = 1.8, trail = 0xffa640, onHit } = {}) {
    const m = shells.get();
    m.scale.setScalar(size);
    const from = a.clone(), to = b.clone();
    const d = dur ?? Math.max(0.12, from.distanceTo(to) / speed);
    let t = 0, emitAcc = 0;
    effects.push({ update(dt) {
      t += dt;
      const k = Math.min(1, t / d);
      m.position.lerpVectors(from, to, k);
      m.position.y += Math.sin(k * Math.PI) * apex;
      emitAcc += dt;
      while (emitAcc > 0.012) {
        emitAcc -= 0.012;
        glowP.emit({ x: m.position.x, y: m.position.y, z: m.position.z, life: 0.22, size: [size * 2.6, size * 0.8], color: 0xffe2a0, color2: trail, alpha: 0.8 });
        if (apex > 30) smokeP.emit({ x: m.position.x, y: m.position.y, z: m.position.z, vy: 6, life: 0.7, size: [4, 10], color: 0x9ca3af, alpha: 0.35, drag: 1 });
      }
      if (k >= 1) { shells.put(m); if (onHit) onHit(to); return false; }
      return true;
    } });
  }

  // --- public: react to game events ---
  const hex = (c) => (typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : c);
  return {
    // One shot from a tower (or a chain hop). a/b are world Vector3s.
    shot(type, a, b, { color = 0xffffff, crit = false, splash = 0, hop = 0, bFull = null } = {}) {
      const c = hex(color);
      switch (type) {
        case 'arrow':
          tracer(a, b, 0xfde68a, { speed: 950, len: 16, r: 0.75, onHit: (p) => sparks(p, 0xfbbf24, 5, 80) });
          break;
        case 'gatling':
          tracer(a, b, 0xfff7d6, { speed: 1400, len: 14, r: 0.55, onHit: (p) => sparks(p, 0xfde68a, 3, 70, { life: 0.18 }) });
          break;
        case 'sniper':
          beam(a, b, crit ? 0xfde047 : c, { r: crit ? 1.2 : 0.6, life: crit ? 0.3 : 0.2 });
          sparks(b, crit ? 0xfde047 : c, crit ? 14 : 6, crit ? 150 : 90);
          if (crit) { flash(b, 0xfde047, 34, 0.18); shockwave(b, 22, 0xfde047, 0.25); }
          break;
        case 'frost': {
          beam(a, b, 0x67e8f9, { r: 1.1, life: 0.2 });
          for (let i = 0; i < 10; i++) {
            randDir(dir, 0.3).multiplyScalar(rnd(20, 55));
            glowP.emit({ x: b.x, y: b.y, z: b.z, vx: dir.x, vy: dir.y + 10, vz: dir.z, life: rnd(0.4, 0.8),
              size: [rnd(2.5, 4), 1], color: 0xffffff, color2: 0x67e8f9, grav: 25, drag: 3 });
          }
          smokeP.emit({ x: b.x, y: b.y, z: b.z, life: 0.6, size: [10, 22], color: 0xcffafe, alpha: 0.4, drag: 2 });
          break;
        }
        case 'tesla':
          lightning(a, b, 0xfde047, 0.16, hop ? 0.8 : 1.1);
          break;
        case 'tempest':
          lightning(a, b, 0x5eead4, 0.15, 0.9);
          break;
        case 'railgun': {
          const end = bFull || b;
          beam(a, end, 0x7dd3fc, { r: 1.7, life: 0.32 });
          const n = Math.round(a.distanceTo(end) / 5);
          for (let i = 0; i < n; i++) {
            v.lerpVectors(a, end, i / n);
            glowP.emit({ x: v.x, y: v.y, z: v.z, vx: rnd(-8, 8), vy: rnd(-4, 10), vz: rnd(-8, 8), life: rnd(0.25, 0.5), size: [3, 0.5], color: 0xe0f2fe, color2: 0x0ea5e9, drag: 3 });
          }
          sparks(b, 0x7dd3fc, 10, 120);
          break;
        }
        case 'cannon':
          shell(a, b, { apex: 12, speed: 700, size: 2, onHit: (p) => explosion(p, splash || 55, 0xffa640) });
          break;
        case 'mortar':
          shell(a, b, { apex: 70, dur: 0.42, size: 2.8, trail: 0xff8a3d, onHit: (p) => explosion(p, splash || 65, 0xff8a3d, true) });
          break;
        default:
          tracer(a, b, c, { speed: 900, len: 16, r: 0.8 });
      }
    },
    muzzle(p, type, color) {
      const c = hex(color);
      if (type === 'tesla' || type === 'tempest' || type === 'frost') { flash(p, c, 18, 0.12); sparks(p, c, 3, 60, { life: 0.15 }); return; }
      flash(p, type === 'railgun' ? 0x7dd3fc : 0xffd08a, type === 'mortar' || type === 'cannon' ? 26 : type === 'gatling' ? 10 : 15, 0.08);
      if (type === 'sniper') sparks(p, 0xffe9a8, 3, 90, { life: 0.15 });
      if (type === 'cannon' || type === 'mortar' || type === 'missile') {
        for (let i = 0; i < 3; i++) smokeP.emit({ x: p.x, y: p.y, z: p.z, vx: rnd(-10, 10), vy: rnd(8, 20), vz: rnd(-10, 10), life: rnd(0.6, 1), size: [5, 14], color: 0x9ca3af, alpha: 0.4, drag: 1.5 });
      }
    },
    // Impact on an enemy. color = the shooter's tower color, radius = enemy
    // body radius so big brutes get proportionally bigger bursts.
    hit(p, color, strong = false, radius = 9) {
      const c = hex(color) || 0xffffff;
      const k = Math.max(0.7, Math.min(2.2, radius / 9));
      flash(p, c, (strong ? 20 : 12) * k, 0.1);
      sparks(p, c, strong ? 10 : 5, (strong ? 130 : 85) * Math.sqrt(k), { size: [3.5 * k, 1.2 * k], life: strong ? 0.3 : 0.22, color2: c });
      sparks(p, 0xffffff, strong ? 4 : 2, 60 * k, { size: [2.5 * k, 1 * k], life: 0.14 });
      if (strong) shockwave(p, 14 + radius, c, 0.28);
    },
    death(p, color, big = false) {
      const c = hex(color);
      flash(p, c, big ? 40 : 22, 0.14);
      for (let i = 0; i < (big ? 30 : 14); i++) {
        randDir(dir, 0.6).multiplyScalar(rnd(60, big ? 200 : 140));
        glowP.emit({ x: p.x, y: p.y, z: p.z, vx: dir.x, vy: Math.abs(dir.y) + 60, vz: dir.z, life: rnd(0.4, 0.75),
          size: [rnd(3, 5), 1.5], color: c, color2: c, grav: 320, drag: 1.2 });
      }
      for (let i = 0; i < (big ? 8 : 3); i++) {
        smokeP.emit({ x: p.x, y: p.y, z: p.z, vx: rnd(-15, 15), vy: rnd(10, 25), vz: rnd(-15, 15), life: rnd(0.7, 1.1),
          size: [8, big ? 34 : 18], color: 0x6b7280, alpha: 0.4, drag: 1.5 });
      }
      if (big) shockwave(p, 70, c, 0.5);
    },
    leak(p) {
      flash(p, 0xef4444, 30, 0.2);
      sparks(p, 0xef4444, 12, 120, { life: 0.4 });
    },
    levelUp(p) {
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        glowP.emit({ x: p.x + Math.cos(a) * 14, y: p.y + rnd(0, 6), z: p.z + Math.sin(a) * 14,
          vx: -Math.cos(a) * 6, vy: rnd(45, 80), vz: -Math.sin(a) * 6, life: rnd(0.6, 1), size: [3.5, 1], color: 0xfff7c2, color2: 0xf59e0b, drag: 1.5 });
      }
      shockwave({ x: p.x, y: p.y + 6, z: p.z }, 24, 0xfacc15, 0.4);
    },
    placed(p, color) {
      shockwave({ x: p.x, y: 6, z: p.z }, 22, hex(color), 0.35);
      for (let i = 0; i < 10; i++) smokeP.emit({ x: p.x + rnd(-12, 12), y: 2, z: p.z + rnd(-12, 12), vx: rnd(-10, 10), vy: rnd(4, 12), vz: rnd(-10, 10), life: rnd(0.5, 0.9), size: [6, 14], color: 0xc8b89a, alpha: 0.45, drag: 2 });
    },
    rocketTrail(p) {
      glowP.emit({ x: p.x, y: p.y, z: p.z, life: 0.16, size: [5, 2], color: 0xffe0a0, color2: 0xff5a1f });
      smokeP.emit({ x: p.x, y: p.y, z: p.z, vx: rnd(-3, 3), vy: rnd(3, 8), vz: rnd(-3, 3), life: rnd(0.6, 0.9), size: [3, 11], color: 0xd1d5db, color2: 0x6b7280, alpha: 0.4, drag: 1 });
    },
    explosion,
    update(dt, pxScale) {
      for (let i = effects.length - 1; i >= 0; i--) {
        if (!effects[i].update(dt)) effects.splice(i, 1);
      }
      glowP.update(dt, pxScale);
      smokeP.update(dt, pxScale);
    },
    clear() {
      for (const e of effects.splice(0)) e.update(1e3);
      glowP.clear(); smokeP.clear();
    },
  };
}

// --- range indicators -------------------------------------------------------
// Flat on the ground: soft fill fading into a bright rim, a slowly rotating
// dash ring, a pulsing additive outer glow rim, a center pin, and an
// optional hatched dead zone. set(x, z, radius, color, opts).
export function createRangeIndicator(scene, { dashes = true } = {}) {
  const tex = textures();
  const g = new THREE.Group();
  g.visible = false;
  const flat = new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2);
  const mat = (map, opacity) => new THREE.MeshBasicMaterial({
    map, color: 0xffffff, transparent: true, opacity, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const fill = new THREE.Mesh(flat, mat(tex.rangeFill, 0.9));
  const dash = new THREE.Mesh(flat, mat(tex.rangeDash, 0.65));
  const dead = new THREE.Mesh(flat, mat(tex.hatch, 0.85));
  fill.renderOrder = 15; dash.renderOrder = 16; dead.renderOrder = 16;
  dash.visible = dashes;
  dead.visible = false;
  // additive outer glow rim: crisp bright edge readable from any zoom
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(0.955, 1.0, 96).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
  );
  rim.renderOrder = 17;
  // center pin marking the tower itself
  const pin = new THREE.Mesh(
    new THREE.CircleGeometry(0.035, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  pin.renderOrder = 17;
  g.add(fill, dash, dead, rim, pin);
  scene.add(g);
  let spin = 0, pulse = 0, curOpacity = 1;
  return {
    group: g,
    set(x, z, radius, color, { opacity = 1, minRadius = 0, deadColor = 0xef4444, y = 1.2 } = {}) {
      g.visible = true;
      g.position.set(x, y, z);
      curOpacity = opacity;
      fill.scale.setScalar(radius);
      dash.scale.setScalar(radius);
      rim.scale.setScalar(radius);
      // pin keeps a constant world size instead of scaling with range
      pin.scale.setScalar(radius);
      pin.position.y = 0.15;
      rim.position.y = 0.1;
      dash.position.y = 0.05;
      fill.material.color.set(color);
      dash.material.color.set(color);
      rim.material.color.set(color);
      pin.material.color.set(color);
      fill.material.opacity = 0.9 * opacity;
      dash.material.opacity = 0.65 * opacity;
      if (minRadius > 0) {
        dead.visible = true;
        dead.scale.setScalar(minRadius);
        dead.position.y = 0.08;
        dead.material.color.set(deadColor);
      } else dead.visible = false;
    },
    hide() { g.visible = false; },
    tick(dt) {
      spin += dt * 0.35; dash.rotation.y = spin;
      pulse += dt * 3;
      const k = 0.55 + Math.sin(pulse) * 0.25;
      rim.material.opacity = k * curOpacity;
      pin.material.opacity = (0.65 + Math.sin(pulse * 1.3) * 0.25) * curOpacity;
      // dead zone gently blinks so "can't hit here" reads instantly
      if (dead.visible) dead.material.opacity = 0.65 + Math.sin(pulse * 1.7) * 0.2;
    },
  };
}

// Glow squares on the road tiles a tower would cover (placement preview).
export function createCoverage(scene, tile = 32, cap = 400) {
  const geo = new THREE.PlaneGeometry(tile * 0.86, tile * 0.86).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending });
  const inst = new THREE.InstancedMesh(geo, mat, cap);
  inst.count = 0;
  inst.renderOrder = 14;
  inst.frustumCulled = false;
  scene.add(inst);
  const m4 = new THREE.Matrix4();
  let key = '';
  return {
    // points: [{x,z}] world centres of road tiles
    set(points, cx, cz, radius, minRadius, color, y = -1.1) {
      const k = `${cx},${cz},${radius},${minRadius},${color},${points.length}`;
      mat.color.set(color);
      if (k === key) return;
      key = k;
      let n = 0;
      for (const p of points) {
        const d = Math.hypot(p.x - cx, p.z - cz);
        if (d > radius || d < minRadius || n >= cap) continue;
        m4.makeTranslation(p.x, y, p.z);
        inst.setMatrixAt(n++, m4);
      }
      inst.count = n;
      inst.instanceMatrix.needsUpdate = true;
    },
    hide() { inst.count = 0; key = ''; },
    pulse(t) { mat.opacity = 0.22 + Math.sin(t * 5) * 0.08; },
  };
}
