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
      <DemoBanner />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <Topbar onMenuClick={() => setSidebarOpen(true)} />
      <main className="pt-16 lg:pl-64">
        <div className="mx-auto max-w-7xl p-4 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
