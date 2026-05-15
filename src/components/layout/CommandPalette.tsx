import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Layers, Home, ClipboardList, FolderTree, BarChart3, PieChart,
  Briefcase, Users, ShieldCheck, BookOpen, History, Plus, FileText,
  CornerDownLeft, ArrowDown, ArrowUp, Clock, FileCheck2,
} from 'lucide-react';
import { listContracts } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { useRecentItems, type RecentItem } from '../../hooks/useRecentItems';

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  group: 'Recentes' | 'Contratos' | 'Navegação' | 'Administração' | 'Ações';
  icon: typeof Search;
  to?: string;
  action?: () => void;
  roleGuard?: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { hasRole } = useAuth();
  const { items: recentItems } = useRecentItems();

  const { data: contracts = [] } = useQuery({
    queryKey: ['contracts'], queryFn: listContracts, enabled: open,
  });

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const items: PaletteItem[] = useMemo(() => {
    const recents: PaletteItem[] = recentItems.map((r: RecentItem) => ({
      id: `recent-${r.type}-${r.id}`,
      label: r.label,
      hint: r.hint,
      group: 'Recentes',
      icon: r.type === 'contract' ? Layers : r.type === 'measurement' ? FileCheck2 : r.type === 'additive' ? Clock : FileText,
      to: r.to,
    }));

    const contractItems: PaletteItem[] = contracts.slice(0, 30).map((c) => ({
      id: `contract-${c.id}`,
      label: c.numero,
      hint: c.objeto,
      group: 'Contratos',
      icon: Layers,
      to: `/contratos/${c.id}`,
    }));

    const navItems: PaletteItem[] = [
      { id: 'nav-dashboard',  label: 'Carteira (Dashboard)',     hint: 'Visão executiva', group: 'Navegação', icon: Home,          to: '/dashboard' },
      { id: 'nav-contratos',  label: 'Contratos — lista',        hint: 'Todos os contratos', group: 'Navegação', icon: Layers,    to: '/contratos' },
      { id: 'nav-carteira',   label: 'Visão por programa',       hint: 'Carteira agregada', group: 'Navegação', icon: PieChart,    to: '/carteira' },
      { id: 'nav-aprovacoes', label: 'Minhas aprovações',        hint: 'Steps assignados a mim', group: 'Navegação', icon: ShieldCheck, to: '/aprovacoes' },
      { id: 'nav-pendencias', label: 'Pendências',               hint: 'Itens com SLA estourado', group: 'Navegação', icon: ClipboardList, to: '/pendencias' },
      { id: 'nav-relatorios', label: 'Relatórios globais',       hint: 'CSV e visualizações', group: 'Navegação', icon: BarChart3,   to: '/relatorios' },
      { id: 'nav-ged',        label: 'GED / DataBook',           hint: 'Documentos', group: 'Navegação', icon: FolderTree,   to: '/ged' },
      { id: 'nav-grds',       label: 'Distribuição (GRDs)',      hint: 'Guia de remessa', group: 'Navegação', icon: FolderTree,  to: '/ged/distribuicao' },
      { id: 'nav-taxonomia',  label: 'Taxonomia GED',            hint: 'Categorias e metadados', group: 'Navegação', icon: BookOpen, to: '/ged/categorias' },
      { id: 'nav-notif',      label: 'Notificações',             hint: '', group: 'Navegação', icon: History, to: '/notifications' },
    ];

    const adminItems: PaletteItem[] = [
      { id: 'adm-users',     label: 'Usuários',     hint: '', group: 'Administração', icon: Users,        to: '/admin/users',                roleGuard: ['admin'] },
      { id: 'adm-tenants',   label: 'Tenants',      hint: '', group: 'Administração', icon: Briefcase,    to: '/admin/tenants',              roleGuard: ['admin'] },
      { id: 'adm-programas', label: 'Programas',    hint: '', group: 'Administração', icon: PieChart,     to: '/admin/programs',             roleGuard: ['admin', 'gestor_contrato'] },
      { id: 'adm-disc',      label: 'Disciplinas',  hint: '', group: 'Administração', icon: Layers,       to: '/admin/disciplines',          roleGuard: ['admin', 'gestor_contrato'] },
      { id: 'adm-workflows', label: 'Workflows',    hint: '', group: 'Administração', icon: ShieldCheck,  to: '/admin/contratos/workflows',  roleGuard: ['admin'] },
      { id: 'adm-audit',     label: 'Auditoria',    hint: '', group: 'Administração', icon: History,      to: '/admin/auditoria',            roleGuard: ['admin'] },
      { id: 'adm-backlog',   label: 'Backlog',      hint: '', group: 'Administração', icon: BookOpen,     to: '/admin/backlog',              roleGuard: ['admin'] },
    ];

    const actions: PaletteItem[] = [
      { id: 'act-novo-contrato', label: 'Novo contrato', hint: 'Cadastrar novo', group: 'Ações', icon: Plus, to: '/contratos/novo' },
      { id: 'act-nova-grd',      label: 'Nova GRD',      hint: 'Distribuir documentos', group: 'Ações', icon: Plus, to: '/ged/distribuicao/nova' },
      { id: 'act-novo-doc',      label: 'Novo documento GED', hint: 'Upload wizard', group: 'Ações', icon: FileText, to: '/ged/documentos/novo' },
    ];

    return [...recents, ...contractItems, ...navItems, ...adminItems, ...actions]
      .filter((it) => !it.roleGuard || hasRole(it.roleGuard));
  }, [contracts, hasRole, recentItems]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter((it) =>
      it.label.toLowerCase().includes(q) ||
      (it.hint ?? '').toLowerCase().includes(q) ||
      it.group.toLowerCase().includes(q)
    );
  }, [items, query]);

  // Agrupa pra renderização
  const grouped = useMemo(() => {
    const out: Record<string, PaletteItem[]> = {};
    filtered.forEach((it) => { (out[it.group] ||= []).push(it); });
    return out;
  }, [filtered]);

  // Mantém active dentro do range
  useEffect(() => {
    if (active >= filtered.length) setActive(Math.max(filtered.length - 1, 0));
  }, [filtered.length, active]);

  // Scroll item ativo
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLLIElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function handleSelect(item: PaletteItem) {
    if (item.action) item.action();
    else if (item.to) navigate(item.to);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[active]) {
      e.preventDefault();
      handleSelect(filtered[active]);
    }
  }

  if (!open) return null;

  // Index global pra cada item (pra match com active)
  let idx = -1;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 pt-[10vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-card-dark">
        <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-border-dark">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Buscar contratos, páginas, ações…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400 dark:text-slate-100"
          />
          <kbd className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 dark:border-border-dark">ESC</kbd>
        </header>

        <div className="max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Nenhum resultado para "<span className="font-mono">{query}</span>"
            </div>
          ) : (
            <ul ref={listRef} className="py-1">
              {Object.entries(grouped).map(([group, list]) => (
                <li key={group}>
                  <p className="mt-2 px-4 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{group}</p>
                  <ul>
                    {list.map((it) => {
                      idx++;
                      const Icon = it.icon;
                      const isActive = idx === active;
                      const myIdx = idx;
                      return (
                        <li
                          key={it.id}
                          data-idx={myIdx}
                          onMouseEnter={() => setActive(myIdx)}
                          onClick={() => handleSelect(it)}
                          className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm ${
                            isActive ? 'bg-navy/10 dark:bg-purple/15' : ''
                          }`}
                        >
                          <Icon className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-navy dark:text-purple-300' : 'text-slate-400'}`} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium dark:text-slate-100">{it.label}</p>
                            {it.hint && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{it.hint}</p>}
                          </div>
                          {isActive && <CornerDownLeft className="h-3.5 w-3.5 text-slate-400" />}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500 dark:border-border-dark dark:text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-slate-200 px-1.5 py-0.5 font-mono dark:border-border-dark">
                <ArrowUp className="h-3 w-3" />
              </kbd>
              <kbd className="rounded border border-slate-200 px-1.5 py-0.5 font-mono dark:border-border-dark">
                <ArrowDown className="h-3 w-3" />
              </kbd>
              navegar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-slate-200 px-1.5 py-0.5 font-mono dark:border-border-dark">
                <CornerDownLeft className="h-3 w-3" />
              </kbd>
              selecionar
            </span>
          </div>
          <span>{filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'}</span>
        </footer>
      </div>
    </div>
  );
}
