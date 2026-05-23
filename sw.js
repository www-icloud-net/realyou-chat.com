const CACHE_VERSION = 'realyou-chat-v4';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg'
];
const CDN_HOSTS = new Set(['cdn.jsdelivr.net']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key !== CACHE_VERSION)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.hostname.includes('supabase.co')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  if (url.origin === self.location.origin || CDN_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appClient = allClients.find((client) => client.url.includes('index.html') || client.url.endsWith('/'));
    if (appClient) {
      await appClient.focus();
      appClient.postMessage({ type: 'notification-click', data: event.notification.data || {} });
      return;
    }
    await clients.openWindow('./');
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil((async () => {
    const title = data.title || 'RealYou Chat';
    const options = {
      body: data.body || 'New message',
      icon: './favicon.svg',
      badge: './favicon.svg',
      tag: data.tag || 'realyou-message',
      renotify: Boolean(data.renotify),
      data: data.data || {}
    };
    return self.registration.showNotification(title, options);
  })());
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || cache.match(fallbackUrl);
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || fresh;
}
