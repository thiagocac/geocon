# V34 — Reequilíbrio econômico-financeiro (Lei 14.133 art. 124)

V34 completa o tripé de ajustes contratuais previstos na Lei 14.133, introduzindo o reequilíbrio econômico-financeiro — figura aplicada a eventos extraordinários, imprevisíveis ou de consequência incalculável que afetem a equação econômica do contrato.

## Tripé completo

| Instituto | Drive | Natureza | Implementação |
|---|---|---|---|
| Reajuste (art. 25/92/124-127) | Índice externo | Automático, periódico | V30-V32 |
| Repactuação (art. 135) | CCT/convenção | Item-a-item, calculado | V33 |
| **Reequilíbrio (art. 124)** | **Evento extraordinário** | **Análise técnica + decisão** | **V34** |

## Workflow completo (migration 040)

```
rascunho → em_analise_tecnica → em_aprovacao → aprovado → aplicado
                                              ↘ recusado
* → cancelado (em qualquer etapa antes de aplicado)
```

Validações por transição (gates):

| Transição | RPC | Quem pode | Validação |
|---|---|---|---|
| rascunho → em_analise_tecnica | `submit_reequilibrio_request` | criador, admin, gestor, fiscal | — |
| em_analise_tecnica → em_aprovacao | `complete_technical_analysis` | fiscal ou admin | parecer ≥ 50 chars |
| em_aprovacao → aprovado/recusado | `decide_reequilibrio` | admin ou gestor_contrato | motivação ≥ 20 chars |
| aprovado → aplicado | `apply_reequilibrio` | admin ou gestor_contrato | additive_id opcional |
| qualquer → cancelado | `cancel_reequilibrio` | admin, gestor, fiscal | nenhum se válido |

Cada RPC verifica role + status atual antes de transicionar. Updates são via RPC (não direto na tabela), garantindo trilha de auditoria.

## Schema

Tabela única `contract_reequilibrio_requests` (~30 colunas) contém todo o ciclo de vida em formato denormalizado pra simplificar consultas:

- **Caracterização**: tipo_evento, data_evento, descricao (≥30 chars), fundamentacao_legal
- **Pleito**: impacto_tipo, valor_solicitado, prazo_solicitado_dias
- **Análise**: parecer_tecnico, analise_at, analista_id
- **Decisão**: decisao_motivacao, valor_aprovado, prazo_aprovado_dias, decided_at, decided_by
- **Aplicação**: applied_at, applied_by, applied_via_additive_id (FK ON DELETE SET NULL), application_notes

`UNIQUE (contract_id, numero)` + helper `next_reequilibrio_numero(contract_id)` para numeração sequencial por contrato.

RLS: select por tenant; insert/update por admin, gestor_contrato ou fiscal. Cancelamento preserva audit via `metadata.cancel_reason/cancelled_at/cancelled_by`.

## RPCs (9 total)

| RPC | Função |
|---|---|
| `next_reequilibrio_numero(contract_id)` | helper · numeração sequencial |
| `create_reequilibrio_request(...)` | inicia em rascunho |
| `submit_reequilibrio_request(id)` | rascunho → em_analise_tecnica |
| `complete_technical_analysis(id, parecer)` | em_analise_tecnica → em_aprovacao |
| `decide_reequilibrio(id, aprovar, motivacao, valor?, prazo?)` | em_aprovacao → aprovado/recusado |
| `apply_reequilibrio(id, additive_id?, notes?)` | aprovado → aplicado, com link opcional pra additive formal |
| `cancel_reequilibrio(id, motivo)` | qualquer pré-aplicado → cancelado |
| `list_contract_reequilibrios(contract_id)` | listagem com JOIN em members + additives |
| `get_reequilibrio_detail(id)` | jsonb completo com todos os nomes resolvidos |
| `get_contract_reequilibrio_summary(contract_id)` | KPIs (total, open, aplicado, recusado, valor_aprovado_total) |

## UI `/contratos/:id/reequilibrios`

**4 KPIs**: total · em andamento · aplicados · valor aprovado total

**Tabela com linha clicável**:
- # numero · evento (tipo + descrição truncada) · data evento · status badge · impacto · solicitado · aprovado · badge Adt# se aplicado via aditivo

**Modal "Nova solicitação"** (criação em rascunho):
- Tipo de evento (Select com 7 opções da lei: alta_insumo, baixa_insumo, fato_principe, caso_fortuito, forca_maior, alea_economica, outro)
- Data do evento
- Descrição (mínimo 30 chars, com contador)
- Tipo de impacto (valor_aumento, valor_reducao, prazo, misto)
- Valor solicitado (R$) e/ou prazo adicional (dias) — só aparecem se o tipo de impacto exige

