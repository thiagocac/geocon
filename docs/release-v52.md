# V52 — Realtime alerts Lei 14.133

V52 quebra a sequência de 3 versões sem migration (V49-V51) com uma feature
nova de alto valor demonstrável: alertas Lei 14.133 chegando em tempo real
via Supabase Realtime, com toast UI global e dismissal persistente.

## A oportunidade

Após V51 fechar todos os débitos órfãos e o demo mode ficar 100% consistente,
o backlog "Próximas oportunidades" tinha 5 itens. Escolhi **Realtime alerts**
porque:

- **Alto valor demonstrável**: visualmente impactante em demo — toast
  desliza de fora da tela quando um vício grave é registrado por outro
  usuário, sem refresh manual
- **Escopo isolado**: novo trigger Postgres + 1 tabela + 1 hook React +
  1 componente. Não toca arquitetura existente.
- **Cumulativo**: usa as resources Lei 14.133 (V42-V47) e timeline (V44)
  como sources; valor cresce com cada nova feature Lei 14.133

## O que V52 entrega

### 1. Migration 056 — tabela `realtime_alerts` + 3 triggers

**Tabela** `public.realtime_alerts`:
- Campos: `id`, `tenant_id`, `contract_id`, `contract_numero` (snapshot),
  `alert_kind` (4 valores), `severity` (warning/danger), `title`, `body`,
  `ref_link`, `metadata` (jsonb), `created_at`, `dismissed_at`, `dismissed_by`
- Índices: `(tenant_id, created_at DESC)` parcial onde `dismissed_at IS NULL`
  (atende query principal "minhas pendentes"); `(contract_id)` parcial
- RLS multi-tenant: SELECT/UPDATE filtrados por `members.tenant_id`
- INSERT/DELETE: apenas `service_role` (via triggers ou admin)

**3 triggers automáticos**:

| Trigger | Tabela origem | Condição |
|---|---|---|
| `_trg_alert_vicio_grave` | `contract_receipt_vicios` | severidade IN ('alta','critica') AND status IN ('aberto','em_saneamento') |
| `_trg_alert_multa_grande` | `contract_sanctions` | tipo='multa' AND valor_multa > 100_000 AND status IN ('ativa','suspensa') AND data_pagamento IS NULL |
| `_trg_alert_par_procedente` | `contract_par_processes` | status='decidido' AND decisao_resultado IN ('procedente','parcialmente_procedente') |

Cada trigger:
- Fires em INSERT **e** UPDATE (cobre tanto criação direta quanto transição
  via workflow)
- Deduplica: verifica se campos relevantes mudaram entre OLD e NEW antes de
  inserir (evita re-alerts em updates não-disruptivos)
- Resolve `tenant_id` via JOIN à `contracts`
- Chama helper `_insert_realtime_alert` que faz snapshot do `contract_numero`
  (para preservar exibição mesmo após delete do contrato)

**Garantias vencendo ≤7d** ficaram **fora dos triggers**: são detectadas
pela passagem do tempo, não por mudança de estado. Devem ser geradas via
cron/EF (V53?). Já tem `alert_kind: 'garantia_vencendo'` reservado no
CHECK constraint.

**2 RPCs** para o cliente:
- `dismiss_realtime_alert(p_alert_id)` — marca dismissed_at = now() + dismissed_by = auth.uid()
- `dismiss_all_realtime_alerts()` — bulk dismiss, retorna count

**Realtime publication**: tabela adicionada idempotentemente à publication
`supabase_realtime`. Idempotência via `pg_publication_tables` check + handler
de `undefined_object` (compat com ambientes sem Supabase).

### 2. API frontend (`src/lib/api.ts`)

```ts
// Types
type RealtimeAlertKind = 'vicio_grave' | 'multa_grande' | 'par_procedente' | 'garantia_vencendo';
type RealtimeAlertSeverity = 'warning' | 'danger';
interface RealtimeAlert { ... }

// Fetchers
listUndismissedRealtimeAlerts(): Promise<RealtimeAlert[]>
dismissRealtimeAlert(id): Promise<void>
dismissAllRealtimeAlerts(): Promise<number>

// Subscribe
subscribeToRealtimeAlerts(tenantId, onAlert): () => void
```

**Channel filter server-side**: `filter: 'tenant_id=eq.${tenantId}'` no
`postgres_changes` — bandwidth tenant-scoped, sem leak cross-tenant.

### 3. Hook React (`src/hooks/useRealtimeAlerts.ts`)

```ts
useRealtimeAlerts(tenantId): { alerts, isLoading, dismiss, dismissAll }
```

- Fetch inicial das alerts não-dismissadas
- Subscribe via Realtime channel
- Dedup por `id` (evita race entre fetch inicial e Realtime entregar mesma)
- Cleanup automático no unmount (remove channel)

### 4. Componente Toast (`src/components/layout/RealtimeAlertToasts.tsx`)

- Stack vertical fixed bottom-right, max 3 visíveis
- Overflow: "+N alertas adicionais" + botão "Limpar todos"
- Auto-hide visual após 12s (não dismissa no servidor — só remove da fila
  local; recarregar página traz de volta se ainda não-dismissados)
- X dismissa permanentemente (RPC `dismiss_realtime_alert`)
- "Ver detalhes" navega para `ref_link` + hide local
- Ícones diferenciados por severity (AlertOctagon vs AlertTriangle)
- Cores diferenciadas: danger=error/red, warning=yellow

