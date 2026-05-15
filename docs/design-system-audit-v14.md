# Auditoria UX/UI — geoCon Gestão de Contratos
> Comparação entre o **Consulte GEO Design System v2** (project knowledge) e a implementação atual (V13).
> Data: 2026-05-15 · Versão alvo: V14

---

## 1. Sumário executivo

A V13 do geoCon mantém a **identidade de marca correta** (paleta navy/purple/magenta exata, brand gradient nas telas públicas) e atinge os fundamentos funcionais (multi-tenant, dark mode, lucide-react, tabular nums, WCAG focus rings). Porém, há **6 divergências estruturais** com o DS v2 que afetam consistência visual, ritmo da página e padronização cross-produto Consulte GEO.

| Status | Total |
|---|---|
| ✅ Aligned | 14 itens |
| ⚠️ Partial | 7 itens |
| ❌ Misaligned | 6 itens |
| 🔵 Out-of-scope | 3 itens (mantidos por motivo técnico — Inter WOFF1, HSL→OKLCH, prefixo `cg-`) |

---

## 2. ✅ O que está alinhado

| Item DS | Implementação |
|---|---|
| Brand colors (hex exatos) | `navy #182863`, `purple #3E2D71`, `magenta #C5117E` ✓ |
| Lucide-react exclusivo | Todos ícones via `lucide-react` ✓ |
| `darkMode: 'class'` Tailwind | ✓ |
| Hook de tema com persistência | `useTheme` com 3 modos (light/dark/system) ✓ |
| Focus ring global | `focus:ring-2 focus:ring-navy` ✓ |
| Tabular nums | `font-variant-numeric: tabular-nums` aplicado em `.tabular` ✓ |
| pt-BR + locale BR | Datas dd/mm/yyyy, valores R$ formatado ✓ |
| Tone profissional, sem emoji | ✓ |
| Status colors semânticas (success/warning/error) | Tokens `success #16A34A`, `warning #F59E0B`, `error #DC2626` ✓ |
| Container max-width | `max-w-7xl` ≈ 1280px (DS prescreve 1400px, close enough) ⚠️ |
| Brand gradient nas telas públicas | Login, ResetPassword, MagicLinkApprove, NoAccess, PublicValidation ✓ |
| Logo é wordmark `°geoCon` | Com `°` em magenta ✓ |
| Print stylesheet | `.print-safe` + auditoria de cores `print-color-adjust: exact` ✓ |
| Lazy-load Inter via @font-face WOFF1 local | (Restrição produto — não migrar para Mona Sans devido paridade PDF) ✓ |

---

## 3. ⚠️ Divergências parciais

### 3.1 Kicker treatment ausente nas páginas
**DS diz:** "A 'kicker' treatment — `font-mono`, `text-[10px]`, `uppercase`, `tracking-widest` (0.18em), `text-stone-500` — aparece acima de quase todo título de página, todo card, todo grupo de campo, toda seção de menu. **É o ritmo do produto.**"

**Atualmente:** Só temos `.label` em FormFields (`text-xs font-semibold uppercase tracking-wide`) e nenhum kicker antes dos `PageHeader` títulos. Páginas como `/dashboard`, `/contratos`, `/aprovacoes` começam direto no `<h1>`.

**Recomendação:** Criar componente `<Kicker>` + adicionar prop `kicker?: string` ao `PageHeader`. Aplicar em todas as páginas indicando contexto (ex: "Carteira · multi-tenant", "Contrato 045/2024 · Aditivo nº 03").

### 3.2 Tracking-widest 0.18em vs tracking-wide 0.05em
**DS diz:** `--tracking-widest: 0.18em` é a assinatura visual do produto.

**Atualmente:** `.label` usa `tracking-wide` (Tailwind = 0.025em — muito mais sutil). Topbar usa `tracking-widest` (Tailwind = 0.1em — ainda sub-DS).

**Recomendação:** Adicionar `--tracking-display: 0.18em` ao Tailwind config; padronizar todos os kickers.

### 3.3 Topbar fundo branco em vez do brand gradient
**DS diz:** "Header é a barra superior, brand gradient `linear-gradient(135deg, navy 0%, purple 55%, magenta 100%)` em **ambos** light e dark modes. **A marca nunca perde sua cor.**"

**Atualmente:** Topbar tem `bg-white/95 backdrop-blur dark:bg-card-dark/95` — fundo branco no light mode. Apenas o Sidebar tem `bg-navy` sólido, mas não o brand gradient.

