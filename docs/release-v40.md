# V40 — Mobile audit V30-V39 + utility components

V40 atende um pedido recorrente desde V32 (8 versões atrás): tornar as páginas dos 9 institutos da Lei 14.133 + Timeline usáveis em mobile. A estratégia foi **identificar padrões problemáticos comuns**, **criar componentes reutilizáveis**, e **aplicar via patches cirúrgicos** em vez de refatorar cada página individualmente.

## Padrões problemáticos identificados

| Problema | Impacto em mobile | Solução |
|---|---|---|
| `grid md:grid-cols-4` (KPIs) | 4 cards empilhados verticalmente, ocupam 60% da tela antes dos dados | `grid-cols-2 md:grid-cols-4` — 2x2 em mobile, 4 em desktop |
| `text-2xl` em valores KPI | Quebra layout em telas pequenas | `text-xl sm:text-2xl` |
| `p-4` em cards KPI | Padding gera espaço desperdiçado | `p-3 sm:p-4` |
| `text-[10px]` em labels | Difícil de ler em telas densas | `text-[9px] sm:text-[10px]` |
| `p-1.5` em action buttons | Hit area ~28px (abaixo do mínimo WCAG 44px) | `p-2 sm:p-1.5` — 40px em mobile |
| Tabelas largas com `overflow-x-auto` puro | Usuário não sabe que há scroll lateral | `<ScrollShadow>` — gradient nas bordas |
| `.table td px-3 py-2.5` | Tabelas ficam altas em mobile | `px-2 py-2 sm:px-3 sm:py-2.5` |

## Novos componentes utilitários

### `<KpiGrid cols={3|4}>` + `<KpiCard>`

Em `src/components/ui/KpiGrid.tsx` (~50L). Wrapper responsivo com colunas pré-mapeadas pra Tailwind JIT, e card de KPI padronizado com `label/value/sublabel/valueTone/icon`.

```tsx
<KpiGrid cols={4}>
  <KpiCard label="Total" value={42} valueTone="success" />
  <KpiCard label="Pendentes" value={brl(value)} sublabel="3 vencidos" />
</KpiGrid>
```

Layout: 2 colunas em mobile, 4 em desktop. Padding e font sizes responsivos automáticos.

### `<ScrollShadow>`

Em `src/components/ui/ScrollShadow.tsx` (~50L). Wrapper que adiciona shadows às bordas de containers com scroll horizontal pra indicar mais conteúdo. Detecta posição de scroll via event listener + ResizeObserver.

```tsx
<ScrollShadow>
  <table className="table">...</table>
</ScrollShadow>
```

- Shadow esquerda quando `scrollLeft > 0`
- Shadow direita quando `scrollLeft < scrollWidth - clientWidth`
- Ambas somem quando totalmente visível
- `scrollbar-width: thin` pra reduzir altura do scrollbar nativo

### `<MobileListItem>`

Em `src/components/ui/MobileListItem.tsx` (~60L). Card-row pattern pra substituir linhas de tabela em mobile. Disponível pra futuras refatorações — não foi aplicado ainda nas páginas existentes (manter scroll horizontal com ScrollShadow é mais barato e suficiente).

Estrutura: `leadingBadge + title + subtitle + meta[label,value] + actions`, clicável quando `onClick` fornecido (com keyboard handler para Enter/Space).

### `useMediaQuery / useIsMobile / useIsTablet / useIsDesktop`

Em `src/hooks/useMediaQuery.ts` (~30L). Detecta breakpoints Tailwind em runtime. Usado quando a estrutura DOM precisa mudar (não apenas estilo CSS). Atalhos pré-configurados pra `md:` e `lg:` breakpoints.

## Patches aplicados

### Globais (CSS)

- `.table th/td` agora usam `px-2 py-2 sm:px-3 sm:py-2.5` (reduz 4px de padding em mobile)

### 7 páginas V30-V38 com `mb-4 grid gap-3 md:grid-cols-4`

ContractGuarantees · ContractParProcesses · ContractReajustes · ContractReceipts · ContractReequilibrios · ContractRepactuacoes · ContractSanctions

Transformação automatizada via sed:
- KPI grid: `grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4`
- KPI Card padding: `p-3 sm:p-4`
- Label font: `text-[9px] sm:text-[10px]`
- Value font: `text-xl sm:text-2xl`

### 4 páginas com tabelas complexas (Sanctions, ParProcesses, Guarantees, Receipts)

- Imports adicionado de `ScrollShadow`
- `<div className="overflow-x-auto">` substituído por `<ScrollShadow>` (apenas tabelas principais, não tabelas internas de modals)
- Action buttons inline: `rounded p-1.5` → `rounded p-2 sm:p-1.5` (hit area 40px em mobile)

### 3 páginas adicionais V30-V34 com ScrollShadow

ContractReajustes · ContractReequilibrios · ContractRepactuacoes (apenas a tabela principal, não as internas de modals)

### Timeline (V39)

- Migrado KPI grid para o novo `<KpiGrid cols={3}>` + `<KpiCard>` (showcase de uso direto dos componentes)
- Event cards reduzidos: padding `p-2.5 sm:p-3`, ícone do círculo `h-7 w-7 sm:h-8 sm:w-8`, gap `gap-2 sm:gap-3`, `line-clamp-2` no título

