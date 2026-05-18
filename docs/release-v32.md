# V32 — Reajuste em massa

V32 fecha o capítulo "Reajuste contratual" iniciado na V30. A capacidade unitária (1 contrato por vez) era boa pra orgs pequenos; agora ganha aplicação em lote pra orgs com 50+ contratos que precisam fazer aniversário batch no início do mês.

## Migration 038 — 3 RPCs novas

### `list_reajuste_candidates(window_days, only_due, index_id)`

Generaliza a `v_contracts_due_reajuste` da V31. Aceita:
- `window_days int = 30` — inclui contratos vencendo nos próximos N dias
- `only_due bool = false` — quando true, retorna apenas vencidos HOJE
- `index_id uuid` (opcional) — restringe ao índice escolhido

Retorna: `contract_id, contract_numero, objeto, status, valor_total_atual, rule_id, index_id, index_codigo, periodicidade_meses, last_reference_date, next_anniversary, is_due, events_count`. O `is_due` permite UI distinguir vencido (red badge) vs próximo (yellow badge) sem cálculo client-side.

Janela default abre também 30 dias pra trás (orgs que esqueceram aniversários recentes ainda aparecem).

### `bulk_simulate_reajuste(contract_ids[], target_date?)`

Cap de 200 contratos. Pra cada um, chama `simulate_contract_reajuste`. Erros não-bloqueantes — falha de 1 não derruba os outros (retorna `ok=false` + `error` na linha).

### `bulk_apply_reajuste(contract_ids[], target_date?, notes?, create_additive bool)`

Cap de 100 contratos. Pra cada um, chama `apply_contract_reajuste` (que já reusa simulate internamente). Mesmo padrão de tolerância: erros viram linhas com `ok=false`. Aplica `create_additive` globalmente (sem oferecer flag per-contrato — admin que precisa misturar usa o caminho unitário).

Permissões: `admin` ou `gestor_contrato` (mesma régua das RPCs unitárias).

## UI: `/admin/reajustes-em-massa`

Wizard de 4 etapas implícitas no mesmo componente:

### Etapa 1 — Filter
3 cards KPI no topo: Candidatos · Vencidos · Vencendo em Nd

Filtros:
- Janela em dias (0 = apenas hoje · 15 · 30 · 60 · 90)
- Índice (todos ou um específico)
- Checkbox "Apenas vencidos"

Tabela responsiva (md/lg breakpoints):
- Checkbox header com indeterminate
- Coluna Contrato com link pra `/contratos/:id/reajustes`
- Índice + frequência + count de aplicações anteriores
- Aniversário + base anterior em duas linhas
- Valor atual (escondido <lg)
- Status: badge Vencido (red) ou Próximo (yellow)

Botão "Selecionar todos os N vencidos" no footer quando há vencidos.

### Etapa 2 — Simular
Toolbar magenta com count + "Simular N" dispara `bulk_simulate_reajuste`.

### Etapa 3 — Revisar
Modal grande:
- 2 campos: data alvo + observação global aplicada a TODOS
- Checkbox "Criar aditivo formal pra cada"
- Tabela scrollável de simulação: contrato · status (OK ou erro com tooltip) · variação · Δ
- Subtitle agrega: "N aplicáveis · M com erro · impacto total R$ X"
- Botão "Aplicar N" só ativo se ≥1 aplicável

### Etapa 4 — Resultado
Modal final:
- 3 cards: Aplicados · Com erro · Aditivos criados
- Tabela: contrato (link) · status · Δ · link pro aditivo (se criado)
- Botão "Concluir" reseta tudo

## Decisões de design

**Por que `create_additive` é GLOBAL no lote?**
Misturar "uns sim outros não" no mesmo lote viraria UX confusa. Admin que precisa heterogeneidade faz 2 lotes (ou usa o caminho unitário pros casos especiais). Isso também mantém o RPC `bulk_apply_reajuste` simples — payload é `bool`, não `bool[]`.

**Por que tolerância a erros em vez de transação atômica?**
Org com 50 contratos não pode falhar tudo porque 1 tem índice faltando. Cada contrato é independente operacionalmente. Audit log preserva quem aplicou o quê via `applied_by` no event.

