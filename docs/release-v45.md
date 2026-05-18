# V45 — Cadastro de fornecedores sancionados

V45 entrega o item #4 da lista V41: visão cross-contract por CNPJ das sanções aplicadas (V38). Útil para:

- **Próximas licitações**: verificar se um licitante tem histórico de inidoneidade/impedimento ativos
- **Due diligence interna**: identificar fornecedores recorrentes em PARs procedentes
- **Conformidade**: gerar lista exportável compatível com cadastros nacionais (CEIS/CNEP)

## Arquitetura

### Migration 052 (~350L)

**1 view + 4 RPCs**, sem novas tabelas.

#### View `v_sanctioned_suppliers`

Pipeline em 2 CTEs:

1. **`supplier_base`**: `DISTINCT ON (tenant_id, cnpj)` em `contract_organizations` para obter o nome mais recente de cada CNPJ (o mesmo CNPJ pode aparecer com variações de nome em contratos diferentes ao longo do tempo)

2. **`sanction_agg`**: agrupa `contract_sanctions` por CNPJ da contratada via JOIN `contracts → contract_organizations`, com 18 agregações:
   - Contagens totais por status (ativas, cumpridas, suspensas, revogadas)
   - Contagens por tipo (advertencia, multa, impedimento, inidoneidade)
   - **Contagens ativas por gravidade** (impedimento_ativo, inidoneidade_ativa) — colunas mais relevantes para licitações
   - Financeiro: multa_total, multa_paga, multa_pendente
   - Temporal: primeira_sancao, ultima_sancao, vigencia_fim_ativa (max entre sanções ativas com vigência)
   - Contratos distintos afetados

Output enriquecido com **2 campos derivados**:

- `status_agregado` (`ativo` | `historico`): "ativo" se há qualquer sanção ativa
- `severidade_atual` (`critica` | `alta` | `media` | `baixa` | `nenhuma`):
  - **critica**: inidoneidade ativa
  - **alta**: impedimento ativo
  - **media**: sanção ativa + multa
  - **baixa**: sanção ativa (só advertência)
  - **nenhuma**: tudo cumprido/revogado

#### RPCs (4)

**`list_sanctioned_suppliers`** — tabela principal, filtros:
- `severidade[]`, `status[]`, `q` (ILIKE em CNPJ ou nome)
- `only_with_active` (booleano: apenas impedimento/inidoneidade ativos — fluxo de licitação)
- `limit` (max 500, default 200)
- Ordena: críticos primeiro, depois por ultima_sancao DESC

**`get_sanctioned_supplier_detail(cnpj)`** — modal de detalhe expandido. Retorna jsonb com:
- `summary`: linha da view
- `sanctions[]`: todas as sanções individuais (com contract_numero/titulo, par_id, vigência, etc) ordenadas por data_aplicacao DESC
- `contracts[]`: contratos distintos afetados (DISTINCT, com valor_total_atual)

**`check_cnpj_sanctioned(cnpj)`** — verificação rápida para fluxo de licitação. Retorna jsonb:
```json
{
  "cnpj": "...",
  "found": true/false,
  "pode_contratar": true/false,
  "severidade": "critica" | ...,
  "motivo_bloqueio": "Declaração de inidoneidade ativa até 15/06/2027" | null,
  ...
}
```

`pode_contratar = (impedimento_ativo == 0 AND inidoneidade_ativa == 0)`. Advertência e multa não bloqueiam; só os tipos graves (art. 156 III/IV).

**`get_sanctioned_suppliers_summary`** — KPIs para o header da página.

## Página `/fornecedores-sancionados`

**Header com 2 actions**:
- Botão "Verificar CNPJ" abre modal de consulta avulsa
- Botão "Exportar CSV" gera download com 15 colunas (CNPJ formatado, nome, severidade, status, contagens por tipo, multa pendente, datas, contratos afetados)

**4 KPIs** (KpiGrid V40):
1. Fornecedores sancionados total + ativos
2. Severidade crítica (vermelho se >0) + sub: altas/médias
3. Impedimentos ativos (vermelho se >0) + sub: inidoneidades
4. Multas pendentes (R$ short)

**Painel de filtros**:
- Search por CNPJ ou nome (ILIKE server-side)
- Chips de severidade (4 níveis) com bolinhas coloridas + contagens do summary
- Checkbox status: "Com sanção ativa" / "Histórico (todas cumpridas)"
- Checkbox especial: "Apenas com impedimento/inidoneidade ativos"

