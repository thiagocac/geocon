# V28 — Webhook operability: auto-rotate, real-entity preview, test isolado, CSV dead-letter

V28 fecha 4 frentes que faltavam pra operação webhook ser confortável: rotação automática de secrets, preview com dados reais, re-envio isolado e exportação CSV pra investigar dead-letters offline.

## 1. Auto-rotate de signing secrets (migration 034)

`tenant_webhooks` ganha:
- `auto_rotate_after_days int CHECK (BETWEEN 7 AND 365 OR NULL)` — NULL = manual only

**View `v_webhooks_due_rotation`** computa quem está atrasado:
```sql
WHERE active = true
  AND signing_secret IS NOT NULL
  AND auto_rotate_after_days IS NOT NULL
  AND (secret_rotated_at OR created_at) + days < now()
```

**RPC `rotate_webhook_secret_silent(p_id)`** (service_role): gera novo secret, atualiza `secret_rotated_at`, e cria notification `kind='system'` pra cada admin do tenant com o secret cru no `body` e `metadata.auto_rotated_secret=true`. Essa é a ÚNICA forma do admin pegar o secret novo (caminho equivalente ao modal write-once do path manual).

**RPC `auto_rotate_due_webhooks()`** itera a view, chama silent rotate, retorna tabela `(webhook_id, tenant_id, label, rotated_at, admins_notified)`.

**pg_cron diário às 04:00 UTC** chama `auto_rotate_due_webhooks()` automaticamente.

UI: novo campo "Rotação automática" no modal de webhook (Select: Nunca / 30 / 60 / 90 / 180 dias).

## 2. Real-entity preview no compositor (migration 034 + UI)

**RPC `search_entities_for_webhook(p_event, p_query, p_limit)`** — 5 estratégias de search:

| Eventos | Tabela | Filtro |
|---|---|---|
| `risk_critico_changed`, `broadcast_sent` | `contracts` | numero ou objeto ILIKE |
| `measurement_emitted`, `measurement_decided` | `measurements ⋈ contracts` | numero do contrato ou status |
| `additive_approved` | `additives ⋈ contracts` | numero/tipo/status |
| `unforeseen_pending` | `unforeseen_items ⋈ contracts` | numero/descricao/status |
| `digest_failed` | `digest_sends ⋈ members` | email/nome (apenas `email_status='failed'`) |

Retorna `(id, label, hint)` — label vai no combobox, hint é texto secundário.

`<WebhookPayloadPreview>` ganha entity picker:
- Search input com auto-suggest debounced via React Query
- Click numa sugestão → seleciona, passa `entity_id` pro `buildWebhookSamplePayload`
- Botão X limpa seleção → volta pra payload sintético
- Reset automático quando admin troca de evento (incompatibilidade óbvia)

Diferença chave: sem entidade, `payload.synthetic=true` (V27 só fazia isso). Com entidade, `synthetic=false` e os campos refletem dados REAIS do tenant — perfeito pro admin testar se o destinatário externo consegue parsear a estrutura.

## 3. Test event isolado (migration 034 + EF + UI)

Cenário: admin viu no dead-letter que o webhook "Slack ops" falhou. Trocou a URL. Quer re-enviar APENAS pra ele — não pros outros webhooks que já tiveram sucesso (não quer duplicar entregas).

**RPC `enqueue_webhook_test(p_source_event_id, p_target_webhook)`** (admin-only):
- Valida que source event e target webhook são do tenant
- Cria nova row em `webhook_event_queue` com:
  - `event = 'test:' + original_event`
  - `payload` mesclado com `_test=true, _test_target, _test_source, _test_by, _test_label`

**`drain_webhook_queue` reescrito** (migration 034 substitui o de 032) filtra `event NOT LIKE 'test:%'` — o drain principal NÃO processa testes. Eles ficam pro dispatcher dedicado.

**RPC `claim_test_dispatch()`** (service_role): drena eventos `event LIKE 'test:%'`, cap de 3 tentativas (não vale backoff longo pra teste), retorna `target_webhook` extraído do payload.

**EF `dispatch-single-event`** (nova):
- Service-role only; cron a cada 1 min via pg_net
- Pra cada test event, busca SÓ o webhook em `payload._test_target`
- Constrói payload com marcação clara "TESTE" (header label, emoji ⚠️, bloco `is_test:true` no generic, sections Slack/Teams com aviso)
- NÃO interpola `payload_template` mesmo se o webhook tiver um — admin pode estar testando exatamente o caso "template inválido"
- POSTa com HMAC se o webhook tiver `signing_secret`; ack/nack normal

UI na `/admin/webhooks-fila`:
- Linhas em status `processed` ou `dead` ganham botão Send (✉️) "Re-enviar pra webhook específico"
- Modal abre com select dos webhooks ativos; mostra "✓ subscrito" ou "⚠ não subscrito" pro evento
- Warning amber quando admin escolhe webhook não-subscrito ("teste vai disparar mesmo assim, mas em produção esse webhook não receberia")

