import { useCallback, useEffect, useState } from 'react';

export interface RecentItem {
  id: string;
  type: 'contract' | 'measurement' | 'additive' | 'document';
  label: string;        // Texto principal (ex: "CT-2024/0042")
  hint?: string;        // Subtítulo (ex: "Construção de Hospital Regional")
  to: string;           // Rota interna
  visitedAt: number;    // epoch ms
}

const STORAGE_KEY = 'geocon-recent-items';
const MAX_ITEMS = 8;

function readStored(): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) =>
      x && typeof x.id === 'string' && typeof x.label === 'string' && typeof x.to === 'string'
    ).slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

function writeStored(items: RecentItem[]) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS))); } catch { /* quota / private mode — silencioso */ }
}

/** Hook reativo de recent items. Múltiplas instâncias sincronizam via 'storage' event. */
export function useRecentItems() {
  const [items, setItems] = useState<RecentItem[]>(() => readStored());

  // Sincroniza entre abas
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setItems(readStored());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const push = useCallback((item: Omit<RecentItem, 'visitedAt'>) => {
    setItems((cur) => {
      const filtered = cur.filter((x) => !(x.id === item.id && x.type === item.type));
      const next = [{ ...item, visitedAt: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
      writeStored(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => { writeStored([]); setItems([]); }, []);

  return { items, push, clear };
}