**Tabela compacta** (lista de linhas em vez de table — escala melhor pra mobile):
- Avatar circular colorido por severity + ícone Building
- CNPJ formatado + Badge severidade + Badge "N ativas" se aplicável
- Nome em destaque
- Meta line: `N sanções · 2IN · 1I · 3M · 1A · 5 contratos afetados · R$ 250k pendente · vence em 23d`
- Click → modal de detalhe

**Modal de detalhe** (size xl):
- Header com avatar grande + nome + CNPJ + badges
- 4 KPI cards por tipo (Advertência, Multa, Impedimento, Inidoneidade) com sub-info de pendência/ativos
- Card "Sanção mais longa ativa" com borda colorida por urgência (verde se já expirou, vermelho se ≤30d, neutro acima)
- Lista de contratos afetados (clicável → `/contratos/:id/sancoes`)
- Lista cronológica de sanções com badges + valor + vigência + fundamentação

**Modal "Verificar CNPJ"**:
- Input livre (aceita formato com pontuação ou só números)
- Submit por Enter ou botão "Verificar"
- Resultado em card verde (✓ pode contratar) ou vermelho (✗ bloqueado) com motivo legal:
  - "Declaração de inidoneidade ativa até DD/MM/YYYY"
  - "Impedimento de licitar/contratar ativo até DD/MM/YYYY"
- Mostra severidade + contagem de sanções ativas + última sanção mesmo quando "pode_contratar" (advertência/multa não bloqueiam mas vale aparecer)

## Navegação

Adicionado em 3 lugares:
- **Sidebar `PRIMARY_NAV`**: "Fornecedores sancionados" entre "Linha do tempo" e "Relatórios", ícone `ShieldOff`
- **CommandPalette**: `nav-fornecedores-sancionados` na seção "Navegação"
- **Rota**: `/fornecedores-sancionados`

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ 1767 módulos · 9.27s
```

**Bundle**:
- Main: 84.44 → **84.89 KB gzip** (+0.45 KB)
- SanctionedSuppliers (lazy novo): **5.45 KB gzip**
- Margem até 150 KB: **65.1 KB**

## Diff V44 → V45

- **+1 migration** (052 sanctioned_suppliers · ~350L · 1 view + 4 RPCs)
- **+1 página** (`SanctionedSuppliers.tsx` ~650L · 4 KPIs + filtros + tabela + 2 modais)
- **+2 entradas de navegação** (Sidebar + CommandPalette)
- **+1 rota** (`/fornecedores-sancionados`)
- **api.ts**: 4 wrappers + 8 interfaces + 1 enum de labels + 2 helpers (fmtCnpj, sanctionedSeverityTone)
- **0 tabelas, 0 cron, 0 EFs** — quarta versão consecutiva puramente compositiva (V39, V41, V42, V43, V45)

## Decisões arquiteturais

### Por que CNPJ como chave primária e não organization_id?

- CNPJ é a **identidade legal estável** do fornecedor. O mesmo CNPJ pode aparecer em múltiplos `contract_organizations` ao longo de contratos diferentes (com nome ligeiramente variado, dados de contato atualizados, etc).
- Cadastros nacionais (CEIS/CNEP) usam CNPJ como chave.
- Fluxo de licitação consulta por CNPJ do licitante.
- `organization_id` fica disponível como ponteiro pra UI (mostrar dados de contato mais recentes).

### Por que view + RPCs em vez de tabela materializada?

- Volume tipicamente baixo (algumas dezenas a centenas de CNPJs sancionados por tenant)
- Sanções mudam de status (cumprida, suspensa, revogada) constantemente — materialização exigiria triggers ou refresh periódico
- View é sempre consistente sem lag
- Postgres consegue otimizar UNIONs e FILTER aggregates eficientemente

### Por que `check_cnpj_sanctioned` separada de `get_supplier_detail`?

- Caso de uso diferente: integração com fluxo de licitação onde só importa o veredicto (pode/não pode)
- Payload mínimo para latência baixa
- Pode ser exposta via REST público (V46+: "API keys") sem expor histórico detalhado
- Semântica clara: "verificar" vs "ver detalhe"

### Por que "Apenas com impedimento/inidoneidade ativos" como checkbox separado em vez de severidade?

- A severidade `crítica`/`alta` já implica esses tipos ativos, mas a UI fica mais explícita quando o caso de uso é "filtrar bloqueio de licitação"
- Combinável com outros filtros (ex: + busca por CNPJ específico)
- Espelha a lógica do `pode_contratar`

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only   # 052
```

