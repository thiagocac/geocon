/**
 * dispatch-broadcast-webhooks
 *
 * Chamada APÓS bulk_send_notification para disparar webhooks externos
 * (Slack, MS Teams, ou JSON genérico) inscritos no evento 'broadcast_sent'
 * do tenant em questão.
 *
 * Cada webhook ativo recebe um POST com payload no formato apropriado
 * pra cada destino. Resposta de cada webhook é registrada via
 * record_webhook_dispatch.
 *
 * POST { broadcast_id }   →  responde { ok, dispatched, results: [...] }
 *
 * Pode ser chamada também em modo "test":
 * POST { test_webhook_id }  →  envia payload sintético sem broadcast_id
 *
 * É idempotente — repetir não cria notifications duplicadas (só logs).
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail as failResp, serverError } from '../_shared/response.ts';

const SITE_URL = Deno.env.get('SITE_URL') || 'https://contratos.consultegeo.org';
const FETCH_TIMEOUT_MS = 10_000;

interface Broadcast {
  id: string;
  tenant_id: string;
  sender_id: string;
  title: string;
  body: string;
  kind: string;
  action_url: string | null;
  total_sent: number;
  filter_roles: string[] | null;
  filter_contract_id: string | null;
  filter_member_ids: string[] | null;
  created_at: string;
}

interface Webhook {
  id: string;
  tenant_id: string;
  label: string;
  kind: 'slack' | 'teams' | 'generic';
  url: string;
  events: string[];
  active: boolean;
  signing_secret: string | null;
  payload_template: string | null;
}

/* ---------- HMAC signing ---------- */
async function signHmac(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  // hex
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ---------- Custom template interpolation ---------- */
function interpolateTemplate(template: string, vars: Record<string, string | number | null>): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === null || v === undefined) return '';
    return String(v);
  });
}

function truncate(s: string, n = 600): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function actionLink(b: Broadcast): string {
  if (!b.action_url) return '';
  if (/^https?:\/\//.test(b.action_url)) return b.action_url;
  return SITE_URL.replace(/\/$/, '') + (b.action_url.startsWith('/') ? b.action_url : `/${b.action_url}`);
}

function buildScopeLabel(b: Broadcast): string {
  if (b.filter_contract_id) return 'Por contrato';
  if (b.filter_member_ids && b.filter_member_ids.length > 0) return `${b.filter_member_ids.length} membros`;
  if (b.filter_roles && b.filter_roles.length > 0) return b.filter_roles.join(', ');
  return 'Todos do tenant';
}

/* ---------- Payload builders ---------- */

function slackPayload(b: Broadcast, senderName: string, tenantName: string) {
  const link = actionLink(b);
  const toneEmoji = b.kind === 'system' ? ':rotating_light:' : b.kind === 'warning' ? ':warning:' : ':loudspeaker:';
  return {
    text: `${toneEmoji} *${b.title}* — ${tenantName}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${toneEmoji} ${truncate(b.title, 130)}`, emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: truncate(b.body, 600) },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `*De:* ${senderName} · *Tenant:* ${tenantName} · *Escopo:* ${buildScopeLabel(b)} · *Alcançou:* ${b.total_sent}` },
        ],
      },
      ...(link
        ? [{
            type: 'actions',
            elements: [{
              type: 'button',
              text: { type: 'plain_text', text: 'Abrir no geoCon' },
              url: link,
              style: b.kind === 'system' ? 'danger' : undefined,
            }],
          }]
        : []),
    ],
  };
}

function teamsPayload(b: Broadcast, senderName: string, tenantName: string) {
  const link = actionLink(b);
  const themeColor = b.kind === 'system' ? 'dc2626' : b.kind === 'warning' ? 'f59e0b' : '7e22ce';
  const card: Record<string, unknown> = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor,
    summary: truncate(b.title, 120),
    title: truncate(b.title, 150),
    text: truncate(b.body, 800),
    sections: [
      {
        facts: [
          { name: 'De', value: senderName },
          { name: 'Tenant', value: tenantName },
          { name: 'Escopo', value: buildScopeLabel(b) },
          { name: 'Alcançou', value: String(b.total_sent) },
          { name: 'Tipo', value: b.kind },
        ],
      },
    ],
  };
  if (link) {
    card.potentialAction = [{
      '@type': 'OpenUri',
      name: 'Abrir no geoCon',
      targets: [{ os: 'default', uri: link }],
    }];
  }
  return card;
}

