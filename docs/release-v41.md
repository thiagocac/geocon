# V41 — Dashboard agregado por contrato

V41 entrega a visão executiva consolidada, colhendo dados dos 9 institutos da Lei 14.133 (V30-V38) + Timeline (V39) numa única página que responde a pergunta:

> **"O que precisa de atenção neste contrato AGORA?"**

Diferente da Timeline V39 (passado cronológico) e do ContractDetail (lista de módulos), o Dashboard é orientado a **ação futura**: alertas, próximos vencimentos, pendências por eixo, atividade recente.

## Arquitetura

### Backend (migration 046)

**1 RPC única**: `get_contract_dashboard(contract_id)` retorna jsonb com toda a informação numa só round-trip. Estratégia escolhida para evitar 8-10 chamadas separadas da UI.

A RPC executa internamente:
- 1 SELECT no contract
- 8 SELECTs com FILTER por status para per-axis counts
- 1 CTE com UNION ALL para `next_dates` (10 fontes diferentes de vencimentos consolidadas)
- 2 SELECTs na `v_contract_timeline` (V39) para events_30d e recent_events
- 5 SELECTs condicionais para construir `alerts` (vícios graves, PARs procedentes sem sanção, garantias <7d, PARs com prazo vencido, multas grandes)

Total: ~17 queries internas em uma única RPC, mas só 1 round-trip do cliente.

### Frontend

Página única `/contratos/:id/dashboard` (~400L) usando primitives do DS interno (`<Card>`, `<KpiGrid>`, `<KpiCard>`, `<Badge>`). 5 seções:

1. **Alerts críticos** (banner clicável no topo) — só aparece se houver
2. **KPIs financeiros** (4 cards) — valor inicial, total atual, garantia disponível/executada
3. **KPIs de pendência** (4 cards) — vícios abertos, PARs em curso, multas pendentes, recebimentos com pendência
4. **Layout 2 colunas** (lado a lado em desktop, empilhado em mobile):
   - **Próximos vencimentos** — top 10 de todos os eixos (garantias, definitivo limite, vícios, defesa PAR, sanções)
   - **Atividade recente** — top 6 eventos dos últimos 30 dias da timeline V39
5. **Status por eixo** (grid 4-col em desktop, 2-col em mobile) — 8 cards de instituto Lei 14.133, cada um clicável navega para o módulo

## 5 tipos de alertas (severidade variável)

| Alerta | Severity | Critério | Mensagem |
|---|---|---|---|
| Vícios graves | danger | Severidade alta/critica em aberto | "X vício(s) grave(s) em aberto" |
| Garantias vencendo ≤7d | danger | status ativa/estendida + vigência <7d | "X garantia(s) vencendo em até 7 dias" |
| PAR procedente sem sanção | warning | PAR procedente + sancao_proposta_tipos != [] + sem sanção materializada | "X PAR procedente sem sanção aplicada" |
| Prazo de defesa vencido | warning | PAR em_defesa + defesa_prazo_limite < today | "X PAR com prazo de defesa vencido" |
| Multas grandes pendentes | warning | multa > R$ 100k não paga | "X multa(s) pendente(s) acima de R$ 100k" |

Cada alerta é clicável e navega para a página do módulo correspondente.

## Próximos vencimentos (6 fontes consolidadas)

| Tipo | Origem | Fórmula de dias |
|---|---|---|
| `guarantee` | contract_guarantees.data_vigencia_fim (ativa/estendida) | fim - today |
| `receipt_limit` | provisorios sem definitivo + data_limite_definitivo | limite - today |
| `vicio` | contract_receipt_vicios em aberto/em_saneamento | data_limite_saneamento - today |
| `par_defesa` | PARs em_defesa | defesa_prazo_limite - today |
| `sanction_vigencia` | impedimento/inidoneidade ativa | vigencia_fim - today |
| `sanction_multa` | multa não paga com data de vencimento | data_vencimento_multa - today |

Todos filtrados para `>= today` (não inclui já vencidos — esses ficam nos alerts). Ordenados por `days_until` ASC, limit 10.

UI usa código de cor por urgência:
- Vermelho: ≤7 dias (ou negativo, mas não chega aqui)
- Amarelo: 8-30 dias
- Azul: 31-60 dias
- Cinza: 60+ dias

## Per-axis cards (8 institutos)

Cada card mostra:
- Ícone + label
- 2-4 stats numéricos com tons coloridos (success/warning/error/default)
- Footer opcional (valor agregado quando faz sentido)
- Click navega para o módulo

| Eixo | Stats principais |
|---|---|
| Aditivos | total · aprovados · em_aprovacao · footer: valor liquido total |
| Reajustes | regras ativas · eventos aplicados · footer: delta total |
| Repactuações | eventos · footer: delta total |
| Reequilíbrios | total · em_curso · aplicados · footer: valor aprovado |
| Recebimentos | provisórios · definitivos · vícios |
| Garantias | total · ativas · executadas · footer: disponível |
| PARs | total · em_curso · procedentes · prazo_vencido |
| Sanções | total · ativas · impedimento/inidoneidade · footer: multa pendente |

## Card no ContractDetail

Adicionado como **primeiro card** (acima de Timeline V39 e Planilha SOV). Ícone `Gauge`, subtitle "Visão executiva · alertas · ações pendentes".

