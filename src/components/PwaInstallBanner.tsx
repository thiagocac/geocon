import { useState, useEffect } from 'react';
import { Smartphone, X } from 'lucide-react';

/**
 * V75 — PWA install banner.
 *
 * Captura o evento `beforeinstallprompt` (Chrome/Edge/Samsung Internet) e
 * mostra um banner discreto sugerindo instalar o app na home screen.
 * Especialmente útil para fiscais que vão usar V61 (apontamento campo).
 *
 * Em iOS Safari (que não suporta beforeinstallprompt), mostra dica textual
 * para o user fazer "Adicionar à tela inicial" pelo menu compartilhar.
 *
 * Persiste decisão (dismiss/instalado) em localStorage para não importunar.
 */

// Tipo do evento BeforeInstallPrompt (não está no lib.dom.d.ts)
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const STORAGE_KEY = 'geocon:pwa_banner_dismissed_at';
const DISMISS_DAYS = 14;

function isIOS(): boolean {
  return typeof navigator !== 'undefined'
    && /iPad|iPhone|iPod/.test(navigator.userAgent)
    && !(window as { MSStream?: unknown }).MSStream;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as { standalone?: boolean }).standalone === true;
}

function wasRecentlyDismissed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  const v = localStorage.getItem(STORAGE_KEY);
  if (!v) return false;
  const dismissed = parseInt(v, 10);
  if (isNaN(dismissed)) return false;
  return Date.now() - dismissed < DISMISS_DAYS * 86_400_000;
}

export function PwaInstallBanner() {
  const [show, setShow] = useState(false);
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasRecentlyDismissed()) return;

    // Caminho 1: Chrome/Edge/Samsung — captura prompt nativo
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
      setShow(true);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // Caminho 2: iOS — sem API, mostra hint após 4s de uso
    if (isIOS()) {
      const t = setTimeout(() => {
        setIosHint(true);
        setShow(true);
      }, 4000);
      return () => {
        window.removeEventListener('beforeinstallprompt', onBeforeInstall);
        clearTimeout(t);
      };
    }

    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted' || choice.outcome === 'dismissed') {
      setShow(false);
      // Salva timestamp para não importunar
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    }
  }

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border border-navy/20 bg-white p-3 shadow-xl dark:border-purple-500/30 dark:bg-card-dark">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy/10 dark:bg-purple-900/30">
          <Smartphone className="h-4 w-4 text-navy dark:text-purple-300" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold dark:text-slate-100">Instalar GeoCon</h3>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
            {iosHint
              ? <>Para usar offline em obra, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</>
              : <>Acesso rápido na tela inicial. Funciona offline em apontamento de campo.</>}
          </p>
          {!iosHint && promptEvent && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={install}
                className="rounded bg-navy px-3 py-1 text-xs font-semibold text-white hover:bg-navy/90 dark:bg-purple-600 dark:hover:bg-purple-700"
              >
                Instalar
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-muted-dark"
              >
                Agora não
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
