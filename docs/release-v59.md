# V59 — Painel KPI do acervo GED

V59 fecha a sequência analítica V54-V58 com um **dashboard operacional** do
acervo GED — visão consolidada de 8 dimensões em uma única tela, identificando
gargalos de workflow e oportunidades de manutenção.

## Contexto

Após V58 entregar comparação de revisões, faltava ainda uma visão de "saúde
geral" do acervo. Quando um gestor abre a área GED:
- Quantos docs estão em revisão há tempo demais (gargalo)?
- Quais documentos aprovados há >1 ano podem estar obsoletos?
- A taxa de uso (downloads/30d) está caindo?
- A cobertura de validade temporal (V56) é alta?
- Como o acervo se distribui entre status e categorias?

V59 responde tudo isso em uma página `/ged/dashboard`.

## O que V59 entrega

### 1. Migration 061 — RPC `get_ged_acervo_kpis()`

Função SQL única retornando jsonb com 8 dimensões:

```sql
get_ged_acervo_kpis() RETURNS jsonb
-- {
--   tenant_id, total, generated_at,
--   by_status: { em_elaboracao, em_revisao, aprovado, distribuido, obsoleto, cancelado },
--   by_category: [ { id, codigo, nome, cnt, aprovados, em_revisao, obsoletos } ],  -- top 8
--   validade:   { com_validade, sem_validade, pct_com_validade },
--   extracao:   { com_texto, sem_texto, pct_com_texto },
--   uso:        { downloads_30d },
--   health:     { aprovados_sem_revisao_1ano, em_revisao_mais_30d, vencidos_ativos }
-- }
```

**Implementação**: 6 queries agregadas dentro de PL/pgSQL com `count() FILTER`
para evitar múltiplos scans da mesma tabela. Tenant-scoped via auth.uid() →
members.

**Decisões de design**:
- **1 RPC, não 6** — minimiza round-trips. Para acervos até 50k docs, ainda
  é rápido (todas as queries em ged_documents + ged_categories +
  ged_document_versions são simples GROUP BY)
- **STABLE não IMMUTABLE** — depende de auth.uid() e CURRENT_DATE
- **Top 8 categorias** — corta na fonte; UI nunca recebe lista enorme. Reduz
  payload e renderiza rápido
- **`HAVING count(d.id) > 0`** — exclui categorias vazias do top 8 (evita
  poluição visual)

### 2. API + types (`src/lib/api.ts`)

```ts
export interface GedAcervoKpis {
  tenant_id: string;
  total: number;
  by_status: Partial<Record<GedStatus, number>>;
  by_category: Array<{ id, codigo, nome, cnt, aprovados, em_revisao, obsoletos }>;
  validade: { com_validade, sem_validade, pct_com_validade };
  extracao: { com_texto, sem_texto, pct_com_texto };
  uso:      { downloads_30d };
  health:   { aprovados_sem_revisao_1ano, em_revisao_mais_30d, vencidos_ativos };
  generated_at: string;
}

export async function getGedAcervoKpis(): Promise<GedAcervoKpis>;
export const GED_STATUS_LABELS: Record<string, string>;
```

Mock SKIP_AUTH derivado de `MOCK_GED_DOCS + MOCK_VERSIONS + MOCK_ACCESS` via
função pura. Refleti mudanças se mock for editado.

### 3. Página `/ged/dashboard` (lazy chunk 8.4 KB raw)

**Estrutura**:

1. **4 KPI cards** no header (Total · Validade % · Texto extraído % · Downloads/30d)
   - Tone dinâmico: success/yellow baseado em thresholds (>50% validade =
     verde, >70% texto = verde)
2. **Distribuição por status** — Card com barra stacked multi-segmento +
   legenda em grid 3 colunas (mostra só status com count > 0)
3. **Top categorias** — lista com barras horizontais proporcionais ao count,
   linha de drill-down "aprovado: X · em revisão: Y · obsoleto: Z" quando
   há decomposição
4. **Saúde do acervo** — 3 cells lado-a-lado:
   - **Aprovados há >1 ano** — sinaliza docs antigos que podem estar obsoletos
   - **Em revisão há >30 dias** — sinaliza gargalo de workflow
   - **Vencidos ativos** — sinaliza compliance breakdown (V56 connection)
5. **Timestamp** — geração em pt-BR no footer

**Tons dinâmicos**:
- Health cells: vermelho se vencidos_ativos > 0; amarelo se há docs problemáticos; verde se 0
- KPI cards: verde se acima do threshold, amarelo se abaixo

### 4. Integração no `Ged()` list page

