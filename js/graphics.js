// Vector graphics for towers & enemies (no emoji, pure canvas).
// Enemy bodies use e.color from data/enemies.json; shapes come from e.shape.
// All draws are centered at (0,0) after caller translates; `angle` faces target.

// Lighten (amt>0) or darken (amt<0) a #rrggbb color. amt in [-1, 1].
export function shade(hex, amt) {
  const n = parseInt(String(hex).slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export function drawTower(ctx, tw, def, time) {
  const { x, y } = tw;
  const angle = tw.angle ?? -Math.PI / 2;
  const flash = time < (tw.flashUntil ?? -1);

  ctx.save();
  ctx.translate(x, y);

  // shadow
  ctx.beginPath();
  ctx.ellipse(0, 11, 11, 4, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  // stone base
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(-3, -4, 2, 0, 0, 13);
  g.addColorStop(0, '#475569');
  g.addColorStop(1, '#0f172a');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = def.color;
  ctx.stroke();

  // rotating head
  ctx.save();
  ctx.rotate(angle + Math.PI / 2); // 0 = up
  switch (tw.type) {
    case 'arrow': {
      // crossbow limbs + bolt
      ctx.strokeStyle = '#78350a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-8, -2); ctx.quadraticCurveTo(0, 2, 8, -2); ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-1.5, -13, 3, 12); // bolt
      ctx.beginPath(); ctx.moveTo(-4, -13); ctx.lineTo(0, -17); ctx.lineTo(4, -13); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fef3c7';
      ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'cannon': {
      const recoil = flash ? -2.5 : 0;
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(-5, -16 + recoil, 10, 15); // thick barrel
      ctx.fillStyle = '#fb923c';
      ctx.fillRect(-5, -16 + recoil, 10, 4); // muzzle ring
      ctx.fillStyle = '#78716c';
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#292524';
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'frost': {
      ctx.rotate(-(angle + Math.PI / 2)); // keep crystal upright
      drawCrystal(ctx, flash ? '#cffafe' : '#67e8f9', flash);
      break;
    }
    case 'sniper': {
      const recoil = flash ? -3 : 0;
      ctx.fillStyle = '#312e81';
      ctx.fillRect(-2.5, -20 + recoil, 5, 19); // long thin barrel
      ctx.fillStyle = '#c084fc';
      ctx.fillRect(-2.5, -20 + recoil, 5, 3); // tip
      ctx.fillStyle = '#1e1b4b';
      ctx.beginPath(); ctx.arc(0, 2, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c084fc'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-5.5, 2); ctx.lineTo(5.5, 2); ctx.moveTo(0, -3.5); ctx.lineTo(0, 7.5); ctx.stroke();
      break;
    }
    case 'gatling': {
      const spin = time * 12;
      ctx.fillStyle = '#020617';
      ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 3; i++) {
        const a = spin + (i * Math.PI * 2) / 3;
        const bx = Math.cos(a) * 3.5, by = Math.sin(a) * 3.5;
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(bx - 1.5, by - 12, 3, 10);
      }
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'tesla': {
      ctx.rotate(-(angle + Math.PI / 2));
      // coil mast
      ctx.fillStyle = '#713f12';
      ctx.fillRect(-2, -10, 4, 12);
      ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.arc(0, -6 + i * 4, 4.5, 0.3, Math.PI - 0.3); ctx.stroke();
      }
      ctx.fillStyle = flash ? '#fefce8' : '#fde047';
      ctx.beginPath(); ctx.arc(0, -11, 4, 0, Math.PI * 2); ctx.fill();
      if (flash) {
        ctx.strokeStyle = 'rgba(253,224,71,0.9)'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          ctx.beginPath(); ctx.moveTo(0, -11);
          ctx.lineTo(Math.cos(a) * 9, -11 + Math.sin(a) * 9); ctx.stroke();
        }
      }
      break;
    }
    case 'missile': {
      const recoil = flash ? -2 : 0;
      // launcher tubes
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(-7, -12 + recoil, 5.5, 13);
      ctx.fillRect(1.5, -12 + recoil, 5.5, 13);
      // rocket tips
      ctx.fillStyle = '#fecaca';
      ctx.beginPath(); ctx.moveTo(-7, -12 + recoil); ctx.lineTo(-4.25, -17 + recoil); ctx.lineTo(-1.5, -12 + recoil); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(1.5, -12 + recoil); ctx.lineTo(4.25, -17 + recoil); ctx.lineTo(7, -12 + recoil); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#450a0a';
      ctx.beginPath(); ctx.arc(0, 3, 4.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'mortar': {
      const recoil = flash ? 2 : 0; // squat tube kicks down
      // mounting plate
      ctx.fillStyle = '#44403c';
      ctx.beginPath(); ctx.arc(0, 2, 8, 0, Math.PI * 2); ctx.fill();
      // stubby angled barrel (up = -y)
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(-5.5, -16 - recoil, 11, 13);
      ctx.fillStyle = '#a8a29e';
      ctx.fillRect(-5.5, -16 - recoil, 11, 4); // muzzle ring
      ctx.fillStyle = '#0c0a09';
      ctx.beginPath(); ctx.ellipse(0, -16 - recoil, 5.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      // powder keg dot
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(0, 3, 2.5, 0, Math.PI * 2); ctx.fill();
      if (flash) {
        ctx.fillStyle = 'rgba(251,191,36,0.9)';
        ctx.beginPath(); ctx.arc(0, -19, 5 + Math.random() * 2, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'railgun': {
      // twin rails + glowing core
      ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-4, 4); ctx.lineTo(-4, -18); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4, 4); ctx.lineTo(4, -18); ctx.stroke();
      // coil rings
      ctx.strokeStyle = '#075985'; ctx.lineWidth = 2;
      for (const y of [-4, -9, -14]) {
        ctx.beginPath(); ctx.moveTo(-5.5, y); ctx.lineTo(5.5, y); ctx.stroke();
      }
      // energy core
      ctx.strokeStyle = flash ? '#fff' : '#38bdf8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(0, -19); ctx.stroke();
      ctx.fillStyle = '#0c4a6e';
      ctx.beginPath(); ctx.arc(0, 4, 4.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'tempest': {
      // storm crystal with three prongs
      ctx.strokeStyle = '#0f766e'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (const a of [-0.5, 0, 0.5]) {
        ctx.beginPath(); ctx.moveTo(0, 2);
        ctx.lineTo(Math.sin(a) * 9, 2 - Math.cos(a) * 15); ctx.stroke();
        ctx.fillStyle = '#2dd4bf';
        ctx.beginPath(); ctx.arc(Math.sin(a) * 9, 2 - Math.cos(a) * 15, 2.5, 0, Math.PI * 2); ctx.fill();
      }
      const pulse = 4 + Math.sin(time * 8) * 1;
      ctx.fillStyle = flash ? '#ecfeff' : '#14b8a6';
      ctx.beginPath(); ctx.arc(0, 1, pulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 1, 1.8, 0, Math.PI * 2); ctx.fill();
      break;
    }
    default: break;
  }
  ctx.restore();

  // muzzle flash glow
  if (flash && tw.type !== 'tesla' && tw.type !== 'frost') {
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.strokeStyle = def.color + 'AA';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // level pips (gold chevrons)
  if (tw.level > 1) {
    ctx.fillStyle = '#facc15';
    for (let i = 0; i < Math.min(tw.level - 1, 4); i++) {
      const px = -9 + i * 6;
      ctx.beginPath();
      ctx.moveTo(px, 13); ctx.lineTo(px + 2.5, 10.5); ctx.lineTo(px + 5, 13);
      ctx.lineTo(px + 5, 14.5); ctx.lineTo(px + 2.5, 12); ctx.lineTo(px, 14.5);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

function drawCrystal(ctx, color, flash) {
  ctx.save();
  // hexagon
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const px = Math.cos(a) * 8, py = Math.sin(a) * 8;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = flash ? '#ecfeff' : '#0e7490';
  ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  // snowflake arms
  ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * -5, Math.sin(a) * -5);
    ctx.lineTo(Math.cos(a) * 5, Math.sin(a) * 5);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawEnemy(ctx, e, time) {
  const slowed = time < e.slowUntil;
  const hit = time < (e.flashUntil ?? -1);
  const base = e.color || '#9ca3af';
  const dark = shade(base, -0.45);
  const darker = shade(base, -0.65);
  const light = shade(base, 0.45);
  ctx.save();
  ctx.translate(e.x, e.y);

  // shadow
  ctx.beginPath();
  ctx.ellipse(0, e.r * 0.9, e.r * 0.9, e.r * 0.35, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();

  ctx.rotate(e.angle ?? 0);

  switch (e.shape || e.type) {
    case 'brute': { // orc bruiser: round body, brow, tusks, back spikes
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2);
      ctx.fillStyle = shade(base, -0.15); ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = darker; ctx.stroke();
      // belly crescent
      ctx.beginPath(); ctx.arc(1, 2, e.r * 0.62, 0.3, Math.PI - 0.3);
      ctx.fillStyle = light; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
      // back spikes
      ctx.fillStyle = darker;
      for (let i = -1; i <= 1; i++) {
        const a = Math.PI + i * 0.5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - 0.18) * e.r, Math.sin(a - 0.18) * e.r);
        ctx.lineTo(Math.cos(a) * (e.r + 4), Math.sin(a) * (e.r + 4));
        ctx.lineTo(Math.cos(a + 0.18) * e.r, Math.sin(a + 0.18) * e.r);
        ctx.closePath(); ctx.fill();
      }
      // heavy brow
      ctx.strokeStyle = darker; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(6, -4.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(6, 4.5); ctx.stroke();
      // eyes (face forward = +x)
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(3.5, -3, 2.4, 0, Math.PI * 2); ctx.arc(3.5, 3, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#020617';
      ctx.beginPath(); ctx.arc(4.5, -3, 1.2, 0, Math.PI * 2); ctx.arc(4.5, 3, 1.2, 0, Math.PI * 2); ctx.fill();
      // tusks
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(-e.r + 2, -5, 2.5, 2.5); ctx.fillRect(-e.r + 2, 2.5, 2.5, 2.5);
      break;
    }
    case 'dart': { // sleek scout: long nose, swept wings, speed trail
      // speed trail (behind = -x)
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = base;
        ctx.globalAlpha = 0.35 - i * 0.1;
        ctx.lineWidth = 2.5 - i * 0.5;
        const y = (i - 1) * 4;
        ctx.beginPath(); ctx.moveTo(-6, y); ctx.lineTo(-13 - i * 3, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // swept wings
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(2, 0); ctx.lineTo(-7, -e.r - 2); ctx.lineTo(-4, 0); ctx.lineTo(-7, e.r + 2);
      ctx.closePath(); ctx.fill();
      // dart body
      ctx.beginPath();
      ctx.moveTo(e.r + 3, 0); ctx.lineTo(-6, -5.5); ctx.lineTo(-3, 0); ctx.lineTo(-6, 5.5);
      ctx.closePath();
      ctx.fillStyle = base; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = darker; ctx.stroke();
      // cockpit + tail fin
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.arc(2, 0, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = darker;
      ctx.fillRect(-7, -1, 3, 2);
      break;
    }
    case 'armor': { // siege engine: treads, hull, hatch, plow
      const s = e.r;
      // treads
      ctx.fillStyle = '#1c1917';
      roundRect(ctx, -s * 0.85, -s * 0.95, s * 1.7, s * 0.42, 3); ctx.fill();
      roundRect(ctx, -s * 0.85, s * 0.53, s * 1.7, s * 0.42, 3); ctx.fill();
      ctx.fillStyle = '#57534e'; // tread bolts
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.arc(i * s * 0.5, -s * 0.74, 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(i * s * 0.5, s * 0.74, 1.4, 0, Math.PI * 2); ctx.fill();
      }
      // hull
      ctx.fillStyle = shade(base, -0.1);
      roundRect(ctx, -s * 0.85, -s * 0.62, s * 1.7, s * 1.24, 4); ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = darker; ctx.stroke();
      // front plow (+x)
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(s * 0.85, -s * 0.5); ctx.lineTo(s * 0.85 + 4, 0); ctx.lineTo(s * 0.85, s * 0.5);
      ctx.closePath(); ctx.fill();
      // hatch + periscope
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.arc(-1, 0, s * 0.32, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = darker; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = darker;
      ctx.fillRect(0, -1, 4, 2);
      // rivets
      ctx.fillStyle = shade(base, 0.6);
      for (const [rx, ry] of [[-s * 0.6, -s * 0.4], [-s * 0.6, s * 0.4], [s * 0.55, -s * 0.4], [s * 0.55, s * 0.4]]) {
        ctx.beginPath(); ctx.arc(rx, ry, 1.5, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'beetle': { // swarm bug: legs, shell, flapping wings, mandibles
      const flap = Math.sin(time * 22 + e.seed);
      const wob = Math.sin(time * 18 + e.seed) * 1.5;
      // legs
      ctx.strokeStyle = darker; ctx.lineWidth = 1.5;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(-2 + i * 3, -5); ctx.lineTo(-4 + i * 3, -8 + wob); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-2 + i * 3, 5); ctx.lineTo(-4 + i * 3, 8 - wob); ctx.stroke();
      }
      // translucent wings
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.ellipse(-1, -5 - flap, 4.5, 2.2, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-1, 5 + flap, 4.5, 2.2, 0.5, 0, Math.PI * 2); ctx.fill();
      // shell
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const px = Math.cos(a) * 6, py = Math.sin(a) * 6;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = base; ctx.fill();
      ctx.strokeStyle = darker; ctx.lineWidth = 1.5; ctx.stroke();
      // shell stripe + eyes + mandibles
      ctx.strokeStyle = light; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(5, 0); ctx.stroke();
      ctx.fillStyle = '#020617';
      ctx.beginPath(); ctx.arc(3.5, -2, 1.3, 0, Math.PI * 2); ctx.arc(3.5, 2, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = darker; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(5, -2); ctx.lineTo(8, -3.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(5, 2); ctx.lineTo(8, 3.5); ctx.stroke();
      break;
    }
    case 'guardian': { // aegis: gradient orb, rotating arcs, satellites, pulsing core
      const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, e.r);
      g.addColorStop(0, light); g.addColorStop(1, shade(base, -0.25));
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = darker; ctx.stroke();
      // rotating shield arcs
      ctx.save();
      ctx.rotate(time * 2 + e.seed);
      ctx.beginPath(); ctx.arc(0, 0, e.r + 3, -0.9, 0.9);
      ctx.strokeStyle = shade(base, 0.65); ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, e.r + 3, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
      ctx.restore();
      // orbiting satellites
      ctx.fillStyle = light;
      for (let i = 0; i < 2; i++) {
        const a = time * 3 + e.seed + i * Math.PI;
        ctx.beginPath(); ctx.arc(Math.cos(a) * (e.r + 6), Math.sin(a) * (e.r + 6), 1.8, 0, Math.PI * 2); ctx.fill();
      }
      // pulsing core
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, 2.2 + Math.sin(time * 6 + e.seed) * 0.9, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'warlord': { // boss: halo, spiked plating, crown, pulsing core
      // halo
      ctx.beginPath(); ctx.arc(0, 0, e.r + 5, 0, Math.PI * 2);
      ctx.fillStyle = base; ctx.globalAlpha = 0.22; ctx.fill(); ctx.globalAlpha = 1;
      // armor spikes
      ctx.fillStyle = darker;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + Math.PI / 8;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - 0.12) * e.r, Math.sin(a - 0.12) * e.r);
        ctx.lineTo(Math.cos(a) * (e.r + 4), Math.sin(a) * (e.r + 4));
        ctx.lineTo(Math.cos(a + 0.12) * e.r, Math.sin(a + 0.12) * e.r);
        ctx.closePath(); ctx.fill();
      }
      // plated body
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
        const px = Math.cos(a) * (e.r + 2), py = Math.sin(a) * (e.r + 2);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, e.r + 3);
      g.addColorStop(0, light); g.addColorStop(1, darker);
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = darker; ctx.stroke();
      // crown spikes
      ctx.fillStyle = '#facc15';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 6 - 3, -e.r + 2); ctx.lineTo(i * 6, -e.r - 5); ctx.lineTo(i * 6 + 3, -e.r + 2);
        ctx.closePath(); ctx.fill();
      }
      // pulsing core + angry eyes
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-2, 0, 2.6 + Math.sin(time * 5 + e.seed), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fef08a';
      ctx.beginPath(); ctx.arc(5, -4, 2.5, 0, Math.PI * 2); ctx.arc(5, 4, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7c2d12';
      ctx.beginPath(); ctx.arc(6, -4, 1.2, 0, Math.PI * 2); ctx.arc(6, 4, 1.2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'wisp': { // barely-there sprinter: glowing translucent orb + trail
      for (let i = 2; i >= 1; i--) {
        ctx.fillStyle = base;
        ctx.globalAlpha = 0.16 * (3 - i);
        ctx.beginPath(); ctx.arc(-i * 5, 0, e.r * 0.75, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 0.75;
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2);
      ctx.fillStyle = base; ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5; ctx.strokeStyle = light; ctx.stroke();
      // bright core + sparkle
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(1, -1, e.r * 0.35, 0, Math.PI * 2); ctx.fill();
      const tw = (Math.sin(time * 9 + e.seed) + 1) / 2;
      ctx.fillStyle = `rgba(255,255,255,${0.4 + tw * 0.5})`;
      ctx.fillRect(-e.r - 2, -e.r - 5, 2, 2);
      break;
    }
    case 'mitosis': { // splitter cell: membrane, twin nuclei, buds
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2);
      ctx.fillStyle = base; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = darker; ctx.stroke();
      // membrane highlight
      ctx.strokeStyle = light; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, e.r - 2, -2.4, -0.7); ctx.stroke();
      // twin nuclei drifting apart
      const split = Math.sin(time * 3 + e.seed) * 1.5;
      ctx.fillStyle = darker;
      ctx.beginPath(); ctx.arc(-2.5 - split * 0.4, 0, e.r * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(2.5 + split * 0.4, 0, e.r * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-2.5 - split * 0.4, -1, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(2.5 + split * 0.4, -1, 1.2, 0, Math.PI * 2); ctx.fill();
      // budding bumps = the mites inside
      ctx.fillStyle = light;
      for (const a of [0.7, Math.PI - 0.7, Math.PI / 2]) {
        ctx.beginPath(); ctx.arc(Math.cos(a) * (e.r - 1), Math.sin(a) * (e.r - 1), 2, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'golem': { // walking avalanche: rocky plates, glowing cracks
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i * Math.PI * 2) / 7;
        const px = Math.cos(a) * e.r, py = Math.sin(a) * e.r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = shade(base, -0.1); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = darker; ctx.stroke();
      // glowing cracks
      ctx.strokeStyle = '#fdba74'; ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.65 + Math.sin(time * 4 + e.seed) * 0.25;
      ctx.beginPath(); ctx.moveTo(-e.r * 0.6, -e.r * 0.4); ctx.lineTo(-e.r * 0.1, 0); ctx.lineTo(-e.r * 0.5, e.r * 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(e.r * 0.5, -e.r * 0.6); ctx.lineTo(e.r * 0.2, e.r * 0.1); ctx.stroke();
      ctx.globalAlpha = 1;
      // heavy brow + ember eyes
      ctx.strokeStyle = darker; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(1, -6); ctx.lineTo(7, -4); ctx.stroke();
      ctx.fillStyle = '#ffedd5';
      ctx.beginPath(); ctx.arc(4, -2.5, 2, 0, Math.PI * 2); ctx.arc(4, 3.5, 2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'phantom': { // slow-immune haunt: cloak, void face, veil + snowflake-slash badge
      // cloak
      ctx.beginPath();
      ctx.moveTo(e.r + 2, 0);
      ctx.quadraticCurveTo(0, -e.r - 3, -e.r + 1, -e.r * 0.7);
      ctx.lineTo(-e.r + 1, e.r * 0.7);
      ctx.quadraticCurveTo(0, e.r + 3, e.r + 2, 0);
      ctx.closePath();
      ctx.fillStyle = shade(base, -0.05); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = light; ctx.stroke();
      // void face + pale eyes
      ctx.fillStyle = '#020617';
      ctx.beginPath(); ctx.arc(2, 0, e.r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e0e7ff';
      ctx.beginPath(); ctx.arc(3.5, -2.5, 1.8, 0, Math.PI * 2); ctx.arc(3.5, 2.5, 1.8, 0, Math.PI * 2); ctx.fill();
      // shimmering veil
      ctx.save();
      ctx.rotate(time * 2.5 + e.seed);
      ctx.strokeStyle = 'rgba(224,231,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(0, 0, e.r + 2.5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // slow-immune badge: snowflake with slash
      ctx.strokeStyle = '#67e8f9'; ctx.lineWidth = 1.5;
      const bx = -e.r - 7, by = -e.r - 7;
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(bx - Math.cos(a) * 3.5, by - Math.sin(a) * 3.5);
        ctx.lineTo(bx + Math.cos(a) * 3.5, by + Math.sin(a) * 3.5);
        ctx.stroke();
      }
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx - 5, by + 5); ctx.lineTo(bx + 5, by - 5); ctx.stroke();
      break;
    }
    default: { // generic orb for data-file ids without a dedicated shape
      const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, e.r);
      g.addColorStop(0, light); g.addColorStop(1, dark);
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = darker; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(1.5, 0, e.r * 0.28, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();

  // white hit-flash right after taking damage
  if (hit) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // slow tint ring
  if (slowed) {
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(103,232,249,0.9)'; ctx.lineWidth = 2; ctx.stroke();
    // snow speck
    ctx.fillStyle = '#cffafe';
    ctx.fillRect(e.x - e.r - 3, e.y - e.r - 4, 2.5, 2.5);
  }

  // hp bar
  const w = Math.max(22, e.r * 2);
  const pct = Math.max(0, e.hp / e.maxHp);
  ctx.fillStyle = 'rgba(2,6,23,0.85)';
  ctx.fillRect(e.x - w / 2, e.y - e.r - 9, w, 4.5);
  ctx.fillStyle = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#facc15' : '#ef4444';
  ctx.fillRect(e.x - w / 2, e.y - e.r - 9, w * pct, 4.5);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draw one enemy (from a data/enemies.json def) fitted into a square canvas.
// Used by the wave preview chips and the enemy codex.
// (Tower icons live in js/towersvg.js as resolution-independent SVG.)
export function drawEnemyIcon(canvas, def, time = 0, angle = 0) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, size, h);
  const r = def.r || 8;
  const s = Math.min(size, h) > 0 ? (Math.min(size, h) - 6) / (2 * (r + 13)) : 1;
  ctx.save();
  ctx.translate(size / 2, h / 2 + 6 * s);
  ctx.scale(s, s);
  drawEnemy(ctx, {
    type: def.id, shape: def.shape || def.id, color: def.color, r,
    x: 0, y: 0, hp: 1, maxHp: 1, slowUntil: -1, flashUntil: -1,
    seed: 1.7, angle,
  }, time);
  ctx.restore();
}
