import { useEffect, useState, useCallback } from 'react';

export type Density = 'compact' | 'comfortable' | 'spacious';

const STORAGE_KEY = 'geocon.density';
const DEFAULT_DENSITY: Density = 'comfortable';

function readStoredDensity(): Density {
  if (typeof window === 'undefined') return DEFAULT_DENSITY;
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Density | null;
    if (stored === 'compact' || stored === 'comfortable' || stored === 'spacious') return stored;
  } catch {
    // ignore
  }
  return DEFAULT_DENSITY;
}

function applyDensity(d: Density) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.density = d;
}

/**
 * useDensity — hook + persistência para o modo de densidade visual.
 * Reage ao atributo `data-density` no <html>. Componentes leem via CSS
 * (overrides em src/styles.css).
 */
export function useDensity(): [Density, (d: Density) => void] {
  const [density, setDensityState] = useState<Density>(readStoredDensity);

  useEffect(() => {
    applyDensity(density);
  }, [density]);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    try { localStorage.setItem(STORAGE_KEY, d); } catch { /* ignore */ }
  }, []);

  return [density, setDensity];
}

/**
 * initDensity — chamar na inicialização (main.tsx) antes da hidratação
 * para evitar flash visual.
 */
export function initDensity() {
  applyDensity(readStoredDensity());
}
