# V48 — Download automático de índices IBGE

V48 fecha o ciclo de automação da família reajuste (V30-V33). Admins não precisam mais baixar manualmente IPCA do site do IBGE todo mês — a EF `download-economic-indices` puxa via API SIDRA, popula `adjustment_index_values` e dispara o uso em cálculos de reajuste automaticamente.

**Escopo da V48**:
- IBGE/SIDRA: **IPCA** (série 1737) e **IPCA-15** (série 7060) — API pública, gratuita, sem auth
- FGV (INCC, IGP-M): **não suportada** — FGV não tem API pública gratuita. Admins continuam usando CSV manual (V31) ou paid feeds. Estrutura preparada para evoluir quando disponível.

## Arquitetura

### Migration 055 (~210L)

**1 tabela** `adjustment_index_fetch_log` (audit):
- 1 linha por tentativa de fetch (par tenant × índice)
- `status` (`success` | `partial` | `failed` | `skipped`)
- `rows_inserted` / `rows_updated` / `rows_skipped`
- `error_message` quando falha
- `reference_month_from/to` (janela coberta)
- `metadata` jsonb (inclui `ibge_serie`, `months_back`)
- 2 indexes (tenant+codigo+fetched_at, status+fetched_at)
- RLS: SELECT autenticado vê só do próprio tenant + globais (tenant_id NULL); INSERT só via service_role

**4 RPCs**:

1. `upsert_index_value_external(tenant_id, codigo, month, value, source, published_at)` — variante V31 que aceita tenant_id explícito (sem JWT). Retorna `{action: 'inserted'|'updated'|'unchanged'|'skipped'}`
2. `list_tenants_with_ibge_indices()` — service_role only. Resolve series IBGE por código (default 1737/7060, override via `metadata.ibge_serie`)
3. `record_fetch_log_entry(...)` — service_role only. Insere audit entry
4. `list_fetch_log(limit)` — admin do tenant lê histórico (até 200 entries, default 50)

**pg_cron**: `0 11 15 * *` (dia 15 do mês, 11h UTC = 8h Brasília). IBGE publica IPCA tipicamente entre dia 10-12 do mês seguinte, então dia 15 dá folga sem ser tardio.

### Edge Function `download-economic-indices` (~270L Deno)

**Endpoint IBGE/SIDRA**:
```
https://apisidra.ibge.gov.br/values/t/{tabela}/p/{periodo}/v/{variavel}/n1/all
```

- IPCA: tabela 1737, variável 2266 (Número-índice, dez/93=100)
- IPCA-15: tabela 7060, variável 1119

Período no formato `YYYYMM-YYYYMM` (ex: `202401-202403` para Q1/2024). Calculado dinamicamente: até o mês fechado anterior, voltando `months_back` meses.

**Body opcional**:
```json
{
  "dry_run": false,
  "tenant_id": "...",   // limita a um tenant
  "codigo": "IPCA",     // limita a um índice
  "months_back": 3      // 1-24
}
```

**Fluxo**:
1. CORS
2. Resolve targets via `list_tenants_with_ibge_indices` (filtra por tenant_id e codigo se passados)
3. **Cache de dados IBGE por código** — 1 chamada à API serve N tenants (decisão O(1) vs O(N))
4. Para cada target: persiste cada mês via `upsert_index_value_external`
5. Determina status agregado: `success` se todos OK, `partial` se houve skips com sucessos, `failed` se zero sucessos
6. Grava 1 entrada em `adjustment_index_fetch_log` por target
7. Retorna sumário com results detalhados

**Tratamento de erros**:
- Timeout de 15s na chamada IBGE (AbortSignal)
- Linha com valor `'...'` ou `'-'` é ignorada silently (IBGE marca dados ausentes assim)
- Falha de fetch em um código não impede outros códigos
- Falha de upsert em uma linha não impede outras linhas do mesmo target

### Frontend: extensão da página existente

**Botão "Atualizar do IBGE"** no header da `/admin/indices-economicos` (sobreposto ao "Importar CSV" e "Registrar mensal").

**Modal "Atualizar índices do IBGE"**:
- Disclaimer azul explicando suporte IBGE-only
- Input "Meses para trás" (1-24, default 3)
- Botão "Baixar agora" com loading spinner
- Auto-filtra pelo índice atual se IPCA/IPCA-15 selecionado; senão atualiza todos os IBGE
- Após sucesso: cards por índice com badges de status + contagens (`Xn · Ym · Z= · Ws`) + período coberto + erro se houver

