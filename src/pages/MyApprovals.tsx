import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, RotateCcw, XCircle, Clock, AlertTriangle, AlertCircle,
  Filter, Layers, ShieldCheck,
} from 'lucide-react';
import { listMyPendingApprovals, bulkDecideApprovalSteps, type PendingApprovalRow } from '../lib/api';
import { humanizeError } from '../lib/errors';
import { brl, relativeTime } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Field, Select } from '../components/ui/FormField';
import { Stat, Empty, Skeleton } from '../components/ui/Stat';

const SLA_TONE: Record<PendingApprovalRow['sla'], 'red' | 'yellow' | 'green' | 'slate'> = {
  atrasado: 'red',
  urgente:  'yellow',
  no_prazo: 'green',
  sem_sla:  'slate',
};
const SLA_LABEL: Record<PendingApprovalRow['sla'], string> = {
  atrasado: 'Atrasado',
  urgente:  'Urgente',
  no_prazo: 'No prazo',
  sem_sla:  'Sem SLA',
};
const SLA_ICON: Record<PendingApprovalRow['sla'], typeof Clock> = {
  atrasado: AlertCircle,
  urgente:  AlertTriangle,
  no_prazo: CheckCircle2,
  sem_sla:  Clock,
};

export function MyApprovals() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading, isError, error } = useQuery({
    queryKey: ['my-approvals'], queryFn: listMyPendingApprovals,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterContract, setFilterContract] = useState<string>('');
  const [filterSla, setFilterSla] = useState<string>('');
  const [dialogAction, setDialogAction] = useState<'aprovar' | 'devolver' | 'reprovar' | null>(null);
  const [comment, setComment] = useState('');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Filtros
  const contractOptions = useMemo(() => {
    const set = new Map<string, string>();
    rows.forEach((r) => set.set(r.contract_id, r.contract_numero));
    return Array.from(set.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);
  const filtered = rows.filter((r) =>
    (!filterContract || r.contract_id === filterContract) &&
    (!filterSla || r.sla === filterSla)
  );

  // Resumos
  const totalValor = filtered.reduce((s, r) => s + r.measurement_valor_liquido, 0);
  const totalAtrasados = rows.filter((r) => r.sla === 'atrasado').length;
  const totalUrgentes  = rows.filter((r) => r.sla === 'urgente').length;

  function toggleOne(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    if (filtered.every((r) => selected.has(r.step_id))) {
      setSelected((cur) => { const n = new Set(cur); filtered.forEach((r) => n.delete(r.step_id)); return n; });
    } else {
      setSelected((cur) => { const n = new Set(cur); filtered.forEach((r) => n.add(r.step_id)); return n; });
    }
  }

  const decide = useMutation({
    mutationFn: () => {
      if (!dialogAction) throw new Error('Sem ação');
      if (selected.size === 0) throw new Error('Selecione ao menos uma aprovação');
      return bulkDecideApprovalSteps({
        step_ids: Array.from(selected),
        action: dialogAction,
        comment: comment.trim() || undefined,
      });
    },
    onSuccess: (res) => {
      setOkMsg(`${res.processed} processada(s)${res.failed > 0 ? ` · ${res.failed} falhou(aram)` : ''}.`);
      setErrMsg(null);
      setSelected(new Set());
      setDialogAction(null);
      setComment('');
      qc.invalidateQueries({ queryKey: ['my-approvals'] });
      setTimeout(() => setOkMsg(null), 5000);
    },
    onError: (e: Error) => { setErrMsg(humanizeError(e)); },
  });

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.step_id));
  const someVisibleSelected = filtered.some((r) => selected.has(r.step_id)) && !allVisibleSelected;

  return (
    <Layout>
      <PageHeader
        kicker="Minhas tarefas · Aprovações"
        title="Minhas aprovações"
        subtitle="Steps de workflow assignados a você em todos os contratos do tenant"
      />

      {/* Stats */}
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Stat label="Pendentes (total)" value={String(rows.length)} tone="navy" icon={<ShieldCheck className="h-5 w-5" />} />
        <Stat label="Atrasadas"  value={String(totalAtrasados)}
              tone={totalAtrasados > 0 ? 'error' : 'success'} icon={<AlertCircle className="h-5 w-5" />} />
        <Stat label="Urgentes"   value={String(totalUrgentes)}
              tone={totalUrgentes > 0 ? 'warning' : 'success'} icon={<AlertTriangle className="h-5 w-5" />} />
        <Stat label="Valor envolvido (filtrado)" value={brl(totalValor)} tone="magenta" />
      </div>

      {okMsg  && <div className="mb-3 rounded-lg border border-success/30 bg-success/5 px-4 py-2 text-sm text-success">✓ {okMsg}</div>}
      {errMsg && <div className="mb-3 rounded-lg border border-error/30 bg-error/5 px-4 py-2 text-sm text-error">{errMsg}</div>}

      {/* Filtros */}
      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Select value={filterContract} onChange={(e) => setFilterContract(e.target.value)}
                  placeholder="Todos os contratos" options={contractOptions} />
          <Select value={filterSla} onChange={(e) => setFilterSla(e.target.value)}
                  placeholder="Todas as severidades de SLA"
                  options={[
                    { value: 'atrasado', label: 'Atrasado' },
                    { value: 'urgente',  label: 'Urgente' },
                    { value: 'no_prazo', label: 'No prazo' },
                    { value: 'sem_sla',  label: 'Sem SLA' },
                  ]} />
          <Button variant="outline" onClick={() => { setFilterContract(''); setFilterSla(''); }}>
            <Filter className="h-4 w-4" />Limpar
          </Button>
        </div>
      </Card>

      {/* Toolbar de bulk */}
      {selected.size > 0 && (
        <Card className="mb-4 flex items-center justify-between gap-3 border-navy/30 bg-navy/5 px-4 py-3 dark:border-purple/30 dark:bg-purple/10">
          <p className="text-sm font-medium dark:text-slate-100">
            {selected.size} aprovação(ões) selecionada(s)
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Limpar</Button>
            <Button size="sm" variant="outline" onClick={() => { setDialogAction('devolver'); setErrMsg(null); }}>
              <RotateCcw className="h-3.5 w-3.5" />Devolver
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setDialogAction('reprovar'); setErrMsg(null); }}>
              <XCircle className="h-3.5 w-3.5" />Reprovar
            </Button>
            <Button size="sm" onClick={() => { setDialogAction('aprovar'); setErrMsg(null); }}>
              <CheckCircle2 className="h-3.5 w-3.5" />Aprovar todas
            </Button>
          </div>
        </Card>
      )}

      {/* Lista */}
      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}
      {isError && <div className="rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">{humanizeError(error as Error)}</div>}
      {!isLoading && !isError && filtered.length === 0 && (
        <Empty title={rows.length === 0 ? 'Nenhuma aprovação pendente' : 'Nenhum resultado com os filtros aplicados'}
               body={rows.length === 0 ? 'Você está em dia com todas as aprovações.' : 'Limpe os filtros para ver todas.'}
               icon={<CheckCircle2 className="h-6 w-6 text-success" />} />
      )}

      {filtered.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 dark:bg-muted-dark dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left w-10">
                  <input type="checkbox" checked={allVisibleSelected}
                         ref={(el) => { if (el) el.indeterminate = someVisibleSelected; }}
                         onChange={toggleAllVisible} aria-label="Selecionar todos" />
                </th>
                <th className="px-3 py-2 text-left">Contrato</th>
                <th className="px-3 py-2 text-left">Medição</th>
                <th className="px-3 py-2 text-left">Step</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2 text-left">SLA</th>
                <th className="px-3 py-2 text-left">Há quanto tempo</th>
                <th className="px-3 py-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-border-dark">
              {filtered.map((r) => {
                const Icon = SLA_ICON[r.sla];
                const isSel = selected.has(r.step_id);
                return (
                  <tr key={r.step_id} className={isSel ? 'bg-navy/5 dark:bg-purple/10' : 'hover:bg-slate-50/50 dark:hover:bg-muted-dark/40'}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={isSel} onChange={() => toggleOne(r.step_id)} />
                    </td>
                    <td className="px-3 py-2">
                      <Link to={`/contratos/${r.contract_id}`} className="font-mono text-xs text-navy hover:underline dark:text-purple-300">
                        {r.contract_numero}
                      </Link>
                      <p className="line-clamp-1 text-xs text-slate-500 dark:text-slate-400">{r.contract_objeto}</p>
                    </td>
                    <td className="px-3 py-2">
                      <Link to={`/contratos/${r.contract_id}/medicoes/${r.measurement_id}`}
                            className="font-mono text-navy hover:underline dark:text-purple-300">
                        #{r.measurement_numero}{r.measurement_complementar > 0 ? `.${r.measurement_complementar}` : ''}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-slate-400">[{r.step_ordem}]</span>{' '}
                      <span className="dark:text-slate-200">{r.step_nome}</span>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{r.role_required}</p>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular dark:text-slate-100">{brl(r.measurement_valor_liquido)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={SLA_TONE[r.sla]}>
                        <Icon className="mr-1 inline h-3 w-3" />{SLA_LABEL[r.sla]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                      {relativeTime(r.created_at)}
                      <p className="font-mono">{r.dias_pendente}d</p>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link to={`/contratos/${r.contract_id}/medicoes/${r.measurement_id}/aprovar`}
                            className="text-xs text-navy hover:underline dark:text-purple-300">
                        Ver detalhes
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      {/* Confirm dialog */}
      <Modal open={dialogAction !== null} onClose={() => { setDialogAction(null); setComment(''); }}
             title={dialogAction === 'aprovar' ? 'Aprovar em lote' : dialogAction === 'devolver' ? 'Devolver em lote' : 'Reprovar em lote'}
             footer={
               <>
                 <Button variant="outline" onClick={() => { setDialogAction(null); setComment(''); }}>Cancelar</Button>
                 <Button onClick={() => decide.mutate()} loading={decide.isPending}
                         variant={dialogAction === 'reprovar' ? 'danger' : 'primary'}>
                   {dialogAction === 'aprovar' ? <><CheckCircle2 className="h-4 w-4" />Confirmar aprovação</> :
                    dialogAction === 'devolver' ? <><RotateCcw className="h-4 w-4" />Confirmar devolução</> :
                    <><XCircle className="h-4 w-4" />Confirmar reprovação</>}
                 </Button>
               </>
             }>
        <p className="text-sm dark:text-slate-200">
          Você está prestes a <strong>{dialogAction}</strong> {selected.size} step(s) de aprovação de uma só vez.
        </p>
        {dialogAction !== 'aprovar' && (
          <p className="mt-2 text-xs text-warning">
            Devolução/reprovação interrompe o fluxo da(s) medição(ões). Use o campo abaixo para justificar.
          </p>
        )}
        <Field label="Comentário (opcional)" hint="Será aplicado a todos os steps selecionados">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder={dialogAction === 'aprovar' ? 'Ex: revisado, ok' : 'Ex: faltou anexar nota fiscal'}
            className="input"
          />
        </Field>
      </Modal>
    </Layout>
  );
}
