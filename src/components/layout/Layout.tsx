import type { ReactNode } from 'react';
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { DemoBanner } from './DemoBanner';
import { SKIP_AUTH } from '../../lib/supabase';

export function Layout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className={`min-h-screen bg-slate-50 dark:bg-background-dark ${SKIP_AUTH ? 'pt-6' : ''}`}>
      {/* Skip-link — WCAG 2.2 AA */}
      <a
        href="#main"
        className="sr-only fixed left-2 top-2 z-[100] rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white shadow-elevated focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-magenta focus:ring-offset-2"
      >
        Pular para o conteúdo principal
      </a>

      <DemoBanner />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <Topbar onMenuClick={() => setSidebarOpen(true)} />
      <main id="main" className="pt-16 lg:pl-64">
        <div className="mx-auto max-w-[1400px] p-4 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
