import type { Order } from '@/types/database';

/**
 * Максимум заказов, одновременно видимых на кухне.
 * Остальные NEW-заказы ждут в очереди, пока не освободится слот.
 */
export const KITCHEN_LIMIT = 5;

export interface KitchenSplit {
  /** Заказы, сейчас находящиеся на кухне (≤ KITCHEN_LIMIT), по возрастанию времени */
  kitchen: Order[];
  /** NEW-заказы, ожидающие свободного слота кухни */
  waiting: Order[];
  /** Готовые заказы, ожидающие выдачи */
  ready: Order[];
}

/**
 * Разбивает все активные заказы на три группы:
 *   kitchen  — на кухне (старые первыми, максимум KITCHEN_LIMIT)
 *   waiting  — ждут своей очереди
 *   ready    — готовы к выдаче
 *
 * Логика:
 *   1. Legacy PREPARING (если остались с прошлой схемы) занимают слоты первыми.
 *   2. Оставшиеся слоты заполняются NEW-заказами (FIFO, старые первыми).
 *   3. Всё, что не влезло — waiting.
 */
export function splitOrders(orders: Order[]): KitchenSplit {
  const sorted = [...orders].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const preparing = sorted.filter((o) => o.status === 'PREPARING');
  const newOnes = sorted.filter((o) => o.status === 'NEW');
  const ready = sorted.filter((o) => o.status === 'READY');

  const freeSlots = Math.max(0, KITCHEN_LIMIT - preparing.length);
  const newOnKitchen = newOnes.slice(0, freeSlots);
  const waiting = newOnes.slice(freeSlots);

  const kitchen = [...preparing, ...newOnKitchen].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return { kitchen, waiting, ready };
}