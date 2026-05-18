# V39 — Linha do tempo unificada

V39 colhe os frutos de 9 versões consecutivas (V30-V38) sem criar novas tabelas. Uma única **view SQL** consolida eventos de 10 tabelas-fonte num schema comum, e uma página enxuta de leitura mostra a história completa de cada contrato.

Esta é a primeira versão pós-V30 que **não introduz CRUD novo**. É puramente compositiva.

## Schema comum

| Coluna | Tipo | Descrição |
|---|---|---|
| event_kind | text | `additive · unforeseen · measurement · reajuste · repactuacao · reequilibrio · receipt · guarantee · par · sanction` |
| event_subtype | text | Subtipo dentro do módulo (ex: `aplicacao` em sanção, `instauracao` em PAR) |
| event_date | date | Data canônica (para filtros temporais) |
| event_at | timestamptz | Timestamp completo (para ordenação) |
| title | text | Texto principal (ex: "Aditivo #3 · valor") |
| subtitle | text | Linha auxiliar (ex: "Líquido: R$ 1.250.000") |
| severity | text | `info · warning · danger · success · neutral` |
| valor | numeric | Consolidação financeira (nullable) |
| ref_id | uuid | ID do registro original (navegação) |
| ref_link | text | Subpath para deep-link (ex: `/aditivos`) |
| actor_name | text | Quem causou (resolvido via members) |

## Fontes da view `v_contract_timeline` (UNION ALL de 10)

| # | Fonte | Origem | Como vira evento |
|---|---|---|---|
| 1 | `additives` | schema 001 | 1 evento por aditivo |
| 2 | `unforeseen_items` | schema 001 | 1 evento por item |
| 3 | `measurements` | schema 001 | 1 evento por medição |
| 4 | `contract_reajuste_events` | V30 | 1 evento por aplicação |
| 5 | `contract_repactuacao_events` | V33 | 1 evento por repactuação |
| 6 | `contract_reequilibrio_requests` | V34 | 1 evento por solicitação |
| 7 | `contract_receipts` | V35 | 1 evento por termo |
| 8 | `contract_guarantee_events` | V36 | múltiplos eventos por garantia (registro, extensão, liberação, execução) |
| 9 | `contract_par_steps` | V37 | múltiplos eventos por PAR (instauração, defesa, decisão, recurso, arquivamento) |
| 10 | `contract_sanction_events` | V38 | múltiplos eventos por sanção (aplicação, pagamento, suspensão, etc) |

Para módulos que tipicamente têm múltiplos eventos por entidade (Garantia, PAR, Sanção), a view consome a tabela de events/steps em vez da tabela principal, dando granularidade temporal correta.

## Mapeamento de severity

A severity é calculada por SQL CASE para cada fonte:

- **success** (verde): aprovado, aplicado, pago, cumprida, sanado, emitido, registro inicial
- **danger** (vermelho): execução de garantia, sanção grave aplicada, PAR procedente, item recusado
- **warning** (amarelo): com pendência, sanção média (multa), recurso aberto, decisão parcial
- **info** (azul): rascunho, em análise, neutro
- **neutral** (cinza): cancelado, liberado, revogado, arquivado

## RLS via tabelas-base

A view **não tem RLS explícita** — herda das tabelas-fonte. Cada SELECT na view dispara as políticas RLS de cada UNION individualmente. Como todas as tabelas-fonte já têm RLS por `tenant_id = current_tenant_id()`, a view fica automaticamente segura.

A função SECURITY DEFINER `list_contract_timeline` adiciona o filtro explícito por `tenant_id` por defesa em profundidade.

## RPCs (2)

```sql
list_contract_timeline(
  contract_id uuid,
  kinds       text[],       -- filtro whitelist por tipo
  from        date,         -- início do range
  to          date,         -- fim do range
  severity    text[],       -- filtro por severity
  limit       int           -- max 2000, default 500
)

get_contract_timeline_summary(contract_id)
  → { total, first_at, last_at, by_kind: {additive:N, par:M, ...} }
```

## UI `/contratos/:id/timeline`

**3 KPIs**: Total eventos · Período coberto (mês/ano início → mês/ano fim) · Módulos com atividade (X/10)

**Painel de filtros**:
- **Tipo** (chips clicáveis): 10 botões com ícone do módulo + label + contagem; botões com count=0 ficam desabilitados (não há eventos daquele tipo)
- **Severidade** (5 chips): info, warning, danger, success, neutral · cada um com bolinha colorida indicativa
- **Período**: 2 inputs de date (from → to)

Todos os filtros funcionam combinados (AND lógico). Botão "Limpar" reseta tudo.

