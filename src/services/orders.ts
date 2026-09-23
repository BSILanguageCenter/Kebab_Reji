import { supabase } from '@/lib/supabase';
import type {
  Order,
  OrderItemOption,
  CartItem,
  OrderType,
} from '@/types/database';

export async function getNextOrderNumber(): Promise<number> {
  const { data, error } = await supabase
    .from('orders')
    .select('order_number')
    .order('order_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data?.order_number ?? 100) + 1;
}

// ============================================================
// СОЗДАНИЕ ЗАКАЗА
// ============================================================
export async function createOrder(
  orderType: OrderType,
  cartItems: CartItem[],
  comment: string
): Promise<Order> {
  const orderNumber = await getNextOrderNumber();

  const activeItems = cartItems.filter((i) => !i.is_removed);
  const totalAmount = activeItems.reduce(
    (sum, item) =>
      sum +
      item.price * item.quantity +
      item.options.reduce((s, o) => s + o.price * o.quantity, 0),
    0
  );

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      order_number: orderNumber,
      order_type: orderType,
      status: 'NEW',
      total_amount: totalAmount,
      comment,
    })
    .select()
    .single();

  if (orderError) throw orderError;

  // Пакетно: все items одним запросом
  const itemsToInsert = cartItems.map((item) => ({
    order_id: order.id,
    menu_item_id: item.menu_item_id || null,
    name: item.name,
    short_name: item.short_name,
    variant: item.variant,
    price: item.price,
    quantity: item.quantity,
    subtotal: item.is_removed ? 0 : item.price * item.quantity,
    is_removed: item.is_removed ?? false,
    is_added_later: item.is_added_later ?? false,
  }));

  const { data: insertedItems, error: itemsError } = await supabase
    .from('order_items')
    .insert(itemsToInsert)
    .select();

  if (itemsError) throw itemsError;

  // Опции: сопоставляем по индексу (порядок сохраняется)
  const optionsToInsert: Array<{
    order_item_id: string;
    type: string;
    name: string;
    price: number;
    quantity: number;
  }> = [];

  for (let i = 0; i < cartItems.length; i++) {
    const item = cartItems[i];
    const inserted = insertedItems?.[i];
    if (!inserted) continue;
    for (const opt of item.options) {
      optionsToInsert.push({
        order_item_id: inserted.id,
        type: opt.type,
        name: opt.name,
        price: opt.price,
        quantity: opt.quantity,
      });
    }
  }

  if (optionsToInsert.length > 0) {
    const { error: optsErr } = await supabase
      .from('order_item_options')
      .insert(optionsToInsert);
    if (optsErr) throw optsErr;
  }

  return order;
}

// ============================================================
// ОБНОВЛЕНИЕ СУЩЕСТВУЮЩЕГО ЗАКАЗА (тот же номер)
// ============================================================
export async function updateOrder(
  orderId: string,
  orderType: OrderType,
  cartItems: CartItem[],
  comment: string
): Promise<Order> {
  const activeItems = cartItems.filter((i) => !i.is_removed);
  const totalAmount = activeItems.reduce(
    (sum, item) =>
      sum +
      item.price * item.quantity +
      item.options.reduce((s, o) => s + o.price * o.quantity, 0),
    0
  );

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .update({
      order_type: orderType,
      total_amount: totalAmount,
      comment,
    })
    .eq('id', orderId)
    .select()
    .single();

  if (orderError) throw orderError;

  const { error: delErr } = await supabase
    .from('order_items')
    .delete()
    .eq('order_id', orderId);
  if (delErr) throw delErr;

  const itemsToInsert = cartItems.map((item) => ({
    order_id: orderId,
    menu_item_id: item.menu_item_id || null,
    name: item.name,
    short_name: item.short_name,
    variant: item.variant,
    price: item.price,
    quantity: item.quantity,
    subtotal: item.is_removed ? 0 : item.price * item.quantity,
    is_removed: item.is_removed ?? false,
    is_added_later: item.is_added_later ?? false,
  }));

  const { data: insertedItems, error: itemsError } = await supabase
    .from('order_items')
    .insert(itemsToInsert)
    .select();

  if (itemsError) throw itemsError;

  const optionsToInsert: Array<{
    order_item_id: string;
    type: string;
    name: string;
    price: number;
    quantity: number;
  }> = [];

  for (let i = 0; i < cartItems.length; i++) {
    const item = cartItems[i];
    const inserted = insertedItems?.[i];
    if (!inserted) continue;
    for (const opt of item.options) {
      optionsToInsert.push({
        order_item_id: inserted.id,
        type: opt.type,
        name: opt.name,
        price: opt.price,
        quantity: opt.quantity,
      });
    }
  }

  if (optionsToInsert.length > 0) {
    const { error: optsErr } = await supabase
      .from('order_item_options')
      .insert(optionsToInsert);
    if (optsErr) throw optsErr;
  }

  return order;
}

