import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Plus, Calendar, FileText, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { listMeasurements, callFn } from '../lib/api';
import { supabase } from '../lib/supabase';
import { humanizeError } from '../lib/errors';
import { brl, dt } from '../lib/format';
import { MEASUREMENT_STATUS, statusFor } from '../lib/status';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatusPill } from '../components/ui/StatusPill';
import { Button } from '../components/ui/Button';
import { Empty, ErrorState, Skeleton } from '../components/ui/Stat';

export function Measurements() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: ['measurements', id],
    queryFn: () => listMeasurements(id),
    enabled: !!id,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const today = new Date();
      const inicio = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
      const fim    = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
      const { data, error: rpcErr } = await supabase.rpc('create_measurement_period', {
        p_contract_id: id,
        p_periodo_inicio: inicio,
        p_periodo_fim: fim,
        p_tipo: 'mensal_quantitativo',
      });
      if (rpcErr) throw new Error(humanizeError(rpcErr));
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['measurements', id] }); setErr(null); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Layout>
      <PageHeader
        kicker="Operação · Medições"
        title="Medições"
        subtitle="Boletins por período · validação · aprovação · emissão"
        backTo={`/contratos/${id}`}
        backLabel="Contrato"
        actions={
          <Button loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
            <Plus className="h-4 w-4" />
            Nova medição
          </Button>
        }
      />

      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {isError && <ErrorState message={(error as Error).message} />}
      {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}
      {!isLoading && !isError && data.length === 0 && (
        <Empty title="Sem medições" body="Crie a primeira medição deste contrato." />
      )}

      {!isLoading && data.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="table">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Período</th>
                  <th>Tipo</th>
                  <th className="text-right">Valor líquido</th>
                  <th className="text-right">Glosado</th>
                  <th className="text-right">Retido</th>
                  <th>Status</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {data.map((m) => {
                  const s = statusFor(m.status, MEASUREMENT_STATUS);
                  const origin = m.snapshot?.origin;
                  return (
                    <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                      <td className="font-mono text-xs font-bold">
                        {m.numero}{m.complementar_numero ? `.${m.complementar_numero}` : ''}
                        {origin === 'complementar' && <Badge tone="purple" className="ml-1.5">compl.</Badge>}
                        {origin === 'retificacao' && <Badge tone="yellow" className="ml-1.5">retif.</Badge>}
                      </td>
                      <td className="text-sm">
                        <Calendar className="mr-1 inline h-3 w-3 text-slate-400" />
                        {dt(m.periodo_inicio)} — {dt(m.periodo_fim)}
                      </td>
                      <td className="text-xs text-slate-500 dark:text-slate-400">{m.tipo}</td>
                      <td className="text-right tabular font-medium">{brl(m.valor_liquido)}</td>
                      <td className="text-right tabular text-error">{brl(m.valor_glosado)}</td>
                      <td className="text-right tabular text-warning">{brl(m.valor_retido)}</td>
                      <td><StatusPill tone={s.tone}>{s.label}</StatusPill></td>
                      <td className="text-right">
                        <Link to={m.id} className="text-xs font-semibold text-navy hover:underline dark:text-slate-200">
                          Abrir
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

      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        <FileText className="mr-1 inline h-3 w-3" />
        Boletins gerados em PDF (analítico, sintético, EAP, mapa de glosas) e pacote auditável ZIP.
      </p>
    </Layout>
  );
}
