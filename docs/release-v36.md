# V36 — Garantias contratuais (Lei 14.133 art. 96-101)

V36 introduz o ciclo completo de garantias contratuais, fechando uma das peças financeiras críticas da Lei 14.133 e conectando com os módulos de Recebimento (V35) e Aditivos.

## Modalidades cobertas (art. 96)

| Modalidade | Origem | Características |
|---|---|---|
| **Caução em dinheiro** | Depósito do contratado | Bloqueio de capital; rendimento revertido ao contratado na liberação |
| **Caução em títulos** | TDP (Títulos da Dívida Pública) | Renúncia ao rendimento durante a vigência |
| **Seguro-garantia** | Apólice de seguradora | ~0,5-1,5% do contrato; renovação anual típica |
| **Fiança bancária** | Banco/instituição financeira | ~2-3% ao ano; pode exigir reciprocidade |

## Percentuais legais (validados pelo sistema)

| Limite | Hipótese |
|---|---|
| **5%** | Padrão (art. 98 §1º) |
| **até 10%** | Obras de grande vulto |
| **até 30%** | Serviços de grande vulto com risco elevado (art. 99) |

RPC `register_guarantee` calcula `percentual_contrato = valor_garantido / contract.valor_total_atual * 100` e **rejeita registros > 30%** com mensagem específica citando o artigo.

## Schema (migration 042)

### `contract_guarantees` (tabela principal)

Campos chave:
- **Identificação**: numero (sequencial por contrato), modalidade, emissor (seguradora/banco), instrumento_numero (apólice), beneficiario
- **Valores**: valor_garantido (imutável) · valor_disponivel (movimenta via liberação/execução) · percentual_contrato (snapshot)
- **Vigência**: data_emissao · data_vigencia_inicio · data_vigencia_fim · CHECK fim ≥ início
- **Vínculos**: ultimo_aditivo_id (FK additives), liberacao_recebimento_id (FK contract_receipts)
- **Status** (8 valores): ativa · estendida · liberada_parcial · liberada_total · executada_parcial · executada_total · cancelada · vencida

Index parcial `WHERE status IN ('ativa','estendida')` em `data_vigencia_fim` otimiza alertas de vencimento.

### `contract_guarantee_events` (histórico)

1 row por movimentação com tipo (registro / extensao / liberacao / execucao / cancelamento / renovacao_valor), valor_movimentado, valor_disponivel_apos (snapshot), nova_vigencia_fim quando aplicável, aditivo_id e receipt_id opcionais, motivacao obrigatória, evidencia textual.

### RLS

- **Read**: tenant scope
- **Write**: admin, gestor_contrato OU **financeiro** (novo role autorizado neste módulo, exclusivo de garantias por enquanto)
- **Execução** (`execute_guarantee`): apenas admin ou gestor_contrato (financeiro vê mas não pode disparar)

## RPCs (8)

| RPC | Detalhes |
|---|---|
| `register_guarantee(...)` | Cria + event `registro`. Calcula percentual e valida 30% cap |
| `extend_guarantee(id, nova_fim, motivacao, aditivo_id?, evidencia?)` | Estende vigência. Motivação ≥10 chars. Status vai pra `estendida`. Vincula aditivo opcionalmente |
| `release_guarantee(id, valor, motivacao, receipt_id?, evidencia?)` | Liberação parcial/total. Valida receipt_id é definitivo emitido/sanado. Decrementa `valor_disponivel`. Auto-detecta `liberada_total` quando zera |
| `execute_guarantee(id, valor, motivacao, evidencia?)` | Execução por inadimplemento. Motivação ≥20 chars. Apenas admin/gestor_contrato |
| `cancel_guarantee(id, motivo)` | Cancela. Bloqueia se já está em estado final |
| `list_contract_guarantees(contract_id)` | Listagem com JOIN em additives + count de events |
| `list_guarantee_events(guarantee_id)` | Histórico ordenado ASC pra timeline |
| `get_contract_guarantees_summary(contract_id)` | KPIs: ativas, valor disponível, executado total, liberado total, próximo vencimento |

## View + cron de alertas

### `v_guarantees_vencendo`

Query simples filtrada por status ativo + vigência terminando nos próximos 30 dias.

### `notify_guarantee_due()` + pg_cron

- Roda dias 1 e 15 de cada mês às 9h UTC
- Notifica admins + role `financeiro` do tenant
- Cooldown de **14 dias** por admin (via `metadata.guarantee_due_alert`)
- Body lista top-5 garantias vencendo com `#numero · contrato · modalidade · dias restantes`

Consistente com o cron de reajuste (V31).

## UI `/contratos/:id/garantias`