**Seção de log abaixo da tabela de valores**:
- Tabela com últimas 20 tentativas do tenant
- Colunas: Quando · Índice · Fonte · Status (badge) · Inseridos (verde) · Atualizados (azul) · Pulados (cinza) · Período
- Bloco vermelho com últimos 3 erros se houver
- Só renderiza se há entries (não polui a UI quando vazia)

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ 1769 módulos · ~10s
```

**Bundle**:
- Main: 83.13 → **83.26 KB gzip** (+0.13 KB)
- EconomicIndices (lazy): ~4.5 → **5.49 KB gzip** (+~1 KB pela seção V48)
- Margem até 150 KB: **66.7 KB**

## Diff V47 → V48

- **+1 migration** (055 economic_indices_auto · ~210L · 1 tabela audit + 4 RPCs + pg_cron mensal)
- **+1 Edge Function** (`download-economic-indices` · ~270L Deno · IBGE API + cache + batch upsert + audit log)
- **EconomicIndices.tsx**: +250L (state IBGE + mutation + 2 modais + tabela de log)
- **api.ts**: 2 wrappers + 3 interfaces + 1 enum de labels + 1 helper de tones

## Decisões arquiteturais

### Por que IBGE/SIDRA e não outras APIs?

IBGE/SIDRA é a **fonte oficial** dos índices IPCA/IPCA-15 (são índices do IBGE). É:
- Gratuita
- Pública (sem auth)
- Estável (existe há 20+ anos)
- Bem documentada (https://servicodados.ibge.gov.br/api/docs/)
- Sem rate limit prático para uso institucional

### Por que FGV não foi implementada?

FGV produz INCC e IGP-M mas:
- Não expõe API pública gratuita
- Disponibiliza dados via "FGV Dados" (assinatura paga)
- Site institucional tem PDFs mensais, mas scraping é frágil
- Alguns bancos publicam tabelas (Bradesco, Itaú) mas formato não-estável

Decisão: **não implementar FGV** no V48. Admins continuam usando CSV manual (V31). Quando disponível paid feed integrado, basta adicionar `case 'INCC':` no `fetchIbgeSeries` (renomear para `fetchSeries`) com a nova source.

A estrutura V48 já é genérica: campo `source` em `adjustment_index_values` aceita qualquer string, audit log idem.

### Por que cache de dados IBGE por código no escopo da request?

Cenário: 50 tenants têm IPCA configurado. Sem cache, 50 chamadas idênticas ao IBGE (waste). Com cache em `Map<codigo, IbgeRow[] | {error}>` dentro do handler:
- 1 chamada por código (no caso, no máx 2: IPCA + IPCA-15)
- Falha do fetch propaga corretamente como result de cada tenant (não silenciada)
- Custo de memória: ~24 meses × 2 índices × ~50 bytes = 2.4 KB no máximo

### Por que `upsert_index_value_external` separada de `upsert_index_value` (V31)?

Mesmo padrão de V46 (api keys) e V47 (alert digest):
- A V31 usa `current_member_id()` e `current_tenant_id()` (JWT-dependent)
- A EF roda como service_role sem JWT do usuário
- Variante explicita o tenant_id e a fonte (`'ibge-api'` vs `'manual'`)
- GRANT apenas para service_role (REVOKE FROM authenticated)

### Por que dia 15 e não dia 10 do mês?

IBGE publica o IPCA do mês anterior entre dia **10-12** do mês corrente (variação anual). Cron no dia 15 dá:
- 3-5 dias de folga para garantir que o dado está disponível
- Não tarde demais (admins usariam dado defasado)
- Não conflita com fechamento contábil típico do mês (dia 5)

### Por que `adjustment_index_fetch_log.tenant_id NULL` aparece em SELECT?

Permite registrar tentativas globais (ex: erro no fetch IBGE antes de iterar tenants). Audit não atrelado a tenant específico. Policy de SELECT é `tenant_id IS NULL OR tenant_id = current_tenant_id()` — admin de qualquer tenant vê erros globais (são "do sistema") + os do próprio tenant.

## Para deployar

```bash
# 1. Migration
./scripts/deploy-supabase.sh migrate-only   # 055

