# V29 — Bulk requeue, health score e mobile audit do admin

V29 fecha o ciclo de webhooks com 2 polish de ops + mobile responsiveness das telas que cresceram nas últimas versões.

## 1. Bulk requeue do dead-letter (migration 035 + UI)

**RPC `bulk_requeue_webhook_events(p_ids uuid[])`** — admin reseta N eventos dead-letter de uma vez:
- Valida tenant ownership via `WHERE tenant_id = current_tenant_id()`
- Skip de events `test:%` (são one-shot, não fazem sentido em bulk)
- Cap de 500 IDs por chamada (proteção contra OOM)
- Retorna count de eventos efetivamente atualizados

UI na `/admin/webhooks-fila`:
- Coluna nova com checkbox aparece SÓ em linhas dead-letter (linhas processed/pending não selecionam)
- Checkbox no header com estado `indeterminate` quando seleção é parcial
- Toolbar magenta aparece acima da tabela quando há ≥1 selecionado, com count + "Limpar" + "Re-enfileirar N"
- After-success: count na notif + invalida `webhook-queue-events` + `webhook-queue-stats`

Use case real: webhook destinatário ficou fora 12h. Quando voltou, há 87 eventos em dead-letter. Admin marca todos, 1 clique, resolve.

## 2. Health score (migration 035 + UI)

**View `v_webhook_health`** computa score 0-100 por webhook baseado em 3 dimensões:

| Componente | Peso | Cálculo |
|---|---|---|
| Error rate | 40 pts | `40 * min(error_count / dispatch_count, 1.0)` |
| Recency | 30 pts | -30 se `last_called_at < now() - 7 days` |
| Dead-letter | 30 pts | -30 se há ≥1 dead-letter em eventos subscritos pelo webhook |

Score = `100 - penalties`, clamped to [0, 100]. Webhooks sem histórico (dispatch_count=0) ficam em 100.

**Buckets visuais**:
- 80-100 → `saudável` (verde)
- 50-79 → `atenção` (amarelo)
- 0-49 → `crítico` (vermelho)

Helper TS `healthBucket(score)` retorna `{tone, label}`.

UI na `/admin/webhooks`:
- Badge inline mono ao lado do label do webhook (3 chars: score numérico)
- Tooltip mostra breakdown: "127 disparos · 8 erros · 6% erro · 2 em dead-letter"
- Refetch a cada 60s
- Webhooks com `dispatch_count=0` mostram só "100" sem tooltip pesado

## 3. Mobile audit das páginas admin (V24-V28 work)

Várias páginas admin cresceram de 4 → 7 colunas nas últimas versões. Audit visou breakpoints `md` (768px) e `lg` (1024px).

### `/admin/webhooks` — tabela 6 colunas
| Coluna | Mobile (<md) | Tablet (md) | Desktop (lg) |
|---|---|---|---|
| Rótulo | ✓ | ✓ | ✓ |
| Destino | escondida | ✓ | ✓ |
| Assinatura | escondida | escondida | ✓ |
| Status | ✓ | ✓ | ✓ |
| Último disparo | escondida | escondida | ✓ |
| Ações | ✓ | ✓ | ✓ |

URL e Último disparo são re-surfaced inline sob o label em mobile (truncated + meta line). Health badge fica sempre visível ao lado do label.

### `/admin/webhooks-fila` — tabela 8 colunas (com nova coluna checkbox)
| Coluna | Mobile | Tablet | Desktop |
|---|---|---|---|
| ☐ | ✓ | ✓ | ✓ |
| Evento | ✓ | ✓ | ✓ |
| Entidade | escondida | ✓ | ✓ |
| Enfileirado | ✓ | ✓ | ✓ |
| Status | ✓ | ✓ | ✓ |
| Tentativas | escondida | ✓ | ✓ |
| Próximo retry | escondida | escondida | ✓ |
| Ações | ✓ | ✓ | ✓ |

## Build status
```
check-source  ✓ Nenhuma violação
typecheck     ✓ 0 erros
vite build    ✓ 1752 módulos · 13.32s
```

**Bundle health**:
- **Main initial:** 74.51 KB gzip (V28: 74.39 → +0.12 KB)
- **Webhooks chunk:** 9.43 KB gzip (V28: 9.04 → +0.39 KB pra health badge)
- **WebhookQueue chunk:** 5.26 KB gzip (V28: 4.74 → +0.52 KB pra bulk requeue + responsive)
- Margem até 150 KB: **75.5 KB**

## Diff V28 → V29

- **+1 migration** (035 webhook_bulk_ops_and_health ~150L)
- **api.ts**: `bulkRequeueWebhookEvents`, `tenantWebhookHealth`, `healthBucket` helper, `WebhookHealthRow` type
- **WebhookQueue.tsx**: selection state + bulk toolbar + checkbox column + responsive hidden classes
- **Webhooks.tsx**: health badge inline + responsive hidden classes + mobile surfacing de URL + último disparo
- **Sem novas EFs**

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only        # 035
```

Sem dependência de pg_cron — todas as RPCs são chamadas pela UI ou refresh interval.

## Como testar

### Bulk requeue
1. Forçar ≥3 eventos em dead-letter (URL inválida + 5 falhas cada)
2. `/admin/webhooks-fila` → filter "Dead letter" → checkbox header marca todos
3. Toolbar aparece: "3 selecionados · Re-enfileirar 3"
4. Clica → notification de sucesso + lista atualiza
5. SQL para forçar: `UPDATE webhook_event_queue SET attempts = 5, processed_at = NULL, next_attempt_at = now() WHERE id IN (...)`

### Health score
1. `/admin/webhooks` → badge ao lado de cada label mostra score
2. Webhook recém-criado sem disparos: score 100 (verde)
3. Webhook com `error_count = dispatch_count` (100% erro): score baixa pra ~60
4. Webhook idle >7 dias: -30
5. Webhook com dead-letter ativo: -30 adicional
6. Hover no badge revela breakdown

### Mobile
1. Devtools → mobile viewport (iPhone 14 = 393px)
2. `/admin/webhooks` → ver só Rótulo + Status + Ações; URL e último disparo aparecem inline sob o label
3. `/admin/webhooks-fila` → ver só checkbox + Evento + Enfileirado + Status + Ações
4. Rotacionar pra tablet (768px) → Entidade e Tentativas aparecem
5. Full desktop (1024px) → tudo visível
