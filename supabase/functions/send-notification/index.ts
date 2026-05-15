/**
 * send-notification — cria registro em notifications + dispara e-mail via Resend.
 *
 * Body:
 *   {
 *     recipient_member_id: uuid,   // ID do destinatário
 *     title: string,
 *     body?: string,
 *     link?: string,
 *     kind?: string,               // tipo do evento (event_type)
 *     event_type?: string,         // alias mais explícito (preferido sobre kind)
 *     send_email?: boolean,        // override — true para forçar, false para suprimir
 *     metadata?: object
 *   }
 *
 * V11: consulta `public.should_send_notification(member_id, event_type, channel)`
 * para cada canal antes de criar/enviar. Eventos do tipo 'system' são sempre
 * entregues (não desligáveis).
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

function buildHtml(title: string, body: string, link?: string | null): string {
  const linkHtml = link ? `<p style="margin-top:24px"><a href="${link}" style="background:#182863;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Abrir no geoCon</a></p>` : '';
  return `<!doctype html><html><body style="font-family:Inter,system-ui,sans-serif;background:#f8fafc;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
  <h1 style="margin:0 0 8px;color:#182863;font-size:18px">geoCon</h1>
  <p style="color:#64748b;font-size:11px;margin:0 0 18px">Consulte GEO · Gestão de Contratos</p>
  <h2 style="font-size:16px;color:#0f172a;margin:0 0 8px">${title}</h2>
  <p style="color:#334155;font-size:14px;line-height:1.5">${body}</p>
  ${linkHtml}
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
  <p style="color:#94a3b8;font-size:11px">Para gerenciar quais e-mails você quer receber, acesse <a href="${SITE_URL}/me/notificacoes" style="color:#7e22ce">/me/notificacoes</a> no geoCon.</p>
</div></body></html>`;
}

async function shouldSend(svc: ReturnType<typeof getServiceClient>, memberId: string, eventType: string, channel: 'in_app' | 'email'): Promise<boolean> {
  const { data, error } = await svc.rpc('should_send_notification', {
    p_member_id: memberId, p_event_type: eventType, p_channel: channel,
  });
  if (error) {
    console.error('[shouldSend]', error.message);
    return true; // fallback permissivo se a função não existe ainda
  }
  return data === true;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const recipientMemberId = body.recipient_member_id as string;
    const title = body.title as string;
    const text = (body.body as string) || '';
    const link = body.link as string | undefined;
    const eventType = (body.event_type as string) || (body.kind as string) || 'generic';
    const explicitSendEmail = body.send_email as boolean | undefined;
    const metadata = (body.metadata as Record<string, unknown>) || {};

    if (!recipientMemberId || !title) return fail('recipient_member_id e title obrigatórios');

    const svc = getServiceClient();

    // Carrega o member alvo
    const { data: member, error: memErr } = await svc
      .from('members')
      .select('id,email,tenant_id,nome,active,deleted_at')
      .eq('id', recipientMemberId)
      .maybeSingle();
    if (memErr || !member) return fail('Destinatário não encontrado', 404);
    if (member.deleted_at || member.active === false) {
      return ok({ skipped: true, reason: 'recipient inactive' });
    }

    // Consulta prefs por canal
    const wantInApp = await shouldSend(svc, member.id, eventType, 'in_app');
    const wantEmailPref = await shouldSend(svc, member.id, eventType, 'email');
    // Override explícito: send_email=false força skip; send_email=true ainda respeita a pref
    let wantEmail = explicitSendEmail === false ? false : wantEmailPref;

    // Quiet hours suprime e-mails (exceto eventos 'system')
    let quietHoursActive = false;
    if (wantEmail && eventType !== 'system') {
      try {
        const { data: inQuiet } = await svc.rpc('is_in_quiet_hours', { p_member_id: member.id });
        if (inQuiet === true) {
          wantEmail = false;
          quietHoursActive = true;
        }
      } catch (e) {
        console.warn('[quiet-hours]', (e as Error).message);
      }
    }

    const fullLink = link ? (link.startsWith('http') ? link : `${SITE_URL}${link}`) : null;

    // Cria notification in-app (se canal permitido)
    let notificationId: string | null = null;
    if (wantInApp) {
      const { data: notif, error: notErr } = await svc
        .from('notifications')
        .insert({
          tenant_id: member.tenant_id,
          recipient_id: member.id, // FIX: era recipient_member_id, schema usa recipient_id
          title,
          body: text,
          link: fullLink,
          kind: eventType,
          metadata,
        })
        .select('id')
        .single();
      if (notErr) throw notErr;
      notificationId = notif.id;
    }

    // Envia e-mail (se canal permitido + override + tem e-mail)
    let emailStatus: 'sent' | 'skipped' | 'failed' | 'no_pref' = 'skipped';
    if (wantEmail && member.email) {
      try {
        await sendResendEmail(member.email, `[geoCon] ${title}`, buildHtml(title, text, fullLink));
        emailStatus = 'sent';
      } catch (e) {
        console.error('[send-notification] e-mail falhou:', (e as Error).message);
        emailStatus = 'failed';
      }
    } else if (!wantEmail) {
      emailStatus = quietHoursActive ? 'no_pref' : 'no_pref';
    }

    return ok({
      notification_id: notificationId,
      email_status: emailStatus,
      in_app: wantInApp,
      event_type: eventType,
      quiet_hours_suppressed: quietHoursActive,
    });
  } catch (e) {
    return serverError(e);
  }
});