Hierarquia agora:
1. **Dashboard** (V41) — onde estou? o que urge?
2. **Linha do tempo** (V39) — o que aconteceu?
3. **Planilha SOV**, **Medições**, **Aditivos**, ... — onde executar ações

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ módulos OK · 13.08s
```

**Bundle**:
- Main: 80.47 → **80.94 KB gzip** (+0.47 KB)
- ContractDashboard (lazy novo): **3.69 KB gzip**
- Margem até 150 KB: **69.1 KB**

## Diff V40 → V41

- **+1 migration** (046 contract_dashboard ~350L · 1 RPC complexa)
- **+1 página** (ContractDashboard ~400L · 5 sub-componentes: AlertBanner · NextDateRow · RecentEventRow · AxisCard + página principal)
- **+1 card no ContractDetail** (primeiro da lista)
- **+1 rota** (`/contratos/:id/dashboard`)
- **api.ts**: 1 wrapper + 10 interfaces + 2 helpers + 1 enum de labels
- **0 tabelas novas** — segunda versão consecutiva puramente compositiva (V39 também foi)

## Decisões arquiteturais

### Por que single RPC com tudo em jsonb?

- **Latência**: 1 round-trip vs ~10 (cada eixo carregaria separado)
- **Atomicidade**: snapshot consistente — todos os números refletem o mesmo instante
- **Cache**: 1 chave React Query (`['contract-dashboard', contractId]`) facilita invalidação
- **Cost**: ~17 queries internas, mas Postgres faz eficientemente (todos os indexes V30-V38 ajudam)

Tradeoff: payload maior (~5-10KB) em uma só requisição. Aceitável para dashboard.

### Por que os alertas vivem na RPC e não no frontend?

- **Lógica de negócio centralizada**: regras "≤7 dias", "multa > 100k", "PAR procedente sem sanção" são domain-level, não UI-level
- **Reutilização**: se amanhã quisermos enviar email com os mesmos alertas, basta chamar a RPC
- **Consistência**: alertas mudam atomicamente com os dados; sem possibilidade de UI mostrar "0 alertas" enquanto o real é diferente

### Por que próximos vencimentos é CTE única com UNION ALL?

- **Ordenação correta**: precisamos do top 10 considerando TODAS as fontes ordenadas por urgência. Filtrar separadamente em cada eixo e depois fazer merge no JS seria ineficiente
- **Schema uniforme**: já que cada fonte tem timestamps diferentes (vigencia_fim, defesa_prazo_limite, data_vencimento_multa), normalizar em SQL é mais limpo
- **Performance**: Postgres consegue otimizar UNION ALL com LIMIT bem

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only   # 046
```

Sem EFs, sem cron, sem deps externas. Migration cria 1 RPC apenas.

## Como testar (acceptance)

### Visão básica
1. `/contratos/:id/dashboard`
2. Header mostra "Contrato #N · Dashboard · {título}"
3. KPIs financeiros em primeiro lugar (4 cards)
4. KPIs de pendência logo abaixo (4 cards)
5. Próximos vencimentos + atividade recente lado a lado em desktop
6. 8 cards de eixo em grid 4-col, cada um clicável

### Em contrato "limpo" (sem nada)
1. Sem alertas
2. KPIs zerados
3. Próximos vencimentos: empty state "Nenhum vencimento próximo" com check verde
4. Atividade recente: "Sem atividade no período"
5. Cards de eixo todos zerados, sem cores
6. Footer: "sem questões críticas no momento"

### Em contrato "crítico" (com pendências graves)
1. Vícios alta/crítica em aberto → alert vermelho no topo
2. Garantia vencendo em 5 dias → alert vermelho
3. PAR procedente sem sanção → alert amarelo
4. Multa de R$ 500k não paga → alert amarelo
5. KPIs com valores em cores (vermelho para vicios, amarelo para multas)
6. Próximos vencimentos listam itens com dias em vermelho/amarelo
7. Cards de eixo destacam contagens problemáticas em error/warning

### Navegação
1. Click em alert → vai para subpath do módulo afetado
2. Click em "ver timeline completa →" → /timeline
3. Click em próximo vencimento → vai para subpath relevante
4. Click em evento recente → idem
5. Click em card de eixo → vai para módulo

### Mobile (V40 já cobriu KpiGrid)
1. KPIs ficam em 2 colunas (2x2 em vez de 1x4)
2. Layout 2-col (vencimentos + atividade) empilha em 1-col
3. Grid de 8 eixos: 2-col em sm, 4-col em lg
4. Touch targets adequados em alerts e linhas

## Status do projeto

| Versão | Tema | Mig | Bundle main |
|---|---|---|---:|
| V30-V38 | Lei 14.133 (9 institutos) | 036-044 | 75-80 |
| V39 | Timeline unificada | 045 | 80.43 |
| V40 | Mobile audit V30-V39 | — | 80.47 |
| **V41** | **Dashboard agregado** | **046** | **80.94** |

12 versões consecutivas. Bundle main: 75.13 → 80.94 = **+5.81 KB gzip** para cobertura legal completa + 2 visões consolidadas + mobile coverage. Margem ainda confortável: **69.1 KB** até o limite de 150 KB.

## Próximas oportunidades (V42+)

Com Dashboard fechado, próximos passos lógicos:

1. **Timeline global do tenant** — todos contratos em uma feed pra gerência sênior monitorar portfólio. Reusa view V39, agrega por tenant
2. **Dashboard global do tenant** — versão "carteira de contratos" do V41 (alertas agregados, valor total da carteira, etc)
3. **Export de timeline em PDF** — arquivo legal completo de um contrato
4. **Cadastro de fornecedores sancionados** — view global cruzando contratos
5. **API keys + REST público** — superfície de entrada externa
6. **OKLCH migration** — DS Tier 3 (oferecida 16 vezes desde V14)
7. **EF download FGV/IBGE** — automatiza CSV import V31

**Recomendação V42**: **Dashboard global do tenant** — mesma lógica do V41 mas agregando todos os contratos do tenant. Gerentes seniores veem "carteira inteira" em vez de 1 contrato. Reutiliza estrutura de RPC + UI do V41.
