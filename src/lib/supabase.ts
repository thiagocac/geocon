import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Configuração resolvida em RUNTIME (preferida) com fallback para
 * variáveis de build-time. Isso permite distribuir o build pronto
 * (Netlify Drop, S3, etc.) e configurar o backend depois editando
 * apenas /config.js, sem rebuildar o bundle.
 */
interface RuntimeConfig {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SITE_URL?: string;
  IDENTITY_HUB_URL?: string;
  PRODUCT_NAME?: string;
  PRODUCT_LONG_NAME?: string;
  /** Quando true, pula autenticação e usa dados mock. Apenas para demo/preview. */
  SKIP_AUTH?: boolean;
}

declare global {
  interface Window {
    GEOCON_CONFIG?: RuntimeConfig;
  }
}

const runtime: RuntimeConfig = (typeof window !== 'undefined' && window.GEOCON_CONFIG) || {};

const url = runtime.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
const anonKey = runtime.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Indica se o cliente Supabase está apontando para um projeto real.
 * Validamos não só presença, mas formato mínimo: URL https + key > 30 chars
 * sem placeholders (`REPLACE_WITH_*`, `<...>`).
 */
export const hasSupabase: boolean = (() => {
  if (!url || !anonKey) return false;
  if (typeof url !== 'string' || typeof anonKey !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('<') || url.includes('>')) return false;
  if (anonKey.length < 30) return false;
  if (anonKey.includes('<') || anonKey.includes('>')) return false;
  if (anonKey.toUpperCase().includes('REPLACE_WITH')) return false;
  return true;
})();

export const supabase: SupabaseClient = createClient(
  hasSupabase ? url : 'http://localhost:54321',
  hasSupabase ? anonKey : 'public-anon-stub',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      storageKey: 'sb-geocon-auth',
      flowType: 'pkce',
    },
    db: { schema: 'public' },
    global: { headers: { 'x-product': 'geocon' } },
  },
);

/**
 * Modo DEMO: pula login e usa dados mock. Configurado em /config.js.
 * Quando true, useAuth devolve um Member falso e api.ts retorna mocks.
 */
export const SKIP_AUTH: boolean = runtime.SKIP_AUTH === true;

if (!hasSupabase && !SKIP_AUTH && typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.warn(
    '[geoCon] Backend não configurado. Edite /config.js e preencha SUPABASE_ANON_KEY, ou ative SKIP_AUTH: true para o modo demo.',
  );
}

if (SKIP_AUTH && typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.info('[geoCon] Modo DEMO ativo (SKIP_AUTH=true). Dados mockados, sem backend real.');
}

export const IDENTITY_HUB_URL =
  runtime.IDENTITY_HUB_URL || import.meta.env.VITE_IDENTITY_HUB_URL || 'https://app.consultegeo.org';

export const SITE_URL =
  runtime.SITE_URL || import.meta.env.VITE_SITE_URL || 'https://contratos.consultegeo.org';

export const PRODUCT_NAME =
  runtime.PRODUCT_NAME || import.meta.env.VITE_PRODUCT_NAME || 'geoCon';

export const PRODUCT_LONG_NAME =
  runtime.PRODUCT_LONG_NAME || import.meta.env.VITE_PRODUCT_LONG_NAME || 'Consulte GEO — Gestão de Contratos';
