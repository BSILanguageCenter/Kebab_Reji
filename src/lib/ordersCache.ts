// src/lib/ordersCache.ts
import { supabase } from '@/lib/supabase';
import type { Order, Payment, RestaurantTable } from '@/lib/types';

// ─── Константы ──────────────────────────────────────────────────────────────
const STORAGE_KEY = 'orders_cache_v1';
const CACHE_TTL = 5 * 60 * 1000; // 5 минут
const MAX_CACHED_ORDERS = 50;

// ─── Типы ───────────────────────────────────────────────────────────────────
export interface OrderWithJoins extends Order {
  table: RestaurantTable | null;
  payments: Payment[];
}

export interface OrdersCache {
  orders: OrderWithJoins[];
  payments: Record<string, Payment>;
  cachedAt: number;
  filters: {
    tab: 'unpaid' | 'all';
    showToday: boolean;
  };
}

export interface FetchOrdersParams {
  tab: 'unpaid' | 'all';
  showToday: boolean;
  statusFilter: string;
  tableFilter: string;
  search: string;
}

export interface FetchOrdersResult {
  orders: OrderWithJoins[];
  payments: Record<string, Payment>;
}

// ─── Память ─────────────────────────────────────────────────────────────────
let memoryCache: OrdersCache | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// ЧТЕНИЕ КЭША
// ═══════════════════════════════════════════════════════════════════════════
export function loadOrdersCache(): OrdersCache | null {
  // 1. Память
  if (memoryCache) return memoryCache;

  // 2. LocalStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as OrdersCache;
      memoryCache = parsed;
      return parsed;
    }
  } catch (e) {
    console.warn('[ordersCache] read failed:', e);
  }
  return null;
}

export function isOrdersCacheFresh(cache: OrdersCache | null): boolean {
  if (!cache) return false;
  return Date.now() - cache.cachedAt < CACHE_TTL;
}

// ═══════════════════════════════════════════════════════════════════════════
// СОХРАНЕНИЕ КЭША
// ═══════════════════════════════════════════════════════════════════════════
export function saveOrdersCache(
  orders: OrderWithJoins[],
  payments: Record<string, Payment>,
  filters: OrdersCache['filters']
): void {
  const cache: OrdersCache = {
    orders,
    payments,
    cachedAt: Date.now(),
    filters,
  };
  memoryCache = cache;

  try {
    const trimmed: OrdersCache = {
      ...cache,
      orders: cache.orders.slice(0, MAX_CACHED_ORDERS),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[ordersCache] save failed:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ОЧИСТКА КЭША
// ═══════════════════════════════════════════════════════════════════════════
export function invalidateOrdersCache(): void {
  memoryCache = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ИНФОРМАЦИЯ О КЭШЕ
// ═══════════════════════════════════════════════════════════════════════════
export function getOrdersCacheInfo(): {
  cachedAt: number | null;
  age: string;
  count: number;
} {
  const cache = loadOrdersCache();
  if (!cache) return { cachedAt: null, age: '—', count: 0 };

  const ageMs = Date.now() - cache.cachedAt;
  const mins = Math.floor(ageMs / 60000);
  const secs = Math.floor((ageMs % 60000) / 1000);
  const age =
    mins > 0
      ? `${mins} мин назад`
      : secs > 5
      ? `${secs} сек назад`
      : 'только что';

  return { cachedAt: cache.cachedAt, age, count: cache.orders.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// ЗАГРУЗКА ИЗ SUPABASE
// ═══════════════════════════════════════════════════════════════════════════
export async function fetchOrdersFromSupabase(
  params: FetchOrdersParams
): Promise<FetchOrdersResult> {
  let query = supabase
    .from('orders')
    .select(
      `
      id, order_number, table_id, order_type, status,
      subtotal, discount, total, customer_note, created_at,
      sent_to_kitchen_at, cooking_started_at, ready_at, completed_at,
      order_items(
        id, product_name_ru, product_name_ja, quantity, unit_price,
        total_price, note, status, is_ready_product, kitchen_station_id
      ),
      table:restaurant_tables(id, name, status),
      payments(id, amount, method, received_amount, change_amount, created_at)
    `
    )
    .order('created_at', { ascending: false });

  if (params.showToday) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    query = query.gte('created_at', todayStart.toISOString());
  }
  if (params.tab === 'unpaid') {
    query = query.in('status', ['new', 'cooking', 'ready']);
  }
  if (params.statusFilter !== 'all') {
    query = query.eq('status', params.statusFilter);
  }
  if (params.tableFilter !== 'all') {
    query = query.eq('table_id', params.tableFilter);
  }
  if (params.search.trim()) {
    const num = params.search.trim().replace(/^#/, '');
    if (/^\d+$/.test(num)) {
      query = query.eq('order_number', parseInt(num));
    }
  }

  const { data, error } = await query.limit(100);

  if (error || !data) {
    console.warn('[ordersCache] fetch failed:', error);
    return { orders: [], payments: {} };
  }

  const orders = data as unknown as OrderWithJoins[];

  const paymentMap: Record<string, Payment> = {};
  orders.forEach((o) => {
    if (o.payments && o.payments.length > 0) {
      paymentMap[o.id] = o.payments[0];
    }
  });

  return { orders, payments: paymentMap };
}

// ═══════════════════════════════════════════════════════════════════════════
// ЛОКАЛЬНАЯ ФИЛЬТРАЦИЯ (для оффлайна)
// ═══════════════════════════════════════════════════════════════════════════
export function filterOrdersLocally(
  cache: OrdersCache,
  params: FetchOrdersParams
): OrderWithJoins[] {
  let list = cache.orders;

  if (params.tab === 'unpaid') {
    list = list.filter((o) => ['new', 'cooking', 'ready'].includes(o.status));
  }
  if (params.statusFilter !== 'all') {
    list = list.filter((o) => o.status === params.statusFilter);
  }
  if (params.tableFilter !== 'all') {
    list = list.filter((o) => o.table_id === params.tableFilter);
  }
  if (params.showToday) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    list = list.filter(
      (o) => new Date(o.created_at).getTime() >= todayStart.getTime()
    );
  }
  if (params.search.trim()) {
    const num = params.search.trim().replace(/^#/, '');
    if (/^\d+$/.test(num)) {
      list = list.filter((o) => o.order_number === parseInt(num));
    }
  }

  return list;
}