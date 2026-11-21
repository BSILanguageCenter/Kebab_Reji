// src/services/deletedOrders.ts
/**
 * Список заказов, удалённых разработчиком, но ещё не удалённых во ВСЕХ
 * хранилищах (Supabase / Firebase / Google Sheets). Живёт в localStorage:
 *  - нет сети → удаление повторится, когда сеть вернётся;
 *  - пока заказ в списке, он не «воскреснет» из входящих данных.
 * Модуль без зависимостей, чтобы его мог импортировать localStore.
 */
const KEY = 'pos_deleted_orders_v1';

export interface PendingDeletion {
  id: string;
  created_at: string;
}

function read(): PendingDeletion[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as PendingDeletion[];
    return Array.isArray(arr) ? arr.filter((x) => x && x.id) : [];
  } catch {
    return [];
  }
}

let list: PendingDeletion[] = typeof window !== 'undefined' ? read() : [];

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) list = read();
  });
}

export function getPendingDeletions(): PendingDeletion[] {
  return [...list];
}

export function addPendingDeletions(items: PendingDeletion[]): void {
  const have = new Set(list.map((x) => x.id));
  for (const it of items) {
    if (!have.has(it.id)) {
      list.push({ id: it.id, created_at: it.created_at });
      have.add(it.id);
    }
  }
  persist();
}

export function removePendingDeletions(ids: string[]): void {
  const gone = new Set(ids);
  list = list.filter((x) => !gone.has(x.id));
  persist();
}

export function isOrderDeleted(id: string): boolean {
  return list.some((x) => x.id === id);
}
