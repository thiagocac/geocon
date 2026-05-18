/* GeoCon Service Worker — V62
 *
 * Estratégia conservadora:
 *   - Cache-first para assets estáticos (JS/CSS/fonts/imagens)
 *   - Network-first para API calls (não cacheia respostas Supabase)
 *   - Network-only para HTML (sempre busca versão fresca)
 *
 * Não interfere no IndexedDB queue (offlineQueue.ts) — a aplicação
 * gerencia operações offline; o SW só serve assets cacheados quando
 * a rede falha.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const CACHE_NAME = 'geocon-v62';
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/logos/logo-mark.svg',
];

self.addEventListener('install', (event) => {
  (event).waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {
      // Se algum recurso falhar (404 em dev), ignora — instala mesmo assim
    })),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  (event).waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // não interfere em POST/PUT/etc

  const url = new URL(req.url);

  // 1) Supabase / APIs externas — não cacheia, deixa passar
  if (url.host.includes('supabase') || url.host.includes('googleapis')) return;

  // 2) HTML — network-first (garante app atualizado quando online)
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/').then((r) => r || new Response('Offline', { status: 503 }))),
    );
    return;
  }

  // 3) Assets (JS/CSS/fonts/imagens) — cache-first com fallback rede
  if (['script', 'style', 'font', 'image'].includes(req.destination)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          // Cacheia se sucesso
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        }).catch(() => new Response('', { status: 503 }));
      }),
    );
  }
});
