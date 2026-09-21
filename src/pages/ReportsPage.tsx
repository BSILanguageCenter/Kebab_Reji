import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import { formatYen } from '@/lib/format';
import { TrendingUp, ShoppingCart, Receipt, BarChart3, Download, type LucideIcon } from 'lucide-react';

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
    const totalRevenue = completed.reduce((s: number, o: { total: number }) => s + o.total, 0);
    const orderCount = completed.length;
    const avgCheck = orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0;

    const hourly = Array(24).fill(0);
    completed.forEach((o: any) => {
      const h = new Date(o.created_at).getHours();
      hourly[h] += o.total;
    });

    const orderIds = completed.map((o: { id: string }) => o.id);

    let byPayment = { cash: 0, card: 0, other: 0 };
    if (orderIds.length > 0) {
      const { data: payments } = await supabase
        .from('payments')
        .select('method, amount')
        .in('order_id', orderIds);
      (payments || []).forEach((p: { method: string; amount: number }) => {
        if (p.method in byPayment) (byPayment as Record<string, number>)[p.method] += p.amount;
      });
    }

    let topProducts: { name: string; quantity: number; revenue: number }[] = [];
    if (orderIds.length > 0) {
      const { data: items } = await supabase
        .from('order_items')
        .select('product_name_ru, product_name_ja, quantity, total_price')
        .in('order_id', orderIds);

      const productMap: Record<string, { quantity: number; revenue: number }> = {};
      (items || []).forEach((i: { product_name_ru: string; product_name_ja: string; quantity: number; total_price: number }) => {
        const name = lang === 'ru' ? i.product_name_ru : i.product_name_ja;
        if (!productMap[name]) productMap[name] = { quantity: 0, revenue: 0 };
        productMap[name].quantity += i.quantity;
        productMap[name].revenue += i.total_price;
      });

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
      ...data.topProducts.map((p) => [p.name, String(p.quantity), String(p.revenue)]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${(c ?? '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
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

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900">{t('reports.title')}</h2>
        <div className="flex flex-wrap gap-2">
          {periodButtons.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${
                period === key ? 'bg-orange-600 text-white' : 'bg-white border border-gray-200 text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={exportCSV}
            disabled={!data || data.orderCount === 0}
            className="flex items-center gap-1.5 rounded-xl bg-gray-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-40"
          >
            <Download size={16} />
            CSV
          </button>
        </div>
      </div>

      {!data ? (
        <p className="text-gray-400">...</p>
      ) : data.orderCount === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-gray-400">
          <BarChart3 size={48} strokeWidth={1.5} />
          <p>{t('reports.noData')}</p>
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard icon={TrendingUp} label={t('reports.totalRevenue')} value={formatYen(data.totalRevenue)} color="orange" />
            <StatCard icon={ShoppingCart} label={t('reports.orderCount')} value={String(data.orderCount)} color="blue" />
            <StatCard icon={Receipt} label={t('reports.avgCheck')} value={formatYen(data.avgCheck)} color="green" />
          </div>

          {period === 'today' && (
            <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
              <h3 className="mb-4 text-base font-bold text-gray-900">По часам</h3>
              <div className="flex h-40 items-end gap-1">
                {data.hourly.map((v, h) => (
                  <div key={h} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-orange-500 transition-all hover:bg-orange-600"
                      style={{ height: `${Math.max((v / maxHourly) * 100, v > 0 ? 4 : 0)}%` }}
                      title={`${h}:00 — ${formatYen(v)}`}
                    />
                    <span className="text-[10px] text-gray-400">{h}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="mb-4 text-base font-bold text-gray-900">{t('reports.byPayment')}</h3>
            <div className="grid grid-cols-3 gap-4">
              <PaymentStat label={t('reports.cash')} amount={data.byPayment.cash} />
              <PaymentStat label={t('reports.card')} amount={data.byPayment.card} />
              <PaymentStat label={t('reports.other')} amount={data.byPayment.other} />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="mb-4 text-base font-bold text-gray-900">{t('reports.topProducts')}</h3>
            <div className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-gray-500">
                  <tr>
                    <th className="pb-2 text-left font-semibold">{t('reports.product')}</th>
                    <th className="pb-2 text-right font-semibold">{t('reports.quantity')}</th>
                    <th className="pb-2 text-right font-semibold">{t('reports.revenue')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.topProducts.map((p, i) => (
                    <tr key={i}>
                      <td className="py-2.5 font-semibold text-gray-900">{p.name}</td>
                      <td className="py-2.5 text-right text-gray-600">{p.quantity}</td>
                      <td className="py-2.5 text-right font-bold text-gray-900">{formatYen(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function periodLabel(p: Period) {
  return p === 'today' ? 'Сегодня' : p === 'week' ? '7 дней' : '30 дней';
}

function StatCard({ icon: Icon, label, value, color }: {
  icon: LucideIcon;
  label: string; value: string; color: 'orange' | 'blue' | 'green';
}) {
  const colors = {
    orange: 'bg-orange-50 text-orange-600',
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
  };
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5">
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${colors[color]}`}>
        <Icon size={24} />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

function PaymentStat({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="rounded-xl bg-gray-50 p-4 text-center">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900">{formatYen(amount)}</p>
    </div>
  );
}