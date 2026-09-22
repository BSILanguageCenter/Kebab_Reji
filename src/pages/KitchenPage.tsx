import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchKitchenOrders, updateOrderStatus } from '@/services/orders';
import { printKitchenOrder } from '@/services/printer';
import { formatYen, formatTime, formatTimeAgo } from '@/locale/format';
import { useI18n, type TranslationKey, type Lang } from '@/locale';
import type { Order, OrderStatus } from '@/types/database';
import {
  ChefHat,
  Clock,
  CheckCircle2,
  Flame,
  ShoppingBag,
  Store,
} from 'lucide-react';

export default function KitchenPage() {
  const { t, lang } = useI18n();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      const data = await fetchKitchenOrders();
      setOrders(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToLoadOrders'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadOrders();

    const sub = supabase
      .channel('kitchen-orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => {
          loadOrders();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        () => {
          loadOrders();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_item_options' },
        () => {
          loadOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, [loadOrders]);

  const handleStatusChange = async (orderId: string, status: OrderStatus) => {
    try {
      await updateOrderStatus(orderId, status);
      loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToUpdateStatus'));
    }
  };

  const handlePrint = async (order: Order) => {
    try {
      await printKitchenOrder(order);
    } catch {
      // silent — printer may not be connected
    }
  };

  const newOrders = orders.filter((o) => o.status === 'NEW');
  const preparingOrders = orders.filter((o) => o.status === 'PREPARING');
  const readyOrders = orders.filter((o) => o.status === 'READY');

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100">
      {/* Header stats */}
      <div className="flex items-center gap-4 p-4 bg-white border-b border-gray-200 shrink-0 shadow-sm">
        <div className="flex items-center gap-2">
          <ChefHat className="w-6 h-6 text-orange-500" />
          <h1 className="text-xl font-bold text-gray-900">
            {t('kitchenDisplay')}
          </h1>
        </div>
        <div className="flex gap-2 ml-auto">
          <StatPill
            label={t('newOrders')}
            count={newOrders.length}
            color="gray"
          />
          <StatPill
            label={t('preparing')}
            count={preparingOrders.length}
            color="yellow"
          />
          <StatPill
            label={t('ready')}
            count={readyOrders.length}
            color="green"
          />
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
          <ChefHat className="w-16 h-16 mb-3 opacity-30" />
          <p className="text-lg font-medium">{t('noActiveOrdersLong')}</p>
          <p className="text-sm">{t('waitingForOrders')}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* New Orders */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-gray-400" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
                  {t('newOrders')}
                </h2>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {newOrders.length}
                </span>
              </div>
              <div className="space-y-3">
                {newOrders.map((order) => (
                  <KitchenOrderCard
                    key={order.id}
                    order={order}
                    onStatusChange={handleStatusChange}
                    onPrint={handlePrint}
                    lang={lang}
                    t={t}
                  />
                ))}
                {newOrders.length === 0 && (
                  <p className="text-gray-400 text-sm text-center py-4">
                    {t('noNewOrders')}
                  </p>
                )}
              </div>
            </div>

            {/* Preparing */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-yellow-500 animate-pulse" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-yellow-600">
                  {t('preparing')}
                </h2>
                <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                  {preparingOrders.length}
                </span>
              </div>
              <div className="space-y-3">
                {preparingOrders.map((order) => (
                  <KitchenOrderCard
                    key={order.id}
                    order={order}
                    onStatusChange={handleStatusChange}
                    onPrint={handlePrint}
                    lang={lang}
                    t={t}
                  />
                ))}
                {preparingOrders.length === 0 && (
                  <p className="text-gray-400 text-sm text-center py-4">
                    {t('nothingCooking')}
                  </p>
                )}
              </div>
            </div>

            {/* Ready */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-green-600">
                  {t('ready')}
                </h2>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  {readyOrders.length}
                </span>
              </div>
              <div className="space-y-3">
                {readyOrders.map((order) => (
                  <KitchenOrderCard
                    key={order.id}
                    order={order}
                    onStatusChange={handleStatusChange}
                    onPrint={handlePrint}
                    lang={lang}
                    t={t}
                  />
                ))}
                {readyOrders.length === 0 && (
                  <p className="text-gray-400 text-sm text-center py-4">
                    {t('nothingReady')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatPill({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  const colors: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-700 border border-gray-200',
    yellow: 'bg-yellow-100 text-yellow-700 border border-yellow-300',
    green: 'bg-green-100 text-green-700 border border-green-300',
  };
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold ${colors[color]}`}
    >
      {label}
      <span className="text-lg font-bold">{count}</span>
    </div>
  );
}

function KitchenOrderCard({
  order,
  onStatusChange,
  onPrint,
  lang,
  t,
}: {
  order: Order;
  onStatusChange: (orderId: string, status: OrderStatus) => void;
  onPrint: (order: Order) => void;
  lang: Lang;
  t: (key: TranslationKey) => string;
}) {
  const borderColor =
    order.status === 'READY'
      ? 'border-green-400 bg-green-50'
      : order.status === 'PREPARING'
      ? 'border-yellow-400 bg-yellow-50'
      : 'border-gray-200 bg-white';

  return (
    <div
      className={`rounded-2xl border-2 ${borderColor} p-4 transition-all shadow-sm`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-gray-900">
              #{order.order_number}
            </span>
            <span
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full font-bold ${
                order.order_type === 'INSIDE'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-purple-100 text-purple-700'
              }`}
            >
              {order.order_type === 'INSIDE' ? (
                <Store className="w-3 h-3" />
              ) : (
                <ShoppingBag className="w-3 h-3" />
              )}
              {order.order_type === 'INSIDE'
                ? t('orderTypeInside')
                : t('orderTypeOutside')}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500">
            <Clock className="w-3 h-3" />
            {formatTime(order.created_at)} ·{' '}
            {formatTimeAgo(order.created_at, lang)}
          </div>
        </div>
        <button
          onClick={() => onPrint(order)}
          className="text-gray-400 hover:text-orange-500 p-1.5"
          title={t('reprint')}
        >
          <Flame className="w-4 h-4" />
        </button>
      </div>

      {/* Items */}
      <div className="space-y-1.5 mb-3">
        {order.order_items?.map((item, idx) => (
          <div key={idx} className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-orange-100 text-orange-700 text-sm font-bold">
                  {item.quantity}
                </span>
                <span className="text-sm font-semibold text-gray-900">
                  {item.short_name} {item.variant}
                </span>
              </div>
              {item.options && item.options.length > 0 && (
                <div className="ml-9 mt-0.5 text-xs text-gray-500">
                  {item.options.map((o) => o.name).join(', ')}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Comment */}
      {order.comment && (
        <div className="mb-3 p-2 bg-yellow-50 rounded-lg text-xs text-yellow-800 border border-yellow-200">
          {t('note')}: {order.comment}
        </div>
      )}

      {/* Total */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
        <span className="text-sm text-gray-500">{t('total')}</span>
        <span className="text-lg font-bold text-orange-600">
          {formatYen(order.total_amount)}
        </span>
      </div>

      {/* Action button */}
      {order.status === 'NEW' && (
        <button
          onClick={() => onStatusChange(order.id, 'PREPARING')}
          className="w-full py-3 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-white font-bold text-sm transition-colors active:scale-[0.98] shadow-sm"
        >
          {t('startPreparing')}
        </button>
      )}
      {order.status === 'PREPARING' && (
        <button
          onClick={() => onStatusChange(order.id, 'READY')}
          className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold text-sm transition-colors active:scale-[0.98] flex items-center justify-center gap-2 shadow-sm"
        >
          <CheckCircle2 className="w-5 h-5" />
          {t('markReady')}
        </button>
      )}
      {order.status === 'READY' && (
        <button
          onClick={() => onStatusChange(order.id, 'COMPLETED')}
          className="w-full py-3 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold text-sm transition-colors active:scale-[0.98]"
        >
          {t('completeAndRemove')}
        </button>
      )}
    </div>
  );
}