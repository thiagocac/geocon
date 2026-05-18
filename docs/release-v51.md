# V51 — Hardening de SKIP_AUTH (Lei 14.133 sub-resources)

V51 estende o trabalho V49+V50 fechando o último gap estrutural do demo mode:
**tornar c2/c3/c4 totalmente clicáveis em SKIP_AUTH**. Após V50, a Dashboard e
Portfolio mostravam corretamente os 3 contratos críticos Lei 14.133, mas se o
usuário clicasse em qualquer um deles, as abas PARs/Sanções/Recebimentos/
Garantias/Timeline ficavam vazias.

## O problema

Auditoria mecânica em `src/lib/api.ts` revelou **41 funções** que retornam
array vazio em `SKIP_AUTH=true`. Subconjunto crítico para Lei 14.133 (14
funções):

| Função | Demo impact pré-V51 |
|---|---|
| `listContractReceipts` / `listReceiptVicios` / `getContractReceiptsSummary` | Aba "Recebimentos" do contrato sempre vazia |
| `listContractGuarantees` / `listGuaranteeEvents` / `getContractGuaranteesSummary` | Aba "Garantias" sempre vazia |
| `listContractPars` / `listParSteps` / `getContractParsSummary` | Aba "PARs" sempre vazia |
| `listContractSanctions` / `listSanctionEvents` / `getContractSanctionsSummary` | Aba "Sanções" sempre vazia |
| `listContractTimeline` / `getContractTimelineSummary` | Timeline do contrato vazio |
| `listTenantTimeline` / `getTenantTimelineSummary` / `getTenantTimelineContracts` | Timeline global vazio |

**Bug crítico descoberto na investigação**: `MOCK_CONTRACTS` em
`src/lib/mockData.ts` continha 4 contratos (c1-c4) com `numero`, `objeto`,
`municipio` e `contratante` **completamente divergentes** da narrativa
V49+V50 (que usa CT-2024/0107 Niterói, CT-2024/0211 Rio, CT-2024/0298
Petrópolis, CT-2024/0334 Nova Iguaçu). Clicar c2 em pendencias (que mostra
"CT-2024/0107 Niterói") levava à página de detalhe com **outro contrato**:
"CT-2024/0058 Pavimentação Ribeirão Preto".

Esse gap existia desde antes da V42 — V49 e V50 acabaram herdando referências
a numeros que não existiam, mas como só o módulo Lei 14.133 usava esses ids,
a inconsistência ficou invisível até a hora de fazer os mocks SKIP_AUTH
clicáveis.

## O que V51 entrega

### 1. 5 seções Lei 14.133 com mocks SKIP_AUTH realistas

**Recebimentos + vícios (c3)**:
- 1 provisório `rec-c3-1` com `vicios_abertos: 1`, status `com_pendencias`,
  garantia 60 meses
- 1 vício `vic-c3-1` "Concreto fora de fck (35MPa) em pilares do bloco B",
  severidade alta, em saneamento até 02/12/2025
- `ReceiptsSummary` retorna `{ provisorios_emitidos:1, vicios_abertos:1,
  garantia_ativa: true, garantia_fim: '2030-10-25' }` para c3; zeros p/ demais

**Garantias + eventos (c4)**:
- 1 garantia `gar-c4-1` caução em dinheiro R$ 560.000 (5% do contrato),
  vencendo em 6 dias
- 1 evento `ge-c4-1-1` de registro inicial
- `GuaranteesSummary` retorna proximo_vencimento real para c4

**PARs + steps (c2)**:
- 1 PAR `par-c2-1` numero 3, tipo_infracao `atraso_injustificado`, status
  `em_defesa`, limite 2025-11-20
- 3 steps: criado → instaurado → em_defesa
- `ParSummary` retorna `{ total:1, em_andamento:1, em_defesa:1 }` para c2

**Sanções + eventos (c2)**:
- Sanção 1: multa R$ 245.000 ativa (vence 2025-12-12, vinculada a PAR-2025/002)
- Sanção 2: impedimento 6 meses ativo (vigência até 2026-05-14, fundamentação
  fraude documental — art. 156, III)
- 1 evento de aplicação por sanção
- `SanctionsSummary` com proximo_vencimento da multa

**Timeline (contract + tenant)**:
- `MOCK_CONTRACT_TIMELINE` mapa c1→c5 com 7 eventos totais derivados das
  resources acima + 1 aditivo histórico de c1
- `MOCK_TENANT_TIMELINE_V51` agregado, ordenado desc por `event_at`
- Helper `filterTimeline` honra os parâmetros `kinds`, `severity`, `from`,
  `to`, `limit`, `before` (cursor) — mock comportamentalmente equivalente
  às RPCs Postgres
