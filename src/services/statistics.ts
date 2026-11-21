import { tr } from '@/locale/format';
import type { TranslationKey } from '@/locale';
import type { Order } from '@/types/database';
import { getAllOrders, getMenuItems } from '@/lib/localStore';
import { isOrderDeleted } from '@/services/deletedOrders';
import { fetchOrdersRange } from '@/services/supabaseOrders';

export interface SalesSummary {
  totalSales: number;
  orderCount: number;
  averageOrder: number;
  /** 🍽️ в зале */
  insideOrders: number;
  /** 🥡 с собой + 🚶 по дороге (общая сумма, для совместимости) */
  outsideOrders: number;
  /** 🥡 только «с собой» */
  takeawayOrders: number;
  /** 🚶 только «по дороге» */
  onTheWayOrders: number;
  insideSales: number;
  takeawaySales: number;
  onTheWaySales: number;
}

export interface HourlySales {
  hour: string;
  count: number;
  total: number;
}

export interface ItemSales {
  name: string;
  variant: string;
  short_name: string;
  quantity: number;
  total: number;
  percentage: number;
}

export interface CategorySales {
  name: string;
  quantity: number;
  total: number;
}

export interface DateRange {
  start: string;
  end: string;
}

// ============================================================
// ДИАПАЗОН ДАТ
// ============================================================
export function getDateRange(
  preset: string,
  customStart?: string,
  customEnd?: string
): DateRange {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  switch (preset) {
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case 'yesterday': {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const endY = new Date(now);
      endY.setDate(endY.getDate() - 1);
      endY.setHours(23, 59, 59, 999);
      return { start: start.toISOString(), end: endY.toISOString() };
    }
    case 'week': {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case 'month': {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case 'custom': {
      if (customStart && customEnd) {
        const s = new Date(customStart);
        s.setHours(0, 0, 0, 0);
        const e = new Date(customEnd);
        e.setHours(23, 59, 59, 999);
        return { start: s.toISOString(), end: e.toISOString() };
      }
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    default:
      return { start: new Date(0).toISOString(), end: end.toISOString() };
  }
}

function localOrdersInRange(range: DateRange): Order[] {
  const startMs = new Date(range.start).getTime();
  const endMs = new Date(range.end).getTime();
  return getAllOrders().filter((o) => {
    const t = new Date(o.created_at).getTime();
    return t >= startMs && t <= endMs;
  });
}

// Статистика берёт данные из Supabase (вся история), а локальные заказы
// подмешивает поверх — так новые и ещё не отправленные заказы видны сразу.
// Нет сети / ошибка → работаем только с локальными данными.
// Запрос в облако кэшируется на пару секунд: страница просит те же данные
// сразу четырьмя функциями.
const remoteCache = new Map<string, { at: number; p: Promise<Order[]> }>();

function fetchRemoteCached(range: DateRange): Promise<Order[]> {
  const key = `${range.start}|${range.end}`;
  const hit = remoteCache.get(key);
  if (hit && Date.now() - hit.at < 2500) return hit.p;
  const p = fetchOrdersRange(range.start, range.end);
  remoteCache.set(key, { at: Date.now(), p });
  if (remoteCache.size > 20) {
    const oldest = remoteCache.keys().next().value;
    if (oldest) remoteCache.delete(oldest);
  }
  p.catch(() => remoteCache.delete(key));
  return p;
}

async function ordersInRange(range: DateRange): Promise<Order[]> {
  const byId = new Map<string, Order>();
  try {
    for (const o of await fetchRemoteCached(range)) byId.set(o.id, o);
  } catch (e) {
    console.warn('[statistics] Supabase unavailable, local data only:', e);
  }
  for (const l of localOrdersInRange(range)) {
    const r = byId.get(l.id);
    if (!r || new Date(l.updated_at).getTime() >= new Date(r.updated_at).getTime()) {
      byId.set(l.id, l);
    }
  }
  return [...byId.values()].filter(
    (o) => o.status !== 'CANCELLED' && !isOrderDeleted(o.id)
  );
}

// ============================================================
// СВОДКА
// ============================================================
export async function fetchSalesSummary(
  range: DateRange
): Promise<SalesSummary> {
  const orders = await ordersInRange(range);
  const totalSales = orders.reduce((s, o) => s + o.total_amount, 0);
  const orderCount = orders.length;

  const inside = orders.filter((o) => o.order_type === 'INSIDE');
  const takeaway = orders.filter((o) => o.order_type === 'OUTSIDE');
  const onTheWay = orders.filter((o) => o.order_type === 'ON_THE_WAY');
  const sum = (list: Order[]) => list.reduce((s, o) => s + o.total_amount, 0);

  return {
    totalSales,
    orderCount,
    averageOrder: orderCount > 0 ? Math.round(totalSales / orderCount) : 0,
    insideOrders: inside.length,
    outsideOrders: takeaway.length + onTheWay.length,
    takeawayOrders: takeaway.length,
    onTheWayOrders: onTheWay.length,
    insideSales: sum(inside),
    takeawaySales: sum(takeaway),
    onTheWaySales: sum(onTheWay),
  };
}

// ============================================================
// ПО ЧАСАМ
// ============================================================
export async function fetchHourlySales(
  range: DateRange
): Promise<HourlySales[]> {
  const orders = await ordersInRange(range);
  const hourMap = new Map<string, { count: number; total: number }>();

  for (let h = 0; h < 24; h++) {
    const key = `${String(h).padStart(2, '0')}:00`;
    hourMap.set(key, { count: 0, total: 0 });
  }

  for (const o of orders) {
    const d = new Date(o.created_at);
    const key = `${String(d.getHours()).padStart(2, '0')}:00`;
    const entry = hourMap.get(key);
    if (entry) {
      entry.count++;
      entry.total += o.total_amount;
    }
  }

  return Array.from(hourMap.entries()).map(([hour, v]) => ({ hour, ...v }));
}

// ============================================================
// ПО БЛЮДАМ
// ============================================================
export async function fetchItemSales(range: DateRange): Promise<ItemSales[]> {
  const orders = await ordersInRange(range);
  const itemMap = new Map<string, ItemSales>();
  let grandTotal = 0;

  for (const o of orders) {
    for (const it of o.order_items ?? []) {
      if (it.is_removed) continue;
      grandTotal += it.subtotal;
      const key = `${it.name}-${it.variant}`;
      const existing = itemMap.get(key);
      if (existing) {
        existing.quantity += it.quantity;
        existing.total += it.subtotal;
      } else {
        itemMap.set(key, {
          name: it.name,
          variant: it.variant,
          short_name: it.short_name,
          quantity: it.quantity,
          total: it.subtotal,
          percentage: 0,
        });
      }
    }
  }

  const result = Array.from(itemMap.values());
  result.forEach((i) => {
    i.percentage =
      grandTotal > 0 ? Math.round((i.total / grandTotal) * 100) : 0;
  });
  result.sort((a, b) => b.quantity - a.quantity);

  return result;
}

// ============================================================
// ПО КАТЕГОРИЯМ
// ============================================================
const TYPE_LABEL_KEYS: Record<string, TranslationKey> = {
  dish: 'catDish',
  set: 'catSet',
  drink: 'catDrink',
  sauce: 'catSauce',
  topping: 'catTopping',
};

export async function fetchCategorySales(
  range: DateRange
): Promise<CategorySales[]> {
  const orders = await ordersInRange(range);
  const menuItems = getMenuItems();

  // id → type (включая варианты)
  const typeById = new Map<string, string>();
  for (const mi of menuItems) {
    typeById.set(mi.id, mi.type);
    if (mi.variants) {
      for (const v of mi.variants) typeById.set(v.id, v.type);
    }
  }

  const catMap = new Map<string, CategorySales>();
  for (const o of orders) {
    for (const it of o.order_items ?? []) {
      if (it.is_removed) continue;
      const t = it.menu_item_id ? typeById.get(it.menu_item_id) : null;
      if (!t) continue;
      const labelKey = TYPE_LABEL_KEYS[t];
      const catName = labelKey ? tr(labelKey) : t;
      const existing = catMap.get(catName);
      if (existing) {
        existing.quantity += it.quantity;
        existing.total += it.subtotal;
      } else {
        catMap.set(catName, {
          name: catName,
          quantity: it.quantity,
          total: it.subtotal,
        });
      }
    }
  }

  return Array.from(catMap.values()).sort((a, b) => b.total - a.total);
}


// ============================================================
// ДЕНЬ / НЕДЕЛЯ / МЕСЯЦ / ГОД / ПЕРИОД (со сдвигом «назад»)
// ============================================================
export type RangeUnit = 'day' | 'week' | 'month' | 'year' | 'period';

/**
 * Диапазон по единице времени. offset = 0 — текущий, -1 — предыдущий и т.д.
 * Неделя — календарная, с понедельника по воскресенье.
 */
export function getUnitRange(
  unit: RangeUnit,
  offset: number,
  customStart?: string,
  customEnd?: string
): DateRange {
  const now = new Date();
  const startOf = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOf = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };

  switch (unit) {
    case 'day': {
      const d = new Date(now);
      d.setDate(d.getDate() + offset);
      return { start: startOf(d).toISOString(), end: endOf(d).toISOString() };
    }
    case 'week': {
      const d = new Date(now);
      const dow = (d.getDay() + 6) % 7; // понедельник = 0
      d.setDate(d.getDate() - dow + offset * 7);
      const e = new Date(d);
      e.setDate(e.getDate() + 6);
      return { start: startOf(d).toISOString(), end: endOf(e).toISOString() };
    }
    case 'month': {
      const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
      return {
        start: startOf(first).toISOString(),
        end: endOf(last).toISOString(),
      };
    }
    case 'year': {
      const y = now.getFullYear() + offset;
      return {
        start: new Date(y, 0, 1, 0, 0, 0, 0).toISOString(),
        end: new Date(y, 11, 31, 23, 59, 59, 999).toISOString(),
      };
    }
    default: {
      if (customStart && customEnd) {
        let s = new Date(customStart);
        let e = new Date(customEnd);
        if (s.getTime() > e.getTime()) [s, e] = [e, s];
        return { start: startOf(s).toISOString(), end: endOf(e).toISOString() };
      }
      return { start: startOf(now).toISOString(), end: endOf(now).toISOString() };
    }
  }
}

// ============================================================
// ГРАФИК: ПРОДАЖИ ПО ЧАСАМ / ДНЯМ / МЕСЯЦАМ С РАЗБИВКОЙ ПО ТИПУ ЗАКАЗА
// ============================================================
export type BucketKind = 'hour' | 'day' | 'month';
export type TypeKey = 'INSIDE' | 'OUTSIDE' | 'ON_THE_WAY';

export interface TypeTotals {
  count: number;
  total: number;
}

export interface TimelineBucket {
  /** Начало интервала (ISO) — для подписей */
  start: string;
  kind: BucketKind;
  count: number;
  total: number;
  byType: Record<TypeKey, TypeTotals>;
}

/** Какой шаг графика подходит диапазону. */
export function pickBucketKind(unit: RangeUnit, range: DateRange): BucketKind {
  if (unit === 'day') return 'hour';
  if (unit === 'week' || unit === 'month') return 'day';
  if (unit === 'year') return 'month';
  const days =
    (new Date(range.end).getTime() - new Date(range.start).getTime()) /
    86_400_000;
  if (days <= 1) return 'hour';
  if (days <= 92) return 'day';
  return 'month';
}

function emptyTypes(): Record<TypeKey, TypeTotals> {
  return {
    INSIDE: { count: 0, total: 0 },
    OUTSIDE: { count: 0, total: 0 },
    ON_THE_WAY: { count: 0, total: 0 },
  };
}

export async function fetchTimeline(
  range: DateRange,
  kind: BucketKind
): Promise<TimelineBucket[]> {
  const orders = await ordersInRange(range);
  const rs = new Date(range.start);
  const re = new Date(range.end);

  const buckets: TimelineBucket[] = [];
  const index = new Map<string, TimelineBucket>();
  const add = (d: Date, key: string) => {
    const b: TimelineBucket = {
      start: d.toISOString(),
      kind,
      count: 0,
      total: 0,
      byType: emptyTypes(),
    };
    buckets.push(b);
    index.set(key, b);
  };
  const keyOf = (d: Date): string =>
    kind === 'hour'
      ? String(d.getHours())
      : kind === 'day'
      ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      : `${d.getFullYear()}-${d.getMonth()}`;

  if (kind === 'hour') {
    for (let h = 0; h < 24; h++) {
      const d = new Date(rs);
      d.setHours(h, 0, 0, 0);
      add(d, String(h));
    }
  } else if (kind === 'day') {
    const d = new Date(rs.getFullYear(), rs.getMonth(), rs.getDate());
    while (d.getTime() <= re.getTime()) {
      add(new Date(d), keyOf(d));
      d.setDate(d.getDate() + 1);
    }
  } else {
    const d = new Date(rs.getFullYear(), rs.getMonth(), 1);
    while (d.getTime() <= re.getTime()) {
      add(new Date(d), keyOf(d));
      d.setMonth(d.getMonth() + 1);
    }
  }

  for (const o of orders) {
    const b = index.get(keyOf(new Date(o.created_at)));
    if (!b) continue;
    const tp: TypeKey =
      o.order_type === 'INSIDE'
        ? 'INSIDE'
        : o.order_type === 'ON_THE_WAY'
        ? 'ON_THE_WAY'
        : 'OUTSIDE';
    b.count++;
    b.total += o.total_amount;
    b.byType[tp].count++;
    b.byType[tp].total += o.total_amount;
  }
  return buckets;
}