**4 KPIs**:
- Garantias ativas / total
- Valor disponível (saldo agregado)
- Executado total / Liberado total (duas métricas lado-a-lado)
- Próximo vencimento (#numero · dias restantes · cor por urgência ≤30d vermelho, ≤60d amarelo)

**Tabela expansível** com 9 colunas (em mobile/tablet algumas se escondem):
- Chevron · # · Modalidade · Emissor · Status badge · Valor/Disponível/Percentual · Vigência início→fim · Vencimento (dias) · Actions

**Action buttons inline** (contextualizados por status + role):
- 📅 Estender vigência (Calendar icon · azul)
- 📉 Liberar (TrendingDown · verde)
- 💰 Executar (DollarSign · vermelho · apenas admin/gestor_contrato)
- ✕ Cancelar (XCircle · cinza)

**Linha expandida** mostra timeline cronológica de events com badges coloridos por tipo, valor movimentado, link pra aditivo/recebimento quando aplicável, motivação e evidência.

**Modal de ação único** (`GuaranteeActionModal`) com lógica unificada pelos 4 tipos:
- Resumo da garantia (sempre visível)
- Campos dinâmicos: novaVigencia (extend) · valor (release/execute) · motivação · evidência
- Validação client-side: minMotivacao=20 para execute (vs 10 para outros), valor ≤ disponível, nova vigência > atual
- Warning vermelho em execute citando exigência de contraditório e ampla defesa

## Card no ContractDetail

Adicionado entre "Recebimentos" e "Itens não previstos". Ícone `Shield`, subtitle "Caução, seguro, fiança · art. 96-101".

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ módulos OK · 9.98s
```

**Bundle**:
- Main: 77.59 → **78.39 KB gzip** (+0.80 KB)
- ContractGuarantees (lazy novo): **5.46 KB gzip**
- Margem até 150 KB: **71.6 KB**

## Diff V35 → V36

- **+1 migration** (042 contract_guarantees ~700L · 8 RPCs · 1 view · 1 cron job)
- **+1 página** (ContractGuarantees · 600L · 1 listagem expansível + 2 modals)
- **+1 card no ContractDetail**
- **+1 rota** (`/contratos/:id/garantias`)
- **api.ts**: 8 wrappers + 4 types + 4 enums/labels + 2 helpers de tone
- **Role `financeiro`** ganha permissões neste módulo (precedente pra futuras extensões financeiras)

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only   # 042
```

Pré-requisito pro cron: Supabase Pro com pg_cron + pg_net (já configurado desde V26 pra cron de webhooks).

## Como testar (acceptance)

### Registro com validação de %
1. Como gestor: `/contratos/:id/garantias` → "Registrar garantia"
2. Modalidade: seguro-garantia · valor R$ 50.000 (contrato R$ 1.000.000 = 5%)
3. Vigências 2025-05-16 → 2026-05-15 · Emissor "Seguradora XYZ" · Apólice "APL-2025-001"
4. Registrar → garantia #1 criada, status `ativa`, event `registro` no histórico
5. Tentar registrar 2ª garantia com R$ 400.000 (40%) → RPC raise "excede limite legal de 30%"

### Extensão vinculada a aditivo
1. Aditivo de prazo (existente) estendeu contrato em 90 dias
2. Action Calendar na garantia → modal Extender
3. Nova vigência 2026-08-15 · motivação "Aditivo nº 1 estendeu prazo do contrato em 90 dias"
4. Confirma → status vira `estendida` · event `extensao` no histórico

### Liberação após recebimento definitivo
1. (Pré-V35) Recebimento definitivo #1 emitido e sanado
2. Action TrendingDown → modal Liberar
3. Valor R$ 50.000 (total) · motivação "Recebimento definitivo #1 sanado, libera 100%"
4. Confirma → status vira `liberada_total` · valor_disponivel = 0

### Execução parcial
1. Garantia ativa com R$ 50.000 disponível
2. Action DollarSign → modal Executar (apenas admin/gestor)
3. Valor R$ 15.000 · motivação ≥20 chars "Inadimplemento na medição #5 conforme processo administrativo nº 2025/0123"
4. Confirma → status vira `executada_parcial` · valor_disponivel = R$ 35.000

### Cron de alerta
1. Garantia com vigência fim = today + 25 dias
2. `SELECT * FROM notify_guarantee_due()`
3. Cada admin/financeiro recebe notification kind=system com body listando a garantia
4. Re-executar imediatamente → admins já notificados são pulados (cooldown 14d)

### Permissões
| Ação | Admin | Gestor | Financeiro | Outros |
|---|---|---|---|---|
| Registrar | ✅ | ✅ | ✅ | ❌ |
| Estender | ✅ | ✅ | ✅ | ❌ |
| Liberar | ✅ | ✅ | ✅ | ❌ |
| **Executar** | ✅ | ✅ | ❌ | ❌ |
| Cancelar | ✅ | ✅ | ✅ | ❌ |

## Status Lei 14.133

| Instituto | Versão |
|---|---|
| Reajuste (art. 25/92/124-127) | V30-V32 |
| Aditivo (art. 125) | schema 001 |
| Itens não previstos | schema 001 |
| Repactuação (art. 135) | V33 |
| Reequilíbrio (art. 124) | V34 |
| Recebimento (art. 140) | V35 |
| **Garantias (art. 96-101)** | **V36** |
| Sanções (art. 156) | ⬜ |
| Apuração administrativa (art. 158) | ⬜ |

## Próximas oportunidades (V37+)

**Lei 14.133 — restam 2 institutos**:
1. **Sanções e impedimentos (art. 156)** — advertência, multa, impedimento, declaração de inidoneidade; vinculação com aditivos e medições
2. **Apuração administrativa (art. 158)** — PAR (Processo Administrativo de Responsabilização) com instauração, defesa, decisão, recursos

**Visões consolidadas (debt acumulado V30-V36)**:
3. **Timeline cronológica unificada** — reajuste + repactuação + reequilíbrio + aditivos + recebimentos + garantias numa só view temporal por contrato
4. **Dashboard agregado** — visão global de todos os contratos com garantia vencendo, vícios pendentes, reajustes devidos, recebimentos pendentes
5. **Mobile audit V30-V36** — 7 páginas novas não auditadas (pedido recorrente desde V32)

**Infraestrutura adjacente**:
6. **API keys + REST público** — superfície de entrada
7. **OKLCH migration** — DS Tier 3 (oferecida 14 vezes desde V14)

Recomendação V37: **Sanções e impedimentos** seguido por **Apuração administrativa** em V38 — completa o cobertura Lei 14.133 do GeoCon antes de pivotar pra visões consolidadas e mobile audit.
