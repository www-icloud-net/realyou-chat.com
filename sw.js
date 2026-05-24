const CACHE_VERSION = 'realyou-chat-v8-android-lite';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './realyou-chat-app-icon-64.png',
  './realyou-chat-app-icon-192.png',
  './realyou-chat-app-icon-512.png'
];
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const CDN_HOSTS = new Set(['cdn.jsdelivr.net']);
const MAX_RUNTIME_ENTRIES = 80;
const NAVIGATION_TIMEOUT_MS = 2600;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key !== CACHE_VERSION && key !== RUNTIME_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.hostname.includes('supabase.co')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
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
    await clients.openWindow('./index.html');
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
      icon: './realyou-chat-app-icon-192.png',
      badge: './realyou-chat-app-icon-64.png',
      image: data.image,
      tag: data.tag || 'realyou-message',
      renotify: Boolean(data.renotify),
      data: data.data || {},
      actions: [{ action: 'open', title: 'Open' }]
    };
    return self.registration.showNotification(title, options);
  })());
});

async function navigationHandler(request) {
  const cache = await caches.open(CACHE_VERSION);
  const networkPromise = fetch(request).then((response) => {
    if (response && response.ok) cache.put('./index.html', response.clone());
    return response;
  });
  const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('navigation-timeout')), NAVIGATION_TIMEOUT_MS));
  try {
    return await Promise.race([networkPromise, timeoutPromise]);
  } catch {
    return (await cache.match('./index.html')) || cache.match('./');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then(async (response) => {
      if (response && response.ok && response.type !== 'opaque') {
        await cache.put(request, response.clone());
        pruneRuntimeCache(cache).catch(() => {});
      }
      return response;
    })
    .catch(() => cached);
  return cached || fresh;
}

async function pruneRuntimeCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_RUNTIME_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES).map((key) => cache.delete(key)));
}
