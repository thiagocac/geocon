# V66 — Composições de preço explícitas (SOV)

V66 é a **última feature grande pendente** da trilogia "Composições · Marca
d'água · Apontamento campo" (3 das maiores features identificadas). Liga V57
(auditoria de preços SINAPI/SICRO) com decomposição real de mão-de-obra +
material + equipamento.

## Contexto

V55 (curva ABC) e V57 (auditoria preços SINAPI/SICRO) trabalharam com **preços
unitários consolidados** — um número por item. Mas a realidade da engenharia
de custos brasileira (Lei 14.133, TCU, SINAPI/SICRO oficiais) é que cada
serviço é uma **composição**:

> "Concreto fck=30 MPa estrutural - m³":
>   - 1.6h pedreiro × R$28.50/h     = R$45.60
>   - 1.6h servente × R$13.50/h     = R$21.60
>   - 1.05 m³ concreto × R$420/m³   = R$441.00
>   - 4.8 kg pinos × R$9.40/kg      = R$45.12
>   - 0.1h bomba × R$180/h          = R$18.00
>   - vb auxiliar × R$5.30/vb       = R$5.30
>   ─────────────────────────────────────────
>   Subtotal sem BDI                = R$576.62
>   + BDI 24%                       = R$715.01

Sem isso, auditor externo do TCU questiona: "como você chegou a R$845?
mostre os insumos". V66 entrega a decomposição completa.

## O que V66 entrega

### 1. Migration 065 — Schema novo (2 tabelas + view + 2 RPCs)

**`contract_item_compositions`** (header, 1:1 com contract_item):
- `codigo_composicao` (ex: '92395' SINAPI), `fonte` (SINAPI/SICRO/ORSE/SEDOP/proprio/outro)
- `data_base` (mês/ano da referência), `observacao`, `metadata` jsonb
- **UNIQUE constraint** em `contract_item_id WHERE deleted_at IS NULL` (1 composição ativa por item)
- RLS habilitado

**`contract_item_composition_lines`** (1:N, ON DELETE CASCADE):
- `tipo` CHECK 5 valores: `mao_obra | material | equipamento | servico_terceiro | consumo_auxiliar`
- `codigo`, `descricao`, `unidade`
- `coeficiente numeric(18,8)` — **8 decimais** para precisão SINAPI
- `preco_unitario numeric(18,6)`, `observacao`, `ordem`
- Índice em `(composition_id, ordem)` para listagem rápida

**View `v_contract_item_composition_summary`**:
- Agrega por composition_id retornando totais por tipo + `total_sem_bdi` + `num_linhas`
- Castings em `numeric(18,4)` (precisão suficiente para exibição)

**RPC `get_contract_item_composition(item_id)`** retorna jsonb único:
```json
{
  "summary": { "id", "fonte", "data_base", "total_mao_obra", ..., "total_sem_bdi" },
  "lines":   [ { tipo, codigo, descricao, unidade, coeficiente, preco_unitario }, ... ]
}
```
Reduz round-trips client-side (1 chamada vs 2).

**RPC `apply_composition_price_to_item(composition_id)`**:
- Pega `total_sem_bdi` da view + `bdi_percentual` do item
- Calcula `preco_novo = total × (1 + bdi/100)` arredondado a 6 dec
- UPDATE em `contract_items.preco_unitario`
- **Trigger V64 grava em audit_log automaticamente** (continuidade com histórico item-level)
- Sem trigger automático — usuário decide quando sincronizar (preço de proposta pode divergir do calculado por motivos de mercado)

### 2. API + types (`src/lib/api.ts`)

```ts
export type CompositionLineTipo =
  | 'mao_obra' | 'material' | 'equipamento'
  | 'servico_terceiro' | 'consumo_auxiliar';

export const COMPOSITION_TIPO_LABELS;  // pt-BR

export interface CompositionLine     { id, composition_id, ordem, tipo, codigo, descricao, unidade, coeficiente, preco_unitario, observacao, ... }
export interface CompositionSummary  { id, contract_item_id, codigo_composicao, fonte, data_base, total_mao_obra, total_material, ..., total_sem_bdi, num_linhas }
export interface ContractItemComposition { summary, lines }

export async function getContractItemComposition(itemId): Promise<ContractItemComposition | null>;
export async function applyCompositionPriceToItem(compositionId): Promise<{ item_id, preco_anterior, preco_novo, ... }>;
export function hasComposition(itemId): boolean;
```

