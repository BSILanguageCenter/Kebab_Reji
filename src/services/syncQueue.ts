// src/services/syncQueue.ts
import type { MenuItem, Order } from '@/types/database';
import type {
  SyncOperation,
  SyncOperationType,
  SyncState,
  SyncStatus,
} from '@/types/sync';
import { uuid } from '@/lib/uuid';
import {
  pushSyncOperation,
  updateSyncOperation,
  removeSyncOperation,
} from './firebaseSync';

// ============================================================
// КОНСТАНТЫ
// ============================================================
const QUEUE_KEY = 'pos_sync_queue';
const STATE_KEY = 'pos_sync_state';
const DEVICE_KEY = 'pos_device_id';

const MAX_QUEUE_SIZE = 2000;
const MAX_ATTEMPTS = 10;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 60_000;
const KEEP_SYNCED_MS = 7 * 24 * 60 * 60 * 1000;

// ============================================================
// STATE
// ============================================================
function defaultState(): SyncState {
  return {
    lastSyncAt: null,
    lastError: null,
    consecutiveFailures: 0,
    totalSynced: 0,
    totalFailed: 0,
  };
}

// ============================================================
// DEVICE ID
// ============================================================
let cachedDeviceId: string | null = null;

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) {
      cachedDeviceId = existing;
      return existing;
    }
  } catch {
    /* ignore */
  }
  const fresh = uuid();
  try {
    localStorage.setItem(DEVICE_KEY, fresh);
  } catch {
    /* ignore */
  }
  cachedDeviceId = fresh;
  return fresh;
}

// ============================================================
// IN-MEMORY CACHE + NOTIFY
// ============================================================
let queueCache: SyncOperation[] | null = null;
let stateCache: SyncState | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });
}

// ============================================================
// QUEUE READ / WRITE
// ============================================================
function readQueueRaw(): SyncOperation[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SyncOperation[]) : [];
  } catch {
    return [];
  }
}

export function getQueue(): SyncOperation[] {
  if (queueCache == null) {
    queueCache = readQueueRaw();
  }
  return queueCache;
}

function writeQueue(queue: SyncOperation[]): void {
  queueCache = queue;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* ignore */
  }
  notify();
}

function trimQueue(queue: SyncOperation[]): SyncOperation[] {
  if (queue.length <= MAX_QUEUE_SIZE) {
    const now = Date.now();
    return queue.filter((op) => {
      if (op.syncStatus !== 'synced') return true;
      const t = op.lastAttemptAt ?? 0;
      return now - t < KEEP_SYNCED_MS;
    });
  }
  const synced = queue.filter((op) => op.syncStatus === 'synced');
  const notSynced = queue.filter((op) => op.syncStatus !== 'synced');
  const needToDrop = queue.length - MAX_QUEUE_SIZE;
  const sortedSynced = [...synced].sort(
    (a, b) => (a.lastAttemptAt ?? 0) - (b.lastAttemptAt ?? 0)
  );
  const keptSynced = sortedSynced.slice(needToDrop);
  return [...notSynced, ...keptSynced];
}

// ============================================================
// STATE READ / WRITE
// ============================================================
export function getState(): SyncState {
  if (stateCache == null) {
    // Сначала гарантируем «не null», потом пытаемся прочитать из storage
    stateCache = defaultState();
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          stateCache = {
            ...defaultState(),
            ...(parsed as Partial<SyncState>),
          };
        }
      }
    } catch {
      /* ignore — останется default */
    }
  }
  return stateCache;
}

export function updateState(patch: Partial<SyncState>): SyncState {
  const next: SyncState = { ...getState(), ...patch };
  stateCache = next;
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  notify();
  return next;
}

// ============================================================
// ENQUEUE — заказы
// ============================================================
function computeNextVersion(
  queue: SyncOperation[],
  orderId: string
): number {
  let max = 0;
  for (const op of queue) {
    if (op.orderId === orderId && op.version > max) {
      max = op.version;
    }
  }
  return max + 1;
}

export function enqueueOperation(
  order: Order,
  operationType: SyncOperationType
): SyncOperation {
  const queue = [...getQueue()];
  const version = computeNextVersion(queue, order.id);

  const op: SyncOperation = {
    operationId: uuid(),
    orderId: order.id,
    operationType,
    createdAt: order.created_at,
    version,
    syncStatus: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: Date.now(),
    lastError: null,
    order,
  };

  queue.push(op);
  writeQueue(trimQueue(queue));
  void pushSyncOperation(op);
  return op;
}

