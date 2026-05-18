# V38 — Sanções e impedimentos (Lei 14.133 art. 156)

**🎉 V38 fecha 100% da cobertura da Lei 14.133 no GeoCon.** Após 9 versões consecutivas dedicadas (V30-V38), todos os institutos legais previstos para gestão pós-assinatura estão implementados.

## Quatro tipos de sanção

| Tipo | Gravidade | Duração | Cap legal | Exige PAR procedente |
|---|---|---|---|---|
| **Advertência** (art. 156 I) | Leve | — | — | ❌ |
| **Multa** (art. 156 II) | Média | — | — | ❌ (mas usual após PAR) |
| **Impedimento de licitar** (art. 156 III) | Grave | até 3 anos | 36 meses | ✅ obrigatório |
| **Declaração de inidoneidade** (art. 156 IV) | Gravíssima | até 6 anos | 72 meses | ✅ obrigatório |

## Regras de negócio críticas (migration 044)

### 1. PAR procedente obrigatório para tipos graves

`register_sanction` valida:
- Se tipo é impedimento ou inidoneidade, `par_id` é obrigatório
- O PAR informado precisa pertencer **ao mesmo contrato**
- A decisão do PAR precisa ser `procedente` ou `parcialmente_procedente`

Sem isso, raise específica citando art. 158.

### 2. Caps legais aplicados em CHECK constraints + RPC

Tabela tem CHECK que limita:
- Impedimento: `vigencia_fim <= vigencia_inicio + 3 years`
- Inidoneidade: `vigencia_fim <= vigencia_inicio + 6 years`

RPC também valida `duracao_meses` antes de inserir, dando mensagem amigável que cita o §4º ou §5º.

### 3. Multa: duas formas de cálculo

```
valor_multa = base_calculo × (percentual / 100)
   OU
valor_multa = informado direto
```

Wrapper aceita os dois modos; UI tem radio para alternar. CHECK garante que multa sempre tem `valor_multa > 0`.

### 4. Status com transições claras

```
ativa → cumprida (multa paga / vigência cumprida / advertência registrada)
      → suspensa (decisão judicial ou administrativa) → ativa (reativação)
      → revogada (provimento de recurso, anulação) — efeito retroativo
```

`revoke_sanction` exige **admin** (não basta gestor) — revogação tem efeito retroativo.

## Schema

### `contract_sanctions` (tabela principal · 25 colunas)

Campos por tipo:
- **Sempre**: tipo, status, data_aplicacao, documento_aplicacao, autoridade_aplicadora_id, fundamentacao (≥30 chars)
- **Multa**: base_calculo, percentual_multa, valor_multa, data_vencimento_multa, data_pagamento_multa
- **Impedimento/inidoneidade**: vigencia_inicio, vigencia_fim, duracao_meses (computado)
- **Tipos graves**: par_id (FK ON DELETE RESTRICT)

5 CHECK constraints garantem coerência entre tipo e campos preenchidos.

Index parcial otimizado:
- `idx_sanctions_vigencia WHERE status = 'ativa' AND vigencia_fim IS NOT NULL` — para queries de vencimento
- `idx_sanctions_par WHERE par_id IS NOT NULL` — para reverse lookup PAR → sanções

### `contract_sanction_events` (audit trail)

1 row por transição com tipo (6 valores: aplicacao, pagamento_multa, suspensao, reativacao, revogacao, cumprimento), status_anterior/novo, descricao, applied_by, metadata.

### RLS

- Read: tenant scope
- Write: admin OR gestor_contrato
- Revogação (`revoke_sanction`): **admin apenas** (validação na RPC, além da RLS)

## RPCs (9)

| RPC | Função |
|---|---|
| `next_sanction_numero(contract_id)` | Helper de numeração |
| `register_sanction(...)` | Aplica sanção · valida par_id, caps, calcula multa, gera event 'aplicacao' |
| `register_multa_payment(id, data, obs)` | Multa: data_pagamento + status=cumprida |
| `suspend_sanction(id, motivacao≥20)` | ativa → suspensa |
| `reactivate_sanction(id, motivacao≥20)` | suspensa → ativa |
| `revoke_sanction(id, motivacao≥30)` | apenas admin · qualquer → revogada · efeito retroativo |
| `mark_sanction_fulfilled(id)` | impedimento/inidoneidade/advertência → cumprida |
| `list_contract_sanctions(contract_id)` | Listagem com JOIN em PAR + computa dias_para_vencimento |
| `list_sanction_events(sanction_id)` | Audit timeline |
| `get_contract_sanctions_summary(contract_id)` | KPIs detalhados |

## View + cron

