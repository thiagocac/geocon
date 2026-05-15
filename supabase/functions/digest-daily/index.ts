/**
 * digest-daily — envia o resumo diário (e-mail consolidado) para membros que
 * optaram (preferência digest_daily/email = true).
 *
 * Pode ser invocada:
 *   POST com body { tenant_id?: uuid, dry_run?: bool, force?: bool }
 *     - tenant_id: limita a um tenant específico
 *     - dry_run: monta o conteúdo mas não envia
 *     - force: ignora idempotência diária (re-envia mesmo se já enviou hoje)
 *
 * Regras:
 *   - Idempotente por dia (tabela digest_sends, unique member×date)
 *   - Respeita quiet_hours (se 'agora' está em quiet hours pro user, adia)
 *   - Só envia para members com pref digest_daily/email = enabled=true
 *   - Conteúdo zero (sem aprovações, pendências, GRDs) → não envia
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, serverError } from '../_shared/response.ts';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'geocon@consultegeo.org';
const SITE_URL = Deno.env.get('SITE_URL') || 'https://contratos.consultegeo.org';

interface DigestData {
  member_id: string;
  email: string;
  nome: string;
  timezone: string;
  aprovacoes_pendentes: number;
  aprovacoes_atrasadas: number;
  grds_pendentes: number;
  notif_nao_lidas: number;
  pendencias_high_tenant: number;
  contratos_criticos_tenant: number;
  contratos_atencao_tenant: number;
  tenant_id: string;
}

async function sendResendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY ausente');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend ${res.status}: ${text}`);
  }
}

function buildDigestHtml(d: DigestData, today: string): string {
  const greeting = d.nome.split(' ')[0];
  const blocks: string[] = [];

  if (d.aprovacoes_pendentes > 0) {
    const atrasadasLabel = d.aprovacoes_atrasadas > 0
      ? ` <span style="color:#dc2626">(${d.aprovacoes_atrasadas} fora do prazo)</span>`
      : '';
    blocks.push(`
      <tr><td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;background:#fef3c7">
        <div style="display:inline-block;width:6px;height:34px;background:#f59e0b;vertical-align:middle;margin-right:10px"></div>
        <span style="font-size:22px;font-weight:700;color:#0f172a;vertical-align:middle">${d.aprovacoes_pendentes}</span>
        <span style="font-size:13px;color:#475569;margin-left:8px;vertical-align:middle">aprovação(ões) de medição pendentes${atrasadasLabel}</span>
        <a href="${SITE_URL}/aprovacoes" style="float:right;font-size:12px;color:#7e22ce;text-decoration:none;margin-top:10px">Abrir →</a>
      </td></tr>`);
  }

  if (d.grds_pendentes > 0) {
    blocks.push(`
      <tr><td style="padding:14px 16px;border-bottom:1px solid #e2e8f0">
        <div style="display:inline-block;width:6px;height:34px;background:#7e22ce;vertical-align:middle;margin-right:10px"></div>
        <span style="font-size:22px;font-weight:700;color:#0f172a;vertical-align:middle">${d.grds_pendentes}</span>
        <span style="font-size:13px;color:#475569;margin-left:8px;vertical-align:middle">GRD(s) aguardando seu recebimento</span>
        <a href="${SITE_URL}/ged/distribuicao" style="float:right;font-size:12px;color:#7e22ce;text-decoration:none;margin-top:10px">Abrir →</a>
      </td></tr>`);
  }

  if (d.pendencias_high_tenant > 0) {
    blocks.push(`
      <tr><td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;background:#fee2e2">
        <div style="display:inline-block;width:6px;height:34px;background:#dc2626;vertical-align:middle;margin-right:10px"></div>
        <span style="font-size:22px;font-weight:700;color:#0f172a;vertical-align:middle">${d.pendencias_high_tenant}</span>
        <span style="font-size:13px;color:#475569;margin-left:8px;vertical-align:middle">pendência(s) de alta severidade no portfólio</span>
        <a href="${SITE_URL}/pendencias" style="float:right;font-size:12px;color:#7e22ce;text-decoration:none;margin-top:10px">Abrir →</a>
      </td></tr>`);
  }

  if (d.contratos_criticos_tenant > 0) {
    blocks.push(`
      <tr><td style="padding:14px 16px;border-bottom:1px solid #e2e8f0">
        <div style="display:inline-block;width:6px;height:34px;background:#dc2626;vertical-align:middle;margin-right:10px"></div>
        <span style="font-size:22px;font-weight:700;color:#0f172a;vertical-align:middle">${d.contratos_criticos_tenant}</span>
        <span style="font-size:13px;color:#475569;margin-left:8px;vertical-align:middle">contrato(s) em nível crítico</span>
        <a href="${SITE_URL}/dashboard" style="float:right;font-size:12px;color:#7e22ce;text-decoration:none;margin-top:10px">Abrir →</a>
      </td></tr>`);
  }

  if (d.contratos_atencao_tenant > 0 && d.contratos_criticos_tenant === 0) {
    blocks.push(`
      <tr><td style="padding:14px 16px;border-bottom:1px solid #e2e8f0">
        <div style="display:inline-block;width:6px;height:34px;background:#f59e0b;vertical-align:middle;margin-right:10px"></div>
        <span style="font-size:22px;font-weight:700;color:#0f172a;vertical-align:middle">${d.contratos_atencao_tenant}</span>
        <span style="font-size:13px;color:#475569;margin-left:8px;vertical-align:middle">contrato(s) em atenção</span>
        <a href="${SITE_URL}/dashboard" style="float:right;font-size:12px;color:#7e22ce;text-decoration:none;margin-top:10px">Abrir →</a>
      </td></tr>`);
  }

  if (d.notif_nao_lidas > 0) {
    blocks.push(`
      <tr><td style="padding:14px 16px;border-bottom:1px solid #e2e8f0">
        <div style="display:inline-block;width:6px;height:34px;background:#3b82f6;vertical-align:middle;margin-right:10px"></div>
        <span style="font-size:22px;font-weight:700;color:#0f172a;vertical-align:middle">${d.notif_nao_lidas}</span>
        <span style="font-size:13px;color:#475569;margin-left:8px;vertical-align:middle">notificação(ões) não lida(s) nos últimos 7 dias</span>
        <a href="${SITE_URL}/notifications" style="float:right;font-size:12px;color:#7e22ce;text-decoration:none;margin-top:10px">Abrir →</a>
      </td></tr>`);
  }

  if (blocks.length === 0) {
    blocks.push(`
      <tr><td style="padding:24px 16px;text-align:center;background:#dcfce7;color:#166534">
        <p style="margin:0;font-size:14px"><strong>Caixa zerada hoje 🎉</strong></p>
        <p style="margin:6px 0 0;font-size:12px;color:#475569">Nada pendente. Aproveite o dia.</p>
      </td></tr>`);
  }

  return `<!doctype html>
<html><body style="font-family:Inter,system-ui,sans-serif;background:#f1f5f9;padding:24px;margin:0">
<table cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
  <tr><td style="background:#182863;padding:18px 24px">
    <h1 style="margin:0;color:#fff;font-size:18px">geoCon · Resumo diário</h1>
    <p style="margin:4px 0 0;color:#cbd5e1;font-size:11px">Consulte GEO · Gestão de Contratos</p>
  </td></tr>
  <tr><td style="padding:20px 24px 8px">
    <p style="margin:0;color:#0f172a;font-size:15px">Olá, <strong>${greeting}</strong> —</p>
    <p style="margin:6px 0 0;color:#64748b;font-size:13px">O que precisa da sua atenção hoje (${today}):</p>
  </td></tr>
  ${blocks.join('')}
  <tr><td style="padding:16px 24px;background:#f8fafc;font-size:11px;color:#94a3b8">
    Você está recebendo este e-mail porque ativou o "Resumo diário" em suas
    <a href="${SITE_URL}/me/notificacoes" style="color:#7e22ce">preferências de notificação</a>.
    Para parar, basta desligar lá.
  </td></tr>
</table>
</body></html>`;
}

interface ProcessResult {
  member_id: string;
  email: string;
  status: 'sent' | 'skipped_already' | 'skipped_quiet_hours' | 'skipped_empty' | 'skipped_pref' | 'failed';
  error?: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const tenantId = body.tenant_id as string | undefined;
    const dryRun = body.dry_run === true;
    const force = body.force === true;

    const svc = getServiceClient();

    // Lista membros com pref digest_daily/email habilitada
    let prefsQuery = svc
      .from('member_notification_prefs')
      .select('member_id, tenant_id')
      .eq('event_type', 'digest_daily')
      .eq('channel', 'email')
      .eq('enabled', true);
    if (tenantId) prefsQuery = prefsQuery.eq('tenant_id', tenantId);
    const { data: prefs, error: prefsErr } = await prefsQuery;
    if (prefsErr) throw prefsErr;

    const memberIds = (prefs || []).map((p) => p.member_id as string);
    if (memberIds.length === 0) {
      return ok({ processed: 0, results: [], note: 'Ninguém opted-in para digest_daily/email neste escopo.' });
    }

    // Busca dados consolidados
    const { data: rows, error: dataErr } = await svc
      .from('v_digest_daily_data')
      .select('*')
      .in('member_id', memberIds);
    if (dataErr) throw dataErr;

    const today = new Date().toISOString().slice(0, 10);
    const todayLabel = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

    const results: ProcessResult[] = [];

    for (const row of (rows || []) as DigestData[]) {
      // Checa idempotência
      if (!force) {
        const { data: existing } = await svc
          .from('digest_sends')
          .select('id, email_status')
          .eq('member_id', row.member_id)
          .eq('sent_date', today)
          .maybeSingle();
        if (existing && existing.email_status === 'sent') {
          results.push({ member_id: row.member_id, email: row.email, status: 'skipped_already' });
          continue;
        }
      }

      // Checa quiet hours
      const { data: inQuiet } = await svc.rpc('is_in_quiet_hours', { p_member_id: row.member_id });
      if (inQuiet === true && !force) {
        results.push({ member_id: row.member_id, email: row.email, status: 'skipped_quiet_hours' });
        continue;
      }

      // Conteúdo: se zero em tudo e não forçado, skip
      const total = row.aprovacoes_pendentes + row.grds_pendentes + row.pendencias_high_tenant +
                    row.contratos_criticos_tenant + row.notif_nao_lidas;
      if (total === 0 && !force) {
        results.push({ member_id: row.member_id, email: row.email, status: 'skipped_empty' });
        // Registra como skipped pra evitar reprocessamento
        if (!dryRun) {
          await svc.from('digest_sends').upsert({
            member_id: row.member_id, tenant_id: row.tenant_id,
            sent_date: today, email_status: 'skipped',
            metadata: { reason: 'empty' },
          }, { onConflict: 'member_id,sent_date' });
        }
        continue;
      }

      const html = buildDigestHtml(row, todayLabel);
      const subject = `[geoCon] Resumo diário — ${row.aprovacoes_pendentes + row.grds_pendentes} pendência(s) sua(s)`;

      if (dryRun) {
        results.push({ member_id: row.member_id, email: row.email, status: 'sent' });
        continue;
      }

      try {
        await sendResendEmail(row.email, subject, html);
        await svc.from('digest_sends').upsert({
          member_id: row.member_id, tenant_id: row.tenant_id,
          sent_date: today, email_status: 'sent',
          metadata: {
            aprovacoes: row.aprovacoes_pendentes,
            grds: row.grds_pendentes,
            pendencias_high: row.pendencias_high_tenant,
            criticos: row.contratos_criticos_tenant,
          },
        }, { onConflict: 'member_id,sent_date' });
        results.push({ member_id: row.member_id, email: row.email, status: 'sent' });
      } catch (e) {
        const msg = (e as Error).message;
        await svc.from('digest_sends').upsert({
          member_id: row.member_id, tenant_id: row.tenant_id,
          sent_date: today, email_status: 'failed',
          metadata: { error: msg },
        }, { onConflict: 'member_id,sent_date' });
        results.push({ member_id: row.member_id, email: row.email, status: 'failed', error: msg });
      }
    }

    return ok({
      processed: results.length,
      sent: results.filter((r) => r.status === 'sent').length,
      skipped: results.filter((r) => r.status.startsWith('skipped')).length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
      dry_run: dryRun,
    });
  } catch (e) {
    console.error('[digest-daily]', e);
    return serverError(e);
  }
});
