import { NavLink, Link } from 'react-router-dom';
import {
  Home, Layers, FolderTree, Bell, Users, LogOut, ShieldCheck, ChevronDown,
  Briefcase, BookOpen, ClipboardList, PieChart, BarChart3, History, Mail, Megaphone,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { PRODUCT_NAME, SKIP_AUTH } from '../../lib/supabase';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  roles?: string[];
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/dashboard',     label: 'Carteira',           icon: Home },
  { to: '/contratos',     label: 'Contratos',          icon: Layers },
  { to: '/carteira',      label: 'Visão por programa', icon: PieChart },
  { to: '/aprovacoes',    label: 'Minhas aprovações',  icon: ShieldCheck },
  { to: '/pendencias',    label: 'Pendências',         icon: ClipboardList },
  { to: '/relatorios',    label: 'Relatórios',         icon: BarChart3 },
  { to: '/ged',           label: 'GED/DataBook',       icon: FolderTree },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin/users',                label: 'Usuários',     icon: Users,       roles: ['admin'] },
  { to: '/admin/tenants',              label: 'Tenants',      icon: Briefcase,   roles: ['admin'] },
  { to: '/admin/programs',             label: 'Programas',    icon: PieChart,    roles: ['admin', 'gestor_contrato'] },
  { to: '/admin/disciplines',          label: 'Disciplinas',  icon: Layers,      roles: ['admin', 'gestor_contrato'] },
  { to: '/admin/contratos/workflows',  label: 'Workflows',    icon: ShieldCheck, roles: ['admin'] },
  { to: '/admin/auditoria',            label: 'Auditoria',    icon: History,     roles: ['admin'] },
  { to: '/admin/digests',              label: 'Digests',      icon: Mail,        roles: ['admin'] },
  { to: '/admin/broadcast',            label: 'Broadcasts',   icon: Megaphone,   roles: ['admin'] },
  { to: '/admin/backlog',              label: 'Backlog',      icon: BookOpen,    roles: ['admin'] },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: Props) {
  const { member, signOut, hasRole } = useAuth();
  const [adminOpen, setAdminOpen] = useState(true);

  return (
    <>
      {/* Overlay mobile */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={[
          'fixed bottom-0 left-0 z-40 flex w-64 flex-col bg-navy-900 text-white transition-transform lg:translate-x-0',
          SKIP_AUTH ? 'top-6' : 'top-0',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* Logo — assets canônicos do brand book (PNG 1x + 2x retina) */}
        <div className="flex h-16 items-center px-5">
          <Link to="/dashboard" className="flex items-center gap-2" onClick={onClose}>
            <img
              src="/logos/logo-white.png"
              srcSet="/logos/logo-white.png 1x, /logos/logo-white@2x.png 2x"
              alt="geoCon"
              className="h-7 w-auto"
            />
            <span className="sr-only">geoCon · Consulte GEO</span>
          </Link>
        </div>

        {/* Tenant */}
        {member?.tenants && (
          <div className="mx-3 mb-2 rounded-lg bg-white/10 px-3 py-2 text-xs">
            <div className="font-mono uppercase tracking-display text-white/60">tenant</div>
            <div className="truncate font-medium">{member.tenants.nome}</div>
          </div>
        )}

        {/* Nav principal */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
          {PRIMARY_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-slate-200 hover:bg-white/10',
                ].join(' ')
              }
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {item.label}
            </NavLink>
          ))}

          <NavLink
            to="/notifications"
            onClick={onClose}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-white/15 text-white' : 'text-slate-200 hover:bg-white/10',
              ].join(' ')
            }
          >
            <Bell className="h-4 w-4 flex-shrink-0" />
            Notificações
          </NavLink>

          {/* Admin group */}
          {hasRole(['admin']) && (
            <div className="mt-4">
              <button
                onClick={() => setAdminOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white"
              >
                <span>Administração</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${adminOpen ? '' : '-rotate-90'}`} />
              </button>
              {adminOpen && (
                <div className="space-y-1">
                  {ADMIN_NAV.filter((item) => !item.roles || hasRole(item.roles)).map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={onClose}
                      className={({ isActive }) =>
                        [
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive ? 'bg-white/15 text-white' : 'text-slate-200 hover:bg-white/10',
                        ].join(' ')
                      }
                    >
                      <item.icon className="h-4 w-4 flex-shrink-0" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Switcher Consulte GEO */}
        <div className="border-t border-white/10 p-4">
          <div className="rounded-xl bg-white/10 p-3">
            <p className="text-[10px] font-bold uppercase tracking-display text-white/60">
              Plataforma Consulte GEO
            </p>
            <p className="mt-1 text-xs text-white">
              <strong>{PRODUCT_NAME}</strong> · geoRDO · geoFin
            </p>
          </div>
          {member && (
            <button
              onClick={() => signOut()}
              className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-200 hover:bg-white/10"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
