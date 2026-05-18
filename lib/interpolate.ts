/**
 * Espelha em JS a função SQL `interpolate_broadcast_text` (migration 027)
 * para gerar uma prévia em tempo real do que será enviado.
 *
 * Globais resolvidas: tenant_name, sender_name, sender_first, contract_numero,
 *                     contract_objeto, today, today_long.
 *
 * Per-user: user_name, user_first, user_email → marcadas com `__PLACEHOLDER__`
 *           para a UI distinguir vars que só são resolvidas no envio por e-mail.
 */

export interface InterpolateContext {
  tenant_name?: string;
  sender_name?: string;
  contract_numero?: string;
  contract_objeto?: string;
}

const WEEKDAYS_PT = [
  'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
  'Quinta-feira', 'Sexta-feira', 'Sábado',
];
const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function nowInSP(): Date {
  // Aproxima "America/Sao_Paulo" via Intl — não perfeito em transições de DST,
  // mas suficiente para a prévia (servidor é a fonte de verdade).
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const o: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') o[p.type] = p.value;
  return new Date(
    Number(o.year), Number(o.month) - 1, Number(o.day),
    Number(o.hour), Number(o.minute), Number(o.second),
  );
}

function formatToday(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function formatTodayLong(d: Date): string {
  return `${WEEKDAYS_PT[d.getDay()]}, ${d.getDate()} de ${MONTHS_PT[d.getMonth()]} de ${d.getFullYear()}`;
}

const PER_USER_TOKENS = ['user_name', 'user_first', 'user_email'] as const;

export interface InterpolateResult {
  text: string;
  hasPerUserVars: boolean;
  unknownTokens: string[];
}

export function interpolateBroadcastText(
  input: string,
  ctx: InterpolateContext,
): InterpolateResult {
  if (!input) return { text: '', hasPerUserVars: false, unknownTokens: [] };
  if (input.indexOf('{{') === -1) {
    return { text: input, hasPerUserVars: false, unknownTokens: [] };
  }

  const now = nowInSP();
  const tenantName    = ctx.tenant_name || '';
  const senderName    = ctx.sender_name || '';
  const senderFirst   = (senderName.split(' ')[0] || '').trim();
  const contractNum   = ctx.contract_numero || '';
  const contractObj   = ctx.contract_objeto || '';
  const today         = formatToday(now);
  const todayLong     = formatTodayLong(now);

  const GLOBALS: Record<string, string> = {
    tenant_name:     tenantName,
    sender_name:     senderName,
    sender_first:    senderFirst,
    contract_numero: contractNum,
    contract_objeto: contractObj,
    today,
    today_long:      todayLong,
  };

  const unknownTokens: string[] = [];
  let hasPerUserVars = false;

  const out = input.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_match, token: string) => {
    if (token in GLOBALS) return GLOBALS[token];
    if ((PER_USER_TOKENS as readonly string[]).includes(token)) {
      hasPerUserVars = true;
      return `\u0000PER_USER:${token}\u0000`; // sentinela pra UI marcar
    }
    if (!unknownTokens.includes(token)) unknownTokens.push(token);
    return `\u0000UNKNOWN:${token}\u0000`;
  });

  return { text: out, hasPerUserVars, unknownTokens };
}

/**
 * Quebra o texto interpolado em segmentos pra renderização tonal:
 *   - plain: texto normal
 *   - per_user: badge ambar com nome real exemplo (ex: "Ricardo")
 *   - unknown: badge red — variável desconhecida
 */
export type Segment =
  | { type: 'plain'; value: string }
  | { type: 'per_user'; token: 'user_name' | 'user_first' | 'user_email'; example: string }
  | { type: 'unknown'; token: string };

const PER_USER_EXAMPLES: Record<string, string> = {
  user_name:  'Maria Silva',
  user_first: 'Maria',
  user_email: 'maria.silva@email.com',
};

export function segmentInterpolated(text: string): Segment[] {
  if (!text) return [];
  const segments: Segment[] = [];
  const re = /\u0000(PER_USER|UNKNOWN):([a-zA-Z_][a-zA-Z0-9_]*)\u0000/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'plain', value: text.slice(lastIndex, match.index) });
    }
    const kind = match[1];
    const token = match[2];
    if (kind === 'PER_USER') {
      segments.push({
        type: 'per_user',
        token: token as 'user_name' | 'user_first' | 'user_email',
        example: PER_USER_EXAMPLES[token] || token,
      });
    } else {
      segments.push({ type: 'unknown', token });
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'plain', value: text.slice(lastIndex) });
  }
  return segments;
}
