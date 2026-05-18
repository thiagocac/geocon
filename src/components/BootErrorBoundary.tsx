import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * V76 — Error boundary global do boot.
 *
 * Captura qualquer erro de render que escape dos sub-boundaries da árvore.
 * Antes de V76, um erro no boot do App (provider, hook, lazy chunk faltando)
 * resultava em tela branca silenciosa — o React desmontava tudo e o
 * `<div id="root">` ficava vazio.
 *
 * Esta boundary renderiza uma tela de erro visível com 2 ações:
 *   1) Recarregar a página
 *   2) Limpar SW + cache do navegador e recarregar (resolve cache obsoleto
 *      que era a causa raiz da tela branca em V62-V75)
 */
export class BootErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error('[geoCon] Boot error caught by boundary:', error, info?.componentStack);
  }

  private async resetAndReload() {
    try {
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      /* ignore — vamos recarregar mesmo assim */
    }
    location.reload();
  }

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error?.stack || this.state.error?.message || String(this.state.error);
    return (
      <div
        style={{
          position: 'fixed', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 16, padding: 24,
          background: '#f8fafc',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          color: '#475569',
        }}
      >
        <div
          style={{
            width: 48, height: 48,
            border: '3px solid #fca5a5',
            borderTopColor: '#dc2626',
            borderRadius: '50%',
          }}
        />
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#dc2626', marginBottom: 8 }}>
            Não foi possível carregar o geoCon
          </div>
          <div
            style={{
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontSize: 11, color: '#64748b',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 180, overflow: 'auto',
              background: 'rgba(0,0,0,0.04)', padding: '8px 12px',
              borderRadius: 6, textAlign: 'left',
            }}
          >
            {msg}
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={() => location.reload()}
              style={{
                font: 'inherit', fontSize: 13,
                padding: '8px 16px', borderRadius: 6,
                border: '1px solid #cbd5e1', background: 'white', color: '#475569',
                cursor: 'pointer',
              }}
            >
              Recarregar
            </button>
            <button
              onClick={() => this.resetAndReload()}
              style={{
                font: 'inherit', fontSize: 13,
                padding: '8px 16px', borderRadius: 6,
                border: '1px solid #cbd5e1', background: 'white', color: '#475569',
                cursor: 'pointer',
              }}
            >
              Limpar cache e recarregar
            </button>
          </div>
        </div>
      </div>
    );
  }
}
