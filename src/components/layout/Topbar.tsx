import { Link, useLocation } from 'react-router-dom';
import { Menu, Bell, ChevronRight, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase, hasSupabase, SKIP_AUTH } from '../../lib/supabase';
import { MOCK_NOTIFICATIONS } from '../../lib/mockData';

const CRUMB_LABELS: Record<string, string> = {
  dashboard: 'Carteira',
  contratos: 'Contratos',
  medicoes: 'Medições',
  planilha: 'Planilha',
  aditivos: 'Aditivos',
  'itens-nao-previstos': 'Itens não previstos',
  rastreamento: 'Rastreamento',
  financeiro: 'Financeiro',
  cronograma: 'Cronograma',
  relatorios: 'Relatórios',
  memoria: 'Memória',
  aprovar: 'Aprovar',
  ged: 'GED/DataBook',
  categorias: 'Categorias',
  documentos: 'Documento',
  distribuicao: 'Distribuição',
  admin: 'Admin',
  users: 'Usuários',
  tenants: 'Tenants',
  workflows: 'Workflows',
  backlog: 'Backlog',
  notifications: 'Notificações',
  me: 'Meu perfil',
};

interface Props {
  onMenuClick: () => void;
}

export function Topbar({ onMenuClick }: Props) {
  const { member } = useAuth();
  const location = useLocation();
  const [unread, setUnread] = useState(0);

  const parts = location.pathname.split('/').filter(Boolean);

  useEffect(() => {
    let mounted = true;

    async function loadUnread() {
      if (SKIP_AUTH) {
        if (mounted) setUnread(MOCK_NOTIFICATIONS.filter((n) => !n.read_at).length);
        return;
      }
      if (!hasSupabase || !member) return;
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .is('read_at', null)
        .is('deleted_at', null);
      if (mounted) setUnread(count || 0);
    }

    loadUnread();
    const id = window.setInterval(loadUnread, 60_000);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, [member, location.pathname]);

  const initials = member?.nome
    ? member.nome.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
    : 'GC';

  return (
    <header className={`fixed left-0 right-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-border-dark dark:bg-card-dark/95 lg:left-64 lg:px-8 ${SKIP_AUTH ? 'top-6' : 'top-0'}`}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-muted-dark lg:hidden"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-sm text-slate-500 dark:text-slate-400 md:flex">
          <Link to="/dashboard" className="font-semibold text-navy hover:underline dark:text-slate-200">
            geoCon
          </Link>
          {parts.slice(0, 3).map((p, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              <span className="capitalize">{CRUMB_LABELS[p] || p}</span>
            </span>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <Link
          to="/ged"
          className="hidden items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 hover:bg-slate-200 dark:bg-muted-dark dark:text-slate-300 dark:hover:bg-slate-700 md:flex"
        >
          <Search className="h-4 w-4" />
          Buscar documentos
        </Link>

        <Link
          to="/notifications"
          className="relative rounded-full p-2 hover:bg-slate-100 dark:hover:bg-muted-dark"
          aria-label="Notificações"
        >
          <Bell className="h-5 w-5 text-slate-600 dark:text-slate-300" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-magenta px-1 text-[9px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Link>

        <Link
          to="/me"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-sm font-bold text-white hover:bg-navy-900"
          title={member?.nome || 'Perfil'}
        >
          {initials}
        </Link>
      </div>
    </header>
  );
}