- `getTenantTimelineSummary` deriva `by_kind` e `by_severity` dos eventos
- `getTenantTimelineContracts` lista 5 contratos com `event_count` + `last_event_at`

### 2. Alinhamento de MOCK_CONTRACTS à narrativa V49+V50

Substituí os 4 contratos antigos (Hospital São Carlos SP, Pavimentação
Ribeirão Preto SP, Creche Goiânia GO, DER-MG) por 5 contratos alinhados:

| id | numero | objeto | contratante | município |
|---|---|---|---|---|
| c1 | CT-2024/0042 | Construção Hospital Regional · Bloco cirúrgico e UTI | SES/RJ | Rio de Janeiro |
| c2 | CT-2024/0107 | Reforma rede municipal de escolas · Niterói | SEEDUC/RJ | Niterói |
| c3 | CT-2024/0211 | Reforma Hospital Universitário · Bloco B (UTI + cirurgia) | SES/RJ | Rio de Janeiro |
| c4 | CT-2024/0298 | Construção UPA Petrópolis · fase 2 | SES/RJ | Petrópolis |
| c5 | CT-2024/0334 | Revitalização Praça Central · Nova Iguaçu | Prefeitura | Nova Iguaçu |

Campos derivados (`valor_inicial`, `valor_atual`, `percentual_fisico`, etc.)
recalculados para casar com:
- `MOCK_TENANT_DASHBOARD.totals` (R$ 65.5M inicial, R$ 67.14M atual)
- `MOCK_TENANT_DASHBOARD.top_critical_contracts` (c2 R$ 14.3M, c3 R$ 4.2M, c4 R$ 11.2M)
- `MOCK_SUMMARY` (R$ 31.7M medido = soma dos 5 valor_medido_acumulado)

Cada contrato tem `alertas` específicos descrevendo seus problemas Lei
14.133 (PAR em defesa, multa aplicada, vício registrado, garantia
vencendo, etc.), tornando o card do contrato auto-explicativo.

### 3. Outros alinhamentos secundários

- `listOrganizations` mock: org-1 SES/RJ + org-2 SEEDUC/RJ (substituiu
  Secretaria genérica + Prefeitura Ribeirão Preto)
- `listLots` mock: lots de c1 movidos de São Carlos/SP para Rio/RJ (Av.
  Brasil, Manguinhos)
- `MOCK_DOCS.d6`: atualizado de "CT-2024/0058" para "CT-2024/0107" + título
  "Sondagem de solo — terreno escola CIEP Niterói"
- `MOCK_ITEMS.i2-*`: 3 items de c2 alinhados de pavimentação (asfáltica,
  brita) para reforma escolar (demolição cerâmica, cobertura, pintura)

## Decisões

1. **Estratégia de mock por contract_id** — `listContractPars(contract_id)`
   retorna `contract_id === 'c2' ? MOCK_PARS_C2 : []` (em vez de retornar
   um array global). Isso preserva a narrativa: só os 3 contratos críticos
   têm dados, demais ficam vazios. Demonstra UI states vazios + populados
   sem aleatoriedade.

2. **Filter helper compartilhado** — `filterTimeline<T>(events, filters)`
   encapsula a lógica de aplicar `kinds/severity/from/to/limit`. Reutilizado
   por `listContractTimeline` e `listTenantTimeline`. Evita duplicação e
   garante semântica consistente entre o mock e a RPC server-side.

3. **MOCK_TENANT_TIMELINE_V51 derivado** — em vez de hardcodar 7 eventos
   replicados, derivo via `Object.entries(MOCK_CONTRACT_TIMELINE).flatMap(...)`
   e ordeno por `event_at` descendente. Mudar o contract timeline atualiza
   o tenant timeline automaticamente.

4. **Items de c2 realinhados** — embora a `Item` interface não seja Lei
   14.133, deixar items de "pavimentação asfáltica" num contrato chamado
   "Reforma escolas" geraria pergunta óbvia em demo. Custo: 3 linhas. Outros
   contratos (c3, c4, c5) não tinham items específicos — herdam o array
   vazio default.

5. **Items de c3/c4/c5 vazios** — escopo limitado. Pode ser V52 se prioridade
   surgir, mas em demo o usuário típico não navega para a aba "Itens" do
   contrato sem antes ver Pendencias/Sanções/PARs (que agora funcionam).

