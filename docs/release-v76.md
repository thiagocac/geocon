# V76 — Hotfix: tela branca pós-deploy

Resposta a um bug de produção em V75: após deploy, usuários reportam tela
totalmente branca em `/dashboard` (e demais rotas autenticadas). Sem qualquer
mensagem visível, sem spinner, sem erro — só fundo `#f8fafc` vazio.

Esta versão não introduz feature nova. Endereça a causa raiz e adiciona três
camadas de defesa contra recorrência futura.

## O que entrega

### 1. Service Worker corrigido (`public/sw.js`)

Bug-raiz: o `CACHE_NAME` foi fixado em `'geocon-v62'` na V62 e **nunca mudou**
em 13 versões (V62→V75). Combinado com a estratégia cache-first para scripts
de qualquer URL, isso fazia `/config.js` (que não tem hash no nome) ficar
permanentemente grudado no cache do navegador da primeira visita.

Quando V75 deployou com config diferente (ex: SUPABASE_URL atualizado), o
browser servia o `config.js` antigo do cache, e o app tentava bootar com
credenciais que não batiam com o backend novo, ou em modo SKIP_AUTH herdado
de uma demo antiga. Crash silencioso → tela branca.

Mudanças:

- `CACHE_NAME` agora segue a versão do produto (`'geocon-v76'`)
- Lista `NEVER_CACHE` com bypass network-only para `/config.js`, `/sw.js`,
  `/manifest.webmanifest` e `/_redirects` — arquivos que mudam sem rename
- `activate` purga **todos** os caches que não sejam o atual (não só caches
  específicos), garantindo limpeza forçada nos usuários afetados pela V62-V75
- Mantém cache-first apenas para `/assets/*` (que têm hash → imutáveis)

### 2. Boot loader inline em `index.html`

Antes: `<div id="root"></div>` vazio + bundle JS de 440 KB para baixar/parsear
→ branco real durante 1-3 segundos no primeiro acesso. Se o bundle crashar,
branco para sempre.

Agora:

- Loader CSS-only com spinner + texto "Carregando geoCon" aparece **antes** do
  bundle baixar
- Handler `window.error` e `unhandledrejection` converte o loader em tela de
  erro visível com stack trace + botões `[Recarregar]` e `[Limpar cache e
  recarregar]`
- Timeout de 15s: se o React não montou nesse intervalo, mostra a tela de erro
  automaticamente
- O `main.tsx` remove o loader via `queueMicrotask` após o primeiro render

Tudo CSS/JS inline → zero requests adicionais, zero impacto no main bundle.

### 3. `BootErrorBoundary` (`src/components/BootErrorBoundary.tsx`)

Envolve o root da árvore React em `main.tsx`. Captura erros de render que
escapam de boundaries internas (provider, hook, lazy chunk com import quebrado)
e renderiza a mesma tela de erro do loader inline — com os mesmos dois botões
de recuperação.

Sem isso, qualquer exception no boot do `<App />` desmontava silenciosamente
toda a árvore e deixava `#root` vazio.

### 4. `netlify.toml`: `Cache-Control` para arquivos sem hash

`/config.js` e `/sw.js` agora recebem `Cache-Control: no-cache,
must-revalidate` no Netlify. Garante revalidação a cada request — mesmo que
o SW saia do caminho, o CDN/navegador não vai mais servir versões obsoletas.

## Decisões

**Por que adicionar boundary e loader, não só consertar o SW?**

O SW corrige a causa raiz para usuários novos, mas os afetados precisam de
um caminho ativo de recuperação. O botão "Limpar cache e recarregar" remove
`navigator.serviceWorker.getRegistrations()` + `caches.keys()` e força reload
— diagnóstico e fix num clique, sem ter que ensinar DevTools.

**Por que `Cache-Control: no-cache` em vez de `no-store` para `/config.js`?**

`no-cache` permite que o navegador envie `If-None-Match` e receba 304 quando
a config não mudou — economiza payload sem comprometer freshness. `no-store`
forçaria download completo a cada navegação.

**Por que purgar TODOS os caches antigos no activate, não só `geocon-v6X`?**

Não dá pra prever que nomes de cache outros sistemas (extensões, ferramentas
de dev) deixaram no escopo do origin. O SW só deve confiar em si mesmo. Como
só usamos `caches.open(CACHE_NAME)` exclusivamente, deletar tudo que não é
`'geocon-v76'` é seguro.

**Por que `queueMicrotask` para remover o loader, não `useEffect`?**

`useEffect` roda após o primeiro paint, mas em modo `StrictMode` ele executa
duas vezes em desenvolvimento. `queueMicrotask` roda exatamente uma vez,
após o render do React, antes do próximo frame — o usuário vê transição
suave do loader para o app sem flash de tela vazia.

**Por que não escrever a tela de erro em React/JSX dentro de `index.html`?**

O ponto inteiro é cobrir o caso em que o React não carrega. A tela de erro
do HTML precisa ser pura JS clássica + DOM API — sem dependências externas.

## Como o usuário afetado se recupera

1. Faz hard reload (`Ctrl+Shift+R` / `Cmd+Shift+R`) — SW velho ativo, mas HTML
   é network-first então pega o `index.html` V76, que vê o SW velho intercept
   `/config.js` e serve do cache...
2. ...mas o `main.tsx` V76 carrega bem (assets com hash novos), monta React,
   AuthProvider chama Supabase → se config errado, `hasSupabase=false`,
   redirect pra `/login`. Login funciona normalmente.
3. No próximo reload, o SW V76 substitui o SW V62 (skipWaiting + claim), o
   activate purga todos os caches antigos, `/config.js` passa a vir fresco.

Pra usuários que ainda veem tela branca após o deploy de V76 (caso raríssimo
de SW V62 não atualizar), o botão "Limpar cache e recarregar" resolve em um
clique.

## Bundle V75 → V76

```
main (gzipped):  109.67 KB → 110.67 KB   (+1.00 KB, margem restante: 39.33 KB)
```

Aumento vem do `BootErrorBoundary` (componente classe com tela de erro
inline). Loader e error handler do `index.html` são inline e não entram no
bundle JS.

## Arquivos modificados

- `public/sw.js` — reescrito (versionamento + NEVER_CACHE + activate forte)
- `index.html` — adicionado boot loader CSS + error handler inline
- `src/main.tsx` — wrap em `BootErrorBoundary` + remoção do loader
- `src/components/BootErrorBoundary.tsx` — novo (95 linhas)
- `netlify.toml` — headers para `/config.js` e `/sw.js`

## Como testar localmente

```bash
npm run build && npm run preview
# Abrir http://localhost:4173/, F12 → Application → Service Workers
# Verificar: "geocon-v76" ativo, "geocon-v62" descartado
# Lighthouse → PWA → confirma loader não causa CLS
```

Para simular o bug original:

```bash
# 1. Em DevTools → Application → Service Workers → checkar "Offline" e fazer reload
#    Deve mostrar tela de erro com botão "Limpar cache e recarregar".
# 2. Em DevTools → Console: throw new Error('teste')
#    Não deve afetar o app (já montou).
# 3. Para simular crash no boot, comentar `<App />` em main.tsx e substituir
#    por um componente que joga exception — BootErrorBoundary captura.
```
