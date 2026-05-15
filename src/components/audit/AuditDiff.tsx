import { useMemo } from 'react';

type Json = unknown;

interface Props {
  before: Record<string, Json> | null;
  after: Record<string, Json> | null;
  metadata?: Record<string, Json>;
}

interface FieldDiff {
  field: string;
  before: Json;
  after: Json;
  kind: 'added' | 'removed' | 'changed' | 'unchanged';
}

/**
 * Tradução curta para nomes de campos comuns em pt-BR.
 * Quando o campo não estiver mapeado, mostramos o nome cru.
 */
const FIELD_LABEL: Record<string, string> = {
  status: 'Status',
  valor_inicial: 'Valor inicial',
  valor_atual: 'Valor atual',
  valor_aditado: 'Valor aditado',
  valor_medido: 'Valor medido',
  valor_liquido: 'Valor líquido',
  saldo_contratual: 'Saldo',
  data_assinatura: 'Data de assinatura',
  data_ordem_inicio: 'Data da ordem de início',
  data_termino: 'Data de término',
  data_termino_prevista: 'Data de término prevista',
  numero: 'Número',
  objeto: 'Objeto',
  quantidade: 'Quantidade',
  preco_unitario: 'Preço unitário',
  observacoes: 'Observações',
  comentario: 'Comentário',
  motivo: 'Motivo',
  prazo_dias: 'Prazo (dias)',
  ordem: 'Ordem',
  ativo: 'Ativo',
  active: 'Ativo',
  role: 'Papel',
  roles: 'Papéis',
  papel: 'Papel',
  email: 'E-mail',
  nome: 'Nome',
  signature_method: 'Método de assinatura',
  finalidade: 'Finalidade',
  revisao: 'Revisão',
  versao: 'Versão',
  hash_sha256: 'Hash SHA-256',
  contract_id: 'ID do contrato',
  measurement_id: 'ID da medição',
};

function fmtValue(v: Json): { display: string; mono: boolean } {
  if (v === null || v === undefined) return { display: '—', mono: true };
  if (typeof v === 'boolean') return { display: v ? 'verdadeiro' : 'falso', mono: false };
  if (typeof v === 'number') {
    // Heurística: valores grandes formato BR; pequenos com decimais quando há
    if (Number.isInteger(v) && Math.abs(v) >= 1000) {
      return { display: v.toLocaleString('pt-BR'), mono: true };
    }
    return { display: String(v), mono: true };
  }
  if (typeof v === 'string') {
    // Date ISO?
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
      try {
        const d = new Date(v);
        return { display: d.toLocaleString('pt-BR'), mono: false };
      } catch {
        return { display: v, mono: false };
      }
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split('-');
      return { display: `${d}/${m}/${y}`, mono: true };
    }
    if (v.length > 80) return { display: v.slice(0, 80) + '…', mono: false };
    return { display: v, mono: false };
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return { display: '[ ]', mono: true };
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      return { display: v.map(String).join(', '), mono: false };
    }
    return { display: `[${v.length} item${v.length === 1 ? '' : 'ns'}]`, mono: true };
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>);
    if (keys.length === 0) return { display: '{ }', mono: true };
    return { display: `{${keys.length} campo${keys.length === 1 ? '' : 's'}}`, mono: true };
  }
  return { display: String(v), mono: false };
}

function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual((a as Record<string, Json>)[k], (b as Record<string, Json>)[k]));
  }
  return false;
}

function buildDiffs(before: Record<string, Json> | null, after: Record<string, Json> | null): FieldDiff[] {
  const keys = new Set<string>();
  if (before) Object.keys(before).forEach((k) => keys.add(k));
  if (after) Object.keys(after).forEach((k) => keys.add(k));

  const out: FieldDiff[] = [];
  for (const k of keys) {
    const b = before ? before[k] : undefined;
    const a = after  ? after[k]  : undefined;
    const inBefore = before && k in before;
    const inAfter  = after  && k in after;
    let kind: FieldDiff['kind'];
    if (inBefore && !inAfter)      kind = 'removed';
    else if (!inBefore && inAfter) kind = 'added';
    else if (!deepEqual(b, a))     kind = 'changed';
    else                           kind = 'unchanged';
    out.push({ field: k, before: b, after: a, kind });
  }

  // Ordena: changed > added > removed > unchanged, e por nome dentro
  const orderRank = { changed: 0, added: 1, removed: 2, unchanged: 3 };
  out.sort((x, y) => (orderRank[x.kind] - orderRank[y.kind]) || x.field.localeCompare(y.field));
  return out;
}

