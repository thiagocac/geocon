import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, MapPin, Edit2, Trash2, AlertCircle } from 'lucide-react';
import {
  listLots, createLot, updateLot, deleteLot, type Lot,
} from '../lib/api';
import { brl } from '../lib/format';
import { humanizeError } from '../lib/errors';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Field } from '../components/ui/FormField';
import { Empty, Skeleton } from '../components/ui/Stat';

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

type LotInput = Omit<Lot, 'id' | 'contract_id'>;

const EMPTY: LotInput = {
  nome: '', codigo: null, municipio: null, uf: null,
  endereco: null, latitude: null, longitude: null,
  valor_obra: 0, prazo_dias: null, crea_responsavel: null, status: 'ativo',
};

export function ContractLots() {
  const { id = '' } = useParams();
  const qc = useQueryClient();

  const { data: lots = [], isLoading } = useQuery({
    queryKey: ['lots', id], queryFn: () => listLots(id), enabled: !!id,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LotInput>(EMPTY);
  const [err, setErr] = useState<string | null>(null);

  function openCreate() {
    setEditingId(null); setForm(EMPTY); setErr(null); setModalOpen(true);
  }
  function openEdit(lot: Lot) {
    setEditingId(lot.id);
    setForm({
      nome: lot.nome, codigo: lot.codigo, municipio: lot.municipio, uf: lot.uf,
      endereco: lot.endereco, latitude: lot.latitude, longitude: lot.longitude,
      valor_obra: lot.valor_obra, prazo_dias: lot.prazo_dias, crea_responsavel: lot.crea_responsavel,
      status: lot.status,
    });
    setErr(null); setModalOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (editingId) {
        await updateLot(editingId, form);
        return editingId;
      }
      return await createLot({ ...form, contract_id: id });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lots', id] }); setModalOpen(false); },
    onError: (e: Error) => setErr(humanizeError(e)),
  });

  const remove = useMutation({
    mutationFn: deleteLot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lots', id] }),
  });

  return (
    <Layout>
      <PageHeader
        title="Obras / lotes"
        subtitle="Empreendimentos físicos vinculados ao contrato"
        backTo={`/contratos/${id}`}
        backLabel="Contrato"
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4" />Adicionar obra</Button>}
      />

      {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}
      {!isLoading && lots.length === 0 && (
        <Empty title="Sem obras cadastradas"
          body="Cadastre a primeira obra/lote para vincular EAP, equipes e medições."
          action={<Button onClick={openCreate}><Plus className="h-4 w-4" />Adicionar obra</Button>} />
      )}

      {lots.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {lots.map((l) => (
            <Card key={l.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">{l.nome}</h3>
                  {l.codigo && <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{l.codigo}</p>}
                  {l.municipio && (
                    <p className="mt-1 flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
                      <MapPin className="h-3 w-3" /> {l.municipio}/{l.uf}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Valor da obra: <span className="font-medium tabular text-slate-900 dark:text-slate-100">{brl(l.valor_obra)}</span>
                    {l.prazo_dias && <> · {l.prazo_dias} dias</>}
                    {l.crea_responsavel && <> · CREA {l.crea_responsavel}</>}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge tone={l.status === 'ativo' ? 'green' : 'slate'}>{l.status}</Badge>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(l)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-muted-dark" title="Editar">
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button onClick={() => { if (confirm('Remover esta obra?')) remove.mutate(l.id); }} className="rounded-lg p-1 text-error hover:bg-red-50 dark:hover:bg-red-900/20" title="Remover">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title={editingId ? 'Editar obra' : 'Nova obra/lote'}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.nome.trim()}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Nome" required className="md:col-span-2">
              <input className="input" value={form.nome} autoFocus onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </Field>
            <Field label="Código">
              <input className="input" value={form.codigo || ''} onChange={(e) => setForm({ ...form, codigo: e.target.value || null })} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Município" className="md:col-span-2">
              <input className="input" value={form.municipio || ''} onChange={(e) => setForm({ ...form, municipio: e.target.value || null })} />
            </Field>
            <Field label="UF">
              <select className="input" value={form.uf || ''} onChange={(e) => setForm({ ...form, uf: e.target.value || null })}>
                <option value="">—</option>
                {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Endereço">
            <input className="input" value={form.endereco || ''} onChange={(e) => setForm({ ...form, endereco: e.target.value || null })} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Latitude" hint="Decimal (ex: -22.0087)">
              <input type="number" step="0.0000001" className="input tabular"
                value={form.latitude ?? ''} onChange={(e) => setForm({ ...form, latitude: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Longitude">
              <input type="number" step="0.0000001" className="input tabular"
                value={form.longitude ?? ''} onChange={(e) => setForm({ ...form, longitude: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Valor da obra (R$)">
              <input type="number" min="0" step="0.01" className="input tabular"
                value={form.valor_obra || ''} onChange={(e) => setForm({ ...form, valor_obra: Number(e.target.value) })} />
            </Field>
            <Field label="Prazo (dias)">
              <input type="number" min="0" className="input tabular"
                value={form.prazo_dias ?? ''} onChange={(e) => setForm({ ...form, prazo_dias: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            <Field label="CREA responsável">
              <input className="input" value={form.crea_responsavel || ''} onChange={(e) => setForm({ ...form, crea_responsavel: e.target.value || null })} />
            </Field>
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
