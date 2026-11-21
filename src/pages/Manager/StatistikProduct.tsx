import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import {
  fetchSalesSummary,
  fetchTimeline,
  fetchItemSales,
  fetchCategorySales,
  getUnitRange,
  pickBucketKind,
  type DateRange,
  type RangeUnit,
  type SalesSummary,
  type TimelineBucket,
  type TypeKey,
  type ItemSales,
  type CategorySales,
} from '@/services/statistics';
import {
  useCashRegister,
  getDayPeriods,
  getWithdrawalsForDay,
  dayKey,
  type CashPeriod,
} from '@/services/cashRegister';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatYen, formatTime, dateLocale } from '@/locale/format';
import { useI18n } from '@/locale';
import {
  BarChart3,
  Wallet,
  Banknote,
  ChevronLeft,
  ChevronRight,
  Check,
  TrendingUp,
  Receipt,
  ShoppingBag,
  UtensilsCrossed,
  LayoutGrid,
} from 'lucide-react';

// ============================================================
// КОНСТАНТЫ
// ============================================================
const UNITS: { key: RangeUnit; label: Parameters<ReturnType<typeof useI18n>['t']>[0] }[] = [
  { key: 'day', label: 'unitDay' },
  { key: 'week', label: 'unitWeek' },
  { key: 'month', label: 'unitMonth' },
  { key: 'year', label: 'unitYear' },
  { key: 'period', label: 'unitPeriod' },
];

/** Типы заказов: 🍽️ в зале · 🥡 с собой · 🚶 по дороге */
const TYPES: { key: TypeKey; emoji: string; color: string }[] = [
  { key: 'INSIDE', emoji: '🍽️', color: 'var(--st-inside)' },
  { key: 'OUTSIDE', emoji: '🥡', color: 'var(--st-takeaway)' },
  { key: 'ON_THE_WAY', emoji: '🚶', color: 'var(--st-way)' },
];
const ALL_TYPES: TypeKey[] = TYPES.map((x) => x.key);

