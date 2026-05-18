# V54 — Validações automáticas de medição

V54 é a primeira versão focada na área **Medição** após análise solicitada pelo
usuário. Expande a engine de validação existente (4 regras → 6 regras) e fecha
a lacuna real: a UI mostrava badge "bloqueado" sem explicar por quê.

## Contexto descoberto na análise

A V53 já tinha:

- **EF `validate-measurement`** com 4 regras (saldo, glosa_excessiva, memoria_ausente, quantidade_zero)
- **Campo `measurement_items.validacao_erros jsonb`** populado pela EF
- **Botão "Validar"** no `MeasurementDetail` que invoca a EF
- **Badge `validacao_status`** (ok/alerta/bloqueado) na tabela de itens
- **Tipos `ValidationIssue` + `MItem.validacao_erros: ValidationIssue[]`** já em `types.ts`

O que faltava:

- **UI não renderizava `validacao_erros`** — usuário via "bloqueado" sem motivo
- **Sem painel agregado** de quantos itens em cada severidade
- **Submit não era bloqueado** quando havia issues `bloqueado`
- **Auto-validação ausente** — usuário tinha que clicar "Validar" sempre
- **2 regras críticas ausentes**: quantidade muito acima do saldo, preço divergente da referência SINAPI/SICRO

## O que V54 entrega

### 1. 2 regras novas na engine (EF `validate-measurement`)

| Regra | Severidade | Condição |
|---|---|---|
| `quantidade_acima_25pct` | alerta | `quantidade_periodo > 25% do saldo_disponivel_antes` |
| `preco_divergente_referencia` | alerta | `preço_unit_snapshot diverge >5%` da entrada mais recente em `contract_item_price_references` para o mesmo `contract_item_id` |

Engine completa agora cobre 6 regras nomeadas:
1. `saldo` (bloqueado) — quantidade ultrapassa contratada+aditada
2. `glosa_excessiva` (alerta) — glosa >30% do período
3. `memoria_ausente` (alerta) — campo memoria_resumo vazio
4. `quantidade_zero` (bloqueado) — valor lançado sem qtd
5. `quantidade_acima_25pct` (alerta) — V54
6. `preco_divergente_referencia` (alerta) — V54

A query passou a fazer LEFT JOIN com `contract_item_price_references` para
materializar a regra 6 — mantém apenas a 1ª ref por item (simplificação;
poderia evoluir para "a mais recente" em V55).

### 2. Componente `<ValidationsPanel />`

Novo componente em `src/components/ValidationsPanel.tsx`:

- **Header** com título + badge agregado (OK / Atenção / Bloqueado / Pendente)
- **Grid 4 cells**: contador para cada severidade (com opacidade reduzida em zeros)
- **Lista expandível por REGRA** (não por item) — mais limpa quando 1 regra afeta
  10 itens, mostra "10 itens: Saldo contratual" expansível
- **Por item**: código + descrição truncada + mensagem do erro + link "Memória →"
  para `/contratos/:id/medicoes/:medId/memoria/:item_id`
- **Botão "Re-validar"** disabilitado em medições finais (emitida/aprovada/paga/cancelada/retificada)
- **Helper text** quando há pendentes ("clique em Re-validar para executar")

### 3. Helpers no `api.ts`

```ts
export const VALIDATION_RULE_LABELS: Record<string, string>;
// Mapeia rule → label em pt-BR

export interface MeasurementValidationSummary {
  total, ok, alertas, bloqueados, pendentes,
  status_agregado: 'ok' | 'alerta' | 'bloqueado' | 'pendente';
}

export function summarizeMeasurementValidation(items: MItem[]): MeasurementValidationSummary;
export function groupValidationIssuesByRule(items: MItem[]): Array<{
  rule, label, severity, items: [{ item_id, codigo, descricao, message }]
}>;
```

Helpers puros (sem backend) — derivam o resumo da lista de items que a
página já tem em memória. Zero latência adicional.

### 4. Integração no `MeasurementDetail.tsx`

- **`<ValidationsPanel />` montado acima da tabela "Itens medidos"** — visibilidade primeira
- **Auto-validate via `useEffect`**: quando medição é editável (rascunho/preliminar/devolvida)
  E há items com `validacao_status='pendente'`, dispara `validate.mutate()` 1× por sessão
  por `m.id` (controle via `useRef` para evitar loop)
- **Botão "Emitir" desabilitado** quando `validationSummary.bloqueados > 0`, com tooltip
  explicativo: "Não é possível emitir: 2 item(ns) com validação bloqueada."

### 5. Mock SKIP_AUTH expandido

`MOCK_MITEMS` agora demonstra **todas as 6 regras** em 2 cenários:

