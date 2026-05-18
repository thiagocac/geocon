# V55 — Curva ABC de itens (SOV)

V55 abre a área **SOV** (Schedule of Values / Planilha contratual) com a primeira
análise quantitativa: curva ABC. Permite ao gestor identificar onde concentrar
controle (Pareto: ~20% items = ~80% valor).

## Contexto

A área SOV até então tinha:
- Versionamento (`sov_versions`)
- Hierarquia 5 níveis (`contract_items` com parent_id, is_title, is_extra)
- Bulk operations (V23: lock, unlock, set_discipline, adjust_prices, soft_delete)
- Comparação entre versões (V13)
- Referências de preço SINAPI/SICRO (`contract_item_price_references`)

**Faltava análise**: olhar 200 itens e identificar quais 30 controlam 80% do
valor — esse é o trabalho típico de auditoria/fiscalização. Curva ABC formaliza
essa visão.

## O que V55 entrega

### 1. Migration 058 — `v_contract_items_abc` + RPC agregador

**View `v_contract_items_abc`** classifica items de uma planilha vigente por
percentual acumulado de valor, ordenando descendente:

| Campo | Tipo | Significado |
|---|---|---|
| `valor_total` | numeric(18,2) | `(qtd_contratada + qtd_aditada) × preco_unitario` |
| `valor_contrato_total` | numeric(18,2) | soma de valor_total no contrato |
| `pct_individual` | numeric(8,4) | `valor_total / valor_contrato_total × 100` |
| `pct_acumulado` | numeric(8,4) | window function `SUM OVER ORDER BY valor_total DESC ROWS UNBOUNDED PRECEDING` |
| `rank` | int | `ROW_NUMBER` ordenado por valor desc |
| `classe` | text | A (≤80%) · B (80-95%) · C (95-100%) |

**Filtros aplicados** (na própria view):
- `is_title = false` — exclui linhas de cabeçalho
- `active = true` — exclui inativos
- `deleted_at IS NULL` — soft-delete
- `sov_versions.status = 'vigente'` — só a versão atual

**RPC `get_contract_abc_summary(p_contract_id uuid) RETURNS jsonb`** agrega por
classe retornando `{ valor_contrato_total, items_total, A: {items_count, pct_items,
valor_total, pct_valor}, B: {...}, C: {...} }`. SECURITY DEFINER + STABLE +
GRANT EXECUTE TO authenticated.

### 2. API + types (`src/lib/api.ts`)

```ts
export type AbcClasse = 'A' | 'B' | 'C';

export interface ContractItemAbc { ... }
export interface AbcClasseStats { items_count, valor_total, pct_items, pct_valor }
export interface ContractAbcSummary { valor_contrato_total, items_total, A, B, C }

export async function listContractItemsAbc(contractId): Promise<ContractItemAbc[]>;
export async function getContractAbcSummary(contractId): Promise<ContractAbcSummary>;

export const ABC_CLASSE_LABELS:      Record<AbcClasse, string>;
export const ABC_CLASSE_DESCRIPTION: Record<AbcClasse, string>;
```

**Mock SKIP_AUTH** deriva ABC de `MOCK_ITEMS[contractId]` via função pura
`deriveAbcFromMockItems` — não duplica dados, recalcula no momento da chamada.
Mantém consistência mesmo se MOCK_ITEMS for editado.

Para `c1` (5 items mockados), classificação resultante:
- A: i1-3 Alvenaria (170k · 33.5%) + i1-2 Concreto (162k · 31.9%) = 2 items (40%) com 65.4% do valor
- B: i1-4 Revestimento (125k · 24.7%) = 1 item (20%) com 24.7%
- C: i1-5 Quadro + i1-1 Demolição = 2 items (40%) com 9.9%

### 3. Componente `<AbcSummaryPanel />` + `<AbcBadge />`

Novo arquivo `src/components/sov/AbcPanel.tsx`:

**`<AbcSummaryPanel summary={summary} />`**:
- Header com título + texto descritivo dinâmico ("2 items (40%) controlam 65.4% do valor")
- Heuristic Pareto check: se `summary.A.items_count > top20Count`, mostra
  "Cauda concentrada — N items necessários para 80%" (sinaliza distribuição
  fora do padrão)
- **Pareto inline bar** — 3 segmentos coloridos (success/yellow/slate) com largura
  proporcional ao `pct_valor` de cada classe, com labels A/B/C visíveis quando
  segmento ≥ 8%
- Expansível: 3 cards detalhados (items_count, pct_items, valor_total, pct_valor)

