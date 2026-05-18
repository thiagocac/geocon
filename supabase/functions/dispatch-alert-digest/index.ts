/**
 * dispatch-alert-digest — envia digest de alertas Lei 14.133.
 *
 * Body opcional:
 *   { dry_run?: bool, tenant_id?: uuid, force?: bool, member_id?: uuid }
 *
 * Regras:
 *   - Idempotente via digest_sends (digest_kind='alert_lei14133')
 *   - Respeita frequência (daily/weekly/monthly) e severity_threshold do member
 *   - 0 alerts → 'skipped', não envia
 *   - Cron diário roda 9h UTC; RPC filtra recipients pela janela do member
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, serverError } from '../_shared/response.ts';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'geocon@consultegeo.org';
const SITE_URL   = Deno.env.get('SITE_URL') || 'https://contratos.consultegeo.org';

interface Recipient {
  member_id:          string;
  tenant_id:          string;
  email:              string;
  nome:               string;
  timezone:           string;
  frequency:          'daily' | 'weekly' | 'monthly';
  severity_threshold: 'warning' | 'danger';
}

interface DigestData {
  member_id:    string;
  member_email: string;
  member_nome:  string;
  tenant_id:    string;
  tenant_name:  string;
  frequency:    'daily' | 'weekly' | 'monthly';
  threshold:    'warning' | 'danger';
  alert_count:  number;
  alerts: {
    vicios_graves:             number;
    garantias_7d:              number;
    par_procedente_sem_sancao: number;
    par_prazo_defesa_vencido:  number;
    multas_grandes_pendentes:  number;
    multas_total_valor:        number;
  };
  top_critical: Array<{ id: string; numero: number; titulo: string; score: number }>;
  next_dates:   Array<{ due_date: string; days_until: number; label: string; contract_id: string; link: string }>;
}

const ALERT_META: Record<keyof DigestData['alerts'], { title: string; severity: 'danger' | 'warning' } | null> = {
  vicios_graves:             { title: 'Vícios graves em aberto',             severity: 'danger'  },
  garantias_7d:              { title: 'Garantias vencendo em ≤7 dias',       severity: 'danger'  },
  par_procedente_sem_sancao: { title: 'PARs procedentes sem sanção',         severity: 'warning' },
  par_prazo_defesa_vencido:  { title: 'PARs com prazo de defesa vencido',    severity: 'warning' },
  multas_grandes_pendentes:  { title: 'Multas grandes pendentes (>R$ 100k)', severity: 'warning' },
  multas_total_valor:        null,
};

const FREQ_LABEL = { daily: 'diário', weekly: 'semanal', monthly: 'mensal' };

async function sendResendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY ausente');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend ${res.status}: ${text}`);
  }
}

function brlShort(n: number): string {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `R$ ${(n / 1e6).toFixed(1).replace('.', ',')}M`;
  if (Math.abs(n) >= 1e3) return `R$ ${(n / 1e3).toFixed(1).replace('.', ',')}k`;
  return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

function fmtToday(timezone: string): string {
  try {
    return new Date().toLocaleDateString('pt-BR', {
      timeZone: timezone, day: '2-digit', month: 'long', year: 'numeric',
    });
  } catch {
    return new Date().toLocaleDateString('pt-BR');
  }
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function renderAlertRow(
  key: keyof DigestData['alerts'],
  count: number,
  multasValor: number,
): string {
  const meta = ALERT_META[key];
  if (!meta) return '';
  const bg     = meta.severity === 'danger' ? '#fef2f2' : '#fffbeb';
  const bar    = meta.severity === 'danger' ? '#dc2626' : '#f59e0b';
  const labelC = meta.severity === 'danger' ? '#7f1d1d' : '#78350f';
  const extra  = (key === 'multas_grandes_pendentes' && multasValor > 0)
    ? `<div style="margin-top:4px;font-size:11px;color:#64748b">Total: ${brlShort(multasValor)}</div>`
    : '';
  return `
    <tr><td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;background:${bg}">
      <div style="display:inline-block;width:6px;height:34px;background:${bar};vertical-align:middle;margin-right:10px"></div>
      <span style="font-size:22px;font-weight:700;color:#0f172a;vertical-align:middle">${count}</span>
      <span style="font-size:13px;color:${labelC};margin-left:8px;vertical-align:middle;font-weight:600">${meta.title}</span>
      <a href="${SITE_URL}/dashboard" style="float:right;font-size:12px;color:#7e22ce;text-decoration:none;margin-top:10px">Abrir →</a>
      ${extra}
    </td></tr>`;
}

function buildDigestHtml(d: DigestData): string {
  const greeting = d.member_nome.split(' ')[0];
  const today    = fmtToday('America/Sao_Paulo');
  const freqLabel = FREQ_LABEL[d.frequency];

  const rows: string[] = [];
  if (d.alerts.vicios_graves             > 0) rows.push(renderAlertRow('vicios_graves',             d.alerts.vicios_graves,             d.alerts.multas_total_valor));
  if (d.alerts.garantias_7d              > 0) rows.push(renderAlertRow('garantias_7d',              d.alerts.garantias_7d,              d.alerts.multas_total_valor));
  if (d.alerts.par_procedente_sem_sancao > 0) rows.push(renderAlertRow('par_procedente_sem_sancao', d.alerts.par_procedente_sem_sancao, d.alerts.multas_total_valor));
  if (d.alerts.par_prazo_defesa_vencido  > 0) rows.push(renderAlertRow('par_prazo_defesa_vencido',  d.alerts.par_prazo_defesa_vencido,  d.alerts.multas_total_valor));
  if (d.alerts.multas_grandes_pendentes  > 0) rows.push(renderAlertRow('multas_grandes_pendentes',  d.alerts.multas_grandes_pendentes,  d.alerts.multas_total_valor));

  const topCriticalHtml = d.top_critical.length > 0 ? `
    <p style="margin:20px 0 8px 0;font-size:12px;font-weight:700;color:#0f172a;letter-spacing:0.05em;text-transform:uppercase">Top contratos críticos</p>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      ${d.top_critical.map((c) => `
        <tr><td style="padding:6px 0;border-bottom:1px solid #f1f5f9">
          <span style="font-family:monospace;color:#c41a7e;font-weight:700">#${c.numero}</span>
          <span style="color:#475569;margin-left:6px">${c.titulo}</span>
          <span style="float:right;font-family:monospace;color:#64748b">score ${c.score}</span>
        </td></tr>
      `).join('')}
    </table>
  ` : '';

  const nextDatesHtml = d.next_dates.length > 0 ? `
    <p style="margin:20px 0 8px 0;font-size:12px;font-weight:700;color:#0f172a;letter-spacing:0.05em;text-transform:uppercase">Próximos vencimentos</p>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      ${d.next_dates.map((n) => `
        <tr><td style="padding:6px 0;border-bottom:1px solid #f1f5f9">
          <span style="color:#475569">${n.label}</span>
          <span style="float:right;font-family:monospace;color:${n.days_until <= 7 ? '#dc2626' : n.days_until <= 30 ? '#f59e0b' : '#64748b'}">
            ${fmtDate(n.due_date)} · ${n.days_until}d
          </span>
        </td></tr>
      `).join('')}
    </table>
  ` : '';

  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Alertas Lei 14.133 — GeoCon</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">
    <div style="background:white;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:#181d3b;padding:20px 24px">
        <div style="color:#c41a7e;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase">GeoCon · ${d.tenant_name}</div>
        <div style="color:white;font-size:18px;font-weight:600;margin-top:4px">Digest ${freqLabel} de alertas Lei 14.133</div>
        <div style="color:#94a3b8;font-size:12px;margin-top:2px">${today}</div>
      </div>

      <div style="padding:20px 24px">
        <p style="margin:0 0 4px 0;font-size:14px;color:#0f172a">Olá, <strong>${greeting}</strong>.</p>
        <p style="margin:0 0 16px 0;font-size:13px;color:#475569">
          Você tem <strong>${d.alert_count}</strong> ${d.alert_count === 1 ? 'tipo de alerta ativo' : 'tipos de alerta ativos'} na carteira.
        </p>

        <table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0">
          ${rows.join('')}
        </table>

        ${topCriticalHtml}
        ${nextDatesHtml}

        <div style="margin-top:20px;text-align:center">
          <a href="${SITE_URL}/dashboard" style="display:inline-block;background:#c41a7e;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Abrir dashboard</a>
        </div>
      </div>

      <div style="background:#f1f5f9;padding:14px 24px;border-top:1px solid #e2e8f0">
        <div style="font-size:11px;color:#64748b;line-height:1.5">
          Você recebe este digest porque optou em <em>Meus dados → Alertas Lei 14.133</em>.<br>
          Frequência atual: <strong>${freqLabel}</strong> · severidade mínima: <strong>${d.threshold}</strong>.<br>
          <a href="${SITE_URL}/me" style="color:#7e22ce">Ajustar preferências</a>
        </div>
      </div>
    </div>
    <div style="text-align:center;font-size:10px;color:#94a3b8;margin-top:12px">
      GeoCon — Consulte GEO · Gestão de Contratos
    </div>
  </div>
</body></html>`;
}

// =============================================================================
// Handler
// =============================================================================
Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = req.method === 'POST'
      ? await req.json().catch(() => ({}))
      : {};
    const dryRun       = body.dry_run  === true;
    const force        = body.force    === true;
    const tenantFilter = body.tenant_id as string | undefined;
    const memberFilter = body.member_id as string | undefined;

    const svc = getServiceClient();

    const { data: recipientsRaw, error: rErr } = await svc.rpc('list_pending_alert_digest_recipients', {
      p_now:   new Date().toISOString(),
      p_force: force,
    });
    if (rErr) return serverError(rErr);

    let recipients = (recipientsRaw || []) as Recipient[];
    if (tenantFilter) recipients = recipients.filter((r) => r.tenant_id === tenantFilter);
    if (memberFilter) recipients = recipients.filter((r) => r.member_id === memberFilter);

    const stats = { total: recipients.length, sent: 0, skipped_empty: 0, failed: 0, errors: [] as string[] };

    for (const r of recipients) {
      try {
        const { data: dataJson, error: dErr } = await svc.rpc('get_alert_digest_data_for_member', {
          p_member_id: r.member_id,
        });
        if (dErr) throw dErr;
        const d = dataJson as DigestData;

        if (d.alert_count === 0) {
          if (!dryRun) {
            await svc.rpc('record_alert_digest_sent', {
              p_member_id: r.member_id,
              p_status:    'skipped',
              p_metadata:  { reason: 'no_alerts', frequency: r.frequency },
            });
          }
          stats.skipped_empty++;
          continue;
        }

        const html = buildDigestHtml(d);
        const subject = `[GeoCon] ${d.alert_count} ${d.alert_count === 1 ? 'alerta' : 'alertas'} Lei 14.133`;

        if (dryRun) {
          stats.sent++;
          continue;
        }

        try {
          await sendResendEmail(r.email, subject, html);

          await svc.from('notifications').insert({
            tenant_id:    r.tenant_id,
            recipient_id: r.member_id,
            kind:         'alert_digest',
            title:        subject,
            body:         `Digest ${FREQ_LABEL[r.frequency]} de alertas Lei 14.133 enviado por email.`,
            link:         '/dashboard',
            metadata:     { alert_count: d.alert_count, frequency: r.frequency },
          });

          await svc.rpc('record_alert_digest_sent', {
            p_member_id: r.member_id,
            p_status:    'sent',
            p_metadata:  { alert_count: d.alert_count, frequency: r.frequency },
          });

          stats.sent++;
        } catch (sendErr) {
          await svc.rpc('record_alert_digest_sent', {
            p_member_id: r.member_id,
            p_status:    'failed',
            p_metadata:  { error: String(sendErr).slice(0, 500) },
          });
          stats.failed++;
          stats.errors.push(`${r.email}: ${String(sendErr).slice(0, 200)}`);
        }
      } catch (perRecipientErr) {
        stats.failed++;
        stats.errors.push(`${r.email}: ${String(perRecipientErr).slice(0, 200)}`);
      }
    }

    return ok({ dry_run: dryRun, ...stats });
  } catch (e) {
    return serverError(e);
  }
});