// ============================================================
// ENQUEUE — MENU
// ============================================================
export function enqueueMenuOperation(menuItems: MenuItem[]): SyncOperation {
  const queue = [...getQueue()];

  const filtered = queue.filter(
    (op) =>
      !(
        op.operationType === 'menu' &&
        (op.syncStatus === 'pending' || op.syncStatus === 'failed')
      )
  );

  let maxVersion = 0;
  for (const op of queue) {
    if (op.operationType === 'menu' && op.version > maxVersion) {
      maxVersion = op.version;
    }
  }

  const now = new Date().toISOString();
  const op: SyncOperation = {
    operationId: uuid(),
    orderId: 'MENU',
    operationType: 'menu',
    createdAt: now,
    version: maxVersion + 1,
    syncStatus: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: Date.now(),
    lastError: null,
    order: {
      id: 'MENU',
      order_number: 0,
      order_type: 'OUTSIDE',
      status: 'NEW',
      total_amount: 0,
      comment: '',
      created_at: now,
      updated_at: now,
      completed_at: null,
      order_items: [],
    },
    menuItems,
  };

  filtered.push(op);
  writeQueue(trimQueue(filtered));
  void pushSyncOperation(op);
  return op;
}

// ============================================================
// OPERATION UPDATES
// ============================================================
function findIndex(
  queue: SyncOperation[],
  operationId: string
): number {
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].operationId === operationId) return i;
  }
  return -1;
}

export function markSyncing(operationId: string): void {
  const queue = [...getQueue()];
  const idx = findIndex(queue, operationId);
  if (idx === -1) return;
  const op = queue[idx];
  if (op.syncStatus !== 'pending') return;

  const lastAttemptAt = Date.now();
  queue[idx] = { ...op, syncStatus: 'syncing', lastAttemptAt };
  writeQueue(queue);
  void updateSyncOperation(operationId, {
    syncStatus: 'syncing',
    lastAttemptAt,
  });
}

export function markSynced(operationId: string): void {
  const queue = [...getQueue()];
  const idx = findIndex(queue, operationId);
  if (idx === -1) return;
  const op = queue[idx];

  queue[idx] = {
    ...op,
    syncStatus: 'synced',
    lastAttemptAt: Date.now(),
    lastError: null,
  };
  writeQueue(queue);

  void removeSyncOperation(operationId);

  const state = getState();
  updateState({
    lastSyncAt: Date.now(),
    lastError: null,
    consecutiveFailures: 0,
    totalSynced: state.totalSynced + 1,
  });
}

function computeBackoff(attempts: number): number {
  const exp = Math.min(
    BACKOFF_MAX_MS,
    BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempts - 1))
  );
  const jitter = exp * 0.2 * (Math.random() * 2 - 1);
  return Math.round(exp + jitter);
}

export function markFailed(
  operationId: string,
  error: string
): { becameTerminal: boolean } {
  const queue = [...getQueue()];
  const idx = findIndex(queue, operationId);
  if (idx === -1) return { becameTerminal: false };

  const op = queue[idx];
  const attempts = op.attempts + 1;
  const terminal = attempts >= MAX_ATTEMPTS;
  const nextAttemptAt = terminal
    ? Number.MAX_SAFE_INTEGER
    : Date.now() + computeBackoff(attempts);

  queue[idx] = {
    ...op,
    syncStatus: terminal ? 'failed' : 'pending',
    attempts,
    lastAttemptAt: Date.now(),
    nextAttemptAt,
    lastError: error || 'Unknown error',
  };
  writeQueue(queue);

  void updateSyncOperation(operationId, {
    syncStatus: queue[idx].syncStatus,
    attempts,
    lastAttemptAt: queue[idx].lastAttemptAt,
    nextAttemptAt,
    lastError: queue[idx].lastError,
  });

  const state = getState();
  updateState({
    lastError: error || 'Unknown error',
    consecutiveFailures: state.consecutiveFailures + 1,
    totalFailed: terminal ? state.totalFailed + 1 : state.totalFailed,
  });

  return { becameTerminal: terminal };
}

