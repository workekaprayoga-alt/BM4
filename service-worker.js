// ============================================================
// BM4 Service Worker
// File: service-worker.js
// Versi: 1.0
// ============================================================
// Strategi caching:
// 1. App shell (HTML, CSS, JS) — Cache-First (instant load, update di background)
// 2. Map tiles & API calls — Network-First (data fresh, fallback cache)
// 3. Static assets (images, fonts) — Cache-First permanent
// ============================================================

const VERSION = 'bm4-v1';
const SHELL_CACHE = 'bm4-shell-' + VERSION;
const RUNTIME_CACHE = 'bm4-runtime-' + VERSION;

// File yang di-precache (app shell — file inti yang dibutuhkan saat startup)
const SHELL_FILES = [
  './',
  './mobile.html',
  './manifest.json',
  './assets/icon.svg',
  // Leaflet CSS & JS dari CDN (ditambahkan saat fetch pertama)
];

// ============================================================
// INSTALL — precache app shell
// ============================================================
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => {
      console.log('[SW] Precaching app shell');
      return cache.addAll(SHELL_FILES).catch(err => {
        console.warn('[SW] Some shell files failed to cache:', err);
      });
    }).then(() => self.skipWaiting()) // langsung aktif tanpa tunggu close tab
  );
});

// ============================================================
// ACTIVATE — clean up old caches
// ============================================================
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key.startsWith('bm4-') && !key.includes(VERSION))
            .map(key => {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            })
      );
    }).then(() => self.clients.claim())
  );
});

// ============================================================
// FETCH — strategi caching
// ============================================================
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip non-GET requests
  if(req.method !== 'GET') return;

  // Skip Apps Script API requests (selalu fresh dari server)
  if(url.hostname.includes('script.google.com') ||
     url.hostname.includes('googleusercontent.com')){
    return; // browser handle normal
  }

  // Strategy 1: HTML files — Network-First (cek update setiap kali, fallback cache)
  if(req.destination === 'document' || url.pathname.endsWith('.html')){
    event.respondWith(
      fetch(req).then(response => {
        // Cache the new response
        const cacheCopy = response.clone();
        caches.open(RUNTIME_CACHE).then(cache => cache.put(req, cacheCopy));
        return response;
      }).catch(() => {
        // Network gagal → fallback ke cache
        return caches.match(req).then(cached => {
          return cached || caches.match('./mobile.html');
        });
      })
    );
    return;
  }

  // Strategy 2: Map tiles (OpenStreetMap) — Cache-First (jarang berubah)
  if(url.hostname.includes('tile.openstreetmap.org')){
    event.respondWith(
      caches.match(req).then(cached => {
        if(cached) return cached;
        return fetch(req).then(response => {
          if(response.ok){
            const cacheCopy = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => cache.put(req, cacheCopy));
          }
          return response;
        }).catch(() => {
          // Tile tidak bisa di-fetch → kasih placeholder atau biarin gagal
          return new Response('', { status: 503 });
        });
      })
    );
    return;
  }

  // Strategy 3: CDN libraries (Leaflet, fonts) — Cache-First permanent
  if(url.hostname.includes('cdnjs.cloudflare.com') ||
     url.hostname.includes('fonts.googleapis.com') ||
     url.hostname.includes('fonts.gstatic.com')){
    event.respondWith(
      caches.match(req).then(cached => {
        if(cached) return cached;
        return fetch(req).then(response => {
          if(response.ok){
            const cacheCopy = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => cache.put(req, cacheCopy));
          }
          return response;
        });
      })
    );
    return;
  }

  // Strategy 4: Static assets (images, JS, CSS) — Cache-First
  if(req.destination === 'image' ||
     req.destination === 'script' ||
     req.destination === 'style' ||
     req.destination === 'font'){
    event.respondWith(
      caches.match(req).then(cached => {
        if(cached){
          // Refresh in background
          fetch(req).then(response => {
            if(response.ok){
              const cacheCopy = response.clone();
              caches.open(RUNTIME_CACHE).then(cache => cache.put(req, cacheCopy));
            }
          }).catch(() => {});
          return cached;
        }
        return fetch(req).then(response => {
          if(response.ok){
            const cacheCopy = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => cache.put(req, cacheCopy));
          }
          return response;
        });
      })
    );
    return;
  }

  // Default: Network-First, fallback cache
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});

// ============================================================
// MESSAGE — handle commands dari mobile.html
// ============================================================
self.addEventListener('message', event => {
  if(event.data && event.data.type === 'SKIP_WAITING'){
    self.skipWaiting();
  }
  if(event.data && event.data.type === 'CLEAR_CACHE'){
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))))
        .then(() => event.ports[0]?.postMessage({ success: true }))
    );
  }
});