**Timeline visual**:
- Agrupada por mês/ano (header com calendar icon + nome do mês + contagem)
- Linha vertical contínua à esquerda conectando os eventos
- Cada evento tem círculo colorido por severity à esquerda (com ícone do módulo) + card com título, badge de subtype, timestamp, subtitle, ator
- **Click navega** para a página do módulo (ex: click em "Aditivo #3" → `/contratos/:id/aditivos`)
- Hover transition (borda magenta + chevron animado)

**Limite**: 1000 eventos por carregamento. Se atingir, mensagem "refine os filtros" aparece embaixo.

## Card no ContractDetail

Adicionado como **primeiro card** (acima de Planilha SOV) com label "Linha do tempo" e ícone `Activity`, subtitle "Eventos cronológicos · 9 institutos". É o atalho executivo para visão consolidada.

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ módulos OK · 9.59s
```

**Bundle**:
- Main: 80.03 → **80.43 KB gzip** (+0.40 KB)
- ContractTimeline (lazy novo): **2.86 KB gzip** — apenas leitura, sem modais
- Margem até 150 KB: **69.6 KB**

## Diff V38 → V39

- **+1 migration** (045 contract_timeline ~450L · 1 view com 10 UNION ALL · 2 RPCs)
- **+1 página** (ContractTimeline · 280L · 3 KPIs + 3 filtros + lista agrupada)
- **+1 card no ContractDetail** (primeiro da lista, destaque executivo)
- **+1 rota** (`/contratos/:id/timeline`)
- **api.ts**: 2 wrappers + 2 types + 1 enum + 1 helper de tone
- **0 tabelas novas, 0 CHECKs, 0 cron jobs** — primeira versão pós-V30 puramente compositiva

## Decisões arquiteturais

### Por que view + UNION ALL em vez de tabela materializada?

- Eventos não vêm em volume alto o suficiente para justificar materialização (tipicamente <100 eventos por contrato)
- Materialização exigiria triggers em 10 tabelas-fonte (complexidade alta, fragilidade)
- View é sempre consistente — sem lag de sincronização
- Custo de query é dominado pelo filtro `contract_id` (todos os indexes existentes ajudam)
- Postgres com `query_planner` consegue combinar índices em UNION ALL eficientemente

### Por que `severity` como string textual e não enum?

- Adicionar novos níveis no futuro sem migration breaking
- Frontend trata como union type, garantindo type safety
- Permite valores específicos por módulo se necessário sem afetar o schema

### Por que limit 1000 client-side e não paginação real?

- Caso de uso é "ver o histórico", não "navegar mil páginas"
- 1000 eventos = ~10 anos de contrato denso. Acima disso, filtros são mais úteis que paginação
- Simplifica drasticamente a UI

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only   # 045
```

Sem EFs, sem cron, sem deps externas. Migration é puramente DDL.

## Como testar (acceptance)

### Visão básica
1. `/contratos/:id/timeline`
2. KPIs mostram contagem total, período min-max, módulos com atividade
3. Filtros mostram contagem por tipo (botões com 0 desabilitados)
4. Lista agrupada por mês em ordem decrescente
5. Hover em qualquer evento → cursor pointer + borda magenta
6. Click → navega para subpath do módulo

### Filtros combinados
1. Selecionar tipo "Sanção" + tipo "PAR"
2. Severity = "danger"
3. From/To = janeiro a dezembro 2025
4. Lista mostra apenas eventos com aqueles critérios
5. "Limpar" volta ao estado inicial

### Edge cases
1. Contrato sem nenhum evento → empty state "Nenhum evento registrado neste contrato"
2. Filtros sem resultado → empty state "Nenhum evento com os filtros aplicados"
3. Mais de 1000 eventos → mensagem "Mostrando os 1000 mais recentes"

### Performance
1. Contrato com ~500 eventos: tela carrega em <500ms
2. Filtros recalculam <100ms (recompute do query React Query + memo)
3. Scroll suave sem layout jank

## Próximas oportunidades (V40+)

A timeline desbloqueia visões de produto novas. Sugeridas em ordem de valor:

**Visões consolidadas**:
1. **Dashboard agregado por contrato** — visão executiva com mini-timeline + ações pendentes em cada eixo (vícios abertos, garantias vencendo, PARs em curso, multas pendentes)
2. **Timeline global do tenant** — todos os contratos numa única feed, útil pra gerência sênior monitorar movimentos no portfólio
3. **Export de timeline em PDF** — para arquivo legal completo de um contrato (com paginação, capa, índice)

**Mobile audit** (debt desde V32, 9 páginas pendentes):
4. **Mobile audit V30-V39** — 10 páginas novas inclusive timeline

**Infraestrutura adjacente**:
5. **API keys + REST público** — superfície de entrada
6. **OKLCH migration** — DS Tier 3 (oferecida 16 vezes desde V14)
7. **EF download FGV/IBGE** — automatiza V31 CSV import
