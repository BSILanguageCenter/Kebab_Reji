import { useCallback, useEffect, useState } from 'react';
import { getAllOrders, subscribeOrders, newId } from '@/lib/localStore';
import type { Order } from '@/types/database';

// ============================================================
// КАССА: «ВЗЯТЬ ДЕНЬГИ»
//
// Деньги в кассе = сумма заказов (кроме отменённых) с момента
// последнего снятия за сегодня (или с начала дня, если сегодня
// ещё ничего не снимали). Нажатие «Взять деньги» фиксирует
// период «с … по …» и обнуляет кассу.
// ============================================================

const STORAGE_KEY = 'kebab-pos-cash-withdrawals-v1';

export interface CashWithdrawal {
  id: string;
  /** Момент, когда деньги взяли (конец периода) */
  taken_at: string;
  /** Техническая граница начала периода (для выборки заказов) */
  from_at: string;
  /** Время, которое показываем как начало периода (первый заказ / прошлое снятие) */
  display_from: string;
  /** Сколько денег взяли */
  amount: number;
  orders_count: number;
}

export interface CashPeriod {
  /** Технические границы (для выборки заказов) */
  start: string;
  end: string;
  /** Время для показа пользователю */
  displayFrom: string;
  displayTo: string;
  amount: number;
  ordersCount: number;
  /** true — период ещё не закрыт (деньги в кассе прямо сейчас) */
  open: boolean;
  withdrawalId?: string;
}

// ---------- хранилище ----------
const listeners = new Set<() => void>();

function readAll(): CashWithdrawal[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as CashWithdrawal[])
      .filter((w) => w && typeof w.taken_at === 'string')
      .sort(
        (a, b) =>
          new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime()
      );
  } catch {
    return [];
  }
}

function writeAll(list: CashWithdrawal[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  // Изменения из другой вкладки
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) listeners.forEach((l) => l());
  });
}

// ---------- даты ----------
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function sumOrders(orders: Order[]): number {
  return orders.reduce((s, o) => s + o.total_amount, 0);
}

function ordersBetween(startIso: string, endIso: string): Order[] {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  return getAllOrders().filter((o) => {
    if (o.status === 'CANCELLED') return false;
    const t = new Date(o.created_at).getTime();
    return t >= s && t <= e;
  });
}

function firstOrderTime(orders: Order[]): string | null {
  if (orders.length === 0) return null;
  let min = Infinity;
  for (const o of orders) {
    const t = new Date(o.created_at).getTime();
    if (t < min) min = t;
  }
  return new Date(min).toISOString();
}

// ---------- чтение ----------
export function getWithdrawals(): CashWithdrawal[] {
  return readAll();
}

/** Снятия за указанный день (по локальной дате), по возрастанию времени. */
export function getWithdrawalsForDay(day: Date): CashWithdrawal[] {
  const key = dayKey(day);
  return readAll().filter((w) => dayKey(new Date(w.taken_at)) === key);
}

/** Граница начала открытого периода: последнее снятие сегодня или начало дня. */
function openPeriodStart(now: Date): Date {
  const todays = getWithdrawalsForDay(now);
  if (todays.length > 0) {
    const last = todays[todays.length - 1];
    return new Date(new Date(last.taken_at).getTime() + 1);
  }
  return startOfDay(now);
}

/** Текущий открытый период (деньги, которые лежат в кассе прямо сейчас). */
export function getOpenPeriod(now: Date = new Date()): CashPeriod {
  const start = openPeriodStart(now);
  const orders = ordersBetween(start.toISOString(), now.toISOString());
  const todays = getWithdrawalsForDay(now);
  const first = firstOrderTime(orders);
  const displayFrom =
    todays.length > 0
      ? todays[todays.length - 1].taken_at
      : first ?? now.toISOString();
  return {
    start: start.toISOString(),
    end: endOfDay(now).toISOString(),
    displayFrom,
    displayTo: now.toISOString(),
    amount: sumOrders(orders),
    ordersCount: orders.length,
    open: true,
  };
}

/**
 * Все периоды дня: закрытые (по снятиям) + открытый (только для сегодня).
 * Для прошлых дней открытый период — это «остаток» после последнего снятия,
 * если после него были продажи.
 */
export function getDayPeriods(day: Date): CashPeriod[] {
  const withdrawals = getWithdrawalsForDay(day);
  const periods: CashPeriod[] = withdrawals.map((w) => ({
    start: w.from_at,
    end: w.taken_at,
    displayFrom: w.display_from,
    displayTo: w.taken_at,
    amount: w.amount,
    ordersCount: w.orders_count,
    open: false,
    withdrawalId: w.id,
  }));

  const isToday = dayKey(day) === dayKey(new Date());
  const tailStart =
    withdrawals.length > 0
      ? new Date(
          new Date(withdrawals[withdrawals.length - 1].taken_at).getTime() + 1
        )
      : startOfDay(day);
  const tailEnd = isToday ? new Date() : endOfDay(day);
  const tailOrders = ordersBetween(tailStart.toISOString(), tailEnd.toISOString());

  if (isToday || tailOrders.length > 0) {
    const first = firstOrderTime(tailOrders);
    periods.push({
      start: tailStart.toISOString(),
      end: endOfDay(day).toISOString(),
      displayFrom:
        withdrawals.length > 0
          ? withdrawals[withdrawals.length - 1].taken_at
          : first ?? tailStart.toISOString(),
      displayTo: tailEnd.toISOString(),
      amount: sumOrders(tailOrders),
      ordersCount: tailOrders.length,
      open: true,
    });
  }
  return periods;
}

// ---------- запись ----------
/** Взять все деньги из кассы. Возвращает запись или null, если в кассе пусто. */
export function takeCash(now: Date = new Date()): CashWithdrawal | null {
  const period = getOpenPeriod(now);
  if (period.amount <= 0) return null;
  const record: CashWithdrawal = {
    id: newId(),
    taken_at: now.toISOString(),
    from_at: period.start,
    display_from: period.displayFrom,
    amount: period.amount,
    orders_count: period.ordersCount,
  };
  writeAll([...readAll(), record]);
  return record;
}

/** Удалить записи о снятии денег (режим разработчика). */
export function deleteWithdrawals(ids: string[]): void {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  writeAll(readAll().filter((w) => !gone.has(w.id)));
}

// ---------- React ----------
/** Перерисовывает компонент при новых заказах / снятиях денег и раз в минуту. */
export function useCashRegister() {
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    listeners.add(bump);
    const unsubOrders = subscribeOrders(bump);
    const id = window.setInterval(bump, 60_000);
    return () => {
      listeners.delete(bump);
      unsubOrders();
      window.clearInterval(id);
    };
  }, [bump]);

  const register = getOpenPeriod();
  const take = useCallback(() => takeCash(), []);

  return { register, take };
}
