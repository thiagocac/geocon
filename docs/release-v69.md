# V69 — Edição inline de composição de preço

V69 abre fase polish leve. Torna V66 (composições) **produtivo além de read-only**.

## O que entrega

**Migration 068** — RPC `replace_composition_lines(composition_id, lines jsonb)`:
- Delete + insert atômico (1 transação)
- Valida ownership via RLS
- Retorna `{composition_id, lines_count}`
- `jsonb_to_recordset` valida tipos automaticamente

**API** em `src/lib/api.ts`:
- `CompositionLineDraft` interface (sem id, sem timestamps — só dados)
- `replaceCompositionLines(compositionId, lines)`
- SKIP_AUTH: muta MOCK_COMPOSITIONS in-memory + recalcula totais por tipo

**Modal V66 estendido** — modo edição:
- Botão "Editar linhas" (Pencil icon, outline) abre edição
- Linhas viram inputs (codigo + descrição + unidade + coeficiente + preço)
- Botão "Adicionar" por tipo no header de cada grupo (Plus icon)
- Botão `<Trash2 />` por linha para remover
- "Preview do total (não salvo)" em Card warning enquanto edita
- "Salvar N linha(s)" (Save icon) chama RPC
- "Cancelar" (X icon) descarta draft

Invalida queries de `contract-item-composition` + `price-divergence` (V67) após salvar.

## Decisões

- Replace total atômico vs upsert linha-a-linha — simples + sem conflito de id
- Modo edit popula draft via `useEffect` quando entra
- Cancelar não dispara confirm (drafts são pequenos)
- Coeficiente step 8 decimais (precisão SINAPI)
- Preço step 6 decimais
- Trash2 sem confirm (linha é parte de draft volátil — só vai para BD ao salvar)

## Bundle V68 → V69

| Chunk | V68 | V69 | Δ |
|---|---:|---:|---:|
| Main | 106.51 | **107.74** | +1.23 |

Editor inline (~140 linhas) entra no main bundle. Margem **42.26 KB**.
