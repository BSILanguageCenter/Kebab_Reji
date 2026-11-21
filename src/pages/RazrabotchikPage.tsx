// src/pages/RazrabotchikPage.tsx
/**
 * Режим разработчика.
 *  1) Календарь на весь экран: дни, в которые были заказы — активные кнопки.
 *  2) Нажатие на день → страница со всеми заказами этого дня (плитки 6 в ряд).
 *  3) У каждого заказа кнопка «удалить»: заказ пропадает отовсюду —
 *     localStorage, Supabase, Firebase, Google Sheets (и на других устройствах).
 */
import { useContext, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import { useI18n } from '@/locale';
import { ActiveRoleContext } from '@/components/PageActions';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatYen, formatTime, dateLocale } from '@/locale/format';
import { getAllOrders, todayStr } from '@/lib/localStore';
import { fetchOrdersRange } from '@/services/supabaseOrders';
import { isOrderDeleted } from '@/services/deletedOrders';
import { deleteOrdersEverywhere } from '@/services/orderDeletion';
import type { Order, OrderType } from '@/types/database';

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

export default function RazrabotchikPage() {
  const { t, lang } = useI18n();
  const loc = dateLocale(lang);
  const active = useContext(ActiveRoleContext) === 'developer';

  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [cloudFailed, setCloudFailed] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [target, setTarget] = useState<Order | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ---------- загрузка заказов месяца (облако + локально) ----------
  useEffect(() => {
    if (!active) return;
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
        console.warn('[RazrabotchikPage] cloud fetch failed:', e);
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
  }, [ym, active]);

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

  // Удалили последний заказ дня — возвращаемся в календарь
  useEffect(() => {
    if (day && !loading && dayOrders.length === 0) setDay(null);
  }, [day, loading, dayOrders.length]);

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

  const shiftMonth = (delta: number) => {
    const d = new Date(ym.y, ym.m + delta, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  };

  const monthTotal = orders.reduce(
    (s, o) => (o.status === 'CANCELLED' ? s : s + o.total_amount),
    0
  );

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100">
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

          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {dayOrders.length === 0 ? (
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
                    onDelete={() => setTarget(o)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        /* ====================== КАЛЕНДАРЬ на весь экран ====================== */
        <>
          <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-white border-b border-gray-200">
            <div className="flex items-center gap-2 min-w-0">
              <CalendarDays className="w-5 h-5 text-orange-600 shrink-0" />
              <div className="min-w-0">
                <div className="text-base font-black text-gray-900 truncate">
                  {monthTitle}
                </div>
                <div className="text-xs font-semibold text-gray-500 tabular-nums">
                  {t('orders')}: {orders.length} · {formatYen(monthTotal)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => shiftMonth(-1)}
                aria-label="prev"
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 active:scale-95 transition"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => shiftMonth(1)}
                aria-label="next"
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 active:scale-95 transition"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          {cloudFailed && (
            <div className="shrink-0 px-4 py-1.5 text-xs font-semibold bg-amber-50 text-amber-700 border-b border-amber-200">
              {t('devCloudFailed')}
            </div>
          )}

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
    </div>
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
  onDelete,
}: {
  order: Order;
  cancelledLabel: string;
  itemsLabel: string;
  deleteLabel: string;
  onDelete: () => void;
}) {
  const items = (order.order_items ?? []).filter((i) => !i.is_removed);
  const shown = items.slice(0, 4);
  const more = items.length - shown.length;
  const cancelled = order.status === 'CANCELLED';

  return (
    <div
      className={`relative aspect-square min-w-0 rounded-xl border bg-white p-2.5 flex flex-col shadow-sm ${
        cancelled ? 'border-red-200 opacity-70' : 'border-gray-200'
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
        <button
          onClick={onDelete}
          title={deleteLabel}
          aria-label={deleteLabel}
          className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 active:scale-90 transition"
        >
          <Trash2 className="w-4 h-4" />
        </button>
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
