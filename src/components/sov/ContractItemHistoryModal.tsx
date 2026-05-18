import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  History, Clock, User, AlertCircle, ArrowRight, Package, ImportIcon,
  Pencil, Lock as LockIcon, Unlock, Filter, X as XIcon, Download,
} from 'lucide-react';
import {
  listContractItemHistory,
  CONTRACT_ITEM_FIELD_LABELS,
  formatContractItemHistoryValue,
  type ContractItemHistoryEntry,
} from '../../lib/api';
import { dtTime, relativeTime } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { Modal } from '../ui/Modal';
import { Skeleton, Empty } from '../ui/Stat';

/**
 * V64 — Modal de histórico item-level.
 *
 * Aberto a partir do ContractSheet (botão Histórico em cada linha) ou
 * direto via popover. Mostra cronológico reverso de mudanças nos campos
 * relevantes (preço, quantidade, locked, descrição, etc).
 *
 * Conteúdo só carrega quando open=true (queryEnabled).
 */
export function ContractItemHistoryModal({
  open, onClose, itemId, itemCodigo, itemDescricao,
}: {
  open: boolean;
  onClose: () => void;
  itemId: string | null;
  itemCodigo?: string;
  itemDescricao?: string;
}) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['contract-item-history', itemId],
    queryFn: () => listContractItemHistory(itemId!),
    enabled: open && !!itemId,
    staleTime: 30_000,
  });

  // V67 — filtros actor / período / source
  const [filterActor, setFilterActor]   = useState<string>('all');
  const [filterPeriod, setFilterPeriod] = useState<'all' | '7d' | '30d' | '90d'>('all');
  const [filterSource, setFilterSource] = useState<string>('all');

  // Reseta filtros ao mudar de item
  if (itemId && filterActor === 'reset-marker') {
    setFilterActor('all'); setFilterPeriod('all'); setFilterSource('all');
  }

  const actorOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const h of history) {
      if (h.actor_id && h.actor_nome) set.set(h.actor_id, h.actor_nome);
    }
    return Array.from(set.entries());
  }, [history]);

  const sourceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const h of history) {
      if (h.source) set.add(h.source);
    }
    return Array.from(set);
  }, [history]);

  const filtered = useMemo(() => {
    let r = history;
    if (filterActor !== 'all') r = r.filter((h) => h.actor_id === filterActor);
    if (filterSource !== 'all') r = r.filter((h) => h.source === filterSource);
    if (filterPeriod !== 'all') {
      const days = filterPeriod === '7d' ? 7 : filterPeriod === '30d' ? 30 : 90;
      const cutoff = Date.now() - days * 86_400_000;
      r = r.filter((h) => new Date(h.changed_at).getTime() >= cutoff);
    }
    return r;
  }, [history, filterActor, filterPeriod, filterSource]);

  const hasFilter = filterActor !== 'all' || filterPeriod !== 'all' || filterSource !== 'all';
  function clearFilters() {
    setFilterActor('all'); setFilterPeriod('all'); setFilterSource('all');
  }

  function exportCsv() {
    const rows = filtered.flatMap((entry) => {
      const fields = entry.after_value ? Object.keys(entry.after_value) : [];
      if (fields.length === 0) return [{
        timestamp: entry.changed_at,
        actor: entry.actor_nome || '',
        source: entry.source || '',
        campo: '',
        valor_antes: '',
        valor_depois: '',
      }];
      return fields.map((field) => ({
        timestamp: entry.changed_at,
        actor: entry.actor_nome || '',
        source: entry.source || '',
        campo: CONTRACT_ITEM_FIELD_LABELS[field] || field,
        valor_antes: formatContractItemHistoryValue(field, entry.before_value?.[field]),
        valor_depois: formatContractItemHistoryValue(field, entry.after_value?.[field]),
      }));
    });
    downloadCsv(
      `historico-item-${(itemCodigo || itemId || 'unknown').replace(/[^\w-]/g, '_')}.csv`,
      rows,
      {
        timestamp:    'Data/hora',
        actor:        'Autor',
        source:       'Origem',
        campo:        'Campo',
        valor_antes:  'Valor anterior',
        valor_depois: 'Valor novo',
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Histórico do item"
    >
      <p className="mb-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <History className="h-3.5 w-3.5 text-navy dark:text-purple-300" aria-hidden />
        Alterações nos campos auditados (preço, quantidades, descrição, bloqueio, fonte, BDI)
      </p>

      {itemCodigo && (
        <p className="mb-3 text-sm">
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{itemCodigo}</span>
          {itemDescricao && (
            <span className="ml-2 text-slate-700 dark:text-slate-300">{itemDescricao}</span>
          )}
        </p>
      )}

      {/* V67 — Filtros */}
      {history.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
          <Filter className="h-3 w-3 text-slate-400" aria-hidden />
          <select
            value={filterActor}
            onChange={(e) => setFilterActor(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs dark:border-border-dark dark:bg-card-dark"
          >
            <option value="all">Todos autores</option>
            {actorOptions.map(([id, nome]) => (
              <option key={id} value={id}>{nome}</option>
            ))}
          </select>
          <select
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value as typeof filterPeriod)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs dark:border-border-dark dark:bg-card-dark"
          >
            <option value="all">Qualquer período</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="90d">Últimos 90 dias</option>
          </select>
          {sourceOptions.length > 1 && (
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs dark:border-border-dark dark:bg-card-dark"
            >
              <option value="all">Toda origem</option>
              {sourceOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          {hasFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-display text-slate-500 hover:text-error dark:text-slate-400"
            >
              <XIcon className="h-3 w-3" />Limpar
            </button>
          )}
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-display text-slate-500 hover:text-navy disabled:opacity-40 dark:text-slate-400 dark:hover:text-purple-300"
            title="Exportar entradas filtradas como CSV"
          >
            <Download className="h-3 w-3" />CSV
          </button>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
            {filtered.length} de {history.length}
          </span>
        </div>
      )}

      {isLoading && <Skeleton className="h-40" />}

      {!isLoading && history.length === 0 && (
        <Empty
          title="Sem alterações registradas"
          body="Este item não teve mudanças nos campos auditados (preço, quantidades, descrição, código, unidade, bloqueio, fonte de referência ou BDI)."
        />
      )}

      {!isLoading && history.length > 0 && filtered.length === 0 && (
        <Empty
          title="Nenhuma alteração nos filtros"
          body="Limpe ou ajuste os filtros para ver outras entradas."
        />
      )}

      {!isLoading && filtered.length > 0 && (
        <ul className="-mx-5 max-h-[60vh] overflow-y-auto scrollbar-thin">
          {filtered.map((entry) => (
            <HistoryEntry key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </Modal>
  );
}

function sourceIcon(source: string | null) {
  switch (source) {
    case 'sov_import':       return ImportIcon;
    case 'sov_edit':         return Pencil;
    case 'sov_bulk':         return Package;
    case 'sov_lock':         return LockIcon;
    case 'sov_unlock':       return Unlock;
    default:                 return Clock;
  }
}

const SOURCE_LABELS: Record<string, string> = {
  sov_import: 'Importação',
  sov_edit:   'Edição manual',
  sov_bulk:   'Operação em lote',
  sov_lock:   'Bloqueio',
  sov_unlock: 'Desbloqueio',
};

function HistoryEntry({ entry }: { entry: ContractItemHistoryEntry }) {
  const fields = entry.after_value ? Object.keys(entry.after_value) : [];
  const Icon = sourceIcon(entry.source);

  return (
    <li className="border-t border-slate-100 px-5 py-3 first:border-t-0 dark:border-border-dark">
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-muted-dark dark:text-slate-400">
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
              {SOURCE_LABELS[entry.source || ''] || entry.source || 'Alteração'}
            </span>
            <span className="font-mono text-[10px] text-slate-400">·</span>
            <span className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-300">
              <User className="h-3 w-3" aria-hidden />
              {entry.actor_nome || 'sistema'}
            </span>
            <span className="font-mono text-[10px] text-slate-400">·</span>
            <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400" title={dtTime(entry.changed_at)}>
              {relativeTime(entry.changed_at)}
            </span>
          </div>

          {fields.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              <AlertCircle className="mr-1 inline h-3 w-3" />
              Mudança sem campos detalhados
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {fields.map((field) => {
                const before = entry.before_value?.[field];
                const after  = entry.after_value?.[field];
                const label  = CONTRACT_ITEM_FIELD_LABELS[field] || field;
                return (
                  <li key={field} className="flex flex-wrap items-baseline gap-1.5 text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{label}:</span>
                    <span className="rounded bg-error/10 px-1.5 py-0.5 font-mono tabular text-error line-through">
                      {formatContractItemHistoryValue(field, before)}
                    </span>
                    <ArrowRight className="h-3 w-3 text-slate-400" aria-hidden />
                    <span className="rounded bg-success/10 px-1.5 py-0.5 font-mono tabular text-success">
                      {formatContractItemHistoryValue(field, after)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}
