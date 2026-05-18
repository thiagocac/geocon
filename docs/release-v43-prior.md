# V43 — Carteira por programa estendida com KPIs Lei 14.133

V43 fecha o último gap tenant-level Lei 14.133: a página `/carteira` (Portfolio.tsx, V12 antigo) só conhecia os 4 KPIs financeiros tradicionais (valor total, medido, pago, contratos ativos) quando agregava contratos por programa/órgão/município. **Agora também mostra contagem de vícios abertos, PARs em curso, garantias vencendo, multas pendentes e sanções graves por agrupamento.**

Gestores seniores veem onde os problemas estão distribuídos na carteira: "Programa Saneamento Norte tem 12 vícios abertos e 3 garantias vencendo" — sem abrir cada contrato.

## Arquitetura

### Migration 050 — Views auxiliares

1. **`v_contract_lei14133_status`** (view auxiliar): 1 linha por contrato com 6 contagens:
   - `vicios_abertos` — `contract_receipt_vicios` em aberto/em_saneamento
   - `pars_em_curso` — PARs em workflow ativo (rascunho → em_recurso)
   - `garantias_vencendo_30d` — ativas/estendidas com vigência ≤30 dias
   - `multas_pendentes_count` — multas não pagas
   - `multas_pendentes_valor` — soma R$ das multas pendentes
   - `sancoes_graves_ativas` — impedimento + inidoneidade

2. **3 views agregadas** (`v_portfolio_by_program_lei14133`, `_by_orgao_`, `_by_municipio_`): JOIN com `v_contract_lei14133_status` + GROUP BY + cálculo de `contratos_criticos` (contratos com pelo menos 1 KPI positivo).

3. **1 RPC** `get_tenant_lei14133_kpis()`: totaliza todos os KPIs do tenant em 1 chamada. Usado no painel destacado no topo do Portfolio.

### Por que views separadas (sufixo `_lei14133`)

- Mantém `v_portfolio_by_program` (V12) **intacta** — outras consumers (Dashboard, EFs, RPCs) herdam sem mudanças
- UI Portfolio consome ambas e faz JOIN client-side por chave (program_id, orgao, ou uf|municipio)
- Permite deprecação progressiva no futuro sem breaking changes
- Trade-off: 3 queries em vez de 1, mas todas pequenas (count() em índices) e React Query cacheia separadamente

### Frontend

**Painel KPIs Lei 14.133** abaixo do Stat tradicional (só renderiza se houver pendência):
- Card com borda amarela e label "Lei 14.133 · pendências distribuídas na carteira"
- Indicador "X/Y contratos críticos" no canto direito
- Grid 2-3-5 colunas com 5 KPI cells (mobile/tablet/desktop)
- Tone por urgência: error (vícios, sanções graves), warning (garantias, multas), purple (PARs)

**Botão "Apenas críticos"** na barra de tabs (só aparece se há contratos críticos):
- Toggle visual com borda vermelha quando ativo
- Filtra cada tabela mantendo só agrupamentos com `contratos_criticos > 0`
- Empty state customizado quando filtro retorna 0

**Badges Lei 14.133 em cada linha** das 3 tabelas (programa/órgão/município):
- Aparece como nova linha abaixo dos números financeiros tradicionais
- Renderiza apenas os KPIs >0 (5 possíveis: vícios, PARs, garantias ≤30d, multas, graves)
- Termina com "em X contrato(s)" indicando concentração

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ módulos OK · 10.47s
```

**Bundle**:
- Main: 81.15 → **81.80 KB gzip** (+0.65 KB)
- Portfolio chunk: ~3.5 → **4.35 KB gzip** (+0.85 KB lazy, total cresceu pelas queries + componentes)
- Margem até 150 KB: **68.2 KB**

## Diff V42 → V43

- **+1 migration** (050_portfolio_lei14133 · ~180L) — 4 views + 1 RPC
- **api.ts**: 4 funções + 5 interfaces + 1 RPC wrapper
- **Portfolio.tsx**: +185L (3 hooks de query + propagação leiMap × 3 tabelas + filtro `onlyCritical` + 2 componentes auxiliares)
- **0 tabelas novas**, **0 cron jobs**, **0 EFs** — quarta versão consecutiva puramente compositiva (V39, V41, V42 também foram)

## Decisões arquiteturais

### Por que `v_contract_lei14133_status` em vez de subqueries inline nas 3 views?

- **DRY**: as 6 contagens iguais entre programa/órgão/município. Centralizar em 1 view evita repetição
- **Performance**: o planner do Postgres pode reusar o resultado entre as 3 queries de UI se elas rodarem na mesma transação
- **Manutenibilidade**: se amanhã adicionarmos `impedimentos_vigentes` ou outro KPI, mudar em 1 lugar
- **Reutilização**: outras telas (eg. ContractList, ContractDetail header) podem consumir a view auxiliar diretamente

### Por que `contratos_criticos` é COUNT FILTER?

```sql
count(*) FILTER (
  WHERE vicios_abertos > 0 OR pars_em_curso > 0
     OR garantias_vencendo_30d > 0 OR multas_pendentes_count > 0
     OR sancoes_graves_ativas > 0
)
```

Conta apenas contratos que têm **pelo menos um** KPI positivo. Mais útil que somar os KPIs porque um contrato com 5 vícios é tão crítico quanto um com 5 problemas distribuídos. Indicador de "espalhamento" do problema na carteira.

### Por que badges em vez de mini-charts ou heatmap?

- **Densidade de informação**: 5 valores numéricos por linha cabem em 1 row
- **Acessibilidade**: leitura imediata de "12 vícios", sem necessidade de hover/tooltip
- **Mobile-friendly**: chips em vez de gráficos que quebram em telas pequenas
- **Consistência visual**: já usamos badges em Pendências (V42), Dashboard executivo (V41), Timeline (V39)

### Por que client-side JOIN em vez de SQL JOIN entre views financeira e Lei 14.133?

- **Views são independentes**: financeira já existe (V12), Lei 14.133 é nova (V43)
- **Cacheable separadamente** em React Query (financeira muda menos que Lei 14.133)
- **Falha-aberta**: se a view Lei 14.133 falhar, a financeira continua funcionando (degradação graciosa)
- **Custo de JOIN ínfimo**: Map lookup O(1) em JS para arrays de <100 itens (programas/órgãos/municípios)

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only   # 049
```

