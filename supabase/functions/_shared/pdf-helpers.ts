/**
 * Utilitários compartilhados para geração de boletins PDF.
 * - Conversão WOFF1 → SFNT (TTF/OTF) para embedar Inter no pdf-lib
 * - Helpers de formatação BR (datas, moeda, número)
 * - Valor por extenso (escrita por extenso em PT-BR para o Campo 15)
 */

/**
 * Decodifica WOFF1 → SFNT. WOFF1 = header(44b) + table directory + dados deflate.
 * pdf-lib + fontkit aceitam TTF/OTF; precisamos descompactar primeiro.
 */
export async function woffToSfnt(woffBytes: Uint8Array): Promise<Uint8Array> {
  const dv = new DataView(woffBytes.buffer, woffBytes.byteOffset, woffBytes.byteLength);
  const sig = dv.getUint32(0, false);
  if (sig !== 0x774f4646) throw new Error('Não é WOFF1');
  const flavor = dv.getUint32(4, false);
  const numTables = dv.getUint16(12, false);
  const totalSfntSize = dv.getUint32(16, false);

  type Entry = { tag: number; offset: number; compLength: number; origLength: number; origChecksum: number };
  const entries: Entry[] = [];
  let p = 44;
  for (let i = 0; i < numTables; i++) {
    entries.push({
      tag: dv.getUint32(p + 0, false),
      offset: dv.getUint32(p + 4, false),
      compLength: dv.getUint32(p + 8, false),
      origLength: dv.getUint32(p + 12, false),
      origChecksum: dv.getUint32(p + 16, false),
    });
    p += 20;
  }

  let entrySelector = 0;
  while ((1 << (entrySelector + 1)) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  const rangeShift = numTables * 16 - searchRange;

  const out = new Uint8Array(totalSfntSize);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, flavor, false);
  outDv.setUint16(4, numTables, false);
  outDv.setUint16(6, searchRange, false);
  outDv.setUint16(8, entrySelector, false);
  outDv.setUint16(10, rangeShift, false);

  let dataOffset = 12 + numTables * 16;
  const pad4 = (n: number) => (n + 3) & ~3;
  dataOffset = pad4(dataOffset);

  let dirP = 12;
  for (const e of entries) {
    const compBytes = woffBytes.subarray(e.offset, e.offset + e.compLength);
    let tableData: Uint8Array;

    if (e.compLength === e.origLength) {
      tableData = compBytes;
    } else {
      const ds = new DecompressionStream('deflate');
      const blob = new Blob([compBytes]);
      tableData = new Uint8Array(await new Response(blob.stream().pipeThrough(ds)).arrayBuffer());
    }

    out.set(tableData, dataOffset);
    outDv.setUint32(dirP + 0, e.tag, false);
    outDv.setUint32(dirP + 4, e.origChecksum, false);
    outDv.setUint32(dirP + 8, dataOffset, false);
    outDv.setUint32(dirP + 12, e.origLength, false);
    dirP += 16;
    dataOffset = pad4(dataOffset + e.origLength);
  }
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatBrl(v: number): string {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatNum(v: number, digits = 2): string {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const s = iso.slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export function diffDays(from: string, to: string): number {
  const d1 = new Date(from + 'T12:00:00').getTime();
  const d2 = new Date(to + 'T12:00:00').getTime();
  return Math.floor((d2 - d1) / 86400000);
}

// ---- Valor por extenso (PT-BR) - usado no Campo 15 do boletim ---------------
const UNI = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
             'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEN = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function trio(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (c > 0) parts.push(CEN[c]);
  if (r < 20) {
    if (r > 0) parts.push(UNI[r]);
  } else {
    const d = Math.floor(r / 10);
    const u = r % 10;
    parts.push(DEZ[d]);
    if (u > 0) parts.push(`e ${UNI[u]}`);
  }
  return parts.join(' e ');
}

/** Converte valor numérico para extenso em pt-BR (reais e centavos). */
export function valorPorExtenso(valor: number): string {
  if (!Number.isFinite(valor)) return 'zero reais';
  const negativo = valor < 0;
  const abs = Math.abs(valor);
  const reais = Math.floor(abs);
  const centavos = Math.round((abs - reais) * 100);

  function escreve(n: number, singular: string, plural: string, fem = false): string {
    if (n === 0) return '';
    const milhoes = Math.floor(n / 1_000_000);
    const milhares = Math.floor((n % 1_000_000) / 1000);
    const restante = n % 1000;
    const parts: string[] = [];

    if (milhoes > 0) {
      parts.push(milhoes === 1 ? 'um milhão' : `${trio(milhoes)} milhões`);
    }
    if (milhares > 0) {
      if (milhares === 1) parts.push('mil');
      else parts.push(`${trio(milhares)} mil`);
    }
    if (restante > 0) {
      const t = trio(restante);
      if (parts.length > 0) parts.push(restante < 100 || restante % 100 === 0 ? `e ${t}` : t);
      else parts.push(t);
    }
    const num = n === 1 ? singular : (n === 0 ? singular : plural);
    return parts.length === 0 ? '' : `${parts.join(' ')} ${num}`;
  }

  const partes: string[] = [];
  if (reais > 0) partes.push(escreve(reais, 'real', 'reais'));
  if (centavos > 0) {
    if (partes.length > 0) partes.push('e');
    partes.push(escreve(centavos, 'centavo', 'centavos'));
  }
  if (partes.length === 0) partes.push('zero reais');

  let txt = partes.join(' ').replace(/\s+/g, ' ').trim();
  if (negativo) txt = 'menos ' + txt;
  return txt;
}
