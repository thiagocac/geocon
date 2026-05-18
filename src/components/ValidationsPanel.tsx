import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, AlertOctagon, Clock, ChevronDown, ChevronRight, RefreshCw, Hourglass } from 'lucide-react';
import {
  summarizeMeasurementValidation, groupValidationIssuesByRule,
} from '../lib/api';
import type { MItem } from '../lib/types';
import { Card } from './ui/Card';
import { Button } from './ui/Button';

/**
 * V54 — Painel agregado de validações de medição.
 *
 * Renderiza:
 *   - 3 cards (OK · Alerta · Bloqueado · Pendente) com totais
 *   - Lista expandível por regra (não por item) — mais clean quando 1 regra
 *     atinge 20 items, mostra "20 items: saldo contratual"
 *   - Click em item navega para a página de memória do contract_item
 *   - Botão "Re-validar" reexecuta a EF
 *
 * Aceita `disabled` para casos quando a medição já foi emitida (não faz sentido re-validar).
 */
export function ValidationsPanel({
  items, onRevalidate, isRevalidating, disabled,
}: {
  items: MItem[];
  onRevalidate: () => void;
  isRevalidating: boolean;
  disabled?: boolean;
}) {
  const summary = summarizeMeasurementValidation(items);
  const groups = groupValidationIssuesByRule(items);
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());
  const { id = '' } = useParams();

  function toggleRule(rule: string) {
    setExpandedRules((prev) => {
      const next = new Set(prev);
      if (next.has(rule)) next.delete(rule);
      else next.add(rule);
      return next;
    });
  }

  if (summary.total === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Sem itens para validar nesta medição.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-border-dark">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold dark:text-slate-100">Validações automáticas</h2>
            <AggregatedBadge status={summary.status_agregado} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            6 regras verificadas · saldo, glosa, memória, qtd zero, qtd &gt;25%, preço divergente
          </p>
        </div>
        {!disabled && (
          <Button size="sm" variant="ghost" onClick={onRevalidate} loading={isRevalidating}>
            <RefreshCw className="h-3.5 w-3.5" />
            Re-validar
          </Button>
        )}
      </header>

      <div className="grid grid-cols-2 gap-px bg-slate-100 dark:bg-border-dark sm:grid-cols-4">
        <SummaryCell icon={CheckCircle2}     label="OK"        value={summary.ok}        tone="green" />
        <SummaryCell icon={AlertTriangle}    label="Alerta"    value={summary.alertas}   tone="yellow" />
        <SummaryCell icon={AlertOctagon}     label="Bloqueado" value={summary.bloqueados} tone="red" />
        <SummaryCell icon={Hourglass}        label="Pendente"  value={summary.pendentes} tone="slate" />
      </div>

      {groups.length > 0 && (
        <div className="border-t border-slate-100 dark:border-border-dark">
          <ul className="divide-y divide-slate-100 dark:divide-border-dark">
            {groups.map((g) => {
              const isOpen = expandedRules.has(g.rule);
              const Icon = g.severity === 'bloqueado' ? AlertOctagon : AlertTriangle;
              const iconTone = g.severity === 'bloqueado' ? 'text-error' : 'text-yellow-600 dark:text-yellow-400';
              return (
                <li key={g.rule}>
                  <button
                    type="button"
                    onClick={() => toggleRule(g.rule)}
                    className="flex w-full items-center justify-between px-5 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-muted-dark"
                    aria-expanded={isOpen}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 shrink-0 ${iconTone}`} aria-hidden />
                      <span className="text-sm font-medium dark:text-slate-100">{g.label}</span>
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                        {g.items.length} {g.items.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                    {isOpen
                      ? <ChevronDown  className="h-4 w-4 text-slate-400" />
                      : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  </button>
                  {isOpen && (
                    <ul className="border-t border-slate-100 bg-slate-50/40 dark:border-border-dark dark:bg-muted-dark/30">
                      {g.items.map((it) => (
                        <li key={it.item_id} className="px-5 py-2 text-xs">
                          <div className="flex items-start gap-2">
                            <span className="font-mono text-slate-500 dark:text-slate-400 shrink-0">{it.codigo}</span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-slate-700 dark:text-slate-200" title={it.descricao}>
                                {it.descricao}
                              </p>
                              <p className="mt-0.5 text-slate-600 dark:text-slate-400">{it.message}</p>
                            </div>
                            <Link
                              to={`/contratos/${id}/medicoes/${items[0]?.measurement_id}/memoria/${it.item_id}`}
                              className="shrink-0 font-mono text-[10px] uppercase tracking-display text-navy hover:underline dark:text-purple-300"
                            >
                              Memória →
                            </Link>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {summary.pendentes > 0 && summary.bloqueados === 0 && summary.alertas === 0 && (
        <div className="border-t border-slate-100 px-5 py-3 text-center text-xs text-slate-500 dark:border-border-dark dark:text-slate-400">
          {summary.pendentes} item{summary.pendentes === 1 ? '' : 's'} ainda não foram validados.
          Clique em "Re-validar" para executar.
        </div>
      )}
    </Card>
  );
}

function AggregatedBadge({ status }: { status: 'ok' | 'alerta' | 'bloqueado' | 'pendente' }) {
  const cfg = {
    ok:        { tone: 'bg-success/15 text-success-700 dark:text-success', label: 'OK', Icon: CheckCircle2 },
    alerta:    { tone: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200', label: 'Atenção', Icon: AlertTriangle },
    bloqueado: { tone: 'bg-error/15 text-error', label: 'Bloqueado', Icon: AlertOctagon },
    pendente:  { tone: 'bg-slate-100 text-slate-700 dark:bg-muted-dark dark:text-slate-300', label: 'Pendente', Icon: Clock },
  }[status];
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-display ${cfg.tone}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function SummaryCell({
  icon: Icon, label, value, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: 'green' | 'yellow' | 'red' | 'slate';
}) {
  const cfg = {
    green:  'text-success',
    yellow: 'text-yellow-600 dark:text-yellow-400',
    red:    'text-error',
    slate:  'text-slate-600 dark:text-slate-400',
  }[tone];
  return (
    <div className={`bg-white dark:bg-card-dark px-3 py-3 ${value === 0 ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${cfg}`} aria-hidden />
        <span className="text-[10px] font-mono uppercase tracking-display text-slate-500 dark:text-slate-400">
          {label}
        </span>
      </div>
      <p className={`mt-1 font-mono tabular text-2xl font-bold ${cfg}`}>{value}</p>
    </div>
  );
}
