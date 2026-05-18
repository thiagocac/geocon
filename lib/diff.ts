/**
 * V58 — Diff de texto baseado em LCS (Longest Common Subsequence).
 *
 * Para uso em comparação de revisões de documentos GED (extracted_text).
 * Roda em O(m*n) tempo e memória — suficiente para textos OCR-extraídos de
 * PDFs típicos (~1000-5000 linhas). Para textos maiores, considerar
 * Myers diff (mais complexo, mas O(N+D) onde D = tamanho do diff).
 *
 * Não usa bibliotecas externas (diff-match-patch pesa ~15KB; jsdiff ~12KB).
 * Implementação manual: ~60 linhas, ~1KB minified.
 */

export type DiffOpKind = 'equal' | 'insert' | 'delete';

export interface DiffLine {
  kind: DiffOpKind;
  /** Número da linha em A (null se foi inserida em B) */
  lineA: number | null;
  /** Número da linha em B (null se foi removida) */
  lineB: number | null;
  /** Conteúdo da linha */
  content: string;
}

export interface DiffStats {
  added:     number;
  removed:   number;
  unchanged: number;
  total:     number;
}

/**
 * Normaliza texto cru extraído de PDF: trim global, remove linhas vazias
 * múltiplas (>1 vazia consecutiva), normaliza CRLF→LF.
 */
function normalizeText(s: string): string[] {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .split('\n');
}

/**
 * Computa o diff linha-a-linha entre dois textos.
 * Retorna sequência ordenada de operações que transforma A em B.
 */
export function diffLines(textA: string, textB: string): {
  ops: DiffLine[];
  stats: DiffStats;
} {
  const a = normalizeText(textA);
  const b = normalizeText(textB);
  const m = a.length;
  const n = b.length;

  // Tabela LCS: dp[i][j] = comprimento da LCS dos prefixos a[0..i] e b[0..j]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack: reconstruir operações
  const ops: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ kind: 'equal', lineA: i, lineB: j, content: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ kind: 'insert', lineA: null, lineB: j, content: b[j - 1] });
      j--;
    } else {
      ops.push({ kind: 'delete', lineA: i, lineB: null, content: a[i - 1] });
      i--;
    }
  }
  ops.reverse();

  // Estatísticas
  let added = 0, removed = 0, unchanged = 0;
  for (const op of ops) {
    if (op.kind === 'insert')      added++;
    else if (op.kind === 'delete') removed++;
    else                            unchanged++;
  }

  return {
    ops,
    stats: { added, removed, unchanged, total: ops.length },
  };
}

/**
 * Converte ops em pares side-by-side (linha_a, linha_b) para renderização
 * em 2 colunas. Linhas adicionadas têm coluna A vazia; removidas têm B vazia.
 */
export function diffToSideBySide(ops: DiffLine[]): Array<{
  kind: DiffOpKind;
  lineA: { num: number; content: string } | null;
  lineB: { num: number; content: string } | null;
}> {
  return ops.map((op) => {
    if (op.kind === 'equal') {
      return {
        kind: 'equal',
        lineA: { num: op.lineA!, content: op.content },
        lineB: { num: op.lineB!, content: op.content },
      };
    }
    if (op.kind === 'delete') {
      return {
        kind: 'delete',
        lineA: { num: op.lineA!, content: op.content },
        lineB: null,
      };
    }
    return {
      kind: 'insert',
      lineA: null,
      lineB: { num: op.lineB!, content: op.content },
    };
  });
}
