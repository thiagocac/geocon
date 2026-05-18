# V49 — Completar Pendencias V35-V38

V49 fecha o débito órfão da migration 047 (criada em V42, preservada por 7 versões). A migration adiciona 5 novos tipos de pendência à `v_pendencias` cobrindo institutos V35-V38 (vícios, PARs, garantias, sanções, recebimentos definitivos). A UI base ficou parcialmente atualizada nas sessões anteriores; V49 entrega a **finalização completa** com agrupamento visual, KPIs por categoria, export CSV e mock data extension.

## Estado herdado

Inspecionando o codebase ao entrar em V49:

- ✅ Migration 047 já existe (não-órfã, está em sequência válida entre 046-048)
- ✅ Type union em `api.ts` cobre os 9 tipos
- ✅ `PENDENCIA_META` em Pendencias.tsx cobre os 9 tipos com ícones (Shield, Gavel, Hammer)
- ✅ Filter chips dinâmicos por `Object.keys(PENDENCIA_META)`
- ✅ Contagens por tipo no `counts` memo
- ❌ Mock data tem apenas 4 dos 9 tipos (demo mode SKIP_AUTH não exibe novos tipos)
- ❌ Sem agrupamento visual — chips dos 9 tipos numa linha só, sem distinção operação vs Lei 14.133
- ❌ Sem KPIs específicos por categoria
- ❌ Sem export CSV das pendências

V49 entrega os 4 gaps acima.

## Mudanças

### `api.ts` · MOCK_PENDENCIAS estendida

Adicionados 5 exemplos realistas (1 por tipo novo) para que demo mode (`SKIP_AUTH=true`) exiba a página completa:

- `vicio_aberto` · severidade alta · 12 dias
- `par_defesa` · severidade média · prazo limite definido
- `garantia_vencendo` · severidade alta · vencendo em 6 dias
- `sancao_multa_pendente` · severidade alta · R$ 245.000,00 não paga
- `recebimento_definitivo_atrasado` · severidade média · provisório de agosto sem definitivo

Mock total agora cobre 9 pendências distribuídas em 5 contratos.

### `Pendencias.tsx` · agrupamento visual

Nova constante `PENDENCIA_GROUP` mapeia cada tipo para categoria:
- **Operação corrente**: medições, GRDs, não previstos, risco financeiro (tipos V12)
- **Lei 14.133**: vícios, PARs, garantias, multas, definitivos atrasados (tipos V35-V38)

Nova constante `PENDENCIA_TYPES_ORDER` mantém ordem visual estável (não depende de `Object.keys` order).

### KPIs por categoria

Acima do bloco de filter chips, 2 cards lado a lado:
- **Operação corrente** (azul) — soma dos 4 tipos clássicos · ícone ClipboardList
- **Lei 14.133** (magenta) — soma dos 5 tipos novos · ícone ScrollText

Ambos com sublabel listando os tipos incluídos. Complementam (não substituem) os 4 KPIs por severidade que existiam.

### Filter chips agrupados

Card de filtros restruturado em 3 blocos verticais:
1. Chip "Todos os tipos" no topo
2. Bloco "Operação corrente" (label azul, 4 chips: medição · GRD · não previsto · risco)
3. Bloco "Lei 14.133" (label magenta, 5 chips: vício · PAR · garantia · multa · definitivo)

Cada chip mantém ícone + count. Comportamento de toggle inalterado.

### Export CSV

Novo botão "Exportar CSV" no PageHeader (visível só quando há pendências filtradas).

Formato (8 colunas, separador `;`, BOM UTF-8):
```csv
contract_numero;pendencia_tipo;tipo_label;categoria;descricao;severidade;dias_aberta;desde
CT-2024/0042;medicao_aprovacao;Aprovação de medição;Operação corrente;"Medição n.º 7...";medium;18;2025-10-27T10:00:00Z
CT-2024/0211;vicio_aberto;Vício em recebimento;Lei 14.133;"Vício \"Concreto fora de fck\"...";high;12;2025-11-02T09:00:00Z
```

- `categoria` é dinâmica do `PENDENCIA_GROUP`
- `descricao` com aspas duplas duplicadas (escape CSV correto)
- Filename `pendencias_YYYY-MM-DD.csv`
- BOM para Excel detectar encoding

