import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCcw, Trash2, AlertOctagon, CheckCircle2, Loader2, ArrowLeft,
  Camera, Calculator, MessageSquare, Wifi, WifiOff, Inbox,
} from 'lucide-react';
import {
  listPendingOperations, processQueue, resetOperationRetries, discardOperation,
  getStorageQuotaInfo,
  type OfflineOperation, type OfflineOpKind, type StorageQuotaInfo,
} from '../lib/offlineQueue';
import { dtTime, relativeTime } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Empty } from '../components/ui/Stat';

/**
 * V63 — Inspetor da fila offline.
 *
 * Rota: /medicoes/fila
 *
 * Lista operações persistidas em IndexedDB pelo offlineQueue (V62).
 * Permite inspecionar retries, last_error, e ações Retry/Descartar
 * individuais. Botão "Sincronizar tudo" tenta a fila inteira.
 *
 * Não é mobile-first como o MeasurementFieldEntry — usa Layout normal
 * pois é tela de admin/operador, normalmente acessada de desktop.
 */
export function OfflineQueueInspector() {
  const [ops, setOps] = useState<OfflineOperation[]>([]);
  const [quota, setQuota] = useState<StorageQuotaInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [syncing, setSyncing] = useState(false);
  const [busyById, setBusyById] = useState<Record<string, 'retry' | 'discard'>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, q] = await Promise.all([
        listPendingOperations(),
        getStorageQuotaInfo(),
      ]);
      setOps(list);
      setQuota(q);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    function up()   { setOnline(true);  }
    function down() { setOnline(false); }
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [refresh]);

  async function syncAll() {
    if (syncing) return;
    setSyncing(true);
    setMsg(null);
    try {
      const result = await processQueue();
      if (result.attempted > 0) {
        setMsg(`${result.succeeded} sincronizada${result.succeeded === 1 ? '' : 's'}${result.failed ? `, ${result.failed} com falha` : ''}.`);
      } else {
        setMsg('Nada a sincronizar.');
      }
      await refresh();
      setTimeout(() => setMsg(null), 5000);
    } finally {
      setSyncing(false);
    }
  }

  async function onRetry(op: OfflineOperation) {
    setBusyById((b) => ({ ...b, [op.id]: 'retry' }));
    try {
      await resetOperationRetries(op.id);
      // Tenta processar a fila inteira (o lock interno evita race)
      await processQueue();
      await refresh();
    } finally {
      setBusyById((b) => { const n = { ...b }; delete n[op.id]; return n; });
    }
  }

  async function onDiscard(op: OfflineOperation) {
    if (!confirm(`Descartar operação ${KIND_LABELS[op.kind]} criada ${relativeTime(op.created_at)}?\n\nEsta ação não pode ser desfeita — os dados serão perdidos.`)) return;
    setBusyById((b) => ({ ...b, [op.id]: 'discard' }));
    try {
      await discardOperation(op.id);
      await refresh();
    } finally {
      setBusyById((b) => { const n = { ...b }; delete n[op.id]; return n; });
    }
  }

  const blocked = ops.filter((o) => o.retries >= 5);
  const failing = ops.filter((o) => o.retries > 0 && o.retries < 5);
  const fresh   = ops.filter((o) => o.retries === 0);

  return (
    <Layout>
      <PageHeader
        kicker="Apontamento de campo"
        title="Fila offline"
        subtitle="Operações persistidas localmente aguardando sincronização com o servidor"
        backTo="/contratos"
        backLabel="Contratos"
        actions={
          <>
            <Button variant="outline" onClick={refresh} loading={loading}>
              <RefreshCcw className="h-4 w-4" />Atualizar
            </Button>
            <Button onClick={syncAll} loading={syncing} disabled={!online || ops.length === 0}>
              <ArrowLeft className="h-4 w-4 rotate-180" />Sincronizar tudo
            </Button>
          </>
        }
      />

      {/* Status banner */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-display ${
          online ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
        }`}>
          {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {online ? 'Online' : 'Offline'}
        </span>
        {!online && (
          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
            Re-tentativas pausadas até voltar a conexão
          </span>
        )}
        {msg && (
          <span className="inline-flex items-center gap-1 rounded-full bg-navy/10 px-3 py-1 font-mono text-[10px] uppercase tracking-display text-navy dark:bg-purple-900/30 dark:text-purple-300">
            <CheckCircle2 className="h-3 w-3" />{msg}
          </span>
        )}
      </div>

      {/* V67: Storage quota */}
      {quota?.supported && quota.quota > 0 && (
        <Card className="mb-4 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
              Espaço usado no dispositivo
            </span>
            <span className="font-mono tabular text-xs text-slate-700 dark:text-slate-200">
              {formatBytes(quota.usage)} de {formatBytes(quota.quota)} · {quota.usage_pct.toFixed(1)}%
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-muted-dark">
            <div
              className={`h-full transition-all ${
                quota.usage_pct >= 90 ? 'bg-error' :
                quota.usage_pct >= 70 ? 'bg-warning' :
                'bg-success'
              }`}
              style={{ width: `${Math.min(quota.usage_pct, 100)}%` }}
            />
          </div>
          {quota.usage_pct >= 80 && (
            <p className="mt-1 text-[11px] text-warning">
              <AlertOctagon className="mr-1 inline h-3 w-3" />
              Aproximando do limite. Sincronize a fila para liberar espaço.
            </p>
          )}
        </Card>
      )}

      {/* Stats */}
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <StatCard label="Total na fila"    value={ops.length}     tone="slate"  icon={Inbox} />
        <StatCard label="Aguardando"        value={fresh.length}   tone="slate"  icon={Loader2} />
        <StatCard label="Re-tentando"       value={failing.length} tone="yellow" icon={RefreshCcw} />
        <StatCard label="Bloqueadas (≥5)"   value={blocked.length} tone="red"    icon={AlertOctagon} />
      </div>

      {loading && (
        <Card className="p-6">
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">Carregando fila…</p>
        </Card>
      )}

      {!loading && ops.length === 0 && (
        <Empty
          title="Fila vazia"
          body="Nenhuma operação pendente. Apontamentos feitos offline aparecem aqui até serem sincronizados."
          action={<Link to="/contratos" className="font-semibold text-navy hover:underline">Ir para contratos →</Link>}
        />
      )}

      {!loading && ops.length > 0 && (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100 dark:divide-border-dark">
            {ops.map((op) => (
              <OpRow
                key={op.id}
                op={op}
                busy={busyById[op.id]}
                online={online}
                onRetry={() => onRetry(op)}
                onDiscard={() => onDiscard(op)}
              />
            ))}
          </ul>
        </Card>
      )}
    </Layout>
  );
}

// =============================================================================
// Sub-componentes
// =============================================================================

const KIND_LABELS: Record<OfflineOpKind, string> = {
  calc_line: 'Linha de cálculo',
  evidence:  'Foto / evidência',
  comment:   'Comentário',
};

const KIND_ICONS: Record<OfflineOpKind, React.ComponentType<{ className?: string }>> = {
  calc_line: Calculator,
  evidence:  Camera,
  comment:   MessageSquare,
};

function OpRow({
  op, busy, online, onRetry, onDiscard,
}: {
  op: OfflineOperation;
  busy?: 'retry' | 'discard';
  online: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const Icon = KIND_ICONS[op.kind];
  const isBlocked = op.retries >= 5;
  const isFailing = op.retries > 0 && !isBlocked;
  const summary = summarizePayload(op);

  return (
    <li className={`p-4 ${isBlocked ? 'bg-error/5 dark:bg-error/10' : isFailing ? 'bg-yellow-50/40 dark:bg-yellow-900/10' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            isBlocked ? 'bg-error/15 text-error' :
            isFailing ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' :
            'bg-slate-100 text-slate-600 dark:bg-muted-dark dark:text-slate-300'
          }`}>
            <Icon className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="font-semibold dark:text-slate-100">{KIND_LABELS[op.kind]}</h3>
              <span className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
                criada {relativeTime(op.created_at)} · {dtTime(op.created_at)}
              </span>
              {op.retries > 0 && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-display ${
                  isBlocked
                    ? 'bg-error/15 text-error'
                    : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                }`}>
                  {isBlocked ? <AlertOctagon className="h-3 w-3" /> : <RefreshCcw className="h-3 w-3" />}
                  {op.retries} re-tentativa{op.retries === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-sm text-slate-700 dark:text-slate-300" title={summary}>
              {summary}
            </p>
            {op.last_error && (
              <p className="mt-1 flex items-start gap-1 break-all text-xs text-error">
                <AlertOctagon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                {op.last_error}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2">
          <Button
            size="sm" variant="outline"
            onClick={onRetry}
            disabled={!online || !!busy}
            loading={busy === 'retry'}
            title={!online ? 'Aguardando rede' : isBlocked ? 'Reseta retries e tenta de novo' : 'Tentar agora'}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            {isBlocked ? 'Resetar' : 'Tentar'}
          </Button>
          <Button
            size="sm" variant="ghost"
            onClick={onDiscard}
            disabled={!!busy}
            loading={busy === 'discard'}
            className="text-error hover:bg-error/10"
            title="Remove permanentemente — dados serão perdidos"
          >
            <Trash2 className="h-3.5 w-3.5" />Descartar
          </Button>
        </div>
      </div>
    </li>
  );
}

function StatCard({
  icon: Icon, label, value, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: 'slate' | 'yellow' | 'red';
}) {
  const cfg = {
    slate:  'text-slate-700 dark:text-slate-200',
    yellow: 'text-yellow-700 dark:text-yellow-300',
    red:    'text-error',
  }[tone];
  return (
    <Card className={`px-4 py-3 ${value === 0 ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${cfg}`} aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
          {label}
        </span>
      </div>
      <p className={`mt-1 font-mono tabular text-2xl font-bold ${cfg}`}>{value}</p>
    </Card>
  );
}

/**
 * Sumariza payload em texto curto. Não vaza dados sensíveis,
 * só hints suficientes para identificar a operação.
 */
function summarizePayload(op: OfflineOperation): string {
  const p = op.payload;
  switch (op.kind) {
    case 'calc_line': {
      const qty = (p as { quantidade_calculada?: number }).quantidade_calculada;
      const local = (p as { local?: string }).local;
      const itemId = (p as { measurement_item_id?: string }).measurement_item_id;
      return `Item ${itemId?.slice(0, 8) ?? '?'} · qtd ${qty ?? '?'}${local ? ` · ${local}` : ''}`;
    }
    case 'comment': {
      const body = (p as { body?: string }).body || '';
      const itemId = (p as { measurement_item_id?: string }).measurement_item_id;
      return `Item ${itemId?.slice(0, 8) ?? '?'} · "${body.slice(0, 80)}${body.length > 80 ? '…' : ''}"`;
    }
    case 'evidence': {
      const name = (p as { file_name?: string }).file_name;
      const size = (p as { file_blob_base64?: string }).file_blob_base64?.length;
      const sizeKb = size ? Math.round(size * 0.75 / 1024) : null;
      const lat = (p as { latitude?: number }).latitude;
      const lng = (p as { longitude?: number }).longitude;
      const gps = (lat && lng) ? ` · GPS ${lat.toFixed(3)},${lng.toFixed(3)}` : '';
      return `${name ?? 'arquivo'}${sizeKb ? ` · ${sizeKb} KB` : ''}${gps}`;
    }
    default:
      return JSON.stringify(p).slice(0, 100);
  }
}

/** V67 — formatador humano de bytes (B/KB/MB/GB) */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