export function retryAllFailed(): number {
  const queue = [...getQueue()];
  let count = 0;
  const now = Date.now();

  for (let i = 0; i < queue.length; i++) {
    if (queue[i].syncStatus === 'failed') {
      queue[i] = {
        ...queue[i],
        syncStatus: 'pending',
        attempts: 0,
        nextAttemptAt: now,
      };
      count++;
      void updateSyncOperation(queue[i].operationId, {
        syncStatus: 'pending',
        attempts: 0,
        nextAttemptAt: now,
      });
    }
  }

  if (count > 0) {
    writeQueue(queue);
    updateState({ consecutiveFailures: 0 });
  }
  return count;
}

/**
 * Повторить одну операцию (для UI-кнопки «Retry»).
 * Возвращает true, если операция найдена и переведена в pending.
 */
export function retryOperation(operationId: string): boolean {
  const queue = [...getQueue()];
  const idx = findIndex(queue, operationId);
  if (idx === -1) return false;

  const op = queue[idx];
  const now = Date.now();
  queue[idx] = {
    ...op,
    syncStatus: 'pending',
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
  };
  writeQueue(queue);
  void updateSyncOperation(operationId, {
    syncStatus: 'pending',
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
  });
  return true;
}

/**
 * Удалить операцию из очереди (для UI-кнопки «Remove»).
 * Возвращает true, если операция найдена.
 */
export function removeOperation(operationId: string): boolean {
  const queue = [...getQueue()];
  const idx = findIndex(queue, operationId);
  if (idx === -1) return false;

  const next = queue.filter((op) => op.operationId !== operationId);
  writeQueue(next);
  void removeSyncOperation(operationId);
  return true;
}

/**
 * Вернуть все операции (для UI-панели SyncPanel).
 */
export function getAllOperations(): SyncOperation[] {
  return [...getQueue()];
}

// ============================================================
// PENDING
// ============================================================
export function getPendingOps(now: number = Date.now()): SyncOperation[] {
  return getQueue()
    .filter((op) => op.syncStatus === 'pending' && op.nextAttemptAt <= now)
    .sort((a, b) => {
      if (a.nextAttemptAt !== b.nextAttemptAt) {
        return a.nextAttemptAt - b.nextAttemptAt;
      }
      return a.orderId.localeCompare(b.orderId);
    });
}

export function hasUnfinishedOps(): boolean {
  return getQueue().some(
    (op) =>
      op.syncStatus === 'pending' ||
      op.syncStatus === 'syncing' ||
      op.syncStatus === 'failed'
  );
}

// ============================================================
// RECOVERY
// ============================================================
export function recoverOnStartup(): { resetCount: number } {
  const queue = [...getQueue()];
  let resetCount = 0;
  const now = Date.now();

  for (let i = 0; i < queue.length; i++) {
    if (queue[i].syncStatus === 'syncing') {
      queue[i] = {
        ...queue[i],
        syncStatus: 'pending',
        nextAttemptAt: now,
      };
      resetCount++;
    }
  }

  if (resetCount > 0) {
    writeQueue(queue);
  }
  return { resetCount };
}

// ============================================================
// SNAPSHOT
// ============================================================
export interface QueueSnapshot {
  total: number;
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
  menuPending: number;
  menuFailed: number;
  ordersPending: number;
  ordersFailed: number;
}

export function getQueueSnapshot(): QueueSnapshot {
  const queue = getQueue();
  const snap: QueueSnapshot = {
    total: queue.length,
    pending: 0,
    syncing: 0,
    synced: 0,
    failed: 0,
    menuPending: 0,
    menuFailed: 0,
    ordersPending: 0,
    ordersFailed: 0,
  };
  for (const op of queue) {
    const s = op.syncStatus as SyncStatus;
    if (s === 'pending') snap.pending++;
    else if (s === 'syncing') snap.syncing++;
    else if (s === 'synced') snap.synced++;
    else if (s === 'failed') snap.failed++;

    if (op.operationType === 'menu') {
      if (s === 'pending' || s === 'syncing') snap.menuPending++;
      if (s === 'failed') snap.menuFailed++;
    } else {
      if (s === 'pending' || s === 'syncing') snap.ordersPending++;
      if (s === 'failed') snap.ordersFailed++;
    }
  }
  return snap;
}

// ============================================================
// DEV
// ============================================================
export function clearQueue(): void {
  writeQueue([]);
  updateState(defaultState());
}
