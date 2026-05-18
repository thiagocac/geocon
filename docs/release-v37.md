# V37 — Apuração administrativa / PAR (Lei 14.133 art. 158)

V37 implementa o Processo Administrativo de Responsabilização (PAR), exigido como antecedente legal para aplicação de sanções graves (impedimento de licitar ou declaração de inidoneidade). É o módulo mais complexo do tripé sanção-PAR-recurso porque tem 4 etapas legais obrigatórias com gates de role distintos.

## Estrutura legal

| Etapa | Quem conduz | Prazo legal | Atos |
|---|---|---|---|
| **Instauração** | Autoridade competente (admin/gestor) | — | Designa comissão, formaliza acusação |
| **Defesa** | Contratado (representado por fiscal/admin) | **15 dias úteis** | Apresenta defesa escrita OU revelia |
| **Instrução** | Comissão (admin/gestor) | — | Parecer técnico fundamentado |
| **Decisão** | Autoridade superior (apenas admin) | — | Julga mérito; propõe sanções |
| **Recurso (opcional)** | Contratado | — | Interposição + julgamento |

## Workflow completo (9 status)

```
rascunho → instaurado → em_defesa → em_instrucao → em_julgamento
                                                 → decidido → arquivado
                                                            → em_recurso → arquivado
       * → cancelado (administrativo, em qualquer fase)
```

## Schema (migration 043)

### `contract_par_processes` (tabela principal · 40+ colunas)

Denormalizada propositalmente — toda fase do ciclo tem seu próprio bloco:

- **Caracterização**: tipo_infracao (9 opções), fato_descricao (≥50 chars), data_ocorrencia, fundamentacao_legal
- **Comissão**: designacao (portaria), members (jsonb array), autoridade_julgadora_id
- **Instauração**: instaurado_at, instaurado_por_id, instauracao_documento, defesa_prazo_dias, defesa_prazo_limite (computado = today + N)
- **Defesa**: defesa_apresentada_at, defesa_apresentada_por_id, defesa_resumo (≥30 chars OU marcação de revelia), defesa_documento
- **Instrução**: instrucao_concluida_at, instrucao_parecer (≥100 chars), instrucao_por_id
- **Decisão**: decisao_at, decisao_por_id, decisao_resultado (procedente/parcialmente_procedente/improcedente), decisao_motivacao (≥30 chars), sancao_proposta + sancao_proposta_tipos[] (advertencia/multa/impedimento/inidoneidade)
- **Recurso**: recurso_aberto_at, recurso_motivacao (≥30 chars), recurso_julgado_at, recurso_resultado (provido/parcialmente_provido/improvido), recurso_motivacao_julgamento
- **Vínculos**: jsonb `{additives:[], measurements:[], guarantees:[]}` para auditoria cross-module
- **Audit padrão**: created_by, timestamps, metadata

`UNIQUE (contract_id, numero)` + helper `next_par_numero`.

### `contract_par_steps` (audit trail)

1 row por transição com `step_type` (10 valores incluindo `defesa_revel`, `cancelamento`) + status_anterior/novo + descricao + applied_by + metadata. Permite reconstruir linha do tempo completa.

## RPCs (13 total)

| RPC | Transição | Quem |
|---|---|---|
| `next_par_numero` | helper | qualquer |
| `create_par_process` | → rascunho | admin/gestor/fiscal |
| `instaurate_par` | rascunho → em_defesa | admin/gestor |
| `register_par_defesa` | em_defesa → em_instrucao | admin/fiscal · suporta revelia |
| `conclude_par_instrucao` | em_instrucao → em_julgamento | admin/gestor (comissão) |
| `decide_par` | em_julgamento → decidido | **admin (autoridade julgadora)** |
| `open_par_recurso` | decidido → em_recurso | admin/fiscal |
| `judge_par_recurso` | em_recurso → arquivado | **admin (autoridade superior)** |
| `archive_par` | decidido → arquivado | admin (sem recurso) |
| `cancel_par` | qualquer → cancelado | admin/gestor/fiscal |
| `list_contract_pars` | listagem | qualquer membro |
| `get_par_detail` | detalhe jsonb resolvido | qualquer membro |
| `list_par_steps` | timeline | qualquer membro |
| `get_contract_pars_summary` | KPIs (total · em_andamento · procedentes · improcedentes · em_defesa · prazo_estourado) | qualquer membro |

**Validações críticas em cada RPC**:
- Sanção só pode ser proposta se decisão é procedente ou parcialmente procedente
- Tipos de sanção validados contra enum fechado
- Motivações com minímos progressivos (10 chars cancelamento, 30 decisão, 50 fatos, 100 parecer instrução) — refletem severidade do ato
- Status atual sempre validado antes de transição (defesa em profundidade)

## UI `/contratos/:id/processos-administrativos`

**4 KPIs**: Total/em andamento · Procedentes (vermelho) · Improcedentes (verde) · Em defesa + prazo estourado (alerta vermelho se > 0)

**Tabela clicável**: # numero · tipo infração · data ocorrência · status badge · prazo defesa (com flag vermelho se vencido) · resultado decisão (+recurso quando aplicável) · chevron

**Modal "Abrir novo PAR"**: tipo + data + descrição (≥50 chars com contador)