function genericPayload(b: Broadcast, senderName: string, tenantName: string) {
  return {
    event: 'broadcast_sent',
    timestamp: b.created_at,
    tenant: { id: b.tenant_id, name: tenantName },
    sender: { id: b.sender_id, name: senderName },
    broadcast: {
      id: b.id,
      title: b.title,
      body: b.body,
      kind: b.kind,
      action_url: actionLink(b) || null,
      total_sent: b.total_sent,
      scope: buildScopeLabel(b),
      filter_roles: b.filter_roles || [],
      filter_contract_id: b.filter_contract_id,
      filter_member_ids: b.filter_member_ids || [],
    },
  };
}

function customTemplatePayload(
  template: string, b: Broadcast, senderName: string, tenantName: string,
): unknown {
  const vars: Record<string, string | number | null> = {
    'broadcast_id':       b.id,
    'broadcast_title':    b.title,
    'broadcast_body':     b.body,
    'broadcast_kind':     b.kind,
    'broadcast_action':   actionLink(b) || '',
    'broadcast_total':    b.total_sent,
    'broadcast_scope':    buildScopeLabel(b),
    'broadcast_created':  b.created_at,
    'tenant_id':          b.tenant_id,
    'tenant_name':        tenantName,
    'sender_id':          b.sender_id,
    'sender_name':        senderName,
    'event':              'broadcast_sent',
  };
  const interpolated = interpolateTemplate(template, vars);
  // Reparse após substituição — admin pode embedar valores em string vs número
  try {
    return JSON.parse(interpolated);
  } catch {
    // Se quebrou a estrutura, devolve fallback genérico (e loga)
    console.warn('[dispatch-broadcast-webhooks] custom template gerou JSON inválido, usando fallback genérico');
    return genericPayload(b, senderName, tenantName);
  }
}

function buildPayload(w: Webhook, b: Broadcast, senderName: string, tenantName: string): unknown {
  if (w.kind === 'slack') return slackPayload(b, senderName, tenantName);
  if (w.kind === 'teams') return teamsPayload(b, senderName, tenantName);
  if (w.kind === 'generic' && w.payload_template) {
    return customTemplatePayload(w.payload_template, b, senderName, tenantName);
  }
  return genericPayload(b, senderName, tenantName);
}

/* ---------- HTTP POST com timeout + HMAC opcional ---------- */

async function postWebhook(
  url: string, payload: unknown, signingSecret: string | null,
): Promise<{ status: number; bodyText: string; signed: boolean }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'geoCon-Webhook/1.0',
  };
  let signed = false;
  if (signingSecret && signingSecret.length > 0) {
    const sig = await signHmac(signingSecret, body);
    headers['X-Consultegeo-Signature'] = `sha256=${sig}`;
    headers['X-Consultegeo-Timestamp'] = new Date().toISOString();
    signed = true;
  }
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    const bodyText = await res.text();
    return { status: res.status, bodyText: bodyText.slice(0, 400), signed };
  } finally {
    clearTimeout(t);
  }
}

