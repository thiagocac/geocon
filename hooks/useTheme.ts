import { useEffect, useState, useCallback } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'geocon-theme';

/** Aplica a classe `.dark` em <html> conforme a preferência efetiva. */
function applyTheme(theme: Theme) {
  const isDark = theme === 'dark'
    || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}

/** Lê o tema persistido (ou 'system' por padrão). */
function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

/**
 * Hook de tema com 3 modos (light/dark/system).
 * Sincroniza com `prefers-color-scheme` quando o usuário escolhe 'system'.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

  // Aplica e persiste sempre que o tema mudar
  useEffect(() => {
    applyTheme(theme);
    if (theme === 'system') {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
  }, [theme]);

  // Escuta mudanças no SO quando estiver em modo 'system'
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(() => {
    setThemeState((cur) => {
      // Cicla: light → dark → system → light
      if (cur === 'light') return 'dark';
      if (cur === 'dark') return 'system';
      return 'light';
    });
  }, []);

  // Estado efetivo (resolve 'system' para light/dark concreto)
  const effective: 'light' | 'dark' = theme === 'system'
    ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;

  return { theme, effective, setTheme, toggleTheme };
}

/**
 * Inicializa o tema o mais cedo possível (chamado em main.tsx antes do render),
 * pra evitar flash de tema errado.
 */
export function initTheme() {
  applyTheme(readStoredTheme());
}
