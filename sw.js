// ═══════════════════════════════════════════════════
// Life Tracker — Service Worker v2
// Handles: offline caching, background notifications, updates
// ═══════════════════════════════════════════════════

const CACHE_NAME = 'lifetracker-v2';
const BASE = '/lifetracker';

const STATIC_ASSETS = [
  BASE + '/index.html',
  BASE + '/manifest.json',
];

// ── INSTALL ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url).catch(()=>{})))
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: network-first, cache fallback ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (
    url.hostname.includes('firebasedatabase.app') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('anthropic.com') ||
    url.hostname.includes('pollinations.ai') ||
    event.request.method !== 'GET'
  ) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => {
        if (cached) return cached;
        if (event.request.mode === 'navigate')
          return caches.match(BASE + '/index.html');
        return new Response('Offline', { status: 503 });
      }))
  );
});

// ── MESSAGE: receive schedule from app ──
let _scheduledAlarms = [];

self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data.type === 'SCHEDULE_NOTIFS') {
    // Store the schedule in SW memory
    _scheduledAlarms = event.data.schedule || [];
    // Set up alarm checks every minute
    startAlarmLoop();
    console.log('[SW] Received', _scheduledAlarms.length, 'scheduled notifications');
    return;
  }

  if (event.data === 'GET_VERSION') {
    event.ports[0].postMessage(CACHE_NAME);
  }
});

// ── ALARM LOOP: check every 60s if any notif should fire ──
let _alarmInterval = null;

function startAlarmLoop() {
  if (_alarmInterval) clearInterval(_alarmInterval);
  _alarmInterval = setInterval(checkAlarms, 60 * 1000); // every minute
  checkAlarms(); // check immediately
}

function checkAlarms() {
  const now = Date.now();
  const WINDOW = 90 * 1000; // 90 second window
  _scheduledAlarms = _scheduledAlarms.filter(alarm => {
    if (alarm.fireAt <= now + 5000 && alarm.fireAt >= now - WINDOW) {
      // Fire this notification
      self.registration.showNotification(alarm.title, {
        body: alarm.body,
        icon: BASE + '/icons/icon-192.png',
        badge: BASE + '/icons/icon-192.png',
        tag: alarm.tag,
        requireInteraction: false,
        vibrate: [200, 100, 200],
        data: { url: BASE + '/index.html' }
      }).catch(e => console.warn('[SW] showNotification failed:', e));
      return false; // remove from list after firing
    }
    return alarm.fireAt > now - WINDOW; // keep future ones
  });
}

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : BASE + '/index.html';
  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/lifetracker') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── PERIODIC BACKGROUND SYNC (where supported) ──
self.addEventListener('periodicsync', event => {
  if (event.tag === 'lt-notif-check') {
    event.waitUntil(checkAlarms());
  }
});

// ── PUSH (for future server-sent push) ──
self.addEventListener('push', event => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'Life Tracker', {
        body: data.body || '',
        icon: BASE + '/icons/icon-192.png',
        badge: BASE + '/icons/icon-192.png',
        tag: data.tag || 'lt-push',
        vibrate: [200, 100, 200]
      })
    );
  } catch(e) {}
});
