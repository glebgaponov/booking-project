const CACHE_NAME = 'glow-v2';
const STATIC_ASSETS = ['/', '/index.html', '/auth.html', '/about.html', '/404.html', '/manifest.json'];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).catch(() => {})
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.url.includes('/api/')) {
        // Network-first for API
        event.respondWith(
            fetch(request).catch(() => new Response(JSON.stringify({ error: 'Нет соединения' }), { headers: { 'Content-Type': 'application/json' } }))
        );
        return;
    }
    // Cache-first for static
    event.respondWith(
        caches.match(request).then(cached => cached || fetch(request).then(response => {
            if (response.ok) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
            }
            return response;
        }).catch(() => caches.match('/404.html')))
    );
});
