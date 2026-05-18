import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Stamp, ShieldCheck, User, Mail, FileText, Filter, Download, Search, X as XIcon,
} from 'lucide-react';
import { listGedWatermarkLog, getGedDocument } from '../../lib/api';
import { dtTime, relativeTime } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Empty, Skeleton } from '../../components/ui/Stat';

/**
 * V68 — Audit log de downloads com marca d'água.
 * V73 — Filtros (downloader, período, recipient search) + export CSV.
 *
 * Rota: /ged/documentos/:docId/marca-dagua-log
 *
 * Lista cada download de PDF marcado, com fingerprint, downloader,
 * destinatário e timestamp. Permite rastrear vazamentos: dado um PDF
 * vazado, encontrar quem baixou pelo fingerprint impresso no rodapé.
 *
 * Em investigação real de vazamento, filtros são essenciais para reduzir
 * centenas de entradas a um subset relevante (ex: "todos downloads para o
 * cliente XYZ nos últimos 30d").
 */
export function WatermarkLog() {
  const { docId = '' } = useParams();

  const { data: doc } = useQuery({
    queryKey: ['ged-doc', docId],
    queryFn: () => getGedDocument(docId),
    enabled: !!docId,
  });

  const { data: log = [], isLoading } = useQuery({
    queryKey: ['ged-watermark-log', docId],
    queryFn: () => listGedWatermarkLog(docId),
    enabled: !!docId,
  });

  // V73 — filtros client-side
  const [filterDownloader, setFilterDownloader] = useState<string>('all');
  const [filterPeriod,     setFilterPeriod]     = useState<'all' | '7d' | '30d' | '90d'>('all');
  const [searchRecipient,  setSearchRecipient]  = useState<string>('');

  const downloaderOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const e of log) {
      if (e.downloader_email && e.downloader_nome) set.set(e.downloader_email, e.downloader_nome);
    }
    return Array.from(set.entries());
  }, [log]);

  const filtered = useMemo(() => {
    let r = log;
    if (filterDownloader !== 'all') r = r.filter((e) => e.downloader_email === filterDownloader);
    if (filterPeriod !== 'all') {
      const days = filterPeriod === '7d' ? 7 : filterPeriod === '30d' ? 30 : 90;
      const cutoff = Date.now() - days * 86_400_000;
      r = r.filter((e) => new Date(e.created_at).getTime() >= cutoff);
    }
    if (searchRecipient.trim()) {
      const q = searchRecipient.trim().toLowerCase();
      r = r.filter((e) => (e.recipient_label || '').toLowerCase().includes(q) || e.fingerprint.toLowerCase().includes(q));
    }
    return r;
  }, [log, filterDownloader, filterPeriod, searchRecipient]);

  const hasFilter = filterDownloader !== 'all' || filterPeriod !== 'all' || searchRecipient.trim().length > 0;
  function clearFilters() {
    setFilterDownloader('all'); setFilterPeriod('all'); setSearchRecipient('');
  }

  function exportCsv() {
    downloadCsv(
      `watermark-log-${docId}.csv`,
      filtered.map((e) => ({
        fingerprint: e.fingerprint,
        revision: e.version_revision || '',
        downloader_nome: e.downloader_nome || '',
        downloader_email: e.downloader_email || '',
        recipient_label: e.recipient_label || '',
        icp_brasil: e.icp_brasil_signed ? 'sim' : 'não',
        created_at: e.created_at,
      })),
      {
        fingerprint: 'Fingerprint', revision: 'Revisão',
        downloader_nome: 'Quem baixou', downloader_email: 'E-mail',
        recipient_label: 'Destinatário', icp_brasil: 'ICP-Brasil',
        created_at: 'Data/hora',
      },
    );
  }

  return (
    <Layout>
      <PageHeader
        kicker="GED · Rastreabilidade"
        title="Downloads com marca d'água"
        subtitle={doc?.title || 'Histórico de cópias controladas distribuídas'}
        backTo={`/ged/documentos/${docId}`}
        backLabel="Documento"
      />

      {isLoading && <Card className="p-6"><Skeleton className="h-32" /></Card>}

      {!isLoading && log.length === 0 && (
        <Empty
          title="Sem downloads registrados"
          body="Nenhuma cópia com marca d'água foi gerada para este documento. Use 'Baixar com marca d'água' no detalhe."
          action={<Link to={`/ged/documentos/${docId}`} className="font-semibold text-navy hover:underline">Voltar ao documento →</Link>}
        />
      )}

      {!isLoading && log.length > 0 && (
        <>
          <p className="mb-3 flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
            <Stamp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-navy dark:text-purple-300" aria-hidden />
            <span>
              Cada PDF baixado tem um <strong>fingerprint</strong> único impresso
              no rodapé. Se um PDF vazar, busque o fingerprint nesta lista para
              identificar o responsável original pelo download.
            </span>
          </p>

          {/* V73 — Filtros */}
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <Filter className="h-3 w-3 text-slate-400" aria-hidden />
            <select
              value={filterDownloader}
              onChange={(e) => setFilterDownloader(e.target.value)}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs dark:border-border-dark dark:bg-card-dark"
            >
              <option value="all">Todos downloaders</option>
              {downloaderOptions.map(([email, nome]) => (
                <option key={email} value={email}>{nome}</option>
              ))}
            </select>
            <select
              value={filterPeriod}
              onChange={(e) => setFilterPeriod(e.target.value as typeof filterPeriod)}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs dark:border-border-dark dark:bg-card-dark"
            >
              <option value="all">Qualquer período</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="90d">Últimos 90 dias</option>
            </select>
            <div className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 dark:border-border-dark dark:bg-card-dark">
              <Search className="h-3 w-3 text-slate-400" aria-hidden />
              <input
                type="text"
                value={searchRecipient}
                onChange={(e) => setSearchRecipient(e.target.value)}
                placeholder="Buscar destinatário ou FP…"
                className="w-44 bg-transparent text-xs outline-none placeholder:text-slate-400"
              />
            </div>
            {hasFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-display text-slate-500 hover:text-error dark:text-slate-400"
              >
                <XIcon className="h-3 w-3" />Limpar
              </button>
            )}
            <button
              type="button"
              onClick={exportCsv}
              disabled={filtered.length === 0}
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-display text-slate-500 hover:text-navy disabled:opacity-40 dark:text-slate-400 dark:hover:text-purple-300"
              title="Exportar entradas filtradas como CSV"
            >
              <Download className="h-3 w-3" />CSV
            </button>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
              {filtered.length} de {log.length}
            </span>
          </div>

          {filtered.length === 0 && (
            <Empty
              title="Nada nos filtros atuais"
              body="Ajuste ou limpe filtros para ver outros downloads."
            />
          )}

          {filtered.length > 0 && (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-slate-100 dark:divide-border-dark">
              {filtered.map((entry) => (
                <li key={entry.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-muted-dark">
                        <Stamp className="h-4 w-4 text-navy dark:text-purple-300" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-mono text-xs font-semibold tracking-wide text-slate-900 dark:text-slate-100" title="Fingerprint impresso no rodapé do PDF">
                            FP: {entry.fingerprint}
                          </span>
                          {entry.version_revision && (
                            <span className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
                              Revisão {entry.version_revision}
                            </span>
                          )}
                          {entry.icp_brasil_signed && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-display text-success">
                              <ShieldCheck className="h-3 w-3" />ICP-Brasil
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600 dark:text-slate-400">
                          {entry.downloader_nome && (
                            <span className="inline-flex items-center gap-1">
                              <User className="h-3 w-3" aria-hidden />
                              {entry.downloader_nome}
                            </span>
                          )}
                          {entry.downloader_email && (
                            <span className="inline-flex items-center gap-1 font-mono text-[10px]">
                              <Mail className="h-3 w-3" aria-hidden />
                              {entry.downloader_email}
                            </span>
                          )}
                          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400" title={dtTime(entry.created_at)}>
                            {relativeTime(entry.created_at)}
                          </span>
                        </div>
                        {entry.recipient_label && (
                          <p className="mt-1.5 flex items-start gap-1 rounded border-l-2 border-navy/40 bg-slate-50 px-2 py-1 text-xs italic text-slate-700 dark:border-purple-500/50 dark:bg-muted-dark dark:text-slate-300">
                            <FileText className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                            {entry.recipient_label}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          )}
        </>
      )}
    </Layout>
  );
}
