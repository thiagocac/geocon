/**
 * Parser de planilha contratual (SOV) para o ImportWizard.
 *
 * Suporta:
 *   - .xlsx / .xls / .ods (via SheetJS)
 *   - .csv (via SheetJS — autodetecta separador)
 *
 * Reconhecimento de hierarquia:
 *   - Inferida a partir do CÓDIGO (ex: "01" → nível 1, "01.001" → 2, "01.001.A" → 3).
 *   - Cada separador "." aumenta um nível. Limite de 5.
 *   - Linhas com quantidade zero/vazia + descrição em CAIXA ALTA OU sem unidade
 *     são consideradas TÍTULO (is_title=true) e não recebem medição direta.
 */
import * as XLSX from 'xlsx';

export interface RawRow {
  [key: string]: unknown;
}

export interface ParsedItem {
  rowIndex: number;
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade_contratada: number;
  preco_unitario: number;
  bdi_percentual: number;
  fonte_referencia: string;
  nivel: number;
  is_title: boolean;
  errors: string[];
}

export type ColumnKey = 'codigo' | 'descricao' | 'unidade' | 'quantidade' | 'preco_unitario' | 'bdi' | 'fonte' | 'ignore';

export interface ColumnMapping {
  [originalHeader: string]: ColumnKey;
}

/** Lê o arquivo e devolve cabeçalhos + linhas crus. */
export async function readSpreadsheet(file: File): Promise<{ headers: string[]; rows: RawRow[]; sheetName: string }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false, raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Planilha sem abas');
  const sheet = wb.Sheets[sheetName];

  // header:1 nos dá array-of-arrays — escolho header dinâmico
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' });
  if (aoa.length === 0) return { headers: [], rows: [], sheetName };

  // Detecta linha do cabeçalho: primeira linha com >= 3 strings não-vazias.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const r = aoa[i] || [];
    const stringCount = r.filter((c) => typeof c === 'string' && c.toString().trim().length > 0).length;
    if (stringCount >= 3) { headerIdx = i; break; }
  }

  const headerRaw = aoa[headerIdx] || [];
  const headers: string[] = headerRaw.map((h, i) => {
    const s = (h || '').toString().trim();
    return s || `coluna_${i + 1}`;
  });

  const rows: RawRow[] = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const obj: RawRow = {};
    headers.forEach((h, j) => { obj[h] = r[j] ?? ''; });
    // ignora linha completamente vazia
    if (headers.every((h) => !String(obj[h] ?? '').trim())) continue;
    rows.push(obj);
  }

  return { headers, rows, sheetName };
}

/** Tenta inferir mapeamento automático com base nos nomes de coluna. */
export function inferMapping(headers: string[]): ColumnMapping {
  const out: ColumnMapping = {};
  for (const h of headers) {
    const lh = normalize(h);
    if      (/^(codigo|cod|item|n)$/.test(lh) || lh.includes('codigo')) out[h] = 'codigo';
    else if (/^(descricao|descrição|servico|serviço|titulo|título)$/.test(lh) || lh.includes('descric')) out[h] = 'descricao';
    else if (/^(un|und|unid|unidade)$/.test(lh) || lh.includes('unidade')) out[h] = 'unidade';
    else if (lh.includes('quantidade') || lh === 'qtd' || lh === 'qtde' || lh === 'quant') out[h] = 'quantidade';
    else if (lh.includes('preco unit') || lh.includes('preço unit') || lh.includes('valor unit') || lh.includes('custo unit') || lh === 'pu') out[h] = 'preco_unitario';
    else if (lh === 'bdi' || lh.includes('bdi')) out[h] = 'bdi';
    else if (lh.includes('referencia') || lh.includes('referência') || lh.includes('fonte')) out[h] = 'fonte';
    else out[h] = 'ignore';
  }
  return out;
}

