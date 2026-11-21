// src/services/supabaseOrders.ts
/**
 * Заказы в Supabase — основное хранилище.
 *
 *  - запись: outbox (localStorage) → upsert в таблицу `orders`.
 *    Нет интернета → заказ лежит в outbox и уходит, когда сеть вернулась.
 *  - чтение: fetchOrdersRange() для статистики (с пагинацией).
 *  - realtime: изменения с других устройств прилетают сразу,
 *    после обрыва связи — догрузка пропущенного.
 *  - номер заказа: общий счётчик в БД (rpc next_order_number).
 *  - номер устройства: rpc register_device (1, 2, 3 ...).
 *
 * Google Sheets остаётся фоновой копией (googleSheetsSync.ts, как раньше).
 */
import { supabase } from '@/lib/supabase';
import type { Order } from '@/types/database';
import { getDeviceId } from './syncQueue';

const TABLE = 'orders';
const OUTBOX_KEY = 'pos_orders_outbox';
const MIGRATION_KEY = 'pos_orders_migrated_v1'; // 'started' | 'done'
const DEVICE_NO_KEY = 'pos_device_no';
const PAGE = 1000;
const UPSERT_CHUNK = 200;
const RETRY_MS = 10_000;

// ============================================================
// ВСПОМОГАТЕЛЬНОЕ
// ============================================================
function dayStr(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

function toRow(o: Order) {
  return {
    id: o.id,
    order_number: o.order_number,
    order_day: dayStr(o.created_at),
    device_no: o.device_no ?? 1,
    order_type: o.order_type,
    status: o.status,
    total_amount: o.total_amount,
    comment: o.comment ?? '',
    created_at: o.created_at,
    updated_at: o.updated_at,
    completed_at: o.completed_at ?? null,
    // Время смены статуса: по нему сервер (триггер orders_merge) решает,
    // чья смена статуса новее. Нет поля — берём created_at (самое раннее),
    // чтобы правка позиций не перебила свежий статус другого устройства.
    status_updated_at: o.status_updated_at ?? o.created_at,
    data: o,
  };
}

interface OrderRow {
  data: unknown;
  status_updated_at?: string | null;
  deleted_at?: string | null;
  server_updated_at?: string | null;
}

const ORDER_COLS = 'data, status_updated_at, deleted_at, server_updated_at';

function orderFromRow(r: OrderRow): Order | null {
  const o = r.data as Order | null;
  if (!o || typeof o !== 'object' || !o.id) return null;
  return {
    ...o,
    status_updated_at: r.status_updated_at ?? o.status_updated_at ?? null,
  };
}

function tsOf(s?: string | null): number {
  const t = s ? new Date(s).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

// ============================================================
// НОМЕР УСТРОЙСТВА
// ============================================================
export function getCachedDeviceNo(): number | null {
  try {
    const v = parseInt(localStorage.getItem(DEVICE_NO_KEY) ?? '', 10);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Регистрирует устройство в БД (один раз) и запоминает его номер. */
export async function ensureDeviceNo(): Promise<number | null> {
  const cached = getCachedDeviceNo();
  if (cached) return cached;
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('register_device', { p_device_id: getDeviceId() }),
      5000
    );
    if (error) throw error;
    const n = Number(data);
    if (Number.isFinite(n) && n > 0) {
      try {
        localStorage.setItem(DEVICE_NO_KEY, String(n));
      } catch {
        /* ignore */
      }
      return n;
    }
  } catch (e) {
    console.warn('[supabaseOrders] register_device failed:', e);
  }
  return null;
}

// ============================================================
// ОБЩИЙ НОМЕР ЗАКАЗА
// ============================================================
/** Атомарно выдаёт следующий номер дня. Бросает ошибку, если нет сети. */
export async function nextOrderNumberFromDb(
  day: string,
  floor: number
): Promise<number> {
  const { data, error } = await withTimeout(
    supabase.rpc('next_order_number', { p_day: day, p_floor: floor }),
    2500
  );
  if (error) throw error;
  const n = Number(data);
  if (!Number.isFinite(n)) throw new Error('bad counter response');
  return n;
}

// ============================================================
// OUTBOX (запись)
// ============================================================
function loadOutbox(): Map<string, Order> {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw) as Order[];
    return new Map(arr.map((o) => [o.id, o]));
  } catch {
    return new Map();
  }
}

