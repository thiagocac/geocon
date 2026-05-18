# V50 — Completar Carteira V12 (mocks Lei 14.133)

V50 fecha o débito órfão da migration 050 (criada em `release-v43-prior`, preservada
em sequência válida desde então). Mesmo padrão de V49 (que fechou migration 047):
trabalho de finalização puramente frontend — sem migration nova nessa versão.

## O problema

A V43 (release-v43-prior preservada como `050_portfolio_lei14133.sql`) criou as
**3 views agregadas Lei 14.133 + RPC `get_tenant_lei14133_kpis`**, e o
**Portfolio.tsx** foi atualizado para consumi-las (KPI banner global, badges por
agrupamento, filtro "apenas críticos"). Mas:

- Os **4 fetchers** `getPortfolioByProgramLei14133`, `getPortfolioByOrgaoLei14133`,
  `getPortfolioByMunicipioLei14133` e `getTenantLei14133Kpis` retornavam **array
  vazio / zeros** em `SKIP_AUTH=true`.
- O fetcher `getTenantDashboard` (V42-V47) **também retornava tudo zerado** em
  `SKIP_AUTH=true` — `TenantAlerts` no Dashboard ficava invisível.
- `MOCK_SUMMARY.pendencias_total` / `pendencias_high` ainda mostravam `4 / 2`
  (estado anterior à V49, que expandiu `MOCK_PENDENCIAS` para 9 / 5).

Resultado prático: em demo / dev mode com `SKIP_AUTH`, a feature mais importante
da carteira ficava **invisível** — Portfolio e Dashboard não mostravam nenhum
KPI Lei 14.133, mesmo com todo o UI wired.

## O que V50 entrega

### 1. 4 mocks Lei 14.133 com narrativa coerente

Distribuição alinhada à `MOCK_PENDENCIAS` V49:

| Contrato (mock) | Programa | Órgão | Município | Issues Lei 14.133 |
|---|---|---|---|---|
| c1 #42 hospital | pg-1 SAU | SES/RJ | Rio de Janeiro | — |
| c2 #107 escolas | pg-2 EDU | SEEDUC/RJ | Niterói | PAR + multa R$ 245k + grave |
| c3 #211 CIEP | pg-1 SAU | SES/RJ | Rio de Janeiro | vício aberto |
| c4 #298 UPA | pg-1 SAU | SES/RJ | Petrópolis | garantia ≤30d |
| c5 #334 praça | — | Prefeitura | Nova Iguaçu | (recebimento atrasado — fora dos 5 KPIs) |

**Totais derivados** (validados por soma manual):
- vícios_abertos: 1, pars_em_curso: 1, garantias_vencendo_30d: 1
- multas_pendentes: 1 × R$ 245.000, sanções_graves_ativas: 1
- contratos_criticos: 3 (c2 + c3 + c4) de 9 totais

Os totais são idênticos somando linhas por **qualquer dimensão**
(programa, órgão ou município). Demo permanece auto-consistente independente
do agrupamento escolhido.

### 2. Mock realista de `getTenantDashboard`

Ao invés do stub vazio, agora retorna `TenantDashboard` completo:

