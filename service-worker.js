self.addEventListener('install', e => {
  self.skipWaiting();
});

const CORE = [
  '/index.html',
  '/assets/css/styles.css',
  '/assets/js/app.js'
];

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (CORE.includes(url.pathname)) {
    e.respondWith(caches.open('core-v1').then(cache => cache.match(e.request).then(res => {
      if (res) return res;
      return fetch(e.request).then(net => { cache.put(e.request, net.clone()); return net; });
    })));
  } else if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open('assets-v1').then(cache => cache.match(e.request).then(res => {
      const fetchPromise = fetch(e.request).then(net => { cache.put(e.request, net.clone()); return net; });
      return res || fetchPromise;
    })));
  }
});
