# V35 — Recebimento provisório e definitivo (Lei 14.133 art. 140)

V35 introduz o ciclo de aceitação formal da obra, fechando uma das peças mais importantes do "pós-execução" no domínio de gestão de contratos.

## Estrutura legal coberta

| Termo | Quem emite | Prazo | Função |
|---|---|---|---|
| **Provisório** (art. 140 I "a") | Fiscal técnico | Até 15 dias após comunicação escrita do contratado | Verificação inicial da execução |
| **Definitivo** (art. 140 I "b") | Comissão designada ou servidor responsável | Até 90 dias após o provisório | Atesta adequação aos termos contratuais; **dispara prazo de garantia** |

Cada termo pode listar **vícios** (defeitos detectados) com:
- Severidade (baixa/media/alta/critica)
- Prazo de saneamento (default 30 dias, computado como data_limite_saneamento = registro + N dias)
- Status (aberto / em_saneamento / sanado / aceito_residual / cancelado)

## Regras de negócio críticas

1. **Definitivo exige provisório precedente sem vícios abertos**: a RPC `create_receipt` valida `provisorio_id` está em status `emitido` ou `sanado`, E que tem 0 vícios em `aberto`/`em_saneamento`. Sem isso, raise: "Provisório vinculado tem N vícios não-sanados".

2. **Transição automática para com_pendencias**: ao adicionar vício a um termo já `emitido`, status muda automaticamente para `com_pendencias`. Ao resolver o último vício aberto, volta para `sanado`.

3. **Cancelamento de provisório bloqueado se há definitivo vinculado**: `cancel_receipt` raise se o provisório tem definitivo emitido/sanado/com_pendencias apontando para ele.

4. **Garantia inicia na emissão do definitivo**: se admin informar `prazo_garantia_meses` (1-120), o sistema computa `garantia_inicio = data_emissao` e `garantia_fim = data_emissao + meses`. Sem isso, garantia formal não é registrada.

5. **Prazo de 90 dias para definitivo**: ao emitir provisório, `data_limite_definitivo = data_emissao + 90 dias` é computado automaticamente. UI destaca esse marco em todas as visões.

## Schema (migration 041)

### `contract_receipts`
30 colunas cobrindo tipo, status, datas chave (comunicação, emissão, limite definitivo), vínculo com provisório, vínculos opcionais com medições (para escopo do termo), prazo de garantia e suas datas, audit. `UNIQUE (contract_id, tipo, numero)` + helper `next_receipt_numero(contract_id, tipo)`.

### `contract_receipt_vicios`
1 row por defeito identificado. Campos: ordem, severidade, descricao (≥20 chars), local_referencia, prazo_saneamento_dias, data_limite_saneamento, status, evidencia_saneamento, audit. Index parcial em `data_limite_saneamento WHERE status IN ('aberto','em_saneamento')` para futuras consultas de pendências vencendo.

### RLS
Read: tenant scope. Write: admin, gestor_contrato ou fiscal.

## RPCs (8 total)

| RPC | Função |
|---|---|
| `next_receipt_numero(contract_id, tipo)` | Numeração sequencial por contrato+tipo |
| `create_receipt(...)` | Cria rascunho. Valida provisório precedente se tipo=definitivo |
| `emit_receipt(id, data, parecer, prazo_garantia_meses)` | rascunho → emitido. Computa limite_definitivo (provisorio) ou garantia (definitivo) |
| `add_receipt_vicio(...)` | Registra vício. Auto-promove status do termo para com_pendencias |
| `resolve_vicio(id, novo_status, evidencia)` | sanado / aceito_residual / cancelado. Se zerou vícios abertos no termo, termo volta a sanado |
| `cancel_receipt(id, motivo)` | Cancela termo. Bloqueia se provisório tem definitivo vinculado emitido |
| `list_contract_receipts(contract_id)` | Listagem com JOIN em members + count de vícios |
| `list_receipt_vicios(receipt_id)` | Vícios de um termo |
| `get_contract_receipts_summary(contract_id)` | KPIs: provisorios/definitivos emitidos, vícios abertos, garantia ativa e dias restantes |

## UI `/contratos/:id/recebimentos`

**4 KPIs**: provisórios emitidos · definitivos emitidos · vícios abertos · garantia (ativa/vencida/vazia, com dias restantes quando ativa)

**Tabela expansível**:
- Linhas com chevron clicável para mostrar vícios
- Colunas: tipo+numero, status badge, data emissão, limite definitivo, vícios (abertos/total), garantia, ações
- Linha expandida: cards individuais por vício com severidade badge, descrição, prazo, evidência de saneamento, e botões inline para "Marcar como sanado" ou "Aceitar como residual"

**Modal "Novo termo"**:
- Select tipo (provisorio/definitivo)
- Se provisório: campo data_comunicacao
- Se definitivo: Select com provisórios elegíveis (apenas os em status emitido/sanado + sem vícios abertos). Mostra aviso âmbar se nenhum disponível.

