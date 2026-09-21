// src/pages/KitchenPage.tsx
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import type { Order, OrderItem } from '@/lib/types';
import {
  formatTime,
  getElapsedString,
  getElapsedMinutes,
  statusColors,
  statusDotColors,
} from '@/lib/format';
import {
  Clock,
  AlertTriangle,
  ChefHat,
  CheckCircle,
  UtensilsCrossed,
} from 'lucide-react';

export default function KitchenPage() {
  const { t, lang } = useI18n();
  const [orders, setOrders] = useState<Order[]>([]);
  const [prepWarning, setPrepWarning] = useState(15);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase
        .from('restaurant_settings')
        .select('value')
        .eq('key', 'prep_warning_minutes')
        .maybeSingle(),
      loadOrders(),
    ]).then(([settings]) => {
      if (settings.data?.value) setPrepWarning(parseInt(settings.data.value));
    });

    const channel = supabase
      .channel('kitchen-orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => loadOrders()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        () => loadOrders()
      )
      .subscribe();

    const timer = setInterval(() => setOrders((prev) => [...prev]), 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, []);

  async function loadOrders() {
    const { data, error } = await supabase
      .from('orders')
      .select(
        `
        id, order_number, table_id, order_type, status,
        subtotal, discount, total, customer_note, created_at,
        cooking_started_at, ready_at,
        order_items(
          id, product_name_ru, product_name_ja, quantity, unit_price,
          total_price, note, status, is_ready_product, kitchen_station_id
        ),
        table:restaurant_tables(id, name, status)
      `
      )
      .in('status', ['new', 'cooking', 'ready'])
      .order('created_at', { ascending: true });

    if (error || !data) {
      setLoading(false);
      return;
    }

    const result = (data as unknown as Order[])
      .map((order) => {
        const kitchenItems = (order.order_items ?? []).filter(
          (it) => !it.is_ready_product
        );
        if (kitchenItems.length === 0) return null;
        return { ...order, order_items: kitchenItems };
      })
      .filter(Boolean) as Order[];

    setOrders(result);
    setLoading(false);
  }

  const updateStatus = async (orderId: string, status: 'cooking' | 'ready') => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status } : o))
    );

    const updates: Record<string, unknown> = { status };
    if (status === 'cooking')
      updates.cooking_started_at = new Date().toISOString();
    if (status === 'ready') updates.ready_at = new Date().toISOString();

    await Promise.all([
      supabase.from('orders').update(updates).eq('id', orderId),
      supabase
        .from('order_items')
        .update({ status: status === 'ready' ? 'ready' : 'cooking' })
        .eq('order_id', orderId)
        .eq('is_ready_product', false),
    ]);
  };

  const tableName = (order: Order) => {
    if (order.order_type === 'takeaway') return t('kitchen.takeaway');
    return order.table
      ? `${t('kitchen.table')} ${
          order.table.name.replace(/^\D+/, '').trim() || order.table.name
        }`
      : t('pos.noTable');
  };

  if (loading && orders.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <ChefHat size={48} className="animate-pulse" />
      </div>
    );
  }

  return (
    <div className="h-full p-3 lg:p-4">
      {orders.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-gray-400">
          <ChefHat size={64} strokeWidth={1.5} />
          <p className="text-lg font-medium">{t('kitchen.noOrders')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 lg:gap-4">
          {orders.map((order) => {
            const elapsed = getElapsedMinutes(order.created_at);
            const isWarning = elapsed >= prepWarning;
            const items = order.order_items ?? [];

            return (
              <div
                key={order.id}
                className={`flex flex-col rounded-2xl border-2 bg-white shadow-sm ${
                  order.status === 'ready'
                    ? 'border-green-300'
                    : order.status === 'cooking'
                    ? 'border-orange-300'
                    : 'border-gray-200'
                }`}
              >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-3.5 w-3.5 rounded-full ${
                        statusDotColors[order.status]
                      }`}
                    />
                    <span className="text-xl font-bold text-gray-900">
                      {t('kitchen.order')} #{order.order_number}
                    </span>
                  </div>
                  <span
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                      statusColors[order.status]
                    }`}
                  >
                    {t(`status.${order.status}`)}
                  </span>
                </div>

                <div className="flex items-center justify-between px-4 py-3 text-base text-gray-600">
                  <span className="font-medium">{tableName(order)}</span>
                  <span>{formatTime(order.created_at, lang)}</span>
                </div>

                <div
                  className={`flex items-center gap-2 px-4 pb-3 text-base font-semibold ${
                    isWarning ? 'text-red-600' : 'text-gray-500'
                  }`}
                >
                  <Clock size={20} />
                  <span>{getElapsedString(order.created_at, lang)}</span>
                  {isWarning && (
                    <AlertTriangle size={20} className="text-red-500" />
                  )}
                </div>

                {/* Items */}
                <div className="flex-1 overflow-y-auto px-4 py-2">
                  <div className="flex flex-col gap-2">
                    {items.map((item: OrderItem) => (
                      <div
                        key={item.id}
                        className="flex items-start justify-between rounded-xl bg-gray-50 px-4 py-3"
                      >
                        <div className="flex-1">
                          <p className="text-base font-semibold text-gray-900">
                            {lang === 'ru'
                              ? item.product_name_ru
                              : item.product_name_ja}
                          </p>
                          {item.note && (
                            <p className="mt-1 text-sm font-bold uppercase text-orange-600">
                              {item.note}
                            </p>
                          )}
                        </div>
                        <span className="ml-3 text-2xl font-bold text-gray-700">
                          ×{item.quantity}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {order.customer_note && (
                  <div className="border-t border-gray-100 px-4 py-3">
                    <p className="text-sm font-semibold text-gray-500">
                      {t('orders.customerNote')}:
                    </p>
                    <p className="text-base text-gray-700">
                      {order.customer_note}
                    </p>
                  </div>
                )}

                {/* Actions — крупные */}
                <div className="flex gap-2 border-t border-gray-100 p-3">
                  {order.status === 'new' && (
                    <button
                      onClick={() => updateStatus(order.id, 'cooking')}
                      className="flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-orange-500 text-base font-bold text-white active:scale-[0.98]"
                    >
                      <UtensilsCrossed size={22} />
                      {t('kitchen.startCooking')}
                    </button>
                  )}
                  {order.status === 'cooking' && (
                    <button
                      onClick={() => updateStatus(order.id, 'ready')}
                      className="flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-green-500 text-base font-bold text-white active:scale-[0.98]"
                    >
                      <CheckCircle size={22} />
                      {t('kitchen.ready')}
                    </button>
                  )}
                  {order.status === 'ready' && (
                    <div className="flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-green-50 text-base font-bold text-green-600">
                      <CheckCircle size={22} />
                      {t('status.ready')}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}