# V31 — Fechar o loop de Reajustes

V31 fecha 3 pontas abertas do reajuste contratual entregue na V30:

1. **Aditivo formal automático** — opção no apply, satisfaz Lei 14.133 art. 125 pra órgãos que exigem formalização documental
2. **Import CSV de índices** — admin sobe planilha FGV/IBGE em vez de digitar mês a mês
3. **Cron de aviso de aniversário** — pg_cron quinzenal notifica admin/gestor quando contrato chega no aniversário (30 dias antes)

## 1. Aditivo formal automático (migration 037)

### Schema
```sql
ALTER TABLE additives ADD CONSTRAINT additives_tipo_check
  CHECK (tipo IN ('valor','prazo','valor_prazo','supressao','reequilibrio','reajuste'));

ALTER TABLE contract_reajuste_events
  ADD COLUMN additive_id uuid REFERENCES additives(id) ON DELETE SET NULL;
```

`'reajuste'` é um novo tipo de aditivo. Link bidirecional: o event aponta pro aditivo via `additive_id`; o aditivo aponta de volta via `metadata.reajuste_event_id`.

### RPC reescrita
`apply_contract_reajuste(contract_id, target_date?, notes?, create_additive bool)` ganha 4º parâmetro. Retorna `jsonb { event_id, additive_id?, value_after, delta, factor }` em vez de só uuid.

Quando `create_additive=true`:
- Reusa `register_additive()` existente (que já incrementa `valor_aditado`, cria audit_log, etc)
- Passa `tipo='reajuste'`, `valor_acrescimo=delta`, justificativa formatada com fator + período + notas do admin
- Metadata: `{ reajuste_event_id, index_codigo, factor, auto_generated: true }`
- Updates event com `additive_id`

Skip silencioso quando `delta <= 0` (sem sentido criar aditivo de valor zero/negativo).

### UI
Modal de aplicação ganha checkbox magenta (idêntico ao padrão do form de webhook eventos):
- Default desligado (admin escolhe explicitamente)
- Texto: "Recomendado pra órgãos que exigem formalização documental (Lei 14.133 art. 125)"
- Desabilitado quando `simResult.delta <= 0` com aviso amber
- Feedback de sucesso muda: "Reajuste aplicado e aditivo formal criado. Δ +R$ X" vs sem aditivo

### Histórico
Tabela de eventos ganha badge purple linkando direto pro aditivo: `Aditivo #N` (clica → `/contratos/:id/aditivos/:adId`).

## 2. Import CSV de índices

### Parser client-side (sem dep externa)
`parseIndexCsv(text)` em `api.ts` aceita:
- Separadores: `,`, `;`, tab
- Header opcional (detecta "mes/mês/month/reference/período" na 1ª linha)
- Datas: `YYYY-MM`, `YYYY-MM-DD`, `MM/YYYY`, `MM-YYYY`
- Valores: vírgula ou ponto decimal, com ou sem separador de milhar (`1.234,5678` ou `1234.5678`)

Retorna `{ rows: IndexCsvRow[], warnings: { line, raw, error }[] }`. Warnings não bloqueiam — só ignoram linhas inválidas.

### RPC bulk
`bulk_upsert_index_values(p_index_id, p_rows jsonb, p_source)` faz upsert em loop com tratamento de erros por linha:
- Cap: 1000 linhas
- Valida tenant ownership do índice
- Pra cada linha: parse + check existing → INSERT ou UPDATE
- Retorna `{ inserted, updated, skipped, errors[] }`

### UI
Botão "Importar CSV" ao lado de "Registrar mensal" em `/admin/indices-economicos`. Modal de 2 etapas:

**Etapa 1 — Upload + Preview**:
- Bloco de doc com formato aceito
- `<input type="file" accept=".csv,.txt">` E textarea pra paste
- Auto-parse ao mudar conteúdo → mostra 2 badges (válidas / ignoradas)
- `<details>` colapsável das warnings com linha, erro e raw
- Preview das primeiras 50 linhas (mês + valor) em tabela scrollable

**Etapa 2 — Resultado**:
- Card success
- 3 cards: Inseridas (verde) / Atualizadas (azul) / Ignoradas (amber)
- `<details>` dos erros do servidor (raríssimo, mas pode acontecer com race condition)

## 3. Cron de aviso de aniversário

### View
`v_contracts_due_reajuste` retorna contratos do tenant onde:
- `active = true` E status IN `(contratado, em_execucao)` (skip arquivado/concluído)
- Tem regra ativa
- `next_anniversary BETWEEN now()::date AND now()+30 days`

