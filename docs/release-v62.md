# V62 — Offline queue + PWA basic

V62 completa a feature mobile-first iniciada em V61. Transforma o aviso
"sem conexão, operações podem falhar" em **resiliência real**: fiscal grava
no celular offline em obra remota, e operações sincronizam automaticamente
quando volta a ter rede.

## Contexto

V61 entregou interface mobile-first mas com gap explícito: "sem queue
persistente nesta versão — V62 adicionará IndexedDB + Service Worker".

Sem queue, o fiscal em obra com sinal instável ou área sem cobertura
(comum em construção pesada em interior ou subsolo) perde apontamentos.
Inviabiliza uso real. V62 fecha o gap.

## O que V62 entrega

### 1. Helper `src/lib/offlineQueue.ts` (~270 linhas)

Wrapper minimal sobre **IndexedDB nativo** — sem libs (Dexie ~10KB, idb ~8KB).

**Schema**:
```
DB: 'geocon-offline-queue' v1
Store: 'operations' (keyPath 'id')
```

**Tipo `OfflineOperation`**:
```ts
{
  id: string;                  // uuid local
  kind: 'calc_line' | 'evidence' | 'comment';
  payload: Record<string, unknown>;
  created_at: string;
  retries: number;
  last_error?: string;
}
```

**API pública**:
- `enqueueOperation(kind, payload)` — adiciona à fila, retorna id
- `listPendingOperations()` — lista cronológica
- `processQueue()` — itera e executa, atualiza retries/deleta sucesso. Idempotente (lock interno `processing`)
- `resetOperationRetries(id)` — para retry manual após 5 falhas
- `discardOperation(id)` — remove sem executar (descarte)
- `fileToBase64(file)` — helper para serializar evidence offline

**Execução por kind**:
- `calc_line` → `upsertCalcLine(payload)`
- `comment` → `addItemComment(payload)`
- `evidence` → desserializa base64 → `new File([])` → `uploadEvidence`

**Política de retry**:
- Falha incrementa `retries` + grava `last_error`
- Após **5 retries**, fica na fila mas é skipada (operador resolve via UI)
- Continua próxima operação mesmo se uma falha (não bloqueia fila)

### 2. Service Worker `public/sw.js` (~70 linhas)

Estratégia conservadora sem Workbox (~25KB):

| Tipo de request | Estratégia |
|---|---|
| Supabase / googleapis | Não interfere — deixa passar |
| HTML navigate | Network-first, fallback `/` cacheado |
| JS/CSS/font/img | Cache-first com fallback rede |
| POST/PUT/etc | Não interfere |

**Não interfere no offlineQueue** — fila é responsabilidade da aplicação; SW
só serve assets cacheados quando rede falha (PWA funciona offline).

**Lifecycle**:
- `install` → precache de `/`, `/manifest.webmanifest`, logo SVG → `skipWaiting()`
- `activate` → limpa caches antigos → `clients.claim()`

### 3. PWA manifest `public/manifest.webmanifest`

```json
{
  "name": "Consulte GEO — Gestão de Contratos",
  "short_name": "GeoCon",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#182863",
  "background_color": "#ffffff",
  "lang": "pt-BR",
  "icons": [{ "src": "/logos/logo-mark.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }],
  "shortcuts": [{ "name": "Apontamento de campo", "short_name": "Campo", "url": "/medicoes" }]
}
```

Instalável na home screen via "Adicionar à tela inicial" (iOS/Android). Atalho
direto para `/medicoes` no app drawer.

### 4. Meta tags PWA no `index.html`

```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="GeoCon" />
<link rel="apple-touch-icon" href="/logos/logo-mark.svg" />
<!-- viewport-fit=cover adicionado para safe-area no iOS -->
```

### 5. SW registration no `main.tsx`

```ts
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(...);
  });
}
```

- **Não registra em dev** — evita conflitos com Vite HMR
- **Após `load`** — não compete com primeira renderização

### 6. Integração no `MeasurementFieldEntry`

**Detecção dinâmica online/offline**:
- `onSave()` em online → `upsertCalcLine` + `addItemComment` direto
- `onSave()` em offline → `enqueueOperation('calc_line', ...)` + `enqueueOperation('comment', ...)`
- `onPhotoChosen()` em offline → `fileToBase64` + `enqueueOperation('evidence', ...)`

**Sincronização automática**:
- Listener `window.addEventListener('online', up)` → `runSync()` imediato
- Polling 30s quando online + fila não-vazia
- Triggered no mount da página

**UI da fila**:
- **Badge no header**: "X na fila · tocar para sincronizar" (clicável quando online)
- Durante sync: `Loader2` + "Sincronizando…"
- Após sync: toast "N sincronizada(s)" (auto-hide 4s)
- **Foto enfileirada**: badge laranja "Fila" no canto superior direito do thumbnail

**Mensagem offline** atualizada (positiva):
- Antes (V61): "ao salvar, operação **pode falhar**"
- Agora (V62): "operação será **guardada na fila** e sincronizada quando voltar online"

### 7. Flow completo demonstrável

1. Fiscal abre `/contratos/:id/medicoes/:medId/campo` no celular
2. Indicador "Online" no header
3. Sinal cai (subsolo/área remota) → indicador "Offline"
4. Aponta quantidade 312, tira foto, dita observação → toca Salvar
5. 3 operações enfileiradas em IndexedDB. Badge mostra "3 na fila · aguardando rede"
6. Continua próximos itens, gera mais operações
7. Volta a ter rede → indicador "Online" + sync automático dispara
8. Toast: "9 sincronizadas". Badge desaparece.