// ============================================================
// АКТИВНЫЕ ЗАКАЗЫ (без позиций)
// ============================================================
export async function fetchActiveOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .in('status', ['NEW', 'PREPARING', 'READY'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ============================================================
// ЗАКАЗЫ ДЛЯ ЛЕВОЙ ПАНЕЛИ КАССЫ (оптимизировано)
// ============================================================
export async function fetchCashierOrders(): Promise<Order[]> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Параллельно: активные + отменённые сегодня
  const [activeRes, cancelledRes] = await Promise.all([
    supabase
      .from('orders')
      .select('*')
      .in('status', ['NEW', 'PREPARING', 'READY'])
      .order('created_at', { ascending: false }),
    supabase
      .from('orders')
      .select('*')
      .eq('status', 'CANCELLED')
      .gte('created_at', todayStart.toISOString())
      .order('created_at', { ascending: false }),
  ]);

  if (activeRes.error) throw activeRes.error;
  if (cancelledRes.error) throw cancelledRes.error;

  const allOrders = [...(activeRes.data ?? []), ...(cancelledRes.data ?? [])];
  if (allOrders.length === 0) return [];

  const orderIds = allOrders.map((o) => o.id);

  // Тянем ТОЛЬКО строки с флагами (обычно 0–2 вместо 100+)
  const { data: modified, error: modErr } = await supabase
    .from('order_items')
    .select('order_id')
    .in('order_id', orderIds)
    .or('is_removed.eq.true,is_added_later.eq.true');
  if (modErr) throw modErr;

  const modifiedSet = new Set((modified ?? []).map((m) => m.order_id));

  return allOrders
    .map((o) => ({ ...o, is_modified: modifiedSet.has(o.id) }))
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
}

// ============================================================
// КУХНЯ: активные заказы с позициями и опциями (оптимизировано)
// ============================================================
export async function fetchKitchenOrders(): Promise<Order[]> {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .in('status', ['NEW', 'PREPARING', 'READY'])
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);

  // Один запрос с JOIN: items + вложенные options
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('*, options:order_item_options(*)')
    .in('order_id', orderIds)
    .order('created_at');
  if (itemsError) throw itemsError;

  const itemsByOrder = new Map<
    string,
    Array<{
      id: string;
      order_id: string;
      menu_item_id: string | null;
      name: string;
      short_name: string;
      variant: string;
      price: number;
      quantity: number;
      subtotal: number;
      created_at: string;
      is_removed: boolean;
      is_added_later: boolean;
      options: OrderItemOption[];
    }>
  >();

  for (const item of items ?? []) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push({
      id: item.id,
      order_id: item.order_id,
      menu_item_id: item.menu_item_id,
      name: item.name,
      short_name: item.short_name,
      variant: item.variant,
      price: item.price,
      quantity: item.quantity,
      subtotal: item.subtotal,
      created_at: item.created_at,
      is_removed: item.is_removed ?? false,
      is_added_later: item.is_added_later ?? false,
      options: (item.options as OrderItemOption[]) ?? [],
    });
    itemsByOrder.set(item.order_id, list);
  }

  return orders.map((order) => ({
    ...order,
    order_items: itemsByOrder.get(order.id) ?? [],
  }));
}

// ============================================================
// ОДИН ЗАКАЗ С ПОЗИЦИЯМИ (оптимизировано)
// ============================================================
export async function fetchOrderWithItems(
  orderId: string
): Promise<Order | null> {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order) return null;

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('*, options:order_item_options(*)')
    .eq('order_id', orderId)
    .order('created_at');
  if (itemsError) throw itemsError;

  return {
    ...order,
    order_items: (items ?? []).map((item) => ({
      id: item.id,
      order_id: item.order_id,
      menu_item_id: item.menu_item_id,
      name: item.name,
      short_name: item.short_name,
      variant: item.variant,
      price: item.price,
      quantity: item.quantity,
      subtotal: item.subtotal,
      created_at: item.created_at,
      is_removed: item.is_removed ?? false,
      is_added_later: item.is_added_later ?? false,
      options: (item.options as OrderItemOption[]) ?? [],
    })),
  };
}

// ============================================================
// СМЕНА СТАТУСА
// ============================================================
export async function updateOrderStatus(
  orderId: string,
  status: Order['status']
): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    updates.completed_at = new Date().toISOString();
  }
  const { error } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', orderId);
  if (error) throw error;
}

// ============================================================
// УДАЛЕНИЕ
// ============================================================
export async function deleteOrder(orderId: string): Promise<void> {
  const { error } = await supabase.from('orders').delete().eq('id', orderId);
  if (error) throw error;
}

// ============================================================
// ПРОЧЕЕ
// ============================================================
export async function updateOrderType(
  orderId: string,
  orderType: OrderType
): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ order_type: orderType })
    .eq('id', orderId);
  if (error) throw error;
}

export async function updateOrderComment(
  orderId: string,
  comment: string
): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ comment })
    .eq('id', orderId);
  if (error) throw error;
}