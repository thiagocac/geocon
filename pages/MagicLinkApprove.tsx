import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ShieldCheck, AlertCircle, CheckCircle2, XCircle, RotateCcw, Clock, FileText,
  Mail, Hourglass,
} from 'lucide-react';
import { getMagicLinkPreview, consumeMagicLink, type MagicLinkPreview } from '../lib/api';
import { humanizeError } from '../lib/errors';
import { brl, dt, dtTime, relativeTime } from '../lib/format';
import { PRODUCT_LONG_NAME } from '../lib/supabase';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Field, Select } from '../components/ui/FormField';
import { Skeleton } from '../components/ui/Stat';

type Action = 'aprovar' | 'devolver' | 'reprovar';

interface ConsumeResult {
  step_id: string;
  new_status: string;
  measurement_id: string;
}

export function MagicLinkApprove() {
  const { token = '' } = useParams<{ token: string }>();

  const [preview, setPreview] = useState<MagicLinkPreview | null>(null);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState<string | null>(null);

  const [chosenAction, setChosenAction] = useState<Action | null>(null);
  const [comment, setComment]           = useState('');
  const [signatureMethod, setSignatureMethod] = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [decisionErr, setDecisionErr]   = useState<string | null>(null);
  const [result, setResult]             = useState<ConsumeResult | null>(null);

  // Carrega preview do link
  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!token) { setLoading(false); setErr('Token não informado.'); return; }
      try {
        const p = await getMagicLinkPreview(token);
        if (mounted) setPreview(p);
      } catch (e) {
        if (mounted) setErr((e as Error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [token]);

  async function submitDecision() {
    if (!chosenAction) return;
    if ((chosenAction === 'devolver' || chosenAction === 'reprovar') && !comment.trim()) {
      setDecisionErr('Comentário obrigatório ao ' + chosenAction + ' (RN-018)');
      return;
    }
    setSubmitting(true);
    setDecisionErr(null);
    try {
      const r = await consumeMagicLink({
        token,
        action: chosenAction,
        comment: comment || null,
        signature_method: signatureMethod || null,
      });
      setResult({ step_id: r.step_id, new_status: r.new_status, measurement_id: r.measurement_id });
    } catch (e) {
      setDecisionErr(humanizeError(e as Error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy via-purple to-magenta">
      <div className="mx-auto max-w-3xl px-4 py-10">
        {/* Brand */}
        <div className="mb-6 flex items-center gap-3 text-white">
          <img
            src="/logos/logo-white.png"
            srcSet="/logos/logo-white.png 1x, /logos/logo-white@2x.png 2x"
            alt="geoCon"
            className="h-10 w-auto"
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
          <div>
            <h1 className="text-xl font-bold"><span className="text-pink-300">°</span>geoCon</h1>
            <p className="text-xs text-white/70">{PRODUCT_LONG_NAME}</p>
          </div>
        </div>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-4 dark:border-border-dark">
            <h2 className="flex items-center gap-2 text-lg font-semibold dark:text-slate-100">
              <ShieldCheck className="h-5 w-5 text-success" />
              Aprovação por link
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Você foi convidado a decidir uma etapa de aprovação. A decisão é registrada em auditoria.
            </p>
          </div>

          <div className="p-6">
            {loading && <Skeleton className="h-48" />}

            {/* ERRO */}
            {err && (
              <div className="flex items-start gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Não foi possível validar este link.</p>
                  <p className="mt-1">{err}</p>
                  <p className="mt-2 text-xs">
                    Os motivos mais comuns são: link já utilizado, expirado, ou inexistente. Se você acredita
                    que isso é um erro, peça à equipe geoCon para reenviar o link de aprovação.
                  </p>
                </div>
              </div>
            )}

            {/* RESULTADO FINAL */}
            {result && (
              <div className="space-y-4">
                <div className="rounded-lg bg-green-50 p-5 dark:bg-green-900/10">
                  <CheckCircle2 className="mb-2 h-8 w-8 text-success" />
                  <h3 className="text-lg font-bold text-green-900 dark:text-green-200">
                    Decisão registrada
                  </h3>
                  <p className="mt-1 text-sm text-green-800 dark:text-green-300">
                    A etapa foi marcada como <strong>{result.new_status}</strong>. O sistema notificou a próxima
                    etapa do workflow (se houver) e gravou a decisão na trilha de auditoria.
                  </p>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Você já pode fechar esta janela. Este link foi consumido e não pode ser reutilizado.
                </p>
              </div>
            )}

            {/* CONTEÚDO PRINCIPAL */}
            {preview && !result && (
              <div className="space-y-4">
                {/* Cabeçalho da medição */}
                <div className="rounded-lg bg-slate-50 p-4 dark:bg-muted-dark">
                  <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Contrato
                  </p>
                  <p className="mt-0.5 font-bold text-slate-900 dark:text-slate-100">
                    {preview.contract.numero}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {preview.contract.objeto}
                  </p>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Medição
                      </p>
                      <p className="font-semibold dark:text-slate-100">
                        N.º {preview.measurement.numero}
                        {preview.measurement.periodo_inicio && preview.measurement.periodo_fim && (
                          <span className="ml-2 text-sm font-normal text-slate-500">
                            {dt(preview.measurement.periodo_inicio)} – {dt(preview.measurement.periodo_fim)}
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Valor líquido
                      </p>
                      <p className="font-mono font-semibold tabular-nums dark:text-slate-100">
                        {brl(preview.measurement.valor_liquido)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Etapa */}
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Etapa a decidir
                      </p>
                      <p className="mt-0.5 text-lg font-bold dark:text-slate-100">
                        <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-navy text-xs text-white">
                          {preview.step.ordem}
                        </span>
                        {preview.step.nome}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Papel exigido: <Badge tone="purple">{preview.step.role_required}</Badge>
                      </p>
                    </div>
                    <Badge tone="yellow">
                      <Hourglass className="mr-1 inline h-3 w-3" />
                      Pendente
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      Destinatário: <code>{preview.recipient_email}</code>
                    </span>
                    {preview.step.due_at && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Prazo: {dtTime(preview.step.due_at)} ({relativeTime(preview.step.due_at)})
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Hourglass className="h-3 w-3" />
                      Link expira em {relativeTime(preview.expires_at)}
                    </span>
                  </div>
                </Card>

                {/* Aviso de identidade */}
                {!preview.recipient_member_id && (
                  <div className="flex items-start gap-2 rounded-lg bg-yellow-50 p-3 text-xs text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
                    <AlertCircle className="mt-0.5 h-4 w-4" />
                    <p>
                      O e-mail <code>{preview.recipient_email}</code> não está vinculado a um membro ativo da
                      organização. A decisão será registrada com o e-mail informado mas sem associação a um
                      usuário do sistema.
                    </p>
                  </div>
                )}

                {/* Ações */}
                <div>
                  <p className="mb-2 text-sm font-semibold dark:text-slate-100">Sua decisão:</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <ActionTile
                      action="aprovar" current={chosenAction} onClick={() => setChosenAction('aprovar')}
                      icon={<CheckCircle2 className="h-5 w-5" />}
                      label="Aprovar"
                      tone="green"
                      hint="Etapa concluída, avança o workflow"
                    />
                    <ActionTile
                      action="devolver" current={chosenAction} onClick={() => setChosenAction('devolver')}
                      icon={<RotateCcw className="h-5 w-5" />}
                      label="Devolver"
                      tone="yellow"
                      hint="Volta a medição para rascunho"
                    />
                    <ActionTile
                      action="reprovar" current={chosenAction} onClick={() => setChosenAction('reprovar')}
                      icon={<XCircle className="h-5 w-5" />}
                      label="Reprovar"
                      tone="red"
                      hint="Rejeita a medição definitivamente"
                    />
                  </div>
                </div>

                {/* Form da decisão */}
                {chosenAction && (
                  <div className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-border-dark">
                    <Field
                      label="Comentário"
                      required={chosenAction !== 'aprovar'}
                      hint={chosenAction === 'aprovar' ? 'Opcional' : 'Obrigatório ao devolver ou reprovar (RN-018)'}
                    >
                      <textarea
                        className="input"
                        rows={3}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder={chosenAction === 'aprovar' ? 'Observações…' : 'Descreva os motivos…'}
                      />
                    </Field>

                    {chosenAction === 'aprovar' && (
                      <Field label="Método de assinatura" hint="Selecione se houver assinatura digital">
                        <Select
                          options={[
                            { value: '', label: '— sem assinatura digital específica —' },
                            { value: 'magic_link', label: 'Magic Link (padrão)' },
                            { value: 'gov_br',   label: 'gov.br' },
                            { value: 'zapsign',  label: 'ZapSign' },
                            { value: 'simples',  label: 'Assinatura simples' },
                          ]}
                          value={signatureMethod} onChange={(e) => setSignatureMethod(e.target.value)}
                        />
                      </Field>
                    )}

                    {decisionErr && (
                      <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                        <AlertCircle className="mt-0.5 h-4 w-4" />
                        <span>{decisionErr}</span>
                      </div>
                    )}

                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => { setChosenAction(null); setComment(''); setSignatureMethod(''); setDecisionErr(null); }}>
                        Cancelar
                      </Button>
                      <Button
                        variant={chosenAction === 'reprovar' ? 'danger' : chosenAction === 'devolver' ? 'outline' : 'primary'}
                        loading={submitting}
                        onClick={submitDecision}
                      >
                        Confirmar {chosenAction}
                      </Button>
                    </div>
                  </div>
                )}

                <p className="pt-2 text-xs text-slate-500 dark:text-slate-400">
                  <FileText className="mr-1 inline h-3 w-3" />
                  Esta decisão é definitiva e ficará registrada em auditoria com o e-mail acima. O link expira
                  automaticamente após o uso.
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// =============================================================================
// Tile de ação
// =============================================================================
function ActionTile({
  action, current, onClick, icon, label, tone, hint,
}: {
  action: Action;
  current: Action | null;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone: 'green' | 'yellow' | 'red';
  hint: string;
}) {
  const active = current === action;
  const baseTone = {
    green:  active ? 'border-success bg-green-50 dark:bg-green-900/20'   : 'border-slate-200 hover:border-success dark:border-border-dark',
    yellow: active ? 'border-warning bg-yellow-50 dark:bg-yellow-900/20' : 'border-slate-200 hover:border-warning dark:border-border-dark',
    red:    active ? 'border-error bg-red-50 dark:bg-red-900/20'         : 'border-slate-200 hover:border-error dark:border-border-dark',
  }[tone];
  const iconColor = {
    green: active ? 'text-success' : 'text-slate-400',
    yellow: active ? 'text-warning' : 'text-slate-400',
    red:    active ? 'text-error'   : 'text-slate-400',
  }[tone];
  return (
    <button
      onClick={onClick}
      className={`flex w-full flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition ${baseTone}`}
    >
      <div className={iconColor}>{icon}</div>
      <p className="font-semibold dark:text-slate-100">{label}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    </button>
  );
}
