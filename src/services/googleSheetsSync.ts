// src/services/googleSheetsSync.ts
/**
 * Клиент синхронизации с Google Sheets через Apps Script.
 *
 * Два канала в одной очереди:
 *   - заказы: 'create' | 'update' | 'status' → лист MM.YY
 *   - меню:   'menu'                        → лист MENU (JSON, одна строка)
 *
 * Очередь — общая (pos_sync_queue). При flush:
 *   - заказы идут батчем (batchSize)
 *   - меню идёт отдельно (1 операция)
 */
import type {
  GoogleSheetsSyncConfig,
  SyncOperation,
  SyncStatusSnapshot,
} from '@/types/sync';
import {
  enqueueOperation,
  enqueueMenuOperation,
  getQueueSnapshot,
  getPendingOps,
  getState,
  hasUnfinishedOps,
  markFailed,
  markSynced,
  markSyncing,
  recoverOnStartup,
  retryAllFailed,
  subscribeQueue,
  updateState,
} from './syncQueue';
import type { MenuItem, Order } from '@/types/database';
import type { SyncOperationType } from '@/types/sync';

export interface FlushResult {
  applied: number;
  skipped: number;
  failed: number;
}

const EMPTY_RESULT: FlushResult = { applied: 0, skipped: 0, failed: 0 };

// ============================================================
// КОНФИГ
// ============================================================
function readEnv(key: string): string | undefined {
  try {
    const env = (import.meta as unknown as {
      env: Record<string, string | undefined>;
    }).env;
    return env?.[key];
  } catch {
    return undefined;
  }
}

function buildConfigFromEnv(): GoogleSheetsSyncConfig {
  const endpoint = readEnv('VITE_SHEETS_ENDPOINT') ?? '';
  const secret = readEnv('VITE_SHEETS_SECRET') ?? '';
  const enabledRaw = readEnv('VITE_SYNC_ENABLED') ?? 'false';
  const intervalRaw = readEnv('VITE_SYNC_INTERVAL_MS') ?? '15000';
  const batchRaw = readEnv('VITE_SYNC_BATCH_SIZE') ?? '25';

  const enabled = enabledRaw === 'true' && !!endpoint && !!secret;
  const intervalMs = Math.max(3000, parseInt(intervalRaw, 10) || 15000);
  const batchSize = Math.max(1, Math.min(100, parseInt(batchRaw, 10) || 25));

  return {
    endpoint,
    secret,
    intervalMs,
    batchSize,
    minRequestGapMs: 3000,
    maxAttempts: 10,
    enabled,
  };
}

// ============================================================
// ВНУТРЕННЕЕ СОСТОЯНИЕ
// ============================================================
let config: GoogleSheetsSyncConfig = buildConfigFromEnv();
let running = false;
let timer: number | null = null;
let isFlushing = false;
let lastRequestAt = 0;
let lastFlushAt: number | null = null;
let unsubscribeQueue: (() => void) | null = null;
let boundOnline: (() => void) | null = null;
let boundOffline: (() => void) | null = null;

// ============================================================
// HTTP
// ============================================================
interface AppsScriptResponse {
  ok: boolean;
  applied?: number;
  skipped?: number;
  total?: number;
  durationMs?: number;
  error?: string;
  warning?: string;
  results?: Array<{
    operationId: string | null;
    orderId: string | null;
    status: 'applied' | 'skipped' | 'error';
    action?: 'created' | 'updated';
    sheet?: string;
    row?: number;
    reason?: string;
    error?: string;
  }>;
}

