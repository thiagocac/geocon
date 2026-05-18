/**
 * drain-webhook-queue
 *
 * Drena `webhook_event_queue` (gravado por triggers de domínio). Para cada
 * evento devolvido pelo RPC `drain_webhook_queue` (que faz lock SKIP LOCKED +
 * attempts++):
 *
 *   1. Resolve webhooks ativos do tenant inscritos no event_type
 *   2. Constrói payload tonal: Slack Block Kit / Teams MessageCard / generic
 *   3. POSTa com HMAC se houver signing_secret
 *   4. Se TODOS os webhooks falham → nack (registra erro + agenda backoff)
 *      Se algum sucesso → ack (sucesso parcial ainda é considerado processado)
 *      Sem webhooks subscritos → ack (no-op, limpa fila)
 *
 * Service_role only. Idempotente. Designed pra ser chamada a cada 1 min via
 * pg_cron (configurado pela migration 032, parte C).
 *
 * POST {} ou { limit: 100 }
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail as failResp, serverError } from '../_shared/response.ts';

const SITE_URL = Deno.env.get('SITE_URL') || 'https://contratos.consultegeo.org';
const FETCH_TIMEOUT_MS = 10_000;

interface QueueRow {
  id: string;
  tenant_id: string;
  event: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  enqueued_at: string;
  attempts: number;
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
      'User-Agent': 'geoCon-Webhook/1.0',
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

/* ---------- Payload builders por evento ---------- */

interface EventCtx {
  event: string;
  payload: Record<string, unknown>;
  tenantName: string;
  enqueuedAt: string;
}

function fmtBRL(n: unknown): string {
  const num = Number(n);
  if (!isFinite(num)) return '—';
  return `R$ ${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function eventTitle(ctx: EventCtx): string {
  if (ctx.event === 'risk_critico_changed') {
    return `🚨 Risco crítico: contrato ${ctx.payload.contract_numero}`;
  }
  if (ctx.event === 'measurement_decided') {
    return `📋 Medição ${ctx.payload.numero} do contrato ${ctx.payload.contract_numero} → ${ctx.payload.status_after}`;
  }
  if (ctx.event === 'measurement_emitted') {
    return `📝 Medição ${ctx.payload.numero} emitida · contrato ${ctx.payload.contract_numero}`;
  }
  if (ctx.event === 'additive_approved') {
    return `✅ Aditivo ${ctx.payload.numero} aprovado · contrato ${ctx.payload.contract_numero}`;
  }
  if (ctx.event === 'unforeseen_pending') {
    return `⚠️ Item não previsto #${ctx.payload.numero} em análise · contrato ${ctx.payload.contract_numero}`;
  }
  if (ctx.event === 'digest_failed') {
    return `📨 Falha no digest diário para ${ctx.payload.member_email}`;
  }
  return `🔔 Evento ${ctx.event}`;
}

function eventBody(ctx: EventCtx): string {
  if (ctx.event === 'risk_critico_changed') {
    return `Score ${ctx.payload.score}/100 · Nível ${ctx.payload.nivel} (anterior: ${ctx.payload.previous_nivel}). ${ctx.payload.contract_objeto || ''}`.trim();
  }
  if (ctx.event === 'measurement_decided') {
    return `Período ${ctx.payload.periodo_inicio} a ${ctx.payload.periodo_fim} · Valor líquido ${fmtBRL(ctx.payload.valor_liquido)}`;
  }
  if (ctx.event === 'measurement_emitted') {
    return `Período ${ctx.payload.periodo_inicio} a ${ctx.payload.periodo_fim} · Valor líquido ${fmtBRL(ctx.payload.valor_liquido)} · Código público ${ctx.payload.public_validation_code}`;
  }
  if (ctx.event === 'additive_approved') {
    const dataStr = ctx.payload.data_aprovacao ? ` · Aprovado em ${ctx.payload.data_aprovacao}` : '';
    return `Tipo ${ctx.payload.tipo} · Valor líquido ${fmtBRL(ctx.payload.valor_liquido)}${dataStr}`;
  }
  if (ctx.event === 'unforeseen_pending') {
    return `${String(ctx.payload.descricao || '').slice(0, 200)} · Estimado ${fmtBRL(ctx.payload.valor_estimado)} · Impacto ${ctx.payload.prazo_impacto_dias || 0} dias`;
  }
  if (ctx.event === 'digest_failed') {
    return `${ctx.payload.member_nome} (${ctx.payload.member_email}) não recebeu o digest de ${ctx.payload.sent_date}. Erro: ${ctx.payload.error || 'desconhecido'}`;
  }
  return JSON.stringify(ctx.payload).slice(0, 300);
}

