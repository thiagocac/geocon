/**
 * dispatch-single-event
 *
 * Processa eventos de teste (event prefix 'test:') que admins criaram via RPC
 * `enqueue_webhook_test`. Cada um aponta para um webhook específico em
 * payload._test_target — diferente do drain normal que distribui pra todos
 * os webhooks subscritos do tenant.
 *
 * Use case: admin viu que um webhook falhou no dead-letter, consertou a URL,
 * e quer re-enviar o evento original PRA AQUELE webhook isoladamente
 * (não pros outros que já tiveram sucesso).
 *
 * Cron a cada minuto via pg_cron. Idempotente. Max 3 tentativas (cap menor
 * que o drain normal — testes não fazem sentido em backoff longo).
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail as failResp, serverError } from '../_shared/response.ts';

const FETCH_TIMEOUT_MS = 10_000;
const SITE_URL = Deno.env.get('SITE_URL') || 'https://contratos.consultegeo.org';

interface TestEvent {
  id: string;
  tenant_id: string;
  event: string;             // 'test:<original_event>'
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  enqueued_at: string;
  attempts: number;
  target_webhook: string;
}

interface Webhook {
  id: string;
  tenant_id: string;
  label: string;
  kind: 'slack' | 'teams' | 'generic';
  url: string;
  signing_secret: string | null;
  payload_template: string | null;
  active: boolean;
}

/* ---------- HMAC ---------- */
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function postWebhook(
  url: string, payload: unknown, signingSecret: string | null,
): Promise<{ status: number; bodyText: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const bodyStr = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'geoCon-Webhook/1.0 (test)',
    };
    if (signingSecret) {
      const sig = await hmacSha256Hex(signingSecret, bodyStr);
      headers['X-Consultegeo-Signature'] = `sha256=${sig}`;
      headers['X-Consultegeo-Timestamp'] = new Date().toISOString();
    }
    const res = await fetch(url, { method: 'POST', headers, body: bodyStr, signal: controller.signal });
    return { status: res.status, bodyText: (await res.text()).slice(0, 400) };
  } finally {
    clearTimeout(t);
  }
}

/* ---------- Payload builders (replicado do drain-webhook-queue) ---------- */

function fmtBRL(n: unknown): string {
  const num = Number(n);
  if (!isFinite(num)) return '—';
  return `R$ ${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function originalEvent(testEvent: string): string {
  return testEvent.startsWith('test:') ? testEvent.slice(5) : testEvent;
}

function eventTitle(testEvent: string, payload: Record<string, unknown>, tenantName: string): string {
  const ev = originalEvent(testEvent);
  const prefix = '[TESTE] ';
  if (ev === 'risk_critico_changed') return `${prefix}🚨 Risco crítico: contrato ${payload.contract_numero}`;
  if (ev === 'measurement_emitted')  return `${prefix}📝 Medição ${payload.numero} emitida · contrato ${payload.contract_numero}`;
  if (ev === 'measurement_decided')  return `${prefix}📋 Medição ${payload.numero} do contrato ${payload.contract_numero} → ${payload.status_after}`;
  if (ev === 'additive_approved')    return `${prefix}✅ Aditivo ${payload.numero} aprovado · contrato ${payload.contract_numero}`;
  if (ev === 'unforeseen_pending')   return `${prefix}⚠️ Item não previsto #${payload.numero} em análise · contrato ${payload.contract_numero}`;
  if (ev === 'digest_failed')        return `${prefix}📨 Falha no digest diário para ${payload.member_email}`;
  if (ev === 'broadcast_sent')       return `${prefix}📣 Broadcast: ${payload.title}`;
  return `${prefix}Evento ${ev}`;
}

function actionLink(testEvent: string, payload: Record<string, unknown>): string {
  const base = SITE_URL.replace(/\/$/, '');
  const ev = originalEvent(testEvent);
  if (ev === 'risk_critico_changed') return `${base}/contratos/${payload.contract_id}/risco`;
  if (ev === 'measurement_emitted' || ev === 'measurement_decided') return `${base}/contratos/${payload.contract_id}/medicoes/${payload.measurement_id}`;
  if (ev === 'additive_approved')    return `${base}/contratos/${payload.contract_id}/aditivos/${payload.additive_id}`;
  if (ev === 'unforeseen_pending')   return `${base}/contratos/${payload.contract_id}/itens-nao-previstos/${payload.unforeseen_id}`;
  if (ev === 'digest_failed')        return `${base}/admin/digests`;
  return base;
}

function slackPayload(testEvent: string, payload: Record<string, unknown>, tenantName: string, enqueuedAt: string) {
  return {
    text: `*${eventTitle(testEvent, payload, tenantName)}* — ${tenantName}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: eventTitle(testEvent, payload, tenantName).slice(0, 130) },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '⚠️ *Este é um re-envio de teste* disparado por um admin.\n\nPayload original abaixo.',
        },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `\`\`\`${JSON.stringify(payload, null, 2).slice(0, 2000)}\`\`\`` },
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `*Tenant:* ${tenantName} · *Evento original:* \`${originalEvent(testEvent)}\` · *Re-enviado em:* ${new Date(enqueuedAt).toLocaleString('pt-BR')}`,
        }],
      },
    ],
  };
}

