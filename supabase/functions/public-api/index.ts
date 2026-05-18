/**
 * public-api — REST endpoints externos para integração com sistemas terceiros.
 *
 * Auth: Authorization: Bearer gck_live_<prefix>_<secret>
 * Scopes controlam acesso por endpoint:
 *   suppliers:check — POST /suppliers/check
 *   suppliers:read  — GET  /suppliers/sanctioned
 *
 * Endpoints públicos (sem auth):
 *   GET /health
 *   GET /openapi
 *
 * Erros padronizados:
 *   401 — sem Authorization, formato inválido, ou chave revogada/expirada/inválida
 *   403 — chave válida mas sem o escopo necessário
 *   404 — rota desconhecida
 *   422 — payload inválido (body parsing, campo obrigatório ausente)
 *   500 — erro interno
 *
 * Todas as respostas em JSON: { ok: true|false, error?: string, ... }
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, unauthorized, notFound, serverError } from '../_shared/response.ts';

interface VerifiedKey {
  id: string;
  tenant_id: string;
  name: string;
  scopes: string[];
}

/**
 * Parses Bearer token e retorna prefix + secret. Retorna null se formato inválido.
 */
function parseBearer(req: Request): { prefix: string; secret: string } | null {
  const auth = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  // Formato: gck_live_<8-hex>_<32-hex>
  const parts = token.split('_');
  if (parts.length !== 4) return null;
  if (parts[0] !== 'gck' || parts[1] !== 'live') return null;
  const prefix = parts[2];
  const secret = parts[3];
  if (!/^[a-f0-9]{8}$/i.test(prefix)) return null;
  if (!/^[a-f0-9]{32}$/i.test(secret)) return null;
  return { prefix, secret };
}

async function verifyKey(svc: ReturnType<typeof getServiceClient>, req: Request): Promise<VerifiedKey | null> {
  const parsed = parseBearer(req);
  if (!parsed) return null;
  const { data, error } = await svc.rpc('verify_api_key', {
    p_prefix: parsed.prefix,
    p_secret: parsed.secret,
  });
  if (error) {
    console.error('[public-api] verify_api_key error:', error);
    return null;
  }
  if (!data) return null;
  return data as VerifiedKey;
}

function requireScope(key: VerifiedKey, scope: string): Response | null {
  if (!key.scopes.includes(scope)) {
    return fail(`Esta chave não possui o escopo "${scope}". Adicione-o em /admin/api-keys.`, 403);
  }
  return null;
}

function getPath(req: Request): string {
  // URL completa: https://xxx.supabase.co/functions/v1/public-api/...
  // Queremos o path após /public-api
  const url = new URL(req.url);
  let path = url.pathname;
  const fnRoot = '/public-api';
  const idx = path.indexOf(fnRoot);
  if (idx >= 0) path = path.slice(idx + fnRoot.length);
  return path || '/';
}

// =============================================================================
// Endpoints
// =============================================================================

const OPENAPI_DOC = {
  openapi: '3.0.0',
  info: {
    title: 'GeoCon — Public API',
    description: 'Superfície REST para consulta de dados do GeoCon por sistemas terceiros (licitação, ERPs, controles externos).',
    version: '1.0.0',
  },
  components: {
    securitySchemes: {
      ApiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'gck_live_*' },
    },
  },
  security: [{ ApiKey: [] }],
  paths: {
    '/health': {
      get: {
        summary: 'Liveness check (sem autenticação)',
        responses: { '200': { description: 'OK' } },
        security: [],
      },
    },
    '/openapi': {
      get: { summary: 'Este documento OpenAPI', responses: { '200': { description: 'OK' } }, security: [] },
    },
    '/suppliers/check': {
      post: {
        summary: 'Verifica se um CNPJ está bloqueado para contratação no tenant',
        description: 'Retorna pode_contratar=false se há impedimento ou inidoneidade ATIVOS. Advertência e multa não bloqueiam (Lei 14.133 art. 156).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['cnpj'], properties: { cnpj: { type: 'string' } } },
            },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    cnpj: { type: 'string' },
                    nome: { type: 'string' },
                    found: { type: 'boolean' },
                    pode_contratar: { type: 'boolean' },
                    severidade: { type: 'string', enum: ['critica', 'alta', 'media', 'baixa', 'nenhuma'] },
                    motivo_bloqueio: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
        'x-scope': 'suppliers:check',
      },
    },
    '/suppliers/sanctioned': {
      get: {
        summary: 'Lista fornecedores com sanções no tenant',
        parameters: [
          { name: 'severidade', in: 'query', schema: { type: 'string' }, description: 'Lista CSV: critica,alta,media,baixa' },
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Lista CSV: ativo,historico' },
          { name: 'only_with_active', in: 'query', schema: { type: 'boolean' }, description: 'Apenas com impedimento/inidoneidade ativos' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 200, maximum: 500 } },
        ],
        responses: { '200': { description: 'OK' } },
        'x-scope': 'suppliers:read',
      },
    },
  },
};

