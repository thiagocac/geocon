# V57 — Polish V54/V55 + Auditoria de preços SINAPI/SICRO

V57 começou como bundle de "polimento" das V54/V55, mas auditoria descobriu
que os 3 itens propostos já estavam implementados. Pivotou para feature nova:
**auditoria de divergência de preços** — terceira dimensão analítica na área
SOV, complementando V54 (medição) e V55 (concentração ABC).

## Auditoria de descobertas

| Item proposto | Estado | Onde |
|---|---|---|
| Bloqueio backend submit | ✅ Já existia | V16 — `submit_measurement` RPC |
| "a mais recente" em price_refs | ✅ Já aplicado | V56 leftover na EF validate-measurement |
| Filtros + busca SOV | ✅ Já implementado | V56 leftover no ContractSheet |

A V56 carregou ajustes que estavam pendentes na sequência V54-V56. Bom resultado:
o app está mais coeso do que minha tracking inicial sugeria.

## O que V57 entrega de novo

### 1. Migration 060 — view + RPC de auditoria

**`v_contract_price_audit`** combina `contract_items` + `contract_item_price_references`:

- `DISTINCT ON (contract_item_id) ORDER BY data_base DESC NULLS LAST`
  pega a referência mais recente por item
- Filtros embutidos: `is_title=false`, `active=true`, `sov_versions.status='vigente'`
- **Recalcula `divergencia_pct` na hora** — não confia no campo armazenado que
  pode estar desatualizado quando o preço foi editado
- **Impacto** = `(preço_contrato − preço_ref) × (qtd_contratada + qtd_aditada)`
  (impacto potencial sobre o contrato inteiro, não realizado)
- **Magnitude** em 4 buckets: pequena ≤5%, média 5-15%, alta 15-30%, crítica >30%
- **Sinal** caro/barato (divergência positiva vs negativa)

**RPC `get_contract_price_audit_summary(contract_id)`** retorna jsonb com:
- `cobertura_pct` (items auditados / items totais — sinaliza se faltam refs cadastradas)
- `magnitudes` { pequena, media, alta, critica }
- `sinais` { caros, baratos }
- `impacto` { acima, abaixo, liquido } em R$

### 2. API + types

```ts
export type PriceAuditMagnitude = 'pequena' | 'media' | 'alta' | 'critica';
export type PriceAuditSinal     = 'caro' | 'barato';

export interface PriceAuditItem { ... }      // 18 campos
export interface PriceAuditSummary { ... }   // cobertura + magnitudes + sinais + impacto

export async function listContractPriceAudit(contractId): Promise<PriceAuditItem[]>;
export async function getContractPriceAuditSummary(contractId): Promise<PriceAuditSummary>;

export const PRICE_AUDIT_MAGNITUDE_LABELS: Record<PriceAuditMagnitude, string>;
```

Mock SKIP_AUTH: `MOCK_PRICE_AUDIT_OFFSETS` hardcode 8 items com offsets variados
demonstrando todas as 4 magnitudes + ambos os sinais.

### 3. Página `/contratos/:id/auditoria-precos` (lazy 8.6 KB raw)

**Header**: 4 cards de KPI
- **Cobertura** (% de items com referência cadastrada)
- **Crítica** (count + decomposição alta/média/pequena em subtítulo)
- **Impacto acima** (Σ items caros, vermelho)
- **Impacto abaixo** (Σ items baratos, verde, com líquido em subtítulo)

**Filtros** (4 controles em grid):
- Busca textual (código + descrição)
- Magnitude (4 opções)
- Sinal (caro / barato)
- Botão Limpar

**Tabela** ordenada por `|divergencia_pct|` DESC:
- Código + descrição (ref descrição em subtítulo)
- Preço contrato vs Referência
- Fonte (SINAPI/SICRO + UF + data_base)
- **Divergência** com ícone TrendingUp/Down + cor
- **Impacto** em R$ (com sinal explícito)
- Magnitude (badge slate/yellow/orange/red)

### 4. Demo mock — 8 items auditados

