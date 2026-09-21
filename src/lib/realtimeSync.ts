// src/lib/realtimeSync.ts
import { supabase } from '@/lib/supabase';
import { invalidateMenuCache } from '@/lib/menuCache';
import { invalidateOrdersCache } from '@/lib/ordersCache';
import { onLanMessage, sendLanMessage } from '@/lib/lanSync';

// ─── События синхронизации ──────────────────────────────────────────────────
export type SyncEvent =
  | 'menu-changed'
  | 'tables-changed'
  | 'orders-changed'
  | 'payments-changed'
  | 'settings-changed';

type SyncListener = (event: SyncEvent, source: 'local' | 'remote') => void;

const listeners = new Set<SyncListener>();
let started = false;

// ═══════════════════════════════════════════════════════════════════════════
// ПУБЛИЧНЫЙ API
// ═══════════════════════════════════════════════════════════════════════════
export function onSyncEvent(cb: SyncListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emit(event: SyncEvent, source: 'local' | 'remote') {
  listeners.forEach((cb) => {
    try {
      cb(event, source);
    } catch (e) {
      console.warn('[Sync] listener error:', e);
    }
  });
}

/**
 * Вызывается локально после того, как устройство сделало изменение.
 * Отправляет broadcast в LAN, чтобы другие устройства сразу обновились.
 */
export function notifyLocalChange(event: SyncEvent): void {
  emit(event, 'local');
  sendLanMessage({ type: 'data-changed', event });
}

// ═══════════════════════════════════════════════════════════════════════════
// СТАРТ
// ═══════════════════════════════════════════════════════════════════════════
export function startRealtimeSync(): void {
  if (started) return;
  started = true;

  // ─── 1. Supabase Realtime ─────────────────────────────────────────────
  const channel = supabase
    .channel('global-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'products' },
      () => {
        invalidateMenuCache();
        emit('menu-changed', 'remote');
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'categories' },
      () => {
        invalidateMenuCache();
        emit('menu-changed', 'remote');
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'restaurant_tables' },
      () => emit('tables-changed', 'remote')
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      () => {
        invalidateOrdersCache();
        emit('orders-changed', 'remote');
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_items' },
      () => {
        invalidateOrdersCache();
        emit('orders-changed', 'remote');
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'payments' },
      () => {
        invalidateOrdersCache();
        emit('payments-changed', 'remote');
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'restaurant_settings' },
      () => emit('settings-changed', 'remote')
    )
    .subscribe();

  console.log('[Sync] Supabase Realtime подписан на 7 таблиц');

  // ─── 2. LAN hub ───────────────────────────────────────────────────────
  onLanMessage((msg) => {
    if (msg.type !== 'data-changed') return;
    const event = msg.event as SyncEvent;

    console.log(`[Sync] LAN-событие: ${event}`);

    if (event === 'menu-changed') invalidateMenuCache();
    if (event === 'orders-changed' || event === 'payments-changed')
      invalidateOrdersCache();

    emit(event, 'remote');
  });

  console.log('[Sync] LAN-hub слушатель установлен');

  // Синхронизация работает, пока открыт браузер.
  // Cleanup не нужен — при закрытии вкладки все подписки сами отвалятся.
  // (channel не удаляем — supabase сам почистит)
  void channel;
}