Botão **"Painel"** com ícone `BarChart3` no header (primeiro botão à esquerda).
Link para `/ged/dashboard`. Posição prioritária reflete que dashboard é o
primeiro lugar onde gestor olha ao chegar.

### 5. Mocks SKIP_AUTH consistentes

`deriveMockGedAcervoKpis()` agrega:
- 7 docs totais
- by_status: aprovado=4, em_elaboracao=1, em_revisao=1, distribuido=1
- by_category: 6 categorias (Documentos legais, SST, etc.)
- validade: 3/7 = 42.9% com validade (V56 mocks)
- extração: 1/7 = 14.3% (apenas doc-1 tem versions com extracted_text via V58)
- downloads_30d: derivado de MOCK_ACCESS
- health: 1 vencido_ativo (doc-7 ASO), 0 dos outros

Demonstra dashboard preenchido + sinaliza ações: "14% de cobertura de
extração — rodar extração nos demais" e "1 documento vencido — renovar ASO".

## Decisões

1. **STABLE, não IMMUTABLE** — depende de auth.uid() e CURRENT_DATE.

2. **Top 8 categorias hard-coded** — para acervos com 50+ categorias, 8
   captura ~85% da distribuição típica (Pareto se aplica também aqui).

3. **`HAVING count > 0`** — categorias vazias não merecem espaço no painel.

4. **Sem chart lib** — Pareto bar (V55) + bar charts inline (V59) provam que
   Recharts/D3 não são necessários para 95% dos casos. Economia ~25 KB.

5. **`staleTime: 30_000`** no React Query — KPIs mudam pouco; cache evita
   spam de RPC. Usuário recebe dados frescos a cada 30s.

6. **Mock recalculado, não estático** — função pura derivada de MOCK_GED_DOCS
   garante consistência se demo data mudar.

7. **Health alerts qualitativos** — não dou números absolutos para "muito"/"pouco";
   só conto. Cabe ao gestor decidir o que é aceitável.

8. **Sem drill-down nas categorias** — clicar numa categoria não filtra a
   lista GED. Trade-off: feature útil mas adicionaria ~50 linhas. V60 pode
   ligar `?category=...` no Ged() list.

9. **Botão "Painel" como primeiro** — sinaliza que é o ponto de partida
   recomendado, não Lista direta. Mudança ergonômica.

## Bundle V58 → V59

| Chunk | V58 | V59 | Δ |
|---|---:|---:|---:|
| Main | 98.23 | **98.67** | +0.44 |
| Dashboard (lazy) | — | 8.4 KB raw | — |

Margem 150 − 98.67 = **51.33 KB**. Custo no main: helpers de API + tipo (~70 linhas).
Página renderiza em chunk lazy separado. Delta menor que V58 (que já era o
menor da série) — arquitetura modular continua disciplinada.

## Sequência V54-V59 cumulativa

| Versão | Área | Tema | Bundle | Δ |
|---|---|---|---:|---:|
| V54 | Medição | Validações automáticas (6 regras) | 92.69 | +2.25 |
| V55 | SOV | Curva ABC + Pareto | 94.63 | +1.94 |
| V56 | GED | Validade temporal + cron | 95.79 | +1.16 |
| V57 | SOV | Auditoria preços SINAPI/SICRO | 97.50 | +1.71 |
| V58 | GED | Diff entre revisões | 98.23 | +0.73 |
| V59 | GED | Painel KPI do acervo | 98.67 | +0.44 |

V54-V59 cobertura: Medição 1× · SOV 2× · **GED 3×**. Δ total +5.98 KB
em 6 versões = 12% do crescimento até 150 KB.

## Próximas oportunidades (V60+)

**GED restantes**:
1. **Workflow aprovação de revisão GED** (~500 linhas) — reusa pattern
   measurement_approval_steps + magic link. Submit R02 → aprovador → publica.
2. **Marca d'água "CÓPIA NÃO CONTROLADA"** (~300 linhas) — Edge Function
   que adiciona overlay + assinatura ICP-Brasil.

**Medição grande**:
3. **Apontamento campo mobile-first** (~600 linhas) — swipe-cards + foto
   direta + GPS + voice + offline Service Worker.

**SOV grande**:
4. **Composições de preço explícitas** (~400 linhas) — schema novo
   `contract_item_compositions` (mão-de-obra + material + equipamento).

**Sugestão V60**: começar feature grande. **Apontamento campo mobile-first** é
o mais transformador (abre superfície de uso totalmente nova: fiscal em
canteiro de obra). **Workflow aprovação GED** é estratégico mas reusa stack
existente, menor risco. Continuar com qual?