function actionLink(ctx: EventCtx): string {
  const base = SITE_URL.replace(/\/$/, '');
  if (ctx.event === 'risk_critico_changed') {
    return `${base}/contratos/${ctx.payload.contract_id}/risco`;
  }
  if (ctx.event === 'measurement_decided' || ctx.event === 'measurement_emitted') {
    return `${base}/contratos/${ctx.payload.contract_id}/medicoes/${ctx.payload.measurement_id}`;
  }
  if (ctx.event === 'additive_approved') {
    return `${base}/contratos/${ctx.payload.contract_id}/aditivos/${ctx.payload.additive_id}`;
  }
  if (ctx.event === 'unforeseen_pending') {
    return `${base}/contratos/${ctx.payload.contract_id}/itens-nao-previstos/${ctx.payload.unforeseen_id}`;
  }
  if (ctx.event === 'digest_failed') {
    return `${base}/admin/digests`;
  }
  return base;
}

function tone(event: string): { hex: string; label: string } {
  if (event === 'risk_critico_changed') return { hex: 'dc2626', label: 'CRÍTICO' };
  if (event === 'measurement_decided')  return { hex: '7e22ce', label: 'MEDIÇÃO' };
  if (event === 'measurement_emitted')  return { hex: '6366f1', label: 'EMISSÃO' };
  if (event === 'additive_approved')    return { hex: '059669', label: 'ADITIVO' };
  if (event === 'unforeseen_pending')   return { hex: 'f59e0b', label: 'NÃO PREVISTO' };
  if (event === 'digest_failed')        return { hex: 'dc2626', label: 'DIGEST FALHOU' };
  return { hex: '64748b', label: 'EVENTO' };
}

function slackPayload(ctx: EventCtx) {
  const t = tone(ctx.event);
  const link = actionLink(ctx);
  return {
    text: `*${eventTitle(ctx)}* — ${ctx.tenantName}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: eventTitle(ctx).slice(0, 130) } },
      { type: 'section', text: { type: 'mrkdwn', text: eventBody(ctx).slice(0, 600) } },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `*Tenant:* ${ctx.tenantName} · *Evento:* \`${ctx.event}\` · *Quando:* ${new Date(ctx.enqueuedAt).toLocaleString('pt-BR')}`,
        }],
      },
      {
        type: 'actions',
        elements: [{
          type: 'button',
          text: { type: 'plain_text', text: 'Abrir no geoCon' },
          url: link,
          style: ctx.event === 'risk_critico_changed' ? 'danger' : undefined,
        }],
      },
    ],
  };
}

function teamsPayload(ctx: EventCtx) {
  const t = tone(ctx.event);
  return {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor: t.hex,
    summary: eventTitle(ctx).slice(0, 120),
    title: eventTitle(ctx).slice(0, 150),
    text: eventBody(ctx).slice(0, 800),
    sections: [{
      facts: Object.entries(ctx.payload).slice(0, 8).map(([k, v]) => ({
        name: k,
        value: typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''),
      })),
    }],
    potentialAction: [{
      '@type': 'OpenUri',
      name: 'Abrir no geoCon',
      targets: [{ os: 'default', uri: actionLink(ctx) }],
    }],
  };
}

function genericDefaultPayload(ctx: EventCtx) {
  return {
    event: ctx.event,
    enqueued_at: ctx.enqueuedAt,
    tenant: { name: ctx.tenantName },
    title: eventTitle(ctx),
    body: eventBody(ctx),
    action_url: actionLink(ctx),
    payload: ctx.payload,
  };
}

/** Interpola um template JSON com placeholders {{ ... }} */
function genericTemplatedPayload(template: string, ctx: EventCtx): unknown {
  const vars: Record<string, string> = {
    event:       ctx.event,
    title:       eventTitle(ctx),
    body:        eventBody(ctx),
    action_url:  actionLink(ctx),
    tenant_name: ctx.tenantName,
    enqueued_at: ctx.enqueuedAt,
  };
  // Adiciona campos do payload com prefixo payload.<key>
  for (const [k, v] of Object.entries(ctx.payload)) {
    vars[`payload.${k}`] = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
  }

  const interpolated = template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key: string) => {
    return key in vars ? vars[key] : '';
  });

  try {
    return JSON.parse(interpolated);
  } catch {
    // template inválido — fallback pro padrão
    return genericDefaultPayload(ctx);
  }
}

