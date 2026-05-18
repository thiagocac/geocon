# V73 — Filtro avançado no log de marca d'água

Completa V68 com investigação de vazamento. Em log com centenas de entradas, filtros são essenciais para encontrar o responsável.

## O que entrega

**`WatermarkLog` (V68 page) estendido**:

3 filtros client-side via `useMemo`:
- **Downloader** select (derivado dinamicamente do log — Map dedup por email)
- **Período** select (Todos / 7d / 30d / 90d)
- **Busca textual** (input com Search icon) em `recipient_label` OR `fingerprint`

Botões adicionais:
- **Limpar** (XIcon) — só aparece se `hasFilter`
- **CSV** (Download icon, reusa V71 helper) — exporta apenas o filtrado
- Contador "N de M" no final

**Empty state diferenciado** para "Nada nos filtros atuais" (vs sem downloads).

**Caso de uso real**: vazamento descoberto, um PDF circulando com FP `A3F71C92…`. Operador entra na page, cola FP na busca → 1 resultado mostra quem baixou, para quem, quando. Permite ação legal.

## Decisões

- Tudo client-side (`useMemo`) — log já vem do RPC com LIMIT 500
- Busca cobre 2 campos (recipient + fingerprint) — operadores podem buscar por qualquer
- Sem filtro por ICP-Brasil (raro o suficiente para não justificar UI)
- Reusa V71 csv helper (sem duplicação)

## Bundle V72 → V73

Main 108.81 → **108.81** (sem Δ). Filtros estão no chunk lazy do WatermarkLog que já existia.
