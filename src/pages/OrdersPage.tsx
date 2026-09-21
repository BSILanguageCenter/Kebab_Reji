import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import type { Order, RestaurantTable, Payment } from '@/lib/types';
import { formatYen, formatTime, formatDate, statusColors } from '@/lib/format';
import { Search, ClipboardList, CreditCard } from 'lucide-react';
import OrderDetailModal from '@/components/OrderDetailModal';

type StatusFilter = 'all' | 'new' | 'cooking' | 'ready' | 'completed' | 'cancelled';
type Tab = 'unpaid' | 'all';

export default function OrdersPage() {
  const { t, lang } = useI18n();
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tableFilter, setTableFilter] = useState('all');
  const [showToday, setShowToday] = useState(true);
  const [tab, setTab] = useState<Tab>('unpaid');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [payments, setPayments] = useState<Record<string, Payment>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    loadOrders();
    supabase.from('restaurant_tables').select('*').then(({ data }) => setTables(data || []));
  }, [search, statusFilter, tableFilter, showToday, tab, reloadKey]);

  async function loadOrders() {
    let query = supabase
      .from('orders')
      .select('*, order_items(*)')
      .order('created_at', { ascending: false });

    if (showToday) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      query = query.gte('created_at', todayStart.toISOString());
    }
    if (tab === 'unpaid') {
      query = query.in('status', ['new', 'cooking', 'ready']);
    }
    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }
    if (tableFilter !== 'all') {
      query = query.eq('table_id', tableFilter);
    }
    if (search.trim()) {
      const num = search.trim().replace(/^#/, '');
      if (/^\d+$/.test(num)) {
        query = query.eq('order_number', parseInt(num));
      }
    }

    const { data } = await query.limit(200);
    if (data) {
      const withTables = await Promise.all(
        (data as Order[]).map(async (order) => {
          if (order.table_id) {
            const { data: tbl } = await supabase
              .from('restaurant_tables')
              .select('*')
              .eq('id', order.table_id)
              .maybeSingle();
            return { ...order, table: tbl as RestaurantTable | null };
          }
          return { ...order, table: null };
        })
      );
      setOrders(withTables);

      const paymentMap: Record<string, Payment> = {};
      await Promise.all(
        withTables.map(async (order) => {
          const { data: pay } = await supabase
            .from('payments')
            .select('*')
            .eq('order_id', order.id)
            .maybeSingle();
          if (pay) paymentMap[order.id] = pay as Payment;
        })
      );
      setPayments(paymentMap);
    }
  }

  const paymentLabel = (order: Order) => {
    const pay = payments[order.id];
    if (!pay) return '-';
    return t(`payment.${pay.method}`);
  };

  const handlePaid = () => {
    setSelectedOrder(null);
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="h-full p-4">
      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab('unpaid')}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${
            tab === 'unpaid' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          Не оплачено
        </button>
        <button
          onClick={() => setTab('all')}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${
            tab === 'all' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          Все заказы
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('orders.search')}
            className="rounded-xl border border-gray-200 py-2.5 pl-10 pr-4 text-sm"
          />
        </div>
        <button
          onClick={() => setShowToday(!showToday)}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${
            showToday ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {t('orders.filterToday')}
        </button>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
        >
          <option value="all">{t('orders.allStatuses')}</option>
          {(['new', 'cooking', 'ready', 'completed', 'cancelled'] as const).map((s) => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>
        <select
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
        >
          <option value="all">{t('orders.allTables')}</option>
          {tables.map((tbl) => (
            <option key={tbl.id} value={tbl.id}>{tbl.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {orders.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-gray-400">
          <ClipboardList size={48} strokeWidth={1.5} />
          <p>{tab === 'unpaid' ? 'Нет неоплаченных заказов' : t('orders.noOrders')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">{t('orders.orderNumber')}</th>
                <th className="px-4 py-3 text-left font-semibold">{t('orders.date')}</th>
                <th className="px-4 py-3 text-left font-semibold">{t('orders.time')}</th>
                <th className="px-4 py-3 text-left font-semibold">{t('orders.table')}</th>
                <th className="px-4 py-3 text-left font-semibold">{t('orders.type')}</th>
                <th className="px-4 py-3 text-left font-semibold">{t('orders.status')}</th>
                <th className="px-4 py-3 text-right font-semibold">{t('orders.total')}</th>
                <th className="px-4 py-3 text-left font-semibold">{t('orders.payment')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders.map((order) => (
                <tr
                  key={order.id}
                  onClick={() => setSelectedOrder(order)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-bold text-gray-900">#{order.order_number}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(order.created_at, lang)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatTime(order.created_at, lang)}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {order.table ? order.table.name : '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{t(`orderType.${order.order_type}`)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusColors[order.status]}`}>
                      {t(`status.${order.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">{formatYen(order.total)}</td>
                  <td className="px-4 py-3 text-gray-600">{paymentLabel(order)}</td>
                  <td className="px-4 py-3">
                    {!payments[order.id] && order.status !== 'cancelled' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedOrder(order);
                        }}
                        className="flex items-center gap-1.5 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-600"
                      >
                        <CreditCard size={14} />
                        Оплатить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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