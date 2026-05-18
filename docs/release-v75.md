# V75 — PWA install banner

V75 sugere instalar o GeoCon como PWA na home screen, especialmente útil para fiscais que vão usar V61+V62+V63 (apontamento campo offline).

## O que entrega

**`<PwaInstallBanner />`** (~120 linhas) montado no root do App:

**Detecção de cenário** (no `useEffect`):
- Já instalado (`display-mode: standalone`) → não mostra
- Recém-dismissado (≤14 dias) → não mostra
- Chrome/Edge/Samsung → captura `beforeinstallprompt`, mostra banner com botão "Instalar" funcional
- iOS Safari (sem API nativa) → mostra dica textual após 4s

**Banner UI** (fixed bottom-center, max 400px):
- Avatar circular Smartphone icon
- Title "Instalar GeoCon"
- Body adaptativo: Chrome → "Acesso rápido na tela inicial. Funciona offline em apontamento de campo."; iOS → "Toque em Compartilhar → Adicionar à Tela de Início."
- Botões "Instalar" (primary) + "Agora não" (Chrome path apenas)
- X (top-right) para dismiss

**Persistência**:
- Dismiss salva timestamp em `localStorage['geocon:pwa_banner_dismissed_at']`
- Re-aparece após 14 dias

## Decisões

- 4s delay no iOS (dá tempo de user entender o app antes de sugerir install)
- 14 dias dismiss (evita irritar usuários que não querem instalar)
- Não mostra se já standalone (PWA detectado via media query)
- iOS hint é texto puro (não há API; melhor ensinar do que ignorar)
- Banner global (montado no App.tsx, antes das Routes) — aparece em qualquer página

## Bundle V74 → V75

Main 108.82 → **109.67** (+0.85 KB). Banner global no main bundle. Margem **40.33 KB**.

## Sequência V54-V75 (22 versões)

V69-V75 = 7 polish em sequência fechando: edição inline composição · settings UI watermark · export CSV histórico · comparação concorrentes · filtro avançado log · notif preferences UI · PWA install banner.

Bundle total: 92.69 (V54) → **109.67** (V75) = +16.98 KB em 22 versões = 34% do crescimento até 150 KB.

Margem 150 − 109.67 = **40.33 KB**. Espaço suficiente para mais 8-10 versões de polish ou 2-3 features médias.
