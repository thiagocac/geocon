import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stamp, Save, CheckCircle2, AlertCircle, RotateCcw } from 'lucide-react';
import {
  getGedWatermarkSettings, upsertGedWatermarkSettings, type WatermarkSettings,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/FormField';
import { Skeleton } from '../../components/ui/Stat';

/**
 * V70 — Configuração visual da marca d'água V68 por tenant.
 *
 * Rota: /ged/configuracoes/marca-dagua
 *
 * Permite ao gestor editar texto, cor, opacidade, ângulo, tamanho de fonte
 * e toggles ICP-Brasil + timestamp + fingerprint. Inclui preview ao vivo
 * sobre uma página em branco simulada.
 */
export function GedWatermarkSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['ged-watermark-settings'],
    queryFn: getGedWatermarkSettings,
  });

  const [form, setForm] = useState<WatermarkSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (data) setForm(data); }, [data]);

  const saveMut = useMutation({
    mutationFn: (s: Partial<WatermarkSettings>) => upsertGedWatermarkSettings(s),
    onSuccess: (s) => {
      qc.setQueryData(['ged-watermark-settings'], s);
      setSaved(true);
      setErr(null);
      setTimeout(() => setSaved(false), 4000);
    },
    onError: (e: Error) => setErr(humanizeError(e)),
  });

  function update<K extends keyof WatermarkSettings>(k: K, v: WatermarkSettings[K]) {
    setForm((f) => f ? { ...f, [k]: v } : f);
  }

  function resetDefaults() {
    setForm({
      tenant_id: form?.tenant_id, texto: 'CÓPIA NÃO CONTROLADA', texto_secundario: null,
      opacidade: 0.20, angulo_graus: 45, tamanho_fonte: 48, cor_hex: '#FF0000',
      incluir_timestamp: true, incluir_fingerprint: true,
      icp_brasil_enabled: false, icp_brasil_signer_label: null,
    });
  }

  return (
    <Layout>
      <PageHeader
        kicker="GED · Configurações"
        title="Marca d'água"
        subtitle="Aparência das cópias controladas distribuídas a partir do GED"
        backTo="/ged"
        backLabel="GED"
      />

      {isLoading || !form ? (
        <Card className="p-6"><Skeleton className="h-64" /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Form */}
          <Card className="p-5">
            <h2 className="mb-4 font-semibold dark:text-slate-100">Aparência da marca</h2>

            <div className="space-y-3">
              <Field label="Texto principal">
                <input
                  type="text" value={form.texto} maxLength={120}
                  onChange={(e) => update('texto', e.target.value)} className="input"
                />
              </Field>
              <Field label="Texto secundário (opcional)" hint="Ex: nome empresa, contrato, depto.">
                <input
                  type="text" value={form.texto_secundario || ''} maxLength={120}
                  onChange={(e) => update('texto_secundario', e.target.value || null)} className="input"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cor">
                  <div className="flex items-center gap-2">
                    <input
                      type="color" value={form.cor_hex.toUpperCase()}
                      onChange={(e) => update('cor_hex', e.target.value.toUpperCase())}
                      className="h-9 w-9 cursor-pointer rounded border border-slate-200 dark:border-border-dark"
                    />
                    <input
                      type="text" value={form.cor_hex} maxLength={7}
                      onChange={(e) => update('cor_hex', e.target.value)} className="input font-mono"
                    />
                  </div>
                </Field>
                <Field label={`Opacidade · ${form.opacidade.toFixed(2)}`}>
                  <input
                    type="range" min={0.05} max={0.50} step={0.01}
                    value={form.opacidade}
                    onChange={(e) => update('opacidade', parseFloat(e.target.value))}
                    className="w-full"
                  />
                </Field>
                <Field label={`Ângulo · ${form.angulo_graus}°`}>
                  <input
                    type="range" min={-90} max={90} step={5}
                    value={form.angulo_graus}
                    onChange={(e) => update('angulo_graus', parseInt(e.target.value))}
                    className="w-full"
                  />
                </Field>
                <Field label={`Tamanho · ${form.tamanho_fonte}pt`}>
                  <input
                    type="range" min={12} max={144} step={2}
                    value={form.tamanho_fonte}
                    onChange={(e) => update('tamanho_fonte', parseInt(e.target.value))}
                    className="w-full"
                  />
                </Field>
              </div>

              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.incluir_timestamp}
                         onChange={(e) => update('incluir_timestamp', e.target.checked)} />
                  Incluir timestamp no rodapé
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.incluir_fingerprint}
                         onChange={(e) => update('incluir_fingerprint', e.target.checked)} />
                  Incluir fingerprint no rodapé (rastreabilidade)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.icp_brasil_enabled}
                         onChange={(e) => update('icp_brasil_enabled', e.target.checked)} />
                  Habilitar marca ICP-Brasil (toggle no momento do download)
                </label>
                {form.icp_brasil_enabled && (
                  <Field label="PSC / signer label (opcional)" hint="Aparece quando ICP-Brasil é aplicado">
                    <input
                      type="text" value={form.icp_brasil_signer_label || ''}
                      onChange={(e) => update('icp_brasil_signer_label', e.target.value || null)}
                      className="input" placeholder="Ex: Eduardo Vargas · AC Certisign"
                    />
                  </Field>
                )}
              </div>
            </div>

            {err && (
              <p className="mt-3 flex items-start gap-1 text-xs text-error">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />{err}
              </p>
            )}

            <div className="mt-5 flex items-center justify-between gap-2">
              <Button variant="ghost" onClick={resetDefaults}>
                <RotateCcw className="h-4 w-4" />Restaurar padrão
              </Button>
              <div className="flex items-center gap-2">
                {saved && (
                  <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-display text-success">
                    <CheckCircle2 className="h-3 w-3" />Salvo
                  </span>
                )}
                <Button onClick={() => saveMut.mutate(form)} loading={saveMut.isPending}>
                  <Save className="h-4 w-4" />Salvar
                </Button>
              </div>
            </div>
          </Card>

          {/* Preview */}
          <Card className="overflow-hidden p-5">
            <h2 className="mb-4 font-semibold dark:text-slate-100">Preview</h2>
            <div className="relative h-[420px] overflow-hidden rounded border border-slate-200 bg-white shadow-inner dark:border-border-dark">
              {/* Fundo simula página A4 */}
              <div className="absolute inset-0 flex flex-col p-6 text-[10px] leading-relaxed text-slate-300">
                <p className="font-semibold">MEMORIAL DESCRITIVO</p>
                <p>Hospital Municipal do Rio de Janeiro</p>
                <p className="mt-3">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent vel arcu eget magna pretium pretium. Sed efficitur erat eget velit lobortis pulvinar. Vestibulum at lacinia neque, eu volutpat justo.</p>
                <p className="mt-2">In hac habitasse platea dictumst. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Maecenas viverra justo non sapien rhoncus volutpat.</p>
                <p className="mt-2">Donec id nibh vel nibh accumsan blandit. Aenean luctus dolor non quam pulvinar luctus. Cras quis nulla in libero hendrerit dictum sit amet eget enim.</p>
                <p className="mt-2">Nullam ac nulla a ante consequat fermentum a vitae elit. Curabitur vehicula urna eget elit dictum, vitae blandit lacus auctor. Vivamus sed est dignissim, ullamcorper massa eu, sollicitudin felis.</p>
              </div>

              {/* Watermark principal */}
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                style={{
                  transform: `rotate(${form.angulo_graus}deg)`,
                }}
              >
                <div className="text-center" style={{
                  color: form.cor_hex,
                  opacity: form.opacidade,
                }}>
                  <p
                    className="font-bold"
                    style={{
                      fontSize: `${form.tamanho_fonte * 0.7}px`,
                      lineHeight: 1,
                    }}
                  >
                    {form.texto}
                  </p>
                  {form.texto_secundario && (
                    <p
                      className="mt-2 font-medium"
                      style={{
                        fontSize: `${Math.max(8, form.tamanho_fonte * 0.28)}px`,
                      }}
                    >
                      {form.texto_secundario}
                    </p>
                  )}
                </div>
              </div>

              {/* Footer simulado */}
              {(form.incluir_timestamp || form.incluir_fingerprint || form.icp_brasil_enabled) && (
                <div className="absolute bottom-1 left-2 text-[7px] text-slate-400">
                  {form.incluir_fingerprint && 'FP: A3F71C92B5D481E0 · '}
                  {form.incluir_timestamp && new Date().toLocaleString('pt-BR') + ' · '}
                  {form.icp_brasil_enabled && '[ICP-Brasil ativado]'}
                </div>
              )}
            </div>
            <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
              <Stamp className="mr-1 inline h-3 w-3" />
              O PDF gerado pela Edge Function reflete estas configurações com
              precisão pixel-perfect.
            </p>
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              <Link to="/ged" className="font-semibold text-navy hover:underline">
                Voltar ao GED
              </Link>
              {' '}para baixar documento com marca d'água.
            </p>
          </Card>
        </div>
      )}
    </Layout>
  );
}
