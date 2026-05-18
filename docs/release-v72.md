# V72 — Comparação composição vs concorrentes

V72 estende V66 para análise pós/pré-licitação: comparação direta entre preço próprio e cotações de concorrentes.

## O que entrega

**Migration 069**:
- Tabela `contract_item_competitor_prices` com `competitor_name`, `competitor_cnpj`, `preco_unitario`, `data_proposta`, `origem` CHECK (manual/licitacao_publica/sirhad/outro)
- View `v_contract_item_competitor_comparison` calcula `diff_abs` e `diff_pct` próprio vs concorrente
- RPC `list_contract_competitor_comparison(contract_id)` retorna SETOF view ordenado por codigo+competitor_name
- RLS habilitado

**API**:
- `CompetitorComparison` interface (12 campos)
- `listContractCompetitorComparison(contractId)`
- `upsertCompetitorPrice({contract_item_id, competitor_name, preco_unitario, ...})`
- Mock SKIP_AUTH com 3 cotações de 2 concorrentes (Alfa LTDA, Beta Engenharia)

**Página `/contratos/:id/comparacao-concorrentes`** (lazy chunk):
- 3 stat cards: "Mais barato que próprio" (red TrendingDown) · "Mais caro que próprio" (green TrendingUp) · "Diferença agregada" (Trophy soma das diffs)
- Filter chips por concorrente (Building2 icon + count)
- Tabela: Item · Concorrente (nome + CNPJ + data + origem badge) · Próprio · Concorrente · Diferença (% + R$)
- Export CSV reusa V71 (`downloadCsv` helper)
- Footer explicativo: verde = nosso preço acima (vantagem), vermelho = nosso preço abaixo

**Integração ContractSheet**: botão "Concorrentes" (Trophy icon, outline) ao lado de "Divergências".

## Decisões

- Tabela separada (não jsonb em contract_items) — permite query/index/RLS
- View server-side com diff calculation (consistência + filtros futuros)
- Convenção de sinal: positivo = concorrente mais caro (vantagem nossa); negativo = concorrente mais barato (perdemos competitividade)
- Origem como CHECK enum (4 valores) — cobre fontes reais (licitação pública, SIRHAD/SICRO base, manual, outro)
- Export reusa V71 helper (sem duplicação)

## Bundle V71 → V72

Main 108.37 → **108.81** (+0.44 KB). Comparação em lazy chunk. Margem **41.19 KB**.
