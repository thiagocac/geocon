# V30 — Reajuste contratual (pivot pra domínio)

Após 6 versões em webhooks (V24–V29), V30 volta para o core do GeoCon: reajuste contratual, requisito da Lei 14.133 art. 25/92/124-127. Reaproveita as tabelas `adjustment_indices` e `contract_adjustment_rules` que já existiam no schema, mas estavam sem RPCs, sem série temporal de valores e sem UI.

## 1. Série temporal de índices (migration 036)

Nova tabela `adjustment_index_values` armazena valores mensais do índice (não a variação, e sim o **índice acumulado** — convenção FGV/IBGE):

```sql
id              uuid PK
index_id        uuid → adjustment_indices
tenant_id       uuid → tenants
reference_month date            -- normalizado pro 1º do mês via trigger
index_value     numeric(14,6)   -- IGP-M base ago/1994=100, IPCA base 1993, etc
source          text            -- 'manual' | 'fgv-csv' | 'ibge-api'
published_at    timestamptz
UNIQUE (index_id, reference_month)
```

Constraint UNIQUE + RPC `upsert_index_value` com `ON CONFLICT DO UPDATE` evita pontos duplicados. Trigger `trg_normalize_index_ref_month` força o dia 01 pra qualquer data.

RLS: read = qualquer membro do tenant; write = admin only.

## 2. Cálculo do reajuste (RPCs)

### `get_index_value_for_month(index_id, target)`

Pega o valor do mês **anterior** ao alvo. Convenção brasileira: o índice de aniversário é o do mês imediatamente anterior à data-base (ex: contrato com aniversário em 15/jul/2025 usa o índice de junho/2025, publicado em julho).

### `simulate_contract_reajuste(contract_id, target_date?)`

Núcleo do cálculo. Lógica:

1. Resolve a regra ativa via `contract_adjustment_rules`
2. **Data-base** = `coalesce(último_reajuste.reference_date, rule.data_base, contract.data_inicio_prevista, contract.data_assinatura)`
3. Valida interregno mínimo: `target >= base_date + periodicidade_meses`
4. Resolve `Iinicio` e `Ifim` via `get_index_value_for_month`
5. Calcula `factor = Ifim / Iinicio` e `variation = (factor - 1) * 100`
6. `value_after = round(value_before * factor, 2)`

Retorna `jsonb { ok, error?, rule_id, base_date, reference_date, index_value_base, index_value_ref, factor, variation_percent, value_before, value_after, delta, next_anniversary? }`.

Casos de erro tratados com `ok=false` + `error` específico:
- Sem regra ativa
- Interregno não cumprido (mostra `next_anniversary`)
- Índice não cadastrado pro mês de base ou de referência

### `apply_contract_reajuste(contract_id, target_date?, notes?)`

Reusa `simulate_contract_reajuste` internamente. Se ok, INSERT em `contract_reajuste_events` com snapshot completo do cálculo. Se simulação falha, raise exception.

**Decisão de design**: `valor_inicial` do contrato permanece imutável (assinatura original). O `valor_total_atual` é generated (`valor_inicial + valor_aditado`). Reajuste é armazenado **apenas** em `contract_reajuste_events` como audit trail — não modifica o valor do contrato em si.

A UI mostra "Total reajustado" como `sum(events.delta)` ao lado de "Valor atual (com aditivos)". Cria aditivo automático fica como V31.

### `get_contract_reajuste_summary(contract_id)`

Retorna pra UI: contrato (numero/valores), regra ativa (índice + cláusula), count de events, soma de deltas. Single round-trip pra a aba de reajustes.

### `upsert_contract_adjustment_rule(...)`

Admin ou gestor_contrato configura/edita a regra do contrato. Valida periodicidade 1-60 meses + fórmula obrigatória.

## 3. UI

### `/admin/indices-economicos` (admin only)

- Pills pra trocar entre índices (IPCA / IGP-M / INCC / SINAPI — populados via `seed_adjustment_indices` em 005)
- Tabela: Mês ref · Valor do índice · Δ vs mês anterior · Origem · Registrado em
- Modal "Registrar valor mensal" com `<input type="month">` e value
- Mobile audit aplicado: colunas Δ/Origem/Registrado escondidas em breakpoints menores

### `/contratos/:id/reajustes`

3 estados:

**Sem regra**: Card grande com CTA "Configurar regra"

**Com regra, sem histórico**: 4 KPIs (valor inicial, valor atual, total reajustado, aplicações) + card da regra ativa (cláusula + data-base + periodicidade + carência) + tabela vazia