6. **`getParDetail` mantido sem mock** — retorna do RPC direto. Em demo mode
   ainda funcionaria via Supabase chamada (falhando). Justificativa:
   `getParDetail` só é chamado quando usuário clica num PAR específico —
   adicionar mock seria 50+ linhas para um caso raramente atingido em
   demo de 2 minutos.

## Bundle V50 → V51

| Chunk | V50 | V51 | Δ |
|---|---:|---:|---:|
| Main | 85.63 | **88.22** | +2.59 |

Delta cobre ~250 linhas de mock data inlined. Margem 150 − 88.22 = **61.78 KB**.

## Auditoria SKIP_AUTH — estado atual

Das 41 funções com `return []` antes do V51, **14 foram preenchidas** com
mocks realistas. Restantes 27 são funções de:

- **Admin interno** (webhooks, role aliases, API keys, fetch log) — demo de
  super admin não é caminho típico
- **Reajuste/repactuação bulk** (candidates, simulate, apply) — requer
  preparo de candidatos com cenário específico; demonstrável via narrative
  isolada
- **GED transmittals + dead letter queue** — admin tooling
- **Sancionados nacionais + admin indices** — listas externas, fazem mais
  sentido vazias em fresh tenant

Esses 27 stubs vazios são **intencionalmente vazios** para um tenant
recém-criado em demo (zero estado inicial). Documentado abaixo:

```
listSchedulePeriods, listPhysicalFinancialSchedule, listItemGlosses
listSovVersions, compareSovVersions
listTransmittalDocuments, listTransmittalReceipts, listContractOrganizations
listBacklog
listRoleAliases, listTenantWebhooks, listWebhookDispatches, listWebhookQueueEvents
searchEntitiesForWebhook, exportDeadLetterEvents, tenantWebhookHealth
listAdjustmentIndices, listIndexValues, listContractReajustes
listReajusteCandidates, bulkSimulateReajuste, bulkApplyReajuste
listRepactuacaoCandidates, listContractRepactuacoes, getRepactuacaoEventItems
listContractReequilibrios
listSanctionedSuppliers, listApiKeys, listFetchLog
```

## Retrospectiva V42 → V51 (10 versões)

| Versão | Foco | Migration nova? |
|---|---|---|
| V42 | Garantias contratuais (Lei 14.133 art. 96-101) | 042 |
| V43 | Carteira Lei 14.133 + dashboard tenant | 043, 046 |
| V44 | Timeline + PDF export | 044, 045, 051 |
| V45 | REST público interno | 052 |
| V46 | REST público externo + API keys | 053 |
| V47 | Sancionados CGU/CEIS/CNEP | 052 (compl.) |
| V48 | IBGE automático | 054, 055 |
| V49 | Pendencias V35-V38 finalizadas (mocks) | — |
| V50 | Carteira V12 finalizada (mocks Lei 14.133) | — |
| V51 | Sub-resources Lei 14.133 clicáveis (mocks) | — |

**3 versões consecutivas sem migration nova** (V49, V50, V51). Indica
maturidade: backend está completo, frontend está completo, demo mode agora
acompanha. Próxima oportunidade obriga decisão sobre direção do produto.

## Próximas oportunidades (V52+)

1. **Tenant Dashboard PDF executivo** (V50 sugestão) — alto valor: CFO/
   diretor recebe PDF mensal sem precisar logar. Reutiliza pdf-lib +
   timeline V44 + dados de `getTenantDashboard`. Estimativa: 1 Edge
   Function + 1 trigger cron + ~300 linhas.

2. **Realtime alerts Lei 14.133** — Supabase Realtime emite eventos quando
   vício grave / multa > R$ 100k / PAR procedente / garantia ≤7d são
   criados ou modificados. Toast/notification imediato em vez de aguardar
   refresh manual. Estimativa: 1 trigger Postgres + 1 hook React + 1
   componente toast.

3. **Comparação cross-tenant para super admin** — KPIs Lei 14.133
   anonimizados com benchmarks de quartil. Útil para auditoria de
   plataforma. Estimativa: 1 view materializada + 1 RPC + 1 página admin.

4. **Hardening final SKIP_AUTH** — popular as 27 funções restantes para
   demo 100% navegável (incluindo admin pages). Estimativa: ~300 linhas
   mock data espalhadas; alguns casos precisam de pensamento sobre cenário
   demonstrável.

5. **Migração para Supabase Realtime no notification bell** — já existe
   notification system com polling. Migrar para channel push reduz latência
   de ~30s para imediato.

Por valor / esforço, **Realtime alerts (item 2)** é o melhor: alto valor
demonstrável + escopo compacto (~400 linhas), tecnicamente isolado (não
toca arquitetura). **Tenant Dashboard PDF** é o segundo melhor.