**Mock SKIP_AUTH** com 2 composições realistas SINAPI:
- **i1-2** "Concreto estrutural fck=30 MPa - m³" — 6 linhas cobrindo 4 tipos
  (mão-de-obra, material, equipamento, consumo_auxiliar)
- **i1-4** "Reboco interno argamassa 1:6 - m²" — 4 linhas (mão-de-obra + material)

Códigos SINAPI reais: 92395 (concreto), 87529 (reboco), 88309 (pedreiro
encargos), 88316 (servente encargos), 01510 (concreto usinado), etc.

### 3. `<ContractItemCompositionModal />` (~250 linhas)

Componente standalone em `src/components/sov/`:

**Header da composição** (cards inline cinza):
- `<Database />` ícone + código (ex: "92395")
- Pill `fonte` (SINAPI/SICRO/etc) em navy
- `<Calendar />` + "base 01/01/2026" se data_base presente
- Contagem de insumos

**Linhas agrupadas por tipo** (na ordem: mão-de-obra → material → equipamento → terceiros → auxiliar):
- Cada grupo tem header com ícone próprio: `HardHat | Package | Wrench | Briefcase | MoreHorizontal`
- Subtotal do grupo no header (alinhado direita)
- Cada linha: código (mono small) + descrição truncada + observação italica
- Direita: `coeficiente × preco_unitario` em fonte pequena + total da linha em destaque

**Totais finais** (Card destacado bottom):
- Subtotal sem BDI
- BDI (%) com valor
- **Total com BDI** em verde grande

**Sync workflow**:
- Botão "Aplicar preço calculado" (Calculator icon)
- Click → `apply_composition_price_to_item` RPC
- Sucesso: banner verde com `preço_anterior → preço_novo`, invalida queries
  de items + histórico (V64 picks up via trigger)
- Erro: alerta vermelho

**Empty state**: "Sem composição cadastrada · pode importar via Excel ou
cadastrar manualmente (em breve)" — sinaliza que V67+ deve trazer edição.

### 4. Integração no ContractSheet

- Coluna "Ações" passa a abrigar **2 ícones**: `<Calculator />` (V66) + `<History />` (V64)
- Ícone Calculator só aparece se `hasComposition(item.id)` — em produção,
  ContractSheet usa view enriquecida; no mock, função pura olha MOCK_COMPOSITIONS
- Click abre Modal com `bdi_percentual` do item passed-in (default 0)

Layout visual: 2 botões `flex items-center justify-center gap-0.5` na cell
center. Mantém coluna compacta.

## Decisões

1. **Tabela 1:N, não jsonb único** — composições reais (SINAPI) têm 5-15
   linhas. Jsonb seria ergonomically pior para query (somar por tipo,
   contar linhas, filtrar por código). Tabela permite indexar `tipo` e
   `codigo` se virar necessário.

2. **UNIQUE constraint no contract_item_id** — 1 composição ativa por item.
   Soft-delete antes de criar nova. Evita ambiguidade.

3. **`coeficiente numeric(18,8)`** — SINAPI usa 6-8 decimais (ex:
   0.00346 ton-h/m³ para soldadores especializados). 4 decimais era
   insuficiente.

4. **View agregada vs cálculo client-side** — escolha de view: PostgreSQL
   faz uma vez no JOIN, retorna tudo agrupado. Client-side faria a mesma
   coisa, mas adiciona ~10 linhas de TypeScript e força carregar todas as
   linhas mesmo para mostrar só totais (relatórios futuros podem pedir só
   summary). View é vitória pequena mas justa.

5. **RPC `get_contract_item_composition` retorna jsonb único** — 2 entities
   (header + lines) em 1 chamada. PostgreSQL agregação é ~2ms; round-trip
   HTTP é ~100ms. Vitória clara.

6. **Sem trigger automático no `apply_composition_price`** — preço de
   proposta pode divergir do calculado por estratégia comercial. Forçar
   sync via trigger seria intrusivo. Usuário decide quando sincronizar.

7. **Reusa V64 audit log** — `apply_composition_price_to_item` faz UPDATE em
   `contract_items.preco_unitario`. Trigger V64 dispara automaticamente,
   gravando `before/after` em `audit_log` com `source='sov_edit'`. **Sem
   código extra** — V66 herda auditoria de graça.