const outbox: Map<string, Order> =
  typeof window !== 'undefined' ? loadOutbox() : new Map();

// Заказы, которые сервер отклонил: не блокируем ими остальную очередь,
// пробуем снова через минуту.
const badUntil = new Map<string, number>();
const BAD_RETRY_MS = 60_000;

export function stuckOrdersCount(): number {
  const now = Date.now();
  let n = 0;
  for (const id of outbox.keys()) if ((badUntil.get(id) ?? 0) > now) n++;
  return n;
}

// Вторая вкладка пишет в тот же ключ — подхватываем её записи, чтобы
// не затирать их своей копией.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== OUTBOX_KEY) return;
    const fresh = loadOutbox();
    for (const [id, o] of fresh) {
      const mine = outbox.get(id);
      if (!mine || tsOf(o.updated_at) > tsOf(mine.updated_at)) outbox.set(id, o);
    }
  });
}

function persistOutbox() {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([...outbox.values()]));
  } catch (e) {
    console.warn('[supabaseOrders] outbox persist failed:', e);
  }
}

export function hasPendingOrder(id: string): boolean {
  return outbox.has(id);
}

export function pendingOrdersCount(): number {
  return outbox.size;
}

export function isOrdersMigrated(): boolean {
  try {
    return localStorage.getItem(MIGRATION_KEY) === 'done';
  } catch {
    return false;
  }
}

let flushing = false;

async function flushOutbox(): Promise<void> {
  if (flushing || outbox.size === 0) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const now = Date.now();
  const batch = [...outbox.values()]
    .filter((o) => (badUntil.get(o.id) ?? 0) <= now)
    .slice(0, UPSERT_CHUNK);
  if (batch.length === 0) return;

  flushing = true;
  let progressed = false;
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert(batch.map(toRow), { onConflict: 'id' });
    if (error) throw error;

    // удаляем только те, что не изменились, пока шёл запрос
    for (const o of batch) {
      if (outbox.get(o.id) === o) outbox.delete(o.id);
    }
    progressed = true;
  } catch (e) {
    console.warn('[supabaseOrders] batch flush failed:', e);
    // Один плохой заказ не должен держать остальные: шлём по одному.
    if (batch.length > 1) {
      for (const o of batch) {
        try {
          const { error } = await supabase
            .from(TABLE)
            .upsert([toRow(o)], { onConflict: 'id' });
          if (error) throw error;
          if (outbox.get(o.id) === o) outbox.delete(o.id);
          badUntil.delete(o.id);
          progressed = true;
        } catch (e2) {
          console.warn('[supabaseOrders] order rejected:', o.id, e2);
          badUntil.set(o.id, Date.now() + BAD_RETRY_MS);
        }
      }
    } else {
      // сеть/сервер недоступны — повторим по таймеру; помечаем,
      // только если заказ отклонён самим сервером (не сетевая ошибка)
      const msg = String((e as { message?: string })?.message ?? e);
      if (!/fetch|network|timeout|Failed/i.test(msg)) {
        badUntil.set(batch[0].id, Date.now() + BAD_RETRY_MS);
      }
    }
  } finally {
    persistOutbox();
    if (outbox.size === 0) {
      try {
        if (localStorage.getItem(MIGRATION_KEY) === 'started') {
          localStorage.setItem(MIGRATION_KEY, 'done');
        }
      } catch {
        /* ignore */
      }
    }
    flushing = false;
  }

  if (progressed && outbox.size > 0) void flushOutbox();
}

/** Убрать заказы из очереди отправки (перед удалением). */
export function dropOrdersFromOutbox(ids: string[]): void {
  let changed = false;
  for (const id of ids) {
    if (outbox.delete(id)) changed = true;
  }
  if (changed) persistOutbox();
}

/** Поставить заказ (новый или изменённый) на отправку в Supabase. */
export function queueOrderToDb(order: Order): void {
  outbox.set(order.id, order);
  persistOutbox();
  void flushOutbox();
}

