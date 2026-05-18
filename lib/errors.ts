/**
 * Traduz erros do Supabase / Postgres em mensagens legíveis para o usuário final em pt-BR.
 * Alinhado com o padrão usado no geoRDO (lib/errors).
 */

interface SupabaseErrorLike {
  message?: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

const PG_FRIENDLY: Record<string, string> = {
  '23505': 'Já existe um registro com esses dados.',
  '23503': 'Operação inválida: este item está referenciado por outros registros.',
  '23502': 'Campo obrigatório não foi preenchido.',
  '23514': 'Valor fora da regra permitida.',
  '22P02': 'Formato inválido para um dos campos.',
  '42501': 'Você não tem permissão para executar esta ação.',
  'PGRST301': 'Você não tem permissão para acessar este recurso.',
  'PGRST116': 'Registro não encontrado.',
};

const MESSAGE_PATTERNS: Array<[RegExp, string]> = [
  [/JWT/i,                          'Sua sessão expirou. Entre novamente.'],
  [/duplicate key/i,                'Já existe um registro com esses dados.'],
  [/violates foreign key/i,         'Operação inválida: este item está vinculado a outros registros.'],
  [/violates not-null/i,            'Campo obrigatório não foi preenchido.'],
  [/violates check constraint/i,    'Valor fora da regra permitida.'],
  [/violates row-level security/i,  'Você não tem permissão para esta ação.'],
  [/network|failed to fetch/i,      'Falha de rede. Verifique sua conexão e tente novamente.'],
  [/rate limit/i,                   'Muitas requisições. Aguarde alguns segundos.'],
  [/SOV travada/i,                  'Planilha bloqueada: alterações somente via aditivo.'],
  [/Contrato sem planilha SOV/i,    'Contrato ainda não tem planilha cadastrada.'],
  [/Contrato n[ãa]o encontrado/i,   'Contrato não encontrado.'],
  [/Medi[çc][ãa]o n[ãa]o encontrada/i, 'Medição não encontrada.'],
];

export function humanizeError(err: unknown): string {
  if (!err) return 'Erro desconhecido';
  if (typeof err === 'string') return err;

  const e = err as SupabaseErrorLike;

  if (e.code && PG_FRIENDLY[e.code]) return PG_FRIENDLY[e.code];

  if (e.message) {
    for (const [re, friendly] of MESSAGE_PATTERNS) {
      if (re.test(e.message)) return friendly;
    }
    if (e.details) return `${e.message} — ${e.details}`;
    return e.message;
  }

  if (e.details) return e.details;

  try {
    return JSON.stringify(err);
  } catch {
    return 'Erro desconhecido';
  }
}

/**
 * Sanitiza URLs externas para uso em window.open / <a href>.
 * Permite apenas http(s) e mailto:, rejeita javascript: e data:.
 */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  // Bloqueia esquemas perigosos
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return null;
  // Permite somente http, https e mailto
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  // Sem schema → assume https
  if (/^[a-zA-Z0-9-]+\./.test(trimmed)) return `https://${trimmed}`;
  return null;
}