Respeita filtros aplicados (tipo + severidade).

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ 1769 módulos
```

**Bundle**:
- Main: 83.26 → **84.44 KB gzip** (+1.18 KB)
- Margem até 150 KB: **65.56 KB**

Pendencias está no main bundle (rota frequente, não vale tornar lazy).

## Diff V48 → V49

- **api.ts**: +5 entries em MOCK_PENDENCIAS (~10 linhas)
- **Pendencias.tsx**:
  - +2 const (PENDENCIA_GROUP, PENDENCIA_TYPES_ORDER)
  - +1 import (Download, ScrollText, Button)
  - counts: +2 totais (operacao_total, lei14133_total) via spread (-9 linhas duplicadas, +reorganização)
  - +1 função (exportCsv ~25 linhas)
  - JSX: +1 botão no header, +2 KPI cards, +reorganização de filter chips em 2 grupos

Total: ~150 linhas líquidas adicionadas, +1.18 KB main bundle.

## Decisões arquiteturais

### Por que 2 KPIs categóricos em vez de 9 KPIs por tipo?

KPIs no topo são **navegação rápida** — clicar em "Alta severidade" filtra; clicar em "Operação corrente" não filtra mas dá o "olhar 10s" de quem entra na página.

Se fossem 9 KPIs (um por tipo), seriam 3 linhas de cards e a página inteira viraria scroll antes mesmo da tabela. Dois KPIs categóricos resumem em 1 linha extra acima dos chips.

### Por que chips em 2 blocos rotulados em vez de 1 grupo único?

Antes do agrupamento, 9 chips lado a lado pareciam **lista heterogênea sem hierarquia**. Visualmente, "Multa pendente" e "GRD recebimento" são ações de naturezas diferentes — uma é compliance regulatório, outra é fluxo operacional.

Labels coloridos (azul/magenta) reforçam a separação sem precisar de bordas pesadas. Manter o chip "Todos os tipos" fora dos grupos preserva o atalho de reset.

### Por que ordem estável via PENDENCIA_TYPES_ORDER em vez de Object.keys?

`Object.keys` preserva ordem de inserção em JS moderno, mas:
1. É frágil — refator de PENDENCIA_META poderia reordenar inadvertidamente
2. Não funciona se quisermos a mesma ordem em 2 lugares (counts e chips)
3. Constante nomeada explicita intenção e facilita revisão

### Por que mock data com casos realistas (não placeholder)?

Demo mode é usado para:
1. Onboarding de novos usuários
2. Screenshots de marketing
3. Desenvolvimento local sem Supabase

Mock placeholder ("Pendência exemplo 1") prejudica todos esses casos. Mock realista (CNPJ formatado, valores em R$, descrições com contexto Lei 14.133) é vendável **e** fiel ao que o user verá em produção.

### Por que export CSV e não export PDF (padrão V44)?

PDF é overkill para uma lista filtrável. Use case típico do export aqui:
- Levar pra reunião de governança / risk committee
- Filtrar no Excel / Sheets
- Anexar em email de followup

CSV resolve todos. Adicionar PDF seria custo de novo HTML template + Puppeteer roundtrip sem ganho proporcional. Pode ser adicionado depois se demandado.

## Como testar (acceptance)

### Demo mode (SKIP_AUTH=true)
1. Login bypass → `/pendencias`
2. Total: **9 pendências** (era 4 antes do V49)
3. KPIs: Alta=5, Média=3, Baixa=0
4. Card "Operação corrente": 4
5. Card "Lei 14.133": 5
6. Filter chips agrupados em 2 blocos com labels coloridos

### Filtros
1. Clicar chip "Vício em recebimento" → tabela mostra 1 entry
2. Clicar "Alta severidade" + "Vício em recebimento" → 1 entry (intersect)
3. Clicar "Todos os tipos" → reset filtro tipo (mantém severidade)
4. KPIs categóricos NÃO filtram (são readonly informativos)

### Export CSV
1. Sem filtro → click "Exportar CSV"
2. Arquivo `pendencias_2026-05-16.csv` baixa
3. Abrir no Excel — colunas separadas corretamente, acentos OK (BOM UTF-8)
4. `descricao` com aspas duplas se preserva (escape `""`)
5. Filtrar por "Lei 14.133" → export tem só 5 linhas

### Em produção (banco real)
1. Migration 047 já aplicada (rodou desde V42)
2. Inserir vício, PAR em defesa, garantia <60d, multa não paga, provisório >90d sem definitivo
3. Refresh `/pendencias` → tudo aparece com tipo correto
4. Drill-down por chip funciona; click em row leva à página entity correta

## Retrospectiva V30 → V49 (20 versões)

| Versão | Tema | Mig | Bundle main |
|---|---|---|---:|
| V30-V38 | Lei 14.133 (9 institutos) | 036-044 | 75.13 → 80.03 |
| V39 | Timeline por contrato | 045 | 80.43 |
| V40 | Mobile audit | — | 80.47 |
| V41 | Dashboard por contrato | 046 | 80.94 |
| V42 | Timeline global tenant | 048 | 81.43 |
| V43 | Dashboard global tenant | 049 | 84.13 |
| V44 | Export Timeline PDF | 051 | 84.44 |
| V45 | Fornecedores sancionados | 052 | 84.89 |
| V46 | API keys + REST público | 053 | 85.24 |
| V47 | Email digest de alertas | 054 | 83.13 ⬇ |
| V48 | Download IBGE | 055 | 83.26 |
| **V49** | **Completar Pendencias** | — | **84.44** |

Bundle main **+9.31 KB gzip** em 20 versões. **0 typecheck errors** em todas.

V49 é a **primeira versão sem nova migration** desde V40 (mobile audit, 9 versões atrás). É puramente trabalho frontend de UX + finalização de débito.

## Próximas oportunidades (V50+)

2 itens da lista V41 restantes:

6. ~~OKLCH migration~~ — declinada 18× desde V14
10. **Completar Carteira V12** — migration 050 órfã + release-v43-prior — Portfolio.tsx mostra apenas valores básicos, falta integrar 5 KPIs Lei 14.133 por programa/órgão/município ← próximo natural

**Possíveis extensões V49**:
- Bulk action: "Atribuir N pendências a usuário X" (atribuição manual)
- Export PDF estilo timeline (V44)
- Salvar preset de filtro por papel (admin tem filtros default diferentes de gestor)
- Drill-down por contrato (agrupamento de pendências por contract_numero)
- Coluna "Atribuído a" mostrando quem deveria atuar (de members ou organizations)

**V50 sugerido**: **Completar Carteira V12** (item 10). Trabalho focado — migration 050 já completa em release-v43-prior; Portfolio.tsx precisa renderizar:
- KPI vícios graves por programa
- KPI PARs em curso por programa
- KPI garantias vencendo por programa
- KPI multas pendentes por programa
- KPI definitivos atrasados por programa

Visão consolidada que complementa as views V43 (tenant dashboard, KPIs globais) com **breakdown por dimensão de carteira** (programa, órgão executor, município).