/**
 * Запуск: разовая загрузка старых локальных заказов в Supabase,
 * повторная отправка по таймеру и при возвращении сети.
 */
export function startOrdersOutbox(getLocalOrders: () => Order[]): () => void {
  try {
    if (!localStorage.getItem(MIGRATION_KEY)) {
      for (const o of getLocalOrders()) outbox.set(o.id, o);
      persistOutbox();
      localStorage.setItem(MIGRATION_KEY, 'started');
    }
  } catch {
    /* ignore */
  }

  void ensureDeviceNo();
  void flushOutbox();

  const timer = window.setInterval(() => void flushOutbox(), RETRY_MS);
  const onOnline = () => void flushOutbox();
  window.addEventListener('online', onOnline);

  return () => {
    window.clearInterval(timer);
    window.removeEventListener('online', onOnline);
  };
}

// ============================================================
// ЧТЕНИЕ
// ============================================================
async function fetchPaged(
  build: (from: number, to: number) => PromiseLike<{
    data: OrderRow[] | null;
    error: { message: string } | null;
  }>
): Promise<OrderRow[]> {
  const result: OrderRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`Supabase orders fetch failed: ${error.message}`);
    const rows = data ?? [];
    result.push(...rows);
    if (rows.length < PAGE) break;
  }
  return result;
}

/** Заказы за период (для статистики). Удалённые не показываем. */
export async function fetchOrdersRange(
  startIso: string,
  endIso: string
): Promise<Order[]> {
  const rows = await fetchPaged((from, to) =>
    supabase
      .from(TABLE)
      .select(ORDER_COLS)
      .is('deleted_at', null)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: true })
      .range(from, to)
  );
  const out: Order[] = [];
  for (const r of rows) {
    const o = orderFromRow(r);
    if (o) out.push(o);
  }
  return out;
}

export interface OrdersDelta {
  orders: Order[];
  deletedIds: string[];
  /** Самое позднее server_updated_at среди полученных строк. */
  lastServerAt: string | null;
}

/**
 * Что изменилось на сервере после указанного момента: изменённые заказы
 * и удалённые (мягкое удаление). Время — серверное, часы устройств
 * не влияют.
 */
export async function fetchOrdersUpdatedSince(
  sinceIso: string
): Promise<OrdersDelta> {
  const rows = await fetchPaged((from, to) =>
    supabase
      .from(TABLE)
      .select(`id, ${ORDER_COLS}`)
      .gte('server_updated_at', sinceIso)
      .order('server_updated_at', { ascending: true })
      .range(from, to)
  );
  const orders: Order[] = [];
  const deletedIds: string[] = [];
  let lastServerAt: string | null = null;
  for (const r of rows as Array<OrderRow & { id?: string }>) {
    if (r.server_updated_at && tsOf(r.server_updated_at) >= tsOf(lastServerAt)) {
      lastServerAt = r.server_updated_at;
    }
    if (r.deleted_at) {
      const id = r.id ?? (r.data as Order | null)?.id;
      if (id) deletedIds.push(id);
      continue;
    }
    const o = orderFromRow(r);
    if (o) orders.push(o);
  }
  return { orders, deletedIds, lastServerAt };
}

// ============================================================
// УДАЛЕНИЕ
// ============================================================
/**
 * Мягкое удаление: ставит deleted_at. Строка остаётся в таблице, поэтому
 * все устройства (в том числе бывшие офлайн) узнают об удалении через
 * catch-up, а устаревший outbox не воскресит заказ.
 * Бросает ошибку при сбое.
 */
export async function deleteOrdersFromDb(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await withTimeout(
      supabase
        .from(TABLE)
        .update({ deleted_at: new Date().toISOString() })
        .in('id', chunk)
        .select('id'),
      15_000
    );
    if (error) throw new Error(`Supabase delete failed: ${error.message}`);
    console.info(
      `[orderDeletion] supabase: marked ${data?.length ?? 0} of ${chunk.length}`
    );

    // Если не помечены — RLS молча запретил UPDATE (ошибки нет, 0 строк).
    const { data: left, error: e2 } = await withTimeout(
      supabase.from(TABLE).select('id').in('id', chunk).is('deleted_at', null),
      15_000
    );
    if (e2) throw new Error(`Supabase verify failed: ${e2.message}`);
    if (left && left.length > 0) {
      throw new Error(
        `Supabase: ${left.length} заказ(ов) НЕ удалено (вероятно нет UPDATE policy / RLS)`
      );
    }
  }
}