const KIND_BG: Record<FieldDiff['kind'], string> = {
  changed:   'bg-yellow-50 dark:bg-yellow-900/15',
  added:     'bg-green-50 dark:bg-green-900/15',
  removed:   'bg-red-50 dark:bg-red-900/15',
  unchanged: 'bg-slate-50/40 dark:bg-muted-dark/40',
};

const KIND_BADGE: Record<FieldDiff['kind'], { tone: string; label: string }> = {
  changed:   { tone: 'bg-yellow-200 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-200', label: 'mudou' },
  added:     { tone: 'bg-green-200 text-green-900 dark:bg-green-900/40 dark:text-green-200',     label: 'novo' },
  removed:   { tone: 'bg-red-200 text-red-900 dark:bg-red-900/40 dark:text-red-200',             label: 'removido' },
  unchanged: { tone: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',        label: '—' },
};

export function AuditDiff({ before, after, metadata }: Props) {
  const diffs = useMemo(() => buildDiffs(before, after), [before, after]);
  const visibleDiffs = diffs.filter((d) => d.kind !== 'unchanged');
  const hasMetadata = metadata && Object.keys(metadata).length > 0;

  if (visibleDiffs.length === 0 && !hasMetadata) {
    return (
      <p className="rounded-lg bg-slate-50 p-3 text-xs italic text-slate-500 dark:bg-muted-dark dark:text-slate-400">
        Nenhum campo alterado neste evento. (O before/after pode estar vazio ou idêntico.)
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      {visibleDiffs.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-border-dark">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 dark:bg-muted-dark">
              <tr>
                <th className="px-3 py-1.5 text-left font-semibold text-slate-600 dark:text-slate-300" style={{ width: '22%' }}>Campo</th>
                <th className="px-3 py-1.5 text-left font-semibold text-error">Antes</th>
                <th className="w-6 px-1 text-center text-slate-400">→</th>
                <th className="px-3 py-1.5 text-left font-semibold text-success">Depois</th>
                <th className="px-2 py-1.5 text-left font-semibold text-slate-500" style={{ width: '60px' }}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-border-dark">
              {visibleDiffs.map((d) => {
                const beforeFmt = fmtValue(d.before);
                const afterFmt  = fmtValue(d.after);
                const badge = KIND_BADGE[d.kind];
                return (
                  <tr key={d.field} className={KIND_BG[d.kind]}>
                    <td className="px-3 py-1.5 align-top font-medium text-slate-700 dark:text-slate-200">
                      {FIELD_LABEL[d.field] || d.field}
                      <p className="font-mono text-[10px] text-slate-400">{d.field}</p>
                    </td>
                    <td className={`px-3 py-1.5 align-top ${d.kind === 'added' ? 'text-slate-400' : 'text-error'} ${beforeFmt.mono ? 'font-mono' : ''}`}>
                      {d.kind === 'added' ? <span className="italic">—</span> : beforeFmt.display}
                    </td>
                    <td className="px-1 text-center align-top text-slate-400">→</td>
                    <td className={`px-3 py-1.5 align-top ${d.kind === 'removed' ? 'text-slate-400' : 'text-success'} ${afterFmt.mono ? 'font-mono' : ''}`}>
                      {d.kind === 'removed' ? <span className="italic">—</span> : afterFmt.display}
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <span className={`inline-block whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.tone}`}>{badge.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasMetadata && (
        <details className="rounded-lg border border-slate-200 bg-slate-50 dark:border-border-dark dark:bg-muted-dark">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            Metadata adicional ({Object.keys(metadata!).length} campo{Object.keys(metadata!).length === 1 ? '' : 's'})
          </summary>
          <div className="border-t border-slate-200 px-3 py-2 dark:border-border-dark">
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-slate-700 dark:text-slate-300">
{JSON.stringify(metadata, null, 2)}
            </pre>
          </div>
        </details>
      )}
    </div>
  );
}
