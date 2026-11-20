// src/lib/theme.ts
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'kebab-pos-theme';

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    /* ignore */
  }
  return 'light';
}

function applyToDom(t: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', t === 'dark');
  root.style.colorScheme = t;
}

let current: Theme = typeof window === 'undefined' ? 'light' : readStored();
if (typeof window !== 'undefined') applyToDom(current);

const listeners = new Set<() => void>();

export function setTheme(t: Theme): void {
  if (t === current) return;
  current = t;
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* ignore */
  }
  applyToDom(t);
  listeners.forEach((l) => l());
}

export function toggleTheme(): void {
  setTheme(current === 'dark' ? 'light' : 'dark');
}

// синхронизация между вкладками
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const next = readStored();
    if (next === current) return;
    current = next;
    applyToDom(next);
    listeners.forEach((l) => l());
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Текущая тема + функция переключения (общее состояние для всего приложения). */
export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => 'light' as Theme
  );
  return [theme, toggleTheme];
}
