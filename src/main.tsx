import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Fontes Inter (WOFF1) carregadas via @font-face em styles.css.
// Não usamos @fontsource pois ele entrega WOFF2 (não permitido neste produto).
import './styles.css';
import { App } from './App';
import { BootErrorBoundary } from './components/BootErrorBoundary';
import { initTheme } from './hooks/useTheme';
import { initDensity } from './hooks/useDensity';

// Aplica tema + densidade persistidos ANTES do primeiro render (evita flash)
initTheme();
initDensity();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </BootErrorBoundary>
  </React.StrictMode>,
);

// V76 — Remove o boot loader inline (definido em index.html) assim que
// o React monta. Roda no próximo microtask para garantir que o primeiro
// paint do app ocorra antes da remoção (evita flash de tela vazia).
queueMicrotask(() => {
  const boot = document.getElementById('geocon-boot');
  if (boot) boot.remove();
});

// V62 — Service Worker para PWA + cache de assets
// Não registra em dev (gera HMR conflicts). Registra após load para não
// competir com primeira renderização.
if (
  'serviceWorker' in navigator &&
  typeof window !== 'undefined' &&
  !import.meta.env.DEV
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[geocon] SW registration failed', err);
    });
  });
}
