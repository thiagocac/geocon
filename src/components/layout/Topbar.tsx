import { Link, useLocation } from 'react-router-dom';
import { Menu, ChevronRight, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { NotificationDropdown } from './NotificationDropdown';
import { CommandPalette } from './CommandPalette';
import { ThemeToggle } from './ThemeToggle';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { SKIP_AUTH } from '../../lib/supabase';

const CRUMB_LABELS: Record<string, string> = {
  dashboard: 'Carteira',
  carteira: 'Carteira agregada',
  pendencias: 'Pendências',
  aprovacoes: 'Minhas aprovações',
  contratos: 'Contratos',
  medicoes: 'Medições',
  planilha: 'Planilha',
  versoes: 'Versões',
  obras: 'Obras / lotes',
  partes: 'Partes',
  aditivos: 'Aditivos',
  'itens-nao-previstos': 'Itens não previstos',
  rastreamento: 'Rastreamento',
  financeiro: 'Financeiro',
  cronograma: 'Cronograma',
  eap: 'EAP',
  relatorios: 'Relatórios',
  risco: 'Análise de risco',
  memoria: 'Memória',
  aprovar: 'Aprovar',
  novo: 'Novo',
  editar: 'Editar',
  importar: 'Importar',
  'nova-revisao': 'Nova revisão',
  termos: 'Termos',
  nova: 'Nova',
  ged: 'GED/DataBook',
  categorias: 'Categorias',
  documentos: 'Documento',
  distribuicao: 'Distribuição',
  admin: 'Admin',
  users: 'Usuários',
  tenants: 'Tenants',
  programs: 'Programas',
  disciplines: 'Disciplinas',
  workflows: 'Workflows',
  auditoria: 'Auditoria',
  digests: 'Digests',
  backlog: 'Backlog',
  notifications: 'Notificações',
  notificacoes: 'Preferências de notificação',
  me: 'Meu perfil',
};

interface Props {
  onMenuClick: () => void;
}

export function Topbar({ onMenuClick }: Props) {
  const { member } = useAuth();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const parts = location.pathname.split('/').filter(Boolean);

  // Atalhos globais: Cmd/Ctrl+K abre paleta, ? abre painel de atalhos
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key.toLowerCase();

      // Cmd/Ctrl + K
      if ((e.metaKey || e.ctrlKey) && k === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      // ? — só quando não está em campo de texto
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName?.toLowerCase();
        const isTyping = tag === 'input' || tag === 'textarea' || (t?.isContentEditable);
        if (!isTyping) {
          e.preventDefault();
          setShortcutsOpen((v) => !v);
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const initials = member?.nome
    ? member.nome.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
    : 'GC';

  // Detecta plataforma para mostrar o atalho correto
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcutKey = isMac ? '⌘' : 'Ctrl';

  return (
    <>
      <header className={`fixed left-0 right-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-border-dark dark:bg-card-dark/95 lg:left-64 lg:px-8 ${SKIP_AUTH ? 'top-6' : 'top-0'}`}>
        {/* Brand gradient accent strip — DS prescreve marca visível no app shell */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-navy via-purple to-magenta"
        />
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
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 hover:bg-slate-200 dark:bg-muted-dark dark:text-slate-300 dark:hover:bg-slate-700 md:flex"
            aria-label="Buscar (Cmd+K)"
          >
            <Search className="h-4 w-4" />
            <span>Buscar</span>
            <kbd className="ml-1 rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:border-border-dark dark:text-slate-400">
              {shortcutKey} K
            </kbd>
          </button>

          {/* Versão mobile (só ícone) */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-muted-dark md:hidden"
            aria-label="Buscar"
          >
            <Search className="h-5 w-5 text-slate-600 dark:text-slate-300" />
          </button>

          <ThemeToggle />
          <NotificationDropdown />

          <Link
            to="/me"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-sm font-bold text-white hover:bg-navy-900"
            title={member?.nome || 'Perfil'}
          >
            {initials}
          </Link>
        </div>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}