// ============================================================
// ДИАГНОСТИКА (счётчики и состояние realtime)
// ============================================================
let rtStatus = 'idle';
let rtEvents = 0;
let rtLastAt: number | null = null;

export function getRealtimeInfo(): {
  status: string;
  events: number;
  lastEventAt: number | null;
} {
  return { status: rtStatus, events: rtEvents, lastEventAt: rtLastAt };
}

/** Сколько заказов всего в таблице `orders` (без загрузки строк). */
export async function countOrdersInDb(): Promise<number> {
  const { count, error } = await withTimeout(
    supabase
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null),
    15_000
  );
  if (error) throw new Error(`Supabase count failed: ${error.message}`);
  return count ?? 0;
}

// ============================================================
// REALTIME
// ============================================================
/**
 * Подписка на заказы: сначала последние 2 суток, затем каждое изменение.
 * После потери связи (SUBSCRIBED снова) — догрузка пропущенного.
 */
export function subscribeOrdersFromDb(
  callback: (orders: Order[]) => void,
  onDelete?: (ids: string[]) => void
): () => void {
  let cancelled = false;
  let catching = false;
  // Старт: последние 2 суток (по часам устройства — с запасом),
  // дальше только серверное время из полученных строк.
  let lastSeen = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

  const handleDeleted = (ids: string[]) => {
    if (cancelled || ids.length === 0) return;
    dropOrdersFromOutbox(ids); // не отправляем заказ, удалённый с другого устройства
    onDelete?.(ids);
  };

  const bump = (serverAt?: string | null) => {
    if (serverAt && tsOf(serverAt) > tsOf(lastSeen)) lastSeen = serverAt;
  };

  const catchUp = () => {
    if (catching || cancelled) return;
    catching = true;
    fetchOrdersUpdatedSince(lastSeen)
      .then((delta) => {
        if (cancelled) return;
        bump(delta.lastServerAt);
        if (delta.orders.length > 0) callback(delta.orders);
        handleDeleted(delta.deletedIds);
      })
      .catch((e: unknown) => {
        console.warn('[supabaseOrders] catch-up failed:', e);
      })
      .finally(() => {
        catching = false;
      });
  };

  catchUp();

  const channel = supabase
    .channel('orders-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE },
      (payload) => {
        rtEvents++;
        rtLastAt = Date.now();
        console.info('[order-source] realtime', payload.eventType);
        if (cancelled) return;
        if (payload.eventType === 'DELETE') {
          const oldId = (payload.old as { id?: string } | undefined)?.id;
          if (oldId) handleDeleted([oldId]);
          return;
        }
        const row = payload.new as
          | (OrderRow & { id?: string })
          | undefined;
        if (!row) return;
        bump(row.server_updated_at);
        if (row.deleted_at) {
          const id = row.id ?? (row.data as Order | null)?.id;
          if (id) handleDeleted([id]);
          return;
        }
        const o = orderFromRow(row);
        if (o) callback([o]);
      }
    )
    .subscribe((status) => {
      rtStatus = String(status);
      if (status === 'SUBSCRIBED') catchUp();
      if (status === 'CHANNEL_ERROR') {
        console.error('[supabaseOrders] realtime error — проверьте Publication');
      }
    });

  // Страховка: websocket мог тихо умереть (планшет уснул, сеть мигнула).
  const onOnline = () => catchUp();
  const onVisible = () => {
    if (document.visibilityState === 'visible') catchUp();
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  const timer = window.setInterval(catchUp, 30_000);

  return () => {
    cancelled = true;
    window.clearInterval(timer);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    rtStatus = 'closed';
    supabase.removeChannel(channel).catch(() => {
      /* ignore */
    });
  };
}
