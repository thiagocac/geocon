# V70 — Settings UI watermark V68

Completa V68 com configuração visual da marca d'água por tenant. Antes só havia RPC `upsert_ged_watermark_settings` — gestor precisava chamar via DB.

## O que entrega

**Página `/ged/configuracoes/marca-dagua`** (lazy chunk):

**Form esquerdo** com 9 controles:
- Texto principal (input)
- Texto secundário opcional
- Cor (color picker nativo + input hex sincronizado)
- Opacidade range 0.05–0.50 (com label dinâmico `· 0.20`)
- Ângulo range -90 a 90 (com label `· 45°`)
- Tamanho fonte range 12–144 (com label `· 48pt`)
- 3 checkboxes: incluir_timestamp · incluir_fingerprint · icp_brasil_enabled
- Campo PSC/signer_label condicional (só aparece se icp_brasil_enabled)

**Preview direito** ao vivo:
- "Página A4" simulada com texto lorem
- Watermark renderizado via CSS (rotate + opacity + color + font-size)
- Footer simulado com FP + timestamp + ICP-Brasil conforme toggles
- Atualização instantânea ao mexer em qualquer controle

**Botões**:
- "Restaurar padrão" (RotateCcw ghost) — reseta para defaults V68
- "Salvar" (primary) com feedback "Salvo" verde 4s
- Salvar atualiza queryClient com novo settings (UI já reflete)

## Decisões

- Range sliders > spinners (mais ergonomic para opacidade/ângulo/tamanho)
- Color picker nativo + input hex sincronizado (dois caminhos para mesma config)
- Preview client-side via CSS rotate (não dispara EF — gratis)
- Restaurar padrão local-state (não chama RPC; só ajusta form)
- Settings 1:1 por tenant (V68 já garantia)

## Bundle V69 → V70

Main 107.74 → **107.84** (+0.10 KB). Página lazy. Margem **42.16 KB**.

Ícone Stamp ghost no header do Ged() leva para a configuração.
