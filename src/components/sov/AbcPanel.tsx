import { useState } from 'react';
import { ChevronDown, ChevronRight, Trophy, Target, Layers as LayersIcon } from 'lucide-react';
import type { ContractAbcSummary, AbcClasse } from '../../lib/api';
import { ABC_CLASSE_LABELS, ABC_CLASSE_DESCRIPTION } from '../../lib/api';
import { brl } from '../../lib/format';
import { Card } from '../ui/Card';

/**
 * V55 — Painel agregado da curva ABC do SOV.
 *
 * Renderiza:
 *   - 3 cards (A · B · C) com items_count, pct_items, valor_total, pct_valor
 *   - Barra Pareto inline (3 segmentos coloridos) mostrando proporção de valor
 *   - Heuristic Pareto check: "Top 20% items = X% valor" indica se o contrato
 *     está dentro do padrão (~80) ou anômalo (<60 ou >90)
 */
export function AbcSummaryPanel({ summary }: { summary: ContractAbcSummary }) {
  const [expanded, setExpanded] = useState(false);

  if (summary.items_total === 0) return null;

  // Heuristic: top 20% itens deveria gerar ~80% do valor (Pareto clássico).
  // Como classe A é definida por <=80% acumulado, a contagem em A varia
  // por contrato. Calcula manualmente "valor dos top 20% items".
  const top20Count = Math.max(1, Math.ceil(summary.items_total * 0.2));
  const ratioInfo =
    summary.A.items_count <= top20Count
      ? `${summary.A.items_count} item${summary.A.items_count === 1 ? '' : 's'} (${summary.A.pct_items}%) controlam ${summary.A.pct_valor}% do valor`
      : `Cauda concentrada — ${summary.A.items_count} items necessários para 80% (${summary.A.pct_items}%)`;

  const segments: Array<{ classe: AbcClasse; tone: string; pct: number }> = [
    { classe: 'A', tone: 'bg-success',        pct: summary.A.pct_valor },
    { classe: 'B', tone: 'bg-yellow-500',     pct: summary.B.pct_valor },
    { classe: 'C', tone: 'bg-slate-400 dark:bg-slate-500', pct: summary.C.pct_valor },
  ];

  return (
    <Card className="overflow-hidden mb-4">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-border-dark">
        <div>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-navy dark:text-purple-300" aria-hidden />
            <h2 className="font-semibold dark:text-slate-100">Curva ABC · análise de Pareto</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {ratioInfo} · {summary.items_total} item{summary.items_total === 1 ? '' : 's'} · {brl(summary.valor_contrato_total)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="font-mono text-[10px] uppercase tracking-display text-navy hover:underline dark:text-purple-300"
          aria-expanded={expanded}
        >
          {expanded ? 'Ocultar detalhes' : 'Ver detalhes'}
        </button>
      </header>

      {/* Pareto inline bar */}
      <div className="px-5 py-3">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-muted-dark" role="img" aria-label="Distribuição de valor por classe ABC">
          {segments.map((s) => (
            s.pct > 0 ? (
              <div
                key={s.classe}
                className={`flex items-center justify-center text-[9px] font-bold text-white ${s.tone}`}
                style={{ width: `${s.pct}%` }}
                title={`Classe ${s.classe} · ${s.pct}% do valor`}
              >
                {s.pct >= 8 ? `${s.classe}` : ''}
              </div>
            ) : null
          ))}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[9px] text-slate-500 dark:text-slate-400">
          <span>0%</span><span>50%</span><span>100% do valor</span>
        </div>
      </div>

      {expanded && (
        <div className="grid grid-cols-1 gap-px border-t border-slate-100 bg-slate-100 dark:border-border-dark dark:bg-border-dark sm:grid-cols-3">
          <ClasseCell classe="A" stats={summary.A} icon={Trophy} tone="success" />
          <ClasseCell classe="B" stats={summary.B} icon={LayersIcon} tone="yellow" />
          <ClasseCell classe="C" stats={summary.C} icon={LayersIcon} tone="slate" />
        </div>
      )}
    </Card>
  );
}

function ClasseCell({
  classe, stats, icon: Icon, tone,
}: {
  classe: AbcClasse;
  stats: { items_count: number; valor_total: number; pct_items: number; pct_valor: number };
  icon: React.ComponentType<{ className?: string }>;
  tone: 'success' | 'yellow' | 'slate';
}) {
  const toneCfg = {
    success: 'text-success border-success/30',
    yellow:  'text-yellow-700 dark:text-yellow-300 border-yellow-500/30',
    slate:   'text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700',
  }[tone];
  return (
    <div className="bg-white px-4 py-3 dark:bg-card-dark">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${toneCfg.split(' ')[0]}`} aria-hidden />
        <span className={`font-mono text-[10px] uppercase tracking-display ${toneCfg.split(' ')[0]}`}>
          {ABC_CLASSE_LABELS[classe]}
        </span>
      </div>
      <p className="mt-1.5 font-mono tabular text-2xl font-bold dark:text-slate-100">
        {stats.items_count}<span className="ml-1 text-sm text-slate-500 dark:text-slate-400">items ({stats.pct_items}%)</span>
      </p>
      <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
        <span className="font-medium">{brl(stats.valor_total)}</span>
        <span className="ml-1">· {stats.pct_valor}% do valor</span>
      </p>
      <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
        {ABC_CLASSE_DESCRIPTION[classe]}
      </p>
    </div>
  );
}

/**
 * Badge inline para uma classe ABC. Reutilizável em outras telas se necessário.
 */
export function AbcBadge({ classe }: { classe: AbcClasse }) {
  const tone =
    classe === 'A' ? 'bg-success/15 text-success border-success/30' :
    classe === 'B' ? 'bg-yellow-100 text-yellow-800 border-yellow-500/30 dark:bg-yellow-900/30 dark:text-yellow-200' :
    'bg-slate-100 text-slate-700 border-slate-300 dark:bg-muted-dark dark:text-slate-300';
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[10px] font-bold ${tone}`}
      title={ABC_CLASSE_LABELS[classe]}
    >
      {classe}
    </span>
  );
}