**Contrato c1** (5 items):
| Item | Offset | Magnitude | Sinal |
|---|---:|---|---|
| i1-1 Demolição | -2.1% | pequena | barato |
| i1-2 Concreto | +18.4% | alta | caro |
| i1-3 Alvenaria | +6.8% | média | caro |
| i1-4 Revestimento | **+34.2%** | **crítica** | caro |
| i1-5 Quadro elétrico | +8.4% | média | caro |

**Contrato c2** (3 items): i2-1 -4.2% · i2-2 +12.7% · i2-3 +2.8%

### 5. Botão "Auditoria de preços" no ContractSheet

Adicionado no header ao lado de "Comparar versões" com ícone FileSearch.

## Decisões

1. **Recalcular divergência sempre** — campo `divergencia_percentual` armazenado
   pode ficar desatualizado se preço editado. View recalcula com fórmula real.

2. **DISTINCT ON com fallback** — `ORDER BY contract_item_id, data_base DESC NULLS LAST, created_at DESC`
   garante determinismo mesmo se `data_base` for null.

3. **Magnitude 4 buckets** — calibrados por experiência de fiscalização pública:
   ≤5% é margem normal de mercado; 5-15% requer atenção; 15-30% recomenda
   auditoria; >30% é vermelho.

4. **Impacto = qtd_total, não qtd_medida** — mede impacto **potencial** do
   contrato. Para realizado, multiplicaria por `quantidade_medida_acumulada`.

5. **Cobertura % chave no resumo** — "de 200 items, 80 com referência (40%)"
   sinaliza que 60% do contrato não é auditado. Indica necessidade de importar
   mais refs SINAPI.

6. **Página lazy** — chunk separado 8.6 KB raw. Carrega só quando navegar.

7. **Sem chart formal** — magnitude já é categorizada (4 buckets); tabela +
   cards-de-resumo suficientes. Chart custaria +20 KB sem ganho informativo.

8. **Considerar materialized view em V58+** — para contratos com 10k items,
   view computada online pode ficar lenta. MV + refresh trigger seria upgrade.

## Bundle V56 → V57

| Chunk | V56 | V57 | Δ |
|---|---:|---:|---:|
| Main | 95.79 | **97.50** | +1.71 |
| ContractPriceAudit (lazy) | — | 8.6 KB raw | +8.6 raw |

Margem 150 − 97.50 = **52.50 KB**.

## Sequência V54-V57

| Versão | Área | Tema | Bundle | Δ |
|---|---|---|---:|---:|
| V54 | Medição | Validações automáticas (6 regras) | 92.69 | +2.25 |
| V55 | SOV | Curva ABC + Pareto | 94.63 | +1.94 |
| V56 | GED | Validade temporal + cron diário | 95.79 | +1.16 |
| V57 | SOV | Auditoria preços SINAPI/SICRO | 97.50 | +1.71 |

V55-V57 forma um trio analítico do orçamento na área SOV:
- **V55 ABC** olha CONCENTRAÇÃO de valor
- **V54 validate-measurement** olha por MEDIÇÃO/PERÍODO
- **V57 audit** olha o CONTRATO consolidado vs ref oficial

## Próximas oportunidades (V58+)

**Medição**:
1. **Apontamento campo mobile-first** (~600 linhas) — feature grande.

**SOV**:
2. **Composições de preço explícitas** (~400 linhas) — schema novo
   `contract_item_compositions` (mão-de-obra + material + equipamento).

**GED**:
3. **Diff entre revisões R01 vs R02** (~250 linhas) — diff-match-patch sobre
   `extracted_text`.
4. **Workflow aprovação de revisão GED** (~500 linhas) — reusa pattern
   measurement_approval_steps + magic link.
5. **Marca d'água "CÓPIA NÃO CONTROLADA"** (~300 linhas) — Edge Function.
6. **Painel KPI do acervo GED** (~300 linhas) — view + dashboard.

V54-V57 cobriu medição (1×) + SOV (2×) + GED (1×). GED tem mais opções abertas
para próximo equilíbrio. **(3) Diff entre revisões** ou **(6) Painel KPI** são
quick wins; **(4) Workflow aprovação** é feature grande mas estratégica.
Continuar com qual?