**Por que cap de 100 no apply (200 no simulate)?**
Simulate é stateless, pode ser maior. Apply gera audit_log + atualiza contracts + cria aditivos com triggers de webhook (V26+) — 100 é o limite onde 1 chamada termina em ~5s sem timeout. Orgs com 100+ fazem em 2 lotes.

## Build status
```
typecheck  ✓ 0 erros
vite build ✓ 1755 módulos · 26.99s
```

**Bundle**:
- Main: 75.66 → **75.86 KB gzip** (+0.20 KB)
- **BulkReajuste (novo, lazy):** 4.11 KB gzip
- Margem até 150 KB: 74.1 KB

## Diff V31 → V32

- **+1 migration** (038 bulk_reajuste ~240L com 3 RPCs)
- **+1 página** (AdminBulkReajuste)
- **+1 entrada no sidebar** (Operação · Reajustes (lote))
- **api.ts**: `listReajusteCandidates`, `bulkSimulateReajuste`, `bulkApplyReajuste` + 3 types (`ReajusteCandidate`, `BulkSimRow`, `BulkApplyRow`)
- **Sem novas EFs, sem cron novo**

## Como testar

### Setup
1. Ter ≥3 contratos com regra de reajuste configurada (via V30 UI)
2. Ter valores de índice cadastrados (via V31 CSV ou manual)
3. Forçar data-base de 2 deles pra alguns meses atrás:
   ```sql
   UPDATE contract_adjustment_rules SET data_base = '2024-05-01'
   WHERE contract_id IN ('<id1>', '<id2>');
   ```

### Fluxo feliz
1. `/admin/reajustes-em-massa` → janela 30 dias → tabela mostra 3 contratos
2. KPIs: 3 candidatos, 2 vencidos, 1 próximo
3. Click "Selecionar todos os 2 vencidos" → toolbar magenta aparece
4. "Simular 2" → modal abre com tabela: ambos OK
5. Marcar "Criar aditivo formal pra cada" + observação "PA-2025-001"
6. "Aplicar 2" → resultado: 2 aplicados, 0 com erro, 2 aditivos criados
7. Links no resultado vão pro `/contratos/:id/aditivos/<id>` certos

### Fluxo com erros
1. Tirar 1 valor de índice de algum mês necessário
2. Selecionar 3 contratos
3. Simular → 2 OK, 1 erro "Valor do índice X não cadastrado para o mês anterior a Y"
4. Aplicar 2 (o terceiro fica de fora automaticamente)
5. Resultado: 2 aplicados, 0 com erro (o "erro" do simulate ficou só na revisão)

### Edge: tudo com erro
1. Selecionar contratos onde nenhum atingiu interregno
2. Simular → todos com erro
3. Subtitle: "0 aplicáveis · 3 com erro"
4. Botão "Aplicar" some (só "Fechar" disponível)

## Próximas oportunidades (V33) — recomendações

Reajuste agora cobre: unitário (V30), aditivo automático (V31), import CSV (V31), aviso cron (V31), lote (V32). Tema fechado.

Para diversificar:

1. **API keys + REST público** — primeira fatia: GET `/api/v1/contracts`, GET `/api/v1/contracts/:id`, GET `/api/v1/measurements`. Token per-tenant, scope read-only, rate limit
2. **Diário de obras** — nova área de domínio: registro diário com clima, efetivo, fotos, integração com medição
3. **OKLCH migration** — DS Tier 3 (pendente desde V14, oferecida 10x)
4. **Repactuação** — figura legal distinta de reajuste, recalcula via planilha SOV
5. **Reajuste retroativo de medições** — Lei 14.133 art. 126, casos específicos onde reajusta serviços já executados
6. **Cliente FGV/IBGE auto-download** — EF mensal que popula `adjustment_index_values` sem intervenção admin

Recomendação minha: **API keys + REST público**. É uma superfície totalmente nova que abre canal pra integrações de leitura (BI tools, planilhas externas, scripts), complementando os webhooks de saída (V24–V29).
