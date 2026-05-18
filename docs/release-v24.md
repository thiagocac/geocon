# V24 — Maturidade da comunicação + risk batch

Esta versão fecha 5 loops abertos desde V21:

1. **Preview pane no compositor de broadcast** — vars interpoladas em tempo real
2. **Notification grouping no Bell** — mesmo padrão da `/notifications`
3. **Role aliases** — conjuntos nomeados de papéis ("Equipe medição")
4. **Webhooks outgoing** — Slack / MS Teams / payload genérico
5. **EF agendada `refresh-risk-snapshots`** — batch manual + ready pra cron

---

## 1. Preview pane (compositor de broadcast)

`/admin/broadcast` agora tem uma coluna direita renderizando como a notificação vai aparecer.

**Vars globais resolvidas client-side** (espelha `interpolate_broadcast_text` SQL):
`{{tenant_name}}`, `{{sender_name}}`, `{{sender_first}}`, `{{contract_numero}}`, `{{contract_objeto}}`, `{{today}}`, `{{today_long}}`.

**Vars per-user** (`{{user_name}}`, `{{user_first}}`, `{{user_email}}`) ficam marcadas com badge amber + nome de exemplo. Se `email_also` está desligado e há per-user vars, a UI alerta que aparecerão literalmente em-app.

**Vars desconhecidas** ficam vermelhas com aviso explícito.

Helper isolado em `src/lib/interpolate.ts` — testável separadamente.

## 2. Bell grouping

`NotificationDropdown` agora agrupa não-lidas por `kind` com:
- Header tonal compacto + ícone por categoria (system/warning/info)
- Pill magenta "N novas" por grupo
- Badge purple "Broadcast" inline em itens vindos de broadcast
- Cap de 8 itens no dropdown; mais que isso mostra "+X outras não lidas"
- Ordenação: system → warning → info → resto

## 3. Role aliases

**Backend** (migration 028):
- Tabela `role_aliases` com `slug` auto-gerado (helper `slugify_pt` com translit pt-BR)
- View `v_role_aliases_with_counts` com count de membros vivo
- RPCs `list_role_aliases`, `upsert_role_alias`, `delete_role_alias`
- RLS: admin-only para escrita; leitura por tenant

**Frontend** (`/admin/alias-papeis`):
- AdminListPage com search + tabela + modal CRUD
- Cada alias mostra count de membros alcançáveis em tempo real

**Integração no Broadcast composer**:
- Quando `scope='role'`, aparece sessão "Aliases de papéis" acima dos chips individuais
- Clicar num alias adiciona/remove todos os roles dele no chip-set normal
- Estado do alias é derivado (aplicado = todos os roles dele estão marcados)

## 4. Webhooks outgoing

**Backend** (migration 029):
- Tabela `tenant_webhooks` (id, label, kind, url, secret_hint, events[], active, last_status, last_response_code)
- Tabela `webhook_dispatch_log` (auditoria de cada disparo)
- View `v_tenant_webhooks` com count agregado de dispatches/erros
- RPCs CRUD + `record_webhook_dispatch` (chamada pela EF) + `list_webhook_dispatches` (UI)
- RLS: admin-only

**Edge Function `dispatch-broadcast-webhooks`**:
- Modo real (POST `broadcast_id`): chama `list_webhooks_for_event` para descobrir webhooks ativos no evento `broadcast_sent` do tenant, então faz POST a cada um com payload específico:
  - **Slack**: Block Kit (header + section + context + actions)
  - **Teams**: MessageCard com theme color baseado em kind, facts e potentialAction
  - **Generic**: JSON estruturado com event/tenant/sender/broadcast
- Modo teste (POST `test_webhook_id`): envia payload sintético sem persistir broadcast
- Cada envio é logado via `record_webhook_dispatch` com status, response_code e error_text
- Timeout 10s por endpoint; best-effort (falha de um não afeta outros)

**Frontend** (`/admin/webhooks`):
- AdminListPage com tabela mostrando label, URL mascarada (preserva host, encurta path), eventos, status, contagem de erros
- Botão "Testar" (ícone Send) dispara payload sintético via EF
- Modal CRUD com 3 tipos (slack/teams/generic) e hint contextual da URL esperada
- Histórico de disparos com último 50

**Auto-invocação no broadcast**:
- Após `bulkSendNotification` retornar com `total_sent > 0`, o compositor invoca `dispatchBroadcastWebhooks(broadcast_id)` silenciosamente
- Resultado (`dispatched`, `ok_count`, `error_count`) aparece no modal de sucesso
- Erros não bloqueiam o resultado in-app (webhooks são best-effort)

## 5. Risk snapshots batch

**Backend** (migration 029 também):
- View `v_contracts_stale_risk` que classifica contratos em `never` / `critical` (>30d) / `stale` (>14d) / `fresh`
- RPC `contracts_needing_risk_refresh(p_max_age_days, p_limit)` filtrada por tenant ativo

**Edge Function `refresh-risk-snapshots`**:
- 3 modos:
  - **Manual** (user JWT, body opcional): usa `current_tenant_id` via RPC, chama `capture_risk_snapshot` com source `manual`
  - **Service** (service_role + `tenant_id`): força tenant específico (admin tooling)
  - **All tenants** (service_role + `all_tenants: true`): varre `v_contracts_stale_risk` globalmente, source `cron`
