# V43 — Dashboard global do tenant

V43 enriquece o Dashboard tenant-level (`/dashboard`, rotulado "Carteira") com **três novas seções** alimentadas pela Lei 14.133, sem mexer no conteúdo legacy. Gerentes seniores agora veem alertas críticos da carteira inteira, status agregado dos 9 institutos, e próximos vencimentos cross-contract — tudo na primeira tela após login.

Mesmo padrão arquitetural do V41 (per-contract dashboard) mas tenant-wide: **1 RPC retorna jsonb único** com tudo, evitando ~10 chamadas separadas.

## Arquitetura

### Backend (migration 049)

**1 RPC única**: `get_tenant_dashboard()` retorna jsonb agregando 8 institutos cross-contract + 5 tipos de alertas + top 8 contratos críticos + 10 próximos vencimentos + 12 eventos recentes da timeline V39.

A RPC executa ~25 queries internas em 1 round-trip:
- 1 SELECT em contracts pra totals (count, valor_inicial/atual/aditado)
- 1 SELECT em guarantees para garantia disponível/executada
- 5 SELECTs para alertas (1 por tipo · cada um com count + jsonb_agg de contratos amostra)
- 8 SELECTs aninhados em `jsonb_build_object` para per_axis (1 por instituto · cada um com 3-4 sub-counts)
- 1 CTE com pontuação de top 8 contratos críticos
- 1 CTE com UNION ALL de 4 fontes de vencimentos cross-contract
- 2 SELECTs em v_contract_timeline pra recent events

Tudo filtrado por `tenant_id = current_tenant_id()` + `deleted_at IS NULL` (defense in depth além da RLS).

### Frontend

**Dashboard.tsx enriquecido** (não substituído). Estrutura final:

1. PageHeader (legacy)
2. **NEW V43: TenantAlerts** — banner com até 5 cards de alerta, só aparece se houver alertas ativos
3. Stats grid 4-col (legacy)
4. **NEW V43: TenantAxisGrid + TenantNextDates** — layout 2-col (status agregado à esquerda, vencimentos à direita)
5. Contratos críticos (legacy) — segue usando `listTopCriticalContracts`
6. Portfolio por programa (legacy)
7. Risco trend (legacy)

3 sub-componentes novos adicionados ao final do arquivo: `TenantAlerts`, `TenantAxisGrid` + `AxisTile`, `TenantNextDates` + `NextDateLineV43`.

## 5 alertas globais (espelham V41 mas agregados)

| Alerta | Severity | Contagem mostrada | Sample |
|---|---|---|---|
| Vícios graves abertos | danger | contratos com vícios alta/critica | top 3 `#numero` |
| Garantias vencendo ≤7d | danger | total de garantias afetadas | top 3 `#numero` |
| PARs procedentes sem sanção | warning | total de PARs com gap | top 3 `#numero` |
| Prazo de defesa vencido | warning | total de PARs em mora | top 3 `#numero` |
| Multas grandes pendentes | warning | total de multas + valor agregado | total R$ |

Click em alerta:
- Se 1 contrato afetado → navega direto pra `/contratos/:id/{module}`
- Se múltiplos → navega pra `/timeline` (visão consolidada V42)

## Layout do TenantAxisGrid

Card único com **grid 2×4** (mobile 2×4 também):
- Aditivos · Reajustes · Repactuações · Reequilíbrios
- Recebimentos · Garantias · PARs · Sanções

Cada tile mostra 2-3 stats numéricos com tons coloridos + footer opcional (valor agregado). Click navega pra `/timeline?kinds={instituto}` (deep-link no Timeline V42 com filtro pré-aplicado).

## TenantNextDates

Card lateral com top 10 vencimentos da carteira, cada linha:
- Ícone Clock colorido por urgência (≤7d vermelho, 8-30d amarelo, 31-60d azul, 60+ cinza)
- `#numero` em magenta + título do evento (ex: "Garantia #3")
- Subtítulo: nome do contrato + data
- Badge à direita: `Xd` (dias até vencimento)
- Click → deep-link na página do módulo do contrato

Max-height 24rem com scroll interno pra não estourar o layout.

## Top critical contracts (algoritmo)

Score cross-contract usando heurística ponderada:
- **3 × vícios graves abertos** (peso máximo)
- **2 × PARs procedentes ativos** (em recurso ou recém-decididos)
- **2 × garantias vencendo ≤7d**
- **1 × multas pendentes**
- **1 × PARs em fase ativa** (defesa, instrução, julgamento, recurso)

