// src/lib/viewPrefs.ts
// Общие настройки вида (касса + управление меню). Хранятся в localStorage,
// синхронизируются между вкладками и между страницами.
import { useSyncExternalStore } from 'react';

/** all — показывать все блюда группы; single — одна иконка на всю группу */
export type GroupView = 'all' | 'single';

export interface ViewPrefs {
  groupView: GroupView;
  /** Панель «Активные заказы» открыта (касса) */
  ordersOpen: boolean;
  /** true — закреплена слева колонкой; false — выезжает поверх меню */
  ordersPinned: boolean;
  /** true — карточки заказов развёрнуты (со списком блюд); false — свёрнуты */
  ordersExpanded: boolean;
  /** true — плавающие окна «Настройки» и «Продукты по категориям» скрыты (управление меню) */
  floatingHidden: boolean;
}

const STORAGE_KEY = 'kebab-pos-view-prefs-v1';

const DEFAULTS: ViewPrefs = {
  groupView: 'all',
  ordersOpen: true,
  ordersPinned: true,
  ordersExpanded: false,
  floatingHidden: false,
};

function load(): ViewPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<ViewPrefs>;
    return {
      groupView: p.groupView === 'single' ? 'single' : 'all',
      ordersOpen: typeof p.ordersOpen === 'boolean' ? p.ordersOpen : DEFAULTS.ordersOpen,
      ordersPinned:
        typeof p.ordersPinned === 'boolean' ? p.ordersPinned : DEFAULTS.ordersPinned,
      ordersExpanded:
        typeof p.ordersExpanded === 'boolean' ? p.ordersExpanded : DEFAULTS.ordersExpanded,
      floatingHidden:
        typeof p.floatingHidden === 'boolean' ? p.floatingHidden : DEFAULTS.floatingHidden,
    };
  } catch {
    return DEFAULTS;
  }
}

let current: ViewPrefs = typeof window === 'undefined' ? DEFAULTS : load();
const listeners = new Set<() => void>();

export function getViewPrefs(): ViewPrefs {
  return current;
}

export function setViewPrefs(patch: Partial<ViewPrefs>): void {
  const next = { ...current, ...patch };
  if (
    next.groupView === current.groupView &&
    next.ordersOpen === current.ordersOpen &&
    next.ordersPinned === current.ordersPinned &&
    next.ordersExpanded === current.ordersExpanded &&
    next.floatingHidden === current.floatingHidden
  ) {
    return;
  }
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    current = load();
    listeners.forEach((l) => l());
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Подписка на изменения настроек вида (вне React). */
export function subscribeViewPrefs(l: () => void): () => void {
  return subscribe(l);
}

export function useViewPrefs(): [ViewPrefs, typeof setViewPrefs] {
  const prefs = useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULTS
  );
  return [prefs, setViewPrefs];
}
