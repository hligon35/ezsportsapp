// Bumped versions to invalidate old cached assets (including prodList.json)
const CORE_CACHE = 'core-v9';
const ASSET_CACHE = 'assets-v7';
const CORE = [
  '/index.html',
  '/coming-soon.html',
  '/assets/css/styles.css',
  '/assets/js/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CORE_CACHE).then(cache => cache.addAll(CORE)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => ![CORE_CACHE, ASSET_CACHE].includes(k)).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Network-first for prodList.json so catalog updates appear immediately
  if (url.pathname.endsWith('/assets/prodList.json') || url.pathname.endsWith('/prodList.json')) {
    e.respondWith(
      fetch(e.request)
        .then(net => {
          if (net && net.ok && net.type === 'basic') {
            caches.open(ASSET_CACHE).then(cache => cache.put(e.request, net.clone())).catch(()=>{});
          }
          return net;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Always fetch fresh copies of social icon images to avoid stale caches
  if (url.pathname.endsWith('/assets/img/facebook.png') || url.pathname.endsWith('/assets/img/instagram.png')) {
    e.respondWith(
      fetch(e.request)
        .then(net => {
          if (net && net.ok && net.type === 'basic') {
            caches.open(ASSET_CACHE).then(cache => cache.put(e.request, net.clone())).catch(()=>{});
          }
          return net;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Network-first for CSS & JS so layout/style changes show immediately
  if (/\.(?:css|js)$/.test(url.pathname)) {
    e.respondWith(
      fetch(e.request)
        .then(net => {
          // Only cache successful same-origin basic responses
          if (net && net.ok && net.type === 'basic') {
            caches.open(ASSET_CACHE).then(cache => cache.put(e.request, net.clone())).catch(()=>{});
          }
          return net;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  if (CORE.includes(url.pathname)) {
    e.respondWith(
      caches.open(CORE_CACHE).then(cache =>
        cache.match(e.request).then(res => {
          if (res) return res;
          return fetch(e.request).then(net => {
            if (net && net.ok && net.type === 'basic') {
              cache.put(e.request, net.clone()).catch(()=>{});
            }
            return net;
          });
        })
      )
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    // Stale-while-revalidate for other assets (images)
    e.respondWith(
      caches.open(ASSET_CACHE).then(cache =>
        cache.match(e.request).then(res => {
          const fetchPromise = fetch(e.request).then(net => {
            if (net && net.ok && net.type === 'basic') {
              cache.put(e.request, net.clone()).catch(()=>{});
            }
            return net;
          }).catch(()=>res);
          return res || fetchPromise;
        })
      )
    );
  }
});
