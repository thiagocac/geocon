import { useMemo } from 'react';
import { Megaphone, Mail, AlertCircle, Bell, Sparkles, UserCheck } from 'lucide-react';
import {
  interpolateBroadcastText,
  segmentInterpolated,
  type Segment,
} from '../../lib/interpolate';

interface Props {
  title: string;
  body: string;
  kind: string;
  actionUrl?: string;
  // Contexto pra interpolação (vindo do auth + contrato selecionado)
  tenantName?: string;
  senderName?: string;
  contractNumero?: string;
  contractObjeto?: string;
  // Toggle de envio por e-mail (afeta apresentação da prévia)
  emailAlso?: boolean;
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === 'system')  return <AlertCircle className="h-5 w-5 text-error" />;
  if (kind === 'warning') return <AlertCircle className="h-5 w-5 text-amber-500" />;
  return <Bell className="h-5 w-5 text-purple" />;
}

function kindToneCls(kind: string): string {
  if (kind === 'system')  return 'border-error/30 bg-error/5';
  if (kind === 'warning') return 'border-amber-300/40 bg-amber-50 dark:bg-amber-900/10';
  return 'border-purple-200 bg-purple-50/40 dark:border-purple-900/40 dark:bg-purple-900/10';
}

function kindLabel(kind: string): string {
  if (kind === 'system')  return 'URGENTE';
  if (kind === 'warning') return 'ATENÇÃO';
  return 'COMUNICADO';
}

function renderSegments(segments: Segment[]) {
  if (segments.length === 0) return null;
  return segments.map((s, i) => {
    if (s.type === 'plain') {
      // Preserva quebras de linha
      return s.value.split('\n').map((line, idx, arr) => (
        <span key={`${i}-${idx}`}>
          {line}
          {idx < arr.length - 1 && <br />}
        </span>
      ));
    }
    if (s.type === 'per_user') {
      return (
        <span
          key={i}
          className="mx-0.5 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 align-baseline text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
          title={`Será substituído por ${s.token} de cada destinatário no envio por e-mail`}
        >
          <UserCheck className="h-2.5 w-2.5" />
          {s.example}
        </span>
      );
    }
    return (
      <span
        key={i}
        className="mx-0.5 inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 align-baseline text-[11px] font-mono font-medium text-error dark:bg-red-900/40"
        title={`Variável desconhecida: {{${s.token}}}`}
      >
        ⚠ {`{{${s.token}}}`}
      </span>
    );
  });
}

export function BroadcastRenderedPreview({
  title, body, kind, actionUrl,
  tenantName, senderName, contractNumero, contractObjeto, emailAlso,
}: Props) {
  const ctx = { tenant_name: tenantName, sender_name: senderName, contract_numero: contractNumero, contract_objeto: contractObjeto };

  const interp = useMemo(() => {
    const t = interpolateBroadcastText(title, ctx);
    const b = interpolateBroadcastText(body, ctx);
    const u = interpolateBroadcastText(actionUrl || '', ctx);
    return {
      titleSegments: segmentInterpolated(t.text),
      bodySegments: segmentInterpolated(b.text),
      urlText: u.text,
      anyPerUser: t.hasPerUserVars || b.hasPerUserVars || u.hasPerUserVars,
      unknowns: [...new Set([...t.unknownTokens, ...b.unknownTokens, ...u.unknownTokens])],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, actionUrl, kind, tenantName, senderName, contractNumero, contractObjeto]);

  const isEmpty = !title.trim() && !body.trim();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-magenta" />
        <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-600 dark:text-slate-300">
          Como vai aparecer
        </p>
      </div>

      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center dark:border-border-dark">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Preencha título e mensagem para ver a prévia renderizada
          </p>
        </div>
      ) : (
        <div className={`rounded-lg border p-3 ${kindToneCls(kind)}`}>
          <div className="mb-1.5 flex items-center gap-1.5">
            <KindIcon kind={kind} />
            <span className="font-mono text-[9px] font-bold uppercase tracking-display text-slate-600 dark:text-slate-400">
              {kindLabel(kind)}
            </span>
            <span className="ml-auto font-mono text-[9px] text-slate-400">in-app + sino</span>
          </div>
          <p className="text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">
            {renderSegments(interp.titleSegments)}
          </p>
          {body && (
            <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              {renderSegments(interp.bodySegments)}
            </p>
          )}
          {actionUrl && (
            <p className="mt-2 truncate font-mono text-[10px] text-purple-700 dark:text-purple-300" title={interp.urlText}>
              → {interp.urlText}
            </p>
          )}
        </div>
      )}

      {!isEmpty && emailAlso && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-border-dark dark:bg-card-dark">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Mail className="h-4 w-4 text-slate-500" />
            <span className="font-mono text-[9px] font-bold uppercase tracking-display text-slate-600 dark:text-slate-400">
              Também por e-mail
            </span>
          </div>
          <p className="text-sm font-semibold dark:text-slate-100">
            {renderSegments(interp.titleSegments)}
          </p>
          <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
            {renderSegments(interp.bodySegments)}
          </p>
          <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
            Vars amarelas serão resolvidas pra cada destinatário.
          </p>
        </div>
      )}

      {/* Diagnóstico */}
      {!isEmpty && (interp.anyPerUser || interp.unknowns.length > 0) && (
        <div className="space-y-1.5">
          {interp.anyPerUser && !emailAlso && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300/40 bg-amber-50 px-3 py-2 text-[11px] dark:border-amber-900/40 dark:bg-amber-900/15">
              <UserCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-700 dark:text-amber-200" />
              <p className="text-amber-900 dark:text-amber-100">
                Variáveis <strong>per-user</strong> detectadas. Como o envio por e-mail está desligado,
                elas aparecerão literalmente <code className="rounded bg-white/60 px-1 dark:bg-black/30">{`{{user_*}}`}</code> nas notificações in-app.
                Ative o e-mail para que sejam personalizadas por destinatário.
              </p>
            </div>
          )}
          {interp.unknowns.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[11px]">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-error" />
              <div className="text-error">
                <p className="font-semibold">Variáveis desconhecidas (serão enviadas literalmente):</p>
                <p className="mt-0.5 font-mono">{interp.unknowns.map((u) => `{{${u}}}`).join(' · ')}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
