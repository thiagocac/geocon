# V27 — Eventos expandidos, dead-letter alerts e payload preview

V27 fecha o ciclo de qualidade dos webhooks: mais eventos, alertas pró-ativos quando algo trava, preview do JSON antes de salvar, e doc de replay protection acessível na UI.

## 1. 3 eventos novos (migration 033)

A vocação webhook agora cobre 7 eventos (V26: 4):

| Evento | Trigger | Quando dispara |
|---|---|---|
| `broadcast_sent` | `bulk_send_notification` RPC | Admin disparou comunicado (existente) |
| `risk_critico_changed` | `contract_risk_snapshots` | Snapshot vira crítico (existente) |
| `measurement_decided` | `measurements.status` | Status → aprovada/devolvida/paga (existente) |
| `additive_approved` | `additives.status` | Status → aprovado/incorporado (existente) |
| **`measurement_emitted`** | `measurements.status` | Status → emitida (novo) |
| **`unforeseen_pending`** | `unforeseen_items.status` | Entrou em análise técnica/preço/aprovação consórcio/órgão (novo) |
| **`digest_failed`** | `digest_sends INSERT` | `email_status='failed'` (novo) |

`measurement_emitted` é útil pra notificar áreas externas (financeiro, fiscalização) quando uma medição foi formalizada. `unforeseen_pending` ajuda comitês a tracker itens não previstos sem polling. `digest_failed` é observabilidade — alerta que algum destinatário não recebeu o resumo do dia.

EF `drain-webhook-queue` ganhou `eventTitle`, `eventBody`, `actionLink` e `tone` para os 3 novos eventos (cores: emissão índigo, não previsto âmbar, digest falho vermelho).

## 2. Dead-letter alerting

Quando webhooks falham 5x e vão pra dead-letter, o admin precisa saber sem ter que checar manualmente.

**View `v_webhook_dead_letter_alerts`** agrega por tenant: count, oldest_dead_at, sample_error, events_affected — filtrado pra eventos com `enqueued_at < now() - interval '1 hour'` (evita alertar transientes).

**RPC `alert_webhook_dead_letter()`** (service_role): itera tenants com dead-letter persistente; pra cada admin do tenant, verifica se já alertou nas últimas 24h via `notifications.metadata.dead_letter_alert='true'`; se não, cria notification `kind='system'` com action_url `/admin/webhooks-fila`.

**pg_cron a cada 1h** chama `alert_webhook_dead_letter()` automaticamente (idempotente — pula se pg_cron ausente).

Idempotência: 24h de cooldown entre alertas pro mesmo admin. Reset acontece naturalmente quando os eventos saem do dead-letter (admin clicou requeue + drain processou).

## 3. Payload preview no compositor

RPC `build_webhook_sample_payload(event, entity_id)` retorna o JSON cru que vai pra fila pra cada evento. Aceita entity_id opcional pra resolver dados reais (ex: ID de um contrato existente); sem ele, retorna payload sintético com flag `synthetic: true`.

Componente `<WebhookPayloadPreview>` no modal de webhook:
- Chips dos eventos selecionados (clica pra alternar)
- Caixa escura mono com JSON formatado
- Nota contextual: pra Slack/Teams, o payload final é o Block Kit / MessageCard derivado, não esse JSON cru
- Pra `generic` com `payload_template`, alerta que o template interpolará esses campos
- Botão refresh regenera o exemplo (útil quando entity_id muda)

Admin agora vê **exatamente** que estrutura de dados vai receber antes de configurar o destinatário. Reduz iterações trial-and-error.

Eventos agrupados visualmente no modal por 4 categorias:
- **Comunicação:** broadcast_sent
- **Risco:** risk_critico_changed
- **Contrato (operação):** measurement_emitted, measurement_decided, additive_approved, unforeseen_pending
- **Operação interna:** digest_failed

## 4. Replay protection na revealed-secret modal

Quando o admin rotaciona o secret, o modal de revelação agora tem `<details>` colapsável "Como verificar no destinatário" com:

- Documentação dos 2 headers: `X-Consultegeo-Signature` e `X-Consultegeo-Timestamp`
- Recomendação de janela de ±5 minutos
- Snippet Node.js completo com:
  - Validação de timestamp (`Math.abs(ageMs) > 5 * 60 * 1000`)
  - HMAC com `createHmac('sha256', ...)`
  - Comparação com `timingSafeEqual` (não `===`)

Substitui o que era doc externa: agora o admin tem o exemplo de validação no mesmo lugar onde o secret é exibido. Reduz fricção de adoção do HMAC.

## Build status

```
check-source  ✓ Nenhuma violação
typecheck     ✓ 0 erros
vite build    ✓ 1751 módulos · 12.10s
```

**Bundle health**:
- **Main initial:** 74.15 KB gzip (V26: 73.98 → +0.17 KB)
- **Webhooks chunk:** 8.34 KB gzip (V26: 6.73 → +1.61 KB pra preview + replay docs + 7-event UI)
- **WebhookQueue:** 3.40 KB gzip (sem alteração)
- Margem até alvo de 150 KB: **76 KB** ainda

## Diff V26 → V27

- **+1 migration** (033 webhook_events_expanded ~360L) — 3 triggers + dead-letter alert + sample payload RPC + cron
- **EF `drain-webhook-queue` extended** — 3 novos eventos em title/body/link/tone
- **api.ts**: `WebhookEvent` type 4 → 7 valores; `WEBHOOK_DOMAIN_EVENT_OPTIONS` ganha campo `group`; `buildWebhookSamplePayload` wrapper
- **Novo componente** (`WebhookPayloadPreview`)
- **Webhooks.tsx**: eventos agrupados em 4 categorias visuais + preview component plugado + replay protection `<details>` no modal de secret

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only      # 033
supabase functions deploy drain-webhook-queue  # com 3 novos eventos
npm install && npm run build && netlify drop dist/
```

Dead-letter alerts e payload preview são features puramente backend/UI — não precisam de configuração externa.

## Como testar

### measurement_emitted
1. Criar webhook genérico com event `measurement_emitted` apontando pra https://httpbin.org/post
2. Em qualquer contrato com SOV, criar medição rascunho + preencher
3. Submeter pra aprovação → quando status vira `emitida` (após approve workflow), trigger dispara
4. `/admin/webhooks-fila` → ver evento enfileirado, depois processado
5. Em https://httpbin.org/post, no painel do destinatário (se for um endpoint real), confirmar recebimento

### unforeseen_pending
1. Criar webhook com event `unforeseen_pending`
2. Em `/contratos/:id/itens-nao-previstos`, criar item em status `levantamento`
3. Mudar para `analise_tecnica` → trigger dispara
4. Mudar pra outro status pendente (`analise_preco` etc) → **não** dispara de novo (já tinha sido pending)

### digest_failed
1. Force um `digest_sends` com `email_status='failed'` (via SQL direto ou bug na EF de digest)
2. Trigger AFTER INSERT enfileira → drain processa → webhooks recebem

### Dead-letter alerting
1. Configurar webhook com URL inválida (ex: `https://httpbin.org/status/500`)
2. Forçar evento → drain falha → 5x backoff → vai pra dead-letter (~24h depois da 1ª tentativa em produção; pra teste local, rodar `update webhook_event_queue set attempts=5, next_attempt_at=now()`)
3. Aguardar próxima execução do cron de alerta (de hora em hora) OU `select * from public.alert_webhook_dead_letter();`
4. Como admin, abrir `/notifications` → ver notif system "Webhooks travados: N eventos em dead-letter"
5. Tentar de novo dentro de 24h → não duplica

### Payload preview
1. `/admin/webhooks` → novo webhook → marcar 3 eventos
2. Painel preview aparece logo abaixo → clica chip "risk_critico_changed" → ver JSON sintético
3. Trocar pra "measurement_emitted" → JSON muda
4. Mudar kind pra Slack → ver nota azul: "Slack recebe Block Kit derivado…"
5. Preencher `payload_template` válido em Generic → nota muda pra purple "Template customizado ativo…"

### Replay protection doc
1. Rotacionar secret de um webhook → modal abre com o segredo
2. Clicar `<details>` "Como verificar no destinatário" → expande snippet de código
3. Copiar snippet, colar em endpoint receptor → testar request com timestamp antigo (> 5 min) → deve retornar 401
