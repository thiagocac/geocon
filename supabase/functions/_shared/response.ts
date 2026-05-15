import { corsHeaders } from './cors.ts';

const JSON_HEADERS = {
  ...corsHeaders,
  'Content-Type': 'application/json',
};

export function ok<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, ...(data as Record<string, unknown>) }), {
    status,
    headers: JSON_HEADERS,
  });
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: false, error: message, ...(extra || {}) }), {
    status,
    headers: JSON_HEADERS,
  });
}

export function unauthorized(message = 'Não autenticado'): Response {
  return fail(message, 401);
}

export function notFound(message = 'Não encontrado'): Response {
  return fail(message, 404);
}

export function serverError(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[edge function error]', message);
  return fail(message, 500);
}