Sem EFs, sem cron, sem deps externas.

## Como testar (acceptance)

### Smoke
1. Sidebar → "Fornecedores sancionados"
2. KPIs mostram totais agregados
3. Tabela lista CNPJs ordenados por severidade (críticos primeiro)
4. Click em uma linha → modal detalhe com sanções, contratos, KPIs por tipo

### Filtros
1. Buscar "12.345" → tabela filtra
2. Selecionar severidade "Crítica": só fornecedores com inidoneidade ativa
3. Marcar "Apenas com impedimento/inidoneidade ativos": equivalente a crítica + alta
4. Limpar reseta

### Verificar CNPJ
1. Botão "Verificar CNPJ"
2. Input "12.345.678/0001-90" → Verificar
3. Se sancionado com impedimento: card vermelho "✗ Bloqueado para contratação · Impedimento ativo até DD/MM/YYYY"
4. Se sancionado só com advertência: card verde "✓ Pode contratar" + mostra histórico
5. Se não encontrado: card verde "✓ Pode contratar · Nenhuma sanção encontrada"

### Exportar CSV
1. Click "Exportar CSV"
2. Download dispara: `fornecedores-sancionados-YYYY-MM-DD.csv`
3. Arquivo abre em Excel com BOM UTF-8 + colunas: CNPJ, Nome, Severidade, Status, Sanções ativas/total, Contagens por tipo, Multa pendente, Datas, Contratos afetados

### Edge cases
1. Tenant sem sanções: empty state "Nenhuma sanção registrada na carteira"
2. CNPJ aparece como contratada em 3 contratos com sanções: row única consolidada, contratos_distintos = 3
3. CNPJ com inidoneidade revogada: aparece como "histórico" + severidade "nenhuma" (todos revogados)
4. CNPJ com 1 advertência ativa + 2 multas pagas: severidade "baixa" + status "ativo"
5. CNPJ com impedimento expirado mas não marcado como cumprido: cron mensal V36 deveria ter notificado; row aparece com `dias_ate_vencimento` negativo

### RLS
1. Usuário do tenant A não vê CNPJs sancionados em tenant B (RLS via SECURITY DEFINER + tenant_id na query)
2. `check_cnpj_sanctioned` para mesmo CNPJ em 2 tenants retorna resultados distintos por sessão

## Retrospectiva V30 → V45 (16 versões)

| Versão | Tema | Mig | Bundle main |
|---|---|---|---:|
| V30-V38 | Lei 14.133 (9 institutos) | 036-044 | 75.13 → 80.03 |
| V39 | Timeline por contrato | 045 | 80.43 |
| V40 | Mobile audit | — | 80.47 |
| V41 | Dashboard por contrato | 046 | 80.94 |
| V42 | Timeline global do tenant | 048 | 81.43 |
| V43 | Dashboard global do tenant | 049 | 84.13 |
| V44 | Export Timeline PDF | 051 | 84.44 |
| **V45** | **Fornecedores sancionados** | **052** | **84.89** |

Bundle main +9.76 KB gzip em 16 versões. 0 typecheck errors em todas.

## Próximas oportunidades (V46+)

Continuando ordem V41:

1. ~~Timeline global do tenant~~ — V42 ✅
2. ~~Dashboard global do tenant~~ — V43 ✅
3. ~~Export de timeline em PDF~~ — V44 ✅
4. ~~Cadastro de fornecedores sancionados~~ — V45 ✅
5. **API keys + REST público** ← próximo — superfície externa para integração com sistemas de licitação (consumir `check_cnpj_sanctioned` programaticamente)
6. OKLCH migration — DS Tier 3
7. EF download FGV/IBGE — automatiza CSV import V31
8. Email digest de alertas — usa RPC V41/V43 num cron mensal
9. Completar Pendencias V35-V38 (047 órfã + UI)
10. Completar Carteira V12 com KPIs Lei 14.133 (050 órfã / release-v43-prior)

**Recomendação V46**: API keys + REST público. A nova `check_cnpj_sanctioned` é candidata natural para primeira API externa — sistemas de licitação consultam programaticamente. Trabalho médio: tabela `api_keys` com hash, EF de auth-bridge, 1-2 endpoints REST.

Alternativa: **Email digest de alertas** (item 8). Usa diretamente RPCs V41 (per-contract) e V43 (tenant) num cron mensal/semanal pra emails personalizados. Trabalho médio, valor imediato.
