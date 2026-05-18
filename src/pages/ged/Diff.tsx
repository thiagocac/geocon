import { useState, useMemo, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  GitCompare, Plus, Minus, Equal, ArrowLeftRight, FileText, AlertCircle,
} from 'lucide-react';
import {
  getGedDocument, listGedDocumentVersions, getGedVersionExtractedText,
} from '../../lib/api';
import { diffLines, diffToSideBySide, type DiffOpKind } from '../../lib/diff';
import { dt } from '../../lib/format';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Empty, Skeleton } from '../../components/ui/Stat';
import { Select } from '../../components/ui/FormField';

/**
 * V58 — Diff lado-a-lado entre 2 revisões de um documento GED.
 *
 * Rota: /ged/documentos/:docId/diff
 *
 * Aceita query params ?a=versionId&b=versionId; se não vier, defaults:
 *   - A = penúltima versão (uploaded_at)
 *   - B = última (vigente)
 *
 * Usa LCS-based line diff (src/lib/diff.ts). Sem libs externas.
 */
export function GedDocumentDiff() {
  const { docId = '' } = useParams();

  const { data: doc } = useQuery({
    queryKey: ['ged-doc', docId],
    queryFn: () => getGedDocument(docId),
    enabled: !!docId,
  });
  const { data: versions = [], isLoading: vl } = useQuery({
    queryKey: ['ged-versions', docId],
    queryFn: () => listGedDocumentVersions(docId),
    enabled: !!docId,
  });

  // Versões ordenadas DESC por uploaded_at (mais recente primeiro).
  // Default: B = mais recente (versions[0]), A = anterior (versions[1])
  const [versionAId, setVersionAId] = useState<string>('');
  const [versionBId, setVersionBId] = useState<string>('');

  useEffect(() => {
    if (versions.length >= 2 && !versionAId && !versionBId) {
      setVersionBId(versions[0].id);
      setVersionAId(versions[1].id);
    }
  }, [versions, versionAId, versionBId]);

  const { data: versionA } = useQuery({
    queryKey: ['ged-version-text', versionAId],
    queryFn: () => getGedVersionExtractedText(versionAId),
    enabled: !!versionAId,
  });
  const { data: versionB } = useQuery({
    queryKey: ['ged-version-text', versionBId],
    queryFn: () => getGedVersionExtractedText(versionBId),
    enabled: !!versionBId,
  });

  // Computa diff client-side. useMemo evita rerun em rerenders sem mudança.
  const { ops, stats, rows } = useMemo(() => {
    if (!versionA?.extracted_text || !versionB?.extracted_text) {
      return { ops: [], stats: { added: 0, removed: 0, unchanged: 0, total: 0 }, rows: [] };
    }
    const d = diffLines(versionA.extracted_text, versionB.extracted_text);
    return { ...d, rows: diffToSideBySide(d.ops) };
  }, [versionA?.extracted_text, versionB?.extracted_text]);

  const versionOptions = versions.map((v) => ({
    value: v.id,
    label: `Rev. ${v.revision} · ${dt(v.uploaded_at)}${v.status === 'vigente' ? ' · vigente' : ''}`,
  }));

  return (
    <Layout>
      <PageHeader
        kicker="GED · Comparar revisões"
        title={doc?.title || 'Diff entre revisões'}
        subtitle="Comparação textual lado-a-lado · linhas adicionadas, removidas e mantidas"
        backTo={`/ged/documentos/${docId}`}
        backLabel="Documento"
      />

      {/* Seletores de revisão */}
      <Card className="mb-4 p-4">
        <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
              Revisão A (antes)
            </label>
            <Select
              value={versionAId}
              onChange={(e) => setVersionAId(e.target.value)}
              placeholder="Selecionar revisão A"
              options={versionOptions}
            />
          </div>
          <div className="flex items-end justify-center pb-1.5">
            <ArrowLeftRight className="h-5 w-5 text-slate-400" aria-hidden />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
              Revisão B (depois)
            </label>
            <Select
              value={versionBId}
              onChange={(e) => setVersionBId(e.target.value)}
              placeholder="Selecionar revisão B"
              options={versionOptions}
            />
          </div>
        </div>
      </Card>

      {vl && <Card className="p-6"><Skeleton className="h-64" /></Card>}

      {!vl && versions.length < 2 && (
        <Empty
          title="Documento tem apenas uma revisão"
          body="Para comparar, é necessário ter pelo menos 2 revisões cadastradas. Faça upload de uma nova revisão para habilitar a comparação."
          action={<Link to={`/ged/documentos/${docId}/nova-revisao`} className="font-semibold text-navy hover:underline">Nova revisão →</Link>}
        />
      )}

      {!vl && versions.length >= 2 && versionA && versionB && (
        <>
          {/* Stats */}
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <StatCard label="Total de linhas"  value={stats.total}     icon={FileText} tone="slate" />
            <StatCard label="Adicionadas"      value={stats.added}     icon={Plus}     tone="green" />
            <StatCard label="Removidas"        value={stats.removed}   icon={Minus}    tone="red" />
            <StatCard label="Mantidas"         value={stats.unchanged} icon={Equal}    tone="slate" />
          </div>

          {!versionA.extracted_text || !versionB.extracted_text ? (
            <Card className="p-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 shrink-0 text-warning" aria-hidden />
                <div>
                  <h3 className="font-semibold dark:text-slate-100">Texto extraído ausente</h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Uma das revisões não tem texto extraído. Para comparar, é
                    necessário que ambas tenham passado pela extração via PDF.
                    Reprocesse a versão sem texto pelo botão "Extrair texto" no
                    detalhe do documento.
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-border-dark">
                <div className="flex items-center gap-2">
                  <GitCompare className="h-4 w-4 text-navy dark:text-purple-300" aria-hidden />
                  <h2 className="font-semibold dark:text-slate-100">Diff lado-a-lado</h2>
                </div>
                <div className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
                  {stats.total} linhas comparadas
                </div>
              </header>

              {/* Cabeçalho das colunas */}
              <div className="grid grid-cols-2 border-b border-slate-100 bg-slate-50 font-mono text-[10px] uppercase tracking-display dark:border-border-dark dark:bg-muted-dark/40">
                <div className="px-3 py-2 text-slate-600 dark:text-slate-300">
                  Rev. {versionA.revision} · {dt(versionA.uploaded_at)}
                </div>
                <div className="border-l border-slate-100 px-3 py-2 text-slate-600 dark:border-border-dark dark:text-slate-300">
                  Rev. {versionB.revision} · {dt(versionB.uploaded_at)}
                </div>
              </div>

              {/* Linhas do diff */}
              <div className="max-h-[70vh] overflow-y-auto scrollbar-thin">
                <table className="w-full font-mono text-xs">
                  <tbody>
                    {rows.map((row, idx) => (
                      <DiffRow key={idx} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </Layout>
  );
}

// =============================================================================
// Sub-componentes
// =============================================================================

function StatCard({
  label, value, icon: Icon, tone,
}: {
  label: string; value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'green' | 'red' | 'slate';
}) {
  const cfg = {
    green: 'text-success',
    red:   'text-error',
    slate: 'text-slate-600 dark:text-slate-400',
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

function DiffRow({
  row,
}: {
  row: {
    kind: DiffOpKind;
    lineA: { num: number; content: string } | null;
    lineB: { num: number; content: string } | null;
  };
}) {
  const cellA = row.lineA
    ? <DiffCell num={row.lineA.num} content={row.lineA.content} kind={row.kind === 'equal' ? 'equal' : 'delete'} />
    : <td className="bg-slate-50/50 dark:bg-muted-dark/30" />;
  const cellB = row.lineB
    ? <DiffCell num={row.lineB.num} content={row.lineB.content} kind={row.kind === 'equal' ? 'equal' : 'insert'} />
    : <td className="border-l border-slate-100 bg-slate-50/50 dark:border-border-dark dark:bg-muted-dark/30" />;

  return (
    <tr>
      {cellA}
      {cellB}
    </tr>
  );
}

function DiffCell({
  num, content, kind,
}: {
  num: number;
  content: string;
  kind: 'equal' | 'insert' | 'delete';
}) {
  const styles = {
    equal:  '',
    insert: 'bg-success/10 dark:bg-success/15',
    delete: 'bg-error/10 dark:bg-error/15',
  }[kind];
  const markerStyles = {
    equal:  'text-slate-400',
    insert: 'text-success font-bold',
    delete: 'text-error font-bold',
  }[kind];
  const marker = kind === 'insert' ? '+' : kind === 'delete' ? '−' : ' ';

  return (
    <td className={`align-top ${kind === 'insert' ? '' : 'border-l border-slate-100 dark:border-border-dark'} ${styles}`}>
      <div className="flex">
        <span className="select-none px-2 py-1 text-right text-slate-400" style={{ minWidth: '3.5rem' }}>
          {num}
        </span>
        <span className={`select-none px-1 py-1 ${markerStyles}`}>{marker}</span>
        <span className="flex-1 whitespace-pre-wrap break-words py-1 pr-3 text-slate-800 dark:text-slate-200">
          {content || <span className="text-slate-300">∅</span>}
        </span>
      </div>
    </td>
  );
}
