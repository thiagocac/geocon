# V33 — Repactuação contratual (Lei 14.133 art. 135)

V33 introduz **repactuação**, figura legal distinta de reajuste (V30-V32). Repactuação é exigida pra contratos de serviços contínuos com dedicação exclusiva de mão-de-obra: recalcula preços com base em variação REAL de custos (CCT/convenção coletiva), não em índice externo.

## Diferença reajuste × repactuação

| | Reajuste (V30-V32) | Repactuação (V33) |
|---|---|---|
| Base legal | Lei 14.133 art. 25/92/124-127 | Lei 14.133 art. 135 |
| Drive | Índice externo (IPCA/IGP-M) | CCT/convenção coletiva |
| Cálculo | `Vr = V0 × (Ifim/Iinicio)` | Item-a-item, baseado em planilha demonstrativa |
| Aplicabilidade | Contratos com preços fixos | Serviços contínuos com mão-de-obra |
| Efeito no banco | Audit em event; preços NÃO mudam | Audit em event + items; **preços atualizados** |
| Motivação | Variação automática | **Obrigatória, mínimo 10 chars (§2º)** |

## Schema (migration 039)

### `contract_repactuacao_events`
Snapshot agregado da operação:
```
id, tenant_id, contract_id, applied_at, applied_by,
reference_date,    -- data-base do CCT
cct_reference,     -- ex: "CCT 2025 SEAC-DF"
motivacao text NOT NULL,
delta_total, items_affected, value_before, value_after, variation_percent,
notes, metadata
```
RLS: read = tenant; write = admin OU gestor_contrato.

### `contract_repactuacao_items`
Snapshot por item alterado, link `event_id` + `item_id`:
```
preco_unitario_anterior, preco_unitario_novo,
delta_unitario, quantidade_referencia, delta_total_item
UNIQUE (event_id, item_id)
```

## RPCs (6)

| RPC | Uso |
|---|---|
| `list_repactuacao_candidates(contract_id)` | UI lista itens da SOV pra editar preços (non-title, active) |
| `simulate_repactuacao(contract_id, items[])` | Calcula impacto SEM aplicar; valida cada item + retorna agregado |
| `apply_repactuacao(...)` | Reusa simulate, cria event + items, **atualiza preco_unitario** de cada item afetado + grava `metadata.last_repactuacao_event_id` |
| `list_contract_repactuacoes(contract_id)` | Histórico (events agregados) |
| `get_repactuacao_event_items(event_id)` | Detalhe expandido de 1 event |
| `get_contract_repactuacao_summary(contract_id)` | KPIs single round-trip |

**Decisão de design crítica**: `apply_repactuacao` **atualiza** `contract_items.preco_unitario` direto. Medições futuras pegam o novo preço automaticamente sem alterar nada na lógica de cálculo. O audit completo fica em `_events` + `_items`.

Comparar com reajuste (V30): `apply_contract_reajuste` NÃO toca em valores; só registra event. Isso reflete a natureza dos dois institutos legais — reajuste é uniforme, repactuação é item-a-item.

## UI `/contratos/:id/repactuacoes`

**4 KPIs**:
- Valor atual (do contrato)
- Total repactuado (sum delta_total) + % sobre inicial
- Aplicações (count)
- Última repactuação (data + Δ)

**Histórico expansível**:
- Tabela com toggle ▶ por linha
- Linha mestre: data · CCT data-base · CCT ref · variação · Δ total · items count
- Linha expandida: motivação · valor antes→depois · tabela detalhada com 1 row por item alterado

**Editor (modal 2-step)**:

**Step 1 · editar preços**: tabela completa da SOV com input editável "Preço novo" por item. Cálculo de Δ em tempo real client-side (sem round-trip). Footer com total dos itens alterados. Botão "Revisar" desabilitado se 0 itens alterados.

**Step 2 · revisar e confirmar**: chama `simulate_repactuacao` server-side (validação completa), mostra card de resumo, exige preencher:
- Data-base de referência (CCT)
- Referência do CCT (opcional, texto livre)
- **Motivação obrigatória, mínimo 10 caracteres** — Lei 14.133 art. 135 §2º
- Observações (opcional)

