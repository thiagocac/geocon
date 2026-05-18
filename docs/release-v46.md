# V46 — API keys + REST público

V46 entrega o item #5 da lista V41: superfície externa para integração com sistemas terceiros (licitação, ERPs, controles externos). MVP foca em **2 endpoints iniciais** com infraestrutura preparada para crescimento (scopes, audit, expiração).

## Arquitetura

### Formato da chave

```
gck_live_<8-hex-prefix>_<32-hex-secret>
```

Total ~52 chars. Componentes:

- `gck` — namespace GeoCon (distinguível de outros provedores em código terceiro)
- `live` — ambiente (espaço pra `test` no futuro)
- prefix de 8 hex (32 bits) — indexado em PG para lookup O(1) sem precisar do secret
- secret de 32 hex (128 bits) — entropia forte; só o hash bcrypt fica no banco

### Migration 053 (~370L)

**1 tabela** `api_keys`:
- `id`, `tenant_id`, `name` (≤200 chars)
- `key_prefix` (8 chars, UNIQUE, index parcial WHERE revoked_at IS NULL)
- `key_hash` (bcrypt cost 10 via `pgcrypto.crypt(secret, gen_salt('bf', 10))`)
- `scopes text[]` (max 20)
- `created_by`/`revoked_by` (FK members), `created_at`, `last_used_at`, `expires_at`, `revoked_at`
- 3 CHECK constraints (length de name e prefix, max scopes)

**RLS dupla camada**:
- SELECT só para admins do tenant
- INSERT/UPDATE/DELETE bloqueado direto (`USING (false) WITH CHECK (false)`) — única forma de modificar é via RPC SECURITY DEFINER

**6 RPCs**:

1. `create_api_key(name, scopes[], expires_at?)` — gera prefix+secret server-side via `gen_random_bytes`, valida escopos contra whitelist, retorna jsonb com **`full_key` (única exibição)**
2. `list_api_keys()` — admin-only, computa `status` (ativa/revogada/expirada) e nomes resolvidos de created_by/revoked_by
3. `revoke_api_key(id)` — admin-only, seta `revoked_at`/`revoked_by`
4. `verify_api_key(prefix, secret)` — **service_role only**, constant-time via `crypt()`, retorna jsonb da chave ou NULL
5. `touch_api_key_last_used(id)` — fire-and-forget após uso bem-sucedido
6. Variantes **`_external`** das RPCs V45 (`check_cnpj_sanctioned_external`, `list_sanctioned_suppliers_external`) que aceitam `tenant_id` explícito em vez de `current_tenant_id()` — necessárias porque a EF roda com service_role sem JWT do usuário

### Edge Function `public-api` (~300L Deno)

Endpoint único `{SUPABASE_URL}/functions/v1/public-api/*` com roteamento interno.

**Fluxo de cada request**:
1. CORS preflight
2. Parse de path (`req.url` → remove `/public-api` prefix)
3. Rotas públicas (sem auth): `/health`, `/openapi`
4. Demais: parse de `Authorization: Bearer ...` → valida formato regex → chama `verify_api_key` via service_role
5. Verifica scope necessário do endpoint
6. Executa lógica (chama RPC `_external`)
7. `touch_api_key_last_used` fire-and-forget
8. Retorna JSON

**Códigos de erro padronizados**:
- 401: auth ausente, malformada, chave inválida/expirada/revogada
- 403: chave válida sem o scope necessário (mensagem citando o scope faltante)
- 404: rota desconhecida (com hint para `/openapi`)
- 405: método HTTP errado
- 422: body/params inválidos
- 500: erro interno

### Endpoints MVP

| Method | Path | Scope | Descrição |
|---|---|---|---|
| GET | `/health` | — | Liveness check |
| GET | `/openapi` | — | OpenAPI 3.0 spec dos endpoints |
| POST | `/suppliers/check` | `suppliers:check` | Verifica CNPJ — retorna `pode_contratar` |
| GET | `/suppliers/sanctioned` | `suppliers:read` | Lista sancionados (filtros via query: severidade, status, only_with_active, limit) |

**Request `/suppliers/check`**:
```json
{ "cnpj": "12.345.678/0001-90" }
```
Aceita CNPJ com ou sem pontuação. Normaliza pra 14 dígitos antes da consulta.

**Response**:
```json
{
  "ok": true,
  "cnpj": "12345678000190",
  "nome": "Fornecedor LTDA",
  "found": true,
  "pode_contratar": false,
  "severidade": "alta",
  "impedimento_ativo": 1,
  "motivo_bloqueio": "Impedimento de licitar/contratar ativo até 15/06/2027"
}
```

## Página `/admin/api-keys`

**Restrita a admin** (rota tem `roles={['admin']}` no `ProtectedRoute`).

