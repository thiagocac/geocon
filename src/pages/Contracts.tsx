import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search, Filter } from 'lucide-react';
import { useState } from 'react';
import { listContracts } from '../lib/api';
import { brl, num } from '../lib/format';
import { CONTRACT_STATUS, statusFor } from '../lib/status';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { StatusPill } from '../components/ui/StatusPill';
import { Button } from '../components/ui/Button';
import { Empty, ErrorState, Skeleton } from '../components/ui/Stat';
import { SavedFiltersBar, useDefaultPreset } from '../components/filters/SavedFiltersBar';

interface ContractsFilters {
  search: string;
  status: string;
}

export function Contracts() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useDefaultPreset<ContractsFilters>('contracts', (f) => {
    if (f.search !== undefined) setSearch(String(f.search));
    if (f.status !== undefined) setStatusFilter(String(f.status));
  });

  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: ['contracts'],
    queryFn: listContracts,
  });

  const filtered = data.filter((c) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.numero.toLowerCase().includes(q) ||
        c.objeto.toLowerCase().includes(q) ||
        c.contratada_nome.toLowerCase().includes(q) ||
        c.municipio.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <Layout>
      <PageHeader
        kicker="Operação · Carteira"
        title="Contratos"
        subtitle="Cadastro contratual, obras/lotes, partes, prazos e valores"
        actions={
          <Link to="/contratos/novo">
            <Button>
              <Plus className="h-4 w-4" />
              Cadastrar
            </Button>
          </Link>
        }
      />

      <div className="mb-3">
        <SavedFiltersBar<ContractsFilters>
          pageKey="contracts"
          currentFilters={{ search, status: statusFilter }}
          hasActiveFilters={!!search || statusFilter !== 'all'}
          onApply={(f) => {
            setSearch(String(f.search ?? ''));
            setStatusFilter(String(f.status ?? 'all'));
          }}
        />
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por número, objeto, contratada, município…"
              className="input pl-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-500" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input w-40"
            >
              <option value="all">Todos status</option>
              {Object.entries(CONTRACT_STATUS).map(([key, v]) => (
                <option key={key} value={key}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {isError && <ErrorState message={(error as Error).message} />}
      {isLoading && (
        <Card className="p-6">
          <Skeleton className="h-64" />
        </Card>
      )}
      {!isLoading && !isError && filtered.length === 0 && (
        <Empty
          title="Nenhum contrato encontrado"
          body="Ajuste os filtros ou crie um novo contrato."
          action={<Link to="/contratos/novo"><Button><Plus className="h-4 w-4" />Cadastrar</Button></Link>}
        />
      )}

      {!isLoading && filtered.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Contrato</th>
                  <th>Contratada</th>
                  <th>Local</th>
                  <th className="text-right">Valor atual</th>
                  <th className="text-right">Medido %</th>
                  <th className="text-right">Saldo</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const status = statusFor(c.status, CONTRACT_STATUS);
                  return (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                      <td>
                        <Link className="font-semibold text-navy hover:underline dark:text-slate-200" to={`/contratos/${c.id}`}>
                          {c.numero}
                        </Link>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{c.objeto.slice(0, 80)}</p>
                      </td>
                      <td className="text-sm">{c.contratada_nome || '—'}</td>
                      <td className="text-sm">
                        {c.municipio ? `${c.municipio}/${c.uf}` : '—'}
                      </td>
                      <td className="text-right tabular text-sm font-medium">{brl(c.valor_atual)}</td>
                      <td className="text-right tabular text-sm">{num(c.percentual_financeiro)}%</td>
                      <td className="text-right tabular text-sm">{brl(c.saldo_contratual)}</td>
                      <td>
                        <StatusPill tone={status.tone}>{status.label}</StatusPill>
                      </td>
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