function teamsPayload(testEvent: string, payload: Record<string, unknown>, tenantName: string) {
  return {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor: 'f59e0b',
    summary: eventTitle(testEvent, payload, tenantName).slice(0, 120),
    title: eventTitle(testEvent, payload, tenantName).slice(0, 150),
    text: 'Este é um re-envio de teste disparado por um admin.',
    sections: [{
      activityTitle: 'Payload original',
      text: '```\n' + JSON.stringify(payload, null, 2).slice(0, 2000) + '\n```',
    }],
    potentialAction: [{
      '@type': 'OpenUri',
      name: 'Abrir no geoCon',
      targets: [{ os: 'default', uri: actionLink(testEvent, payload) }],
    }],
  };
}

function genericPayload(testEvent: string, payload: Record<string, unknown>, tenantName: string, enqueuedAt: string) {
  return {
    event:        originalEvent(testEvent),
    is_test:      true,
    enqueued_at:  enqueuedAt,
    tenant:       { name: tenantName },
    title:        eventTitle(testEvent, payload, tenantName),
    action_url:   actionLink(testEvent, payload),
    payload,
  };
}

function buildTestPayload(w: Webhook, ev: TestEvent, tenantName: string): unknown {
  // V28: NÃO interpola payload_template em testes (admin pode estar testando exatamente
  // o caso "template inválido"). Mostra payload bruto + marcação clara de teste.
  if (w.kind === 'slack') return slackPayload(ev.event, ev.payload, tenantName, ev.enqueued_at);
  if (w.kind === 'teams') return teamsPayload(ev.event, ev.payload, tenantName);
  return genericPayload(ev.event, ev.payload, tenantName, ev.enqueued_at);
}

/* ---------- Handler ---------- */

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  try {
    if (req.method !== 'POST') return failResp('Use POST', 405);

    const auth = req.headers.get('Authorization') || '';
    const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!auth.includes(svcKey)) {
      return failResp('Requer service_role', 401);
    }

    const supa = getServiceClient();

    const { data: events, error: drainErr } = await supa.rpc('claim_test_dispatch');
    if (drainErr) return failResp(drainErr.message);
    if (!events || events.length === 0) {
      return ok({ drained: 0, results: [] });
    }

    const webhooksById = new Map<string, Webhook>();
    const tenantNames = new Map<string, string>();
    const results: Array<{
      queue_id: string;
      event: string;
      target_webhook: string;
      ok: boolean;
      status_code: number | null;
      error: string | null;
    }> = [];

    for (const ev of events as TestEvent[]) {
      // Lookup webhook alvo
      let w = webhooksById.get(ev.target_webhook);
      if (!w) {
        const { data } = await supa
          .from('tenant_webhooks')
          .select('id, tenant_id, label, kind, url, signing_secret, payload_template, active')
          .eq('id', ev.target_webhook)
          .maybeSingle();
        w = (data as Webhook) || null as unknown as Webhook;
        if (w) webhooksById.set(w.id, w);
      }

      if (!w || w.tenant_id !== ev.tenant_id) {
        await supa.rpc('nack_webhook_event', { p_id: ev.id, p_error: 'Target webhook não encontrado ou inativo' });
        results.push({
          queue_id: ev.id, event: ev.event, target_webhook: ev.target_webhook,
          ok: false, status_code: null, error: 'webhook not found',
        });
        continue;
      }
      if (!w.active) {
        await supa.rpc('nack_webhook_event', { p_id: ev.id, p_error: 'Target webhook está pausado' });
        results.push({
          queue_id: ev.id, event: ev.event, target_webhook: ev.target_webhook,
          ok: false, status_code: null, error: 'webhook paused',
        });
        continue;
      }

      // Tenant name
      let tenantName = tenantNames.get(ev.tenant_id);
      if (!tenantName) {
        const { data: tr } = await supa.from('tenants').select('nome').eq('id', ev.tenant_id).maybeSingle();
        tenantName = tr?.nome || 'Tenant';
        tenantNames.set(ev.tenant_id, tenantName);
      }

      const payload = buildTestPayload(w, ev, tenantName);

      try {
        const r = await postWebhook(w.url, payload, w.signing_secret);
        const isOk = r.status < 400;
        if (isOk) {
          await supa.rpc('ack_webhook_event', { p_id: ev.id });
        } else {
          await supa.rpc('nack_webhook_event', {
            p_id: ev.id,
            p_error: `HTTP ${r.status}: ${r.bodyText}`,
          });
        }

        await supa.rpc('record_webhook_dispatch', {
          p_webhook_id:      w.id,
          p_broadcast_id:    null,
          p_event:           ev.event,  // mantém prefixo "test:" no log
          p_status:          isOk ? 'ok' : 'error',
          p_response_code:   r.status,
          p_error_text:      isOk ? null : `HTTP ${r.status}: ${r.bodyText}`,
          p_payload_preview: JSON.stringify(payload).slice(0, 300),
        });

        results.push({
          queue_id: ev.id, event: ev.event, target_webhook: ev.target_webhook,
          ok: isOk, status_code: r.status, error: isOk ? null : r.bodyText.slice(0, 200),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await supa.rpc('nack_webhook_event', { p_id: ev.id, p_error: msg });
        await supa.rpc('record_webhook_dispatch', {
          p_webhook_id:      w.id,
          p_broadcast_id:    null,
          p_event:           ev.event,
          p_status:          'error',
          p_response_code:   null,
          p_error_text:      msg,
          p_payload_preview: JSON.stringify(payload).slice(0, 300),
        });
        results.push({
          queue_id: ev.id, event: ev.event, target_webhook: ev.target_webhook,
          ok: false, status_code: null, error: msg,
        });
      }
    }

    return ok({ drained: events.length, results });
  } catch (err) {
    return serverError(err);
  }
});
