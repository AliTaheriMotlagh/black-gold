// Black Gold service worker.
// - App shell + hashed assets: cache-first (immutable).
// - Map data (theater.bin.gz, base imagery): stale-while-revalidate.
// - Streamed satellite/elevation tiles: cache-first with a size cap, so revisited areas work offline.
const VERSION = 'bg-v2';
const SHELL = `${VERSION}-shell`;
const TILES = `${VERSION}-tiles`;
const MAX_TILES = 1500;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/play/', '/manifest.webmanifest', '/icon.svg', '/data/theater.bin.gz', '/data/mini.webp'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))));
  self.clients.claim();
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const tile = /elevation-tiles-prod|gibs\.earthdata|tiles\.maps\.eox\.at/.test(url.hostname + url.pathname);
  if (tile) {
    e.respondWith(
      caches.open(TILES).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          c.put(req, res.clone());
          if (Math.random() < 0.05) trimTiles();
        }
        return res;
      }),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy));
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match('/play/'))),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => (res.ok && caches.open(SHELL).then((c) => c.put(req, res.clone())), res))));
    return;
  }
  if (url.pathname.startsWith('/data/') || url.pathname.startsWith('/media/')) {
    e.respondWith(
      caches.open(SHELL).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.ok) c.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
  }
});
