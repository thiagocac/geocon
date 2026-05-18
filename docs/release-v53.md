# V53 — Bell counter + cron de garantias vencendo (fechamento V52)

V53 completa o trabalho da V52 com 2 pequenas adições que fecham o loop UX
e cobrem o 4º alert_kind:

1. **Bell counter integration** — toast efêmero (V52) agora se traduz em
   contador persistente no sino + dropdown integrado
2. **Cron de garantias vencendo** — função SQL + pg_cron + Edge Function
   alternativa, dispara o 4º alert_kind reservado na V52

## Bell counter integration

### Antes (V52)

- Toast aparecia no canto inferior por 12s e sumia
- Bell continuava mostrando apenas `notifications` (modelo antigo)
- Usuário que perdeu o toast (ex: aba inativa) só recuperava recarregando
  e olhando os alerts via Realtime no próximo carregamento
- 2 fontes de notificação visualmente desconectadas

### Depois (V53)

- `NotificationDropdown` consome `useRealtimeAlerts(tenantId)` paralelamente
  à query `listNotifications`
- **Badge unificado**: `totalCount = unreadCount + realtimeCount`
- **Badge vermelho pulsante** quando `realtimeCount > 0` (em vez de magenta
  padrão); cor magenta volta quando só notifications restam
- **Header do dropdown**: nova linha "X ao vivo" em vermelho quando há
  realtime alerts; precede o "Y não lidas · Z totais" original
- **Seção "Lei 14.133 · ao vivo"** acima das notifications agrupadas:
  banner vermelho leve com ícone Zap, "Dismissar todos" à direita, lista
  de RealtimeAlertRow individuais
- **RealtimeAlertRow**: dot tone-aware (red/yellow), kind label + contract
  numero, relativeTime, body, "Ver" navega + dismissa, "Dismissar"
  dismissa sem navegar
- **Empty state**: só mostra "Nenhuma não lida" quando ambas (unread +
  realtime) estão em zero

### Comportamento em SKIP_AUTH

