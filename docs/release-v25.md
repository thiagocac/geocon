# V25 — Webhook security + payload customizável + polishing

Esta versão fecha 5 frentes herdadas da V24:

1. **HMAC signing** dos webhooks (`X-Consultegeo-Signature: sha256=…`)
2. **Payload customizável** para webhooks `kind=generic` com sandbox de validação
3. **Aliases hot-link** — `/admin/broadcast?alias=equipe-medicao` pré-popula roles
4. **Notification grouping com collapse** — header clicável + persistência localStorage
5. **pg_cron** wiring para risk snapshots batch (auto-detecta extensão; idempotente)

---

## 1. Webhook HMAC signing

**Backend** (migration 030):
- Coluna `signing_secret` opcional em `tenant_webhooks` (texto plano, similar a Stripe/GitHub webhooks)
- RPC `rotate_webhook_secret(p_id)` retorna `{secret, hint, rotated_at}` — write-once-read-once. Persistimos apenas a dica visual (`secret_hint = '…' || right(secret, 4)`)
- RPC `clear_webhook_secret(p_id)` remove e desativa assinatura
- View `v_tenant_webhooks` agora expõe `has_signing_secret` (boolean) e `secret_rotated_at` — nunca o segredo
- Audit log automático na rotação (não persiste o valor)

**EF `dispatch-broadcast-webhooks`**:
- Quando `signing_secret` está presente, computa HMAC-SHA256 sobre o `JSON.stringify(payload)` usando WebCrypto
- Envia 2 headers extras:
  - `X-Consultegeo-Signature: sha256=<hex>`
  - `X-Consultegeo-Timestamp: <ISO 8601>`
- Coluna `webhook_dispatch_log.signed` (boolean) registra se cada dispatch foi assinado
- Retorno do EF agora inclui `signed_count` + `results[i].signed`

**Frontend** (`/admin/webhooks`):
- Nova coluna "Assinatura" na tabela: badge verde "Assinado" + tooltip com last rotation; ou cinza "sem HMAC"
- Botão de chave (`KeyRound`) abre modal de rotação com:
  - Aviso de que o segredo anterior deixa de funcionar imediatamente (se já existia)
  - Snippet Node.js de verificação no destinatário
  - Botão "Remover assinatura" (`clearWebhookSecret`)
- Após confirmar, modal de revelação mostra o segredo num bloco `<code>` em fundo escuro, com botão de copy. Após fechar, não há mais como recuperar (write-once-read-once)
- Linha "Dica persistida: `…xyz9`" pra identificação visual posterior

**Verificação no consumidor (Node.js)**:
```javascript
const expected = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
const received = req.headers['x-consultegeo-signature'].replace('sha256=', '');
if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received)))
  throw new Error('Bad signature');
```

## 2. Payload customizável (kind=generic)

**Backend**:
- Coluna `payload_template text` em `tenant_webhooks` (NULL = usa payload padrão)
- Validação no `upsert_tenant_webhook`:
  - Só aceito para `kind='generic'`
  - Parseado como `jsonb` no SQL para garantir JSON válido antes de persistir
- EF reparse após substituição — se template + vars produzem JSON inválido, faz fallback pro payload genérico padrão (com warning no log)

**Vars disponíveis** (resolvidas server-side antes do POST):
`{{event}}`, `{{broadcast_id|title|body|kind|action|total|scope|created}}`, `{{tenant_id|name}}`, `{{sender_id|name}}`.

**Editor no modal de edição** (apenas para kind=generic):
- Textarea mono-spaced 8 rows com sintaxe JSON
- Botão "Inserir exemplo" carrega template default funcional
- Toggle "Variáveis disponíveis" mostra grid clicável (copia o token ao clicar)
- Validação client-side ao vivo:
  - 🟢 JSON válido + todas as vars conhecidas
  - 🟡 JSON válido + vars desconhecidas listadas (ficarão vazias)
  - 🔴 JSON inválido com mensagem do parser
- Submit é bloqueado se JSON está quebrado

**Coluna "Custom" badge** na tabela de webhooks identifica linhas com template customizado.

## 3. Aliases hot-link

`/admin/broadcast?alias=equipe-medicao,fiscalizacao` agora:
- Força `scope='role'` imediatamente
- Aguarda load do `roleAliases` query (auto-habilitada quando há `?alias=`)
- Resolve slugs para roles e adiciona ao chip-set (sem duplicar)
- Marca um flag `aliasResolved` pra rodar só 1× por mount

**Combinável**:
```
/admin/broadcast?alias=equipe-medicao&title=Encerramento&kind=warning&email_also=1
```
→ pré-popula roles via alias + título + tipo + email toggle, tudo num click.

## 4. Notification grouping collapse

`NotificationDropdown` agora:
- Header de cada kind virou `<button>` clicável com `aria-expanded`
- Click toggle visibilidade da lista de notifs do grupo
- Estado persistido em `localStorage` (key `geocon:bell:collapsed` = JSON array de kinds)
- `ChevronDown` / `ChevronRight` indicando estado
- O badge "N novas" continua visível mesmo com grupo recolhido (não esconde info crítica)

## 5. pg_cron risk snapshots