function buildPayload(w: Webhook, ctx: EventCtx): unknown {
  if (w.kind === 'slack') return slackPayload(ctx);
  if (w.kind === 'teams') return teamsPayload(ctx);
  if (w.kind === 'generic' && w.payload_template) {
    return genericTemplatedPayload(w.payload_template, ctx);
  }
  return genericDefaultPayload(ctx);
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

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(200, Number(body?.limit ?? 50)));

    const supa = getServiceClient();

    const { data: events, error: drainErr } = await supa.rpc('drain_webhook_queue', { p_limit: limit });
    if (drainErr) return failResp(drainErr.message);
    if (!events || events.length === 0) {
      return ok({ drained: 0, dispatched: 0, errors: 0, results: [] });
    }

    // Cache de webhooks/tenants
    const webhooksByTenant = new Map<string, Webhook[]>();
    const tenantNames = new Map<string, string>();

    let dispatchedCount = 0;
    let errorCount = 0;
    const results: Array<{
      queue_id: string;
      event: string;
      tenant_id: string;
      webhooks: number;
      ok: number;
      error: number;
      attempts: number;
      outcome: 'ack' | 'nack' | 'noop';
    }> = [];

    for (const ev of events as QueueRow[]) {
      let tenantWebhooks = webhooksByTenant.get(ev.tenant_id);
      if (!tenantWebhooks) {
        const { data: rows } = await supa
          .from('tenant_webhooks')
          .select('id, tenant_id, label, kind, url, events, active, signing_secret, payload_template')
          .eq('tenant_id', ev.tenant_id)
          .eq('active', true);
        tenantWebhooks = (rows || []) as Webhook[];
        webhooksByTenant.set(ev.tenant_id, tenantWebhooks);
      }

      const matching = tenantWebhooks.filter((w) => w.events.includes(ev.event));

      if (matching.length === 0) {
        await supa.rpc('ack_webhook_event', { p_id: ev.id });
        results.push({
          queue_id: ev.id, event: ev.event, tenant_id: ev.tenant_id,
          webhooks: 0, ok: 0, error: 0, attempts: ev.attempts, outcome: 'noop',
        });
        continue;
      }

      let tenantName = tenantNames.get(ev.tenant_id);
      if (!tenantName) {
        const { data: tr } = await supa.from('tenants').select('nome').eq('id', ev.tenant_id).maybeSingle();
        tenantName = tr?.nome || 'Tenant';
        tenantNames.set(ev.tenant_id, tenantName);
      }

      const ctx: EventCtx = {
        event: ev.event,
        payload: ev.payload || {},
        tenantName,
        enqueuedAt: ev.enqueued_at,
      };

      let okHooks = 0;
      let errHooks = 0;
      let lastError: string | null = null;

      for (const w of matching) {
        const payload = buildPayload(w, ctx);
        try {
          const r = await postWebhook(w.url, payload, w.signing_secret);
          let status: 'ok' | 'error' = 'ok';
          let errText: string | null = null;
          if (r.status >= 400) {
            status = 'error';
            errText = `HTTP ${r.status}: ${r.bodyText}`;
            lastError = errText;
            errHooks++;
          } else {
            okHooks++;
          }
          await supa.rpc('record_webhook_dispatch', {
            p_webhook_id:      w.id,
            p_broadcast_id:    null,
            p_event:           ev.event,
            p_status:          status,
            p_response_code:   r.status,
            p_error_text:      errText,
            p_payload_preview: JSON.stringify(payload).slice(0, 300),
          });
        } catch (err) {
          errHooks++;
          const msg = err instanceof Error ? err.message : String(err);
          lastError = msg;
          await supa.rpc('record_webhook_dispatch', {
            p_webhook_id:      w.id,
            p_broadcast_id:    null,
            p_event:           ev.event,
            p_status:          'error',
            p_response_code:   null,
            p_error_text:      msg,
            p_payload_preview: JSON.stringify(payload).slice(0, 300),
          });
        }
      }

      dispatchedCount += okHooks;
      errorCount += errHooks;

      // Política: se pelo menos um webhook foi OK, considera processado (ack).
      // Se TODOS falharam → nack (registra erro + agenda backoff).
      let outcome: 'ack' | 'nack' = 'ack';
      if (okHooks === 0 && errHooks > 0) {
        await supa.rpc('nack_webhook_event', { p_id: ev.id, p_error: lastError });
        outcome = 'nack';
      } else {
        await supa.rpc('ack_webhook_event', { p_id: ev.id });
      }

      results.push({
        queue_id: ev.id, event: ev.event, tenant_id: ev.tenant_id,
        webhooks: matching.length, ok: okHooks, error: errHooks,
        attempts: ev.attempts, outcome,
      });
    }

    return ok({
      drained: events.length,
      dispatched: dispatchedCount,
      errors: errorCount,
      results,
    });
  } catch (err) {
    return serverError(err);
  }
});
