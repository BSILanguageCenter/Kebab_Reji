// src/lib/localStore.ts
import type {
  MenuItem,
  Order,
  OrderItem,
  OrderItemOption,
  OrderStatus,
  OrderType,
  OptionType,
} from '@/types/database';
import {
  enqueueForSync,
  enqueueMenuForSync,
} from '@/services/googleSheetsSync';
import {
  saveOrder,
  updateOrderStatus,
  nextSharedOrderNumber,
} from '@/services/firebaseSync';
import { upsertProductsToDb } from '@/services/supabaseDb';

// ============================================================
// STORAGE SHAPE
// ============================================================
const STORAGE_KEY = 'kebab-pos-data-v1';
const CHANNEL_NAME = 'kebab-pos-sync';
const CURRENT_VERSION = 3; // ← NEW: подняли версию из-за нового поля

/**
 * Стартовый номер заказа в начале каждого дня.
 * Если хотите начинать с 1 — поменяйте на 1.
 */
const START_ORDER_NUMBER = 1; // ← NEW

export interface LocalData {
  menuItems: MenuItem[];
  orders: Order[];
  nextOrderNumber: number;
  counterDate: string; // ← NEW: 'YYYY-MM-DD', к какому дню относится счётчик
  version: number;
}

/** Локальная дата в формате YYYY-MM-DD (часовой пояс браузера). */
export function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultData(): LocalData {
  return {
    menuItems: [],
    orders: [],
    nextOrderNumber: START_ORDER_NUMBER,
    counterDate: todayStr(), // ← NEW
    version: CURRENT_VERSION,
  };
}

function loadData(): LocalData {
  if (typeof window === 'undefined') return defaultData();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    const d = defaultData();
    if (Array.isArray(parsed.menuItems)) d.menuItems = parsed.menuItems;
    if (Array.isArray(parsed.orders)) d.orders = parsed.orders;
    if (typeof parsed.nextOrderNumber === 'number') {
      d.nextOrderNumber = parsed.nextOrderNumber;
    }
    // ← NEW: подхватываем counterDate; если его нет (старое хранилище) —
    // считаем, что счётчик относится к сегодняшнему дню
    if (typeof parsed.counterDate === 'string' && parsed.counterDate) {
      d.counterDate = parsed.counterDate;
    } else {
      d.counterDate = todayStr();
    }
    d.version = CURRENT_VERSION;
    return d;
  } catch {
    return defaultData();
  }
}

/** День (YYYY-MM-DD) для ISO-времени заказа. */
function dayOf(iso: string): string {
  return todayStr(new Date(iso));
}

let data: LocalData = loadData();

// ============================================================
// DAILY COUNTER RESET  ← NEW
// ============================================================
/**
 * Если счётчик относится к прошлому дню — сбрасываем его.
 * Возвращает true, если сброс произошёл (нужно сохранить данные).
 */
function resetCounterIfNewDay(): boolean {
  const today = todayStr();
  if (data.counterDate === today) return false;
  data.counterDate = today;
  data.nextOrderNumber = START_ORDER_NUMBER;
  return true;
}

// Сброс при загрузке модуля (если приложение не перезагружалось ночью)
if (typeof window !== 'undefined') {
  if (resetCounterIfNewDay()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }
}

// ============================================================
// PERSIST + BROADCAST
// ============================================================
let bc: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    bc = new BroadcastChannel(CHANNEL_NAME);
  }
} catch {
  /* ignore */
}

let persistTimer: number | null = null;

function persist() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e: unknown) {
    console.error('[localStore] localStorage persist failed:', e);
  }
  try {
    bc?.postMessage({ type: 'update' });
  } catch {
    /* ignore */
  }
}

function schedulePersist() {
  if (typeof window === 'undefined') return;
  if (persistTimer != null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    persist();
  }, 50);
}

// ============================================================
// LISTENERS
// ============================================================
type OrdersListener = (orders: Order[]) => void;
type MenuListener = (menu: { items: MenuItem[] }) => void;
type InitListener = (snap: {
  orders: Order[];
  menu: { items: MenuItem[] };
}) => void;
type ClientsListener = (count: number) => void;

const ordersListeners = new Set<OrdersListener>();
const menuListeners = new Set<MenuListener>();
const initListeners = new Set<InitListener>();
const clientsListeners = new Set<ClientsListener>();