- **totals**: 9 contratos / 7 ativos / R$ 65.5M inicial / R$ 67.14M atual (+R$ 1.64M aditivos)
- **alerts** (Lei 14.133 cross-contract):
  - `vicios_graves`: 1 (c3 #211)
  - `garantias_7d`: 1 (c4 #298 — vence em 6 dias)
  - `par_procedente_sem_sancao`: 0
  - `par_prazo_defesa_vencido`: 0
  - `multas_grandes_pendentes`: 1 × R$ 245.000
- **per_axis** (8 eixos): aditivo (3), reajuste (6 eventos · R$ 420k delta),
  repactuação, reequilíbrio, recebimento (5 prov · 3 def · 1 vício),
  garantia (9 total · 7 ativas · R$ 3.275M disponível), PAR (4 total · 1 em
  andamento), sanção (3 · 2 ativas · 1 grave)
- **top_critical_contracts**: c2 (87) · c3 (72) · c4 (65)
- **next_dates**: 4 próximos vencimentos (garantia, PAR defesa, recebimento
  vencido, fim de vigência de sanção)
- **recent_events**: 4 eventos timeline (multa aplicada, vício registrado, PAR
  instaurado, aditivo aprovado)
- **recent_activity**: 14 eventos em 30d / 5 em 7d

### 3. `MOCK_SUMMARY.pendencias_total/_high` atualizado para `9 / 5`

Estava stale desde V49 quando `MOCK_PENDENCIAS` foi expandido (de 4 → 9
entradas). O badge vermelho no header do Dashboard `<Pendências [5]>` agora
bate com o que a página `/pendencias` mostra.

## Decisões

1. **Mocks vs migrations** — V50 é puramente frontend. A migration 050 já está
   completa há 7 versões (release-v43-prior). Não há nada para acrescentar no
   SQL; o débito era de demonstração / dev mode.
2. **Narrativa única para Lei 14.133** — escolhi 1 cenário coerente
   (3 contratos críticos distribuídos em 2 programas / 2 órgãos / 3 municípios)
   em vez de números aleatórios. Demo / screenshot / onboarding agora conta
   história completa.
3. **Soma exata em todas as dimensões** — admin / executivo que troca o
   tab `Programa ↔ Órgão ↔ Município` no Portfolio vê os mesmos totais
   agregados, só redistribuídos. Demonstra que as 3 views são views do mesmo
   estado, não fontes diferentes.
4. **Datas relativas a 2025-11-14** (próximo ao período de outros mocks) —
   garantia vence em 6 dias (≤7d trigger), PAR limite em 6 dias, recebimento
   vencido há 1 dia. Demo permanece "fresca" sem precisar atualizar mocks
   periodicamente — usa datas absolutas, não `new Date()`.
5. **`getTenantDashboard` mockado completo** vs deixar zerado — fica fora do
   escopo "Carteira V12" stricto sensu, mas a feature Dashboard Lei 14.133
   também ficava invisível em demo. Custo: ~70 linhas a mais; valor: feature
   mais visível do produto fica demonstrável.

## Bundle V49 → V50

| Chunk | V49 | V50 | Δ |
|---|---:|---:|---:|
| Main | 84.44 | **85.63** | **+1.19** |
| Portfolio | 4.36 | 4.36 | 0 |

Margem 150 − 85.63 = **64.37 KB**. Custo justificado: mocks completos viraram a
diferença entre demo "tela vazia" e demo "produto funcionando".

## Retrospectiva V42 → V50 (9 versões)

Sequência de migrations 042-055 (14 migrations) + UI + mocks de demo, todas com
**0 typecheck errors** e bundle dentro do alvo. Lei 14.133 100% coberta com:

- 5 institutos (vícios, PARs, garantias, multas, sanções graves) — V42-V44
- 4 visões consolidadas (carteira por 3 dimensões + dashboard tenant) — V43-V47
- Export PDF timeline com hash + validação pública — V44
- REST público para integração externa — V45-V46
- Cadastro nacional de sancionados (CGU/CEIS/CNEP) — V47
- Digest mensal de alertas + IBGE automatizado — V48
- Pendencias Lei 14.133 V35-V38 finalizadas — V49
- **Carteira V12 finalizada — V50**

Todos os débitos órfãos de migrations preservadas em `release-v43-prior` agora
**estão honrados em mocks de demo**. Próximo trabalho não tem mais débitos
históricos pendentes.

## Próximas oportunidades (V51+)

Lista atualizada (V41 inicial menos itens concluídos):

6. ~~OKLCH migration~~ — declinada 18× desde V14
9. ~~Completar Pendencias V35-V38~~ — feito na V49
10. ~~Completar Carteira V12~~ — **feito na V50**

**Espaço novo**:

- **Tenant dashboard como Edge Function exportável** — gerar PDF executivo do
  estado atual com mesmo template visual (gráficos por eixo + alertas + top
  críticos), assinado e validável publicamente como timeline V44
- **Comparação cross-tenant para super admin** — admin de plataforma vê KPIs
  agregados de todos os tenants (anonimizados) com benchmarks de quartil
- **Alertas em tempo real via Supabase Realtime** — vícios graves, PAR
  procedente, multa >R$ 100k disparam toast/notificação imediata em vez de
  esperar refresh do query
- **Hardening de SKIP_AUTH** — auditar todos os fetchers que retornam vazio
  em SKIP_AUTH (provavelmente há outros gaps similares aos achados em V50)

Por valor / esforço, **Hardening de SKIP_AUTH** é o mais barato (auditoria
mecânica que pode rodar via grep + análise), e **Tenant Dashboard PDF**
o mais alto valor (CFO / diretor não precisa logar para ver estado da
carteira, recebe PDF mensal).
