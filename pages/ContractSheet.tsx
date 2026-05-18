import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Plus, Upload, Lock, Layers, Target, Search, X, FileSearch, History, Calculator, Trophy } from 'lucide-react';
import { useState, useMemo } from 'react';
import { listItems, listSovVersions, listContractItemsAbc, getContractAbcSummary } from '../lib/api';
import type { ContractItemAbc } from '../lib/api';
import { brl, num, dt } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/FormField';
import { Empty, ErrorState, Skeleton } from '../components/ui/Stat';
import { SovBulkActionsBar } from '../components/sov/SovBulkActionsBar';
import { SovBulkOperationModal } from '../components/sov/SovBulkOperationModal';
import { AbcSummaryPanel, AbcBadge } from '../components/sov/AbcPanel';
import { ContractItemHistoryModal } from '../components/sov/ContractItemHistoryModal';
import { ContractItemCompositionModal } from '../components/sov/ContractItemCompositionModal';
import { hasComposition } from '../lib/api';

type BulkOp = 'lock' | 'unlock' | 'set_discipline' | 'adjust_prices' | 'soft_delete';
type SaldoBucket = 'all' | 'positivo' | 'baixo' | 'esgotado';
type AbcFilter = 'all' | 'A' | 'B' | 'C';

export function ContractSheet() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOp, setBulkOp] = useState<BulkOp | null>(null);
  const [abcMode, setAbcMode] = useState(false);
  const [historyFor, setHistoryFor] = useState<{ id: string; codigo?: string; descricao?: string } | null>(null);
  const [compositionFor, setCompositionFor] = useState<{ id: string; codigo?: string; descricao?: string; bdi: number } | null>(null);
  // V57: filtros + busca da SOV
  const [search, setSearch] = useState('');
  const [filterDisciplina, setFilterDisciplina] = useState('');
  const [filterFonte, setFilterFonte] = useState('');
  const [filterSaldo, setFilterSaldo] = useState<SaldoBucket>('all');
  const [filterAbc, setFilterAbc] = useState<AbcFilter>('all');

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

  // V55: ABC data — só fetcha quando o modo é ativado
  const { data: abcItems = [] } = useQuery({
    queryKey: ['contract-items-abc', id],
    queryFn: () => listContractItemsAbc(id),
    enabled: !!id && abcMode,
  });
  const { data: abcSummary } = useQuery({
    queryKey: ['contract-abc-summary', id],
    queryFn: () => getContractAbcSummary(id),
    enabled: !!id && abcMode,
  });

  // Indexa ABC por item.id para lookup O(1) ao renderizar a tabela
  const abcByItemId = useMemo(() => {
    const m = new Map<string, ContractItemAbc>();
    for (const a of abcItems) m.set(a.id, a);
    return m;
  }, [abcItems]);

  // V57: opções distintas para os selects derivadas dos items atuais
  const disciplinaOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      if (it.disciplina && it.disciplina.trim()) set.add(it.disciplina);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [items]);
  const fonteOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      if (it.fonte_referencia && it.fonte_referencia.trim()) set.add(it.fonte_referencia);
    }
    return Array.from(set).sort();
  }, [items]);

  // V57: pipeline de filtragem (todos os filtros aplicados após ABC mode sort)
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      // busca textual em código + descrição
      if (q) {
        const hay = (i.codigo + ' ' + i.descricao).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterDisciplina && i.disciplina !== filterDisciplina) return false;
      if (filterFonte && i.fonte_referencia !== filterFonte) return false;
      if (filterAbc !== 'all') {
        const abc = abcByItemId.get(i.id);
        if (!abc || abc.classe !== filterAbc) return false;
      }
      if (filterSaldo !== 'all') {
        const saldo = i.quantidade_contratada + i.quantidade_aditada - i.quantidade_medida_acumulada;
        const total = i.quantidade_contratada + i.quantidade_aditada;
        if (filterSaldo === 'esgotado' && saldo > 0) return false;
        if (filterSaldo === 'baixo'    && (saldo <= 0 || (total > 0 && saldo >= total * 0.1))) return false;
        if (filterSaldo === 'positivo' && saldo <= 0) return false;
      }
      return true;
    });
  }, [items, search, filterDisciplina, filterFonte, filterAbc, filterSaldo, abcByItemId]);

  const hasActiveFilters = !!(search || filterDisciplina || filterFonte || filterAbc !== 'all' || filterSaldo !== 'all');
  function clearFilters() {
    setSearch(''); setFilterDisciplina(''); setFilterFonte('');
    setFilterAbc('all'); setFilterSaldo('all');
  }

  const totalContratado = items.reduce((s, i) => s + i.quantidade_contratada * i.preco_unitario, 0);
  const totalMedido = items.reduce((s, i) => s + i.quantidade_medida_acumulada * i.preco_unitario, 0);
  const activeVersion = versions.find((v) => v.status === 'vigente');

  // Multi-select helpers — agora baseados em filteredItems (selecionar todos = todos visíveis)
  const allSelected = filteredItems.length > 0 && filteredItems.every((i) => selected.has(i.id));
  const someSelected = filteredItems.some((i) => selected.has(i.id)) && !allSelected;

  function toggleAll() {
    if (allSelected) {
      // remove todos os visíveis da seleção
      setSelected((prev) => {
        const next = new Set(prev);
        for (const i of filteredItems) next.delete(i.id);
        return next;
      });
    } else {
      // adiciona todos os visíveis
      setSelected((prev) => {
        const next = new Set(prev);
        for (const i of filteredItems) next.add(i.id);
        return next;
      });
    }
  }
  function toggleOne(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

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
            <Button
              variant={abcMode ? 'secondary' : 'outline'}
              onClick={() => setAbcMode((v) => !v)}
              title={abcMode ? 'Desligar análise ABC' : 'Análise ABC: classifica itens por valor acumulado (Pareto)'}
            >
              <Target className="h-4 w-4" />
              {abcMode ? 'ABC ativo' : 'Análise ABC'}
            </Button>
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
            <Link to={`/contratos/${id}/auditoria-precos`}>
              <Button variant="outline">
                <FileSearch className="h-4 w-4" />
                Auditoria de preços
              </Button>
            </Link>
            <Link to={`/contratos/${id}/divergencias-preco`}>
              <Button variant="outline">
                <Calculator className="h-4 w-4" />
                Divergências
              </Button>
            </Link>
            <Link to={`/contratos/${id}/comparacao-concorrentes`}>
              <Button variant="outline">
                <Trophy className="h-4 w-4" />
                Concorrentes
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
          <p className="text-xl font-bold tabular text-slate-900 dark:text-slate-100">
            {items.length}
            {hasActiveFilters && (
              <span className="ml-2 text-sm font-normal text-slate-500">
                · {filteredItems.length} filtrado{filteredItems.length === 1 ? '' : 's'}
              </span>
            )}
          </p>
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

      {/* V57: filtros + busca da SOV */}
      {items.length > 0 && (
        <Card className="mb-4 p-4">
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por código ou descrição…"
                className="input pl-10"
              />
            </div>
            <Select
              value={filterDisciplina}
              onChange={(e) => setFilterDisciplina(e.target.value)}
              placeholder="Todas as disciplinas"
              options={disciplinaOptions.map((d) => ({ value: d, label: d }))}
            />
            <Select
              value={filterFonte}
              onChange={(e) => setFilterFonte(e.target.value)}
              placeholder="Todas as fontes"
              options={fonteOptions.map((f) => ({ value: f, label: f }))}
            />
            <Select
              value={filterSaldo}
              onChange={(e) => setFilterSaldo(e.target.value as SaldoBucket)}
              placeholder="Saldo · todos"
              options={[
                { value: 'all',       label: 'Saldo · todos' },
                { value: 'positivo',  label: 'Com saldo (>10%)' },
                { value: 'baixo',     label: 'Saldo baixo (<10%)' },
                { value: 'esgotado',  label: 'Esgotado (=0)' },
              ]}
            />
            <Select
              value={filterAbc}
              onChange={(e) => setFilterAbc(e.target.value as AbcFilter)}
              placeholder="ABC · todas"
              options={[
                { value: 'all', label: 'ABC · todas' },
                { value: 'A',   label: 'Classe A (alto valor)' },
                { value: 'B',   label: 'Classe B (médio)' },
                { value: 'C',   label: 'Classe C (cauda)' },
              ]}
              disabled={!abcMode}
            />
            <Button variant="ghost" onClick={clearFilters} disabled={!hasActiveFilters}
                    title="Limpar todos os filtros">
              <X className="h-4 w-4" />Limpar
            </Button>
          </div>
          {filterAbc !== 'all' && !abcMode && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Filtro ABC requer modo "Análise ABC" ativo.
            </p>
          )}
        </Card>
      )}

      {isError && <ErrorState message={(error as Error).message} />}
      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}
      {!isLoading && !isError && items.length === 0 && (
        <Empty
          title="Planilha vazia"
          body="Importe um Excel ou cadastre os primeiros itens."
          action={<Link to="importar"><Button><Upload className="h-4 w-4" />Importar Excel</Button></Link>}
        />
      )}
      {!isLoading && items.length > 0 && filteredItems.length === 0 && (
        <Empty
          title="Nenhum item nos filtros"
          body="Ajuste os filtros ou limpe-os para ver todos os items da planilha."
          action={<Button variant="outline" onClick={clearFilters}><X className="h-4 w-4" />Limpar filtros</Button>}
        />
      )}

      {abcMode && abcSummary && <AbcSummaryPanel summary={abcSummary} />}

      {!isLoading && filteredItems.length > 0 && (() => {
        // V55: ABC mode — ordena items por valor desc (via abcByItemId.rank)
        const sortedItems = abcMode
          ? [...filteredItems].sort((a, b) => {
              const ra = abcByItemId.get(a.id)?.rank ?? 9999;
              const rb = abcByItemId.get(b.id)?.rank ?? 9999;
              return ra - rb;
            })
          : filteredItems;

        return (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected; }}
                      onChange={toggleAll}
                      className="h-4 w-4 cursor-pointer rounded border-slate-300"
                      aria-label="Selecionar todos"
                    />
                  </th>
                  {abcMode && <th className="w-12 text-center">ABC</th>}
                  <th>Código</th>
                  <th>Descrição</th>
                  <th className="text-center">Un.</th>
                  <th className="text-right">Contratada</th>
                  <th className="text-right">Aditada</th>
                  <th className="text-right">Medida</th>
                  <th className="text-right">Saldo</th>
                  <th className="text-right">Preço unit.</th>
                  {abcMode && <th className="text-right">Valor total</th>}
                  {abcMode && <th className="text-right">% acum.</th>}
                  <th className="w-10 text-center" aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((i) => {
                  const saldo = i.quantidade_contratada + i.quantidade_aditada - i.quantidade_medida_acumulada;
                  const isSel = selected.has(i.id);
                  const abc = abcMode ? abcByItemId.get(i.id) : undefined;
                  return (
                    <tr key={i.id} className={`hover:bg-slate-50 dark:hover:bg-muted-dark ${isSel ? 'bg-magenta-50/30 dark:bg-magenta-900/10' : ''}`}>
                      <td>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleOne(i.id)}
                          className="h-4 w-4 cursor-pointer rounded border-slate-300"
                          aria-label={`Selecionar ${i.codigo}`}
                        />
                      </td>
                      {abcMode && (
                        <td className="text-center">
                          {abc ? <AbcBadge classe={abc.classe} /> : <span className="text-slate-300">—</span>}
                        </td>
                      )}
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
                      {abcMode && (
                        <td className="text-right tabular font-medium">
                          {abc ? brl(abc.valor_total) : '—'}
                        </td>
                      )}
                      {abcMode && (
                        <td className="text-right font-mono text-xs text-slate-500 dark:text-slate-400">
                          {abc ? `${abc.pct_acumulado.toFixed(1)}%` : '—'}
                        </td>
                      )}
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          {hasComposition(i.id) && (
                            <button
                              type="button"
                              onClick={() => setCompositionFor({
                                id: i.id, codigo: i.codigo, descricao: i.descricao,
                                bdi: (i as { bdi_percentual?: number }).bdi_percentual || 0,
                              })}
                              className="p-1 text-slate-400 transition-colors hover:text-navy dark:hover:text-purple-300"
                              title="Composição de preço (insumos)"
                              aria-label={`Composição do item ${i.codigo}`}
                            >
                              <Calculator className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setHistoryFor({ id: i.id, codigo: i.codigo, descricao: i.descricao })}
                            className="p-1 text-slate-400 transition-colors hover:text-navy dark:hover:text-purple-300"
                            title="Histórico de alterações deste item"
                            aria-label={`Histórico do item ${i.codigo}`}
                          >
                            <History className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        );
      })()}

      <SovBulkActionsBar
        count={selected.size}
        onLock={() => setBulkOp('lock')}
        onUnlock={() => setBulkOp('unlock')}
        onSetDiscipline={() => setBulkOp('set_discipline')}
        onAdjustPrices={() => setBulkOp('adjust_prices')}
        onSoftDelete={() => setBulkOp('soft_delete')}
        onClear={() => setSelected(new Set())}
      />

      <SovBulkOperationModal
        op={bulkOp}
        itemIds={Array.from(selected)}
        contractId={id}
        onClose={() => setBulkOp(null)}
        onSuccess={() => {
          setSelected(new Set());
          qc.invalidateQueries({ queryKey: ['items', id] });
        }}
      />

      <ContractItemHistoryModal
        open={!!historyFor}
        onClose={() => setHistoryFor(null)}
        itemId={historyFor?.id ?? null}
        itemCodigo={historyFor?.codigo}
        itemDescricao={historyFor?.descricao}
      />

      <ContractItemCompositionModal
        open={!!compositionFor}
        onClose={() => setCompositionFor(null)}
        itemId={compositionFor?.id ?? null}
        itemCodigo={compositionFor?.codigo}
        itemDescricao={compositionFor?.descricao}
        bdiPercentual={compositionFor?.bdi}
      />
    </Layout>
  );
}