function notifyAll() {
  const orders = getActiveOrders();
  const menu = { items: data.menuItems };
  ordersListeners.forEach((l) => {
    try {
      l(orders);
    } catch {
      /* ignore */
    }
  });
  menuListeners.forEach((l) => {
    try {
      l(menu);
    } catch {
      /* ignore */
    }
  });
}

function notifyClients() {
  const count = countClients();
  clientsListeners.forEach((l) => {
    try {
      l(count);
    } catch {
      /* ignore */
    }
  });
}

// ============================================================
// CROSS-TAB SYNC
// ============================================================
const CLIENT_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
const clientsSeen = new Map<string, number>();
clientsSeen.set(CLIENT_ID, Date.now());

function countClients(): number {
  const now = Date.now();
  for (const [id, t] of clientsSeen) {
    if (now - t > 15_000) clientsSeen.delete(id);
  }
  return Math.max(1, clientsSeen.size);
}

if (typeof window !== 'undefined') {
  bc?.addEventListener('message', (ev) => {
    const msg = ev.data as { type?: string; id?: string; from?: string };
    if (msg?.type === 'update') {
      data = loadData();
      // ← NEW: при получении обновления из другой вкладки тоже проверяем смену дня
      if (resetCounterIfNewDay()) {
        persist();
      }
      notifyAll();
    }
    if (msg?.type === 'clients-ping' && msg.id) {
      try {
        bc?.postMessage({
          type: 'clients-pong',
          id: msg.id,
          from: CLIENT_ID,
        });
      } catch {
        /* ignore */
      }
    }
    if (msg?.type === 'clients-pong' && msg.from) {
      clientsSeen.set(msg.from, Date.now());
      notifyClients();
    }
  });

  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      data = loadData();
      // ← NEW: и здесь тоже
      if (resetCounterIfNewDay()) {
        persist();
      }
      notifyAll();
    }
  });

  setInterval(() => {
    try {
      bc?.postMessage({ type: 'clients-ping', id: CLIENT_ID });
    } catch {
      /* ignore */
    }
    clientsSeen.set(CLIENT_ID, Date.now());
    notifyClients();
  }, 5000);

  // ← NEW: если приложение открыто в фоне и не перезагружается —
  // раз в минуту проверяем смену дня, чтобы счётчик сбросился
  // до создания первого заказа нового дня.
  setInterval(() => {
    if (resetCounterIfNewDay()) {
      schedulePersist();
      notifyAll();
    }
  }, 60_000);
}

// ============================================================
// COMPAT STUBS
// ============================================================
export function getSocket(): {
  connected: boolean;
  emit: (...args: unknown[]) => void;
  on: (...args: unknown[]) => void;
  off: (...args: unknown[]) => void;
} {
  return {
    connected: true,
    emit: () => {},
    on: () => {},
    off: () => {},
  };
}

export function isConnected(): boolean {
  return true;
}

export function disconnectSocket(): void {
  ordersListeners.clear();
  menuListeners.clear();
  initListeners.clear();
  clientsListeners.clear();
}

// ============================================================
// SUBSCRIBE API
// ============================================================
export function subscribeOrders(listener: OrdersListener): () => void {
  ordersListeners.add(listener);
  listener(getActiveOrders());
  return () => {
    ordersListeners.delete(listener);
  };
}

export function subscribeMenu(listener: MenuListener): () => void {
  menuListeners.add(listener);
  listener({ items: data.menuItems });
  return () => {
    menuListeners.delete(listener);
  };
}

export function subscribeInit(listener: InitListener): () => void {
  initListeners.add(listener);
  listener({ orders: getActiveOrders(), menu: { items: data.menuItems } });
  return () => {
    initListeners.delete(listener);
  };
}

export function subscribeClientsCount(listener: ClientsListener): () => void {
  clientsListeners.add(listener);
  listener(countClients());
  return () => {
    clientsListeners.delete(listener);
  };
}

// ============================================================
// READS
// ============================================================
export function getActiveOrders(): Order[] {
  // Только заказы СЕГОДНЯШНЕГО дня: на следующий день касса, кухня и зал
  // ожидания начинаются с чистого листа. Статистика читает getAllOrders().
  const today = todayStr();
  return data.orders
    .filter(
      (o) =>
        (o.status === 'NEW' ||
          o.status === 'PREPARING' ||
          o.status === 'READY') &&
        dayOf(o.created_at) === today
    )
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
}

