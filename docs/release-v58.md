# V58 — Diff entre revisões GED

V58 abre a primeira capacidade analítica sobre o **conteúdo** dos documentos
GED, não só sobre metadados. Permite comparar textualmente 2 revisões
(R01 vs R02 vs R03) lado-a-lado, identificando o que mudou.

## Contexto

V52 já tinha a EF `extract-pdf-text` que popula `ged_document_versions.extracted_text`
com OCR (pdf.js) ou texto digital extraído de PDFs. O dado estava lá, mas não
era usado para nada além de FTS.

V58 ativa esse dado para auditoria visual: diff side-by-side mostrando
adições, remoções e linhas mantidas entre revisões. Útil para:

- **Auditoria de revisão**: "o que mudou no memorial descritivo entre R02 e R03?"
- **Compliance**: aprovador externo (magic link) consegue ver delta antes de aprovar
- **Histórico forense**: identificar quando uma cláusula específica foi adicionada/removida

## O que V58 entrega

### 1. `src/lib/diff.ts` — algoritmo LCS

Implementação manual de diff linha-a-linha baseada em **LCS** (Longest Common
Subsequence). ~60 linhas de TypeScript, ~1KB minified, **zero dependências
externas**.

```ts
export function diffLines(textA: string, textB: string): {
  ops: DiffLine[];
  stats: DiffStats;
};

export type DiffOpKind = 'equal' | 'insert' | 'delete';

export interface DiffLine {
  kind: DiffOpKind;
  lineA: number | null;   // null se inserida em B
  lineB: number | null;   // null se removida
  content: string;
}

export interface DiffStats {
  added, removed, unchanged, total: number;
}

export function diffToSideBySide(ops: DiffLine[]): Array<{
  kind, lineA, lineB
}>;
```

**Normalização**: CRLF→LF, remove linhas vazias múltiplas, trim global.

**Complexidade**: O(m·n) tempo e memória. Adequado para documentos extraídos
de PDFs típicos (~1000-5000 linhas, < 100KB). Para documentos maiores,
upgrade para Myers diff é direto.

**Alternativas descartadas**:
- `diff-match-patch` (Google) — ~15KB gzip, robusto mas overkill para line-level
- `jsdiff` — ~12KB gzip, idem
- Implementação manual ganha em footprint sem perder qualidade para o caso de uso

### 2. API helper

```ts
export async function getGedVersionExtractedText(versionId): Promise<{
  id, revision, extracted_text, uploaded_at
} | null>;
```

Retorna apenas os 4 campos necessários para o diff — não traz storage_path,
hash, mime_type, etc. Otimização: economiza payload quando documento tem
versões grandes.

### 3. Página `/ged/documentos/:docId/diff` (lazy chunk 7.7 KB raw)

**Layout**:

- **Seletores topo** com `<ArrowLeftRight />` ícone:
  - "Revisão A (antes)" + "Revisão B (depois)" — cada um com Select listando
    `Rev. N · DD/MM/YYYY · [vigente]`
  - Default: B = mais recente, A = anterior

- **4 stat cards**: Total · Adicionadas (verde) · Removidas (vermelho) · Mantidas

- **Diff table** — 2 colunas grid, scroll vertical max-h-70vh:
  - Coluna A (revisão anterior) com fundo `bg-error/10` em linhas removidas
  - Coluna B (revisão nova) com fundo `bg-success/10` em linhas adicionadas
  - Linhas iguais aparecem nas 2 colunas, fundo neutro
  - Cada célula tem: número da linha · marker (+/−/espaço) · conteúdo
  - Marker bold com cor: + verde, − vermelho

**Edge cases tratados**:
- Documento com 1 só revisão → Empty state com link para "Nova revisão"
- Versão sem `extracted_text` → Alert "Reprocesse a extração"
- Sem revisões selecionadas → form em modo seletor

### 4. Integração no `GedDocument()` detail

Botão **"Comparar revisões"** com ícone `GitCompare` aparece no header só
quando há **≥ 2 revisões** (renderização condicional). Link relativo `diff`.

### 5. Mocks SKIP_AUTH — 3 revisões realistas de memorial descritivo

Atualizei `MOCK_VERSIONS` para `doc-1` com `extracted_text` populado de 3
revisões de **Memorial Descritivo do Bloco Cirúrgico**. Mostram evolução real
do escopo da obra:

