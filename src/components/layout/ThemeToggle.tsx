import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type Theme } from '../../hooks/useTheme';

const TITLE: Record<Theme, string> = {
  light:  'Tema: claro (clique para escuro)',
  dark:   'Tema: escuro (clique para sistema)',
  system: 'Tema: sistema (clique para claro)',
};

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-muted-dark"
      aria-label={TITLE[theme]}
      title={TITLE[theme]}
    >
      <Icon className="h-5 w-5 text-slate-600 dark:text-slate-300" />
    </button>
  );
}
