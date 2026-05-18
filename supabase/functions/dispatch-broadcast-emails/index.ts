/**
 * dispatch-broadcast-emails
 *
 * Chamada APÓS bulk_send_notification para opcionalmente enviar e-mail aos
 * destinatários do broadcast, respeitando:
 *   - preferência email para o event_type (member_notification_prefs)
 *   - quiet_hours do destinatário (is_in_quiet_hours)
 *
 * POST { broadcast_id }
 *
 * Atualiza notification_broadcasts.email_also=true e metadata.email_stats.
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail as failResp, serverError } from '../_shared/response.ts';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'geocon@consultegeo.org';
const SITE_URL   = Deno.env.get('SITE_URL') || 'https://contratos.consultegeo.org';

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
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

interface Broadcast {
  id: string;
  tenant_id: string;
  sender_id: string;
  title: string;
  body: string;
  kind: string;
  action_url: string | null;
  email_also: boolean;
}

function buildHtml(b: Broadcast, recipientName: string): string {
  const firstName = recipientName.split(' ')[0];
  const tone = b.kind === 'system' ? '#dc2626' : (b.kind === 'warning' ? '#f59e0b' : '#7e22ce');
  const toneLabel = b.kind === 'system' ? 'URGENTE' : (b.kind === 'warning' ? 'ATENÇÃO' : 'COMUNICADO');

  // Interpola variáveis per-user (globais já foram resolvidas no RPC)
  const interpolate = (t: string): string => {
    if (!t || !t.includes('{{')) return t;
    return t
      .replace(/\{\{user_name\}\}/g, recipientName)
      .replace(/\{\{user_first\}\}/g, firstName)
      .replace(/\{\{user_email\}\}/g, ''); // omitido para não poluir HTML
  };

  const renderedTitle = interpolate(b.title);
  const renderedBody  = interpolate(b.body);
  const renderedUrl   = interpolate(b.action_url || '');

  const actionBtn = renderedUrl ? `
    <tr><td style="padding:16px 24px 4px">
      <a href="${renderedUrl.startsWith('http') ? renderedUrl : SITE_URL + renderedUrl}"
         style="display:inline-block;background:#182863;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600">
        Abrir →
      </a>
    </td></tr>` : '';

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!doctype html>
<html><body style="font-family:Inter,system-ui,sans-serif;background:#f1f5f9;padding:24px;margin:0">
<table cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
  <tr><td style="background:#182863;padding:18px 24px;border-bottom:3px solid ${tone}">
    <p style="margin:0;font-family:'JetBrains Mono',monospace;font-size:10px;color:${tone};letter-spacing:0.18em;font-weight:700">${toneLabel}</p>
    <h1 style="margin:6px 0 0;color:#fff;font-size:18px">geoCon · Gestão de Contratos</h1>
  </td></tr>
  <tr><td style="padding:20px 24px 8px">
    <p style="margin:0;color:#0f172a;font-size:14px">Olá, <strong>${esc(firstName)}</strong> —</p>
  </td></tr>
  <tr><td style="padding:0 24px 12px">
    <h2 style="margin:0 0 8px;color:#0f172a;font-size:18px;font-weight:800">${esc(renderedTitle)}</h2>
    <p style="margin:0;color:#475569;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(renderedBody)}</p>
  </td></tr>
  ${actionBtn}
  <tr><td style="padding:16px 24px;background:#f8fafc;font-size:11px;color:#94a3b8">
    Esta é uma comunicação interna do tenant geoCon. Para ajustar quais comunicados você recebe por e-mail, acesse
    <a href="${SITE_URL}/me/notificacoes" style="color:#7e22ce">preferências de notificação</a>.
  </td></tr>
</table>
</body></html>`;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json().catch(() => ({}));
    const broadcastId = body.broadcast_id as string | undefined;
    if (!broadcastId) return failResp('broadcast_id obrigatório');

    const svc = getServiceClient();

    // 1. Carrega broadcast
    const { data: bc, error: bcErr } = await svc
      .from('notification_broadcasts')
      .select('id,tenant_id,sender_id,title,body,kind,action_url,email_also,filter_contract_id')
      .eq('id', broadcastId)
      .maybeSingle();
    if (bcErr) throw bcErr;
    if (!bc) return failResp('Broadcast não encontrado');

    if (bc.email_also) {
      return ok({ note: 'Já foi disparado por e-mail anteriormente', email_stats: { skipped_already: true } });
    }

    // 2. Carrega notifications criadas por este broadcast
    const { data: notifs, error: nErr } = await svc
      .from('notifications')
      .select('id,recipient_id,members:recipient_id(id,nome,email)')
      .eq('tenant_id', bc.tenant_id)
      .filter('metadata->>broadcast_id', 'eq', broadcastId);
    if (nErr) throw nErr;

    const list = (notifs || []) as Array<{ id: string; recipient_id: string; members: { id: string; nome: string; email: string } | null }>;
    if (list.length === 0) {
      return ok({ note: 'Nenhuma notification encontrada para este broadcast', email_stats: { total: 0 } });
    }

    let sent = 0;
    let skippedPref = 0;
    let skippedQuiet = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const n of list) {
      const member = n.members;
      if (!member || !member.email) {
        skippedPref += 1;
        continue;
      }

      // Check pref
      let wantEmail = true;
      try {
        const { data: shouldSend } = await svc.rpc('should_send_notification', {
          p_member_id: member.id,
          p_event_type: bc.kind,
          p_channel: 'email',
        });
        if (shouldSend === false) wantEmail = false;
      } catch {
        // se a RPC falhar, segue padrão: envia
      }
      if (!wantEmail) {
        skippedPref += 1;
        continue;
      }

      // Check quiet hours (exceto system)
      if (bc.kind !== 'system') {
        try {
          const { data: inQuiet } = await svc.rpc('is_in_quiet_hours', { p_member_id: member.id });
          if (inQuiet === true) {
            skippedQuiet += 1;
            continue;
          }
        } catch {
          // ignore
        }
      }

      try {
        const subject = `[geoCon] ${bc.title}`;
        const html = buildHtml(bc as Broadcast, member.nome || 'colega');
        await sendEmail(member.email, subject, html);
        sent += 1;
      } catch (e) {
        failed += 1;
        errors.push(`${member.email}: ${(e as Error).message}`);
      }
    }

    // 3. Atualiza broadcast com stats
    await svc.from('notification_broadcasts')
      .update({
        email_also: true,
        total_failed: failed,
        metadata: {
          email_stats: {
            total: list.length,
            sent, skipped_pref: skippedPref, skipped_quiet: skippedQuiet, failed,
          },
          ...(errors.length > 0 ? { email_errors: errors.slice(0, 20) } : {}),
        },
      })
      .eq('id', broadcastId);

    return ok({
      broadcast_id: broadcastId,
      email_stats: { total: list.length, sent, skipped_pref: skippedPref, skipped_quiet: skippedQuiet, failed },
    });
  } catch (e) {
    console.error('[dispatch-broadcast-emails]', e);
    return serverError(e);
  }
});