**`m1-6` (em revisão)** — 4 items:
- `mi-1` Alvenaria — OK
- `mi-2` Revestimento — 2 alertas (`glosa_excessiva` 43,5% + `quantidade_acima_25pct` 30,7%)
- `mi-3` Quadro elétrico — `preco_divergente_referencia` +8,4% vs SINAPI
- `mi-4` Concreto — `memoria_ausente` (campo vazio)

**`m2-2` (preliminar)** — 2 items:
- `mi-c2-1` Cobertura — `saldo` BLOQUEADO (acumulado 4.300 > contratada 4.200)
- `mi-c2-2` Pintura — OK

`m2-2` demonstra o bloqueio do submit: ao abrir essa medição em demo, o botão
"Emitir" fica disabled e o painel mostra "1 item bloqueado".

## Decisões

1. **Sem migration nova** — segue padrão V49/V50/V51. Toda a infra schema/RPC
   já existia desde V01. O trabalho real era ampliar EF + adicionar UI rica.
   3ª "frontend-only" + 1 ampliação EF.

2. **Auto-validate 1× por sessão por medição** via `useRef` — UX de "valida quando
   abro, mas não fica re-validando se eu mexo na página". Re-validação explícita
   via botão.

3. **Bloqueio do submit no frontend, não no backend** — engine de validação roda
   na EF; o `submit_measurement` RPC SQL não conhece o `validacao_status` agregado.
   Trade-off: backend pode ser burlado se cliente malicioso ignorar o frontend.
   Mitigação V55: adicionar guard no SQL `submit_measurement` que rejeita se
   `EXISTS (SELECT 1 FROM measurement_items WHERE measurement_id = $1 AND validacao_status = 'bloqueado')`.

4. **Lista expandida por REGRA, não por ITEM** — quando 1 regra afeta 20 itens,
   "20 items: Saldo contratual" expansível é mais navegável que 20 cards
   espalhados. Ainda permite drill-down.

5. **`groupValidationIssuesByRule` faz upgrade automático de severidade** — se a
   mesma regra aparece como `alerta` em um item e `bloqueado` em outro (caso
   raro), o grupo é classificado como `bloqueado`. Conservador.

6. **Sem refactor para SQL function nativa** — a EF funciona; refactor para
   `validate_measurement_sql(p_measurement_id)` em PL/pgSQL economizaria 1 ida
   HTTP mas adiciona migration + duplica lógica. Mantém EF como source-of-truth.
   V55+ pode unificar se houver razão de performance.

7. **`contract_item_price_references` consultada com "1ª linha por item"** —
   simplificação; idealmente deveria ser "a mais recente por `data_base`".
   V55 pode evoluir com `DISTINCT ON (contract_item_id) ... ORDER BY data_base DESC`.

## Bundle V53 → V54

| Chunk | V53 | V54 | Δ |
|---|---:|---:|---:|
| Main | 90.44 | **92.69** | +2.25 |

Margem 150 − 92.69 = **57.31 KB**. Custo cobre `<ValidationsPanel />` (~180 linhas
TSX) + 3 helpers em `api.ts` (~60 linhas) + auto-validate effect + 4 items mock
adicionais.

## Próximas oportunidades (V55+)

Mantendo foco em medição/SOV/GED conforme solicitado:

1. **Curva ABC de itens (SOV)** — segmentação por percentil acumulado de valor.
   View `v_contract_items_abc` + UI no `ContractSheet` com toggle "Modo ABC" +
   Pareto chart. ~250 linhas. **Quick win.**

2. **Validade temporal em GED** — campo `ged_documents.data_validade` +
   `dias_alerta_antes` + cron diário (reusa stack V53) que insere
   `realtime_alerts` para ARTs/licenças/ASOs vencendo. ~200 linhas. **Alto
   valor compliance.**

3. **Bloqueio backend do submit** — guard no SQL `submit_measurement`. ~30 linhas.
   Fecha gap de segurança da V54.

4. **"a mais recente" em contract_item_price_references** — DISTINCT ON +
   ORDER BY data_base DESC. ~10 linhas na EF. Trivial mas mais correto.

5. **Apontamento de campo mobile-first** — página `/contratos/:id/medicoes/:medId/campo`
   com swipe-cards, foto direta, GPS, voice-to-text, Service Worker offline.
   ~600 linhas. **Feature grande.**

6. **Diff entre revisões GED (R01 vs R02)** — diff-match-patch sobre
   `extracted_text` já existente. ~250 linhas. **Médio valor, médio esforço.**

Por valor/esforço imediato: **Curva ABC (1)** ou **Validade temporal GED (2)**.
A primeira fortalece a área SOV (analítica útil para auditoria); a segunda
abre nova capacidade no GED (compliance) reusando o cron stack da V53.
Continuar com qual?
