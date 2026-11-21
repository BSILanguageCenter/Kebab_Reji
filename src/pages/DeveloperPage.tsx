// src/pages/DeveloperPage.tsx
/**
 * Режим разработчика.
 *  1) Календарь на весь экран: дни, в которые были заказы — активные кнопки.
 *  2) Нажатие на день → страница со всеми заказами этого дня (плитки 6 в ряд).
 *  3) В дне три вкладки: «Заказы», «Очередь» (операции синхронизации) и
 *     «Снятия» (снятие денег из кассы). В каждой можно отметить записи
 *     и удалить их. Заказ пропадает отовсюду — localStorage, Supabase,
 *     Firebase, Google Sheets (и на других устройствах).
 */
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Square,
  CheckSquare,
  Banknote,
  ListOrdered,
  Receipt,
} from 'lucide-react';
import { useI18n } from '@/locale';
import { ActiveRoleContext, PageActions } from '@/components/PageActions';
import { DiagnosticsButton } from '@/components/DiagnosticsButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatYen, formatTime, dateLocale } from '@/locale/format';
import { getAllOrders, todayStr } from '@/lib/localStore';
import { fetchOrdersRange } from '@/services/supabaseOrders';
import { isOrderDeleted } from '@/services/deletedOrders';
import { deleteOrdersEverywhere } from '@/services/orderDeletion';
import { getAllOperations, removeOperation } from '@/services/syncQueue';
import {
  getWithdrawalsForDay,
  deleteWithdrawals,
} from '@/services/cashRegister';
import type { Order, OrderType } from '@/types/database';
import type { SyncOperation } from '@/types/sync';

type DayTab = 'orders' | 'queue' | 'cash';

const TYPE_EMOJI: Record<OrderType, string> = {
  INSIDE: '🍽️',
  OUTSIDE: '🥡',
  ON_THE_WAY: '🚶',
};

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function dayOf(iso: string): string {
  return todayStr(new Date(iso));
}