**CSS keyframe** `geocon-toast-in` em styles.css (slide-in da direita +
fade-in, 280ms, ease-out). Substituiu Tailwind animate plugin (não
instalado neste projeto).

### 5. SKIP_AUTH demo

- 2 alertas iniciais com dates hardcoded de 2025-11-12 / 2025-11-02 — se
  abre o demo agora, auto-hide imediato (são "histórico" passado, mas
  ainda contam para o counter)
- 1 alerta "incoming" com `created_at = new Date()` que dispara via
  `setTimeout(8000)` depois da subscribe — demonstra o slide-in animado
- Dismissal persiste em `localStorage` (chave `geocon:demo:realtime_dismissed`)
  — usuário não vê o mesmo alerta repetir após dismissar
- Fired alerts persistem em `localStorage` (chave `geocon:demo:realtime_fired`)
  — recarregar a página não re-dispara o "incoming"

## Decisões

1. **Tabela + Realtime publication** vs subscribe direto às tabelas
   origem: escolhi tabela intermediária porque:
   - Filtragem server-side via trigger (não cliente)
   - Multi-tenant safety: cliente só assina sua linha em uma única tabela
   - Dismissal/persistência sem mexer nas tabelas de domínio
   - História completa de alerts (audit trail futuro)

2. **Threshold "multa grande"** = R$ 100.000 hardcoded no trigger:
   alinhado com `tenantDashboardAlerts.multas_grandes_pendentes` (V42)
   e dashboard PDF (V43). Considerei tornar configurável por tenant, mas
   "1 setting a mais para configurar" piora UX inicial; pode virar
   `tenant_settings.alert_multa_threshold` em V53 se precisar.

3. **Auto-hide 12s** local-only (sem dismiss no servidor): UX comum
   para toast — desaparece sozinho mas continua marcado como
   "não-dismissado". Dismissal explícito (X) é a ação intencional.

4. **Dedup OLD vs NEW nos triggers**: evita re-disparar em UPDATEs que
   mexem em campos não relacionados (ex: alguém edita `metadata` da
   sanção). Trade-off: se `severidade` aumenta de média→alta, dispara
   corretamente; se permanece alta, não re-dispara.

5. **`MOCK_REALTIME_ALERTS_INITIAL` com datas históricas**: representa
   alertas que "já aconteceram" e o usuário viu (auto-hide imediato).
   Alternativa rejeitada: datas atuais — apareceriam 3 toasts simultâneos
   no load, dando impressão de spam.

6. **Sem mock para 'par_procedente' e 'vicio_grave' incoming**: V51 já
   mostra esses no MOCK_TENANT_DASHBOARD.recent_events; a demo desta
   feature foca no "live" delivery (1 alerta incoming = ponto suficiente).

7. **Sem badge counter no bell icon ainda**: integração com
   NotificationDropdown ficaria fora de escopo. V53 pode mesclar com o
   sino existente.

## Bundle V51 → V52

| Chunk | V51 | V52 | Δ |
|---|---:|---:|---:|
| Main | 88.22 | **90.04** | +1.82 |

Margem 150 − 90.04 = **59.96 KB**. Custo cobre ~250 linhas de api.ts + hook
+ toast component + CSS keyframe.

## Retrospectiva V42 → V52 (11 versões)

| Versão | Foco | Migration |
|---|---|---|
| V42-V44 | Lei 14.133 V35-V38 backend + timeline | 042-046, 051 |
| V45-V47 | REST público + sancionados | 052, 053 |
| V48 | IBGE automático | 054, 055 |
| V49 | Pendencias mocks | — |
| V50 | Carteira mocks | — |
| V51 | Sub-resources mocks | — |
| **V52** | **Realtime alerts** | **056** |

Migration 056 quebra streak de 3 zeros — feature efetivamente nova.

## Próximas oportunidades (V53+)

1. **Bell icon counter integration** — mesclar `realtime_alerts` com o
   sino do NotificationDropdown existente (V52 deixou separados).
   Estimativa: 1-2h, ~100 linhas.

2. **Cron de garantias vencendo ≤7d** — Edge Function diária que itera
   guarantees ativos com `data_vigencia_fim - now() <= '7 days'` e
   insere `alert_kind='garantia_vencendo'`. Idempotência: skip se já
   há alerta para essa guarantee criado nos últimos 7 dias.
   Estimativa: 1 EF + 1 trigger schedule, ~150 linhas.

3. **Tenant Dashboard PDF executivo** — Edge Function mensal que
   gera PDF com tenantDashboard + timeline V44 + alertas V52.
   Reutiliza pdf-lib + Inter WOFF1. CFO/diretor recebe sem logar.
   Estimativa: ~300 linhas.

4. **Comparação cross-tenant super admin** — KPIs Lei 14.133
   anonimizados com quartis. Plataforma vê concentrações de risco.
   Estimativa: 1 view materializada + 1 RPC + 1 página admin.

5. **Configurar threshold de multa por tenant** — V52 hardcoded
   R$ 100k. Mover para `tenant_settings.alert_multa_threshold` +
   ajustar trigger para LER essa configuração. Estimativa: 50 linhas.

Por valor/esforço: **Bell counter (item 1)** é o mais barato e fecha
o loop UX (toast efêmero + persistente no sino). **Cron garantias (2)**
completa a feature V52 (atualmente só 3 dos 4 alert_kinds disparam).
**Tenant PDF (3)** é maior valor para CFO/diretor.
