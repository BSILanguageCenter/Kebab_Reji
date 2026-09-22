import { supabase } from '@/lib/supabase';
import type { Order, OrderItemOption, CartItem, OrderType } from '@/types/database';

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

export async function createOrder(
  orderType: OrderType,
  cartItems: CartItem[],
  comment: string
): Promise<Order> {
  const orderNumber = await getNextOrderNumber();
  const totalAmount = cartItems.reduce(
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

  for (const item of cartItems) {
    const subtotal = item.price * item.quantity;
    const { data: orderItem, error: itemError } = await supabase
      .from('order_items')
      .insert({
        order_id: order.id,
        menu_item_id: item.menu_item_id,
        name: item.name,
        short_name: item.short_name,
        variant: item.variant,
        price: item.price,
        quantity: item.quantity,
        subtotal,
      })
      .select()
      .single();

    if (itemError) throw itemError;

    for (const opt of item.options) {
      const { error: optError } = await supabase.from('order_item_options').insert({
        order_item_id: orderItem.id,
        type: opt.type,
        name: opt.name,
        price: opt.price,
        quantity: opt.quantity,
      });
      if (optError) throw optError;
    }
  }

  return order;
}

export async function fetchActiveOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .in('status', ['NEW', 'PREPARING', 'READY'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchKitchenOrders(): Promise<Order[]> {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .in('status', ['NEW', 'PREPARING', 'READY'])
    .order('created_at', { ascending: true });
  if (error) throw error;

  if (!orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('*')
    .in('order_id', orderIds)
    .order('created_at');
  if (itemsError) throw itemsError;

  const itemIds = (items ?? []).map((i) => i.id);
  let options: OrderItemOption[] = [];
  if (itemIds.length > 0) {
    const { data: opts, error: optsError } = await supabase
      .from('order_item_options')
      .select('*')
      .in('order_item_id', itemIds);
    if (optsError) throw optsError;
    options = opts ?? [];
  }

  return orders.map((order) => ({
    ...order,
    order_items: (items ?? [])
      .filter((i) => i.order_id === order.id)
      .map((i) => ({
        ...i,
        options: options.filter((o) => o.order_item_id === i.id),
      })),
  }));
}

export async function fetchOrderWithItems(orderId: string): Promise<Order | null> {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order) return null;

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at');
  if (itemsError) throw itemsError;

  const itemIds = (items ?? []).map((i) => i.id);
  let options: OrderItemOption[] = [];
  if (itemIds.length > 0) {
    const { data: opts, error: optsError } = await supabase
      .from('order_item_options')
      .select('*')
      .in('order_item_id', itemIds);
    if (optsError) throw optsError;
    options = opts ?? [];
  }

  return {
    ...order,
    order_items: (items ?? []).map((i) => ({
      ...i,
      options: options.filter((o) => o.order_item_id === i.id),
    })),
  };
}

export async function updateOrderStatus(orderId: string, status: Order['status']): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    updates.completed_at = new Date().toISOString();
  }
  const { error } = await supabase.from('orders').update(updates).eq('id', orderId);
  if (error) throw error;
}

export async function deleteOrder(orderId: string): Promise<void> {
  const { error } = await supabase.from('orders').delete().eq('id', orderId);
  if (error) throw error;
}

export async function updateOrderType(orderId: string, orderType: OrderType): Promise<void> {
  const { error } = await supabase.from('orders').update({ order_type: orderType }).eq('id', orderId);
  if (error) throw error;
}

export async function updateOrderComment(orderId: string, comment: string): Promise<void> {
  const { error } = await supabase.from('orders').update({ comment }).eq('id', orderId);
  if (error) throw error;
}
