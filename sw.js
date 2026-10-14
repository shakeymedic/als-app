// Service worker: lets the app be installed on a phone and keeps working offline.
// Pages and this site's own files are fetched from the network first, so an online user
// always gets the latest version; the cached copy is only used when the network fails
// or takes more than a few seconds. Fonts and libraries from other sites are served
// from the cache and refreshed in the background.
const CACHE = 'als-app-v1';
const PRECACHE = [
  "./",
  "index.html",
  "vendor/inter.css",
  "vendor/tailwind.css",
  "vendor/icons.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png"
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(PRECACHE.map((url) =>
        cache.add(new Request(url, { cache: 'no-cache' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isCacheable(response) {
  return response && (response.ok || response.type === 'opaque');
}

function networkFirst(event) {
  const request = event.request;
  const network = fetch(request);
  // Keep the cached copy up to date whenever the network answers.
  event.waitUntil(network.then((response) => {
    if (response && response.ok) {
      const copy = response.clone();
      return caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
  }).catch(() => {}));
  const cached = () => caches.match(request, { ignoreSearch: request.mode === 'navigate' })
    .then((hit) => hit || (request.mode === 'navigate' ? caches.match('./') : undefined));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    const timer = setTimeout(() => {
      cached().then((hit) => { if (hit) finish(resolve, hit); });
    }, NETWORK_TIMEOUT_MS);
    network.then((response) => {
      clearTimeout(timer);
      finish(resolve, response);
    }, () => {
      clearTimeout(timer);
      cached().then((hit) => (hit ? finish(resolve, hit) : finish(reject, new Error('offline'))));
    });
  });
}

function staleWhileRevalidate(event) {
  const request = event.request;
  return caches.open(CACHE).then((cache) => cache.match(request).then((hit) => {
    const network = fetch(request).then((response) => {
      if (isCacheable(response)) cache.put(request, response.clone());
      return response;
    });
    if (hit) {
      event.waitUntil(network.catch(() => {}));
      return hit;
    }
    return network;
  }));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  if (url.origin === self.location.origin) {
    if (/^\/(\.netlify|api|__)\//.test(url.pathname)) return;
    event.respondWith(networkFirst(event));
    return;
  }
  // Other sites: only static files (fonts, stylesheets, scripts, images); never API calls.
  if (['style', 'font', 'script', 'image'].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});