**Migration 031** (idempotente + safe):
- Cria função `cron_refresh_stale_risk_all_tenants(max_age_days, limit_per_tenant)` que:
  - Itera tenants distintos com contratos stale
  - Top-N por tenant ordenados por mais antigos primeiro
  - Captura snapshot com `source='cron'` para cada
  - Retorna `TABLE(tenant_id uuid, refreshed int, errors int)`
- Detecta `pg_extension` para `pg_cron`:
  - **Disponível** (Supabase Pro): faz `cron.unschedule('refresh_stale_risk_daily')` + `cron.schedule(...)` com `0 3 * * *` (03:00 UTC)
  - **Ausente**: RAISE NOTICE sem falhar — admin pode ativar via Dashboard depois
- RPC `test_cron_refresh_risk()` permite admin testar a função do cron manualmente (sem agendar de novo)

A função interna roda 100% server-side (sem invocar Edge Function via http extension), o que evita dependência de service_role key armazenada e simplifica o setup.

---

## Build status pós-V25

```
check-source  ✓ Nenhuma violação
typecheck     ✓ 0 erros
vite build    ✓ 1751 módulos · 9.65s
```

**Bundle health**:
- **Main initial:** 73.53 KB gzip (V24: 73.07 → V25: 73.53 — +0.46 KB)
- **Broadcast chunk:** 11.89 KB gzip (+0.15 KB pra hot-link)
- **Webhooks chunk:** 6.45 KB gzip (V24: 4.11 → +2.34 KB para HMAC UI + payload template editor)
- **Total raw:** ~870 KB across ~28 chunks (sem novos chunks; tudo cresceu in-place)
- Margem até alvo de 150 KB gzip: **76 KB** ainda confortável

---

## Diff V24 → V25

- **+2 migrations** (030 webhook_signing_and_templates ~280L · 031 cron_risk_snapshots ~150L)
- **EF `dispatch-broadcast-webhooks`** ganha 70 linhas (HMAC via WebCrypto + template interpolator + reparse safety)
- **`src/lib/api.ts`** ganha 35 linhas (4 wrappers: rotateWebhookSecret, clearWebhookSecret, testCronRefreshRisk + extensões a TenantWebhook/Input)
- **`Webhooks.tsx`** ganha 240 linhas (validateTemplate, payload editor, rotate/clear mutations, 2 novos modais)
- **`Broadcast.tsx`** ganha 25 linhas (alias hot-link resolver)
- **`NotificationDropdown.tsx`** ganha 50 linhas (collapse state + localStorage + ChevronDown/Right)

---

## Para deployar

```bash
# Backend (idempotente — pode rodar várias vezes)
./scripts/deploy-supabase.sh migrate-only       # roda 030 + 031
supabase functions deploy dispatch-broadcast-webhooks

# Habilitar pg_cron (uma vez, Supabase Pro):
# Dashboard > Database > Extensions > pg_cron > Enable
# Em seguida re-rode migration 031 pra ela detectar a extensão e agendar

# Frontend
npm install && npm run build && netlify drop dist/
```

Se o ambiente não é Supabase Pro (sem pg_cron), o agendamento via dashboard de **Scheduled Functions** chamando `refresh-risk-snapshots` continua funcionando exatamente como em V24.

---

## Como testar

### HMAC signing
1. `/admin/webhooks` → criar webhook genérico apontando para `https://webhook.site/<seu-id>`
2. Clicar ícone chave (KeyRound) → "Ativar assinatura"
3. Copiar segredo no modal de revelação (botão Copy)
4. Disparar broadcast — webhook.site mostra payload + headers `X-Consultegeo-Signature: sha256=…` e `X-Consultegeo-Timestamp: …`
5. Validar HMAC com snippet Node.js da migration doc
6. Tabela do admin/webhooks agora mostra badge verde "Assinado"
7. Histórico de dispatches: coluna `signed = true`

### Payload customizado
1. Editar webhook genérico → "Inserir exemplo" → veja template padrão preenchido
2. Adicionar `{{foo_bar}}` no template → ver banner amarelo "Variáveis desconhecidas"
3. Adicionar erro de sintaxe (vírgula extra) → ver banner vermelho "JSON inválido"
4. Corrigir → ver banner verde "JSON válido" → Salvar
5. Disparar broadcast → webhook.site recebe payload com a estrutura customizada

### Aliases hot-link
1. Criar alias "Equipe medição" em `/admin/alias-papeis` (slug auto = `equipe-medicao`)
2. Abrir `/admin/broadcast?alias=equipe-medicao` em nova aba
3. Scope já está em "Por papel"; chips dos roles do alias estão marcados; badge "aplicado" no alias

### Notification collapse
1. Bell → ver grupos com chevron ↓ ao lado do label
2. Clicar header de "Informativos" → grupo recolhe; badge "N novas" persiste
3. Recarregar página → estado mantido (localStorage)
4. Re-expandir clicando de novo

### pg_cron
1. (Supabase Pro com pg_cron habilitado) → rodar migration 031 → ver no log `Job "refresh_stale_risk_daily" agendado para 03:00 UTC`
2. Como admin, chamar RPC `test_cron_refresh_risk` via console → retorna `{tenants_processed, total_refreshed, total_errors, ran_at}`
3. Verificar `cron.job_run_details` na própria Supabase pra histórico das execuções automáticas