Warning âmbar antes do botão Aplicar: "preços serão atualizados imediatamente; medições futuras usarão os novos preços".

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ módulos OK · 10.34s
```

**Bundle**:
- Main: 75.86 → **76.17 KB gzip** (+0.31 KB)
- ContractRepactuacoes (lazy novo): **4.77 KB gzip**
- Margem até 150 KB: **73.8 KB**

## Diff V32 → V33

- **+1 migration** (039 contract_repactuacao ~530L · 6 RPCs)
- **+1 página** (ContractRepactuacoes)
- **+1 card no ContractDetail** (Repactuações entre Reajustes e Itens não previstos)
- **+1 rota** (`/contratos/:id/repactuacoes`)
- **api.ts**: 6 wrappers + 7 types (RepactuacaoCandidate · RepactuacaoSimulationItem · RepactuacaoSimulation · ApplyRepactuacaoResult · RepactuacaoEvent · RepactuacaoEventItem · RepactuacaoSummary)

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only   # 039
```

Sem EFs novas, sem cron, sem deps externas.

## Como testar (acceptance)

### Contratualmente diferente de reajuste
1. `/contratos/:id/reajustes` → aplica reajuste IPCA → `valor_inicial` NÃO muda, soma de events.delta aparece em "Total reajustado"
2. `/contratos/:id/repactuacoes` → aplica repactuação → `contract_items.preco_unitario` DOS ITENS ALTERADOS mudam, próxima medição usa o novo preço

### Wizard step 1
1. Botão "Nova repactuação" abre editor
2. Tabela mostra TODOS os itens não-título do contrato
3. Inputs de "Preço novo" começam vazios
4. Digitar valor diferente do atual → linha vira fundo magenta-claro + Δ unitário + Δ total aparecem
5. Footer mostra "Total (N itens alterados): +R$ X,XX"
6. Botão "Revisar" mostra count + habilitado se ≥1 alterado

### Wizard step 2
1. Clica Revisar → simulação server-side → step muda pra "review"
2. Card de resumo: valor anterior/após, Δ, variação %, items_affected
3. Inputs de data-base + CCT (opcional) + motivação (obrigatória)
4. Tenta aplicar com motivação curta (<10 chars) → erro
5. Preenche motivação válida → "Aplicar repactuação" habilita
6. Aplica → notificação + modal fecha + histórico aparece + KPIs atualizam

### Impacto em medição
1. Itens com preço novo → criar nova medição depois da repactuação
2. Memória de cálculo usa `preco_unitario` atualizado
3. Valor da medição reflete novo preço

### Histórico expansível
1. Click numa row do histórico → chevron rotaciona + linha expande
2. Mostra motivação, valor antes→depois, observações
3. Tabela de items: 1 row por item alterado, com preço anterior, novo, variação %, Δ total
4. Second click colapsa

## Próximas oportunidades (V34+)

**Fechando ajustes contratuais**:
- **Reequilíbrio econômico-financeiro** — terceira figura legal (Lei 14.133 art. 124), pra eventos extraordinários (ex: alta abrupta de insumo, fato do príncipe)
- **Conjunto: comparativo Reajuste×Repactuação×Reequilíbrio na mesma view** — pra auditoria ver tudo aplicado num contrato em ordem cronológica

**Recebimento e garantias**:
- **Recebimento provisório/definitivo** (Lei 14.133 art. 140) — termo de aceitação, vícios, prazo de garantia
- **Garantias contratuais** — caução, seguro-garantia, fiança; controle de vigência

**Infraestrutura adjacente**:
- **EF download FGV/IBGE** — automatiza CSV import da V31
- **Mobile audit V30-V33** — páginas de reajuste/repactuação não auditadas em mobile
- **API keys + REST público** — superfície de entrada
- **OKLCH migration** — DS Tier 3 (oferecida 11 vezes)
