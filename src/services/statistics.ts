import { supabase } from '@/lib/supabase';

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

export function getDateRange(preset: string, customStart?: string, customEnd?: string): DateRange {
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

export async function fetchSalesSummary(range: DateRange): Promise<SalesSummary> {
  const { data, error } = await supabase
    .from('orders')
    .select('total_amount, order_type')
    .gte('created_at', range.start)
    .lte('created_at', range.end)
    .neq('status', 'CANCELLED');

  if (error) throw error;

  const orders = data ?? [];
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

export async function fetchHourlySales(range: DateRange): Promise<HourlySales[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('created_at, total_amount')
    .gte('created_at', range.start)
    .lte('created_at', range.end)
    .neq('status', 'CANCELLED');

  if (error) throw error;

  const orders = data ?? [];
  const hourMap = new Map<string, { count: number; total: number }>();

  for (let h = 0; h < 24; h++) {
    const key = `${String(h).padStart(2, '0')}:00`;
    hourMap.set(key, { count: 0, total: 0 });
  }

  for (const order of orders) {
    const d = new Date(order.created_at);
    const key = `${String(d.getHours()).padStart(2, '0')}:00`;
    const entry = hourMap.get(key);
    if (entry) {
      entry.count++;
      entry.total += order.total_amount;
    }
  }

  return Array.from(hourMap.entries()).map(([hour, v]) => ({ hour, ...v }));
}

export async function fetchItemSales(range: DateRange): Promise<ItemSales[]> {
  const { data: orders, error: orderError } = await supabase
    .from('orders')
    .select('id')
    .gte('created_at', range.start)
    .lte('created_at', range.end)
    .neq('status', 'CANCELLED');

  if (orderError) throw orderError;
  if (!orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('name, variant, short_name, quantity, subtotal')
    .in('order_id', orderIds);

  if (itemsError) throw itemsError;
  if (!items || items.length === 0) return [];

  const itemMap = new Map<string, ItemSales>();
  const grandTotal = items.reduce((s, i) => s + i.subtotal, 0);

  for (const item of items) {
    const key = `${item.name}-${item.variant}`;
    const existing = itemMap.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      existing.total += item.subtotal;
    } else {
      itemMap.set(key, {
        name: item.name,
        variant: item.variant,
        short_name: item.short_name,
        quantity: item.quantity,
        total: item.subtotal,
        percentage: 0,
      });
    }
  }

  const result = Array.from(itemMap.values());
  result.forEach((i) => {
    i.percentage = grandTotal > 0 ? Math.round((i.total / grandTotal) * 100) : 0;
  });
  result.sort((a, b) => b.quantity - a.quantity);

  return result;
}

export async function fetchCategorySales(range: DateRange): Promise<CategorySales[]> {
  const { data: orders, error: orderError } = await supabase
    .from('orders')
    .select('id')
    .gte('created_at', range.start)
    .lte('created_at', range.end)
    .neq('status', 'CANCELLED');

  if (orderError) throw orderError;
  if (!orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('menu_item_id, quantity, subtotal')
    .in('order_id', orderIds);

  if (itemsError) throw itemsError;
  if (!items || items.length === 0) return [];

  const menuItemIds = [...new Set(items.map((i) => i.menu_item_id).filter(Boolean))] as string[];
  if (menuItemIds.length === 0) return [];

  const { data: menuItems, error: menuError } = await supabase
    .from('menu_items')
    .select('id, category_id')
    .in('id', menuItemIds);

  if (menuError) throw menuError;

  const categoryIdMap = new Map<string, string>();
  for (const mi of menuItems ?? []) {
    categoryIdMap.set(mi.id, mi.category_id);
  }

  const categoryIds = [...new Set(categoryIdMap.values())];
  const { data: categories, error: catError } = await supabase
    .from('menu_categories')
    .select('id, name')
    .in('id', categoryIds);

  if (catError) throw catError;

  const categoryNameMap = new Map<string, string>();
  for (const c of categories ?? []) {
    categoryNameMap.set(c.id, c.name);
  }

  const catMap = new Map<string, CategorySales>();
  for (const item of items) {
    const catId = item.menu_item_id ? categoryIdMap.get(item.menu_item_id) : null;
    if (!catId) continue;
    const catName = categoryNameMap.get(catId) ?? 'Unknown';
    const existing = catMap.get(catName);
    if (existing) {
      existing.quantity += item.quantity;
      existing.total += item.subtotal;
    } else {
      catMap.set(catName, { name: catName, quantity: item.quantity, total: item.subtotal });
    }
  }

  return Array.from(catMap.values()).sort((a, b) => b.total - a.total);
}