// ============================================================
// ВСПОМОГАТЕЛЬНОЕ
// ============================================================
function compactNumber(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${Number.isInteger(v) ? v : v.toFixed(1)}M`;
  }
  if (n >= 1000) {
    const v = n / 1000;
    return `${Number.isInteger(v) ? v : v.toFixed(1)}k`;
  }
  return String(Math.round(n));
}

/** Округляет максимум вверх до «красивого» числа для шкалы графика. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function periodKey(p: CashPeriod): string {
  return p.withdrawalId ?? 'open';
}

// ============================================================
// СТРАНИЦА
// ============================================================
export function StatistikProduct() {
  const { t, lang } = useI18n();
  const loc = dateLocale(lang);

  const [unit, setUnit] = useState<RangeUnit>('day');
  const [offset, setOffset] = useState(0);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [listTab, setListTab] = useState<'dishes' | 'categories'>('dishes');

  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineBucket[]>([]);
  const [items, setItems] = useState<ItemSales[]>([]);
  const [categories, setCategories] = useState<CategorySales[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);

  const { register, take } = useCashRegister();

  // ---------- диапазон ----------
  const baseRange = useMemo(
    () => getUnitRange(unit, offset, customStart, customEnd),
    [unit, offset, customStart, customEnd]
  );

  // День, к которому относятся периоды снятия денег
  const sameDay =
    new Date(baseRange.start).toDateString() ===
    new Date(baseRange.end).toDateString();
  const selectedDay: Date | null =
    unit === 'day' || (unit === 'period' && sameDay)
      ? new Date(baseRange.start)
      : null;
  const selectedDayKey = selectedDay ? dayKey(selectedDay) : null;
  const isToday = selectedDayKey === dayKey(new Date());

  const periods: CashPeriod[] = useMemo(
    () => (selectedDay ? getDayPeriods(selectedDay) : []),
    // register.* меняется при новых заказах и после снятия денег
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDayKey, register.amount, register.ordersCount, register.start]
  );
  const closedCount = periods.filter((p) => !p.open).length;
  const showStrip = selectedDay !== null && (isToday || closedCount > 0);

  // Сегодня по умолчанию — период «с последнего снятия денег»; иначе — весь день
  const effectivePick = !showStrip ? 'all' : pick ?? (isToday ? 'open' : 'all');
  const activePeriod =
    effectivePick !== 'all'
      ? periods.find((p) => periodKey(p) === effectivePick) ?? null
      : null;

  useEffect(() => {
    setPick(null);
  }, [unit, offset, customStart, customEnd]);

  const range: DateRange = activePeriod
    ? { start: activePeriod.start, end: activePeriod.end }
    : baseRange;
  const rangeStart = range.start;
  const rangeEnd = range.end;
  const kind = pickBucketKind(unit, baseRange);
  const liveKey = `${register.ordersCount}-${register.amount}`;

  // ---------- загрузка ----------
  const loadedOnce = useRef(false);
  const lastKey = useRef('');
  const loadData = useCallback(async () => {
    const key = `${rangeStart}|${rangeEnd}|${kind}`;
    if (!loadedOnce.current || lastKey.current !== key) setLoading(true);
    lastKey.current = key;
    setError(null);
    try {
      const r: DateRange = { start: rangeStart, end: rangeEnd };
      const [s, tl, i, c] = await Promise.all([
        fetchSalesSummary(r),
        fetchTimeline(r, kind),
        fetchItemSales(r),
        fetchCategorySales(r),
      ]);
      setSummary(s);
      setTimeline(tl);
      setItems(i);
      setCategories(c);
      loadedOnce.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToLoadStats'));
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd, kind, t]);

  useEffect(() => {
    loadData();
    // liveKey: перечитываем при новых заказах
  }, [loadData, liveKey]);

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    },
    []
  );

  // ---------- «Взять деньги» ----------
  const handleTakeCash = () => {
    const rec = take();
    setConfirmOpen(false);
    if (rec) {
      setNotice(`${t('cashTaken')}: ${formatYen(rec.amount)}`);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(null), 4500);
      setPick(null); // → новый открытый период
    }
  };

  const todayWithdrawals = getWithdrawalsForDay(new Date());
  const takenToday = todayWithdrawals.reduce((s, w) => s + w.amount, 0);

  // ---------- подписи ----------
  const dateFmt = (iso: string, o: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleDateString(loc, o);

  const rangeTitle = (() => {
    const s = baseRange.start;
    const e = baseRange.end;
    const thisYear = new Date().getFullYear();
    if (unit === 'day') {
      if (offset === 0)
        return `${t('today')}, ${dateFmt(s, { day: 'numeric', month: 'long' })}`;
      if (offset === -1)
        return `${t('yesterday')}, ${dateFmt(s, { day: 'numeric', month: 'long' })}`;
      return cap(
        dateFmt(s, {
          weekday: 'short',
          day: 'numeric',
          month: 'long',
          ...(new Date(s).getFullYear() !== thisYear ? { year: 'numeric' } : {}),
        })
      );
    }
    if (unit === 'week')
      return `${dateFmt(s, { day: 'numeric', month: 'short' })} – ${dateFmt(e, {
        day: 'numeric',
        month: 'short',
      })}`;
    if (unit === 'month')
      return cap(dateFmt(s, { month: 'long', year: 'numeric' }));
    if (unit === 'year') return String(new Date(s).getFullYear());
    return `${dateFmt(s, { day: 'numeric', month: 'short', year: 'numeric' })} – ${dateFmt(
      e,
      { day: 'numeric', month: 'short', year: 'numeric' }
    )}`;
  })();

  const periodLabel = (p: CashPeriod) =>
    `${formatTime(p.displayFrom)} > ${p.open ? t('periodNow') : formatTime(p.displayTo)}`;

  const totalCaption = activePeriod ? periodLabel(activePeriod) : rangeTitle;

  const orderCount = summary?.orderCount ?? 0;
  const typeCounts: Record<TypeKey, number> = {
    INSIDE: summary?.insideOrders ?? 0,
    OUTSIDE: summary?.takeawayOrders ?? 0,
    ON_THE_WAY: summary?.onTheWayOrders ?? 0,
  };
  const typeSales: Record<TypeKey, number> = {
    INSIDE: summary?.insideSales ?? 0,
    OUTSIDE: summary?.takeawaySales ?? 0,
    ON_THE_WAY: summary?.onTheWaySales ?? 0,
  };

  const maxItemQty = Math.max(...items.map((i) => i.quantity), 1);
  const maxCatTotal = Math.max(...categories.map((c) => c.total), 1);

  const rankClass = (idx: number) =>
    idx === 0 ? 'st-rank st-rank-1' : idx === 1 ? 'st-rank st-rank-2' : idx === 2 ? 'st-rank st-rank-3' : 'st-rank';

  return (
    <div className="st h-full min-h-0 flex flex-col overflow-y-auto lg:overflow-hidden">
      {/* ====================== ВЕРХ: период · день · навигация ====================== */}
      <header className="st-top shrink-0 px-3 lg:px-5 py-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="st-seg">
            {UNITS.map((u) => (
              <button
                key={u.key}
                data-on={unit === u.key}
                onClick={() => {
                  setUnit(u.key);
                  setOffset(0);
                }}
                className="st-seg-btn"
              >
                {t(u.label)}
              </button>
            ))}
          </div>

          {unit !== 'period' ? (
            <div className="flex items-center gap-2">
              {offset !== 0 && (
                <button
                  onClick={() => setOffset(0)}
                  className="text-xs font-bold px-2.5 py-1.5 rounded-lg"
                  style={{ color: 'var(--st-accent)', background: 'var(--st-accent-soft)' }}
                >
                  {t('backToToday')}
                </button>
              )}
              <button
                className="st-icon-btn"
                onClick={() => setOffset((o) => o - 1)}
                aria-label="prev"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="min-w-[10rem] text-center text-sm font-extrabold st-num">
                {rangeTitle}
              </div>
              <button
                className="st-icon-btn"
                onClick={() => setOffset((o) => Math.min(0, o + 1))}
                disabled={offset >= 0}
                aria-label="next"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="rounded-xl px-3 py-2 text-sm border focus:outline-none"
              />
              <span className="st-muted">{t('to')}</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="rounded-xl px-3 py-2 text-sm border focus:outline-none"
              />
            </div>
          )}
        </div>

        {showStrip && (
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            <PeriodChip
              on={effectivePick === 'all'}
              onClick={() => setPick('all')}
              title={t('wholeDay')}
              sub={`${formatYen(periods.reduce((s, p) => s + p.amount, 0))}`}
            />
            {periods.map((p) => {
              const k = periodKey(p);
              return (
                <PeriodChip
                  key={k}
                  on={effectivePick === k}
                  onClick={() => setPick(k)}
                  title={periodLabel(p)}
                  sub={`${formatYen(p.amount)} · ${p.ordersCount}`}
                  live={p.open && isToday}
                />
              );
            })}
          </div>
        )}
      </header>

      {/* ====================== НИЗ: экран ровно пополам ====================== */}
      <div className="lg:flex-1 lg:min-h-0 grid grid-cols-1 lg:grid-cols-2 lg:overflow-hidden">
        {/* ---------- ЛЕВАЯ ПОЛОВИНА: вкладки «Общий» / «По категориям» ---------- */}
        <section className="order-last lg:order-first min-w-0 lg:min-h-0 flex flex-col gap-3 p-3 lg:p-5 lg:pr-2.5">
          <div className="st-tabs shrink-0">
            <button
              className="st-tab"
              data-on={listTab === 'dishes'}
              onClick={() => setListTab('dishes')}
            >
              <UtensilsCrossed className="w-4 h-4" />
              {t('tabDishes')}
            </button>
            <button
              className="st-tab"
              data-on={listTab === 'categories'}
              onClick={() => setListTab('categories')}
            >
              <LayoutGrid className="w-4 h-4" />
              {t('tabCategories')}
            </button>
          </div>

          <div className="flex-1 min-h-0 lg:overflow-y-auto space-y-3 pr-0.5">
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <div
                  className="w-8 h-8 rounded-full animate-spin border-2"
                  style={{
                    borderColor: 'var(--st-track)',
                    borderTopColor: 'var(--st-accent)',
                  }}
                />
              </div>
            ) : listTab === 'dishes' ? (
              <div className="st-card p-4 sm:p-5">
                {items.length === 0 ? (
                  <p className="st-muted text-sm text-center py-10">
                    {t('noSalesData')}
                  </p>
                ) : (
                  <div className="space-y-3.5">
                    {items.map((item, idx) => (
                      <div key={`${item.name}-${item.variant}-${idx}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex items-center gap-2.5">
                            <span className={rankClass(idx)}>{idx + 1}</span>
                            <span className="truncate text-sm font-semibold">
                              {item.name} {item.variant}
                            </span>
                          </div>
                          <div className="shrink-0 text-sm tabular-nums">
                            <b>{item.quantity}</b>
                            <span className="st-muted ml-2">
                              {formatYen(item.total)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full st-track overflow-hidden">
                          <div
                            className="h-full rounded-full st-fill"
                            style={{ width: `${(item.quantity / maxItemQty) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <CategoryShare categories={categories} />
                <div className="st-card p-4 sm:p-5">
                  {categories.length === 0 ? (
                    <p className="st-muted text-sm text-center py-10">
                      {t('noSalesData')}
                    </p>
                  ) : (
                    <div className="space-y-3.5">
                      {categories.map((cat, idx) => (
                        <div key={cat.name}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex items-center gap-2.5">
                              <span className={rankClass(idx)}>{idx + 1}</span>
                              <span className="truncate text-sm font-semibold">
                                {cat.name}
                              </span>
                            </div>
                            <div className="shrink-0 text-sm tabular-nums">
                              <b>{cat.quantity}</b>
                              <span className="st-muted ml-2">
                                {formatYen(cat.total)}
                              </span>
                            </div>
                          </div>
                          <div className="mt-1.5 h-1.5 rounded-full st-track overflow-hidden">
                            <div
                              className="h-full rounded-full st-fill"
                              style={{ width: `${(cat.total / maxCatTotal) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        {/* ---------- ПРАВАЯ ПОЛОВИНА: итого · 4 карточки · график · «Взять деньги» ---------- */}
        <section className="order-first lg:order-last min-w-0 lg:min-h-0 flex flex-col gap-2 p-3 lg:p-4 lg:pl-2">
          <div className="flex-1 min-h-0 lg:overflow-y-auto space-y-2 pr-0.5">
            {error && (
              <div
                className="p-3 rounded-xl text-sm border"
                style={{
                  color: '#dc2626',
                  background: 'rgb(239 68 68 / 0.08)',
                  borderColor: 'rgb(239 68 68 / 0.3)',
                }}
              >
                {error}
              </div>
            )}

            {/* Итого */}
            <div className="st-hero px-3.5 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2.5 min-w-0">
                    <div className="st-hero-label">{t('total')}</div>
                    <div className="text-xl font-extrabold truncate leading-none tabular-nums">
                      {formatYen(summary?.totalSales ?? 0)}
                    </div>
                  </div>
                  <div className="text-[0.6875rem] mt-1 truncate tabular-nums" style={{ opacity: 0.85 }}>
                    {totalCaption}
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 text-xs shrink-0">
                  {TYPES.map((tp) => (
                    <div key={tp.key} className="flex items-center justify-end gap-2 tabular-nums">
                      <span>{tp.emoji}</span>
                      <span style={{ opacity: 0.85 }}>{typeCounts[tp.key]}</span>
                      <span className="font-extrabold w-20 text-right">
                        {formatYen(typeSales[tp.key])}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div
                  className="w-8 h-8 rounded-full animate-spin border-2"
                  style={{
                    borderColor: 'var(--st-track)',
                    borderTopColor: 'var(--st-accent)',
                  }}
                />
              </div>
            ) : (
              <>
                {/* 4 карточки в одну строку */}
                <div className="grid grid-cols-4 gap-2">
                  <StatCard
                    icon={<TrendingUp className="w-3.5 h-3.5" />}
                    tone="accent"
                    label={t('statTotalShort')}
                    value={formatYen(summary?.totalSales ?? 0)}
                  />
                  <StatCard
                    icon={<Receipt className="w-3.5 h-3.5" />}
                    tone="inside"
                    label={t('orders')}
                    value={String(orderCount)}
                  />
                  <StatCard
                    icon={<ShoppingBag className="w-3.5 h-3.5" />}
                    tone="way"
                    label={t('statAvgShort')}
                    value={formatYen(summary?.averageOrder ?? 0)}
                  />
                  {/* 🍽️ в зале · 🥡 с собой · 🚶 по дороге — только цифры */}
                  <div className="st-card p-2.5 min-w-0 flex items-center justify-around gap-1">
                    {TYPES.map((tp) => (
                      <div
                        key={tp.key}
                        className="flex flex-col items-center min-w-0"
                      >
                        <span className="text-sm leading-none">{tp.emoji}</span>
                        <span className="st-num text-lg leading-none mt-1.5 tabular-nums">
                          {typeCounts[tp.key]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* график */}
                <TimelineChart buckets={timeline} loc={loc} />
              </>
            )}
          </div>

          {/* «Взять деньги» — всегда внизу правой половины */}
          <div className="st-card p-3 shrink-0">
            {notice && (
              <div
                className="mb-2 flex items-center gap-1.5 text-[0.6875rem] font-bold rounded-lg px-2 py-1.5"
                style={{ background: 'var(--st-cash-soft)', color: 'var(--st-cash)' }}
              >
                <Check className="w-4 h-4 shrink-0" />
                {notice}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="st-label !text-[0.625rem] flex items-center gap-1.5 whitespace-nowrap shrink-0">
                <Wallet className="w-3 h-3" />
                {t('cashShort')}
              </div>
              <div className="st-muted text-[0.6875rem] tabular-nums whitespace-nowrap truncate min-w-0">
                {t('cashSince').replace('{time}', formatTime(register.displayFrom))}
                {' · '}
                {t('orders')} {register.ordersCount}
                {takenToday > 0 && (
                  <>
                    {' · '}
                    {t('takenShort')} <b className="st-text2">{formatYen(takenToday)}</b>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <div
                className="st-num text-xl truncate leading-none whitespace-nowrap flex-1 min-w-0"
                style={{ color: register.amount > 0 ? 'var(--st-cash)' : undefined }}
              >
                {formatYen(register.amount)}
              </div>
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={register.amount <= 0}
                className="st-cash-btn !h-10 !text-sm !rounded-xl !w-auto px-5 whitespace-nowrap shrink-0"
              >
                <Banknote className="w-4 h-4" />
                {t('takeCashShort')}
              </button>
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        variant="green"
        title={t('takeCash')}
        message={t('takeCashConfirm').replace('{amount}', formatYen(register.amount))}
        confirmLabel={t('takeCash')}
        cancelLabel={t('cancel')}
        onConfirm={handleTakeCash}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

// ============================================================
// ЧИП ПЕРИОДА  «9:00 > 12:00»
// ============================================================
function PeriodChip({
  on,
  onClick,
  title,
  sub,
  live,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  sub: string;
  live?: boolean;
}) {
  return (
    <button onClick={onClick} data-on={on} className="st-chip">
      <div className="flex items-center gap-1.5 text-sm font-extrabold tabular-nums whitespace-nowrap">
        {live && (
          <span className="relative flex h-2 w-2">
            <span
              className="absolute inline-flex h-full w-full rounded-full opacity-70 animate-ping"
              style={{ background: 'var(--st-cash)' }}
            />
            <span
              className="relative inline-flex h-2 w-2 rounded-full"
              style={{ background: 'var(--st-cash)' }}
            />
          </span>
        )}
        {title}
      </div>
      <div className="st-muted text-xs font-semibold whitespace-nowrap mt-0.5 tabular-nums">
        {sub}
      </div>
    </button>
  );
}

// ============================================================
// КАТЕГОРИИ: доли выручки одной полосой + легенда
// ============================================================
const CAT_COLORS = [
  '#f97316', '#6366f1', '#14b8a6', '#eab308',
  '#ec4899', '#3b82f6', '#84cc16', '#a855f7',
];

function CategoryShare({ categories }: { categories: CategorySales[] }) {
  const { t } = useI18n();
  const total = categories.reduce((sum, c) => sum + c.total, 0);

  return (
    <div className="st-card p-4 sm:p-5">
      <h2 className="st-label mb-4">{t('tabCategories')}</h2>
      {total <= 0 ? (
        <div className="flex flex-col items-center justify-center h-32 st-muted">
          <BarChart3 className="w-9 h-9 mb-2 opacity-40" />
          <p className="text-sm">{t('noSalesData')}</p>
        </div>
      ) : (
        <>
          <div className="flex h-5 rounded-full overflow-hidden st-track">
            {categories.map((c, i) => (
              <div
                key={c.name}
                title={`${c.name}: ${formatYen(c.total)}`}
                style={{
                  width: `${(c.total / total) * 100}%`,
                  background: CAT_COLORS[i % CAT_COLORS.length],
                }}
              />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {categories.map((c, i) => (
              <div key={c.name} className="flex items-center gap-2 text-sm min-w-0">
                <span
                  className="st-dot shrink-0"
                  style={{ background: CAT_COLORS[i % CAT_COLORS.length] }}
                />
                <span className="truncate font-semibold">{c.name}</span>
                <span className="ml-auto st-num tabular-nums">
                  {Math.round((c.total / total) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// КАРТОЧКА
// ============================================================
function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone: 'accent' | 'inside' | 'way';
}) {
  return (
    <div className="st-card p-2.5 min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="st-ico !w-6 !h-6 !rounded-lg" data-tone={tone}>
          {icon}
        </span>
        <div className="st-label !text-[0.625rem] truncate whitespace-nowrap">{label}</div>
      </div>
      <div className="st-num text-lg mt-1.5 truncate whitespace-nowrap leading-none">{value}</div>
    </div>
  );
}

// ============================================================
// ГРАФИК: часы / дни / месяцы, столбцы разбиты по типу заказа
// ============================================================
function TimelineChart({
  buckets,
  loc,
}: {
  buckets: TimelineBucket[];
  loc: string;
}) {
  const { t } = useI18n();
  const [metric, setMetric] = useState<'total' | 'count'>('total');
  const [shown, setShown] = useState<TypeKey[]>(ALL_TYPES);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const kind = buckets[0]?.kind ?? 'hour';

  // Для часов обрезаем пустые края; для дней и месяцев показываем всё
  const visible = useMemo<TimelineBucket[]>(() => {
    if (kind !== 'hour') return buckets;
    const withData = buckets
      .map((b, i) => (b.count > 0 ? i : -1))
      .filter((i) => i >= 0);
    if (withData.length === 0) return [];
    let from = withData[0];
    let to = withData[withData.length - 1];
    while (to - from + 1 < 6) {
      if (from > 0) from--;
      if (to - from + 1 < 6 && to < buckets.length - 1) to++;
      if (from === 0 && to === buckets.length - 1) break;
    }
    return buckets.slice(from, to + 1);
  }, [buckets, kind]);

  const hasData = visible.some((b) => b.count > 0);

  const val = (b: TimelineBucket, k: TypeKey) =>
    metric === 'total' ? b.byType[k].total : b.byType[k].count;
  const sumOf = (b: TimelineBucket) =>
    TYPES.reduce((s, tp) => (shown.includes(tp.key) ? s + val(b, tp.key) : s), 0);

  const maxVal = Math.max(...visible.map(sumOf), 0);
  const top = niceMax(maxVal);
  const peakIdx = visible.reduce(
    (best, b, i) => (sumOf(b) > sumOf(visible[best]) ? i : best),
    0
  );
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const focusIdx = activeIdx ?? (visible.length > 0 && hasData ? peakIdx : null);
  const focus = focusIdx !== null ? visible[focusIdx] : null;
  const showValueLabels = visible.length <= 14;

  const fullLabel = (b: TimelineBucket) => {
    const d = new Date(b.start);
    if (b.kind === 'hour')
      return `${String(d.getHours()).padStart(2, '0')}:00`;
    if (b.kind === 'day')
      return cap(
        d.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'long' })
      );
    return cap(d.toLocaleDateString(loc, { month: 'long', year: 'numeric' }));
  };

  const axisLabel = (b: TimelineBucket, i: number) => {
    const d = new Date(b.start);
    if (b.kind === 'hour') return String(d.getHours()).padStart(2, '0');
    if (b.kind === 'month')
      return d.toLocaleDateString(loc, { month: 'short' }).replace('.', '');
    // дни
    const step = Math.ceil(visible.length / 16);
    if (i % step !== 0) return '';
    if (visible.length <= 7)
      return `${d.toLocaleDateString(loc, { weekday: 'short' })} ${d.getDate()}`;
    return String(d.getDate());
  };

  const toggleType = (k: TypeKey) =>
    setShown((cur) =>
      cur.includes(k) ? (cur.length > 1 ? cur.filter((x) => x !== k) : cur) : [...cur, k]
    );

  // итоги для легенды (по всему периоду, в выбранной метрике)
  const legendTotal = (k: TypeKey) =>
    visible.reduce((s, b) => s + val(b, k), 0);

  return (
    <div className="st-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="st-label">
          {kind === 'hour' ? t('salesByHour') : t('salesTimeline')}
        </h2>
        <div className="st-seg">
          <button
            className="st-seg-btn"
            data-on={metric === 'total'}
            onClick={() => setMetric('total')}
          >
            {t('revenue')}
          </button>
          <button
            className="st-seg-btn"
            data-on={metric === 'count'}
            onClick={() => setMetric('count')}
          >
            {t('orders')}
          </button>
        </div>
      </div>

      {/* Легенда-фильтр: эмодзи без названий */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {TYPES.map((tp) => (
          <button
            key={tp.key}
            className="st-legend-btn"
            data-on={shown.includes(tp.key)}
            onClick={() => toggleType(tp.key)}
          >
            {shown.includes(tp.key) && (
              <span className="st-dot" style={{ background: tp.color }} />
            )}
            <span className="text-sm leading-none">{tp.emoji}</span>
            <span className="tabular-nums">
              {metric === 'total'
                ? compactNumber(legendTotal(tp.key))
                : legendTotal(tp.key)}
            </span>
          </button>
        ))}
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center h-28 st-muted">
          <BarChart3 className="w-9 h-9 mb-2 opacity-40" />
          <p className="text-sm">{t('noSalesData')}</p>
        </div>
      ) : (
        <>
          {/* Подробности выбранного столбца (по умолчанию — самого большого) */}
          {focus && (
            <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
              <span className="st-num">{fullLabel(focus)}</span>
              {TYPES.map((tp) => (
                <span key={tp.key} className="tabular-nums st-text2">
                  {tp.emoji} <b>{focus.byType[tp.key].count}</b>
                </span>
              ))}
              <span
                className="ml-auto st-num"
                style={{ color: 'var(--st-accent)' }}
              >
                {formatYen(focus.total)}
              </span>
            </div>
          )}

          <div className="flex gap-2">
            {/* Ось Y */}
            <div className="relative w-8 shrink-0 h-32">
              {ticks.map((tk) => (
                <span
                  key={tk}
                  className="absolute right-0 -translate-y-1/2 text-[0.5625rem] font-mono st-muted tabular-nums"
                  style={{ top: `${(1 - tk) * 100}%` }}
                >
                  {compactNumber(top * tk)}
                </span>
              ))}
            </div>

            {/* Область графика */}
            <div className="relative flex-1 min-w-0 h-32">
              {ticks.map((tk) => (
                <div
                  key={tk}
                  className={`absolute left-0 right-0 ${
                    tk === 0 ? 'st-grid-base' : 'st-grid-line'
                  }`}
                  style={{ top: `${(1 - tk) * 100}%` }}
                />
              ))}

              <div className="absolute inset-0 flex items-end gap-0.5 sm:gap-1">
                {visible.map((b, i) => {
                  const sum = sumOf(b);
                  const pct = top > 0 ? (sum / top) * 100 : 0;
                  const dim = focusIdx !== null && focusIdx !== i;
                  return (
                    <button
                      key={b.start}
                      type="button"
                      onMouseEnter={() => setActiveIdx(i)}
                      onMouseLeave={() => setActiveIdx(null)}
                      onClick={() => setActiveIdx(activeIdx === i ? null : i)}
                      aria-label={`${fullLabel(b)}: ${b.count} — ${formatYen(b.total)}`}
                      className="st-bar-col relative flex-1 min-w-0 h-full flex flex-col justify-end items-center"
                      style={{ opacity: dim ? 0.55 : 1, transition: 'opacity .15s' }}
                    >
                      {showValueLabels && sum > 0 && (
                        <span className="mb-0.5 text-[0.5625rem] font-bold st-text2 tabular-nums">
                          {metric === 'total' ? compactNumber(sum) : sum}
                        </span>
                      )}
                      {sum === 0 ? (
                        <div
                          className="w-full st-track rounded-sm"
                          style={{ height: 2 }}
                        />
                      ) : (
                        <div
                          className="st-bar-stack w-full flex flex-col-reverse overflow-hidden rounded-t-md transition-all duration-300"
                          style={{ height: `${pct}%`, minHeight: 4 }}
                        >
                          {TYPES.map((tp) => {
                            if (!shown.includes(tp.key)) return null;
                            const v = val(b, tp.key);
                            if (v <= 0) return null;
                            return (
                              <div
                                key={tp.key}
                                style={{
                                  height: `${(v / sum) * 100}%`,
                                  background: tp.color,
                                }}
                              />
                            );
                          })}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Подписи оси X */}
          <div className="flex gap-2 mt-1">
            <div className="w-8 shrink-0" />
            <div className="flex-1 min-w-0 flex gap-0.5 sm:gap-1">
              {visible.map((b, i) => (
                <div
                  key={b.start}
                  className="flex-1 min-w-0 text-center text-[0.5625rem] font-mono tabular-nums whitespace-nowrap"
                  style={{
                    color:
                      focusIdx === i ? 'var(--st-text)' : 'var(--st-muted)',
                    fontWeight: focusIdx === i ? 800 : 500,
                  }}
                >
                  {axisLabel(b, i)}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
