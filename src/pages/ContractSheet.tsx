import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Plus, Upload, Lock, Layers } from 'lucide-react';
import { listItems, listSovVersions } from '../lib/api';
import { brl, num, dt } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Empty, ErrorState, Skeleton } from '../components/ui/Stat';

export function ContractSheet() {
  const { id = '' } = useParams();
  const { data: items = [], isLoading, isError, error } = useQuery({
    queryKey: ['items', id],
    queryFn: () => listItems(id),
    enabled: !!id,
  });
  const { data: versions = [] } = useQuery({
    queryKey: ['sov-versions', id],
    queryFn: () => listSovVersions(id),
    enabled: !!id,
  });

  const totalContratado = items.reduce((s, i) => s + i.quantidade_contratada * i.preco_unitario, 0);
  const totalMedido = items.reduce((s, i) => s + i.quantidade_medida_acumulada * i.preco_unitario, 0);
  const activeVersion = versions.find((v) => v.status === 'vigente');

  return (
    <Layout>
      <PageHeader
        kicker="Contrato · Planilha SOV"
        title="Planilha contratual / SOV"
        subtitle="Versionamento, saldo em tempo real, bloqueio pós-medição e vínculo EAP"
        backTo={`/contratos/${id}`}
        backLabel="Contrato"
        actions={
          <>
            <Link to="importar">
              <Button variant="outline">
                <Upload className="h-4 w-4" />
                Importar Excel
              </Button>
            </Link>
            <Link to="versoes">
              <Button variant="outline">
                <Layers className="h-4 w-4" />
                Comparar versões
              </Button>
            </Link>
            <Button>
              <Plus className="h-4 w-4" />
              Item
            </Button>
          </>
        }
      />

      {versions.length > 0 && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Layers className="h-4 w-4 text-slate-500" />
              <span className="font-medium dark:text-slate-100">Versões da planilha:</span>
              {versions.map((v) => (
                <Badge key={v.id} tone={v.status === 'vigente' ? 'green' : 'slate'}>
                  v{v.numero} {v.status === 'vigente' ? '(vigente)' : v.status}
                </Badge>
              ))}
            </div>
            {activeVersion && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Vigente desde {dt(activeVersion.created_at)}
                {activeVersion.origem && <> · origem: {activeVersion.origem}</>}
              </p>
            )}
          </div>
        </Card>
      )}

      <div className="mb-4 grid gap-3 text-sm md:grid-cols-3">
        <Card className="px-4 py-3">
          <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Itens cadastrados</p>
          <p className="text-xl font-bold tabular text-slate-900 dark:text-slate-100">{items.length}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Valor contratado</p>
          <p className="text-xl font-bold tabular text-slate-900 dark:text-slate-100">{brl(totalContratado)}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Valor medido (acumulado)</p>
          <p className="text-xl font-bold tabular text-slate-900 dark:text-slate-100">{brl(totalMedido)}</p>
        </Card>
      </div>

      {isError && <ErrorState message={(error as Error).message} />}
      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}
      {!isLoading && !isError && items.length === 0 && (
        <Empty
          title="Planilha vazia"
          body="Importe um Excel ou cadastre os primeiros itens."
          action={<Link to="importar"><Button><Upload className="h-4 w-4" />Importar Excel</Button></Link>}
        />
      )}

      {!isLoading && items.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th className="text-center">Un.</th>
                  <th className="text-right">Contratada</th>
                  <th className="text-right">Aditada</th>
                  <th className="text-right">Medida</th>
                  <th className="text-right">Saldo</th>
                  <th className="text-right">Preço unit.</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const saldo = i.quantidade_contratada + i.quantidade_aditada - i.quantidade_medida_acumulada;
                  return (
                    <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                      <td className="font-mono text-xs">{i.codigo}</td>
                      <td>
                        <p className="font-medium text-slate-900 dark:text-slate-100">{i.descricao}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {i.disciplina} · {i.fonte_referencia}
                          {i.locked && <Lock className="ml-1 inline h-3 w-3 text-slate-400" />}
                        </p>
                      </td>
                      <td className="text-center text-xs uppercase text-slate-600 dark:text-slate-300">{i.unidade}</td>
                      <td className="text-right tabular">{num(i.quantidade_contratada, 6)}</td>
                      <td className="text-right tabular">{num(i.quantidade_aditada, 6)}</td>
                      <td className="text-right tabular">{num(i.quantidade_medida_acumulada, 6)}</td>
                      <td className="text-right">
                        <Badge tone={saldo <= 0 ? 'red' : saldo < (i.quantidade_contratada + i.quantidade_aditada) * 0.1 ? 'yellow' : 'green'}>
                          {num(saldo, 6)}
                        </Badge>
                      </td>
                      <td className="text-right tabular">{brl(i.preco_unitario)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Layout>
  );
}
