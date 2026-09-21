// src/pages/ReportsPage.tsx
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import { formatYen } from '@/lib/format';
import {
  TrendingUp,
  ShoppingCart,
  Receipt,
  BarChart3,
  Download,
  Banknote,
  CreditCard,
  Wallet,
  Trophy,
  Flame,
  type LucideIcon,
} from 'lucide-react';

type Period = 'today' | 'week' | 'month';

interface ReportData {
  totalRevenue: number;
  orderCount: number;
  avgCheck: number;
  byPayment: { cash: number; card: number; other: number };
  topProducts: { name: string; quantity: number; revenue: number }[];
  hourly: number[];
}

export default function ReportsPage() {
  const { t, lang } = useI18n();
  const [period, setPeriod] = useState<Period>('today');
  const [data, setData] = useState<ReportData | null>(null);

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, lang]);

  async function loadReport() {
    const now = new Date();
    const start = new Date();
    if (period === 'today') start.setHours(0, 0, 0, 0);
    else if (period === 'week') start.setDate(now.getDate() - 7);
    else start.setMonth(now.getMonth() - 1);

    const { data: orders } = await supabase
      .from('orders')
      .select('id, total, status, created_at')
      .gte('created_at', start.toISOString())
      .eq('status', 'completed');

    const completed = orders || [];
    const totalRevenue = completed.reduce(
      (s: number, o: { total: number }) => s + o.total,
      0
    );
    const orderCount = completed.length;
    const avgCheck = orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0;

    const hourly = Array(24).fill(0);
    completed.forEach((o: { created_at: string; total: number }) => {
      const h = new Date(o.created_at).getHours();
      hourly[h] += o.total;
    });

    const orderIds = completed.map((o: { id: string }) => o.id);

    const byPayment = { cash: 0, card: 0, other: 0 };
    if (orderIds.length > 0) {
      const { data: payments } = await supabase
        .from('payments')
        .select('method, amount')
        .in('order_id', orderIds);
      (payments || []).forEach((p: { method: string; amount: number }) => {
        if (p.method in byPayment)
          (byPayment as Record<string, number>)[p.method] += p.amount;
      });
    }

    let topProducts: { name: string; quantity: number; revenue: number }[] = [];
    if (orderIds.length > 0) {
      const { data: items } = await supabase
        .from('order_items')
        .select('product_name_ru, product_name_ja, quantity, total_price')
        .in('order_id', orderIds);

      const productMap: Record<
        string,
        { quantity: number; revenue: number }
      > = {};
      (
        items || []
      ).forEach(
        (i: {
          product_name_ru: string;
          product_name_ja: string;
          quantity: number;
          total_price: number;
        }) => {
          const name = lang === 'ru' ? i.product_name_ru : i.product_name_ja;
          if (!productMap[name]) productMap[name] = { quantity: 0, revenue: 0 };
          productMap[name].quantity += i.quantity;
          productMap[name].revenue += i.total_price;
        }
      );

      topProducts = Object.entries(productMap)
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10);
    }

    setData({ totalRevenue, orderCount, avgCheck, byPayment, topProducts, hourly });
  }

  const exportCSV = () => {
    if (!data) return;
    const rows = [
      ['Показатель', 'Значение'],
      ['Период', periodLabel(period)],
      ['Выручка', String(data.totalRevenue)],
      ['Заказов', String(data.orderCount)],
      ['Средний чек', String(data.avgCheck)],
      [],
      ['Товар', 'Количество', 'Выручка'],
      ...data.topProducts.map((p) => [
        p.name,
        String(p.quantity),
        String(p.revenue),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${(c ?? '').toString().replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${period}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const periodButtons: { key: Period; label: string }[] = [
    { key: 'today', label: 'Сегодня' },
    { key: 'week', label: '7 дней' },
    { key: 'month', label: '30 дней' },
  ];

  const maxHourly = data ? Math.max(...data.hourly, 1) : 1;
  const totalPayment = data
    ? data.byPayment.cash + data.byPayment.card + data.byPayment.other
    : 0;

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      {/* ═══ Header ════════════════════════════════════════════════════ */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('reports.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {period === 'today' && 'Показатели за сегодня'}
            {period === 'week' && 'Показатели за последние 7 дней'}
            {period === 'month' && 'Показатели за последние 30 дней'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-2xl bg-white p-1 shadow-sm">
            {periodButtons.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setPeriod(key)}
                className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                  period === key
                    ? 'bg-orange-600 text-white shadow-md shadow-orange-600/30'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={exportCSV}
            disabled={!data || data.orderCount === 0}
            className="flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 disabled:opacity-40"
          >
            <Download size={16} />
            CSV
          </button>
        </div>
      </div>

      {/* ═══ Body ══════════════════════════════════════════════════════ */}
      {!data ? (
        <div className="flex h-64 items-center justify-center text-gray-400">
          Загрузка…
        </div>
      ) : data.orderCount === 0 ? (
        <div className="flex h-96 flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed border-gray-200 bg-white text-gray-400">
          <BarChart3 size={64} strokeWidth={1.5} />
          <p className="text-lg font-medium">{t('reports.noData')}</p>
        </div>
      ) : (
        <>
          {/* ─── Stats ─────────────────────────────────────────────── */}
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard
              icon={TrendingUp}
              label={t('reports.totalRevenue')}
              value={formatYen(data.totalRevenue)}
              gradient="from-orange-500 to-red-500"
              bgGradient="from-orange-50 to-red-50"
            />
            <StatCard
              icon={ShoppingCart}
              label={t('reports.orderCount')}
              value={String(data.orderCount)}
              gradient="from-blue-500 to-indigo-500"
              bgGradient="from-blue-50 to-indigo-50"
            />
            <StatCard
              icon={Receipt}
              label={t('reports.avgCheck')}
              value={formatYen(data.avgCheck)}
              gradient="from-green-500 to-emerald-500"
              bgGradient="from-green-50 to-emerald-50"
            />
          </div>

          {/* ─── Hourly chart ──────────────────────────────────────── */}
          {period === 'today' && (
            <div className="mb-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-gray-900">
                    Выручка по часам
                  </h3>
                  <p className="text-xs text-gray-500">
                    Сегодняшние продажи в разрезе времени
                  </p>
                </div>
                <div className="flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-700">
                  <Flame size={12} />
                  Пик: {formatYen(maxHourly)}
                </div>
              </div>
              <div className="flex h-48 items-end gap-1">
                {data.hourly.map((v, h) => {
                  const pct = (v / maxHourly) * 100;
                  const isPeak = v === maxHourly && v > 0;
                  return (
                    <div
                      key={h}
                      className="group flex flex-1 flex-col items-center gap-1"
                    >
                      <div className="relative flex w-full flex-1 items-end">
                        {v > 0 && (
                          <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-900 px-2 py-1 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
                            {formatYen(v)}
                          </div>
                        )}
                        <div
                          className={`w-full rounded-t-md transition-all ${
                            isPeak
                              ? 'bg-gradient-to-t from-orange-600 to-red-500'
                              : 'bg-gradient-to-t from-orange-500 to-orange-300'
                          } hover:opacity-90`}
                          style={{ height: `${Math.max(pct, v > 0 ? 4 : 0)}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-medium text-gray-400">
                        {h}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── Payment + Top products ────────────────────────────── */}
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
            {/* Payment breakdown */}
            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-2">
              <h3 className="mb-1 text-base font-bold text-gray-900">
                {t('reports.byPayment')}
              </h3>
              <p className="mb-5 text-xs text-gray-500">
                Распределение выручки по способам оплаты
              </p>

              <div className="flex flex-col gap-4">
                <PaymentRow
                  icon={Banknote}
                  label={t('reports.cash')}
                  amount={data.byPayment.cash}
                  total={totalPayment}
                  color="green"
                />
                <PaymentRow
                  icon={CreditCard}
                  label={t('reports.card')}
                  amount={data.byPayment.card}
                  total={totalPayment}
                  color="blue"
                />
                <PaymentRow
                  icon={Wallet}
                  label={t('reports.other')}
                  amount={data.byPayment.other}
                  total={totalPayment}
                  color="purple"
                />
              </div>

              {/* Большая сумма */}
              <div className="mt-6 flex items-center justify-between rounded-2xl bg-gradient-to-r from-gray-900 to-gray-700 p-5 text-white">
                <div>
                  <p className="text-xs font-medium text-gray-300">
                    Итого оплачено
                  </p>
                  <p className="text-2xl font-bold">
                    {formatYen(totalPayment)}
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
                  <Receipt size={24} />
                </div>
              </div>
            </div>

            {/* Top products */}
            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-3">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-gray-900">
                    {t('reports.topProducts')}
                  </h3>
                  <p className="text-xs text-gray-500">
                    Самые продаваемые блюда за период
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-yellow-400 to-orange-500 text-white shadow-md shadow-orange-500/30">
                  <Trophy size={20} />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {data.topProducts.map((p, i) => {
                  const maxQty = data.topProducts[0]?.quantity || 1;
                  const pct = (p.quantity / maxQty) * 100;
                  const medalColor =
                    i === 0
                      ? 'from-yellow-400 to-orange-500'
                      : i === 1
                      ? 'from-gray-300 to-gray-400'
                      : i === 2
                      ? 'from-amber-600 to-amber-700'
                      : 'from-gray-100 to-gray-200';
                  const medalText = i < 3 ? 'text-white' : 'text-gray-600';
                  return (
                    <div
                      key={i}
                      className="relative overflow-hidden rounded-2xl bg-gray-50 p-3 transition-all hover:bg-gray-100"
                    >
                      {/* Прогресс-бар */}
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-orange-200/40 to-orange-100/20"
                        style={{ width: `${pct}%` }}
                      />
                      <div className="relative flex items-center gap-3">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold ${medalColor} ${medalText} shadow-sm`}
                        >
                          {i + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-gray-900">
                            {p.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {p.quantity} шт · {formatYen(p.revenue)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold text-orange-600">
                            {p.quantity}
                          </p>
                          <p className="text-[10px] font-medium uppercase text-gray-400">
                            порций
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ПОДКОМПОНЕНТЫ
// ═══════════════════════════════════════════════════════════════════════════
function periodLabel(p: Period) {
  return p === 'today' ? 'Сегодня' : p === 'week' ? '7 дней' : '30 дней';
}

function StatCard({
  icon: Icon,
  label,
  value,
  gradient,
  bgGradient,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  gradient: string;
  bgGradient: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-3xl border border-gray-200 bg-gradient-to-br ${bgGradient} p-6 shadow-sm`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-600">{label}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} text-white shadow-lg`}
        >
          <Icon size={26} />
        </div>
      </div>
    </div>
  );
}

function PaymentRow({
  icon: Icon,
  label,
  amount,
  total,
  color,
}: {
  icon: LucideIcon;
  label: string;
  amount: number;
  total: number;
  color: 'green' | 'blue' | 'purple';
}) {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  const colors = {
    green: {
      iconBg: 'bg-green-100 text-green-700',
      bar: 'from-green-500 to-emerald-500',
    },
    blue: {
      iconBg: 'bg-blue-100 text-blue-700',
      bar: 'from-blue-500 to-indigo-500',
    },
    purple: {
      iconBg: 'bg-purple-100 text-purple-700',
      bar: 'from-purple-500 to-fuchsia-500',
    },
  }[color];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${colors.iconBg}`}
          >
            <Icon size={16} />
          </div>
          <span className="text-sm font-semibold text-gray-700">{label}</span>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-gray-900">{formatYen(amount)}</p>
          <p className="text-[10px] font-medium uppercase text-gray-400">
            {pct.toFixed(0)}%
          </p>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${colors.bar} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}