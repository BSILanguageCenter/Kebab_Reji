import { useState, useEffect, useCallback } from 'react';
import {
  fetchSalesSummary,
  fetchHourlySales,
  fetchItemSales,
  fetchCategorySales,
  getDateRange,
  type SalesSummary,
  type HourlySales,
  type ItemSales,
  type CategorySales,
} from '@/services/statistics';
import { formatYen } from '@/locale/format';
import { useI18n, type TranslationKey } from '@/locale';
import {
  BarChart3,
  TrendingUp,
  ShoppingBag,
  Store,
  Clock,
} from 'lucide-react';

export function StatistikProduct() {
  const { t } = useI18n();
  const [preset, setPreset] = useState('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [hourly, setHourly] = useState<HourlySales[]>([]);
  const [items, setItems] = useState<ItemSales[]>([]);
  const [categories, setCategories] = useState<CategorySales[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const range = getDateRange(preset, customStart, customEnd);
      const [s, h, i, c] = await Promise.all([
        fetchSalesSummary(range),
        fetchHourlySales(range),
        fetchItemSales(range),
        fetchCategorySales(range),
      ]);
      setSummary(s);
      setHourly(h);
      setItems(i);
      setCategories(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToLoadStats'));
    } finally {
      setLoading(false);
    }
  }, [preset, customStart, customEnd, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const maxHourlyCount = Math.max(...hourly.map((h) => h.count), 1);
  const maxItemQty = Math.max(...items.map((i) => i.quantity), 1);
  const maxCatTotal = Math.max(...categories.map((c) => c.total), 1);

  const presetLabels: Record<string, TranslationKey> = {
    today: 'today',
    yesterday: 'yesterday',
    week: 'thisWeek',
    month: 'thisMonth',
    custom: 'custom',
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {['today', 'yesterday', 'week', 'month', 'custom'].map((p) => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              preset === p
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                : 'bg-white text-gray-600 border border-gray-200 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            {t(presetLabels[p])}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-orange-500"
            />
            <span className="text-gray-500">{t('to')}</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-orange-500"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            <SummaryCard
              label={t('totalSales')}
              value={formatYen(summary?.totalSales ?? 0)}
              icon={<TrendingUp className="w-5 h-5" />}
              color="orange"
            />
            <SummaryCard
              label={t('orders')}
              value={String(summary?.orderCount ?? 0)}
              icon={<ShoppingBag className="w-5 h-5" />}
              color="blue"
            />
            <SummaryCard
              label={t('averageOrder')}
              value={formatYen(summary?.averageOrder ?? 0)}
              icon={<BarChart3 className="w-5 h-5" />}
              color="green"
            />
            <SummaryCard
              label={t('inside')}
              value={String(summary?.insideOrders ?? 0)}
              icon={<Store className="w-5 h-5" />}
              color="purple"
            />
            <SummaryCard
              label={t('outside')}
              value={String(summary?.outsideOrders ?? 0)}
              icon={<ShoppingBag className="w-5 h-5" />}
              color="cyan"
            />
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-gray-500" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
                {t('salesByHour')}
              </h2>
            </div>
            <div className="flex items-end gap-1 h-40 overflow-x-auto">
              {hourly.map((h) => (
                <div
                  key={h.hour}
                  className="flex flex-col items-center gap-1 min-w-[28px] flex-1"
                >
                  <div className="text-xs text-gray-500 font-mono">
                    {h.count || ''}
                  </div>
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-orange-500 to-orange-400 transition-all"
                    style={{
                      height: `${(h.count / maxHourlyCount) * 100}%`,
                      minHeight: h.count > 0 ? '4px' : '0',
                    }}
                    title={`${h.hour}: ${h.count} — ${formatYen(h.total)}`}
                  />
                  <div className="text-[10px] text-gray-500 font-mono">
                    {h.hour.slice(0, 2)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">
                {t('popularItems')}
              </h2>
              {items.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">
                  {t('noSalesData')}
                </p>
              ) : (
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-6 text-right">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold truncate text-gray-900">
                            {item.name} {item.variant}
                          </span>
                          <span className="text-sm font-bold text-orange-600 ml-2">
                            {item.quantity}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-orange-500 rounded-full"
                              style={{
                                width: `${(item.quantity / maxItemQty) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs text-gray-500">
                            {formatYen(item.total)} · {item.percentage}%
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">
                {t('salesByCategory')}
              </h2>
              {categories.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">
                  {t('noSalesData')}
                </p>
              ) : (
                <div className="space-y-2">
                  {categories.map((cat, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="text-sm font-semibold flex-1 truncate text-gray-900">
                        {cat.name}
                      </span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-orange-500 to-red-500 rounded-full"
                          style={{
                            width: `${(cat.total / maxCatTotal) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-sm font-bold text-orange-600 w-20 text-right">
                        {formatYen(cat.total)}
                      </span>
                      <span className="text-xs text-gray-500 w-8 text-right">
                        {cat.quantity}x
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}) {
  const colors: Record<string, string> = {
    orange: 'from-orange-50 to-orange-100 border-orange-200 text-orange-600',
    blue: 'from-blue-50 to-blue-100 border-blue-200 text-blue-600',
    green: 'from-green-50 to-green-100 border-green-200 text-green-600',
    purple: 'from-purple-50 to-purple-100 border-purple-200 text-purple-600',
    cyan: 'from-cyan-50 to-cyan-100 border-cyan-200 text-cyan-600',
  };
  return (
    <div
      className={`bg-gradient-to-br ${colors[color]} border rounded-2xl p-4 shadow-sm`}
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-gray-600 font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}