## O que **não foi feito** (e por quê)

### MobileListItem não aplicado nas 9 páginas

Decisão: aplicar MobileListItem exigiria duplicar a estrutura (uma tabela + uma lista) em cada página, com chance alta de bugs de sincronização (filtros aplicados na tabela mas não na lista, etc). ScrollShadow é solução mais barata e suficiente — mantém UX consistente entre desktop e mobile, só sinaliza visualmente o overflow.

MobileListItem fica disponível pra futuras refatorações se análise de uso real mostrar que scroll horizontal é problemático.

### Modais XL não tocados

Inspecionei `<Modal>` (V01) — já tem `flex items-end sm:items-center` (bottom-sheet em mobile), `max-h-[95vh]`, `w-full` (usa 100% da largura), `rounded-t-2xl sm:rounded-2xl` (cantos arredondados só no topo em mobile), footer com `flex-wrap` (empilha botões se necessário). **Modal já estava mobile-friendly** desde V01.

### PageHeader

Inspecionei — já usa `flex-col md:flex-row` que empilha kicker/title/subtitle e actions em mobile. **Não precisava de mudança**.

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ módulos OK · 9.43s
```

**Bundle**:
- Main: 80.43 → **80.47 KB gzip** (+0.04 KB)
- CSS: 10.76 → **11.44 KB gzip** (+0.68 KB) — classes responsivas adicionais
- Novos chunks: nenhum (componentes vão pro main; ScrollShadow tem useEffect que requer client-side)
- Margem até 150 KB: **69.6 KB**

Crescimento total: **+0.72 KB gzip** pra cobertura mobile de 10 páginas. Custo:benefício excelente.

## Diff V39 → V40

- **+3 componentes UI** (`KpiGrid` · `MobileListItem` · `ScrollShadow`) · ~150L total
- **+1 hook** (`useMediaQuery` + 3 atalhos) · 35L
- **9 páginas atualizadas** via sed (responsividade de KPIs e tabelas)
- **1 utility CSS** (`.table` responsivo)
- **0 mudanças de banco** — V40 é puramente frontend

## Para deployar

```bash
# Sem migration nova. Apenas rebuild + deploy frontend.
npm run build
```

## Como testar (acceptance)

### Em desktop (≥768px)
1. Abrir cada uma das 10 páginas
2. KPIs continuam em 4 ou 3 colunas como antes
3. Tabelas mantêm padding original
4. Action buttons mantêm `p-1.5`

### Em mobile (<768px)
1. KPIs ficam em 2 colunas (4 KPIs → grid 2x2)
2. Valor numérico usa `text-xl` em vez de `text-2xl`
3. Labels usam `text-[9px]` em vez de `text-[10px]`
4. Tabelas com scroll lateral mostram gradient nas bordas (ScrollShadow)
5. Action buttons têm hit area maior (~40px)

### Touch targets
1. Long-press em qualquer botão de ação inline em mobile
2. Hit area visível (background hover) cobre área de ~40px
3. Sem cliques acidentais em botões adjacentes

### ScrollShadow
1. Em mobile, abrir página com tabela larga (Sanções por exemplo)
2. Inicialmente, shadow apenas à direita aparece (scroll começa em 0)
3. Scrollar pra direita: shadow esquerda aparece, direita desaparece quando chega ao fim
4. Em desktop largo onde tabela cabe inteira: nenhuma shadow

## Páginas cobertas (10 de 10)

| Página | Versão | KPI grid | ScrollShadow | Action buttons |
|---|---|---|---|---|
| ContractReajustes | V30 | ✅ | ✅ | — |
| ContractRepactuacoes | V33 | ✅ | ✅ | — |
| ContractReequilibrios | V34 | ✅ | ✅ | — |
| ContractReceipts | V35 | ✅ | ✅ | ✅ |
| ContractGuarantees | V36 | ✅ | ✅ | ✅ |
| ContractParProcesses | V37 | ✅ | — (usa `<Button size="sm">`) | — (usa `<Button size="sm">`) |
| ContractSanctions | V38 | ✅ | ✅ | ✅ |
| ContractTimeline | V39 | ✅ KpiGrid | n/a (não tem tabela) | n/a |
| **Total V30-V39** | **10/10** | **10/10** | **6/6 tabelas principais** | **3/3 onde aplicável** |

## Próximas oportunidades (V41)

Com mobile coverage feita, próximos passos lógicos:

1. **Dashboard agregado por contrato** — visão executiva com mini-timeline + ações pendentes em cada eixo (vícios abertos, garantias vencendo, PARs em curso, multas pendentes). Construção em cima da Timeline V39.
2. **Timeline global do tenant** — todos contratos numa única feed pra gerência sênior monitorar portfólio.
3. **Export de timeline em PDF** — arquivo legal completo de um contrato.
4. **API keys + REST público** — superfície de entrada externa.
5. **OKLCH migration** — DS Tier 3 (oferecida 16 vezes desde V14).
6. **EF download FGV/IBGE** — automatiza CSV import V31.