**Modal de detalhe** (XL · workflow inteiro em uma tela):
- Header com status badge + fundamentação legal + ações contextuais por role
- Cards de cada fase concluída (instauração · defesa · instrução · decisão · recurso · arquivamento) com timestamps e autores
- Sanções propostas exibidas como chips coloridos por gravidade (advertência cinza, multa amarela, impedimento/inidoneidade vermelho)
- Action panels inline para a próxima transição cabível
- Linha do tempo completa no final com todos os steps

**Action panels específicos**:
- **Instaurar**: designação comissão (≥5 chars) + documento opcional + prazo defesa
- **Defesa**: checkbox revelia (alterna interface) ou resumo (≥30 chars)
- **Instrução**: parecer (≥100 chars com contador)
- **Decisão**: radio resultado + motivação (≥30) + checkboxes de sanções (4 tipos) + descrição proposta · sanções somem se "improcedente"
- **Recurso**: motivação (≥30)
- **Julgar recurso**: radio resultado + motivação (≥30)
- **Cancelar**: motivo (≥10) com aviso de irreversibilidade após arquivado

## Card no ContractDetail

Adicionado entre "Garantias" e "Itens não previstos". Ícone `Gavel`, subtitle "PAR · art. 158".

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ módulos OK · 11.27s
```

**Bundle**:
- Main: 78.39 → **79.43 KB gzip** (+1.04 KB)
- ContractParProcesses (lazy novo): **5.84 KB gzip**
- Margem até 150 KB: **70.6 KB**

## Diff V36 → V37

- **+1 migration** (043 contract_par_processes ~750L · 13 RPCs · 2 tabelas)
- **+1 página** (ContractParProcesses · 700L · lista + 2 modals + 7 action panels)
- **+1 card no ContractDetail**
- **+1 rota** (`/contratos/:id/processos-administrativos`)
- **api.ts**: 13 wrappers + 8 types + 4 enums de labels + 3 helpers de tone

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only   # 043
```

Sem EFs, sem cron, sem deps externas.

## Como testar (acceptance)

### Fluxo completo procedente com recurso
1. Como fiscal: `/contratos/:id/processos-administrativos` → "Abrir PAR"
2. Tipo "inexecucao_parcial" · data 2025-04-20 · descrição ≥50 chars
3. Rascunho criado · timeline ganha entrada "criacao"
4. Click linha → modal detalhe
5. Como admin: action "Instaurar" → designação "Portaria 042/2025" · prazo 15 dias
6. Status `em_defesa` · prazo limite 2025-05-31 calculado
7. Action "Registrar defesa" → preenche resumo ≥30 chars
8. Status `em_instrucao` · card de defesa aparece
9. Action "Concluir instrução" → parecer ≥100 chars
10. Status `em_julgamento` · card de parecer aparece
11. Como admin: action "Decidir" → procedente · motivação ≥30 + multa + impedimento checados
12. Status `decidido` · card de decisão com chips de sanção
13. Action "Interpor recurso" → motivação
14. Status `em_recurso`
15. Action "Julgar recurso" → improvido · motivação
16. Status `arquivado` · card de recurso completo

### Validações
- Descrição <50 chars: bloqueado client + server
- Sanção em decisão improcedente: RPC raise
- Decidir sem ter instruído: RPC raise
- Recurso em PAR não decidido: RPC raise
- Revelia: checkbox alterna UI, defesa_resumo é marcado automaticamente

### Permissões
| Ação | Admin | Gestor contrato | Fiscal | Outros |
|---|---|---|---|---|
| Criar | ✅ | ✅ | ✅ | ❌ |
| Instaurar | ✅ | ✅ | ❌ | ❌ |
| Registrar defesa | ✅ | ❌ | ✅ | ❌ |
| Concluir instrução | ✅ | ✅ | ❌ | ❌ |
| **Decidir** | ✅ | ❌ | ❌ | ❌ |
| Interpor recurso | ✅ | ❌ | ✅ | ❌ |
| **Julgar recurso** | ✅ | ❌ | ❌ | ❌ |

## Status Lei 14.133

| Instituto | Versão |
|---|---|
| Reajuste (art. 25/92/124-127) | V30-V32 |
| Aditivo (art. 125) | schema 001 |
| Itens não previstos | schema 001 |
| Repactuação (art. 135) | V33 |
| Reequilíbrio (art. 124) | V34 |
| Recebimento (art. 140) | V35 |
| Garantias (art. 96-101) | V36 |
| **PAR / Apuração (art. 158)** | **V37** |
| Sanções (art. 156) | ⬜ |

**8 de 9 institutos cobertos.** Falta apenas Sanções (aplicação efetiva), que naturalmente é V38 — depende do PAR para validade legal das sanções graves.

## Próximas oportunidades (V38)

**Lei 14.133 — fechamento**:
1. **Sanções e impedimentos (art. 156)** — 4 tipos (advertência, multa, impedimento de licitar, declaração de inidoneidade), com cálculo de multa, prazos de impedimento, vinculação ao PAR procedente que originou a sanção. Inscrição em cadastro nacional.

**Visões consolidadas**:
2. **Timeline cronológica unificada** — todos os ajustes e processos contratuais em uma só view temporal
3. **Dashboard agregado por contrato** — visão executiva com status de cada eixo

**Infraestrutura adjacente (debt acumulado)**:
4. **Mobile audit V30-V37** — 8 páginas novas não auditadas
5. **API keys + REST público**
6. **OKLCH migration** — DS Tier 3 (oferecida 15 vezes desde V14)
