import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'bratan-music:recent-searches';
const MAX_ITEMS = 10;

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

export function useRecentSearches() {
  const [items, setItems] = useState<string[]>(() => load());

  // Multi-tab sync: pick up changes made in other windows.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setItems(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persist = useCallback((next: string[]) => {
    setItems(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // quota or disabled storage – ignore
    }
  }, []);

  const push = useCallback((raw: string) => {
    const q = raw.trim();
    if (q.length < 2) return;
    setItems((prev) => {
      const filtered = prev.filter((v) => v.toLowerCase() !== q.toLowerCase());
      const next = [q, ...filtered].slice(0, MAX_ITEMS);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const remove = useCallback((value: string) => {
    persist(items.filter((v) => v !== value));
  }, [items, persist]);

  const clear = useCallback(() => persist([]), [persist]);

  return { items, push, remove, clear };
}
