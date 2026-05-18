import { Clock, AlertTriangle, AlertOctagon, CheckCircle2 } from 'lucide-react';
import { gedValidityStatus, type GedValidityStatus } from '../../lib/api';

/**
 * V56 — Badge compacto que reflete o estado de validade temporal de um
 * documento GED. Lê `dias_para_vencimento` + `dias_alerta_antes` e renderiza:
 *
 * - sem_validade: nada (return null) — não polui linhas que não têm validade
 * - ok: badge cinza discreto com data
 * - vencendo: badge amarelo com dias
 * - vencendo_critico: badge laranja-vermelho com dias
 * - vencido: badge vermelho saturado com "vencido há X dias"
 *
 * Variante `compact` (default false) só mostra dias sem texto; full é "vence em X dias".
 */
export function GedValidityBadge({
  dias_para_vencimento,
  dias_alerta_antes,
  data_validade,
  compact = false,
}: {
  dias_para_vencimento: number | null | undefined;
  dias_alerta_antes?: number | null;
  data_validade?: string | null;
  compact?: boolean;
}) {
  const status = gedValidityStatus(dias_para_vencimento ?? null, dias_alerta_antes ?? null);

  if (status === 'sem_validade') return null;

  const cfg = STATUS_CFG[status];
  const Icon = cfg.Icon;
  const dias = dias_para_vencimento ?? 0;

  const label = compact
    ? statusCompactLabel(status, dias)
    : statusFullLabel(status, dias, data_validade);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono ${cfg.classes}`}
      title={data_validade ? `Vencimento: ${formatDate(data_validade)}` : undefined}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

const STATUS_CFG: Record<Exclude<GedValidityStatus, 'sem_validade'>, {
  Icon: React.ComponentType<{ className?: string }>;
  classes: string;
}> = {
  ok: {
    Icon: CheckCircle2,
    classes: 'bg-slate-100 text-slate-600 dark:bg-muted-dark dark:text-slate-400',
  },
  vencendo: {
    Icon: Clock,
    classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200',
  },
  vencendo_critico: {
    Icon: AlertTriangle,
    classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200',
  },
  vencido: {
    Icon: AlertOctagon,
    classes: 'bg-error/15 text-error dark:bg-error/20',
  },
};

function statusCompactLabel(status: GedValidityStatus, dias: number): string {
  if (status === 'vencido') return `−${Math.abs(dias)}d`;
  if (status === 'ok')      return 'OK';
  return `${dias}d`;
}

function statusFullLabel(status: GedValidityStatus, dias: number, data: string | null | undefined): string {
  if (status === 'vencido') {
    const abs = Math.abs(dias);
    return `Vencido há ${abs} dia${abs === 1 ? '' : 's'}`;
  }
  if (status === 'ok') return `Válido até ${data ? formatDate(data) : '—'}`;
  return `Vence em ${dias} dia${dias === 1 ? '' : 's'}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
  } catch {
    return iso;
  }
}
