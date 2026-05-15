/**
 * send-notification — cria registro em notifications + dispara e-mail via
 * Resend (se configurado).
 *
 * Body:
 *   { recipient_member_id, title, body, link?, kind?, send_email? }
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, serverError } from '../_shared/response.ts';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'geocon@consultegeo.org';
const SITE_URL = Deno.env.get('SITE_URL') || 'https://contratos.consultegeo.org';

async function sendResendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_KEY) {
    console.warn('[send-notification] RESEND_API_KEY ausente — e-mail não enviado');
    return;
  }
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

function buildHtml(title: string, body: string, link?: string): string {
  const linkHtml = link ? `<p style="margin-top:24px"><a href="${link}" style="background:#182863;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Abrir no geoCon</a></p>` : '';
  return `<!doctype html><html><body style="font-family:Inter,system-ui,sans-serif;background:#f8fafc;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
  <h1 style="margin:0 0 8px;color:#182863;font-size:18px">geoCon</h1>
  <p style="color:#64748b;font-size:11px;margin:0 0 18px">Consulte GEO · Gestão de Contratos</p>
  <h2 style="font-size:16px;color:#0f172a;margin:0 0 8px">${title}</h2>
  <p style="color:#334155;font-size:14px;line-height:1.5">${body}</p>
  ${linkHtml}
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
  <p style="color:#94a3b8;font-size:11px">Você recebeu este e-mail porque é usuário de uma instância geoCon na plataforma Consulte GEO.</p>
</div></body></html>`;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const recipientMemberId = body.recipient_member_id as string;
    const title = body.title as string;
    const text = body.body as string;
    const link = body.link as string | undefined;
    const kind = (body.kind as string) || 'generic';
    const sendEmail = body.send_email !== false;

    if (!recipientMemberId || !title) return fail('recipient_member_id e title obrigatórios');

    const svc = getServiceClient();

    // Carrega o member alvo para descobrir e-mail + tenant
    const { data: member, error: memErr } = await svc
      .from('members')
      .select('id,email,tenant_id,nome')
      .eq('id', recipientMemberId)
      .maybeSingle();
    if (memErr || !member) return fail('Destinatário não encontrado', 404);

    // Cria notification in-app
    const { data: notif, error: notErr } = await svc
      .from('notifications')
      .insert({
        tenant_id: member.tenant_id,
        recipient_member_id: member.id,
        title,
        body: text,
        link: link ? (link.startsWith('http') ? link : `${SITE_URL}${link}`) : null,
        kind,
      })
      .select()
      .single();
    if (notErr) throw notErr;

    // Envia e-mail
    let emailStatus: 'sent' | 'skipped' | 'failed' = 'skipped';
    if (sendEmail && member.email) {
      try {
        await sendResendEmail(member.email, `[geoCon] ${title}`, buildHtml(title, text || '', notif.link));
        emailStatus = 'sent';
      } catch (e) {
        console.error('[send-notification] e-mail falhou:', (e as Error).message);
        emailStatus = 'failed';
      }
    }

    return ok({ notification_id: notif.id, email_status: emailStatus });
  } catch (e) {
    return serverError(e);
  }
});