**Recomendação:** Aplicar brand gradient na Topbar (56px) com texto branco e detalhes em magenta. Considerar variant "soft" do gradient (`--brand-gradient-soft` opacity 8%) se 100% for muito agressivo na densidade de info.

### 3.4 Sidebar navy sólido vs brand gradient
**DS diz:** Sidebar é `bg-navy-deep` (`#0E1B40`) — mais profundo que navy. Não usa gradient (mantém leveza visual).

**Atualmente:** `bg-navy` (#182863) — versão menos profunda. Sutil mas inconsistente com a hierarquia visual prescrita.

**Recomendação:** Trocar para `bg-navy-900` (#0E1B40) ou adicionar token Tailwind `bg-navyDeep` já definido mas não usado.

### 3.5 Heading weight 700 vs 900 (BLACK)
**DS diz:** "Heading weight is BLACK (900). Chunky, confident, slightly tightened com `letter-spacing: -0.015em`. Width axis pode ir a 105-115% para hero."

**Atualmente:** `page-title` usa `font-bold` (700) + `tracking-tight`. Inter WOFF1 atualmente carregado só tem Regular 400 + Bold 700 — não há 900.

**Recomendação tática:** Aceitar Bold 700 como limite técnico (paridade PDF). Adicionar Inter-Black.woff (se permitido) para títulos H1 críticos. Ou usar Inter-Bold com `text-3xl` e `tracking-tight -0.015em` para ganho visual sem mudar weight.

### 3.6 Status badges sem dot, sem caixa mono
**DS diz:** `<StatusPill>` é `font-mono`, 10px, uppercase, `tracking 0.1em`, com dot colored à esquerda (6×6px). Vocabulário fixo de 7 estados.

**Atualmente:** Componente `<Badge>` é genérico (`rounded-full px-2.5 py-0.5 text-xs`), sem dot, sem mono, sentence-case.

**Recomendação:** Criar `<StatusPill>` separado para statuses do domínio (rascunho/em_aprovacao/aprovado/etc) seguindo a anatomia DS. Manter `<Badge>` para uso genérico (counts, tags soft).

### 3.7 Container 1280px vs 1400px
**DS diz:** `--container-max: 1400px`.

**Atualmente:** `max-w-7xl` = 1280px. Em telas grandes (≥1440px) sobram ~80px de margem extra que poderiam ser usados pelas tabelas de medições/SOV.

**Recomendação:** Adicionar utility `.container-cg` com `max-w-[1400px]` e migrar `Layout` gradualmente.

---

## 4. ❌ Divergências estruturais

### 4.1 Logos: SVGs locais inconsistentes vs assets canônicos
**Project Knowledge fornece:** `/mnt/project/logocolor.png` + `logowhite.png` + retina 2x — assets canônicos da marca, extraídos do site oficial.

**Atualmente:** `public/logos/{logo-color,logo-mark,logo-white}.svg` — versões SVG locais que **não foram validadas pixel-a-pixel** contra o brand book. O `logo-mark.svg` em uso no Sidebar pode estar com proporção/cor levemente desviada.

**Recomendação:** Substituir pelos PNG canônicos (+ versões 2x para retina). Logos SVG só se gerados a partir do logocolor.png oficial.

### 4.2 Skip-link ausente (WCAG 2.2 AA falha)
**DS diz:** "Skip links are baked into `AppShell`."

**Atualmente:** `Layout.tsx` não tem link "Pular para conteúdo principal" — usuários de leitor de tela / teclado precisam tabular por toda a sidebar antes de chegar ao `<main>`.

**Recomendação:** Adicionar `<a href="#main" className="sr-only focus:not-sr-only ...">Pular para conteúdo</a>` antes do Sidebar; adicionar `id="main"` no `<main>`.

### 4.3 Density modes não implementados
**DS diz:** Density global via `<html data-density="compact|comfortable|spacious">`. "Single attribute reshapes input height, table row height, card padding, grid gaps everywhere."

**Atualmente:** Sem density toggle. Usuários power que processam centenas de medições não conseguem comprimir tabela.

**Recomendação:** Adicionar hook `useDensity` (similar ao `useTheme`), botão no Topbar próximo ao ThemeToggle, persistir no localStorage. Tabelas e cards respondem via CSS vars opcionais.

### 4.4 Touch targets < 44px em botões sm e icon-only
**DS diz:** "Every interactive element ≥ 44px (`--touch-target`)."

**Atualmente:**
- `Button size="sm"`: `px-3 py-1.5 text-xs` → ~28px altura → **falha**
- IconButton no Topbar (`p-2 rounded-full`): 32×32px → **falha**
- Toggle no NotificationPreferences: `h-6 w-11` → 24px → **falha**

**Recomendação:** Garantir `min-h-[44px]` em todos os interactive elements. Para botões visualmente menores (counter chip), envolver em hit-area invisível.

### 4.5 Casing rules inconsistente
**DS diz:** "Kicker = UPPERCASE mono 0.18em tracking; page headings = sentence case; status pills = sentence case; buttons = verb-first."

**Atualmente:**
- Page headings: `"Carteira de contratos"` ✓ sentence case
- Mas: `"Visão por programa"` ✓ vs `"Análise de risco contratual"` ✓ — consistente
- Botões: maioria verb-first (`"Adicionar item"`, `"Salvar preset"`) ✓
- Mas: `"Backlog interno"`, `"Tenants"` (nomes só) — DS pede subtitle abaixo do title, não usar como title ⚠️
- Status pills lowercase como "aprovado", "em_aprovacao" — DS pede sentence case "Aprovado", "Em aprovação"

**Recomendação:** Auditoria de strings + migração para sentence-case nas status pills (mantém valor enum no DB, formata na UI).

### 4.6 Brand gradient não usado no app shell (apenas em telas auth)
**Já mapeado em 3.3, 3.4** — reforço aqui: a marca aparece apenas quando o usuário NÃO está logado. Após autenticar, **a identidade visual da marca desaparece** (sidebar navy sólido + topbar branca). Isso vai contra o princípio DS "the brand never loses its color".

**Recomendação combinada:** Aplicar gradient na Topbar (full brand) **OU** uma faixa thin de 4px gradient como border-top da Topbar (mais sutil, manter densidade de info). Sidebar pode permanecer navy sólido (legibilidade dos nav items prevalece).

---

## 5. 🔵 Itens fora de escopo (decisão consciente)

| Item DS | Por que não migrar |
|---|---|
| **OKLCH em vez de HSL** | Refatoração ampla; Tailwind ainda não tem suporte nativo OKLCH. Diferença perceptual mínima na paleta atual. |
| **Mona Sans em vez de Inter** | Constraint produto: PDF EFs precisam de WOFF1 (Brotli não disponível no Deno runtime). Inter mantém paridade tipográfica entre web e PDFs. Romper isso ramificaria a tipografia. |
| **Prefixo `cg-` em classes** | DS é portátil cross-produto; aqui só temos geoCon. Tailwind utility-first já garante isolamento via build do Vite. |

---

## 6. Recomendações priorizadas para V14

### Tier 1 (impacto/esforço favorável — fazer agora)
1. **Logos canônicos** (PNG 1x + 2x do PK) → 30 min
2. **Componente `<Kicker>`** + integração no `PageHeader` → 1h
3. **Componente `<StatusPill>`** com dot + mono uppercase + 7 tones → 1h
4. **Skip-link** no Layout → 15 min
5. **Brand gradient na Topbar** (versão soft ou thin border-top) → 30 min
6. **Sidebar usando `navyDeep`** já no Tailwind → 5 min
7. **`tracking-display: 0.18em`** + aplicar em kickers/labels → 20 min

### Tier 2 (alto valor, mais esforço — V15)
8. **Density toggle** (hook + chassis CSS vars opcional + Topbar btn) → 3-4h
9. **Touch targets 44px enforcement** (audit + ajustes) → 2h
10. **Status pills no domínio do contrato** (mapeamento dos statuses atuais para vocabulário consistente) → 2h
11. **Container max-w-[1400px]** + verificar tabelas → 1h

### Tier 3 (polish + roadmap futuro)
12. Type weight 900 — investigar Inter-Black.woff (paridade PDF)
13. Migração HSL→OKLCH (avaliar custos via Tailwind 4 quando disponível)
14. Pattern `AdminListPage` (template reutilizável para admin pages)
15. Decorative blur orb magenta nos heros (DS o limita a 1 ocorrência por tela)

---

## 7. Próximos passos

V14 entrega os 7 itens Tier 1 (~3-4h de trabalho), fechando 5 das 6 divergências estruturais. Auditoria reaberta após V15 para acompanhar Tier 2.