## 4. Dead-letter CSV export (migration 034 + UI)

**RPC `export_dead_letter_events()`** retorna tabela achatada do dead-letter do tenant atual:
`(enqueued_at, event, entity_type, entity_id, attempts, last_error, payload_json::text)`

Filtros: `tenant_id = current`, `processed_at IS NULL`, `attempts >= 5`, exclui `event LIKE 'test:%'`.

Helper TS `deadLetterRowsToCsv(rows)` faz quoting RFC 4180 (vírgula/aspas/newline) — sem dep de papaparse pra um CSV trivial.

Botão "Exportar dead-letter" só aparece quando `stats.dead_letter > 0` (zero state evita botão deadweight). Click dispara download cliente-side de `webhook-dead-letter-YYYY-MM-DD.csv` com BOM UTF-8 (Excel-friendly).

## Build status

```
check-source  ✓ Nenhuma violação
typecheck     ✓ 0 erros
vite build    ✓ 1752 módulos · 12.73s
```

**Bundle health**:
- **Main initial:** 74.39 KB gzip (V27: 74.15 → +0.24 KB)
- **Webhooks chunk:** 9.04 KB gzip (V27: 8.34 → +0.70 KB pra auto-rotate + entity search)
- **WebhookQueue chunk:** 4.74 KB gzip (V27: 3.40 → +1.34 KB pra test picker + CSV export)
- Margem até alvo de 150 KB: **75.6 KB**

## Diff V27 → V28

- **+1 migration** (034 webhook_operability ~660L incluindo upsert reescrito e view atualizada)
- **+1 EF** (`dispatch-single-event` ~280L)
- **api.ts**: `auto_rotate_after_days` em `TenantWebhook`/`TenantWebhookInput`; novos wrappers `searchEntitiesForWebhook`, `enqueueWebhookTest`, `exportDeadLetterEvents`, helper `deadLetterRowsToCsv`; `WebhookEntity`, `DeadLetterCsvRow` types
- **`upsertTenantWebhook`** passa novo param `p_auto_rotate_after_days`
- **WebhookPayloadPreview**: entity search picker
- **Webhooks.tsx**: Select "Rotação automática" no modal de webhook
- **WebhookQueue.tsx**: botão Send pra re-envio isolado + modal target picker + botão Download dead-letter CSV

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only            # 034
supabase functions deploy dispatch-single-event      # nova EF
```

Pré-requisitos pro cron de auto-rotate + test dispatcher:
- Supabase Pro (pg_cron + pg_net)
- Settings já configurados na V26 (`app.settings.supabase_url`, `app.settings.service_role_key`)

Sem cron, ambos funcionam — admin chama manualmente via SQL ou via UI direta (auto-rotate só não acontece automaticamente).

## Como testar

### Auto-rotate
1. Webhook com signing_secret → editar → Rotação automática = "30 dias"
2. Forçar via SQL: `UPDATE tenant_webhooks SET secret_rotated_at = now() - interval '31 days' WHERE id = '<id>'`
3. `SELECT * FROM auto_rotate_due_webhooks()` → retorna a linha
4. Em `/notifications`, admin recebe notification `kind=system` com novo secret no body
5. Webhook agora tem `secret_rotated_at = now()` (próxima rotação em 30 dias)

### Real-entity preview
1. `/admin/webhooks` → novo webhook → kind=generic → eventos = ['measurement_emitted', 'risk_critico_changed']
2. Preview panel: clica chip "measurement_emitted" → JSON sintético
3. Campo "Usar entidade real" → digitar número de contrato → sugestões aparecem
4. Clica numa sugestão → preview atualiza com dados reais; `synthetic: false`
5. Trocar pra "risk_critico_changed" → entity reset; novo search agora busca contratos

### Test event isolado
1. Configurar 2 webhooks (A, B) ambos subscritos em `additive_approved`
2. A com URL válida; B com URL inválida (httpbin.org/status/500)
3. Aprovar um aditivo → A entrega ok, B vai pra dead-letter após 5 tentativas
4. Em `/admin/webhooks-fila`, no evento (processed do ponto de vista da fila — sucesso parcial conta), clicar Send
5. Modal: escolher B → "Enfileirar re-envio"
6. EF `dispatch-single-event` processa em até 1 min → B recebe payload com `_test=true`
7. A NÃO recebe duplicata

### CSV export
1. Forçar ≥1 evento em dead-letter (URL inválida + 5 tentativas)
2. `/admin/webhooks-fila` → "Exportar dead-letter" aparece no header (só quando `dead_letter > 0`)
3. Click → download de `webhook-dead-letter-YYYY-MM-DD.csv`
4. Abrir no Excel → 7 colunas; BOM UTF-8 garante acentos certos
5. Útil pra mandar pra DevOps investigar erros agregados offline
