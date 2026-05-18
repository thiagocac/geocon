import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldOff, AlertTriangle, Search, X, Filter, CheckCircle2, ChevronRight,
  Hammer, Building2, Calendar, FileText, ExternalLink, Download, Clock,
} from 'lucide-react';
import {
  listSanctionedSuppliers, getSanctionedSuppliersSummary, getSanctionedSupplierDetail,
  checkCnpjSanctioned,
  SANCTION_TIPO_LABELS, sanctionTipoTone, SANCTION_STATUS_LABELS, sanctionStatusTone,
  SANCTIONED_SEVERITY_LABELS, sanctionedSeverityTone, fmtCnpj,
  type SanctionedSupplierRow, type SanctionedSupplierSeverity, type SanctionedSupplierStatus,
  type SanctionedSupplierDetail, type CnpjSanctionedCheck,
} from '../lib/api';
import { humanizeError } from '../lib/errors';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Field } from '../components/ui/FormField';
import { KpiGrid, KpiCard } from '../components/ui/KpiGrid';

function brl(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
  });
}
function brlShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(Number(n))) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1e6) return `R$ ${(v / 1e6).toFixed(1).replace('.', ',')}M`;
  if (Math.abs(v) >= 1e3) return `R$ ${(v / 1e3).toFixed(1).replace('.', ',')}k`;
  return brl(v);
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

const ALL_SEVERITIES: SanctionedSupplierSeverity[] = ['critica', 'alta', 'media', 'baixa'];