/* ---------- Handler ---------- */

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  try {
    if (req.method !== 'POST') return failResp('Use POST', 405);
    const body = await req.json().catch(() => ({}));
    const broadcastId = body?.broadcast_id as string | undefined;
    const testWebhookId = body?.test_webhook_id as string | undefined;

    if (!broadcastId && !testWebhookId) {
      return failResp('broadcast_id ou test_webhook_id obrigatório');
    }

    const supa = getServiceClient();

    /* ---------- MODO TESTE ---------- */
    if (testWebhookId) {
      const { data: wRow, error: wErr } = await supa
        .from('tenant_webhooks').select('*').eq('id', testWebhookId).maybeSingle();
      if (wErr) return failResp(wErr.message);
      if (!wRow) return failResp('Webhook não encontrado', 404);

      const { data: tenantRow } = await supa.from('tenants').select('nome').eq('id', wRow.tenant_id).maybeSingle();
      const tenantName = tenantRow?.nome || 'Tenant';

      const synth: Broadcast = {
        id: '00000000-0000-0000-0000-000000000000',
        tenant_id: wRow.tenant_id,
        sender_id: '00000000-0000-0000-0000-000000000000',
        title: '[Teste] Webhook configurado com sucesso',
        body: `Este é um payload de teste enviado pelo geoCon para o webhook "${wRow.label}". Se você está vendo essa mensagem no seu canal, a integração está funcionando.`,
        kind: 'info',
        action_url: '/admin/webhooks',
        total_sent: 0,
        filter_roles: null,
        filter_contract_id: null,
        filter_member_ids: null,
        created_at: new Date().toISOString(),
      };
      const payload = buildPayload(wRow as Webhook, synth, 'geoCon (teste)', tenantName);
      let status = 'ok';
      let respCode = 0;
      let errText: string | null = null;
      let wasSigned = false;
      try {
        const r = await postWebhook(wRow.url, payload, wRow.signing_secret || null);
        respCode = r.status;
        wasSigned = r.signed;
        if (r.status >= 400) {
          status = 'error';
          errText = `HTTP ${r.status}: ${r.bodyText}`;
        }
      } catch (err) {
        status = 'error';
        errText = err instanceof Error ? err.message : String(err);
      }
      await supa.rpc('record_webhook_dispatch', {
        p_webhook_id: wRow.id,
        p_broadcast_id: null,
        p_event: 'broadcast_sent.test',
        p_status: status,
        p_response_code: respCode || null,
        p_error_text: errText,
        p_payload_preview: JSON.stringify(payload).slice(0, 300),
        p_signed: wasSigned,
      });
      return ok({ test: true, status, response_code: respCode, error: errText, signed: wasSigned });
    }

    /* ---------- MODO REAL ---------- */
    const { data: bRow, error: bErr } = await supa
      .from('notification_broadcasts').select('*').eq('id', broadcastId).maybeSingle();
    if (bErr) return failResp(bErr.message);
    if (!bRow) return failResp('Broadcast não encontrado', 404);

    const b: Broadcast = {
      id: bRow.id,
      tenant_id: bRow.tenant_id,
      sender_id: bRow.sender_id,
      title: bRow.title,
      body: bRow.body,
      kind: bRow.kind || 'info',
      action_url: bRow.action_url,
      total_sent: bRow.total_sent || 0,
      filter_roles: bRow.filter_roles,
      filter_contract_id: bRow.filter_contract_id,
      filter_member_ids: bRow.filter_member_ids,
      created_at: bRow.created_at,
    };

    const { data: hooks, error: hErr } = await supa.rpc('list_webhooks_for_event', {
      p_tenant_id: b.tenant_id,
      p_event: 'broadcast_sent',
    });
    if (hErr) return failResp(hErr.message);
    if (!hooks || hooks.length === 0) {
      return ok({ dispatched: 0, results: [], note: 'nenhum webhook inscrito' });
    }

    const { data: senderRow } = await supa.from('members').select('nome').eq('id', b.sender_id).maybeSingle();
    const { data: tenantRow } = await supa.from('tenants').select('nome').eq('id', b.tenant_id).maybeSingle();
    const senderName = senderRow?.nome || 'admin';
    const tenantName = tenantRow?.nome || 'Tenant';

    const results: Array<{ webhook_id: string; label: string; kind: string; status: string; response_code: number | null; error: string | null; signed: boolean }> = [];
    for (const w of hooks as Webhook[]) {
      const payload = buildPayload(w, b, senderName, tenantName);
      let status = 'ok';
      let respCode: number | null = null;
      let errText: string | null = null;
      let wasSigned = false;
      try {
        const r = await postWebhook(w.url, payload, w.signing_secret || null);
        respCode = r.status;
        wasSigned = r.signed;
        if (r.status >= 400) {
          status = 'error';
          errText = `HTTP ${r.status}: ${r.bodyText}`;
        }
      } catch (err) {
        status = 'error';
        errText = err instanceof Error ? err.message : String(err);
      }
      await supa.rpc('record_webhook_dispatch', {
        p_webhook_id: w.id,
        p_broadcast_id: b.id,
        p_event: 'broadcast_sent',
        p_status: status,
        p_response_code: respCode,
        p_error_text: errText,
        p_payload_preview: JSON.stringify(payload).slice(0, 300),
        p_signed: wasSigned,
      });
      results.push({ webhook_id: w.id, label: w.label, kind: w.kind, status, response_code: respCode, error: errText, signed: wasSigned });
    }

    const okCount = results.filter((r) => r.status === 'ok').length;
    const errCount = results.filter((r) => r.status === 'error').length;
    const signedCount = results.filter((r) => r.signed).length;

    return ok({
      dispatched: results.length,
      ok_count: okCount,
      error_count: errCount,
      signed_count: signedCount,
      results,
    });
  } catch (err) {
    return serverError(err);
  }
});