`MOCK_REALTIME_ALERTS_INITIAL` (2 alertas históricos: multa c2 R$ 245k,
vício c3 concreto fck) aparece no sino com timestamps relativos ("há 4
dias", "há 2 semanas"). O usuário pode dismissar individualmente ou em
lote — persistência via `localStorage`. Toast (V52) continua aparecendo
8s após carregar para o alerta "incoming" (garantia c4 ≤6d).

Demo mostra os 2 mecanismos:
- **Toast** (efêmero, 12s) — feedback ativo do que acabou de chegar
- **Sino badge + lista** (persistente) — fila de "pendentes" para revisão

## Cron de garantias vencendo

### Problema técnico

V52 reservou `alert_kind='garantia_vencendo'` no CHECK constraint mas não
disparou trigger porque garantias vencendo dependem **da passagem do
tempo**, não de mudança de estado. Não há INSERT/UPDATE em `contract_guarantees`
quando a vigência se aproxima do fim — só o relógio do servidor anda.

### Solução V53

**Migration 057** adiciona:

1. **`scan_guarantees_expiring(days_ahead int, dry_run bool)` SQL function**
   (SECURITY DEFINER):
   - Itera `contract_guarantees` com `status IN ('ativa','estendida')` e
     `data_vigencia_fim BETWEEN today AND today + days_ahead`
   - JOIN com `contracts` para resolver `tenant_id` + `contract_numero`
   - **Idempotência**: para cada guarantee, verifica se existe alerta
     `garantia_vencendo` nos últimos 7 dias com mesmo `metadata->>guarantee_id`
     e `dismissed_at IS NULL`. Se existe, skip.
   - Severity dinâmico: `≤3d → danger`, `4-7d → warning`
   - Title formatado: "Garantia GA-00128 vence em 6 dias"
   - Body: modalidade label + R$ valor + contrato numero
   - Retorna JSON `{ processed, alerts_created, skipped_idempotent, errors,
     dry_run, days_ahead, executed_at }`

2. **pg_cron job** `scan_guarantees_expiring_daily`:
   - Schedule: `0 6 * * *` (06:00 UTC ≈ 03:00 BRT)
   - Calls `SELECT public.scan_guarantees_expiring(7, false)`
   - Setup idempotente: drop+recreate dentro de DO block que verifica
     `pg_cron` instalado e job anterior existente
   - EXCEPTION handler para ambientes sem pg_cron (local dev): NOOP

3. **GRANT EXECUTE on `_insert_realtime_alert` to service_role** — V52
   criou o helper SECURITY DEFINER mas sem GRANT EXECUTE explícito;
   esta migration corrige para permitir invocação por funções/cron jobs
   service_role.

### Edge Function alternativa

`supabase/functions/scan-guarantees-expiring/index.ts` — mesma lógica em
TypeScript/Deno, expõe endpoint HTTP POST para invocação via Cloud Run, GH
Actions, ou qualquer scheduler externo. Body opcional:
`{ dry_run?: boolean, tenant_id?: uuid, days_ahead?: int }`. Mesma
idempotência via query Supabase client.

**Por que ambos?** A função SQL é a primary (zero overhead, executa dentro
do pg_cron no Supabase). A EF cobre casos onde:
- pg_cron não está disponível (Supabase self-hosted antigo, dev local)
- Operações ad-hoc via curl/dashboard
- Mesmo agente que dispara IBGE / digest / outros crons preferir tudo
  via HTTP (orquestração unificada externa)

## Bundle V52 → V53

| Chunk | V52 | V53 | Δ |
|---|---:|---:|---:|
| Main | 90.04 | **90.44** | **+0.40** |

Delta mínimo: bell integration aproveitou imports/types da V52, só
adicionou o componente `RealtimeAlertRow` (~70 linhas) e branching nos
counts. Margem 150 − 90.44 = **59.56 KB**.

## Decisões

1. **Badge vermelho pulsante quando há realtime** — diferenciação visual
   imediata sem aumentar tamanho do badge. `animate-pulse` do Tailwind
   é zero-cost (CSS animation utility já presente). Volta para magenta
   quando realtime zera.

2. **Realtime acima das notifications no dropdown** — hierarquia de
   urgência. PAR procedente + multa grande + vício grave devem aparecer
   antes de "GRDs recebidos" ou "SLA próximo do vencimento". Banner
   vermelho leve (não saturado) preserva legibilidade.

3. **"Ver" navega + dismissa** — visualizar um alerta é confirmação
   implícita de ciência. Reduz UX duplo-clique (vejo o alerta, leio,
   tenho que voltar e dismissar manualmente).

4. **Migration 057 SQL function + EF alternativa** — V53 oferece
   ambos. SQL é o caminho recomendado (zero latência, rodada nativa).
   EF cobre ambientes especiais e mantém paridade com outros crons V48.

5. **Idempotência 7d** — janela de re-alerta para garantias. Se uma
   garantia foi alertada há 4 dias e ainda não foi dismissada, o cron
   amanhã não re-alerta. Se foi dismissada (admin viu, registrou ação),
   o cron amanhã insere novamente — admin precisa ver de novo se ainda
   não resolveu.

6. **Severity dinâmico ≤3d → danger** — gradient natural: warning para
   garantias 4-7d (planejamento), danger para 0-3d (ação urgente).

7. **Edge Function NÃO chamada de dentro do Postgres** — V52+V53 podia
   ter usado `net.http_post` no trigger para fan-out, mas isso adiciona
   dependência de `pg_net` e complexidade. SQL function nativa é mais
   simples e suficiente.

## Retrospectiva V52 → V53

V52 criou backend (trigger) + frontend (toast) para 3 alert_kinds. V53
fecha o ciclo: cobertura do 4º kind + integração persistente no sino.
Realtime alerts Lei 14.133 agora é feature completa.

| Aspecto | V52 | V53 |
|---|---|---|
| Triggers DB (mudança de estado) | 3 (vício, multa, PAR) | mantém |
| Cron DB (passagem do tempo) | — | 1 (garantia) |
| RPC dismiss/dismiss_all | ✓ | mantém |
| Realtime channel + filter | ✓ | mantém |
| Hook useRealtimeAlerts | ✓ | mantém |
| Toast efêmero | ✓ | mantém |
| Sino badge unificado | — | ✓ |
| Sino dropdown seção dedicada | — | ✓ |
| Demo SKIP_AUTH integração | parcial (só toast) | completa (sino também) |

## Próximas oportunidades (V54+)

V52+V53 fecham o ciclo de "realtime alerts" completo. Próximas opções:

1. **Tenant Dashboard PDF executivo** (~300 linhas) — gera PDF mensal
   com `tenantDashboard` + timeline V44 + realtime_alerts em aberto.
   Reutiliza pdf-lib + Inter WOFF1. CFO/diretor recebe sem logar.
   **Alto valor.**

2. **Comparação cross-tenant super admin** (~250 linhas) — view
   materializada com KPIs Lei 14.133 agregados por tenant, anonimizado,
   com benchmarks de quartil. Página `/admin/cross-tenant`. Útil para
   identificar tenants com risco fora do padrão.

3. **Threshold de multa configurável** (~80 linhas) — move R$ 100k
   hardcoded para `tenant_settings.alert_multa_threshold`. Trigger lê
   dinamicamente. Migration + RPC `set_tenant_setting` + UI admin.

4. **Notification preferences para realtime alerts** (~150 linhas) — V53
   integrou no sino, mas a página `/notifications/preferences` ainda não
   conhece `alert_kind` realtime. Permitir opt-out por categoria.

5. **Webhook outgoing para realtime alerts** (~200 linhas) — quando alerta
   é criado, dispatch para webhook URL configurado por tenant (Slack/Teams/
   custom). Reutiliza infra V45.

Por valor/esforço: **Tenant PDF (1)** é o maior valor (estakeholder
externo recebe sem logar — vendável). **Webhook outgoing (5)** é
operacionalmente impactante (integra com Slack/Teams onde times reais
operam). Continuar V54?
