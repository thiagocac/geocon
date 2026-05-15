/**
 * notify-pendency — emite notificações para uma lista de membros sobre
 * uma pendência genérica (passos pendentes, documentos pendentes,
 * cobranças, retornos de devolução).
 *
 * Body:
 *   { member_ids: string[], title, body, link?, kind?: string, send_email?: boolean }
 *
 * Encadeia send-notification para cada membro.
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, serverError } from '../_shared/response.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const memberIds = (body.member_ids as string[]) || [];
    const title = body.title as string;
    const text = body.body as string;
    const link = body.link as string | undefined;
    const kind = (body.kind as string) || 'pendency';
    const sendEmail = body.send_email !== false;

    if (memberIds.length === 0 || !title) {
      return fail('member_ids[] e title obrigatórios');
    }

    const results: Array<{ member_id: string; ok: boolean; error?: string }> = [];

    for (const mid of memberIds) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ recipient_member_id: mid, title, body: text, link, kind, send_email: sendEmail }),
        });
        const j = await res.json();
        results.push({ member_id: mid, ok: !!j.ok, error: j.error });
      } catch (e) {
        results.push({ member_id: mid, ok: false, error: (e as Error).message });
      }
    }

    return ok({
      requested: memberIds.length,
      delivered: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (e) {
    return serverError(e);
  }
});
