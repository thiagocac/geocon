# V26 — Webhook event queue + retry/backoff + sidebar limpo

Esta versão expande webhooks pra além de `broadcast_sent`: triggers de domínio enfileiram eventos quando algo relevante acontece (risco crítico, medição decidida, aditivo aprovado), e uma fila genérica com retry exponencial garante entrega.

## 1. Webhook event queue (migration 032)

### Tabela `webhook_event_queue`

```sql
id              uuid PK
tenant_id       uuid → tenants
event           text                 -- ex: 'risk_critico_changed'
entity_type     text                 -- 'contract' | 'measurement' | 'additive'
entity_id       uuid
payload         jsonb                -- dados específicos do evento
enqueued_at     timestamptz
next_attempt_at timestamptz          -- usado pelo drain + backoff
processed_at    timestamptz          -- NULL = ainda pendente
attempts        int                  -- 0..5
last_error      text
```

Index parcial `idx_webhook_queue_pending_due` em `next_attempt_at` filtrado por `processed_at IS NULL AND attempts < 5` mantém o drain rápido mesmo com fila grande.

### Triggers de domínio

3 triggers `AFTER UPDATE` que chamam `enqueue_webhook_event` quando há transição relevante:

| Trigger | Tabela | Condição | Payload |
|---|---|---|---|
| `trg_contract_risk_snapshots_to_queue` | `contract_risk_snapshots` | `nivel = 'critico'` E anterior não era crítico | score, nivel, previous_nivel, contract_id, contract_numero, contract_objeto, captured_at, source |
| `trg_measurements_decided_to_queue` | `measurements` | status entra em (aprovada, devolvida, paga) | measurement_id, contract_id, numero, status_before, status_after, periodo_inicio, periodo_fim, valor_liquido |
| `trg_additives_approved_to_queue` | `additives` | status entra em (aprovado, incorporado), e anterior não era | additive_id, contract_id, numero, tipo, valor_liquido, data_aprovacao |

`enqueue_webhook_event` usa otimização **lazy**: só insere na fila se há webhooks ativos do tenant inscritos no evento. Tenants sem webhooks configurados não geram garbage rows.

### Drain via EF + pg_cron

**`drain-webhook-queue`** (service_role only):
- Chama RPC `drain_webhook_queue` que faz `SELECT … FOR UPDATE SKIP LOCKED` + `attempts++` atomicamente
- Pra cada evento: resolve webhooks ativos do tenant inscritos no `event`, constrói payload tonal (Slack Block Kit / Teams MessageCard / generic JSON ou template customizado), POSTa com HMAC se configurado, registra dispatch
- Política: pelo menos 1 webhook OK → ack; todos falharam → nack (agenda backoff)
- Sem webhooks subscritos → ack como no-op (limpa fila)

**Cron automático** (migration 032 parte C): `cron.schedule('* * * * *', …)` chama a EF via `pg_net.http_post` a cada minuto. Idempotente: pula agendamento se `pg_cron`/`pg_net` ausentes ou settings não configurados.

### Backoff exponencial

`webhook_retry_delay(attempts)`:

| Tentativas | Próximo retry |
|---|---|
| 1ª (fresh) | imediato |
| 2ª (1 falha) | +5min |
| 3ª (2 falhas) | +30min |
| 4ª (3 falhas) | +2h |
| 5ª (4 falhas) | +12h |
| ≥5 (5 falhas) | dead letter (não re-tenta) |

`nack_webhook_event(id, error)` calcula `next_attempt_at = now() + webhook_retry_delay(attempts)` e grava `last_error`. O drain só pega eventos onde `next_attempt_at <= now()`.

## 2. UI: `/admin/webhooks-fila`

Nova página com:

- **4 KPIs** em tempo real (refresh 15s): Prontos pra disparo · Em backoff · Processados · Dead letter
- **3 contadores históricos** por tipo de evento (riscos críticos, medições decididas, aditivos aprovados)
- **Filtro de status**: Todos / Pendentes / Processados / Dead letter
- **Tabela** com evento, entidade, enqueued_at, status visual, tentativas (N/5), próximo retry, ações (inspecionar / requeue)
- **Modal de inspeção** mostra payload JSON completo + erro persistido
- **RPC `requeue_webhook_event`** reseta tentativas pra zero — permite admin re-tentar manualmente quando o problema foi resolvido (URL trocada, autenticação corrigida)