**Modal "Emitir"**:
- Data de emissão (default hoje)
- Parecer técnico (opcional)
- Para definitivos: prazo de garantia em meses (0-120)
- Para provisórios: nota informativa "prazo de 90 dias para definitivo será computado"

**Modal "Adicionar vício"**:
- Descrição (≥20 chars com contador)
- Severidade (4 opções)
- Prazo de saneamento (dias)
- Localização (opcional)

## Card no ContractDetail

Adicionado entre "Reequilíbrios" e "Itens não previstos". Ícone `FileCheck`, subtitle "Provisório, definitivo, vícios, garantia".

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ módulos OK · 11.38s
```

**Bundle**:
- Main: 76.91 → **77.59 KB gzip** (+0.68 KB)
- ContractReceipts (lazy novo): **5.10 KB gzip**
- Margem até 150 KB: **72.4 KB**

## Diff V34 → V35

- **+1 migration** (041 contract_receipts ~600L · 8 RPCs)
- **+1 página** (ContractReceipts — list expansível + 3 modals + actions inline)
- **+1 card no ContractDetail**
- **+1 rota** (`/contratos/:id/recebimentos`)
- **api.ts**: 8 wrappers + 5 types + 4 enums/labels + 2 helpers de tone

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only   # 041
```

Sem EFs, sem cron, sem deps externas.

## Como testar (acceptance)

### Fluxo completo provisório → definitivo
1. Como fiscal: `/contratos/:id/recebimentos` → "Novo termo"
2. Tipo provisório · data_comunicacao 2025-05-01 · "Criar em rascunho"
3. Termo aparece como Provisório #1 status=rascunho
4. Ação Send (✉️) → modal Emitir → data 2025-05-10 · parecer "Verificação de conformidade ok"
5. Status vira `emitido` · limite definitivo = 2025-08-08 (90 dias depois)
6. Ação ClipboardList → modal "Novo vício" → descrição ≥20 chars · severidade alta · prazo 15 dias
7. Status do termo muda automaticamente para `com_pendencias` · contador "1/1"
8. Expandir linha → card do vício com botões "sanado" e "aceito residual"
9. Click "sanado" → prompt evidência → vício vira sanado, contador vira "0/1", termo volta a `sanado`
10. Agora "Novo termo" → tipo definitivo → Select de provisórios mostra o #1 elegível (era bloqueado antes)
11. Selecionar → criar rascunho · emitir com prazo_garantia_meses=12
12. KPI "Garantia" vira "Ativa · até 2026-05-10 · 365d"

### Bloqueios
1. Criar definitivo sem provisório → erro
2. Provisório com vícios abertos → não aparece na lista de elegíveis
3. Cancelar provisório com definitivo emitido → RPC raise
4. Adicionar vício a termo cancelado → RPC raise

### Permissões
| Ação | Admin | Gestor contrato | Fiscal | Outros |
|---|---|---|---|---|
| Criar / emitir | ✅ | ✅ | ✅ | ❌ |
| Adicionar vício | ✅ | ✅ | ✅ | ❌ |
| Resolver vício | ✅ | ✅ | ✅ | ❌ |
| Cancelar termo | ✅ | ✅ | ✅ | ❌ |

## Status Lei 14.133

| Instituto | Status |
|---|---|
| Reajuste (art. 25/92/124-127) | ✅ V30-V32 |
| Aditivo (art. 125) | ✅ schema 001 |
| Itens não previstos | ✅ schema 001 |
| Repactuação (art. 135) | ✅ V33 |
| Reequilíbrio (art. 124) | ✅ V34 |
| **Recebimento (art. 140)** | **✅ V35** |
| Garantias contratuais (art. 96-101) | ⬜ |
| Sanções (art. 156) | ⬜ |
| Apuração administrativa (art. 158) | ⬜ |

## Próximas oportunidades (V36+)

**Lei 14.133 — fechando o conjunto**:
- **Garantias contratuais** (art. 96-101) — caução, seguro-garantia, fiança bancária; vigência, devolução, execução, vinculação com aditivos de prazo
- **Sanções e impedimentos** (art. 156) — advertência, multa, impedimento de licitar, declaração de inidoneidade; vinculação com aditivos e medições
- **Apuração administrativa** (art. 158) — instauração de PAR, defesa, decisão, recursos

**Visões consolidadas**:
- **Timeline cronológica** — reajuste + repactuação + reequilíbrio + aditivos + recebimentos numa só view em ordem temporal
- **Dashboard de garantia ativa** — quais contratos têm garantia vigente, quanto tempo falta, quais vícios pendentes

**Infraestrutura adjacente**:
- **Mobile audit V30-V35** — 6 páginas novas não auditadas em mobile
- **API keys + REST público** — superfície de entrada
- **OKLCH migration** — DS Tier 3 (pendência V14)