Sem EFs novas, sem cron. Migration é DDL apenas (4 views + 1 RPC).

## Como testar (acceptance)

### Visão básica
1. `/carteira`
2. Painel financeiro (4 stats) no topo, igual antes
3. **NOVO** painel amarelo logo abaixo "Lei 14.133 · pendências distribuídas" — só aparece se há pelo menos 1 KPI >0
4. Tabs (Programa/Órgão/Município) inalteradas
5. **NOVO** botão "Apenas críticos" no canto direito da barra de tabs — só aparece se há contratos críticos
6. Cada linha da tabela mostra **badges Lei 14.133** logo abaixo dos números financeiros

### Filtro "Apenas críticos"
1. Click no botão "Apenas críticos"
2. Visual muda para vermelho (borda + texto)
3. Tabela filtra apenas agrupamentos com `contratos_criticos > 0`
4. Click novamente desfaz
5. Empty state apropriado se nenhum agrupamento crítico

### Badges
1. Programa "Saneamento" tem 3 contratos com vícios e 2 com garantias vencendo:
   - Aparece: `Lei 14.133: [3 vícios] [2 garantias ≤30d] em 4 contratos`
   - Tons: vermelho para vícios, amarelo para garantias
2. Programa sem nenhum problema: nenhum badge aparece (linha continua limpa)

### KPI painel topo
1. 5 KPI cells: vícios, PARs, garantias, multas (com valor), graves
2. Cell com valor=0: aparece em cinza/opaco (não destaca)
3. Cell com valor>0: aparece com cor (red/warning/purple)
4. Contagem "X/Y contratos críticos" no canto

### Mobile
1. Painel Lei 14.133 ainda mostra 5 KPIs (grid responsivo 2-col em mobile)
2. Botão "Apenas críticos" empilha em mobile
3. Badges quebram linha naturalmente sob a linha financeira

### Consistência com outras visões
1. KPIs no painel top devem **bater** com:
   - Pendências tenant V42 (mesmas fontes, critérios próximos)
   - Dashboard executivo por contrato V41 (soma cross-contratos = total tenant)
   - Email digest V12+V42 (consome `v_pendencias` que herdou os novos tipos)

## Mapa de cobertura tenant-level final

| Visão | Eixo Lei 14.133 |
|---|---|
| Dashboard executivo por contrato (V41) | 9/9 ✅ |
| Timeline por contrato (V39) | 9/9 ✅ |
| Pendências tenant (V42) | 9/9 ✅ |
| Email digest (herdado V12) | 9/9 ✅ |
| Tenant Timeline (V48) | 9/9 ✅ |
| **Carteira por programa/órgão/município (V43)** | **9/9 ✅** |

**Cobertura completa**: gestores podem detectar problemas dos 9 institutos em todas as visões tenant-level e contract-level.

## Retrospectiva V30 → V43 (14 versões consecutivas)

| Versão | Tema | Mig | Bundle main |
|---|---|---|---:|
| V30-V38 | Lei 14.133 (9 institutos) | 036-044 | 75-80 |
| V39 | Timeline por contrato | 045 | 80.43 |
| V40 | Mobile audit V30-V39 | — | 80.47 |
| V41 | Dashboard agregado por contrato | 046 | 80.94 |
| V42 | Pendências tenant Lei 14.133 | 047 | 81.15 |
| **V43** | **Carteira estendida** | **049** | **81.80** |

14 versões. Bundle main: 75.13 → 81.80 = **+6.67 KB gzip total**. **0 typecheck errors** em todas.

## Próximas oportunidades (V44+)

Com cobertura tenant-level completa, as direções abertas são qualitativamente novas:

1. **Cadastro de fornecedores sancionados** — view global cruzando contracts + sanctions: "Empresa X tem 3 contratos, 2 sanções ativas, 1 inidoneidade". Útil para due diligence de próximas licitações
2. **Export de timeline em PDF** — arquivo legal completo de um contrato com paginação, capa e índice
3. **API keys + REST público** — superfície externa para integrações (BI, ERPs, sistemas órgão)
4. **OKLCH migration** — DS Tier 3 (oferecida 16 vezes desde V14)
5. **EF download FGV/IBGE** — automatiza V31 CSV import com fetch direto
6. **Email de alertas por evento** — usa estrutura V41 + cron para enviar email quando alerta crítico aparece (vício novo, PAR procedente, etc)
7. **Webhook subscriptions externos** — payload das views Lei 14.133 enviado para sistemas externos

**Recomendação V44**: **Cadastro de fornecedores sancionados** — única visão Lei 14.133 ainda não construída. Tabela `contractors` + view `v_contractor_sanction_history` cruzando todos os tenants. Valor alto para due diligence e para órgãos consultantes. Custo médio (1 nova tabela + 2 views + 1 página).

Alternativa: **Email de alertas por evento** — baixo esforço, alto valor, mas requer EF + cron infrastructure (parcialmente já existe em V12 digest-daily).