`next_anniversary` = `max(events.reference_date) || rule.data_base || contract.data_inicio || data_assinatura) + periodicidade_meses`.

### RPC + cron
`notify_reajuste_due()` (service_role only):
- Itera tenants com contratos elegíveis
- Pra cada admin/gestor_contrato do tenant, verifica cooldown de 30 dias via `notifications.metadata.reajuste_due_alert=true`
- Cria notification `kind=system` com lista dos 5 contratos mais próximos + "…e mais N" se aplicável
- Action_url `/dashboard`

`pg_cron`: `0 9 1,15 * *` — dia 1 e 15 às 09:00 UTC. Sem dep de pg_net (RPC roda em-process). Idempotente.

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ 1754 módulos · 15.85s
```

**Bundle**:
- Main: 75.13 → **75.66 KB gzip** (+0.53 KB)
- EconomicIndices: 2.61 → **4.12 KB** (+CSV import modal)
- ContractReajustes: 4.47 → **4.98 KB** (+checkbox criar aditivo + link no histórico)
- Margem até 150 KB: 74.3 KB

## Diff V30 → V31

- **+1 migration** (037 reajuste_closes_loop ~430L)
- **api.ts**:
  - `applyContractReajuste` muda assinatura: retorna `ApplyReajusteResult` (não mais string), aceita `create_additive: boolean`
  - `ReajusteEvent` ganha `additive_id?` e `additive_numero?`
  - Novos: `bulkUpsertIndexValues`, `parseIndexCsv` (helper client-side puro), `BulkUpsertIndexResult`, `IndexCsvRow`
- **ContractReajustes.tsx**:
  - Modal de apply: checkbox "Criar aditivo formal"
  - Histórico: badge link pro aditivo
- **EconomicIndices.tsx**: botão Upload + modal de 2 etapas (preview/resultado)
- **Sem novas páginas**

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only   # 037
```

Cron mensal de aniversário precisa de `pg_cron` (já configurado nas V25+).

## Como testar

### Aditivo formal
1. `/contratos/:id/reajustes` → "Simular reajuste" → Calcular → simulação OK
2. Marcar checkbox "Criar aditivo formal" → "Aplicar"
3. Feedback: "Reajuste aplicado **e aditivo formal criado**. Δ +R$ X"
4. Linha nova no histórico tem badge purple "Aditivo #N" → clica → vai pra `/contratos/:id/aditivos/<id>`
5. No aditivo, ver `tipo=reajuste`, `valor_acrescimo=Δ`, `metadata.auto_generated=true`, `metadata.reajuste_event_id` populado
6. `contracts.valor_aditado` foi incrementado em Δ (verifica via SQL)
7. Repetir sem marcar checkbox → event criado, `additive_id=NULL`, sem badge no histórico

### Import CSV
1. `/admin/indices-economicos` → IPCA → "Importar CSV"
2. Paste: `2024-01,7011.2\n2024-02,7045.6\n2024-XX,bad-line\n2024-03,7088.1`
3. Preview: 3 válidas, 1 ignorada (linha 3, "data inválida")
4. `<details>` mostra a warning com a linha raw
5. "Importar 3 linha(s)" → resultado: 3 inseridas, 0 atualizadas, 0 ignoradas (servidor pode ter detectado mais — checar errors[])
6. Refresh do modal → tabela do índice mostra os 3 pontos
7. Re-importar mesma CSV → resultado: 0 inseridas, 3 atualizadas (idempotente)

### Cron aniversário
1. Configurar contrato com `data_base = today - 11 months 29 days` e periodicidade 12
2. View `v_contracts_due_reajuste` deve incluir o contrato
3. SQL manual: `SELECT * FROM notify_reajuste_due();` → cria notification pros admins
4. Em `/notifications`, ver "1 contrato(s) próximo(s) do aniversário de reajuste" com body listando o contrato
5. Re-chamar dentro de 30 dias: 0 admins_notified (cooldown ativo)

## Próximas oportunidades (V32)

1. **Reajuste em massa**: admin filtra contratos elegíveis e aplica reajuste em lote (com simulação prévia agregada)
2. **Cliente de download FGV/IBGE** — EF que faz scrape/API call mensal e popula `adjustment_index_values` automaticamente
3. **Reajuste de medições já emitidas** — Lei 14.133 art. 126 permite reajustar serviços já executados nos casos específicos; UI para selecionar quais medições aplicam
4. **Repactuação** (figura legal distinta) — recalcula via planilha SOV em vez de índice
5. **OKLCH migration** — DS Tier 3 (oferecida 9 vezes)
6. **API keys + REST público** — nova superfície
7. **Diário de obras** — nova área de domínio