export default function DeveloperPage() {
  const { t, lang } = useI18n();
  const loc = dateLocale(lang);
  const active = useContext(ActiveRoleContext) === 'developer';

  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [cloudFailed, setCloudFailed] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  // дни → месяцы (нажать на заголовок) → годы (нажать ещё раз)
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
  const [yearPage, setYearPage] = useState(Math.floor(now.getFullYear() / 10) * 10);
  const [target, setTarget] = useState<Order | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // вкладки дня + выбор записей для удаления
  const [tab, setTab] = useState<DayTab>('orders');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [dataTick, setDataTick] = useState(0); // перечитать очередь / снятия

  // Смена дня или вкладки — выбор сбрасываем
  useEffect(() => {
    setSelected(new Set());
    setBulkOpen(false);
  }, [day, tab]);

  // ---------- загрузка заказов месяца (облако + локально) ----------
  useEffect(() => {
    if (!active || mode !== 'days') return;
    let cancelled = false;
    setLoading(true);
    setCloudFailed(false);

    const start = new Date(ym.y, ym.m, 1, 0, 0, 0, 0);
    const end = new Date(ym.y, ym.m + 1, 0, 23, 59, 59, 999);

    (async () => {
      const byId = new Map<string, Order>();
      try {
        const remote = await fetchOrdersRange(
          start.toISOString(),
          end.toISOString()
        );
        for (const o of remote) byId.set(o.id, o);
      } catch (e) {
        console.warn('[DeveloperPage] cloud fetch failed:', e);
        if (!cancelled) setCloudFailed(true);
      }
      for (const l of getAllOrders()) {
        const ms = new Date(l.created_at).getTime();
        if (ms < start.getTime() || ms > end.getTime()) continue;
        const r = byId.get(l.id);
        if (
          !r ||
          new Date(l.updated_at).getTime() >= new Date(r.updated_at).getTime()
        ) {
          byId.set(l.id, l);
        }
      }
      if (cancelled) return;
      setOrders([...byId.values()].filter((o) => !isOrderDeleted(o.id)));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [ym, active, mode]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  // ---------- группировка по дням ----------
  const byDay = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const o of orders) {
      const k = dayOf(o.created_at);
      const arr = map.get(k);
      if (arr) arr.push(o);
      else map.set(k, [o]);
    }
    for (const arr of map.values()) {
      arr.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    }
    return map;
  }, [orders]);

  const dayOrders = day ? byDay.get(day) ?? [] : [];

  // Очередь синхронизации за день (по дате создания операции; меню — не в счёт)
  const dayQueue = useMemo<SyncOperation[]>(() => {
    if (!day) return [];
    void dataTick;
    return getAllOperations()
      .filter(
        (op) =>
          op.operationType !== 'menu' &&
          op.createdAt &&
          dayOf(op.createdAt) === day
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }, [day, dataTick]);

  // Снятия денег за день
  const dayCash = useMemo(() => {
    if (!day) return [];
    void dataTick;
    return getWithdrawalsForDay(new Date(`${day}T12:00:00`));
  }, [day, dataTick]);

  const toggleSel = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const currentIds: string[] =
    tab === 'orders'
      ? dayOrders.map((o) => o.id)
      : tab === 'queue'
      ? dayQueue.map((op) => op.operationId)
      : dayCash.map((w) => w.id);

  const allSelected =
    currentIds.length > 0 && currentIds.every((id) => selected.has(id));

  /** Удалить всё выбранное на текущей вкладке */
  const confirmBulkDelete = async () => {
    setBulkOpen(false);
    const ids = new Set(selected);
    setSelected(new Set());
    if (ids.size === 0) return;
    try {
      if (tab === 'orders') {
        const list = dayOrders.filter((o) => ids.has(o.id));
        setOrders((prev) => prev.filter((x) => !ids.has(x.id)));
        const { pendingLeft } = await deleteOrdersEverywhere(list);
        setNotice(pendingLeft > 0 ? t('devDeletePending') : t('devDeleteDone'));
      } else if (tab === 'queue') {
        for (const id of ids) removeOperation(id);
        setDataTick((n) => n + 1);
        setNotice(t('devDeleteDone'));
      } else {
        deleteWithdrawals([...ids]);
        setDataTick((n) => n + 1);
        setNotice(t('devDeleteDone'));
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  // ---------- удаление ----------
  const confirmDelete = async () => {
    const o = target;
    if (!o) return;
    setTarget(null);
    setOrders((prev) => prev.filter((x) => x.id !== o.id)); // сразу убираем с экрана
    try {
      const { pendingLeft } = await deleteOrdersEverywhere([o]);
      setNotice(pendingLeft > 0 ? t('devDeletePending') : t('devDeleteDone'));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  // ---------- календарь ----------
  const first = new Date(ym.y, ym.m, 1);
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7; // понедельник первым
  const rows = Math.ceil((offset + daysInMonth) / 7);
  const cells: Array<number | null> = [
    ...Array<null>(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length < rows * 7) cells.push(null);

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    cap(
      new Date(2024, 0, 1 + i).toLocaleDateString(loc, { weekday: 'short' })
    )
  );
  const monthTitle = cap(
    first.toLocaleDateString(loc, { month: 'long', year: 'numeric' })
  );
  const today = todayStr();
  const keyOf = (d: number) =>
    `${ym.y}-${String(ym.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const shift = (delta: number) => {
    if (mode === 'days') {
      const d = new Date(ym.y, ym.m + delta, 1);
      setYm({ y: d.getFullYear(), m: d.getMonth() });
    } else if (mode === 'months') {
      setYm((c) => ({ ...c, y: c.y + delta }));
    } else {
      setYearPage((p) => p + delta * 10);
    }
  };

  /** Вернуться к текущему месяцу */
  const goCurrent = () => {
    const n = new Date();
    setYm({ y: n.getFullYear(), m: n.getMonth() });
    setYearPage(Math.floor(n.getFullYear() / 10) * 10);
    setMode('days');
  };

  /** Нажатие на заголовок: дни → месяцы → годы */
  const drillUp = () => {
    if (mode === 'days') setMode('months');
    else if (mode === 'months') {
      setYearPage(Math.floor(ym.y / 10) * 10);
      setMode('years');
    }
  };

  const headerTitle =
    mode === 'days'
      ? monthTitle
      : mode === 'months'
      ? String(ym.y)
      : `${yearPage} – ${yearPage + 9}`;
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    cap(new Date(2024, i, 1).toLocaleDateString(loc, { month: 'long' }))
  );
  const curY = now.getFullYear();
  const curM = now.getMonth();

  const monthTotal = orders.reduce(
    (s, o) => (o.status === 'CANCELLED' ? s : s + o.total_amount),
    0
  );

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100">
      <PageActions forRole="developer">
        <DiagnosticsButton />
      </PageActions>
      {/* ====================== ДЕНЬ: все заказы ====================== */}
      {day ? (
        <>
          <div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
            <button
              onClick={() => setDay(null)}
              aria-label={t('back')}
              className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 active:scale-95 transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-base font-black text-gray-900 truncate">
                {cap(
                  new Date(`${day}T12:00:00`).toLocaleDateString(loc, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })
                )}
              </div>
              <div className="text-xs font-semibold text-gray-500 tabular-nums">
                {t('orders')}: {dayOrders.length} ·{' '}
                {formatYen(
                  dayOrders.reduce(
                    (s, o) =>
                      o.status === 'CANCELLED' ? s : s + o.total_amount,
                    0
                  )
                )}
              </div>
            </div>
          </div>

          {/* Вкладки дня */}
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200">
            {(
              [
                ['orders', t('devTabOrders'), Receipt, dayOrders.length],
                ['queue', t('devTabQueue'), ListOrdered, dayQueue.length],
                ['cash', t('devTabCash'), Banknote, dayCash.length],
              ] as Array<[DayTab, string, typeof Receipt, number]>
            ).map(([key, label, Icon, n]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-3.5 h-9 rounded-xl text-sm font-extrabold whitespace-nowrap transition active:scale-95 ${
                  tab === key
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
                <span
                  className={`tabular-nums text-xs px-1.5 rounded-md ${
                    tab === key ? 'bg-white/25' : 'bg-white text-gray-500'
                  }`}
                >
                  {n}
                </span>
              </button>
            ))}

            <div className="ml-auto flex items-center gap-2">
              {selected.size > 0 && (
                <span className="text-xs font-bold text-gray-500 tabular-nums whitespace-nowrap">
                  {t('devSelectedCount')}: {selected.size}
                </span>
              )}
              <button
                onClick={() =>
                  setSelected(allSelected ? new Set() : new Set(currentIds))
                }
                disabled={currentIds.length === 0}
                className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-40 whitespace-nowrap active:scale-95 transition"
              >
                {allSelected ? (
                  <CheckSquare className="w-4 h-4" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                {allSelected ? t('devClearSel') : t('devSelectAll')}
              </button>
              <button
                onClick={() => setBulkOpen(true)}
                disabled={selected.size === 0}
                className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm font-extrabold bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 whitespace-nowrap active:scale-95 transition"
              >
                <Trash2 className="w-4 h-4" />
                {t('devDeleteSelected')}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {tab === 'orders' &&
              (dayOrders.length === 0 ? (
                <p className="text-center text-sm text-gray-500 py-20">
                  {t('devEmptyDay')}
                </p>
              ) : (
                <div className="grid grid-cols-6 gap-3 max-w-[110rem] mx-auto">
                  {dayOrders.map((o) => (
                    <OrderTile
                      key={o.id}
                      order={o}
                      cancelledLabel={t('devCancelled')}
                      itemsLabel={t('devItems')}
                      deleteLabel={t('devDeleteOrder')}
                      selected={selected.has(o.id)}
                      onToggle={() => toggleSel(o.id)}
                      onDelete={() => setTarget(o)}
                    />
                  ))}
                </div>
              ))}

            {tab === 'queue' &&
              (dayQueue.length === 0 ? (
                <p className="text-center text-sm text-gray-500 py-20">
                  {t('devEmptyQueue')}
                </p>
              ) : (
                <div className="max-w-3xl mx-auto space-y-2">
                  {dayQueue.map((op) => (
                    <RowCard
                      key={op.operationId}
                      selected={selected.has(op.operationId)}
                      onToggle={() => toggleSel(op.operationId)}
                      left={
                        <>
                          <div className="text-sm font-black text-gray-900 tabular-nums">
                            №{op.order?.order_number ?? '—'}{' '}
                            <span className="text-gray-500 font-bold">
                              {op.operationType}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 tabular-nums truncate">
                            {formatTime(op.createdAt)} · {op.syncStatus}
                            {op.attempts ? ` · ×${op.attempts}` : ''}
                            {op.lastError ? ` · ${op.lastError}` : ''}
                          </div>
                        </>
                      }
                      right={
                        op.order ? formatYen(op.order.total_amount ?? 0) : ''
                      }
                    />
                  ))}
                </div>
              ))}

            {tab === 'cash' &&
              (dayCash.length === 0 ? (
                <p className="text-center text-sm text-gray-500 py-20">
                  {t('devEmptyCash')}
                </p>
              ) : (
                <div className="max-w-3xl mx-auto space-y-2">
                  {dayCash.map((w) => (
                    <RowCard
                      key={w.id}
                      selected={selected.has(w.id)}
                      onToggle={() => toggleSel(w.id)}
                      left={
                        <>
                          <div className="text-sm font-black text-gray-900 tabular-nums">
                            {formatTime(w.taken_at)}
                          </div>
                          <div className="text-xs text-gray-500 tabular-nums">
                            {formatTime(w.display_from)} → {formatTime(w.taken_at)} ·{' '}
                            {t('orders')} {w.orders_count}
                          </div>
                        </>
                      }
                      right={formatYen(w.amount)}
                    />
                  ))}
                </div>
              ))}
          </div>
        </>
      ) : (
        /* ====================== КАЛЕНДАРЬ на весь экран ====================== */
        <>
          <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-white border-b border-gray-200">
            <button
              onClick={drillUp}
              disabled={mode === 'years'}
              className="flex items-center gap-2 min-w-0 text-left rounded-xl px-2 py-1 -mx-2 hover:bg-gray-100 disabled:hover:bg-transparent active:scale-[0.98] transition"
            >
              <CalendarDays className="w-5 h-5 text-orange-600 shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-base font-black text-gray-900 truncate">
                  {headerTitle}
                  {mode !== 'years' && (
                    <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                  )}
                </div>
                {mode === 'days' && (
                  <div className="text-xs font-semibold text-gray-500 tabular-nums">
                    {t('orders')}: {orders.length} · {formatYen(monthTotal)}
                  </div>
                )}
              </div>
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={goCurrent}
                title={t('today')}
                aria-label={t('today')}
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-orange-100 hover:bg-orange-200 text-orange-700 active:scale-95 transition"
              >
                <CalendarCheck className="w-5 h-5" />
              </button>
              <button
                onClick={() => shift(-1)}
                aria-label="prev"
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 active:scale-95 transition"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => shift(1)}
                aria-label="next"
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 active:scale-95 transition"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          {mode === 'days' && cloudFailed && (
            <div className="shrink-0 px-4 py-1.5 text-xs font-semibold bg-amber-50 text-amber-700 border-b border-amber-200">
              {t('devCloudFailed')}
            </div>
          )}

          {mode === 'months' && (
            <div className="flex-1 min-h-0 grid grid-cols-4 grid-rows-3 gap-3 p-4">
              {monthNames.map((name, i) => {
                const isCur = ym.y === curY && i === curM;
                const isSel = i === ym.m;
                return (
                  <button
                    key={name}
                    onClick={() => {
                      setYm({ y: ym.y, m: i });
                      setMode('days');
                    }}
                    className={`min-h-0 rounded-2xl border-2 text-lg font-black transition active:scale-[0.97] ${
                      isSel
                        ? 'bg-orange-500 border-orange-500 text-white'
                        : isCur
                        ? 'bg-orange-50 border-orange-400 text-orange-700 hover:bg-orange-100'
                        : 'bg-white border-gray-200 text-gray-800 hover:border-orange-300'
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}

          {mode === 'years' && (
            <div className="flex-1 min-h-0 grid grid-cols-5 grid-rows-2 gap-3 p-4">
              {Array.from({ length: 10 }, (_, i) => yearPage + i).map((y) => {
                const isCur = y === curY;
                const isSel = y === ym.y;
                return (
                  <button
                    key={y}
                    onClick={() => {
                      setYm((c) => ({ ...c, y }));
                      setMode('months');
                    }}
                    className={`min-h-0 rounded-2xl border-2 text-2xl font-black tabular-nums transition active:scale-[0.97] ${
                      isSel
                        ? 'bg-orange-500 border-orange-500 text-white'
                        : isCur
                        ? 'bg-orange-50 border-orange-400 text-orange-700 hover:bg-orange-100'
                        : 'bg-white border-gray-200 text-gray-800 hover:border-orange-300'
                    }`}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
          )}

          {mode === 'days' && (
            <div className="flex-1 min-h-0 flex flex-col p-3 gap-2">
              <div className="shrink-0 grid grid-cols-7 gap-2">
                {weekdays.map((w) => (
                  <div
                    key={w}
                    className="text-center text-[0.6875rem] font-bold uppercase tracking-wider text-gray-500"
                  >
                    {w}
                  </div>
                ))}
              </div>

              <div
                className="flex-1 min-h-0 grid grid-cols-7 gap-2"
                style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
              >
                {cells.map((d, i) => {
                  if (d === null) return <div key={`e${i}`} />;
                  const k = keyOf(d);
                  const list = byDay.get(k);
                  const has = !!list && list.length > 0;
                  const isToday = k === today;
                  if (!has) {
                    return (
                      <div
                        key={k}
                        className={`rounded-xl border p-2 text-sm font-bold ${
                          isToday
                            ? 'border-orange-300 text-orange-300'
                            : 'border-gray-200 text-gray-300'
                        } ${loading ? 'animate-pulse' : ''}`}
                      >
                        {d}
                      </div>
                    );
                  }
                  const sum = list.reduce(
                    (s, o) => (o.status === 'CANCELLED' ? s : s + o.total_amount),
                    0
                  );
                  return (
                    <button
                      key={k}
                      onClick={() => setDay(k)}
                      className={`min-h-0 rounded-xl border-2 p-2 flex flex-col items-start justify-between text-left bg-orange-50 hover:bg-orange-100 active:scale-[0.97] transition ${
                        isToday ? 'border-orange-500' : 'border-orange-300'
                      }`}
                    >
                      <span className="text-lg font-black text-orange-700 leading-none">
                        {d}
                      </span>
                      <span className="w-full">
                        <span className="block text-xs font-extrabold text-gray-900 tabular-nums">
                          {list.length} {t('orders').toLowerCase()}
                        </span>
                        <span className="block text-[0.6875rem] font-semibold text-gray-600 tabular-nums truncate">
                          {formatYen(sum)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {notice && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold shadow-xl max-w-[90vw]">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          {notice}
        </div>
      )}

      <ConfirmDialog
        open={target !== null}
        variant="red"
        title={t('devDeleteOrder')}
        message={t('devDeleteConfirm').replace(
          '{n}',
          target ? String(target.order_number) : ''
        )}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        disabledSeconds={1}
        onConfirm={confirmDelete}
        onCancel={() => setTarget(null)}
      />

      <ConfirmDialog
        open={bulkOpen}
        variant="red"
        title={t('devDeleteSelectedTitle')}
        message={(tab === 'orders'
          ? t('devDeleteSelectedOrders')
          : tab === 'queue'
          ? t('devDeleteSelectedQueue')
          : t('devDeleteSelectedCash')
        ).replace('{n}', String(selected.size))}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        disabledSeconds={1}
        onConfirm={confirmBulkDelete}
        onCancel={() => setBulkOpen(false)}
      />
    </div>
  );
}

// ============================================================
// СТРОКА (очередь / снятия): чекбокс + текст + сумма
// ============================================================
function RowCard({
  selected,
  onToggle,
  left,
  right,
}: {
  selected: boolean;
  onToggle: () => void;
  left: ReactNode;
  right: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left bg-white transition active:scale-[0.99] ${
        selected ? 'border-red-400 bg-red-50' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      {selected ? (
        <CheckSquare className="w-5 h-5 text-red-600 shrink-0" />
      ) : (
        <Square className="w-5 h-5 text-gray-400 shrink-0" />
      )}
      <div className="min-w-0 flex-1">{left}</div>
      <div className="shrink-0 text-base font-black text-orange-600 tabular-nums">
        {right}
      </div>
    </button>
  );
}

// ============================================================
// ПЛИТКА ЗАКАЗА (квадрат)
// ============================================================
function OrderTile({
  order,
  cancelledLabel,
  itemsLabel,
  deleteLabel,
  selected,
  onToggle,
  onDelete,
}: {
  order: Order;
  cancelledLabel: string;
  itemsLabel: string;
  deleteLabel: string;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const items = (order.order_items ?? []).filter((i) => !i.is_removed);
  const shown = items.slice(0, 4);
  const more = items.length - shown.length;
  const cancelled = order.status === 'CANCELLED';

  return (
    <div
      className={`relative aspect-square min-w-0 rounded-xl border bg-white p-2.5 flex flex-col shadow-sm ${
        selected
          ? 'border-red-400 ring-2 ring-red-300'
          : cancelled
          ? 'border-red-200 opacity-70'
          : 'border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="text-lg font-black text-gray-900 leading-none tabular-nums">
            {TYPE_EMOJI[order.order_type]} №{order.order_number}
          </div>
          <div className="mt-1 text-[0.6875rem] font-semibold text-gray-500 tabular-nums">
            {formatTime(order.created_at)}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1">
        <button
          onClick={onToggle}
          aria-label="select"
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200 active:scale-90 transition"
        >
          {selected ? (
            <CheckSquare className="w-4 h-4 text-red-600" />
          ) : (
            <Square className="w-4 h-4" />
          )}
        </button>
        <button
          onClick={onDelete}
          title={deleteLabel}
          aria-label={deleteLabel}
          className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 active:scale-90 transition"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        </div>
      </div>

      <div className="mt-1.5 flex-1 min-h-0 overflow-hidden text-[0.6875rem] leading-snug text-gray-700">
        {shown.map((i) => (
          <div key={i.id} className="flex gap-1 min-w-0">
            <span className="truncate">
              {i.short_name || i.name}
              {i.variant ? ` ${i.variant}` : ''}
            </span>
            <span className="ml-auto font-bold tabular-nums shrink-0">
              ×{i.quantity}
            </span>
          </div>
        ))}
        {more > 0 && (
          <div className="text-gray-400 font-semibold">
            +{more} {itemsLabel}
          </div>
        )}
      </div>

      <div className="mt-1 flex items-end justify-between gap-1">
        {cancelled ? (
          <span className="text-[0.625rem] font-bold uppercase text-red-600">
            {cancelledLabel}
          </span>
        ) : (
          <span />
        )}
        <span className="text-base font-black text-orange-600 tabular-nums">
          {formatYen(order.total_amount)}
        </span>
      </div>
    </div>
  );
}
