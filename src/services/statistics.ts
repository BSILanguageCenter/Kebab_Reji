import type { Order } from '@/types/database';
import { getAllOrders, getMenuItems } from '@/lib/localStore';

export interface SalesSummary {
  totalSales: number;
  orderCount: number;
  averageOrder: number;
  insideOrders: number;
  outsideOrders: number;
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

function ordersInRange(range: DateRange): Order[] {
  const startMs = new Date(range.start).getTime();
  const endMs = new Date(range.end).getTime();
  return getAllOrders().filter((o) => {
    if (o.status === 'CANCELLED') return false;
    const t = new Date(o.created_at).getTime();
    return t >= startMs && t <= endMs;
  });
}

// ============================================================
// СВОДКА
// ============================================================
export async function fetchSalesSummary(
  range: DateRange
): Promise<SalesSummary> {
  const orders = ordersInRange(range);
  const totalSales = orders.reduce((s, o) => s + o.total_amount, 0);
  const orderCount = orders.length;
  const insideOrders = orders.filter((o) => o.order_type === 'INSIDE').length;
  const outsideOrders = orders.filter((o) => o.order_type === 'OUTSIDE').length;

  return {
    totalSales,
    orderCount,
    averageOrder: orderCount > 0 ? Math.round(totalSales / orderCount) : 0,
    insideOrders,
    outsideOrders,
  };
}

// ============================================================
// ПО ЧАСАМ
// ============================================================
export async function fetchHourlySales(
  range: DateRange
): Promise<HourlySales[]> {
  const orders = ordersInRange(range);
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
  const orders = ordersInRange(range);
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
const TYPE_LABELS: Record<string, string> = {
  dish: 'Блюда',
  set: 'Сеты',
  drink: 'Напитки',
  sauce: 'Соусы',
  topping: 'Топпинги',
};

export async function fetchCategorySales(
  range: DateRange
): Promise<CategorySales[]> {
  const orders = ordersInRange(range);
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
      const catName = TYPE_LABELS[t] ?? t;
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
