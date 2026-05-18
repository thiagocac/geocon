/**
 * Mapeamento de status (medições, contratos, aditivos, GED) para estilos visuais.
 */

export type BadgeTone = 'slate' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'magenta';

interface StatusStyle {
  label: string;
  tone: BadgeTone;
}

/** Status de medição — alinhado com migration 001 */
export const MEASUREMENT_STATUS: Record<string, StatusStyle> = {
  rascunho:    { label: 'Rascunho',     tone: 'slate' },
  preliminar:  { label: 'Preliminar',   tone: 'slate' },
  enviada:     { label: 'Enviada',      tone: 'blue' },
  em_revisao:  { label: 'Em revisão',   tone: 'yellow' },
  devolvida:   { label: 'Devolvida',    tone: 'red' },
  aprovada:    { label: 'Aprovada',     tone: 'green' },
  emitida:     { label: 'Emitida',      tone: 'green' },
  paga:        { label: 'Paga',         tone: 'purple' },
  cancelada:   { label: 'Cancelada',    tone: 'slate' },
  retificada:  { label: 'Retificada',   tone: 'yellow' },
  complementar:{ label: 'Complementar', tone: 'magenta' },
};

export const CONTRACT_STATUS: Record<string, StatusStyle> = {
  rascunho:    { label: 'Rascunho',    tone: 'slate' },
  licitacao:   { label: 'Licitação',   tone: 'blue' },
  contratado:  { label: 'Contratado',  tone: 'blue' },
  em_execucao: { label: 'Em execução', tone: 'green' },
  suspenso:    { label: 'Suspenso',    tone: 'yellow' },
  concluido:   { label: 'Concluído',   tone: 'purple' },
  rescindido:  { label: 'Rescindido',  tone: 'red' },
  arquivado:   { label: 'Arquivado',   tone: 'slate' },
};

export const ADDITIVE_STATUS: Record<string, StatusStyle> = {
  rascunho:    { label: 'Rascunho',    tone: 'slate' },
  em_revisao:  { label: 'Em revisão',  tone: 'yellow' },
  aprovado:    { label: 'Aprovado',    tone: 'green' },
  rejeitado:   { label: 'Rejeitado',   tone: 'red' },
  cancelado:   { label: 'Cancelado',   tone: 'slate' },
};

export const GED_STATUS: Record<string, StatusStyle> = {
  em_elaboracao: { label: 'Em elaboração', tone: 'slate' },
  em_revisao:    { label: 'Em revisão',    tone: 'yellow' },
  aprovado:      { label: 'Aprovado',      tone: 'green' },
  distribuido:   { label: 'Distribuído',   tone: 'blue' },
  obsoleto:      { label: 'Obsoleto',      tone: 'slate' },
  cancelado:     { label: 'Cancelado',     tone: 'red' },
};

export function statusFor(status: string | null | undefined, map: Record<string, StatusStyle>): StatusStyle {
  if (!status) return { label: '—', tone: 'slate' };
  return map[status] || { label: status, tone: 'slate' };
}
