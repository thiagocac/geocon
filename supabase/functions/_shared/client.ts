import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

/**
 * Cliente com a SERVICE_ROLE_KEY (bypassa RLS) — use APENAS quando
 * a função precisa operar com privilégios elevados, como ao gravar
 * snapshots, processar webhooks ou recalcular dados de outros usuários.
 */
export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !key) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Cliente vinculado ao token JWT do usuário (respeita RLS).
 * Use quando a operação deve obedecer às políticas do tenant ativo.
 */
export function getUserClient(req: Request): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const auth = req.headers.get('Authorization') || '';
  return createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Tenta resolver o auth_id do usuário a partir do JWT. */
export async function getAuthUser(req: Request) {
  const supa = getUserClient(req);
  const { data, error } = await supa.auth.getUser();
  if (error || !data?.user) {
    throw new Error('Não autenticado');
  }
  return data.user;
}
