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

/* Detecta uma chave de identidade num array de objetos.
 * Tenta na ordem: id, codigo, contract_item_id, additive_item_id, item_id, sku. */
function detectArrayKey(arr: unknown[]): string | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  if (!arr.every((it) => it && typeof it === 'object' && !Array.isArray(it))) return null;
  const candidates = ['id', 'codigo', 'contract_item_id', 'additive_item_id', 'item_id', 'sku', 'documento_id'];
  for (const k of candidates) {
    if (arr.every((it) => k in (it as Record<string, unknown>))) return k;
  }
  return null;
}

function isObjectArray(v: Json): v is Array<Record<string, unknown>> {
  return Array.isArray(v) && v.length > 0 &&
         v.every((it) => it && typeof it === 'object' && !Array.isArray(it));
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
                const isArr = d.kind === 'changed' && isObjectArray(d.before) && isObjectArray(d.after);
                return (
                  <tr key={d.field} className={KIND_BG[d.kind]}>
                    <td className="px-3 py-1.5 align-top font-medium text-slate-700 dark:text-slate-200">
                      {FIELD_LABEL[d.field] || d.field}
                      <p className="font-mono text-[10px] text-slate-400">{d.field}</p>
                    </td>
                    {isArr ? (
                      <td colSpan={3} className="px-3 py-1.5 align-top">
                        <ArrayDiffTable
                          before={d.before as Array<Record<string, unknown>>}
                          after={d.after as Array<Record<string, unknown>>}
                        />
                      </td>
                    ) : (
                      <>
                        <td className={`px-3 py-1.5 align-top ${d.kind === 'added' ? 'text-slate-400' : 'text-error'} ${beforeFmt.mono ? 'font-mono' : ''}`}>
                          {d.kind === 'added' ? <span className="italic">—</span> : beforeFmt.display}
                        </td>
                        <td className="px-1 text-center align-top text-slate-400">→</td>
                        <td className={`px-3 py-1.5 align-top ${d.kind === 'removed' ? 'text-slate-400' : 'text-success'} ${afterFmt.mono ? 'font-mono' : ''}`}>
                          {d.kind === 'removed' ? <span className="italic">—</span> : afterFmt.display}
                        </td>
                      </>
                    )}
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

/**
 * ArrayDiffTable — renderiza diff por linha quando before/after são arrays de
 * objetos com chave de identidade detectável. Caso contrário, mostra resumo.
 */
function ArrayDiffTable({ before, after }: { before: Array<Record<string, unknown>>; after: Array<Record<string, unknown>> }) {
  const key = detectArrayKey([...before, ...after]);

  if (!key) {
    return (
      <div className="rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-600 dark:border-border-dark dark:bg-card-dark dark:text-slate-300">
        Lista de {before.length} → {after.length} itens · chave não identificável, mostrando contagem apenas
      </div>
    );
  }

  // Indexar por chave
  const beforeMap = new Map<string, Record<string, unknown>>();
  const afterMap = new Map<string, Record<string, unknown>>();
  before.forEach((it) => beforeMap.set(String(it[key]), it));
  after.forEach((it) => afterMap.set(String(it[key]), it));

  const allKeys = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()]));

  const rows: Array<{ key: string; type: 'added' | 'removed' | 'changed' | 'unchanged'; before?: Record<string, unknown>; after?: Record<string, unknown>; changedFields?: string[] }> = [];
  for (const k of allKeys) {
    const b = beforeMap.get(k);
    const a = afterMap.get(k);
    if (b && !a) {
      rows.push({ key: k, type: 'removed', before: b });
    } else if (!b && a) {
      rows.push({ key: k, type: 'added', after: a });
    } else if (b && a) {
      // Comparar campos
      const changedFields: string[] = [];
      const fieldSet = new Set([...Object.keys(b), ...Object.keys(a)]);
      for (const f of fieldSet) {
        if (f === key) continue;
        if (!deepEqual(b[f], a[f])) changedFields.push(f);
      }
      if (changedFields.length > 0) {
        rows.push({ key: k, type: 'changed', before: b, after: a, changedFields });
      } else {
        rows.push({ key: k, type: 'unchanged', before: b, after: a });
      }
    }
  }

  const visible = rows.filter((r) => r.type !== 'unchanged');
  const counts = {
    added:   rows.filter((r) => r.type === 'added').length,
    removed: rows.filter((r) => r.type === 'removed').length,
    changed: rows.filter((r) => r.type === 'changed').length,
    unchanged: rows.filter((r) => r.type === 'unchanged').length,
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-display text-slate-500 dark:text-slate-400">
        <span>Lista por <span className="text-navy dark:text-purple-300">{key}</span>:</span>
        {counts.added > 0    && <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800 dark:bg-green-900/40 dark:text-green-200">+{counts.added}</span>}
        {counts.changed > 0  && <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200">~{counts.changed}</span>}
        {counts.removed > 0  && <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800 dark:bg-red-900/40 dark:text-red-200">−{counts.removed}</span>}
        {counts.unchanged > 0 && <span className="text-slate-400">={counts.unchanged}</span>}
      </div>

      {visible.length === 0 ? (
        <p className="text-xs italic text-slate-500">Sem alterações relevantes nos itens</p>
      ) : (
        <ul className="space-y-1">
          {visible.slice(0, 20).map((r) => {
            const icon = r.type === 'added' ? '＋' : r.type === 'removed' ? '−' : '~';
            const cls = r.type === 'added' ? 'border-green-200 bg-green-50 dark:border-green-900/40 dark:bg-green-900/15'
                      : r.type === 'removed' ? 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/15'
                      : 'border-yellow-200 bg-yellow-50 dark:border-yellow-900/40 dark:bg-yellow-900/15';
            const it = r.after || r.before || {};
            const descricao = it.descricao || it.nome || it.title || '';
            return (
              <li key={r.key} className={`rounded border px-2 py-1 text-[11px] ${cls}`}>
                <div className="flex items-start gap-1.5">
                  <span className="font-mono font-bold">{icon}</span>
                  <div className="flex-1">
                    <p className="font-mono text-[10px] text-slate-600 dark:text-slate-300">{String(r.key)}</p>
                    {descricao ? <p className="dark:text-slate-200">{String(descricao).slice(0, 100)}</p> : null}
                    {r.type === 'changed' && r.changedFields && (
                      <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                        Campos: {r.changedFields.map((f) => FIELD_LABEL[f] || f).join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {visible.length > 20 && (
            <li className="text-center text-[10px] italic text-slate-500">
              + {visible.length - 20} itens adicionais ocultos
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
