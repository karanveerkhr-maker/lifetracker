// ═══════════════════════════════════════════════════
// Life Tracker — Service Worker
// Handles: offline caching, background sync, updates
// ═══════════════════════════════════════════════════

const CACHE_NAME = 'lifetracker-v1';
const BASE = '/lifetracker';

// Files to cache for offline use
const STATIC_ASSETS = [
  BASE + '/index.html',
  BASE + '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
];

// ── INSTALL: cache core files ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache what we can, ignore failures (e.g. fonts might fail offline)
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean up old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: network-first for Firebase/API, cache-first for assets ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept Firebase, API calls — always go live
  if (
    url.hostname.includes('firebasedatabase.app') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('fast2sms.com') ||
    url.hostname.includes('anthropic.com') ||
    event.request.method !== 'GET'
  ) {
    return; // let browser handle normally
  }

  // For our own HTML/assets: network-first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache a fresh copy
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline fallback — serve from cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // For navigation requests, return index.html
          if (event.request.mode === 'navigate') {
            return caches.match(BASE + '/index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// ── MESSAGE: handle update requests from the app ──
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'GET_VERSION') {
    event.ports[0].postMessage(CACHE_NAME);
  }
});

// ── NOTIFICATION CLICK: open app when user taps notification ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = '/lifetracker/index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url.includes('/lifetracker') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── PUSH: handle background push notifications (future use) ──
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Life Tracker', {
      body: data.body || '',
      icon: '/lifetracker/icons/icon-192.png',
      badge: '/lifetracker/icons/icon-192.png',
      tag: data.tag || 'lt-push',
      vibrate: [200, 100, 200]
    })
  );
});