Retornados top 8 (com score > 0). Disponível no payload mas a UI atual usa a versão legacy `listTopCriticalContracts` pra "Contratos críticos" — substituição da UI legacy fica para release futuro (não breakage).

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ módulos OK · 11.80s
```

**Bundle**:
- Main: 81.43 → **84.13 KB gzip** (+2.70 KB) — Dashboard é eager-loaded (landing route), V43 sub-components entram aqui
- Sem chunk lazy novo
- Margem até 150 KB: **65.9 KB**

A subida maior que recentes (+2.7KB vs +0.4-0.5 usual) reflete os 3 sub-componentes novos no main bundle. Tradeoff aceitável: Dashboard é a primeira tela após login, eager-loading evita 1 RTT desnecessário no caminho crítico.

## Diff V42 → V43

- **+1 migration** (049 tenant_dashboard ~400L · 1 RPC complexa com ~25 sub-queries)
- **Dashboard.tsx**: +250L de sub-componentes + 11 novos imports (ícones e helpers) + 1 useQuery + 3 inserções de JSX
- **api.ts**: 1 wrapper + 10 interfaces + 1 enum de labels + 1 helper de severity

**0 tabelas novas, 0 views novas, 0 cron, 0 triggers, 0 rotas novas**. Pura agregação cross-contract.

## Cobertura tenant-level (V42+V43)

| Visão tenant | Versão | Status |
|---|---|---|
| `/timeline` — feed cronológico | V42 | ✅ 9/9 institutos |
| `/dashboard` — alertas + status | **V43** | ✅ 9/9 institutos (V43) + legacy |
| `/pendencias` — itens com SLA | V12 (4/9) | 047 órfã pendente |
| `/carteira` — programa | V12 (4/9) | sem cobertura V30-V38 |

`/pendencias` e `/carteira` ainda não cobrem totalmente os 9 institutos. Candidatos a releases futuros — note que há também um `release-v43-prior.md` no diretório descrevendo uma versão alternativa da V43 (carteira por programa) de sessão anterior.

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only   # 049
```

Sem EFs, sem cron, sem deps externas.

## Como testar (acceptance)

### Tenant sem dados V30-V38 (clean state)
1. Login → `/dashboard`
2. Sem banner de alertas (nenhum ativo)
3. Stats legacy continuam funcionando
4. Card "Lei 14.133 — status agregado" mostra todos os tiles com 0
5. Card "Próximos vencimentos" mostra empty state com check verde
6. Restante do dashboard legacy intacto

### Tenant com dados V30-V38 (estado real)
1. Login → `/dashboard`
2. Banner de alertas aparece logo após o header com 1-5 cards coloridos
3. Click em alerta: se afeta 1 contrato → navega direto; se múltiplos → vai pra /timeline
4. Card "Lei 14.133" mostra contagens reais; click em tile → /timeline com filtro
5. Card "Próximos vencimentos" lista top 10 com cores por urgência; click → módulo do contrato

### Mobile
1. Banner de alertas: grid 1-col (vs 2-3 em desktop)
2. Layout 2-col (axis + next dates): empilha em 1-col
3. Stats legacy continuam responsivos (V40 KpiGrid)

## Retrospectiva V30 → V43 (14 versões)

| Versão | Tema | Mig | Bundle main |
|---|---|---|---:|
| V30 | Reajuste · cálculo + índices | 036 | 75.13 |
| V31 | Reajuste · aditivo + CSV + cron | 037 | 75.66 |
| V32 | Reajuste · bulk apply | 038 | 75.86 |
| V33 | Repactuação | 039 | 76.17 |
| V34 | Reequilíbrio | 040 | 76.91 |
| V35 | Recebimentos | 041 | 77.59 |
| V36 | Garantias | 042 | 78.39 |
| V37 | PAR / Apuração | 043 | 79.43 |
| V38 | Sanções (fecha Lei 14.133 9/9) | 044 | 80.03 |
| V39 | Timeline unificada por contrato | 045 | 80.43 |
| V40 | Mobile audit + utility components | — | 80.47 |
| V41 | Dashboard agregado por contrato | 046 | 80.94 |
| V42 | Timeline global do tenant | 048 | 81.43 |
| **V43** | **Dashboard global do tenant** | **049** | **84.13** |

Bundle main +9.00 KB gzip em 14 versões cobrindo Lei 14.133 completa + 4 visões consolidadas (timeline contrato, dashboard contrato, timeline tenant, dashboard tenant) + mobile coverage. **0 typecheck errors** em todas.

## Próximas oportunidades (V44+)

Continuando a ordem V41:

1. ~~Timeline global do tenant~~ — V42 ✅
2. ~~Dashboard global do tenant~~ — V43 ✅
3. **Export de timeline em PDF** ← próximo na fila — arquivo legal completo de um contrato com paginação, capa, índice
4. Cadastro de fornecedores sancionados
5. API keys + REST público
6. OKLCH migration
7. EF download FGV/IBGE
8. Email digest de alertas
9. Completar Pendencias V35-V38 (047 órfã + UI)