### `v_sancoes_vigentes`

Filtrada para impedimento/inidoneidade ativas vencendo nos próximos **60 dias** (período maior que garantias V36 porque sanções graves precisam de planejamento maior).

### `notify_sanction_expiring()` + pg_cron

- Roda dia 1 de cada mês às 9h UTC (frequência menor que garantias porque sanções não precisam ser renovadas, só monitoradas)
- Notifica admins + gestor_contrato
- Cooldown de **21 dias** por admin
- Body com top-5 sanções vencendo

## UI `/contratos/:id/sancoes`

**4 KPIs**:
1. Total / ativas (com breakdown A/M/I/IN)
2. Multas aplicadas (valor total)
3. Pagas / pendentes
4. Próximo vencimento (#numero · tipo · dias · cor por urgência)

**Tabela com linha expansível**:
- # · Tipo badge · Status badge · Aplicação · PAR vinculado · Valor (multa) ou Vigência (graves) · Vencimento com cor
- Linha expandida mostra fundamentação + timeline completa

**Modal "Aplicar sanção"** — lógica condicional por tipo:
- **Advertência**: só fundamentação + documento
- **Multa**: radio "Base × Percentual" vs "Valor direto"; preview calculado client-side; data de vencimento opcional
- **Impedimento/Inidoneidade**:
  - Aviso âmbar "exige PAR procedente"
  - Select com PARs procedentes do contrato (filtrado client-side)
  - Vigência início + duração em meses (com limite máx exibido)

**Action buttons inline** contextualizados:
- 💰 Pagar (DollarSign · verde) — só multa ativa sem pagamento
- ✓ Cumprida (CheckCircle2 · verde) — impedimento/inidoneidade/advertência ativas
- ⏸ Suspender (Pause · amarelo) — ativa
- ▶ Reativar (Play · azul) — suspensa
- 🚫 Revogar (ShieldOff · vermelho · só admin) — ativa/suspensa

**Modal de ação unificado** com:
- Resumo da sanção
- Campos condicionais por tipo de ação (data+obs para pay, motivação para outros)
- minMotivacao=20 para suspend/reactivate, 30 para revoke
- Warning vermelho em revoke citando efeito retroativo

## Card no ContractDetail

Adicionado entre "Apuração administrativa" e "Itens não previstos". Ícone `Hammer`, subtitle "Advertência, multa, impedimento · art. 156".

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ módulos OK · 10.49s
```

**Bundle**:
- Main: 79.43 → **80.03 KB gzip** (+0.60 KB)
- ContractSanctions (lazy novo): **5.99 KB gzip**
- Margem até 150 KB: **70.0 KB**

## Diff V37 → V38

- **+1 migration** (044 contract_sanctions ~700L · 9 RPCs · 1 view · 1 cron)
- **+1 página** (ContractSanctions · 700L · listagem expansível + 2 modals com lógica por tipo)
- **+1 card no ContractDetail**
- **+1 rota** (`/contratos/:id/sancoes`)
- **api.ts**: 9 wrappers + 5 types + 4 enums/labels + 3 helpers utilitários

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only   # 044
```

## Como testar (acceptance)

### Aplicação por tipo

**Advertência** (mais simples):
1. Como gestor: `/contratos/:id/sancoes` → "Aplicar sanção"
2. Tipo: advertência · fundamentação ≥30 chars
3. Submit → sanção ativa, event 'aplicacao' no histórico
4. Action ✓ → status vira `cumprida` (advertência não tem vigência)

**Multa com cálculo**:
1. Tipo: multa · radio "Base × Percentual"
2. Base R$ 1.000.000 · percentual 10
3. Preview client-side: "Multa calculada = R$ 100.000,00"
4. Submit → sanção ativa, valor_multa = R$ 100.000
5. Action 💰 → data pagamento + observações → status vira `cumprida`

**Impedimento sem PAR procedente**:
1. Tipo: impedimento
2. Aviso âmbar aparece
3. Tenta aplicar sem selecionar PAR → erro client-side
4. Se contrato não tem PAR procedente, vê aviso vermelho "Nenhum PAR procedente disponível"

**Impedimento com PAR procedente**:
1. (Pré-V37) PAR #1 decidido como procedente
2. Tipo: impedimento · Select mostra "PAR #1 · procedente"
3. Vigência início 2025-06-01 · duração 24 meses (cap=36)
4. Submit → sanção ativa · vigencia_fim = 2027-06-01 automaticamente
5. Tabela mostra "24m · 2025-06-01 → 2027-06-01" e dias restantes

**Cap legal**:
1. Inidoneidade · duração 80 meses (cap=72)
2. RPC raise: "inidoneidade não pode exceder 72 meses (cap legal art. 156 §5º)"

**Revogação**:
1. Sanção ativa
2. Action 🚫 (apenas admin)
3. Motivação ≥30 chars · warning aparece sobre efeito retroativo
4. Submit → status vira `revogada`

### Permissões

| Ação | Admin | Gestor contrato | Outros |
|---|---|---|---|
| Aplicar | ✅ | ✅ | ❌ |
| Pagamento de multa | ✅ | ✅ | ❌ |
| Suspender/Reativar | ✅ | ✅ | ❌ |
| Marcar cumprida | ✅ | ✅ | ❌ |
| **Revogar** | ✅ | ❌ | ❌ |

## 🏁 Status Lei 14.133 — 100% COMPLETO

| # | Instituto | Artigo | Versão |
|---|---|---|---|
| 1 | Reajuste | art. 25/92/124-127 | V30-V32 ✅ |
| 2 | Aditivo | art. 125 | schema 001 ✅ |
| 3 | Itens não previstos | art. 125 | schema 001 ✅ |
| 4 | Repactuação | art. 135 | V33 ✅ |
| 5 | Reequilíbrio | art. 124 | V34 ✅ |
| 6 | Recebimento provisório/definitivo | art. 140 | V35 ✅ |
| 7 | Garantias contratuais | art. 96-101 | V36 ✅ |
| 8 | Apuração administrativa (PAR) | art. 158 | V37 ✅ |
| 9 | **Sanções e impedimentos** | **art. 156** | **V38 ✅** |

## Retrospectiva V30 → V38 (9 versões · ~3000 LOC SQL + 5000 LOC TSX)

| Versão | Tema | Migration | Bundle main (gzip) | Δ |
|---|---|---|---|---|
| V30 | Reajuste · cálculo + índices | 036 | 75.13 | base |
| V31 | Reajuste · aditivo + CSV + cron | 037 | 75.66 | +0.53 |
| V32 | Reajuste · bulk apply | 038 | 75.86 | +0.20 |
| V33 | Repactuação | 039 | 76.17 | +0.31 |
| V34 | Reequilíbrio | 040 | 76.91 | +0.74 |
| V35 | Recebimentos | 041 | 77.59 | +0.68 |
| V36 | Garantias | 042 | 78.39 | +0.80 |
| V37 | PAR / Apuração | 043 | 79.43 | +1.04 |
| **V38** | **Sanções** | **044** | **80.03** | **+0.60** |

**Bundle main cresceu apenas +4.90 KB gzip para cobrir 9 institutos legais.** Cada página é lazy-loaded (~5-6 KB cada), então o impacto no carregamento inicial é mínimo. 0 violações de typecheck em todas as 9 versões.

## Conexões cross-module finalizadas

- **Reajuste/Repactuação** → atualizam preço unitário ou geram aditivo
- **Reequilíbrio** → linka aditivo opcional via `applied_via_additive_id`
- **Recebimento** → liberação de garantia via `liberacao_recebimento_id`
- **Garantia** → estende vigência vinculada a `ultimo_aditivo_id`
- **PAR** → declara `sancao_proposta_tipos[]` que vira input do Sanctions
- **Sanção** → vincula PAR procedente via `par_id` para tipos graves

A teia legal está fechada. Qualquer contrato pode ser auditado do início ao fim com rastreabilidade legal completa.

## Próximas oportunidades (V39+)

Com Lei 14.133 100% concluída, novas direções abrem:

**Visões consolidadas (debt acumulado V30+)**:
1. **Timeline cronológica unificada** — todos os eventos (reajuste + repactuação + reequilíbrio + aditivos + recebimentos + garantias + PAR + sanções) em uma só view temporal por contrato
2. **Dashboard agregado por contrato** — visão executiva com status de cada eixo legal
3. **Cadastro de fornecedores sancionados** — view global cruzando todos os contratos, útil para próximas licitações

**Mobile audit (debt desde V32)**:
4. **Mobile audit V30-V38** — 9 páginas novas não auditadas em mobile (pedido recorrente)

**Infraestrutura adjacente**:
5. **API keys + REST público** — superfície de entrada externa
6. **EF download FGV/IBGE** — automatiza CSV import V31 com fetch direto
7. **OKLCH migration** — DS Tier 3 (oferecida 16 vezes desde V14)

**Reporting & exportação**:
8. **Relatórios consolidados** — PDF de processo administrativo completo (PAR + sanção) para arquivo legal
9. **Export de cadastros** — sanções vigentes em formato compatível com Cadastros Nacionais (CEIS, CNEP)
