// src/services/orderDeletion.ts
/**
 * Полное удаление заказов — режим разработчика.
 * Удаляет везде: localStorage этого устройства, Supabase, Firebase RTDB,
 * Google Sheets. Остальные устройства узнают через realtime (Supabase DELETE).
 * Если что-то не удалось (нет сети) — заказ остаётся в списке ожидающих
 * удалений и добивается автоматически.
 */
import type { Order } from '@/types/database';
import { removeOrdersLocally } from '@/lib/localStore';
import { deleteOrder as deleteOrderFirebase } from './firebaseSync';
import {
  deleteOrdersFromDb,
  dropOrdersFromOutbox,
} from './supabaseOrders';
import { deleteOrdersInSheets } from './googleSheetsSync';
import { removeOperationsForOrder } from './syncQueue';
import {
  addPendingDeletions,
  getPendingDeletions,
  removePendingDeletions,
} from './deletedOrders';

const RETRY_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

let flushing = false;

/** Пытается удалить все ожидающие заказы из облачных хранилищ. */
export async function flushDeletions(): Promise<number> {
  if (flushing) return getPendingDeletions().length;
  const pending = getPendingDeletions();
  if (pending.length === 0) return 0;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return pending.length;
  }

  flushing = true;
  try {
    const ids = pending.map((p) => p.id);

    const results = await Promise.allSettled([
      deleteOrdersFromDb(ids),
      withTimeout(
        Promise.all(ids.map((id) => deleteOrderFirebase(id))).then(
          () => undefined
        ),
        10_000
      ),
      deleteOrdersInSheets(pending),
    ]);

    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const name = ['supabase', 'firebase', 'sheets'][i];
        console.warn(`[orderDeletion] ${name} delete failed:`, r.reason);
      }
    });

    if (results.every((r) => r.status === 'fulfilled')) {
      removePendingDeletions(ids);
    }
  } finally {
    flushing = false;
  }
  return getPendingDeletions().length;
}

/**
 * Удалить заказы везде. Локально — сразу и безусловно;
 * в облаке — сразу, при сбое — повтором.
 * Возвращает, сколько заказов ещё ждут удаления в облаке.
 */
export async function deleteOrdersEverywhere(
  orders: Order[]
): Promise<{ pendingLeft: number }> {
  if (orders.length === 0) return { pendingLeft: getPendingDeletions().length };
  const ids = orders.map((o) => o.id);

  addPendingDeletions(
    orders.map((o) => ({ id: o.id, created_at: o.created_at }))
  );

  // Этим устройством заказ больше не отправляется и не показывается
  dropOrdersFromOutbox(ids);
  for (const id of ids) removeOperationsForOrder(id);
  removeOrdersLocally(ids);

  const pendingLeft = await flushDeletions();
  return { pendingLeft };
}

/** Фоновый повтор незавершённых удалений (вызывается из App). */
export function startDeletionSync(): () => void {
  void flushDeletions();
  const timer = window.setInterval(() => void flushDeletions(), RETRY_MS);
  const onOnline = () => void flushDeletions();
  window.addEventListener('online', onOnline);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('online', onOnline);
  };
}