8. **Modal vs página dedicada** — composição é contexto secundário do item.
   Modal preserva foco na planilha. Modal max-h-50vh + scrollbar.

9. **V66 = read-only + sync, não edit** — escopo controlado. Edição inline
   exigiria UI complexa (insert/delete linhas, autocomplete SINAPI codes,
   validação de coeficientes). V67+ pode fazer edição via Excel paste ou
   form dedicado.

10. **Mock com códigos SINAPI reais** — 92395, 87529, 88309, 88316, 01510,
    00367, 00368. Demonstra autenticidade do modelo de dados e permite
    pesquisadores reconhecerem o catálogo.

11. **5 tipos de linha (não 3)** — além de mão-de-obra/material/equipamento,
    SINAPI usa `servico_terceiro` (terceirização de fundição, por exemplo)
    e `consumo_auxiliar` (desmoldante, fios de amarração, materiais
    pequenos não inventariados linha-a-linha).

## Bundle V65 → V66

| Chunk | V65 | V66 | Δ |
|---|---:|---:|---:|
| Main | 101.73 | **104.39** | +2.66 |
| Migration 065 | — | 8.0 KB | (não-bundled) |

Δ maior da série V61-V66. Modal (~250 linhas) entra no main bundle (tight
coupling com ContractSheet, igual decisão de V64 para HistoryModal).

Margem 150 − 104.39 = **45.61 KB**.

## Sequência V54-V66 cumulativa

| Versão | Área | Tema | Bundle | Δ |
|---|---|---|---:|---:|
| V54 | Medição | Validações automáticas | 92.69 | +2.25 |
| V55 | SOV | Curva ABC + Pareto | 94.63 | +1.94 |
| V56 | GED | Validade temporal + cron | 95.79 | +1.16 |
| V57 | SOV | Auditoria preços SINAPI/SICRO | 97.50 | +1.71 |
| V58 | GED | Diff entre revisões | 98.23 | +0.73 |
| V59 | GED | Painel KPI do acervo | 98.67 | +0.44 |
| V60 | GED | Workflow aprovação revisão | 99.32 | +0.65 |
| V61 | Medição | Apontamento campo mobile | 99.42 | +0.10 |
| V62 | Medição | Offline queue + PWA | 99.54 | +0.12 |
| V63 | Medição | UI inspeção da fila | 99.63 | +0.09 |
| V64 | SOV | Histórico item-level | 101.28 | +1.65 |
| V65 | GED | Notificação automática workflow | 101.73 | +0.45 |
| V66 | SOV | **Composições de preço** | 104.39 | +2.66 |

**+11.70 KB total** em 13 versões = 23% do crescimento até 150 KB.
Cobertura: Medição 4× · SOV **4×** · GED 5×. **SOV chega ao pé de igualdade.**

## Próximas oportunidades (V67+)

**Última feature grande pendente**:
1. **Marca d'água "CÓPIA NÃO CONTROLADA" GED** (~300 linhas) — Edge Function
   `generate-watermarked-pdf` + ICP-Brasil opcional. Fecha capítulo GED
   compliance.

**Quick wins / polish**:
2. **Edição inline de composição** (~200 linhas) — completa V66 (insert/delete
   linhas, autocomplete códigos SINAPI). Lateral à read-only.
3. **Marcar `source` em SovImport/Bulk** (~30 linhas) — completa V64 com
   ícones distintos por origem.
4. **Dedup fila offline** (~80 linhas) — completa V62.
5. **UI quota IndexedDB** (~60 linhas) — completa V62.
6. **Swipe gestures campo mobile** (~50 linhas) — UX polish V61.
7. **Filtro actor/período histórico V64** (~80 linhas).

**Features médias novas**:
8. **Análise de divergência de preços** (~150 linhas) — page lista itens
   onde `preco_unitario` diverge do `total_sem_bdi × (1+BDI)` calculado da
   composição. Liga V57 + V64 + V66.

V67 natural: **Marca d'água GED (1)** fecha a trilogia de features grandes —
seria a 14ª versão consecutiva e marcaria o fim da fase de features
substanciais. Depois disso, V68+ entra em modo polish/quick-wins.

Ou edição inline de composição (2) para tornar V66 produtivo. Continuar com qual?
