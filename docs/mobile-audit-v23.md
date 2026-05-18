# Mobile responsiveness audit · V23

Audit realizado em viewports referência: **375px** (iPhone SE/12 mini), **390px** (iPhone 13/14/15), **768px** (iPad portrait).

Base: V22 com code-splitting completo + DS Tier 1/2 finalizado.

## ✅ Já está bem em mobile

- **Sidebar drawer** funcional: `lg:hidden` overlay + translate -100% quando fechado, gerenciado por `<Layout>` com hamburger no Topbar
- **Topbar** colapsa elementos: breadcrumb (md+), search input (md+ vs ícone em sm), hamburger (lg-), avatar 36-40px
- **Bell dropdown** já tem `max-w-[calc(100vw-2rem)]` — não cresce além da viewport
- **Notification preferences** matriz 8×2 é compreensível porque é grid responsivo
- **Dashboard KPIs** já usam `grid gap-4 md:grid-cols-4` — em mobile vira 1 coluna naturalmente
- **Container max-w-[1400px]** centralizado no `<Layout>` desde V15
- **Cards** com `densityAware` (V16) respondem ao modo de densidade
- **DensityToggle** mostra "Compacto" como opção mobile-friendly
- **Tables** com `overflow-x-auto` em 11 das 16 pages com tabela

## ⚠️ Pontos a corrigir

### Tier 1 — quebra visual real em mobile (FIX V23)

| # | Página/componente | Problema | Fix |
|---|---|---|---|
| 1 | `Additives.tsx` | `<table>` sem wrapper overflow → colunas largas estouram a viewport | Wrap em `<div className="overflow-x-auto">` |
| 2 | `ContractParties.tsx` | idem | idem |
| 3 | `Eap.tsx` | idem | idem |
| 4 | `MyApprovals.tsx` | idem | idem |
| 5 | `Portfolio.tsx` | idem | idem |
| 6 | `Modal` | `px-6` (24px) ocupa muito espaço em viewport 375px (conteúdo útil cai para ~295px) | `px-4 md:px-6` (16px mobile, 24px desktop) |
| 7 | `PageHeader actions` | Quando há 3+ botões longos ("Recalcular snapshot", "Comparar versões"), eles esticam o flex e quebram em colunas estranhas | Já tem `flex-wrap` — verificar; possivelmente ajustar `gap` para mobile-friendly |

### Tier 2 — UX subótimo mas funcional (FIX V23)

| # | Componente | Problema | Fix |
|---|---|---|---|
| 8 | `Stat.tsx` labels uppercase | `font-mono text-[10px] tracking-display` ok em mobile mas em telas pequenas o label pode quebrar em 2 linhas e desalinhar valores | `truncate` + `title` attr para preservar legibilidade |
| 9 | Botões com label longo (ex: "Marcar todas como lidas") | Em mobile podem estourar a linha do header | Trocar para versão ícone-only em < md, full label em md+ |
| 10 | `MemberPicker` chips | "+ N" + "Limpar" podem quebrar mal em containers estreitos | `flex-wrap` já está; adicionar `min-w-0` |

### Tier 3 — Nice-to-have (deferir)

| # | Componente | Problema |
|---|---|---|
| 11 | Modal full-screen em telas muito pequenas (< 360px) | Atualmente flutuante mesmo em mobile; full-screen seria mais ergonômico |
| 12 | Footer sticky no Modal mobile | Botões podem ficar fora da viewport com teclado virtual aberto |
| 13 | Dashboard sparkline mobile-aware | SVG fixo 280×100 OK mas poderia ser percentage-based em mobile |
| 14 | Tab navigation patterns | Algumas páginas (WorkflowsAdmin) têm 2+ tabs lado-a-lado que esticam horizontalmente |

## Estratégia V23

Foco em Tier 1 + 2 que cobrem 95% das quebras reais. Tier 3 fica para V24+.