export function SanctionedSuppliers() {
  const [search, setSearch] = useState('');
  const [severities, setSeverities] = useState<Set<SanctionedSupplierSeverity>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<SanctionedSupplierStatus>>(new Set());
  const [onlyActive, setOnlyActive] = useState(false);
  const [detailCnpj, setDetailCnpj] = useState<string | null>(null);
  const [checkCnpjOpen, setCheckCnpjOpen] = useState(false);

  const filters = useMemo(() => ({
    q:                search || undefined,
    severidade:       severities.size > 0 ? Array.from(severities) : undefined,
    status:           statusFilter.size > 0 ? Array.from(statusFilter) : undefined,
    only_with_active: onlyActive,
  }), [search, severities, statusFilter, onlyActive]);

  const { data: summary } = useQuery({
    queryKey: ['sanctioned-suppliers-summary'],
    queryFn: getSanctionedSuppliersSummary,
  });
  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ['sanctioned-suppliers', filters],
    queryFn: () => listSanctionedSuppliers(filters),
  });

  const hasFilters = !!search || severities.size > 0 || statusFilter.size > 0 || onlyActive;

  function toggleSeverity(s: SanctionedSupplierSeverity) {
    setSeverities((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }
  function toggleStatus(s: SanctionedSupplierStatus) {
    setStatusFilter((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }
  function clearFilters() {
    setSearch(''); setSeverities(new Set()); setStatusFilter(new Set()); setOnlyActive(false);
  }

  function exportCsv() {
    if (suppliers.length === 0) return;
    const rows: string[] = [
      'CNPJ,Nome,Severidade,Status,Sanções ativas,Total,Advertência,Multa,Impedimento,Inidoneidade,Multa pendente (R$),Primeira sanção,Última sanção,Vigência fim,Contratos afetados',
    ];
    for (const s of suppliers) {
      const esc = (v: string | number | null | undefined) => {
        if (v === null || v === undefined) return '';
        const str = String(v);
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      };
      rows.push([
        esc(fmtCnpj(s.cnpj)), esc(s.nome),
        esc(SANCTIONED_SEVERITY_LABELS[s.severidade_atual]),
        esc(s.status_agregado),
        esc(s.sancoes_ativas), esc(s.sancoes_total),
        esc(s.qt_advertencia), esc(s.qt_multa), esc(s.qt_impedimento), esc(s.qt_inidoneidade),
        esc(s.multa_pendente),
        esc(s.primeira_sancao), esc(s.ultima_sancao), esc(s.vigencia_fim_ativa),
        esc(s.contratos_distintos),
      ].join(','));
    }
    const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fornecedores-sancionados-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Layout>
        <PageHeader
          kicker="Carteira"
          title="Fornecedores sancionados"
          subtitle="Cadastro cross-contract · histórico de sanções por CNPJ · base para próximas licitações"
          actions={
            <>
              <Button variant="outline" onClick={() => setCheckCnpjOpen(true)}>
                <Search className="h-4 w-4" />Verificar CNPJ
              </Button>
              <Button variant="outline" onClick={exportCsv} disabled={suppliers.length === 0}>
                <Download className="h-4 w-4" />Exportar CSV
              </Button>
            </>
          }
        />

        {/* KPIs */}
        {summary && (
          <KpiGrid cols={4}>
            <KpiCard
              label="Fornecedores sancionados"
              value={summary.total}
              sublabel={`${summary.com_sancao_ativa} com sanção ativa`}
            />
            <KpiCard
              label="Severidade crítica"
              value={summary.por_severidade.critica}
              valueTone={summary.por_severidade.critica > 0 ? 'error' : 'default'}
              icon={<AlertTriangle className="h-3 w-3 text-slate-400" />}
              sublabel={`${summary.por_severidade.alta} de alta · ${summary.por_severidade.media} de média`}
            />
            <KpiCard
              label="Impedimentos ativos"
              value={summary.impedimentos_ativos}
              valueTone={summary.impedimentos_ativos > 0 ? 'error' : 'default'}
              icon={<ShieldOff className="h-3 w-3 text-slate-400" />}
              sublabel={`${summary.inidoneidades_ativas} inidoneidades`}
            />
            <KpiCard
              label="Multas pendentes"
              value={brlShort(summary.multa_pendente_total)}
              valueTone={summary.multa_pendente_total > 0 ? 'warning' : 'default'}
              icon={<Hammer className="h-3 w-3 text-slate-400" />}
            />
          </KpiGrid>
        )}

        {/* Filtros */}
        <Card className="mb-4">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-border-dark">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-slate-500" />
                <p className="font-semibold dark:text-slate-200">Filtros</p>
                {hasFilters && (
                  <span className="rounded-full bg-magenta/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-magenta">
                    ativos
                  </span>
                )}
              </div>
              {hasFilters && (
                <button type="button" onClick={clearFilters} className="text-xs text-magenta hover:underline">
                  Limpar
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3 p-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por CNPJ ou nome…"
                className="input pl-8"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Severidade */}
            <div>
              <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
                Severidade
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ALL_SEVERITIES.map((s) => {
                  const active = severities.has(s);
                  const count = summary?.por_severidade[s as 'critica' | 'alta' | 'media' | 'baixa'] ?? 0;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSeverity(s)}
                      className={[
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                        active
                          ? 'border-magenta bg-magenta/10 text-magenta dark:border-magenta dark:bg-magenta/20'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-border-dark dark:bg-card-dark dark:text-slate-300 dark:hover:bg-muted-dark',
                      ].join(' ')}
                    >
                      <span className={`h-2 w-2 rounded-full ${
                        s === 'critica' ? 'bg-error' :
                        s === 'alta'    ? 'bg-error/70' :
                        s === 'media'   ? 'bg-yellow-500' :
                                          'bg-blue-500'
                      }`} />
                      {SANCTIONED_SEVERITY_LABELS[s]}
                      <span className={`font-mono text-[10px] tabular ${active ? 'text-magenta' : 'text-slate-400'}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Status agregado */}
            <div>
              <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
                Status
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {(['ativo', 'historico'] as const).map((s) => (
                  <label key={s} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={statusFilter.has(s)}
                      onChange={() => toggleStatus(s)}
                    />
                    {s === 'ativo' ? 'Com sanção ativa' : 'Histórico (todas cumpridas/revogadas)'}
                  </label>
                ))}
                <label className="flex items-center gap-1.5 text-sm cursor-pointer border-l border-slate-200 pl-3 dark:border-border-dark">
                  <input
                    type="checkbox"
                    checked={onlyActive}
                    onChange={(e) => setOnlyActive(e.target.checked)}
                  />
                  Apenas com impedimento/inidoneidade ativos
                </label>
              </div>
            </div>
          </div>
        </Card>

        {/* Tabela */}
        <Card>
          <div className="border-b border-slate-200 px-4 py-3 dark:border-border-dark">
            <p className="font-semibold dark:text-slate-200">
              {isLoading ? 'Carregando…' : `${suppliers.length.toLocaleString('pt-BR')} fornecedor${suppliers.length === 1 ? '' : 'es'}`}
            </p>
          </div>

          {!isLoading && suppliers.length === 0 && (
            <div className="px-4 py-12 text-center">
              <ShieldOff className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {hasFilters ? 'Nenhum fornecedor com os filtros aplicados' : 'Nenhuma sanção registrada na carteira'}
              </p>
            </div>
          )}

          {suppliers.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-border-dark">
              {suppliers.map((s) => (
                <SupplierRow
                  key={s.cnpj}
                  s={s}
                  onClick={() => setDetailCnpj(s.cnpj)}
                />
              ))}
            </ul>
          )}
        </Card>
      </Layout>

      {/* Modal detalhe */}
      <SupplierDetailModal
        cnpj={detailCnpj}
        onClose={() => setDetailCnpj(null)}
      />

      {/* Modal verificação CNPJ */}
      <CheckCnpjModal
        open={checkCnpjOpen}
        onClose={() => setCheckCnpjOpen(false)}
      />
    </>
  );
}

// =============================================================================
// Linha de fornecedor
// =============================================================================
function SupplierRow({ s, onClick }: { s: SanctionedSupplierRow; onClick: () => void }) {
  const sevTone = sanctionedSeverityTone(s.severidade_atual);

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-muted-dark/30"
      >
        <div className="flex-shrink-0 mt-0.5">
          <div className={`flex h-9 w-9 items-center justify-center rounded-full ${
            sevTone === 'red'    ? 'bg-error/10 text-error' :
            sevTone === 'yellow' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
            sevTone === 'blue'   ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                                   'bg-slate-100 text-slate-500 dark:bg-muted-dark dark:text-slate-400'
          }`}>
            <Building2 className="h-4 w-4" />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <p className="font-mono text-xs tabular text-slate-600 dark:text-slate-300">{fmtCnpj(s.cnpj)}</p>
            <Badge tone={sevTone}>{SANCTIONED_SEVERITY_LABELS[s.severidade_atual]}</Badge>
            {s.status_agregado === 'ativo' && (
              <Badge tone="red">{s.sancoes_ativas} ativa{s.sancoes_ativas === 1 ? '' : 's'}</Badge>
            )}
          </div>
          <p className="text-sm font-medium dark:text-slate-200 line-clamp-1">{s.nome}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
            <span className="font-mono">
              {s.sancoes_total} sanç{s.sancoes_total === 1 ? 'ão' : 'ões'}
              {s.qt_inidoneidade > 0 && <span className="ml-1 font-bold text-error">· {s.qt_inidoneidade}IN</span>}
              {s.qt_impedimento  > 0 && <span className="ml-1 font-bold text-error">· {s.qt_impedimento}I</span>}
              {s.qt_multa        > 0 && <span className="ml-1">· {s.qt_multa}M</span>}
              {s.qt_advertencia  > 0 && <span className="ml-1">· {s.qt_advertencia}A</span>}
            </span>
            <span>·</span>
            <span>{s.contratos_distintos} contrato{s.contratos_distintos === 1 ? '' : 's'} afetado{s.contratos_distintos === 1 ? '' : 's'}</span>
            {s.multa_pendente > 0 && (
              <>
                <span>·</span>
                <span className="font-mono text-yellow-700 dark:text-yellow-300">
                  {brlShort(s.multa_pendente)} pendente
                </span>
              </>
            )}
            {s.vigencia_fim_ativa && s.dias_ate_vencimento !== null && (
              <>
                <span>·</span>
                <span className={`font-mono ${
                  s.dias_ate_vencimento <= 0 ? 'text-success' :
                  s.dias_ate_vencimento <= 30 ? 'text-error' :
                                                'text-slate-500'
                }`}>
                  {s.dias_ate_vencimento > 0
                    ? `vence em ${s.dias_ate_vencimento}d`
                    : `vencida há ${Math.abs(s.dias_ate_vencimento)}d`}
                </span>
              </>
            )}
          </div>
        </div>

        <ChevronRight className="mt-3 h-4 w-4 flex-shrink-0 text-slate-300 transition-colors group-hover:text-magenta" />
      </button>
    </li>
  );
}

// =============================================================================
// Modal: detalhe do fornecedor
// =============================================================================
function SupplierDetailModal({ cnpj, onClose }: { cnpj: string | null; onClose: () => void }) {
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['supplier-detail', cnpj],
    queryFn: () => getSanctionedSupplierDetail(cnpj!),
    enabled: !!cnpj,
  });

  return (
    <Modal
      open={!!cnpj}
      onClose={onClose}
      title="Detalhe do fornecedor"
      size="xl"
      footer={
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </div>
      }
    >
      {isLoading && <p className="text-sm text-slate-500">Carregando…</p>}
      {error && (
        <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-3 text-sm text-error">
          <AlertTriangle className="mr-1 inline h-4 w-4" />
          {humanizeError(error)}
        </div>
      )}
      {data && <SupplierDetailContent data={data} onContractClick={(id) => { navigate(`/contratos/${id}/sancoes`); onClose(); }} />}
    </Modal>
  );
}

function SupplierDetailContent({
  data, onContractClick,
}: {
  data: SanctionedSupplierDetail;
  onContractClick: (id: string) => void;
}) {
  const { summary, sanctions, contracts } = data;
  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className={`flex h-12 w-12 items-center justify-center rounded-full flex-shrink-0 ${
            sanctionedSeverityTone(summary.severidade_atual) === 'red' ? 'bg-error/10 text-error' :
            sanctionedSeverityTone(summary.severidade_atual) === 'yellow' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30' :
            'bg-slate-100 text-slate-500 dark:bg-muted-dark'
          }`}>
            <Building2 className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold dark:text-slate-200">{summary.nome}</p>
            <p className="font-mono text-xs text-slate-500">{fmtCnpj(summary.cnpj)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone={sanctionedSeverityTone(summary.severidade_atual)}>
                {SANCTIONED_SEVERITY_LABELS[summary.severidade_atual]}
              </Badge>
              {summary.status_agregado === 'ativo' && (
                <Badge tone="red">{summary.sancoes_ativas} ativa{summary.sancoes_ativas === 1 ? '' : 's'}</Badge>
              )}
              {summary.email && <span className="font-mono text-[11px] text-slate-500">· {summary.email}</span>}
            </div>
          </div>
        </div>
      </Card>

      {/* KPIs detalhados */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3">
          <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">Advertências</p>
          <p className="mt-1 font-mono tabular text-xl font-bold dark:text-slate-200">{summary.qt_advertencia}</p>
        </Card>
        <Card className="p-3">
          <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">Multas</p>
          <p className="mt-1 font-mono tabular text-xl font-bold dark:text-slate-200">{summary.qt_multa}</p>
          {summary.multa_pendente > 0 && (
            <p className="font-mono text-[10px] text-yellow-700 dark:text-yellow-300">
              {brlShort(summary.multa_pendente)} pendente
            </p>
          )}
        </Card>
        <Card className="p-3">
          <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">Impedimentos</p>
          <p className={`mt-1 font-mono tabular text-xl font-bold ${
            summary.impedimento_ativo > 0 ? 'text-error' : 'dark:text-slate-200'
          }`}>{summary.qt_impedimento}</p>
          {summary.impedimento_ativo > 0 && (
            <p className="font-mono text-[10px] text-error">{summary.impedimento_ativo} ativo{summary.impedimento_ativo === 1 ? '' : 's'}</p>
          )}
        </Card>
        <Card className="p-3">
          <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">Inidoneidade</p>
          <p className={`mt-1 font-mono tabular text-xl font-bold ${
            summary.inidoneidade_ativa > 0 ? 'text-error' : 'dark:text-slate-200'
          }`}>{summary.qt_inidoneidade}</p>
          {summary.inidoneidade_ativa > 0 && (
            <p className="font-mono text-[10px] text-error">{summary.inidoneidade_ativa} ativa{summary.inidoneidade_ativa === 1 ? '' : 's'}</p>
          )}
        </Card>
      </div>

      {/* Vigência */}
      {summary.vigencia_fim_ativa && (
        <Card className={`p-3 border-2 ${
          summary.dias_ate_vencimento && summary.dias_ate_vencimento <= 0
            ? 'border-success/40 bg-success/5'
            : summary.dias_ate_vencimento && summary.dias_ate_vencimento <= 30
              ? 'border-error/40 bg-error/5'
              : 'border-slate-200 dark:border-border-dark'
        }`}>
          <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">Sanção mais longa ativa</p>
          <p className="mt-1 text-sm dark:text-slate-200">
            Vigência até <strong>{fmtDate(summary.vigencia_fim_ativa)}</strong>
            {summary.dias_ate_vencimento !== null && (
              <span className={`ml-2 font-mono text-xs ${
                summary.dias_ate_vencimento <= 0 ? 'text-success' :
                summary.dias_ate_vencimento <= 30 ? 'text-error' :
                                                    'text-slate-500'
              }`}>
                ({summary.dias_ate_vencimento > 0
                  ? `${summary.dias_ate_vencimento} dia${summary.dias_ate_vencimento === 1 ? '' : 's'} restante${summary.dias_ate_vencimento === 1 ? '' : 's'}`
                  : `expirada há ${Math.abs(summary.dias_ate_vencimento)} dia${Math.abs(summary.dias_ate_vencimento) === 1 ? '' : 's'}`})
              </span>
            )}
          </p>
        </Card>
      )}

      {/* Contratos afetados */}
      <div>
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
          Contratos afetados · {contracts.length}
        </p>
        <Card>
          <ul className="divide-y divide-slate-100 dark:divide-border-dark">
            {contracts.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onContractClick(c.id)}
                  className="group flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-muted-dark/30"
                >
                  <span className="font-mono text-xs font-bold text-magenta">#{c.numero}</span>
                  <span className="text-sm dark:text-slate-200 line-clamp-1 flex-1">{c.titulo}</span>
                  <span className="font-mono text-[10px] text-slate-500 flex-shrink-0">{brlShort(c.valor_total_atual)}</span>
                  <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-slate-300 transition-colors group-hover:text-magenta" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Sanções */}
      <div>
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
          Sanções aplicadas · {sanctions.length}
        </p>
        <Card>
          <ul className="divide-y divide-slate-100 dark:divide-border-dark">
            {sanctions.map((s) => (
              <li key={s.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <Badge tone={sanctionTipoTone(s.tipo)}>{SANCTION_TIPO_LABELS[s.tipo]}</Badge>
                  <Badge tone={sanctionStatusTone(s.status)}>{SANCTION_STATUS_LABELS[s.status]}</Badge>
                  <span className="font-mono text-[10px] text-magenta font-bold">#{s.contract_numero}·{s.numero}</span>
                  <span className="font-mono text-[10px] text-slate-400">{fmtDate(s.data_aplicacao)}</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{s.fundamentacao}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] font-mono">
                  {s.valor_multa && (
                    <span className="text-slate-500">
                      Multa: <span className="font-semibold dark:text-slate-200">{brl(s.valor_multa)}</span>
                      {s.data_pagamento_multa && <span className="text-success"> · paga {fmtDate(s.data_pagamento_multa)}</span>}
                    </span>
                  )}
                  {s.vigencia_fim && (
                    <span className="text-slate-500">
                      Vigência: {fmtDate(s.vigencia_inicio)} → {fmtDate(s.vigencia_fim)}
                      {s.duracao_meses && <span> ({s.duracao_meses}m)</span>}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// =============================================================================
// Modal: verificação rápida de CNPJ (para fluxo de licitação)
// =============================================================================
function CheckCnpjModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cnpj, setCnpj] = useState('');
  const [result, setResult] = useState<CnpjSanctionedCheck | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheck() {
    if (!cnpj.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await checkCnpjSanctioned(cnpj.trim());
      setResult(r);
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setCnpj(''); setResult(null); setError(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Verificar CNPJ"
      subtitle="Confere se um fornecedor está bloqueado para licitar/contratar"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose}>Fechar</Button>
          <Button onClick={handleCheck} loading={loading} disabled={!cnpj.trim()}>
            <Search className="h-4 w-4" />Verificar
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="CNPJ" required hint="Aceita formato 00.000.000/0000-00 ou apenas números">
          <input
            type="text"
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCheck(); }}
            placeholder="00.000.000/0000-00"
            className="input font-mono"
            autoFocus
          />
        </Field>

        {error && (
          <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
            <AlertTriangle className="mr-1 inline h-4 w-4" />{error}
          </div>
        )}

        {result && (
          <div className={`rounded-lg border-2 p-3 ${
            result.pode_contratar
              ? 'border-success/40 bg-success/5'
              : 'border-error/40 bg-error/5'
          }`}>
            <div className="flex items-start gap-2">
              {result.pode_contratar
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-success" />
                : <ShieldOff   className="mt-0.5 h-5 w-5 flex-shrink-0 text-error" />}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${result.pode_contratar ? 'text-success' : 'text-error'}`}>
                  {result.pode_contratar ? '✓ Pode contratar' : '✗ Bloqueado para contratação'}
                </p>
                {result.nome && (
                  <p className="mt-1 text-sm dark:text-slate-200">{result.nome}</p>
                )}
                <p className="font-mono text-xs text-slate-500">{fmtCnpj(result.cnpj)}</p>

                {result.motivo_bloqueio && (
                  <p className="mt-2 text-xs font-medium text-error">{result.motivo_bloqueio}</p>
                )}

                {result.found && (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                    <span>Severidade: <strong>{SANCTIONED_SEVERITY_LABELS[result.severidade]}</strong></span>
                    {result.sancoes_ativas !== undefined && result.sancoes_ativas > 0 && (
                      <span>· {result.sancoes_ativas} sanç{result.sancoes_ativas === 1 ? 'ão' : 'ões'} ativa{result.sancoes_ativas === 1 ? '' : 's'}</span>
                    )}
                    {result.ultima_sancao && (
                      <span>· última sanção: {fmtDate(result.ultima_sancao)}</span>
                    )}
                  </div>
                )}

                {!result.found && (
                  <p className="mt-2 text-xs text-slate-500">
                    Nenhuma sanção encontrada na carteira para este CNPJ.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
