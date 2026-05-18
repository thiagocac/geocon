import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Stamp, Download, AlertCircle, CheckCircle2, ShieldCheck, X,
} from 'lucide-react';
import { generateWatermarkedPdf, type WatermarkSettings } from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field } from '../ui/FormField';

/**
 * V68 — Modal para baixar versão de documento GED com marca d'água
 * "CÓPIA NÃO CONTROLADA".
 *
 * Permite ao usuário (a) informar o destinatário (cliente, fiscal externo,
 * etc), (b) opcionalmente sobrepor settings (texto adicional, ICP-Brasil
 * toggle se habilitado pelo tenant), e (c) baixar o PDF marcado.
 *
 * Cada download gera um fingerprint único impresso no rodapé do PDF +
 * registro em ged_watermark_log — permite rastrear vazamentos.
 */
export function WatermarkDownloadModal({
  open, onClose, versionId, versionRevision, docTitle, defaultSettings,
}: {
  open: boolean;
  onClose: () => void;
  versionId: string | null;
  versionRevision?: string;
  docTitle?: string;
  defaultSettings?: WatermarkSettings;
}) {
  const qc = useQueryClient();
  const [recipientLabel, setRecipientLabel] = useState('');
  const [includeIcp, setIncludeIcp]         = useState(defaultSettings?.icp_brasil_enabled ?? false);
  const [textoSecundario, setTextoSecundario] = useState(defaultSettings?.texto_secundario || '');
  const [generated, setGenerated]           = useState<{ fingerprint: string; url: string } | null>(null);
  const [err, setErr]                       = useState<string | null>(null);

  const generateMut = useMutation({
    mutationFn: (vid: string) => generateWatermarkedPdf({
      version_id: vid,
      recipient_label: recipientLabel.trim() || undefined,
      override_settings: {
        ...(textoSecundario.trim() ? { texto_secundario: textoSecundario.trim() } : {}),
        ...(includeIcp !== (defaultSettings?.icp_brasil_enabled ?? false) ? { icp_brasil_enabled: includeIcp } : {}),
      },
    }),
    onSuccess: ({ blob, fingerprint }) => {
      const url = URL.createObjectURL(blob);
      setGenerated({ fingerprint, url });
      setErr(null);
      // dispara download automaticamente
      const a = document.createElement('a');
      a.href = url;
      a.download = `watermarked-${docTitle?.replace(/[^\w]+/g, '_').slice(0, 40) || 'documento'}-${fingerprint}.pdf`;
      a.click();
      qc.invalidateQueries({ queryKey: ['ged-watermark-log'] });
    },
    onError: (e: Error) => setErr(humanizeError(e)),
  });

  function handleClose() {
    if (generated?.url) URL.revokeObjectURL(generated.url);
    setGenerated(null);
    setErr(null);
    setRecipientLabel('');
    setTextoSecundario(defaultSettings?.texto_secundario || '');
    setIncludeIcp(defaultSettings?.icp_brasil_enabled ?? false);
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Baixar com marca d'água">
      {!generated && (
        <>
          <p className="mb-3 flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
            <Stamp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-navy dark:text-purple-300" aria-hidden />
            <span>
              O PDF será marcado com "CÓPIA NÃO CONTROLADA" em diagonal e um
              fingerprint único no rodapé. Cada download é registrado para
              rastreabilidade.
            </span>
          </p>

          {docTitle && (
            <p className="mb-3 text-sm">
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                Revisão {versionRevision ?? '?'}
              </span>
              <span className="ml-2 text-slate-700 dark:text-slate-300">{docTitle}</span>
            </p>
          )}

          <div className="space-y-3">
            <Field
              label="Destinatário (opcional)"
              hint="Aparece no rodapé do PDF para rastreabilidade — ex: 'Para: Eng. João Silva (cliente XYZ)'"
            >
              <input
                type="text"
                value={recipientLabel}
                onChange={(e) => setRecipientLabel(e.target.value)}
                placeholder="Para: …"
                className="input"
                maxLength={200}
              />
            </Field>

            <Field
              label="Texto secundário (opcional)"
              hint="Aparece abaixo do principal — ex: nome da empresa ou número do contrato"
            >
              <input
                type="text"
                value={textoSecundario}
                onChange={(e) => setTextoSecundario(e.target.value)}
                placeholder="Ex: CT-2024/0042 · Hospital Municipal"
                className="input"
                maxLength={120}
              />
            </Field>

            {defaultSettings?.icp_brasil_enabled !== undefined && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeIcp}
                  onChange={(e) => setIncludeIcp(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    Marcar como assinado ICP-Brasil
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    Registra flag no log e adiciona marca no rodapé. Assinatura
                    digital real exige PSC autorizado (não implementada em V68).
                  </span>
                </span>
              </label>
            )}
          </div>

          {err && (
            <p className="mt-3 flex items-start gap-1 text-xs text-error">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />{err}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose}>Cancelar</Button>
            <Button
              onClick={() => versionId && generateMut.mutate(versionId)}
              loading={generateMut.isPending}
              disabled={!versionId}
            >
              <Download className="h-4 w-4" />Gerar PDF marcado
            </Button>
          </div>
        </>
      )}

      {generated && (
        <>
          <div className="rounded-lg border border-success/30 bg-success/5 p-4">
            <p className="flex items-start gap-2 text-sm text-success">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>PDF gerado e baixado.</strong> Fingerprint registrado
                no log de rastreabilidade.
              </span>
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-md bg-white px-3 py-2 dark:bg-card-dark">
              <ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />
              <span className="font-mono text-xs text-slate-700 dark:text-slate-200">
                FP: {generated.fingerprint}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              Este código aparece no rodapé do PDF. Use-o para identificar a
              origem em caso de vazamento.
            </p>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <a
              href={generated.url}
              download={`watermarked-${generated.fingerprint}.pdf`}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 px-3 text-sm font-medium dark:border-border-dark"
            >
              <Download className="h-4 w-4" />Baixar novamente
            </a>
            <Button onClick={handleClose}>
              <X className="h-4 w-4" />Fechar
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