export function getAllOrders(): Order[] {
  return [...data.orders].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function getMenu(): { items: MenuItem[] } {
  return { items: data.menuItems };
}

export function getMenuItems(): MenuItem[] {
  return data.menuItems;
}

export interface SyncStats {
  unsyncedCount: number;
  totalOrders: number;
}

// ============================================================
// HELPERS
// ============================================================
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export interface OrderItemPayload {
  menu_item_id: string | null;
  name: string;
  short_name: string;
  variant: string;
  price: number;
  quantity: number;
  subtotal: number;
  is_removed?: boolean;
  is_added_later?: boolean;
  options?: Array<{
    type: string;
    name: string;
    price: number;
    quantity: number;
  }>;
}

function toOrderItem(orderId: string, i: OrderItemPayload): OrderItem {
  const itemId = newId();
  const options: OrderItemOption[] = (i.options ?? []).map((o) => ({
    id: newId(),
    order_item_id: itemId,
    type: o.type as OptionType,
    name: o.name,
    price: o.price,
    quantity: o.quantity,
  }));
  return {
    id: itemId,
    order_id: orderId,
    menu_item_id: i.menu_item_id ?? null,
    name: i.name,
    short_name: i.short_name,
    variant: i.variant,
    price: i.price,
    quantity: i.quantity,
    subtotal: i.subtotal,
    created_at: new Date().toISOString(),
    is_removed: Boolean(i.is_removed),
    is_added_later: Boolean(i.is_added_later),
    options,
  };
}

// ============================================================
// ORDERS — WRITE
// ============================================================
export async function emitCreateOrder(payload: {
  order_type: OrderType;
  total_amount: number;
  comment: string;
  order_items: OrderItemPayload[];
}): Promise<Order> {
  // ← NEW: перед выдачей номера проверяем, не наступил ли новый день
  // (на случай, если приложение не перезагружалось всю ночь)
  if (resetCounterIfNewDay()) {
    schedulePersist();
  }

  // Номер берём из ОБЩЕГО счётчика (Firebase), чтобы у всех устройств он
  // был единым и продолжал текущий. floor — максимальный номер за сегодня,
  // уже известный этому устройству (включая заказы с других устройств).
  const today = todayStr();
  const floor = data.orders
    .filter((o) => dayOf(o.created_at) === today)
    .reduce((m, o) => Math.max(m, o.order_number), 0);

  let orderNumber: number;
  try {
    orderNumber = await nextSharedOrderNumber(today, floor);
  } catch (e: unknown) {
    console.warn('[localStore] shared counter unavailable, local fallback:', e);
    orderNumber = Math.max(floor, data.nextOrderNumber - 1) + 1;
  }
  data.nextOrderNumber = orderNumber + 1;

  const id = newId();
  const now = new Date().toISOString();

  const order: Order = {
    id,
    order_number: orderNumber,
    order_type: payload.order_type,
    status: 'NEW',
    total_amount: payload.total_amount,
    comment: payload.comment,
    created_at: now,
    updated_at: now,
    completed_at: null,
    order_items: (payload.order_items ?? []).map((i) => toOrderItem(id, i)),
  };

  data.orders.push(order);
  schedulePersist();
  notifyAll();

  saveOrder(order).catch((e: unknown) => {
    console.warn('[localStore] RTDB saveOrder (create) failed:', e);
  });

  try {
    enqueueForSync(order, 'create');
  } catch (syncErr: unknown) {
    console.warn('[localStore] enqueue create sync failed:', syncErr);
  }

  return order;
}

export async function emitUpdateOrder(payload: {
  id: string;
  order_type: OrderType;
  total_amount: number;
  comment: string;
  order_items: OrderItemPayload[];
}): Promise<Order | null> {
  const idx = data.orders.findIndex((o) => o.id === payload.id);
  if (idx === -1) return null;
  const prev = data.orders[idx];

  const updated: Order = {
    ...prev,
    order_type: payload.order_type,
    total_amount: payload.total_amount,
    comment: payload.comment,
    updated_at: new Date().toISOString(),
    order_items: (payload.order_items ?? []).map((i) =>
      toOrderItem(payload.id, i)
    ),
  };

  data.orders[idx] = updated;
  schedulePersist();
  notifyAll();

  saveOrder(updated).catch((e: unknown) => {
    console.warn('[localStore] RTDB saveOrder (update) failed:', e);
  });

  try {
    enqueueForSync(updated, 'update');
  } catch (syncErr: unknown) {
    console.warn('[localStore] enqueue update sync failed:', syncErr);
  }

  return updated;
}

export async function emitUpdateStatus(
  orderId: string,
  status: OrderStatus
): Promise<Order | null> {
  const idx = data.orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  const isFinal = status === 'COMPLETED' || status === 'CANCELLED';

  const updated: Order = {
    ...data.orders[idx],
    status,
    updated_at: now,
    completed_at: isFinal ? now : data.orders[idx].completed_at ?? null,
  };

  data.orders[idx] = updated;
  schedulePersist();
  notifyAll();

  updateOrderStatus(orderId, status).catch((e: unknown) => {
    console.warn('[localStore] RTDB updateOrderStatus failed:', e);
  });

  try {
    enqueueForSync(updated, 'status');
  } catch (syncErr: unknown) {
    console.warn('[localStore] enqueue status sync failed:', syncErr);
  }

  return updated;
}

export async function emitForceSync(): Promise<SyncStats> {
  return { unsyncedCount: 0, totalOrders: data.orders.length };
}

export function emitLayoutSettings(settings: unknown): void {
  void settings;
}

// ============================================================
// MENU — WRITE
// ============================================================
export function setMenuItems(items: MenuItem[]): void {
  data.menuItems = items;
  schedulePersist();
  notifyAll();

  upsertProductsToDb(items).catch((e: unknown) => {
    console.warn('[localStore] Supabase upsertProductsToDb failed:', e);
  });

  try {
    enqueueMenuForSync(items);
  } catch (e: unknown) {
    console.warn('[localStore] enqueueMenuForSync failed:', e);
  }
}

export function addMenuItem(item: MenuItem): void {
  setMenuItems([...data.menuItems, item]);
}

export function updateMenuItem(itemId: string, patch: Partial<MenuItem>): void {
  const idx = data.menuItems.findIndex((i) => i.id === itemId);
  if (idx !== -1) {
    const next = [...data.menuItems];
    next[idx] = { ...next[idx], ...patch };
    setMenuItems(next);
    return;
  }
  for (let i = 0; i < data.menuItems.length; i++) {
    const parent = data.menuItems[i];
    if (!parent.variants) continue;
    const vIdx = parent.variants.findIndex((v) => v.id === itemId);
    if (vIdx !== -1) {
      const next = [...data.menuItems];
      const nextParent = { ...next[i] };
      nextParent.variants = nextParent.variants!.map((v, j) =>
        j === vIdx ? { ...v, ...patch } : v
      );
      next[i] = nextParent;
      setMenuItems(next);
      return;
    }
  }
}

export function removeMenuItem(itemId: string): void {
  const before = data.menuItems.length;
  const filtered = data.menuItems.filter((i) => i.id !== itemId);
  if (filtered.length !== before) {
    setMenuItems(filtered);
    return;
  }
  for (let i = 0; i < data.menuItems.length; i++) {
    const parent = data.menuItems[i];
    if (!parent.variants) continue;
    const vIdx = parent.variants.findIndex((v) => v.id === itemId);
    if (vIdx !== -1) {
      const next = [...data.menuItems];
      next[i] = {
        ...next[i],
        variants: next[i].variants!.filter((_, j) => j !== vIdx),
      };
      setMenuItems(next);
      return;
    }
  }
}

// ============================================================
// PULL (входящие)
// ============================================================
export function applyRemoteOrders(remote: Order[]): void {
  if (!Array.isArray(remote)) return;

  const remoteIds = new Set(remote.map((o) => o.id));
  const now = Date.now();
  const pending = data.orders.filter((o) => {
    if (remoteIds.has(o.id)) return false;
    const age = now - new Date(o.created_at).getTime();
    return age < 5000;
  });

  data.orders = [...remote, ...pending];
  schedulePersist();
  notifyAll();
}

export function applyRemoteMenu(remote: MenuItem[]): void {
  if (!Array.isArray(remote)) return;

  try {
    if (JSON.stringify(data.menuItems) === JSON.stringify(remote)) {
      return;
    }
  } catch {
    /* ignore */
  }

  data.menuItems = remote;
  schedulePersist();
  notifyAll();
}

// ============================================================
// RESET
// ============================================================
export function resetAllData(): void {
  data = defaultData();
  persist();
  notifyAll();
}
