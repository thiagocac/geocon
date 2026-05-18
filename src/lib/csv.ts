/**
 * V71 — Export utilitário para CSV.
 *
 * Sem dependências externas. Faz escape de aspas, vírgulas e quebras de linha
 * conforme RFC 4180. Bom para auditor externo que precisa de planilha.
 *
 * Uso:
 *   exportToCsv('historico.csv', [
 *     { col_a: 'val1', col_b: 12.5, col_c: 'texto, com vírgula' },
 *     ...
 *   ], { col_a: 'Coluna A', col_b: 'Valor', col_c: 'Descrição' });
 */

/** Escape campo conforme RFC 4180 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Se contém vírgula, aspas ou quebra, embrulha em aspas duplas e dobra aspas internas
  if (/["\n\r,;]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function generateCsv<T extends Record<string, unknown>>(
  rows: T[],
  headers: Partial<Record<keyof T, string>>,
): string {
  const cols = Object.keys(headers) as Array<keyof T>;
  const lines: string[] = [];
  // Header — UTF-8 BOM para Excel detectar corretamente
  lines.push(cols.map((c) => csvField(headers[c])).join(','));
  for (const row of rows) {
    lines.push(cols.map((c) => csvField(row[c])).join(','));
  }
  return '\uFEFF' + lines.join('\n');
}

export function downloadCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  headers: Partial<Record<keyof T, string>>,
): void {
  const csv = generateCsv(rows, headers);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Download direto de Blob com filename. Para PDF e outros.
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