# 2. Edge function
supabase functions deploy download-economic-indices

# 3. Smoke test
curl -X POST https://<projeto>.supabase.co/functions/v1/download-economic-indices \
  -H "Authorization: Bearer <service_role_key>" \
  -d '{"dry_run":true,"months_back":1}'

# 4. Verificar cron
SELECT * FROM cron.job WHERE jobname = 'download-economic-indices-monthly';
```

## Como testar (acceptance)

### Smoke
1. `/admin/indices-economicos`
2. Selecionar IPCA
3. Click "Atualizar do IBGE"
4. Modal abre com disclaimer azul + input de meses (default 3)
5. Click "Baixar agora"
6. Spinner → resultado em cards com status verde/amarelo/vermelho

### IPCA-15
1. Selecionar IPCA-15 nos chips
2. Click "Atualizar do IBGE" → atualiza apenas IPCA-15
3. Tabela de valores recarrega com novos pontos

### Sem filtro de índice (índice não-IBGE selecionado)
1. Selecionar INCC ou IGP-M (FGV)
2. Click "Atualizar do IBGE"
3. Modal NÃO mostra filtro de índice atual; atualiza todos os IBGE configurados no tenant

### Tenant sem IBGE configurado
1. EF retorna `{dispatched: 0, message: 'Nenhum tenant com índices IBGE configurados encontrado'}`
2. UI mostra card amarelo com a mensagem

### Falha de rede IBGE
1. (Simular timeout)
2. Status: `failed`
3. Tabela de log mostra entrada vermelha com error_message

### Idempotência
1. Click "Atualizar" duas vezes seguidas
2. Primeira: rows_inserted=N
3. Segunda: rows_unchanged=N, rows_inserted=0 (mesmo valor não atualiza)

### Cron mensal
1. Esperar dia 15 às 11h UTC (ou ajustar para teste)
2. `SELECT * FROM cron.job_run_details WHERE jobname = 'download-economic-indices-monthly'`
3. Status deve ser `succeeded`
4. `SELECT * FROM adjustment_index_fetch_log ORDER BY fetched_at DESC LIMIT 10`
5. Entradas com source='ibge-api' aparecem

### Histórico exibido
1. Após pelo menos 1 fetch
2. Seção "Histórico de atualizações automáticas" aparece abaixo da tabela de valores
3. Mostra 20 entradas mais recentes ordenadas por fetched_at DESC

## Retrospectiva V30 → V48 (19 versões)

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
| V46 | API keys + REST público | 053 | 85.24 |
| V47 | Email digest de alertas | 054 | 83.13 ⬇ |
| **V48** | **Download IBGE** | **055** | **83.26** |

Bundle main **+8.13 KB gzip** em 19 versões. **0 typecheck errors** em todas.

**Família reajuste 100% automatizada**:
- V30: cálculo + índices manual
- V31: CSV bulk + cron de aplicação automática
- V32: bulk reajuste massa
- V33: repactuação
- **V48**: pull IBGE automático (fecha o ciclo)

## Próximas oportunidades (V49+)

4 itens restantes da lista V41:

6. ~~OKLCH migration~~ — declinada 17× desde V14
9. **Completar Pendencias V35-V38** (047 órfã + UI) ← próximo sugerido (trabalho mais focado)
10. Completar Carteira V12 com KPIs Lei 14.133 (050 órfã / release-v43-prior)

**Possíveis extensões V48**:
- Suporte FGV via paid feed quando disponível
- Re-fetch retroativo (force update mesmo se valor existe)
- Alertas se IBGE falha 2x seguidas (cria notification para admin)
- Endpoint `/admin/indices-fetch-log` próprio com filtros + export CSV
- Comparação valor IBGE vs CSV manual (detectar discrepâncias)

**V49 sugerido**: **Completar Pendencias V35-V38** (item 9). Trabalho focado — migration 047 já existe; só precisa atualizar a UI de `Pendencias.tsx` para reconhecer os 5 novos tipos (vicio_aberto, par_defesa, garantia_vencendo, sancao_multa_pendente, recebimento_definitivo_atrasado). Fechamento de débito.

Alternativa: **Completar Carteira V12** (item 10) — migration 050 já existe (release-v43-prior preservado); só precisa atualizar Portfolio.tsx para mostrar os 5 KPIs Lei 14.133 por programa/órgão/município. Trabalho médio.
