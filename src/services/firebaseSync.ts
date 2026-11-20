// src/services/firebaseSync.ts
/**
 * Firebase Realtime Database — ТОЛЬКО заказы и очередь синхронизации.
 * Меню сюда НЕ пишется — оно в Supabase DB.
 *
 * Узлы:
 *   orders/{orderId}       — Order (realtime для всех устройств)
 *   sync_queue/{opId}      — SyncOperation (зеркало pos_sync_queue для recovery)
 */
import {
  ref,
  onValue,
  set,
  update,
  remove,
  runTransaction,
  Unsubscribe,
} from 'firebase/database';
import { db } from '@/lib/firebase';
import type { Order } from '@/types/database';
import type { SyncOperation } from '@/types/sync';

// ============================================================
// ЗАКАЗЫ (realtime)
// ============================================================

export function listenToOrders(
  callback: (orders: Order[]) => void
): Unsubscribe {
  const ordersRef = ref(db, 'orders');

  return onValue(
    ordersRef,
    (snapshot) => {
      const data = snapshot.val() as Record<string, Order> | null;
      if (!data) {
        callback([]);
        return;
      }
      const orders = Object.entries(data).map(([id, o]) => ({
        ...o,
        id, // ключ RTDB = primary id
      }));
      orders.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      callback(orders);
    },
    (error) => {
      console.error('[firebaseSync] listenToOrders error:', error);
    }
  );
}

export async function saveOrder(order: Order): Promise<void> {
  try {
    await set(ref(db, `orders/${order.id}`), order);
  } catch (e) {
    console.error('[firebaseSync] saveOrder failed:', e);
    throw e;
  }
}

export async function updateOrderStatus(
  orderId: string,
  status: string
): Promise<void> {
  try {
    await update(ref(db, `orders/${orderId}`), {
      status,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[firebaseSync] updateOrderStatus failed:', e);
    throw e;
  }
}

export async function deleteOrder(orderId: string): Promise<void> {
  try {
    await remove(ref(db, `orders/${orderId}`));
  } catch (e) {
    console.error('[firebaseSync] deleteOrder failed:', e);
    throw e;
  }
}

// ============================================================
// ОБЩИЙ НОМЕР ЗАКАЗА (один счётчик на все устройства, каждый день с 1)
// ============================================================
/**
 * Атомарно выдаёт следующий номер заказа на указанную дату.
 *
 * @param day   дата 'YYYY-MM-DD' — для каждого дня свой счётчик,
 *              поэтому на следующий день нумерация начинается с 1.
 * @param floor максимальный номер, который уже есть на этом устройстве
 *              за сегодня. Счётчик никогда не выдаст число <= floor,
 *              поэтому нумерация ПРОДОЛЖАЕТ текущий номер.
 *
 * Бросает ошибку, если нет сети (таймаут 2.5 с) — вызывающий код берёт
 * запасной локальный номер.
 */
export async function nextSharedOrderNumber(
  day: string,
  floor: number
): Promise<number> {
  const counterRef = ref(db, `counters/orderNumber/${day}`);
  const res = await Promise.race([
    runTransaction(counterRef, (cur: unknown) =>
      Math.max(typeof cur === 'number' ? cur : 0, floor) + 1
    ),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
  ]);
  if (!res || !res.committed) throw new Error('counter unavailable');
  return res.snapshot.val() as number;
}

// ============================================================
// ОЧЕРЕДЬ СИНХРОНИЗАЦИИ (зеркало pos_sync_queue)
// ============================================================
// Цель зеркала:
//   - Видимость очереди между устройствами
//   - Recovery: если операция «зависла» в syncing на одном устройстве,
//     другое устройство при старте видит её и может обработать.
//
// ВАЖНО: listenToSyncQueue НЕ триггерит push обратно.
// Он только для UI-индикатора и recovery.

/**
 * Отправить операцию в RTDB `sync_queue/{opId}`.
 * Вызывается при enqueueOperation / enqueueMenuOperation.
 * Ошибка не критична — очередь в localStorage остаётся primary.
 */
export async function pushSyncOperation(
  operation: SyncOperation
): Promise<void> {
  try {
    await set(
      ref(db, `sync_queue/${operation.operationId}`),
      operation
    );
  } catch (e) {
    console.warn('[firebaseSync] pushSyncOperation failed:', e);
  }
}

/**
 * Обновить статус операции в RTDB (syncing / failed / pending).
 */
export async function updateSyncOperation(
  operationId: string,
  patch: Partial<SyncOperation>
): Promise<void> {
  try {
    await update(ref(db, `sync_queue/${operationId}`), patch);
  } catch (e) {
    console.warn('[firebaseSync] updateSyncOperation failed:', e);
  }
}

/**
 * Удалить операцию из RTDB после synced — другим устройствам она не нужна.
 */
export async function removeSyncOperation(
  operationId: string
): Promise<void> {
  try {
    await remove(ref(db, `sync_queue/${operationId}`));
  } catch (e) {
    console.warn('[firebaseSync] removeSyncOperation failed:', e);
  }
}

/**
 * Слушать `sync_queue` в RTDB.
 * Используется для отображения «что видят другие устройства» и recovery.
 * НЕ пишет обратно в RTDB и не триггерит flush.
 */
export function listenToSyncQueue(
  callback: (operations: SyncOperation[]) => void
): Unsubscribe {
  const queueRef = ref(db, 'sync_queue');

  return onValue(
    queueRef,
    (snapshot) => {
      const data = snapshot.val() as Record<string, SyncOperation> | null;
      if (!data) {
        callback([]);
        return;
      }
      const ops = Object.entries(data).map(([id, op]) => ({
        ...op,
        operationId: id,
      }));
      callback(ops);
    },
    (error) => {
      console.error('[firebaseSync] listenToSyncQueue error:', error);
    }
  );
}

/**
 * Удалить «старые» операции из RTDB (synced старше maxAgeMs).
 * Вызывается периодически в App.tsx или вручную.
 */
export async function cleanupSyncQueue(
  maxAgeMs: number = 24 * 60 * 60 * 1000
): Promise<void> {
  const queueRef = ref(db, 'sync_queue');
  let snapshot: Record<string, SyncOperation> | null = null;
  try {
    snapshot = await new Promise<Record<string, SyncOperation> | null>(
      (resolve) => {
        const unsub = onValue(queueRef, (s) => {
          resolve(s.val() as Record<string, SyncOperation> | null);
          unsub();
        });
      }
    );
  } catch (e) {
    console.warn('[firebaseSync] cleanupSyncQueue read failed:', e);
    return;
  }
  if (!snapshot) return;

  const now = Date.now();
  const toRemove: string[] = [];
  for (const [id, op] of Object.entries(snapshot)) {
    if (
      op.syncStatus === 'synced' &&
      op.lastAttemptAt != null &&
      now - op.lastAttemptAt > maxAgeMs
    ) {
      toRemove.push(id);
    }
  }
  for (const id of toRemove) {
    await remove(ref(db, `sync_queue/${id}`));
  }
}