**Modal "Detalhe"** (workflow em uma única tela):
- Header com status + fundamentação legal
- Action buttons contextuais (mostra só o que cabe no status atual + role do usuário)
- Cards de informação: evento, impacto pleiteado, descrição
- Cards condicionais: parecer técnico (se analisado), decisão (verde se aprovado, vermelho se recusado, com valor/prazo aprovados em chips), aplicação (com link pra aditivo se vinculado)
- Action panels inline: análise técnica · decisão (aprovar/recusar com valor e prazo) · aplicar (com additive_id opcional) · cancelar (com motivo)

Cada action panel valida client-side antes de habilitar o botão, e o backend re-valida pra defesa em profundidade.

## Card no ContractDetail

Adicionado entre "Repactuações" e "Itens não previstos". Ícone `AlertOctagon`, subtitle "Evento extraordinário, art. 124".

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ módulos OK · 10.54s
```

**Bundle**:
- Main: 76.17 → **76.91 KB gzip** (+0.74 KB)
- ContractReequilibrios (lazy novo): **5.29 KB gzip**
- Margem até 150 KB: **73.1 KB**

## Diff V33 → V34

- **+1 migration** (040 contract_reequilibrio ~430L · 9 RPCs)
- **+1 página** (ContractReequilibrios — list + new modal + detail modal com workflow inline)
- **+1 card no ContractDetail**
- **+1 rota** (`/contratos/:id/reequilibrios`)
- **api.ts**: 9 wrappers + 5 types + 4 enums/labels + helper `reequilibrioStatusTone`

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only   # 040
```

Sem EFs, sem cron, sem deps externas.

## Como testar (acceptance)

### Fluxo completo
1. Como fiscal: `/contratos/:id/reequilibrios` → "Nova solicitação"
2. Tipo: "Alta abrupta de insumo" · data: 2025-04-15 · descrição: "Aço CA-50 subiu 42% conforme planilha SINAPI 04/2025…" (≥30 chars) · impacto: valor_aumento · valor: 350000
3. Cria em rascunho · feedback de sucesso
4. Clica na linha → modal de detalhe abre · status=rascunho · botão "Submeter à análise"
5. Submete → status vira `em_analise_tecnica`
6. Como admin: action panel "Concluir análise" → preenche parecer técnico (≥50 chars) → submete
7. Status vira `em_aprovacao` · card "Parecer técnico" aparece
8. Como gestor: action panel "Decidir" → aprovar · valor 280000 (menor que solicitado) · prazo 0 · motivação ≥20 chars
9. Status vira `aprovado` · card "Decisão · Aprovado" aparece com chip "Valor aprovado: R$ 280.000,00"
10. Action "Marcar como aplicado" → cola UUID de um aditivo formal existente → notas
11. Status vira `aplicado` · card "Aplicado" aparece · badge "Adt#N" na linha da listagem

### Validações
- Descrição <30 chars: bloqueado client-side
- Parecer <50 chars: bloqueado server-side (RPC raise)
- Motivação <20 chars: bloqueado server-side
- Tentar decidir sem ter analisado: RPC raise "não está em aprovação"
- Tentar aplicar sem ter aprovado: RPC raise
- Tentar cancelar aplicado: RPC raise
- Fiscal tenta decidir: RPC raise (apenas admin/gestor_contrato)

### Permissões
| Ação | Admin | Gestor contrato | Fiscal | Outros |
|---|---|---|---|---|
| Criar | ✅ | ✅ | ✅ | ❌ |
| Submeter | ✅ | ✅ | ✅ | ❌ |
| Analisar | ✅ | ❌ | ✅ | ❌ |
| Decidir | ✅ | ✅ | ❌ | ❌ |
| Aplicar | ✅ | ✅ | ❌ | ❌ |
| Cancelar | ✅ | ✅ | ✅ | ❌ |

## Status Lei 14.133

| Instituto | Status |
|---|---|
| Reajuste (art. 25/92/124-127) | ✅ V30-V32 |
| Aditivo (art. 125) | ✅ schema 001 |
| Itens não previstos | ✅ schema 001 |
| Repactuação (art. 135) | ✅ V33 |
| **Reequilíbrio (art. 124)** | **✅ V34** |
| Recebimento (art. 140) | ⬜ |
| Garantias (art. 96-101) | ⬜ |

## Próximas oportunidades (V35+)

**Sequência natural — fechar o ciclo Lei 14.133**:
- **Recebimento provisório/definitivo** (art. 140) — termo de aceitação, vícios, prazo de garantia, vinculado a contrato e medições
- **Garantias contratuais** (art. 96-101) — caução, seguro-garantia, fiança bancária; controle de vigência, devolução e execução de garantia

**Infraestrutura adjacente**:
- **Mobile audit V30-V34** — 5 páginas novas não auditadas em mobile
- **API keys + REST público** — superfície de entrada
- **OKLCH migration** — DS Tier 3 (pendência V14)
- **EF download FGV/IBGE** — automatiza V31 CSV import
- **Comparativo cronológico Reajuste×Repactuação×Reequilíbrio×Aditivos** — view unificada de todos ajustes na ordem cronológica, util pra auditoria
