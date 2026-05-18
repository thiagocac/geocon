/* GeoCon Service Worker — V76
 *
 * Mudanças em V76 (hotfix tela-branca pós-deploy):
 *   - CACHE_NAME agora carrega a versão do produto. Sempre que o produto
 *     muda, o SW antigo é desativado e o cache antigo é purgado no activate.
 *     Antes (V62-V75): CACHE_NAME = 'geocon-v62' constante → cache nunca
 *     era invalidado, e /config.js (sem hash) ficava grudado pra sempre.
 *   - /config.js, /sw.js, /manifest.webmanifest e /_redirects passam por
 *     NETWORK-ONLY (bypass total). Esses são arquivos de configuração que
 *     mudam sem rename, então cachear nunca foi seguro.
 *   - HTML segue network-first (igual V62).
 *   - Assets com hash (JS/CSS/font/img em /assets/) seguem cache-first
 *     (imutáveis por construção do Vite).
 *
 * Estratégia geral mantida:
 *   - Cache-first para assets versionados em /assets/*
 *   - Network-first para HTML (sempre busca versão fresca)
 *   - Network-only para arquivos de configuração e API
 *   - Não interfere em POST/PUT/DELETE
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const CACHE_NAME = 'geocon-v76';
const PRECACHE_URLS = [
  '/logos/logo-mark.svg',
];

/** URLs que NUNCA devem ser cacheadas (mudam sem rename). */
const NEVER_CACHE = [
  '/config.js',
  '/sw.js',
  '/manifest.webmanifest',
  '/_redirects',
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
      // Limpa TODOS os caches antigos (não só os não-V76).
      // Crítico após o bug do CACHE_NAME estagnado em 'geocon-v62' nas
      // versões V62-V75: usuários de longa data têm /config.js obsoleto.
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

  // 2) Arquivos de configuração (mudam sem rename) — network-only
  if (NEVER_CACHE.includes(url.pathname)) {
    event.respondWith(fetch(req));
    return;
  }

  // 3) HTML — network-first (garante app atualizado quando online)
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/').then((r) => r || new Response('Offline', { status: 503 }))),
    );
    return;
  }

  // 4) Assets (JS/CSS/fonts/imagens) — cache-first com fallback rede.
  //    Seguro porque Vite gera nomes com hash (/assets/*-XXXXXXXX.js).
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