// =============================================================================
// Handler principal
// =============================================================================
serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const path = getPath(req);
    const svc = getServiceClient();

    // ---------- Endpoints públicos ----------
    if (path === '/health' || path === '/health/') {
      return ok({
        status: 'ok',
        timestamp: new Date().toISOString(),
        api_version: '1.0.0',
      });
    }

    if (path === '/openapi' || path === '/openapi/' || path === '/openapi.json') {
      return new Response(JSON.stringify(OPENAPI_DOC, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // ---------- Endpoints autenticados ----------
    const key = await verifyKey(svc, req);
    if (!key) {
      return unauthorized('Chave de API inválida, expirada ou ausente. Envie Authorization: Bearer gck_live_<...>');
    }

    // Roteamento
    if (path === '/suppliers/check' || path === '/suppliers/check/') {
      if (req.method !== 'POST') return fail('Método não permitido (use POST)', 405);

      const scopeFail = requireScope(key, 'suppliers:check');
      if (scopeFail) return scopeFail;

      let body: { cnpj?: string };
      try {
        body = await req.json();
      } catch {
        return fail('Body JSON inválido', 422);
      }

      if (!body.cnpj || typeof body.cnpj !== 'string') {
        return fail('Campo "cnpj" obrigatório (string)', 422);
      }

      // Normaliza CNPJ (remove pontuação)
      const cnpjNorm = body.cnpj.replace(/\D/g, '');
      if (cnpjNorm.length !== 14) {
        return fail('CNPJ deve ter 14 dígitos', 422);
      }

      const { data, error } = await svc.rpc('check_cnpj_sanctioned_external', {
        p_tenant_id: key.tenant_id,
        p_cnpj: cnpjNorm,
      });

      if (error) {
        console.error('[public-api] check error:', error);
        return serverError(error.message);
      }

      // touch last_used (fire-and-forget)
      svc.rpc('touch_api_key_last_used', { p_id: key.id }).then(() => {});

      return ok({ ...data });
    }

    if (path === '/suppliers/sanctioned' || path === '/suppliers/sanctioned/') {
      if (req.method !== 'GET') return fail('Método não permitido (use GET)', 405);

      const scopeFail = requireScope(key, 'suppliers:read');
      if (scopeFail) return scopeFail;

      const url = new URL(req.url);
      const severidade = url.searchParams.get('severidade')?.split(',').map((s) => s.trim()).filter(Boolean) || null;
      const status     = url.searchParams.get('status')?.split(',').map((s) => s.trim()).filter(Boolean) || null;
      const onlyActive = url.searchParams.get('only_with_active') === 'true';
      const limitRaw   = parseInt(url.searchParams.get('limit') || '200', 10);
      const limit      = Math.max(1, Math.min(isNaN(limitRaw) ? 200 : limitRaw, 500));

      const { data, error } = await svc.rpc('list_sanctioned_suppliers_external', {
        p_tenant_id:        key.tenant_id,
        p_severidade:       severidade,
        p_status:           status,
        p_only_with_active: onlyActive,
        p_limit:            limit,
      });

      if (error) {
        console.error('[public-api] list error:', error);
        return serverError(error.message);
      }

      svc.rpc('touch_api_key_last_used', { p_id: key.id }).then(() => {});

      return ok({
        suppliers: data || [],
        count: (data || []).length,
        tenant_id: key.tenant_id,
        filters: { severidade, status, only_with_active: onlyActive, limit },
      });
    }

    return notFound(`Rota não encontrada: ${path}. Consulte GET /openapi para endpoints disponíveis.`);
  } catch (e) {
    return serverError(e);
  }
});
