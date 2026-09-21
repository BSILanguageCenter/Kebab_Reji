// src/pages/OrdersPage.tsx
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import type { RestaurantTable, Payment } from '@/lib/types';
import { formatYen, formatTime, formatDate, statusColors } from '@/lib/format';
import {
  Search, ClipboardList, CreditCard, Armchair, ShoppingBag, X, Filter,
  Clock, CheckCircle2, Banknote, CreditCard as CardIcon, Wallet, AlertCircle,
  Loader2, WifiOff, RefreshCw,
} from 'lucide-react';
import OrderDetailModal from '@/components/OrderDetailModal';
import {
  loadOrdersCache, saveOrdersCache, fetchOrdersFromSupabase,
  filterOrdersLocally, invalidateOrdersCache, type OrderWithJoins,
} from '@/lib/ordersCache';
import { useSyncEvent } from '@/hooks/useSync';

type StatusFilter = 'all' | 'new' | 'cooking' | 'ready' | 'completed' | 'cancelled';
type Tab = 'unpaid' | 'all';

export default function OrdersPage() {
  const { t, lang } = useI18n();
  const initialCache = loadOrdersCache();

  const [orders, setOrders] = useState<OrderWithJoins[]>(initialCache?.orders ?? []);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tableFilter, setTableFilter] = useState('all');
  const [showToday, setShowToday] = useState(true);
  const [tab, setTab] = useState<Tab>('unpaid');
  const [selectedOrder, setSelectedOrder] = useState<OrderWithJoins | null>(null);
  const [payments, setPayments] = useState<Record<string, Payment>>(initialCache?.payments ?? {});
  const [loading, setLoading] = useState(!initialCache);
  const [reloadKey, setReloadKey] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [usingCache, setUsingCache] = useState(!!initialCache);

  // Мониторинг сети
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    setIsOnline(navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Столы
  useEffect(() => {
    supabase
      .from('restaurant_tables')
      .select('id, name, status, sort_order')
      .order('sort_order')
      .then(({ data }) => setTables((data ?? []) as RestaurantTable[]));
  }, []);

  // Загрузка заказов (SWR)
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const cache = loadOrdersCache();
      if (cache && !reloadKey) {
        const filtered = filterOrdersLocally(cache, {
          tab, showToday, statusFilter, tableFilter, search,
        });
        if (!cancelled) {
          setOrders(filtered);
          setPayments(cache.payments);
          setUsingCache(true);
        }
      }

      setLoading(true);
      try {
        const fresh = await fetchOrdersFromSupabase({
          tab, showToday, statusFilter, tableFilter, search,
        });
        if (cancelled) return;

        setOrders(fresh.orders);
        setPayments(fresh.payments);
        setUsingCache(false);
        setIsOnline(true);

        if (!search.trim() && statusFilter === 'all' && tableFilter === 'all') {
          saveOrdersCache(fresh.orders, fresh.payments, { tab, showToday });
        }
      } catch (err) {
        console.warn('[Orders] offline:', err);
        setIsOnline(false);
        setUsingCache(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [search, statusFilter, tableFilter, showToday, tab, reloadKey]);

  // ─── Синхронизация с другими устройствами ───────────────────────────────
  useSyncEvent(['orders-changed', 'payments-changed', 'tables-changed'], (_event, source) => {
    if (source === 'remote') {
      invalidateOrdersCache();
      setReloadKey((k) => k + 1);
    }
  });

  const summary = useMemo(() => {
    const unpaid = orders.filter((o) => !payments[o.id]);
    const paid = orders.filter((o) => payments[o.id]);
    const unpaidTotal = unpaid.reduce((s, o) => s + o.total, 0);
    const paidTotal = paid.reduce((s, o) => s + o.total, 0);
    return {
      total: orders.length,
      unpaidCount: unpaid.length,
      paidCount: paid.length,
      unpaidTotal,
      paidTotal,
    };
  }, [orders, payments]);

  const handlePaid = () => {
    setSelectedOrder(null);
    invalidateOrdersCache();
    setReloadKey((k) => k + 1);
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setTableFilter('all');
    setShowToday(true);
  };

  const handleManualRefresh = () => {
    invalidateOrdersCache();
    setReloadKey((k) => k + 1);
  };

  const hasActiveFilters =
    search.trim() !== '' || statusFilter !== 'all' || tableFilter !== 'all';

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-3 lg:p-4">
      {!isOnline && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
          <WifiOff size={22} className="shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800">Нет подключения</p>
            <p className="text-xs text-amber-700">Показываем сохранённые заказы</p>
          </div>
        </div>
      )}

      {isOnline && usingCache && !loading && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5">
          <RefreshCw size={18} className="shrink-0 text-blue-600" />
          <p className="flex-1 text-xs text-blue-800">
            <b>Данные из кэша</b> · обновление в фоне…
          </p>
          <button
            onClick={handleManualRefresh}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
          >
            Обновить
          </button>
        </div>
      )}

      {/* Табы */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => setTab('unpaid')}
            className={`flex items-center gap-2 rounded-xl px-5 py-3 text-base font-bold transition-all active:scale-[0.98] ${
              tab === 'unpaid'
                ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/30'
                : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50'
            }`}
          >
            <AlertCircle size={18} />
            Не оплачено
            {summary.unpaidCount > 0 && (
              <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                tab === 'unpaid' ? 'bg-white/20 text-white' : 'bg-orange-100 text-orange-700'
              }`}>
                {summary.unpaidCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('all')}
            className={`flex items-center gap-2 rounded-xl px-5 py-3 text-base font-bold transition-all active:scale-[0.98] ${
              tab === 'all'
                ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/30'
                : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50'
            }`}
          >
            <ClipboardList size={18} />
            Все заказы
            {summary.total > 0 && (
              <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                tab === 'all' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
              }`}>
                {summary.total}
              </span>
            )}
          </button>
        </div>

        {tab === 'unpaid' && summary.unpaidCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-orange-50 px-4 py-2">
            <AlertCircle size={18} className="text-orange-600" />
            <div>
              <p className="text-xs font-semibold text-orange-700">К оплате:</p>
              <p className="text-base font-bold text-orange-700">
                {formatYen(summary.unpaidTotal)}
              </p>
            </div>
          </div>
        )}

        {tab === 'all' && summary.paidCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-green-50 px-4 py-2">
            <CheckCircle2 size={18} className="text-green-600" />
            <div>
              <p className="text-xs font-semibold text-green-700">
                Оплачено ({summary.paidCount}):
              </p>
              <p className="text-base font-bold text-green-700">
                {formatYen(summary.paidTotal)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Фильтры */}
      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[180px] flex-1">
            <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по номеру..."
              className="w-full rounded-xl border-2 border-gray-200 py-3 pl-11 pr-4 text-base transition-colors focus:border-orange-400 focus:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-gray-400 hover:bg-gray-100"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <button
            onClick={() => setShowToday(!showToday)}
            className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all active:scale-[0.98] ${
              showToday
                ? 'bg-orange-100 text-orange-700 ring-2 ring-inset ring-orange-500'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Clock size={16} />
            Сегодня
          </button>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-xl border-2 border-gray-200 px-4 py-3 text-sm font-medium focus:border-orange-400 focus:outline-none"
          >
            <option value="all">{t('orders.allStatuses')}</option>
            {(['new', 'cooking', 'ready', 'completed', 'cancelled'] as const).map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </select>

          <select
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            className="rounded-xl border-2 border-gray-200 px-4 py-3 text-sm font-medium focus:border-orange-400 focus:outline-none"
          >
            <option value="all">{t('orders.allTables')}</option>
            {tables.map((tbl) => (
              <option key={tbl.id} value={tbl.id}>{tbl.name}</option>
            ))}
          </select>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-4 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-200"
            >
              <X size={16} />
              Сбросить
            </button>
          )}
        </div>
      </div>

      {/* Список */}
      {loading && orders.length === 0 ? (
        <div className="flex h-64 items-center justify-center gap-3 text-gray-400">
          <Loader2 size={28} className="animate-spin" />
          <span className="text-base">Загрузка…</span>
        </div>
      ) : orders.length === 0 ? (
        <EmptyState tab={tab} hasFilters={hasActiveFilters} />
      ) : (
        <>
          {/* Планшет */}
          <div className="flex flex-col gap-3 xl:hidden">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                payment={payments[order.id] || null}
                lang={lang}
                t={t}
                onOpen={() => setSelectedOrder(order)}
              />
            ))}
          </div>

          {/* Десктоп */}
          <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm xl:block">
            <table className="w-full text-base">
              <thead className="border-b-2 border-gray-100 bg-gray-50">
                <tr>
                  <th className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-gray-500">{t('orders.orderNumber')}</th>
                  <th className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-gray-500">Дата / время</th>
                  <th className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-gray-500">Стол / тип</th>
                  <th className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-gray-500">{t('orders.status')}</th>
                  <th className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-gray-500">Позиций</th>
                  <th className="px-5 py-4 text-right text-xs font-bold uppercase tracking-wide text-gray-500">{t('orders.total')}</th>
                  <th className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-gray-500">{t('orders.payment')}</th>
                  <th className="px-5 py-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((order) => {
                  const payment = payments[order.id];
                  const isPaid = !!payment;
                  return (
                    <tr
                      key={order.id}
                      onClick={() => setSelectedOrder(order)}
                      className={`cursor-pointer transition-colors ${
                        isPaid ? 'hover:bg-gray-50' : 'bg-orange-50/30 hover:bg-orange-50'
                      }`}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                            isPaid ? 'bg-green-100 text-green-700' : 'bg-orange-500 text-white'
                          }`}>
                            {isPaid ? <CheckCircle2 size={20} /> : `#${order.order_number}`}
                          </div>
                          <div>
                            <p className="text-base font-bold text-gray-900">#{order.order_number}</p>
                            {!isPaid && (
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-600">Ждёт оплаты</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600">
                        <div>{formatDate(order.created_at, lang)}</div>
                        <div className="text-gray-400">{formatTime(order.created_at, lang)}</div>
                      </td>
                      <td className="px-5 py-4">
                        {order.table ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                            <Armchair size={12} />
                            {order.table.name}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700">
                            <ShoppingBag size={12} />
                            {t('orderType.takeaway')}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${statusColors[order.status]}`}>
                          {t(`status.${order.status}`)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600">
                        <span className="font-semibold">{order.order_items?.length || 0}</span>{' '}
                        <span className="text-gray-400">шт</span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <p className="text-lg font-bold text-gray-900">{formatYen(order.total)}</p>
                      </td>
                      <td className="px-5 py-4">
                        {payment ? <PaymentBadge method={payment.method} t={t} /> : <span className="text-sm text-gray-400">—</span>}
                      </td>
                      <td className="px-5 py-4">
                        {!payment && order.status !== 'cancelled' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); }}
                            className="flex items-center gap-1.5 rounded-xl bg-green-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-green-600 active:scale-95"
                          >
                            <CreditCard size={16} />
                            Оплатить
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          payment={payments[selectedOrder.id] || null}
          onClose={() => setSelectedOrder(null)}
          onPaid={handlePaid}
        />
      )}
    </div>
  );
}

function OrderCard({ order, payment, lang, t, onOpen }: {
  order: OrderWithJoins;
  payment: Payment | null;
  lang: 'ru' | 'ja';
  t: (key: string) => string;
  onOpen: () => void;
}) {
  const isPaid = !!payment;
  const itemCount = order.order_items?.length || 0;
  const totalQty = order.order_items?.reduce((s, it) => s + it.quantity, 0) || 0;

  return (
    <div
      onClick={onOpen}
      className={`relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-2xl border-2 bg-white p-4 shadow-sm transition-all active:scale-[0.99] ${
        isPaid ? 'border-gray-100 hover:border-gray-300' : 'border-orange-200 hover:border-orange-400'
      }`}
    >
      {!isPaid && <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-orange-400 to-orange-600" />}

      <div className="flex items-start justify-between gap-3 pl-2">
        <div className="flex items-center gap-3">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-base font-bold ${
            isPaid ? 'bg-green-100 text-green-700' : 'bg-orange-500 text-white'
          }`}>
            {isPaid ? <CheckCircle2 size={24} /> : `#${order.order_number}`}
          </div>
          <div>
            <p className="text-lg font-bold leading-tight text-gray-900">
              Заказ #{order.order_number}
            </p>
            <p className="text-xs text-gray-500">
              {formatDate(order.created_at, lang)} · {formatTime(order.created_at, lang)}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusColors[order.status]}`}>
            {t(`status.${order.status}`)}
          </span>
          {!isPaid && (
            <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700">
              Не оплачен
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-2">
        {order.table ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            <Armchair size={14} />
            {order.table.name}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700">
            <ShoppingBag size={14} />
            {t('orderType.takeaway')}
          </span>
        )}

        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
          <ClipboardList size={14} />
          {itemCount} поз. · {totalQty} шт
        </span>

        {payment && <PaymentBadge method={payment.method} t={t} />}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3 pl-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Итого</p>
          <p className={`text-2xl font-bold ${isPaid ? 'text-gray-900' : 'text-orange-600'}`}>
            {formatYen(order.total)}
          </p>
        </div>

        {!payment && order.status !== 'cancelled' ? (
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="flex items-center gap-2 rounded-xl bg-green-500 px-5 py-3 text-base font-bold text-white shadow-sm transition-all hover:bg-green-600 active:scale-95"
          >
            <CreditCard size={20} />
            Оплатить
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="rounded-xl bg-gray-100 px-4 py-3 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200"
          >
            Подробнее
          </button>
        )}
      </div>
    </div>
  );
}

function PaymentBadge({ method, t }: { method: 'cash' | 'card' | 'other'; t: (key: string) => string }) {
  const config = {
    cash: { icon: Banknote, label: t('payment.cash'), cls: 'bg-green-100 text-green-700' },
    card: { icon: CardIcon, label: t('payment.card'), cls: 'bg-blue-100 text-blue-700' },
    other: { icon: Wallet, label: t('payment.other'), cls: 'bg-purple-100 text-purple-700' },
  }[method];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${config.cls}`}>
      <Icon size={14} />
      {config.label}
    </span>
  );
}

function EmptyState({ tab, hasFilters }: { tab: Tab; hasFilters: boolean }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-gray-200 bg-white text-gray-400">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
        {hasFilters ? <Filter size={36} strokeWidth={1.5} /> : <ClipboardList size={36} strokeWidth={1.5} />}
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold text-gray-600">
          {hasFilters ? 'Ничего не найдено' : tab === 'unpaid' ? 'Нет неоплаченных заказов' : 'Заказов пока нет'}
        </p>
        <p className="mt-1 text-sm text-gray-400">
          {hasFilters ? 'Попробуйте изменить фильтры' : 'Новые заказы появятся здесь'}
        </p>
      </div>
    </div>
  );
}