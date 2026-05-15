import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Users, Trash2, AlertCircle, ShieldCheck } from 'lucide-react';
import {
  listContractMembers, listAvailableMembers, addContractMember, removeContractMember,
} from '../lib/api';
import { humanizeError } from '../lib/errors';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Field, Select } from '../components/ui/FormField';
import { Empty, Skeleton } from '../components/ui/Stat';

const PAPEIS = [
  { value: 'gestor_contrato',  label: 'Gestor do contrato' },
  { value: 'fiscal_contrato',  label: 'Fiscal do contrato' },
  { value: 'fiscal_campo',     label: 'Fiscal de campo' },
  { value: 'gerenciadora',     label: 'Gerenciadora' },
  { value: 'contratada',       label: 'Contratada' },
  { value: 'financeiro',       label: 'Financeiro' },
  { value: 'controle_interno', label: 'Controle interno' },
  { value: 'auditor',          label: 'Auditor' },
];

const PAPEL_LABEL = Object.fromEntries(PAPEIS.map((p) => [p.value, p.label]));

export function ContractParties() {
  const { id = '' } = useParams();
  const qc = useQueryClient();

  const { data: parties = [], isLoading } = useQuery({
    queryKey: ['contract-members', id], queryFn: () => listContractMembers(id), enabled: !!id,
  });
  const { data: avail = [] } = useQuery({
    queryKey: ['available-members'], queryFn: listAvailableMembers,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [papel, setPapel] = useState(PAPEIS[1].value);
  const [canApprove, setCanApprove] = useState(true);
  const [canMeasure, setCanMeasure] = useState(false);
  const [canViewFin, setCanViewFin] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function openCreate() {
    setMemberId(''); setPapel(PAPEIS[1].value);
    setCanApprove(true); setCanMeasure(false); setCanViewFin(false);
    setErr(null); setModalOpen(true);
  }

  const add = useMutation({
    mutationFn: async () => addContractMember({
      contract_id: id, member_id: memberId, papel,
      can_approve: canApprove, can_measure: canMeasure, can_view_financial: canViewFin,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract-members', id] }); setModalOpen(false); },
    onError: (e: Error) => setErr(humanizeError(e)),
  });

  const remove = useMutation({
    mutationFn: removeContractMember,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contract-members', id] }),
  });

  // Sugere defaults por papel
  function applyPapelDefaults(p: string) {
    setPapel(p);
    if (p === 'gestor_contrato') { setCanApprove(true); setCanMeasure(false); setCanViewFin(true); }
    else if (p === 'fiscal_contrato') { setCanApprove(true); setCanMeasure(false); setCanViewFin(true); }
    else if (p === 'fiscal_campo') { setCanApprove(false); setCanMeasure(true); setCanViewFin(false); }
    else if (p === 'financeiro') { setCanApprove(true); setCanMeasure(false); setCanViewFin(true); }
    else if (p === 'contratada') { setCanApprove(false); setCanMeasure(true); setCanViewFin(false); }
    else if (p === 'auditor') { setCanApprove(false); setCanMeasure(false); setCanViewFin(true); }
    else { setCanApprove(false); setCanMeasure(false); setCanViewFin(false); }
  }

  const usedIds = new Set(parties.map((p) => p.member_id));
  const availFiltered = avail.filter((a) => !usedIds.has(a.id));

  return (
    <Layout>
      <PageHeader
        title="Partes contratuais"
        subtitle="Pessoas com papel formal no contrato (gestor, fiscal, contratada, financeiro)"
        backTo={`/contratos/${id}`}
        backLabel="Contrato"
        actions={<Button onClick={openCreate}><UserPlus className="h-4 w-4" />Adicionar parte</Button>}
      />

      {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}
      {!isLoading && parties.length === 0 && (
        <Empty title="Sem partes cadastradas"
          body="Adicione gestores, fiscais, contratada e demais responsáveis."
          icon={<Users className="h-6 w-6 text-slate-500" />}
          action={<Button onClick={openCreate}><UserPlus className="h-4 w-4" />Adicionar parte</Button>} />
      )}

      {parties.length > 0 && (
        <Card className="overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Papel</th>
                <th className="text-center">Aprova</th>
                <th className="text-center">Mede</th>
                <th className="text-center">Financeiro</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                  <td className="font-medium">{p.members?.nome || p.member_id}</td>
                  <td className="text-sm text-slate-500 dark:text-slate-400">{p.members?.email || '—'}</td>
                  <td><Badge tone="purple">{PAPEL_LABEL[p.papel] || p.papel}</Badge></td>
                  <td className="text-center">{p.can_approve ? <ShieldCheck className="mx-auto h-4 w-4 text-success" /> : <span className="text-slate-300">—</span>}</td>
                  <td className="text-center">{p.can_measure ? <ShieldCheck className="mx-auto h-4 w-4 text-success" /> : <span className="text-slate-300">—</span>}</td>
                  <td className="text-center">{p.can_view_financial ? <ShieldCheck className="mx-auto h-4 w-4 text-success" /> : <span className="text-slate-300">—</span>}</td>
                  <td className="text-right">
                    <button onClick={() => { if (confirm(`Remover ${p.members?.nome} do contrato?`)) remove.mutate(p.id); }}
                      className="rounded-lg p-1 text-error hover:bg-red-50 dark:hover:bg-red-900/20" title="Remover">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title="Adicionar parte ao contrato"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={() => add.mutate()} loading={add.isPending} disabled={!memberId}>
              Adicionar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Usuário" required hint={availFiltered.length === 0 ? 'Todos os membros já foram adicionados — cadastre novos em /admin/users' : undefined}>
            <select className="input" value={memberId} onChange={(e) => setMemberId(e.target.value)} autoFocus>
              <option value="">— selecione —</option>
              {availFiltered.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome} · {a.email}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Papel" required hint="Permissões padrão são aplicadas automaticamente — ajuste abaixo se necessário">
            <Select options={PAPEIS} value={papel} onChange={(e) => applyPapelDefaults(e.target.value)} />
          </Field>

          <div>
            <p className="label">Permissões neste contrato</p>
            <div className="mt-2 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-border-dark">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={canApprove} onChange={(e) => setCanApprove(e.target.checked)} className="h-4 w-4" />
                <span>Pode aprovar medições/aditivos</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={canMeasure} onChange={(e) => setCanMeasure(e.target.checked)} className="h-4 w-4" />
                <span>Pode lançar quantitativos em medições</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={canViewFin} onChange={(e) => setCanViewFin(e.target.checked)} className="h-4 w-4" />
                <span>Vê painel financeiro</span>
              </label>
            </div>
          </div>

          {err && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4" /><span>{err}</span>
            </div>
          )}
        </div>
      </Modal>
    </Layout>
  );
}
