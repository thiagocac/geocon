import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  Plus, Send, CheckCircle2, Calendar, Calculator, FileText, History, Archive,
  WalletCards, LineChart, BookOpen,
} from 'lucide-react';
import { listAdditives, getContract, callFn } from '../../lib/api';
import { brl, num, dt } from '../../lib/format';
import { ADDITIVE_STATUS, statusFor } from '../../lib/status';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Empty, Skeleton, Stat, Progress } from '../../components/ui/Stat';

// MeasurementApprove agora em pages/MeasurementApprovePage.tsx

// =============================================================================
// ADDITIVES — agora em pages/Additives.tsx; AdditiveDetail continua aqui (placeholder simples)
// =============================================================================
export function AdditiveDetail() {
  const { id = '', adId = '' } = useParams();
  return (
    <Layout>
      <PageHeader title={`Aditivo ${adId}`} backTo={`/contratos/${id}/aditivos`} backLabel="Aditivos" />
      <Card className="p-5">
        <h2 className="font-semibold dark:text-slate-100">Resumo</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Tipo, valor, prazo e itens vinculados ao aditivo.</p>
        <p className="mt-4 text-xs text-warning">⚠ Limites legais: 25% para acréscimo/supressão; 50% para reforma de edifício/equipamento.</p>
      </Card>
    </Layout>
  );
}

// Unforeseen e UnforeseenDetail agora em pages/UnforeseenItems.tsx

// =============================================================================
// TRACKING
// =============================================================================
export function Tracking() {
  const { id = '', itemContratualId = '' } = useParams();
  return (
    <Layout>
      <PageHeader title="Rastreamento de item contratual" subtitle={`Item ${itemContratualId}`} backTo={`/contratos/${id}`} backLabel="Contrato" />
      <Card className="p-5">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Histórico do item: quantidade contratada, aditivos que o afetaram, todas as medições onde apareceu, glosas e pagamentos.
        </p>
      </Card>
    </Layout>
  );
}

// =============================================================================
// FINANCIAL — implementação completa em ./Financial.tsx
// =============================================================================
// export { Financial } from '../Financial'; // movido para /pages/Financial.tsx

// =============================================================================
// SCHEDULE — implementação completa em ./Schedule.tsx
// =============================================================================
// export { Schedule } from '../Schedule'; // movido para /pages/Schedule.tsx

// =============================================================================
// REPORTS
// =============================================================================
export function Reports() {
  const { id = '' } = useParams();
  return (
    <Layout>
      <PageHeader title="Relatórios e pacote auditável" backTo={`/contratos/${id}`} backLabel="Contrato"
        actions={<Button onClick={() => callFn('generate-audit-package', { contract_id: id })}><Archive className="h-4 w-4" />Gerar pacote ZIP</Button>} />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {['Boletim de medição', 'Mapa de glosas', 'Mapa de retenções', 'Curva S', 'EAP analítica', 'Histórico de aditivos'].map((r) => (
          <Card key={r} className="p-4">
            <FileText className="h-6 w-6 text-navy dark:text-purple-300" />
            <p className="mt-2 font-semibold dark:text-slate-100">{r}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Gerar em PDF/CSV/ZIP.</p>
          </Card>
        ))}
      </div>
    </Layout>
  );
}