Tudo funciona sem app fechar. Se fechar: ao reabrir online, sync dispara no mount.

## Decisões

1. **IndexedDB nativo, não Dexie/idb** — economia ~10KB. Wrapper minimal
   (~270 linhas) cobre uso real.

2. **base64 para Blob de evidence** — IndexedDB suporta Blob mas alguns
   navegadores móveis (Safari iOS específicamente) perdem referência ao
   armazenar Blob. base64 ocupa ~33% mais espaço mas é confiável.

3. **Sem Background Sync API** — ainda experimental em iOS Safari (em 2026
   ainda não estável). Substituído por `window.online` listener + polling
   30s. Cobre 95% dos casos sem complexidade extra.

4. **Service Worker conservador** — não cacheia API calls (evita
   inconsistência), só assets. PWA "funciona offline" no sentido de carregar
   o app shell; dados continuam exigindo rede (ou fila).

5. **5 retries máximo** — após isso, operação fica na fila mas é skipada.
   Operador pode resetar manualmente (V63 pode adicionar UI dedicada para
   inspeção da fila).

6. **Polling 30s, não imediato** — após `online` event, run uma vez; depois
   polling. Evita spam de tentativas se rede flutuar.

7. **Não registra SW em dev** — `import.meta.env.DEV` check. HMR + SW
   competem por cache; em dev, sempre quer versão fresca.

8. **Sem versionamento do SW** — `CACHE_NAME = 'geocon-v62'`. Para forçar
   atualização em V63+, mudar para `'geocon-v63'` — usuário pode ter SW
   antigo cacheado. Migration manual conhecida do PWA-world.

9. **Shortcut `/medicoes`** no manifest — atalho do app drawer leva à lista,
   não à página de campo (que requer contexto medição específica).

10. **Foto offline mostra thumbnail local** via `URL.createObjectURL` — mesmo
    sem ter sincronizado, o fiscal vê o que tirou. Quando sincroniza, foto
    fica na evidence real do sistema.

## Limitações conhecidas (V63+)

- **Sem UI de inspeção da fila** — só badge agregado. Para operações
  bloqueadas (>5 retries), operador não vê detalhes sem console. V63 pode
  adicionar `/medicoes/fila`.
- **Sem deduplicação** — se fiscal salvar mesmo item 2× offline, vai
  enfileirar 2 calc_lines. O backend tolera (upsert é idempotente por id),
  mas a fila duplicada confunde o contador.
- **Sem progress real** — evidence base64 de 5MB ocupa 6.5MB no IndexedDB.
  Sem UI de "X% do quota usado". Para fiscais que tiram dezenas de fotos
  offline, pode encher.

## Bundle V61 → V62

| Chunk | V61 | V62 | Δ |
|---|---:|---:|---:|
| Main | 99.42 | **99.54** | +0.12 |
| MeasurementFieldEntry (lazy) | 12 KB raw | **16 KB raw** | +4 KB raw |
| public/sw.js | — | 2.3 KB | (não-bundled) |
| public/manifest.webmanifest | — | 743 B | (não-bundled) |

Margem 150 − 99.54 = **50.46 KB**. Δ no main quase imperceptível porque
offlineQueue é importado só pela página de campo (lazy chunk). SW + manifest
são arquivos estáticos servidos direto pelo CDN.

## Sequência V54-V62 cumulativa

| Versão | Área | Tema | Bundle | Δ |
|---|---|---|---:|---:|
| V54 | Medição | Validações automáticas | 92.69 | +2.25 |
| V55 | SOV | Curva ABC + Pareto | 94.63 | +1.94 |
| V56 | GED | Validade temporal + cron | 95.79 | +1.16 |
| V57 | SOV | Auditoria preços SINAPI/SICRO | 97.50 | +1.71 |
| V58 | GED | Diff entre revisões | 98.23 | +0.73 |
| V59 | GED | Painel KPI do acervo | 98.67 | +0.44 |
| V60 | GED | Workflow aprovação revisão | 99.32 | +0.65 |
| V61 | Medição | Apontamento campo mobile | 99.42 | +0.10 |
| V62 | Medição | **Offline queue + PWA** | 99.54 | +0.12 |

**+6.85 KB total** em 9 versões = 14% do crescimento até 150 KB.
Cobertura: Medição **3×** · SOV 2× · GED 4×. Balanço melhora — Medição agora
tem 3 toques (V54 validações + V61 campo + V62 offline).

## Próximas oportunidades (V63+)

**Completar V62**:
1. **UI de inspeção da fila offline** (~150 linhas) — `/medicoes/fila` lista
   operações pendentes, mostra retries + last_error, botões "Retry" e
   "Descartar". Cobre fila bloqueada (>5 retries).

**Ativar V60 na prática**:
2. **Notificação automática workflow** (~150 linhas) — trigger no INSERT
   de ged_revision_approval_steps dispara notification para assigned_to.

**Features grandes**:
3. **Composições de preço explícitas SOV** (~400 linhas) — schema novo
   `contract_item_compositions`. Liga V57 com SINAPI compositions oficiais.
4. **Marca d'água "CÓPIA NÃO CONTROLADA" GED** (~300 linhas) — Edge Function +
   ICP-Brasil opcional.

**Quick wins SOV**:
5. **Histórico item-level (audit trail)** (~200 linhas) — quem mudou o
   preço de quando para quando.

V63 natural: **Notificação automática workflow (2)** ativa V60 em produção;
**UI inspeção fila (1)** completa V62. Continuar com qual?
