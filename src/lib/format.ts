/**
 * Formatters padronizados para pt-BR.
 * - brl(v): R$ 1.234,56
 * - num(v, decimals): número com separadores brasileiros
 * - dt(s): dd/MM/yyyy
 * - dtTime(s): dd/MM/yyyy HH:mm
 * - pct(v): 12,3 %
 * - bytes(n): 1.2 KB, 3.4 MB...
 */

const fmtBRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtNum2 = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const fmtNum6 = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
});

export function brl(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return fmtBRL.format(n);
}

export function num(
  v: number | string | null | undefined,
  decimals: number = 2,
): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0';
  if (decimals === 6) return fmtNum6.format(n);
  if (decimals === 2) return fmtNum2.format(n);
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function pct(v: number | string | null | undefined, decimals: number = 1): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0 %';
  return `${num(n, decimals)} %`;
}

/**
 * Aceita string ISO (com ou sem timezone), Date, ou null/undefined.
 * Datas em formato 'YYYY-MM-DD' são tratadas como locais (sem TZ shift).
 */
export function dt(s: string | Date | null | undefined): string {
  if (!s) return '—';
  let date: Date;
  if (s instanceof Date) {
    date = s;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    // Date-only: normaliza com hora fixa para evitar shift por timezone
    date = new Date(`${s}T12:00:00`);
  } else {
    date = new Date(s);
  }
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function dtTime(s: string | Date | null | undefined): string {
  if (!s) return '—';
  const date = s instanceof Date ? s : new Date(s);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function bytes(b: number | null | undefined): string {
  const n = Number(b ?? 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function relativeTime(s: string | Date | null | undefined): string {
  if (!s) return '—';
  const date = s instanceof Date ? s : new Date(s);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return 'agora';
  const min = Math.round(sec / 60);
  if (min < 60) return `há ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `há ${days} d`;
  return dt(date);
}