**Listagem** ordenada com ativas primeiro, depois revogadas/expiradas:
- Avatar circular colorido por status (verde ativa, amarelo expirada, cinza revogada)
- Nome + Badge de status
- Prefix em destaque + secret mascarado com bolinhas: `gck_live_a1b2c3d4_••••••••...`
- Badges de scopes
- Meta: criada por X em DD/MM, último uso, expira em, revogada por Y em DD/MM
- Botão "Revogar" só em chaves ativas

**Modal "Nova chave"**:
- Input nome (≥1, ≤200)
- Checkboxes de scopes com descrição (`suppliers:check`, `suppliers:read`)
- Checkbox "Definir expiração" + date input (min = hoje)
- Submit valida ≥1 scope selecionado

**Modal pós-criação (one-time reveal)**:
- Banner vermelho destacando que é a única oportunidade
- Toggle "Revelar/Ocultar" para a chave completa
- Botão "Copiar" com feedback de "Copiado!"
- Detalhes: nome, scopes, expiração
- Exemplo cURL pronto para uso (com placeholder se ocultada)

**Modal de revogação** com confirmação dupla.

**Modal "Documentação"** com:
- Auth header
- Base URL
- Cards de cada endpoint (method + path + scope + description + request/response)
- Tabela de códigos de erro

**Card de boas práticas** fixo na página (fora dos modais):
- Uma chave por sistema (facilita revogação)
- Secret completo só uma vez
- Menor privilégio (escopos mínimos)
- Definir expiração
- Revogar em caso de comprometimento

## Navegação

- **Sidebar admin** → subgrupo "Integrações" → "Chaves de API" (KeyRound icon · admin only)
- **CommandPalette**: `adm-api-keys` no grupo "Administração"
- **Rota**: `/admin/api-keys`

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ 1768 módulos · 13.35s
```

**Bundle**:
- Main: 84.89 → **85.24 KB gzip** (+0.35 KB)
- ApiKeysAdmin (lazy novo): **5.14 KB gzip**
- Margem até 150 KB: **64.8 KB**

## Diff V45 → V46

- **+1 migration** (053 api_keys · ~370L · 1 tabela + 2 indexes + 2 RLS policies + 6 RPCs)
- **+1 Edge Function** (`public-api` · ~300L Deno · roteamento + auth + scopes + 4 endpoints)
- **+1 página admin** (`ApiKeysAdmin.tsx` ~500L · listagem + 4 modais)
- **+3 entradas de navegação** (Sidebar admin · CommandPalette · ADMIN_SUBGROUP_OF)
- **+1 rota** (`/admin/api-keys`)
- **api.ts**: 3 wrappers + 3 interfaces + 1 enum de scopes + 1 enum de labels + 2 helpers

## Decisões arquiteturais

### Por que prefix + bcrypt em vez de só bcrypt?

- **Lookup eficiente**: prefix indexado permite encontrar a chave em O(1). Sem isso, teria que fazer bcrypt comparison em todas as chaves do banco (impossível em escala)
- **Identificação visual**: usuário pode ver "que chave foi usada" mesmo sem ter o secret
- **Padrão de mercado**: Stripe, GitHub, OpenAI fazem assim

### Por que RPCs `_external` separadas em vez de só passar tenant_id como segundo parâmetro nas existentes?

- **Segurança por explicitude**: a RPC pública V45 usa `current_tenant_id()` — confiar em variável de sessão. Adicionar parâmetro tenant_id criaria caminho onde o frontend poderia passar tenant arbitrário se RLS falhasse
- **Princípio do menor privilégio**: `_external` é `REVOKE FROM authenticated; GRANT TO service_role` — só a EF chama
- **Auditoria clara**: separação fica óbvia no schema

### Por que verify_api_key retorna jsonb e não record?

- Mais fácil de manipular no Deno (sem tipos PG complexos)
- Permite adicionar campos futuros sem breaking change na assinatura
- Padrão consistente com outras RPCs do projeto (V41 `get_contract_dashboard`, V43 `get_tenant_dashboard`)

### Por que touch_api_key_last_used fire-and-forget?

- Não bloqueia a resposta ao cliente
- Falha de UPDATE é absorvida (auditoria não é crítica para servir o request)
- Em escala, evita gargalo de IO síncrono

### Por que scope `suppliers:check` separado de `suppliers:read`?

- **Granularidade**: sistema de licitação só precisa verificar CNPJ específico, não listar todos os sancionados
- **Defesa em profundidade**: chave que só verifica não expõe a base inteira se vazar
- Pode evoluir pra `suppliers:detail` (modal completo) com escopo próprio

## Para deployar

```bash
# 1. Aplicar migration 053
./scripts/deploy-supabase.sh migrate-only

# 2. Deploy da EF
supabase functions deploy public-api

# 3. Configurar SITE_URL na EF se diferente do default
supabase secrets set SITE_URL=https://contratos.consultegeo.org

