// src/lib/menuOrder.ts
// Расстановка карточек меню у каждого режима групп — своя:
//   «все блюда»   → item.sort_order
//   «одна иконка» → item.sort_order_single (если ещё не задан — берём sort_order)
// Так перестановка в одном режиме не ломает расстановку в другом.
import type { MenuItem } from '@/types/database';
import { getViewPrefs } from '@/lib/viewPrefs';

export function isSingleMode(): boolean {
  return getViewPrefs().groupView === 'single';
}

/** Позиция (слот) карточки в текущем (или заданном) режиме */
export function slotOf(item: MenuItem, single: boolean = isSingleMode()): number {
  return single ? item.sort_order_single ?? item.sort_order : item.sort_order;
}

/**
 * Применить новые позиции к списку в текущем режиме.
 * В режиме «одна иконка» сначала фиксируем позиции ВСЕХ карточек
 * (sort_order_single), чтобы они не «ехали» вслед за режимом «все блюда».
 */
export function patchSlots<T extends MenuItem>(
  list: T[],
  updates: Map<string, number>,
  single: boolean = isSingleMode()
): T[] {
  return list.map((it) => {
    const next = updates.get(it.id);
    // updated_at обновляем ВСЕГДА при смене позиции: по нему при слиянии с
    // облаком определяется, чья версия карточки новее (иначе устаревший ответ
    // облака затирал перестановку).
    const stamp = new Date().toISOString();
    if (!single) {
      if (next == null || next === it.sort_order) return it;
      return { ...it, sort_order: next, updated_at: stamp };
    }
    const cur = it.sort_order_single ?? it.sort_order;
    const target = next != null ? next : cur;
    if (it.sort_order_single === target) return it; // без лишних перезаписей
    return { ...it, sort_order_single: target, updated_at: stamp };
  });
}
