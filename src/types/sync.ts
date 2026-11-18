// src/types/sync.ts
import type { MenuItem, Order } from '@/types/database';

/**
 * Тип операции в очереди.
 *   'create' | 'update' | 'status'  — заказы (payload = order)
 *   'menu'                          — меню (payload = menuItems[], orderId = 'MENU')
 */
export type SyncOperationType = 'create' | 'update' | 'status' | 'menu';

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

/**
 * Одна операция синхронизации.
 * Живёт в localStorage под ключом `pos_sync_queue`.
 * Зеркало в Firebase `sync_queue/{operationId}`.
 */
export interface SyncOperation {
  operationId: string;

  /** Id заказа. Для MENU-операции = 'MENU'. */
  orderId: string;

  operationType: SyncOperationType;

  /** Оригинальный createdAt заказа (ISO). Для MENU — время операции. */
  createdAt: string;

  /** Версия per orderId (для MENU — монотонно растёт на каждой операции). */
  version: number;

  syncStatus: SyncStatus;
  attempts: number;
  lastAttemptAt: number | null;
  nextAttemptAt: number;
  lastError: string | null;

  /** Полный заказ. Для MENU — пустышка (не используется). */
  order: Order;

  /** Полный массив меню. Только для operationType === 'menu'. */
  menuItems?: MenuItem[];
}

/**
 * Состояние синхронизации (агрегат по устройству).
 * localStorage `pos_sync_state`.
 */
export interface SyncState {
  lastSyncAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  totalSynced: number;
  totalFailed: number;
}

/**
 * Снимок для UI / диагностики.
 */
export interface SyncStatusSnapshot {
  queueLength: number;
  pending: number;
  syncing: number;
  failed: number;
  synced: number;
  lastSyncAt: number | null;
  lastError: string | null;
  isOnline: boolean;
  isRunning: boolean;
  consecutiveFailures: number;

  /** Разбивка по типам (опционально — заполняется из queueSnapshot) */
  menuPending?: number;
  menuFailed?: number;
  ordersPending?: number;
  ordersFailed?: number;
}

/**
 * Настройки клиента синхронизации.
 */
export interface GoogleSheetsSyncConfig {
  endpoint: string;
  secret: string;
  intervalMs: number;
  batchSize: number;
  minRequestGapMs: number;
  maxAttempts: number;
  enabled: boolean;
}
