import { Modal } from '../ui/Modal';

interface Shortcut {
  keys: string[];
  desc: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: Array<{ section: string; items: Shortcut[] }> = [
  {
    section: 'Navegação global',
    items: [
      { keys: ['⌘', 'K'], desc: 'Abrir/fechar a paleta de comandos' },
      { keys: ['Ctrl', 'K'], desc: 'Mesma coisa, no Windows/Linux' },
      { keys: ['?'], desc: 'Mostrar este painel de atalhos' },
      { keys: ['Esc'], desc: 'Fechar diálogos, dropdowns ou paleta' },
    ],
  },
  {
    section: 'Paleta de comandos',
    items: [
      { keys: ['↑'], desc: 'Item anterior' },
      { keys: ['↓'], desc: 'Próximo item' },
      { keys: ['⏎'], desc: 'Selecionar' },
    ],
  },
  {
    section: 'Acessibilidade',
    items: [
      { keys: ['Tab'], desc: 'Navegar entre controles' },
      { keys: ['Shift', 'Tab'], desc: 'Voltar pro controle anterior' },
      { keys: ['Space'], desc: 'Ativar botões / marcar checkboxes' },
    ],
  },
];

export function KeyboardShortcutsModal({ open, onClose }: Props) {
  // Detecta plataforma pra mostrar atalho certo
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <Modal open={open} onClose={onClose} title="Atalhos de teclado">
      <div className="space-y-5">
        {SHORTCUTS.map((sec) => (
          <section key={sec.section}>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {sec.section}
            </h3>
            <ul className="space-y-1.5">
              {sec.items.map((s, i) => {
                // Filtra duplicação ⌘/Ctrl conforme a plataforma
                const isCmdK = s.keys.length === 2 && s.keys[0] === '⌘' && s.keys[1] === 'K';
                const isCtrlK = s.keys.length === 2 && s.keys[0] === 'Ctrl' && s.keys[1] === 'K';
                if (isCmdK && !isMac) return null;
                if (isCtrlK && isMac) return null;
                return (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="dark:text-slate-200">{s.desc}</span>
                    <span className="flex gap-1">
                      {s.keys.map((k, j) => (
                        <kbd key={j}
                             className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700 dark:border-border-dark dark:bg-muted-dark dark:text-slate-300">
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