**Com histórico**: KPIs + regra + tabela `Aplicado em / Período / Índice / Variação / Valor anterior / Novo valor / Δ`

Botão "Simular reajuste" abre modal com:
- `<input type="date">` pra data alvo (default = hoje)
- Botão Calcular (chama simulate RPC)
- Se erro: card âmbar com mensagem + (se aplicável) `next_anniversary` formatado
- Se ok: card success + breakdown da fórmula (Iinicio, Ifim, fator, variação) + impacto financeiro lado-a-lado (valor anterior → novo valor + Δ) + campo "Observações" + botão "Aplicar reajuste"

Aplicar reajuste cria o event audit e invalida queries. Card de regra ativa atualiza automaticamente.

## 4. Card "Reajustes" no `ContractDetail`

Adicionado entre "Aditivos" e "Itens não previstos". Ícone TrendingUp, subtitle "Reajuste anual por índice".

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ 1754 módulos · 12.54s
```

**Bundle**:
- Main: 74.51 → **75.13 KB gzip** (+0.62 KB pelo bump dos wrappers V30)
- EconomicIndices (lazy novo): 2.61 KB gzip
- ContractReajustes (lazy novo): 4.47 KB gzip
- Margem até 150 KB: 74.9 KB

## Diff V29 → V30

- **+1 migration** (036 contract_reajuste ~600L com 8 RPCs)
- **+2 páginas** (EconomicIndices · ContractReajustes)
- **+1 entrada no sidebar** (Operação · Índices econômicos)
- **+1 card no ContractDetail** (Reajustes entre Aditivos e Itens não previstos)
- **api.ts**: 8 wrappers novos + 6 types (AdjustmentIndex · IndexValueRow · ReajusteRule · ReajusteSummary · ReajusteSimulation · ReajusteEvent)

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only   # 036
```

Sem EFs novas, sem pg_cron, sem dep externa.

## Como testar (acceptance)

### Bootstrap: popular um índice
1. `/admin/indices-economicos` → escolher IPCA
2. Registrar valor mensal: 2024-12 → 7012.5481 (valor fictício, base IBGE)
3. Registrar 2025-06 → 7325.8412 (mais 6 meses)
4. Tabela mostra os 2 pontos + Δ 4.47% (verde)

### Configurar regra
1. `/contratos/:id/reajustes` → "Configurar regra" (vazio)
2. Escolher IPCA, data-base = 2024-12-15, periodicidade = 12 meses, fórmula = "Vr = V0 × (Ifim / Iinicio), reajuste anual"
3. Salvar → card "Regra ativa" aparece com cláusula + datas

### Simular cedo demais
1. Clicar "Simular reajuste" → data alvo = 2025-06-30 (apenas 6 meses)
2. Calcular → erro: "Reajuste ainda não cumpre interregno mínimo de 12 meses"
3. `next_anniversary` = 2025-12-15

### Simular OK
1. Mudar data alvo → 2025-12-31
2. Calcular → success
3. Breakdown: Iinicio = 7012.5481 (nov/2024), Ifim = 7325.8412 (jun/2025, se for o último cadastrado) — fator 1.04467, variação +4.47%
4. Impacto: valor R$ 1.000.000,00 → R$ 1.044.670,00 (Δ +R$ 44.670)
5. Aplicar → notification ok → histórico ganha linha

### Histórico
1. Aba Reajustes mostra a linha aplicada
2. KPI "Total reajustado" reflete +R$ 44.670
3. KPI "Aplicações" = 1

### Erro de índice faltante
1. Configurar contrato com data-base que não tem índice cadastrado
2. Simular → erro: "Valor do índice IPCA não cadastrado para o mês anterior a YYYY-MM-DD"

## Próximas oportunidades (V31)

1. **Reajuste cria aditivo automático**: ao aplicar, gerar `additive` tipo `reajuste` linkado ao event (registro formal pra fins de Lei 14.133 art. 125)
2. **Periodicidade semestral + customizada** (atualmente apenas anual funciona bem na UI; backend já aceita 1-60)
3. **Import CSV de índices** — admin faz upload mensal de planilha FGV/IBGE em vez de digitar
4. **Aplicação automática de reajuste via cron** (notificação + simulação prévia + aprovação 1-click pelo gestor)
5. **Repactuação** (outra figura legal — recalcula com base em planilha, não índice)
6. **OKLCH migration** — DS Tier 3 pendência V14