- Retorna `{ total, refreshed: [{contract_id, score, nivel}], errors }`

**Frontend** (`/admin/risco-batch`):
- 4 KPIs: total pendente / nunca capturado / críticos / stale
- Controles: idade mínima (7/14/30/60 dias) + limite (10/25/50/100)
- Botão "Atualizar N agora" com modal de confirmação
- Tabela de contratos pendentes com badge de freshness + link para análise
- Modal de resultado com scores atualizados + erros
- Doc inline pra setup de cron via Supabase Scheduled Functions

**Para agendamento automático** (Supabase dashboard):
```bash
# Recomendado: 03:00 UTC (00:00 America/Sao_Paulo)
curl -X POST "$SUPABASE_URL/functions/v1/refresh-risk-snapshots" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"all_tenants": true, "max_age_days": 14, "max_contracts": 200}'
```

---

## Build status pós-V24

```
check-source  ✓ Nenhuma violação
typecheck     ✓ 0 erros
vite build    ✓ 1749 módulos · 11.29s
```

**Bundle health**:
- **Main initial:** `index-BnhZBh-D.js` 73.07 KB gzip (V22: 71.89 → V24: 73.07 — +1.18 KB)
- **Broadcast chunk:** 11.74 KB gzip (era 9 KB; preview pane + aliases UI adicionados)
- **Novos chunks (lazy):**
  - RoleAliases · 2.71 KB gzip
  - Webhooks · 4.11 KB gzip
  - RiskBatch · 3.31 KB gzip
- **Total raw:** ~870 KB across 28 chunks
- Margem até alvo: **77 KB gzip** (alvo 150 KB para main initial)

---

## Diff V23 → V24

- **+2 migrations** (028 role_aliases ~210L · 029 webhooks_and_scheduled_risk ~330L)
- **+2 EFs** (`dispatch-broadcast-webhooks` ~270L · `refresh-risk-snapshots` ~150L)
- **+3 admin pages** (`RoleAliases.tsx` · `Webhooks.tsx` · `RiskBatch.tsx`)
- **+2 componentes/helpers** (`BroadcastRenderedPreview.tsx` · `lib/interpolate.ts`)
- **3 rotas** novas em `App.tsx` (lazy)
- **3 entradas** no `Sidebar.tsx` admin nav
- **Broadcast.tsx editado**: useAuth, role aliases tab, preview pane, webhook auto-dispatch, webhook stats no result modal
- **NotificationDropdown.tsx reescrito**: grouping por kind, badges, broadcast pill

---

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only       # roda migrations 028 + 029
supabase functions deploy dispatch-broadcast-webhooks
supabase functions deploy refresh-risk-snapshots
npm install && npm run build && netlify drop dist/
```

Agendamento de cron (opcional, mas recomendado): configure Supabase Scheduled Function chamando `refresh-risk-snapshots` com body `{"all_tenants": true, "max_age_days": 14}` diariamente às 03:00 UTC.

---

## Como testar

### Preview pane
1. `/admin/broadcast` → digite "Olá {{user_first}}, encerramento de medição do {{contract_numero}} em {{today_long}}"
2. Coluna direita renderiza em tempo real:
   - `{{contract_numero}}` aparece literal se `scope ≠ 'contract'`
   - Escolha um contrato → vê o número substituído
   - `{{user_first}}` aparece como badge amber "Maria" (exemplo)
3. Toggle `email_also` ON → preview do e-mail aparece embaixo com vars amber preservadas
4. Escreva `{{foo_bar}}` → ver badge vermelho "Variável desconhecida"

### Bell grouping
1. Topbar → ícone sino
2. Se há ≥2 notificações de kinds diferentes → ver headers tonais ("Informativos · 5 novas")
3. Notificações de broadcast → badge purple inline "Broadcast"
4. Se há >8 não-lidas → "+N outras não lidas" no footer

### Role aliases
1. `/admin/alias-papeis` → "Novo alias" → nome "Equipe medição" + roles [fiscal_contrato, fiscal_campo, gestor_contrato]
2. Salvar → linha aparece com count de membros
3. `/admin/broadcast` → "Por papel" → ver sessão "Aliases de papéis" → clicar "Equipe medição"
4. Roles individuais ficam marcados automaticamente; clicar de novo desmarca todos

### Webhooks
1. `/admin/webhooks` → "Novo webhook" → tipo Slack, label "Slack #ops", URL `https://hooks.slack.com/services/...`
2. Salvar → linha aparece com status "Nunca disparado"
3. Clicar ícone Send (avião) → modal mostra resultado HTTP do POST de teste
4. `/admin/broadcast` → enviar qualquer broadcast → no modal de sucesso, sessão "Webhooks externos" com count de disparos

### Risk batch
1. `/admin/risco-batch` → ver KPIs (nunca capturado / críticos / stale)
2. Ajustar idade mínima para 30 dias → tabela atualiza
3. "Atualizar N agora" → modal de confirmação → "Atualizar agora"
4. Modal de resultado mostra scores + nível atualizados; erros aparecem destacados em vermelho
