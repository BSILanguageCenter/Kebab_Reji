import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import type { Order, OrderItem, RestaurantTable } from '@/lib/types';
import { formatTime, getElapsedString, getElapsedMinutes, statusColors, statusDotColors } from '@/lib/format';
import { Clock, AlertTriangle, ChefHat, CheckCircle, UtensilsCrossed } from 'lucide-react';

export default function KitchenPage() {
  const { t, lang } = useI18n();
  const [orders, setOrders] = useState<Order[]>([]);
  const [prepWarning, setPrepWarning] = useState(15);

  useEffect(() => {
    supabase
      .from('restaurant_settings')
      .select('value')
      .eq('key', 'prep_warning_minutes')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) setPrepWarning(parseInt(data.value));
      });

    loadOrders();

    const channel = supabase
      .channel('kitchen-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => loadOrders())
      .subscribe();

    const timer = setInterval(() => {
      setOrders((prev) => [...prev]);
    }, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, []);

  async function loadOrders() {
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .in('status', ['new', 'cooking', 'ready'])
      .order('created_at', { ascending: true });

    if (!data) return;

    const withTables = await Promise.all(
      (data as Order[]).map(async (order) => {
        // Оставляем только те позиции, что идут на кухню
        const kitchenItems = (order.order_items ?? []).filter(
          (it) => !(it as any).is_ready_product
        );

        // Если в заказе нет ни одной кухонной позиции — не показываем вообще
        if (kitchenItems.length === 0) return null;

        let table: RestaurantTable | null = null;
        if (order.table_id) {
          const { data: tbl } = await supabase
            .from('restaurant_tables')
            .select('*')
            .eq('id', order.table_id)
            .maybeSingle();
          table = tbl as RestaurantTable | null;
        }

        return { ...order, order_items: kitchenItems, table };
      })
    );

    setOrders(withTables.filter(Boolean) as Order[]);
  }

  const updateStatus = async (orderId: string, status: 'cooking' | 'ready') => {
    const updates: Record<string, unknown> = { status };
    if (status === 'cooking') updates.cooking_started_at = new Date().toISOString();
    if (status === 'ready') updates.ready_at = new Date().toISOString();

    await supabase.from('orders').update(updates).eq('id', orderId);

    // Обновляем только кухонные позиции (is_ready_product = false)
    await supabase
      .from('order_items')
      .update({ status: status === 'ready' ? 'ready' : 'cooking' })
      .eq('order_id', orderId)
      .eq('is_ready_product', false);
  };

  const tableName = (order: Order) => {
    if (order.order_type === 'takeaway') return t('kitchen.takeaway');
    return order.table
      ? `${t('kitchen.table')} ${order.table.name.replace(/^\D+/, '').trim() || order.table.name}`
      : t('pos.noTable');
  };

  return (
    <div className="h-full p-4">
      {orders.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-gray-400">
          <ChefHat size={64} strokeWidth={1.5} />
          <p className="text-lg font-medium">{t('kitchen.noOrders')}</p>
        </div>
      ) : (
        <div className="grid h-full grid-cols-1 gap-4 overflow-y-auto md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-3 w-3 rounded-full ${statusDotColors[order.status]}`} />
                    <span className="text-lg font-bold text-gray-900">
                      {t('kitchen.order')} #{order.order_number}
                    </span>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusColors[order.status]}`}>
                    {t(`status.${order.status}`)}
                  </span>
                </div>

                {/* Meta */}
                <div className="flex items-center justify-between px-4 py-2 text-sm text-gray-500">
                  <span className="font-medium">{tableName(order)}</span>
                  <span>{formatTime(order.created_at, lang)}</span>
                </div>

                {/* Timer */}
                <div
                  className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold ${
                    isWarning ? 'text-red-600' : 'text-gray-500'
                  }`}
                >
                  <Clock size={16} />
                  <span>{getElapsedString(order.created_at, lang)}</span>
                  {isWarning && <AlertTriangle size={16} className="text-red-500" />}
                </div>

                {/* Items */}
                <div className="flex-1 overflow-y-auto px-4 py-2">
                  <div className="flex flex-col gap-2">
                    {items.map((item: OrderItem) => (
                      <div
                        key={item.id}
                        className="flex items-start justify-between rounded-xl bg-gray-50 px-3 py-2"
                      >
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-gray-900">
                            {lang === 'ru' ? item.product_name_ru : item.product_name_ja}
                          </p>
                          {item.note && (
                            <p className="mt-0.5 text-xs font-bold uppercase text-orange-600">
                              {item.note}
                            </p>
                          )}
                        </div>
                        <span className="ml-2 text-lg font-bold text-gray-700">
                          ×{item.quantity}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Customer note */}
                {order.customer_note && (
                  <div className="border-t border-gray-100 px-4 py-2">
                    <p className="text-xs font-semibold text-gray-500">
                      {t('orders.customerNote')}:
                    </p>
                    <p className="text-sm text-gray-700">{order.customer_note}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 border-t border-gray-100 p-3">
                  {order.status === 'new' && (
                    <button
                      onClick={() => updateStatus(order.id, 'cooking')}
                      className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-orange-500 font-bold text-white hover:bg-orange-600"
                    >
                      <UtensilsCrossed size={20} />
                      {t('kitchen.startCooking')}
                    </button>
                  )}
                  {order.status === 'cooking' && (
                    <button
                      onClick={() => updateStatus(order.id, 'ready')}
                      className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-green-500 font-bold text-white hover:bg-green-600"
                    >
                      <CheckCircle size={20} />
                      {t('kitchen.ready')}
                    </button>
                  )}
                  {order.status === 'ready' && (
                    <div className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-green-50 font-bold text-green-600">
                      <CheckCircle size={20} />
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