**`<AbcBadge classe="A" />`**:
- Pequeno badge circular 20x20 com letra A/B/C
- Cores: A=success (verde), B=yellow, C=slate
- Reutilizável fora do `ContractSheet`

### 4. Integração no `ContractSheet.tsx`

- **Botão "Análise ABC"** no header (toggle) — `variant='secondary'` quando ativo
- Queries condicionais (`enabled: abcMode`) — não fetcha ABC se modo desligado
- Quando ativo:
  - Renderiza `<AbcSummaryPanel />` acima da tabela
  - Items ordenados por `rank` (valor descendente)
  - 3 colunas novas na tabela: **ABC** (badge), **Valor total**, **% acum.**

## Decisões

1. **View vs RPC** — `v_contract_items_abc` é VIEW (consultável com WHERE,
   ORDER BY, LIMIT no cliente). RPC `get_contract_abc_summary` é só para o
   agregado (mais barato que rodar agregação no cliente). Padrão V42-V43.

2. **`is_title = false` na view** — itens de cabeçalho (`is_title = true`)
   somam valor zero típicamente, mas se houvesse confusão poderiam inflar a
   contagem. Filtro elimina ruído.

3. **`pct_individual` e `pct_acumulado` como numeric(8,4)** — 4 decimais cobre
   contratos com até 10.000 itens (0.0001% por item) sem perda. Render no
   frontend usa `.toFixed(1)` para limpar zeros sobrantes.

4. **Window function `ORDER BY valor_total DESC, codigo ASC`** — tiebreaker
   por código garante ordem determinística mesmo com items de mesmo valor.

5. **Mock derivado, não estático** — `deriveAbcFromMockItems(contractId)` recalcula
   a cada chamada usando `MOCK_ITEMS[contractId]`. Trade-off: O(n log n) por
   chamada vs duplicação. Como demo tem ≤5 items por contrato, custo trivial.

6. **Toggle "Análise ABC"** vs view permanente — mantém a tabela default
   simples para uso operacional (medição, edição); ABC é análise
   eventual/auditoria. Toggle preserva clareza.

7. **Mode toggle não persiste** — recarregar página volta ao modo normal.
   Considerei `localStorage` mas decidi que ABC é "ferramenta de análise
   pontual" — sticky pode confundir.

8. **Sem chart Pareto formal** — barra inline é suficiente para "vista de
   olhos". Pareto chart formal (Recharts) custaria +20 KB no bundle para
   uma feature análise. V56 pode adicionar se houver demanda.

9. **Heuristic check no header** — quando classe A precisa de mais que 20%
   dos itens, sinaliza explicitamente "cauda concentrada". Útil para
   auditoria: contrato com 60% items em classe A indica fragmentação anormal
   (possíveis duplicatas ou itens muito similares).

## Bundle V54 → V55

| Chunk | V54 | V55 | Δ |
|---|---:|---:|---:|
| Main | 92.69 | **94.63** | +1.94 |

Margem 150 − 94.63 = **55.37 KB**. Custo cobre `<AbcPanel />` (~150 linhas TSX) +
API helpers (~110 linhas) + integração no `ContractSheet` (~80 linhas
adicionais).

## Próximas oportunidades (V56+)

Mantendo foco Medição/SOV/GED:

1. **Validade temporal em GED** (~200 linhas) — ARTs, licenças, ASOs com
   `data_validade` + cron diário (reusa V53 stack) inserindo `realtime_alerts`.
   **Alto valor compliance.**

2. **Bloqueio backend do submit** (~30 linhas) — guard SQL em `submit_measurement`
   complementando o frontend block da V54. Fecha gap de segurança.

3. **Auditoria de divergência preços SINAPI/SICRO** (~200 linhas) — UI dedicada
   listando items com `divergencia_percentual > 5%` em `contract_item_price_references`.
   Complementa a regra `preco_divergente_referencia` da V54 (ali é por medição;
   aqui é visão consolidada do contrato).

4. **Filtros + busca na tabela SOV** (~150 linhas) — `ContractSheet` hoje mostra
   todos os items. Com 500+ items vira lista enorme. Filtros: classe ABC,
   disciplina, fonte_referencia, saldo zero/baixo, busca por código/descrição.

5. **Apontamento de campo mobile-first** (~600 linhas) — feature grande, abre
   nova superfície de uso.

6. **Diff entre revisões GED** (~250 linhas) — diff visual sobre `extracted_text`.

Por valor/esforço imediato: **Validade temporal GED (1)** mantém ritmo SOV→GED
e reusa stack comprovado da V53. Em segundo, **Filtros SOV (4)** complementa
V55 (a tabela ABC fica longa em contratos reais). Continuar com qual?