| Rev | Adições principais |
|---|---|
| R01 | Escopo inicial mínimo · 3 disciplinas (estrutura, alvenaria, elétrico) |
| R02 | + ala recuperação, especificações detalhadas, normas NBR 7117 e RDC 50, 6 itens técnicos |
| R03 | + sala híbrida, fck=30 (era 25), filtros HEPA H14 (era H13), HVAC pressão positiva, prazo 240d (era 180), normas NBR 7256, 8 itens técnicos |

Demo: ao abrir `/ged/documentos/doc-1/diff` em SKIP_AUTH, compara R02 vs R03
automaticamente e mostra ~15 linhas adicionadas, 5 removidas, 12 mantidas.

## Decisões

1. **LCS manual, não lib externa** — 1KB vs 12-15KB. Para diff line-level de
   documentos PDF extraídos, LCS é mais que suficiente. Myers seria upgrade
   se virar gargalo (não é hoje).

2. **Line-level, não char-level ou word-level** — documentos engenharia são
   estruturados em linhas (cláusulas, normas, especificações). Char-level
   produziria ruído visual em mudanças sutis.

3. **`useMemo` para diff** — evita recomputar O(m·n) em rerenders sem mudança
   nos textos. Dependências explícitas: `versionA.extracted_text` + `versionB.extracted_text`.

4. **Cliente-side, não server-side** — backend sem lógica de diff. O texto
   já está armazenado; comparar é trabalho do navegador. Trade-off: documentos
   muito grandes (>5000 linhas) podem causar lentidão; usuário pode salvar
   trecho específico antes de fazer diff completo.

5. **2 selects independentes** — em vez de "A = R02, B = R03" fixo, deixa
   usuário escolher (ex.: "compara R01 com R03 pulando R02"). Útil para
   auditoria forense.

6. **Renderização condicional do botão** — só aparece com ≥ 2 revisões. Evita
   navegar para Empty state desnecessariamente.

7. **Normalização CRLF + linhas vazias** — PDFs extraídos têm formatação
   inconsistente. Sem normalização, diff teria muito ruído.

8. **Status "vigente" no label da rev** — diferencia visualmente qual é a
   atual sem cor especial. Mantém UI limpa.

## Bundle V57 → V58

| Chunk | V57 | V58 | Δ |
|---|---:|---:|---:|
| Main | 97.50 | **98.23** | +0.73 |
| Diff page (lazy) | — | 7.7 KB raw | — |

Margem 150 − 98.23 = **51.77 KB**. Custo no main: API helper (~30 linhas).
Página + algoritmo de diff (~250+60 linhas) ficam em chunk lazy separado.

## Sequência V54-V58

| Versão | Área | Tema | Bundle | Δ |
|---|---|---|---:|---:|
| V54 | Medição | Validações automáticas (6 regras) | 92.69 | +2.25 |
| V55 | SOV | Curva ABC + Pareto | 94.63 | +1.94 |
| V56 | GED | Validade temporal + cron diário | 95.79 | +1.16 |
| V57 | SOV | Auditoria preços SINAPI/SICRO | 97.50 | +1.71 |
| V58 | GED | Diff entre revisões | 98.23 | +0.73 |

V58 menor bundle delta da série — mostra que arquitetura modular (lazy chunks)
preserva orçamento bem.

## Próximas oportunidades (V59+)

**GED**:
1. **Painel KPI do acervo GED** (~300 linhas) — view + dashboard com 8 métricas:
   docs por categoria, % obsoletos, ratio aprovado/em_revisao, taxa de uso (downloads/30d),
   docs sem versão extraída, % com validade definida.
2. **Workflow aprovação de revisão GED** (~500 linhas) — reusa pattern
   measurement_approval_steps + magic link. Submit R02 → aprovador → publica.
3. **Marca d'água "CÓPIA NÃO CONTROLADA"** (~300 linhas) — Edge Function que
   adiciona overlay + assinatura ICP-Brasil opcional.

**Medição**:
4. **Apontamento campo mobile-first** (~600 linhas) — feature grande.

**SOV**:
5. **Composições de preço explícitas** (~400 linhas).

Para próxima versão, **(1) Painel KPI** é quick win analítico que complementa
a sequência V54-V58 (todas analíticas). **(2) Workflow aprovação** é estratégico
mas grande. Continuar com qual?
