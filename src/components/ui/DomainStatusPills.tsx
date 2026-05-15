import { StatusPill } from './StatusPill';

/* ============================================================================
 * Status pills no domínio do geoCon — mapeamento enum→tone+label sentence-case.
 * Mantém valores enum lowercase no DB; aplica display rules na UI.
 * ========================================================================== */

type Tone = 'slate' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'magenta';

// ─── Contract status ────────────────────────────────────────────────────────
const CONTRACT_STATUS_MAP: Record<string, { tone: Tone; label: string }> = {
  vigente:              { tone: 'green',  label: 'Vigente' },
  assinatura_pendente:  { tone: 'yellow', label: 'Assinatura pendente' },
  paralisado:           { tone: 'yellow', label: 'Paralisado' },
  concluido:            { tone: 'blue',   label: 'Concluído' },
  cancelado:            { tone: 'red',    label: 'Cancelado' },
  expirado:             { tone: 'slate',  label: 'Expirado' },
  rescindido:           { tone: 'red',    label: 'Rescindido' },
  encerrado:            { tone: 'slate',  label: 'Encerrado' },
};

export function ContractStatusPill({ status, size = 'sm' }: { status: string | null | undefined; size?: 'sm' | 'md' }) {
  if (!status) return null;
  const meta = CONTRACT_STATUS_MAP[status] || { tone: 'slate' as Tone, label: status };
  return <StatusPill tone={meta.tone} size={size}>{meta.label}</StatusPill>;
}

// ─── Measurement status ─────────────────────────────────────────────────────
const MEASUREMENT_STATUS_MAP: Record<string, { tone: Tone; label: string }> = {
  rascunho:        { tone: 'slate',   label: 'Rascunho' },
  em_aprovacao:    { tone: 'yellow',  label: 'Em aprovação' },
  aprovada:        { tone: 'green',   label: 'Aprovada' },
  devolvida:       { tone: 'red',     label: 'Devolvida' },
  cancelada:       { tone: 'slate',   label: 'Cancelada' },
  paga:            { tone: 'blue',    label: 'Paga' },
  paga_parcial:    { tone: 'purple',  label: 'Paga parcial' },
  faturada:        { tone: 'purple',  label: 'Faturada' },
  // Compat com nomes alternativos
  pendente:        { tone: 'yellow',  label: 'Pendente' },
  aprovado:        { tone: 'green',   label: 'Aprovada' },
  reprovado:       { tone: 'red',     label: 'Reprovada' },
};

export function MeasurementStatusPill({ status, size = 'sm' }: { status: string | null | undefined; size?: 'sm' | 'md' }) {
  if (!status) return null;
  const meta = MEASUREMENT_STATUS_MAP[status] || { tone: 'slate' as Tone, label: status };
  return <StatusPill tone={meta.tone} size={size}>{meta.label}</StatusPill>;
}

// ─── Additive status ────────────────────────────────────────────────────────
const ADDITIVE_STATUS_MAP: Record<string, { tone: Tone; label: string }> = {
  rascunho:          { tone: 'slate',  label: 'Rascunho' },
  em_aprovacao:      { tone: 'yellow', label: 'Em aprovação' },
  aprovado:          { tone: 'green',  label: 'Aprovado' },
  registrado:        { tone: 'blue',   label: 'Registrado' },
  rejeitado:         { tone: 'red',    label: 'Rejeitado' },
  cancelado:         { tone: 'slate',  label: 'Cancelado' },
};

export function AdditiveStatusPill({ status, size = 'sm' }: { status: string | null | undefined; size?: 'sm' | 'md' }) {
  if (!status) return null;
  const meta = ADDITIVE_STATUS_MAP[status] || { tone: 'slate' as Tone, label: status };
  return <StatusPill tone={meta.tone} size={size}>{meta.label}</StatusPill>;
}

// ─── GED Transmittal status ─────────────────────────────────────────────────
const GED_STATUS_MAP: Record<string, { tone: Tone; label: string }> = {
  rascunho:        { tone: 'slate',  label: 'Rascunho' },
  enviada:         { tone: 'blue',   label: 'Enviada' },
  parcialmente_recebida: { tone: 'yellow', label: 'Parcial' },
  recebida:        { tone: 'green',  label: 'Recebida' },
  cancelada:       { tone: 'slate',  label: 'Cancelada' },
};

export function GedStatusPill({ status, size = 'sm' }: { status: string | null | undefined; size?: 'sm' | 'md' }) {
  if (!status) return null;
  const meta = GED_STATUS_MAP[status] || { tone: 'slate' as Tone, label: status };
  return <StatusPill tone={meta.tone} size={size}>{meta.label}</StatusPill>;
}

// ─── Severidade (pendências) ────────────────────────────────────────────────
const SEVERITY_MAP: Record<string, { tone: Tone; label: string }> = {
  low:    { tone: 'slate',  label: 'Baixa' },
  medium: { tone: 'yellow', label: 'Média' },
  high:   { tone: 'red',    label: 'Alta' },
};

export function SeverityPill({ level, size = 'sm' }: { level: 'low' | 'medium' | 'high' | string; size?: 'sm' | 'md' }) {
  const meta = SEVERITY_MAP[level] || { tone: 'slate' as Tone, label: level };
  return <StatusPill tone={meta.tone} size={size}>{meta.label}</StatusPill>;
}

// ─── Risco de contrato ──────────────────────────────────────────────────────
export function RiskLevelPill({ score, size = 'sm' }: { score: number; size?: 'sm' | 'md' }) {
  let tone: Tone; let label: string;
  if (score >= 70)      { tone = 'red';    label = 'Crítico'; }
  else if (score >= 40) { tone = 'yellow'; label = 'Atenção'; }
  else if (score >= 20) { tone = 'blue';   label = 'Estável'; }
  else                  { tone = 'green';  label = 'Saudável'; }
  return <StatusPill tone={tone} size={size}>{label}</StatusPill>;
}