## 3. Sidebar admin reorganizado

12 entradas estavam em uma lista flat. Agora agrupadas em 4 subcategorias visuais:

| Subgrupo | Entradas |
|---|---|
| **Pessoas & cadastro** | Usuários · Tenants · Programas · Disciplinas |
| **Comunicação** | Digests · Broadcasts · Aliases |
| **Integrações** | Webhooks · Fila eventos |
| **Operação interna** | Workflows · Risco · batch · Auditoria · Backlog |

Cada subgrupo tem header tonal `font-mono text-[9px] uppercase tracking-display text-white/40`. Ordem dos itens preservada; nenhuma rota mudou. Subgrupos vazios (filtrados por role) não renderizam.

## 4. Eventos no Webhook composer

`/admin/webhooks` ganha selector de eventos no modal de edit:

- 4 checkboxes (broadcast_sent, risk_critico_changed, measurement_decided, additive_approved)
- Cada um com label + descrição + token visível
- Validação: pelo menos 1 evento obrigatório
- `openEdit` lê `w.events` (com fallback pra `['broadcast_sent']` se vazio)

## Build status

```
check-source  ✓ Nenhuma violação
typecheck     ✓ 0 erros
vite build    ✓ 1750 módulos · 10.18s
```

**Bundle health**:
- **Main initial:** 73.98 KB gzip (V25: 73.53 → +0.45 KB)
- **Webhooks chunk:** 6.73 KB gzip (V25: 6.45 → +0.28 KB pro events selector)
- **WebhookQueue (novo, lazy):** 3.40 KB gzip
- Margem até alvo: **76 KB gzip** (alvo 150 KB)

## Diff V25 → V26

- **+1 migration** (032 webhook_event_queue ~430L)
- **+1 EF** (`drain-webhook-queue` ~330L) com payload builders por evento
- **+1 página admin** (`WebhookQueue.tsx`)
- **api.ts**: 4 wrappers novos (`tenantWebhookQueueStats`, `listWebhookQueueEvents`, `requeueWebhookEvent`, `WEBHOOK_DOMAIN_EVENT_OPTIONS`); `WebhookEvent` type expandido pra 4 valores
- **Sidebar.tsx** reorganizado em 4 subgrupos
- **Webhooks.tsx** ganha events selector no modal + `openEdit` lê events da row
- **App.tsx**: rota `/admin/webhooks-fila` lazy

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only        # 032
supabase functions deploy drain-webhook-queue
```

Pré-requisitos pro drain automático em produção:
- Supabase Pro plan (pg_cron + pg_net)
- Settings configurados:
  ```sql
  ALTER DATABASE postgres SET app.settings.supabase_url     = 'https://<ref>.supabase.co';
  ALTER DATABASE postgres SET app.settings.service_role_key = '<key>';
  ```
- Re-rodar `032_webhook_event_queue.sql` pra registrar o cron

Sem cron, o backend funciona — apenas o drain não roda automaticamente. Admin pode chamar manualmente:
```bash
curl -X POST "$SUPABASE_URL/functions/v1/drain-webhook-queue" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -d '{"limit": 100}'
```

## Como testar

### Trigger de risco crítico
1. Em um contrato, force um snapshot novo via `/admin/risco-batch` ou `/contratos/:id/risco` → "Recalcular"
2. Se o snapshot computar `nivel='critico'` (score ≥ 70) e o anterior não era → trigger dispara
3. `/admin/webhooks-fila` → evento `risk_critico_changed` aparece em "Pendentes"
4. Aguarde até 1 min → drain processa → status muda para "Processado" (se há webhook subscrito) ou "Pendente · 0 webhooks" (no-op)

### Backoff
1. Configure webhook genérico com URL inválida (ex: `https://httpbin.org/status/500`)
2. Marque evento `additive_approved`
3. Aprovar um aditivo → fila enfileira
4. Drain processa → 500 retorna → `attempts=1`, `next_attempt_at = +5min`, status visual "Em backoff"
5. Após 5 falhas → vai pra "Dead letter"; botão Requeue (rotate) reseta

### Requeue
1. Linha em dead-letter → clique ícone "RotateCcw"
2. `attempts=0`, `next_attempt_at=now`, `processed_at=NULL`
3. Próximo drain re-tenta
