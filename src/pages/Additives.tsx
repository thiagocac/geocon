import { useState, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, AlertCircle, Sparkles, CheckCircle2, ShieldCheck, AlertTriangle,
} from 'lucide-react';
import {
  listAdditives, listUnforeseenItems, checkAdditiveLegalLimit,
  incorporateUnforeseenToAdditive, getContract,
} from '../lib/api';
import { humanizeError } from '../lib/errors';
import { brl, num, dt } from '../lib/format';
import { ADDITIVE_STATUS, statusFor } from '../lib/status';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Field, Select } from '../components/ui/FormField';
import { Empty, Skeleton } from '../components/ui/Stat';

export function Additives() {
  const { id = '' } = useParams();
  const qc = useQueryClient();

  const { data: contract } = useQuery({
    queryKey: ['contract', id], queryFn: () => getContract(id), enabled: !!id,
  });
  const { data: additives = [], isLoading } = useQuery({
    queryKey: ['additives', id], queryFn: () => listAdditives(id), enabled: !!id,
  });
  const { data: unforeseen = [] } = useQuery({
    queryKey: ['unforeseen', id], queryFn: () => listUnforeseenItems(id), enabled: !!id,
  });

  // Itens aprovados que ainda não foram aditados
  const approvedReady = useMemo(
    () => unforeseen.filter((u) => u.status === 'aprovado'),
    [unforeseen],
  );

  // Cálculo do percentual aditado
  const pctAditado = contract && contract.valor_inicial > 0
    ? (contract.valor_aditado / contract.valor_inicial) * 100
    : 0;

  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tipo, setTipo] = useState<'valor' | 'prazo' | 'valor_prazo' | 'supressao' | 'reequilibrio'>('valor');
  const [justificativa, setJustificativa] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // Valor total selecionado
  const valorSelecionado = approvedReady
    .filter((u) => selected.has(u.id))
    .reduce((s, u) => s + u.valor_estimado, 0);

  // Verificação de limite legal sob demanda
  const { data: legalCheck } = useQuery({
    queryKey: ['legal-check', id, valorSelecionado],
    queryFn: () => checkAdditiveLegalLimit(id, valorSelecionado),
    enabled: !!id && valorSelecionado > 0,
  });

  const incorporate = useMutation({
    mutationFn: () => incorporateUnforeseenToAdditive({
      contract_id: id,
      unforeseen_item_ids: Array.from(selected),
      tipo, justificativa,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['additives', id] });
      qc.invalidateQueries({ queryKey: ['unforeseen', id] });
      qc.invalidateQueries({ queryKey: ['contract', id] });
      setModalOpen(false);
      setSelected(new Set());
      setJustificativa('');
    },
    onError: (e: Error) => setErr(humanizeError(e)),
  });

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  return (
    <Layout>
      <PageHeader
        title="Aditivos"
        subtitle="Acréscimo, supressão, prazo e itens não previstos aprovados — Lei 14.133/2021"
        backTo={`/contratos/${id}`}
        backLabel="Contrato"
        actions={
          approvedReady.length > 0 ? (
            <Button onClick={() => setModalOpen(true)}>
              <Sparkles className="h-4 w-4" />Incorporar itens aprovados
            </Button>
          ) : (
            <Link to={`/contratos/${id}/itens-nao-previstos`}>
              <Button variant="outline"><Plus className="h-4 w-4" />Itens não previstos</Button>
            </Link>
          )
        }
      />

      {/* Painel de limites legais */}
      {contract && (
        <LegalLimitCard
          valorInicial={contract.valor_inicial}
          valorAditado={contract.valor_aditado}
          percentual={pctAditado}
        />
      )}

      {/* Banner CTA quando há itens aprovados */}
      {approvedReady.length > 0 && (
        <Card className="mb-4 border-2 border-purple bg-purple-50 p-4 dark:bg-purple-900/10">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 flex-shrink-0 text-purple" />
            <div className="flex-1">
              <p className="font-semibold text-purple-900 dark:text-purple-200">
                {approvedReady.length} item{approvedReady.length > 1 ? 's' : ''} aprovado{approvedReady.length > 1 ? 's' : ''} aguardando aditivo
              </p>
              <p className="text-sm text-purple-800 dark:text-purple-300">
                Esses itens não previstos passaram por todas as 5 etapas de aprovação e estão prontos para serem incorporados num aditivo formal.
              </p>
            </div>
            <Button onClick={() => setModalOpen(true)}>Incorporar agora</Button>
          </div>
        </Card>
      )}

      {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}
      {!isLoading && additives.length === 0 && (
        <Empty title="Nenhum aditivo registrado" body="Os aditivos surgem da incorporação de itens não previstos aprovados." />
      )}

      {additives.length > 0 && (
        <Card className="overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Tipo</th>
                <th>Data</th>
                <th className="text-right">Acréscimo</th>
                <th className="text-right">Decréscimo</th>
                <th className="text-right">Líquido</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {additives.map((a) => {
                const s = statusFor(a.status, ADDITIVE_STATUS);
                const liquido = a.valor_acrescimo - a.valor_decrescimo;
                return (
                  <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                    <td className="font-mono font-bold">{a.numero}</td>
                    <td className="text-xs uppercase">{a.tipo}</td>
                    <td className="text-sm">{dt(a.data_solicitacao)}</td>
                    <td className="text-right tabular text-success">{brl(a.valor_acrescimo)}</td>
                    <td className="text-right tabular text-error">{brl(a.valor_decrescimo)}</td>
                    <td className="text-right tabular font-medium">{brl(liquido)}</td>
                    <td><Badge tone={s.tone}>{s.label}</Badge></td>
                    <td>
                      <Link to={a.id} className="text-xs font-semibold text-navy hover:underline dark:text-slate-200">Abrir</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Modal incorporação */}
      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title="Incorporar itens aprovados num aditivo"
        subtitle="Objeto 5 da spec · cria o aditivo formal a partir dos itens selecionados"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => incorporate.mutate()}
              loading={incorporate.isPending}
              disabled={selected.size === 0 || !justificativa.trim() || (legalCheck?.bloqueio || false)}
            >
              Criar aditivo com {selected.size} item{selected.size !== 1 ? 's' : ''}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Card className="bg-slate-50 p-4 dark:bg-muted-dark">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Itens aprovados ({approvedReady.length})
            </h3>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {approvedReady.map((u) => (
                <label key={u.id} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:border-navy dark:border-border-dark dark:bg-card-dark">
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} className="mt-1 h-4 w-4" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs text-slate-500">#{u.numero}</p>
                    <p className="font-medium dark:text-slate-100">{u.descricao}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{u.justificativa.slice(0, 100)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular dark:text-slate-100">{brl(u.valor_estimado)}</p>
                    {u.prazo_impacto_dias > 0 && <p className="text-xs text-slate-500">+{u.prazo_impacto_dias} dias</p>}
                  </div>
                </label>
              ))}
            </div>
          </Card>

          {/* Verificação de limite legal */}
          {valorSelecionado > 0 && legalCheck && (
            <Card className={`p-3 border-2 ${
              legalCheck.zona === 'verde' ? 'border-success bg-green-50 dark:bg-green-900/10' :
              legalCheck.zona === 'amarelo' ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/10' :
              legalCheck.zona === 'laranja' ? 'border-orange-400 bg-orange-50 dark:bg-orange-900/10' :
              'border-error bg-red-50 dark:bg-red-900/10'
            }`}>
              <div className="flex items-start gap-3">
                {legalCheck.bloqueio
                  ? <AlertCircle className="h-5 w-5 flex-shrink-0 text-error" />
                  : <ShieldCheck className="h-5 w-5 flex-shrink-0 text-success" />}
                <div className="flex-1">
                  <p className="font-semibold dark:text-slate-100">{legalCheck.mensagem}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Aditado proposto: <strong className="tabular">{brl(legalCheck.valor_aditado_proposto)}</strong>
                    {' '}({num(legalCheck.percentual_proposto)}% sobre R$ {brl(legalCheck.valor_inicial)}) ·
                    Limite: {legalCheck.limite_percent}%
                  </p>
                </div>
              </div>
            </Card>
          )}

          <Field label="Tipo de aditivo" required>
            <Select
              value={tipo} onChange={(e) => setTipo(e.target.value as any)}
              options={[
                { value: 'valor',        label: 'Valor (acréscimo financeiro)' },
                { value: 'prazo',        label: 'Prazo (sem alteração de valor)' },
                { value: 'valor_prazo',  label: 'Valor + Prazo' },
                { value: 'supressao',    label: 'Supressão (decréscimo)' },
                { value: 'reequilibrio', label: 'Reequilíbrio econômico' },
              ]}
            />
          </Field>

          <Field label="Justificativa do aditivo" required hint="Texto que vai no termo aditivo formal">
            <textarea className="input" rows={3}
              value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
          </Field>

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

// =============================================================================
// Card que mostra zona de risco do limite legal (RN-036, RN-037)
// =============================================================================
function LegalLimitCard({ valorInicial, valorAditado, percentual }: { valorInicial: number; valorAditado: number; percentual: number }) {
  // Calcula posição da régua e cor
  const limite = 25;
  const filled = Math.min(percentual, limite + 5); // mostra um pouco além do limite

  const zona = percentual < 20 ? 'verde' :
               percentual < 24 ? 'amarelo' :
               percentual <= 25 ? 'laranja' : 'vermelho';

  const labels = {
    verde:   { color: 'text-success',  msg: 'Dentro do limite legal de 25%' },
    amarelo: { color: 'text-warning',  msg: 'Atenção: acima de 20% do contrato' },
    laranja: { color: 'text-orange-500', msg: 'Próximo do limite legal — exige aprovação superior' },
    vermelho:{ color: 'text-error',    msg: 'BLOQUEIO: ultrapassa o limite legal (Lei 14.133, art. 125)' },
  };

  return (
    <Card className="mb-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold dark:text-slate-100">
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            Limite legal de aditamento
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Lei 14.133/2021 art. 125 · acréscimos/supressões unilaterais
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Aditado atual</p>
          <p className="text-2xl font-bold tabular dark:text-slate-100">{num(percentual)}%</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 tabular">{brl(valorAditado)}</p>
        </div>
      </div>

      {/* Régua de risco */}
      <div className="mt-4">
        <div className="relative h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-muted-dark">
          {/* Zonas */}
          <div className="absolute left-0 top-0 h-full" style={{ width: '80%', background: 'rgba(16,185,129,0.2)' }} />
          <div className="absolute top-0 h-full" style={{ left: '80%', width: '16%', background: 'rgba(245,158,11,0.25)' }} />
          <div className="absolute top-0 h-full" style={{ left: '96%', width: '4%', background: 'rgba(239,68,68,0.3)' }} />
          {/* Marcador 25% */}
          <div className="absolute top-0 h-full w-0.5 bg-error" style={{ left: '100%', transform: 'translateX(-50%)' }} title="Limite 25%" />
          {/* Preenchimento atual */}
          <div className={`absolute left-0 top-0 h-full ${
            zona === 'verde' ? 'bg-success' :
            zona === 'amarelo' ? 'bg-warning' :
            zona === 'laranja' ? 'bg-orange-500' :
            'bg-error'
          }`} style={{ width: `${(filled / limite) * 100}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
          <span>0%</span>
          <span className="ml-[78%]">20%</span>
          <span>25% (limite)</span>
        </div>
      </div>

      <p className={`mt-3 text-sm font-medium ${labels[zona].color}`}>
        {labels[zona].msg}
      </p>
    </Card>
  );
}
