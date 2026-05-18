import { useEffect, useState } from 'react';

/**
 * Detecta um media query e retorna boolean reativo.
 *
 * Usado para padrões mobile-first onde precisamos saber em runtime se estamos
 * em viewport pequeno (ex: substituir tabelas por listas de cards).
 *
 * Para classes CSS responsivas comuns, **prefira Tailwind** (`md:hidden` etc).
 * Use este hook apenas quando a estrutura DOM precisa mudar drasticamente.
 *
 * @example
 *   const isMobile = useMediaQuery('(max-width: 767px)');
 *   return isMobile ? <CardList /> : <Table />;
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    // addEventListener é o moderno; addListener é o legacy (Safari <14)
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      mql.addListener(handler);
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      return () => mql.removeListener(handler);
    }
  }, [query]);

  return matches;
}

/** Atalhos para breakpoints Tailwind. */
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');     // < md
export const useIsTablet = () => useMediaQuery('(min-width: 768px) and (max-width: 1023px)'); // md
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');   // lg+
