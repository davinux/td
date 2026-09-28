// Procedural game audio: all SFX are synthesized with the Web Audio API —
// no assets, no downloads, fully offline. Created lazily on the first user
// gesture (browser autoplay policy) and guarded so audio can never break
// the game. Settings (enabled / volume / muted) persist in localStorage.

const STORE_KEY = 'tfgame.sound.v1';

let settings = { enabled: true, volume: 0.6, muted: false };
try {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) settings = { ...settings, ...JSON.parse(raw) };
} catch { /* private mode: run with defaults */ }

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* noop */ }
}

let ctx = null;
let master = null;
const listeners = new Set();
export function onSoundChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  for (const fn of listeners) {
    try { fn(getSoundSettings()); } catch { /* UI sync must never break audio */ }
  }
}

export function getSoundSettings() {
  return { ...settings };
}

export function setSoundEnabled(v) {
  settings.enabled = !!v;
  save(); applyGain(); notify();
}

export function setSoundVolume(v) {
  settings.volume = Math.max(0, Math.min(1, Number(v) || 0));
  save(); applyGain(); notify();
}

export function setSoundMuted(v) {
  settings.muted = !!v;
  save(); applyGain(); notify();
}

function applyGain() {
  if (!master || !ctx) return;
  const audible = settings.enabled && !settings.muted;
  master.gain.setTargetAtTime(audible ? settings.volume : 0, ctx.currentTime, 0.02);
}

// Browsers only allow audio after a user gesture: build (and resume) the
// context on first pointer/key interaction.
function ensureCtx() {
  if (!settings.enabled) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = settings.muted ? 0 : settings.volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

let unlocked = false;
function unlock() {
  if (unlocked) return;
  unlocked = true;
  ensureCtx();
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

// --- tiny synth -------------------------------------------------------------
function tone({ freq = 440, freqEnd = null, dur = 0.1, type = 'sine', vol = 0.2, delay = 0 }) {
  const ac = ensureCtx();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise({ dur = 0.2, vol = 0.25, cutoff = 1200, delay = 0 }) {
  const ac = ensureCtx();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
}

// --- SFX catalog ------------------------------------------------------------
// Hot paths (kills, shots) are throttled by timestamp so 20 towers at 4x
// speed stay a texture instead of a wall of noise.
const lastPlay = new Map();
function throttle(key, ms) {
  const now = performance.now();
  if (now - (lastPlay.get(key) || 0) < ms) return false;
  lastPlay.set(key, now);
  return true;
}

const SHOT_PITCH = { arrow: 700, cannon: 180, frost: 900, sniper: 1400, gatling: 500, tesla: 1100, missile: 300, mortar: 150, railgun: 1200, tempest: 800 };

export function playShot(towerType) {
  if (!throttle('shot', 90)) return;
  tone({ freq: SHOT_PITCH[towerType] || 600, freqEnd: (SHOT_PITCH[towerType] || 600) * 0.6, dur: 0.06, type: 'triangle', vol: 0.05 });
}

export function playKill() {
  if (!throttle('kill', 70)) return;
  noise({ dur: 0.08, vol: 0.1, cutoff: 2500 });
}

export function playBoom() {
  if (!throttle('boom', 140)) return;
  noise({ dur: 0.3, vol: 0.28, cutoff: 900 });
  tone({ freq: 120, freqEnd: 40, dur: 0.25, type: 'sine', vol: 0.2 });
}

export function playPlace() {
  tone({ freq: 200, freqEnd: 95, dur: 0.12, type: 'triangle', vol: 0.25 });
  noise({ dur: 0.08, vol: 0.12, cutoff: 800 });
}

export function playSelect() {
  if (!throttle('select', 60)) return;
  tone({ freq: 520, dur: 0.06, type: 'sine', vol: 0.12 });
}

export function playUpgrade() {
  tone({ freq: 440, dur: 0.09, type: 'sine', vol: 0.2 });
  tone({ freq: 554, dur: 0.09, type: 'sine', vol: 0.2, delay: 0.08 });
  tone({ freq: 659, dur: 0.14, type: 'sine', vol: 0.22, delay: 0.16 });
}

export function playSell() {
  tone({ freq: 880, dur: 0.07, type: 'square', vol: 0.1 });
  tone({ freq: 660, dur: 0.1, type: 'square', vol: 0.1, delay: 0.07 });
}

export function playError() {
  if (!throttle('error', 200)) return;
  tone({ freq: 140, dur: 0.15, type: 'sawtooth', vol: 0.15 });
}

export function playWaveStart() {
  tone({ freq: 196, freqEnd: 262, dur: 0.3, type: 'sawtooth', vol: 0.18 });
  tone({ freq: 392, dur: 0.2, type: 'triangle', vol: 0.12, delay: 0.05 });
}

export function playWaveClear() {
  tone({ freq: 523, dur: 0.12, type: 'sine', vol: 0.2 });
  tone({ freq: 784, dur: 0.18, type: 'sine', vol: 0.2, delay: 0.1 });
}

export function playLeak() {
  if (!throttle('leak', 350)) return;
  tone({ freq: 110, dur: 0.2, type: 'square', vol: 0.16 });
}

export function playVictory() {
  [523, 659, 784, 1047].forEach((f, i) =>
    tone({ freq: f, dur: 0.22, type: 'triangle', vol: 0.22, delay: i * 0.14 }));
}

export function playDefeat() {
  tone({ freq: 330, freqEnd: 110, dur: 0.8, type: 'sawtooth', vol: 0.18 });
}

export function playClick() {
  if (!throttle('click', 50)) return;
  tone({ freq: 660, dur: 0.05, type: 'sine', vol: 0.1 });
}
