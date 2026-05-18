# V71 — Exportar histórico V64 em CSV

Permite auditor externo levar planilha do histórico item-level.

## O que entrega

**Helper `src/lib/csv.ts`** (~50 linhas, sem deps):
- `csvField(value)` escape RFC 4180 (vírgulas, quebras, aspas)
- `generateCsv(rows, headers)` retorna string com BOM UTF-8 para Excel detectar
- `downloadCsv(filename, rows, headers)` cria Blob + download via `<a>` programático
- `downloadBlob(filename, blob)` helper para PDF e outros

**Integração no HistoryModal V64**:
- Botão "CSV" (Download icon) na linha de filtros, próximo ao "Limpar"
- Exporta as entradas **filtradas** (respeita autor/período/source)
- Disabled quando `filtered.length === 0`
- Estrutura long-form: 1 linha por campo alterado (não 1 por entry com colunas dinâmicas — mais útil para pivot table)

**Colunas do CSV**:
| Data/hora | Autor | Origem | Campo | Valor anterior | Valor novo |
|---|---|---|---|---|---|
| 2026-03-12T14:22:00Z | Patrícia Lopes | sov_edit | Preço unitário | 720,50 | 845,20 |

Para entries sem campos detalhados (raro), emite 1 linha com campo vazio.

Nome do arquivo: `historico-item-{codigo_sanitizado}.csv`.

## Decisões

- BOM UTF-8 (Excel pt-BR detecta encoding corretamente)
- Long-form (1 linha por campo) vs wide (1 linha por entry) — long facilita análise em pivot
- Sem PDF nesta versão (CSV cobre 95% dos casos; auditor leva para Excel)
- Sem xlsx-vendor (lib pesa 113KB; CSV nativo é 0KB extra)
- Respeita filtro client-side (exporta só o que está visível)

## Bundle V70 → V71

Main 107.84 → **108.37** (+0.53 KB). Margem **41.63 KB**.
