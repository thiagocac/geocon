import { SKIP_AUTH } from '../../lib/supabase';
import { Sparkles } from 'lucide-react';

/**
 * Faixa visual fina no topo do app indicando que está em modo demo.
 * Apenas visível quando SKIP_AUTH=true em /config.js.
 */
export function DemoBanner() {
  if (!SKIP_AUTH) return null;
  return (
    <div className="fixed left-0 right-0 top-0 z-50 flex items-center justify-center gap-2 bg-gradient-to-r from-magenta via-purple to-navy py-1 text-center text-[11px] font-bold uppercase tracking-widest text-white shadow-md">
      <Sparkles className="h-3 w-3" />
      Modo DEMO ativo · dados mockados · edite <code className="rounded bg-white/20 px-1 font-mono normal-case">config.js</code> e mude <code className="rounded bg-white/20 px-1 font-mono normal-case">SKIP_AUTH: false</code> para usar o backend real
    </div>
  );
}