function normalize(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Converte string para número aceitando vírgula como decimal e pontos como milhar. */
export function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  // Remove R$, espaços
  let n = s.replace(/[R$\s]/g, '');
  // Caso "1.234,56" → vírgula é decimal
  if (n.includes(',') && n.includes('.')) {
    n = n.replace(/\./g, '').replace(',', '.');
  } else if (n.includes(',')) {
    n = n.replace(',', '.');
  }
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Infere nível hierárquico a partir do código.
 * Estratégias (na ordem):
 *   - Conta separadores "." (1 ponto = nível 2; 2 pontos = nível 3; ...)
 *   - Se sem ponto, usa profundidade do separador "-"
 *   - Padrões 01/01.01/01.01.001/01.01.001.1 são automáticos
 *   - Capado em 5
 */
export function inferNivel(codigo: string): number {
  const c = codigo.trim();
  if (!c) return 1;
  if (c.includes('.')) return Math.min(c.split('.').length, 5);
  if (c.includes('-')) return Math.min(c.split('-').length, 5);
  return 1;
}

/** É linha de título? (sem qtd ou sem preço, ou descrição em caixa alta) */
function detectTitle(descricao: string, qtd: number, preco: number): boolean {
  if (qtd > 0 || preco > 0) return false;
  const d = descricao.trim();
  if (!d) return true;
  // Heurística: descrição em caixa alta + curta = título
  const isUpper = d === d.toUpperCase() && /[A-Z]/.test(d);
  return isUpper && d.length <= 80;
}

/** Aplica o mapeamento a uma linha e produz item normalizado + erros. */
function rowToItem(row: RawRow, mapping: ColumnMapping, rowIndex: number): ParsedItem {
  const get = (key: ColumnKey): unknown => {
    for (const [h, k] of Object.entries(mapping)) {
      if (k === key) return row[h];
    }
    return undefined;
  };

  const codigo = String(get('codigo') ?? '').trim();
  const descricao = String(get('descricao') ?? '').trim();
  const unidade = String(get('unidade') ?? '').trim().toUpperCase().slice(0, 10);
  const quantidade = toNumber(get('quantidade'));
  const preco = toNumber(get('preco_unitario'));
  const bdi = toNumber(get('bdi'));
  const fonteRaw = String(get('fonte') ?? '').trim().toUpperCase();

  const errors: string[] = [];
  const is_title = detectTitle(descricao, quantidade, preco);

  if (!codigo) errors.push('Código vazio');
  if (!descricao) errors.push('Descrição vazia');
  if (!is_title) {
    if (!unidade) errors.push('Unidade vazia');
    if (quantidade <= 0) errors.push('Quantidade ≤ 0');
    if (preco <= 0) errors.push('Preço unitário ≤ 0');
  }

  const fonte = ['SINAPI', 'SICRO', 'ORSE', 'SEDOP'].includes(fonteRaw) ? fonteRaw : 'proprio';

  return {
    rowIndex,
    codigo, descricao, unidade,
    quantidade_contratada: quantidade,
    preco_unitario: preco,
    bdi_percentual: bdi,
    fonte_referencia: fonte,
    nivel: inferNivel(codigo),
    is_title,
    errors,
  };
}

/** Processa as linhas com base no mapeamento. */
export function parseRows(rows: RawRow[], mapping: ColumnMapping): ParsedItem[] {
  return rows.map((r, i) => rowToItem(r, mapping, i + 1));
}

/** Estatísticas para o resumo do wizard. */
export function summarize(items: ParsedItem[]): {
  total: number; valid: number; errors: number; titles: number;
  valor_total: number;
  errors_by_row: Array<{ rowIndex: number; codigo: string; descricao: string; errors: string[] }>;
} {
  const errors_by_row = items
    .filter((i) => i.errors.length > 0)
    .slice(0, 50)
    .map((i) => ({ rowIndex: i.rowIndex, codigo: i.codigo, descricao: i.descricao, errors: i.errors }));
  const valor_total = items
    .filter((i) => !i.is_title && i.errors.length === 0)
    .reduce((s, i) => s + i.quantidade_contratada * i.preco_unitario, 0);
  return {
    total: items.length,
    valid: items.filter((i) => i.errors.length === 0).length,
    errors: items.filter((i) => i.errors.length > 0).length,
    titles: items.filter((i) => i.is_title).length,
    valor_total,
    errors_by_row,
  };
}
