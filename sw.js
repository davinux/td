// td.davinux.net service worker: offline-first app shell.
// Same-origin assets (HTML/CSS/JS/JSON/icons/vendored Three.js) are cached
// so the full 3D game works offline once visited.
const CACHE = 'tfgame-v6';
const CORE = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './js/main.js',
  './js/game.js',
  './js/model.js',
  './js/content.js',
  './js/levels.js',
  './js/mapgen.js',
  './js/storage.js',
  './js/generator.js',
  './js/graphics.js',
  './js/tooltip.js',
  './js/towersvg.js',
  './js/icons.js',
  './js/uiicons.js',
  './js/audio.js',
  './js/editor.js',
  './js/codex.js',
  './js/showroom.js',
  './js/hud3d.js',
  './js/view3d.js',
  './js/art3d.js',
  './js/terrain3d.js',
  './js/towers3d.js',
  './js/enemies3d.js',
  './js/editor3d.js',
  './js/menu3d.js',
  './vendor/three.module.js',
  './data/towers.json',
  './data/enemies.json',
  './data/campaign.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // third-party: network only
  if (request.mode === 'navigate') {
    // App is a single page: network first, cached shell when offline.
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  // Assets: serve cached copy instantly, refresh in the background.
  event.respondWith(
    caches.match(request).then((hit) => {
      const net = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