# 4. Testar endpoint público
curl https://<projeto>.supabase.co/functions/v1/public-api/health
```

## Como testar (acceptance)

### Smoke — listagem
1. Como admin: `/admin/api-keys` (ou Sidebar → Administração → Integrações → "Chaves de API")
2. Lista vazia mostra empty state com KeyRound icon
3. Card de boas práticas aparece embaixo

### Criação
1. Click "Nova chave"
2. Nome: "Teste Comprasnet"; selecionar ambos scopes; sem expiração
3. Click "Gerar chave"
4. Modal de criação fecha; abre modal "Chave criada com sucesso"
5. Banner vermelho de aviso visível
6. Click "Revelar" mostra secret completo
7. Click "Copiar" copia para clipboard; mostra "Copiado!" por 2s
8. Exemplo cURL atualiza com a chave completa (ou mascarada)
9. Fechar → volta pra listagem com a chave nova aparecendo

### Endpoint /health (sem auth)
```bash
curl https://<projeto>.supabase.co/functions/v1/public-api/health
# {"ok":true,"status":"ok","timestamp":"...","api_version":"1.0.0"}
```

### Endpoint /suppliers/check
```bash
curl -X POST .../public-api/suppliers/check \
  -H "Authorization: Bearer gck_live_a1b2c3d4_..." \
  -H "Content-Type: application/json" \
  -d '{"cnpj":"12.345.678/0001-90"}'
# {"ok":true,"cnpj":"12345678000190","found":false,"pode_contratar":true,"severidade":"nenhuma"}
```

### Erros esperados
- Sem header Authorization → 401
- Bearer com formato inválido → 401
- Chave revogada → 401
- Chave com scope `suppliers:read` tentando POST /suppliers/check → 403 com mensagem
- CNPJ com menos de 14 dígitos → 422
- Body sem JSON válido → 422
- GET /suppliers/check (deveria ser POST) → 405
- /endpoint-inexistente → 404 com hint para /openapi

### Revogação
1. Click "Revogar" em chave ativa → modal de confirmação
2. Confirma → chave move pra "revogada", botão Revogar desaparece
3. Requisitar com a chave revogada → 401

### Audit
1. Fazer request bem-sucedido com a chave
2. Voltar pra `/admin/api-keys`
3. Refresh: `last_used_at` mostra timestamp recente

### Documentação
1. Click "Documentação"
2. Modal mostra: auth header, base URL, 4 endpoints com método/scope/description/request/response, códigos de erro
3. Pode ser usado como referência sem sair do app

## Retrospectiva V30 → V46 (17 versões)

| Versão | Tema | Mig | Bundle main |
|---|---|---|---:|
| V30-V38 | Lei 14.133 (9 institutos) | 036-044 | 75.13 → 80.03 |
| V39 | Timeline por contrato | 045 | 80.43 |
| V40 | Mobile audit | — | 80.47 |
| V41 | Dashboard por contrato | 046 | 80.94 |
| V42 | Timeline global tenant | 048 | 81.43 |
| V43 | Dashboard global tenant | 049 | 84.13 |
| V44 | Export Timeline PDF | 051 | 84.44 |
| V45 | Fornecedores sancionados | 052 | 84.89 |
| **V46** | **API keys + REST público** | **053** | **85.24** |

Bundle main **+10.11 KB gzip** em 17 versões. 0 typecheck errors. Primeiro release pós-V30 que **adiciona uma tabela nova** (saindo da fase puramente compositiva V39-V45) — necessário porque a infra de auth externa não pode ser apenas view.

## Próximas oportunidades (V47+)

Continuando a ordem V41:

1. ~~Timeline global do tenant~~ — V42 ✅
2. ~~Dashboard global do tenant~~ — V43 ✅
3. ~~Export de timeline em PDF~~ — V44 ✅
4. ~~Cadastro de fornecedores sancionados~~ — V45 ✅
5. ~~API keys + REST público~~ — V46 ✅
6. **OKLCH migration** — DS Tier 3 (oferecida 16 vezes desde V14)
7. EF download FGV/IBGE — automatiza CSV import V31
8. Email digest de alertas — usa RPC V41/V43 num cron mensal
9. Completar Pendencias V35-V38 (047 órfã)
10. Completar Carteira V12 com KPIs Lei 14.133 (050 órfã)

**Possíveis extensões para a API V46**:
- Rate limiting (table `api_key_calls` + sliding window)
- Audit detalhado de cada call (path, status, IP)
- Mais endpoints (`/contracts`, `/timeline`, `/dashboard`)
- Webhooks reversos (notificar terceiros quando algo muda)
- API tokens para auth via API key + scope read-write em vez de só read

**Recomendação V47**: **Email digest de alertas** (item 8) — usa RPCs V41/V43 num cron mensal/semanal pra emails personalizados de alerta por admin/gestor. Backend trabalho médio, valor imediato e visível para usuários não-técnicos.

Alternativa: V47 com **OKLCH migration** (item 6) — limpa débito técnico do DS, melhora consistência visual no dark mode. Trabalho mecânico, baixo risco.