async function postBatch(
  operations: SyncOperation[]
): Promise<AppsScriptResponse> {
  if (!config.endpoint) {
    throw new Error('VITE_SHEETS_ENDPOINT is not configured');
  }
  if (!config.secret) {
    throw new Error('VITE_SHEETS_SECRET is not configured');
  }

  const body = {
    secret: config.secret,
    operations: operations.map((op) => {
      const base = {
        operationId: op.operationId,
        orderId: op.orderId,
        operationType: op.operationType,
        createdAt: op.createdAt,
        version: op.version,
      };
      if (op.operationType === 'menu') {
        return { ...base, menuItems: op.menuItems ?? [] };
      }
      return { ...base, order: op.order };
    }),
  };

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: 'omit',
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const text = await res.text();
    let parsed: AppsScriptResponse;
    try {
      parsed = JSON.parse(text) as AppsScriptResponse;
    } catch {
      throw new Error(`Invalid JSON from Apps Script: ${text.slice(0, 200)}`);
    }
    if (!parsed.ok) {
      throw new Error(parsed.error || 'Apps Script returned ok:false');
    }
    return parsed;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// ============================================================
// FLUSH — один батч одного типа
// ============================================================
async function flushBatch(batch: SyncOperation[]): Promise<FlushResult> {
  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const op of batch) markSyncing(op.operationId);

  try {
    const response = await postBatch(batch);
    const results = response.results ?? [];
    const byId = new Map(
      results
        .filter((r) => r.operationId)
        .map((r) => [r.operationId as string, r])
    );

    for (const op of batch) {
      const r = byId.get(op.operationId);
      if (!r) {
        markFailed(op.operationId, 'No result returned from Apps Script');
        failed++;
        continue;
      }
      if (r.status === 'applied') {
        markSynced(op.operationId);
        applied++;
      } else if (r.status === 'skipped') {
        markSynced(op.operationId);
        skipped++;
      } else {
        markFailed(
          op.operationId,
          r.error || r.reason || 'Unknown Apps Script error'
        );
        failed++;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const op of batch) markFailed(op.operationId, message);
    failed = batch.length;
    updateState({
      lastError: message,
      consecutiveFailures: getState().consecutiveFailures + 1,
    });
  }

  return { applied, skipped, failed };
}

// ============================================================
// FLUSH — общий проход (заказы + меню)
// ============================================================
async function flushOnce(): Promise<FlushResult> {
  if (isFlushing) return EMPTY_RESULT;
  if (!config.enabled) return EMPTY_RESULT;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return EMPTY_RESULT;
  }

  const since = Date.now() - lastRequestAt;
  if (since < config.minRequestGapMs) return EMPTY_RESULT;

  const pending = getPendingOps();
  if (pending.length === 0) {
    lastFlushAt = Date.now();
    return EMPTY_RESULT;
  }

  const menuOps = pending.filter((op) => op.operationType === 'menu');
  const orderOps = pending.filter((op) => op.operationType !== 'menu');

  const total: FlushResult = { ...EMPTY_RESULT };

  isFlushing = true;
  lastRequestAt = Date.now();

  try {
    if (orderOps.length > 0) {
      const batch = orderOps.slice(0, config.batchSize);
      const r = await flushBatch(batch);
      total.applied += r.applied;
      total.skipped += r.skipped;
      total.failed += r.failed;
    }

    if (menuOps.length > 0) {
      const batch = menuOps.slice(0, 1); // только 1 MENU за проход
      const r = await flushBatch(batch);
      total.applied += r.applied;
      total.skipped += r.skipped;
      total.failed += r.failed;
    }

    lastFlushAt = Date.now();
    updateState({ lastSyncAt: Date.now(), lastError: null });
  } finally {
    isFlushing = false;
  }

  return total;
}

// ============================================================
// TIMER / NETWORK
// ============================================================
function schedule() {
  if (!running) return;
  if (timer != null) return;
  timer = window.setTimeout(async () => {
    timer = null;
    try {
      await flushOnce();
    } catch {
      /* swallow */
    }
    schedule();
  }, config.intervalMs);
}

function bindNetworkListeners() {
  if (typeof window === 'undefined') return;

  boundOnline = () => {
    void flushOnce();
  };
  boundOffline = () => {
    /* копим */
  };

  window.addEventListener('online', boundOnline);
  window.addEventListener('offline', boundOffline);
}

function unbindNetworkListeners() {
  if (typeof window === 'undefined') return;
  if (boundOnline) {
    window.removeEventListener('online', boundOnline);
    boundOnline = null;
  }
  if (boundOffline) {
    window.removeEventListener('offline', boundOffline);
    boundOffline = null;
  }
}

// ============================================================
// ПУБЛИЧНЫЙ API
// ============================================================
export function startGoogleSheetsSync(): void {
  if (running) return;
  running = true;
  recoverOnStartup();
  if (!config.enabled) return;

  unsubscribeQueue = subscribeQueue(() => {
    if (isFlushing) return;
    const gap = Date.now() - lastRequestAt;
    if (gap >= config.minRequestGapMs) {
      void flushOnce();
    }
  });

  bindNetworkListeners();
  schedule();
  void flushOnce();
}

export function stopGoogleSheetsSync(): void {
  running = false;
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (unsubscribeQueue) {
    unsubscribeQueue();
    unsubscribeQueue = null;
  }
  unbindNetworkListeners();
}

export async function flushNow(): Promise<FlushResult> {
  return flushOnce();
}

/**
 * Поставить операцию по заказу в очередь.
 */
export function enqueueForSync(
  order: Order,
  operationType: SyncOperationType
): void {
  enqueueOperation(order, operationType);
  if (config.enabled && running) {
    void flushOnce();
  }
}

/**
 * Поставить операцию MENU в очередь (payload = весь массив меню).
 * Не копит несколько — заменяет pending/failed MENU на новую.
 */
export function enqueueMenuForSync(items: MenuItem[]): void {
  enqueueMenuOperation(items);
  if (config.enabled && running) {
    void flushOnce();
  }
}

export function retryAllSyncFailed(): number {
  return retryAllFailed();
}

export function getSyncStatus(): SyncStatusSnapshot {
  const q = getQueueSnapshot();
  const st = getState();
  return {
    queueLength: q.total,
    pending: q.pending,
    syncing: q.syncing,
    failed: q.failed,
    synced: q.synced,
    lastSyncAt: st.lastSyncAt ?? lastFlushAt,
    lastError: st.lastError,
    isOnline:
      typeof navigator !== 'undefined' ? navigator.onLine : true,
    isRunning: running,
    consecutiveFailures: st.consecutiveFailures,
    menuPending: q.menuPending,
    menuFailed: q.menuFailed,
    ordersPending: q.ordersPending,
    ordersFailed: q.ordersFailed,
  };
}

export function hasUnsyncedWork(): boolean {
  return hasUnfinishedOps();
}

export function configureGoogleSheetsSync(
  patch: Partial<GoogleSheetsSyncConfig>
): void {
  config = { ...config, ...patch };
}
