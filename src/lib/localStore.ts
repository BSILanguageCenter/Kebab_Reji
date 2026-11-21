// src/lib/localStore.ts
import { uuid } from '@/lib/uuid';
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
  queueOrderToDb,
  nextOrderNumberFromDb,
  getCachedDeviceNo,
  ensureDeviceNo,
  hasPendingOrder,
  isOrdersMigrated,
} from '@/services/supabaseOrders';
import {
  upsertProductsToDb,
  upsertProductsPartialToDb,
} from '@/services/supabaseDb';
import { migrateMenuSchema } from '@/lib/menuMigrations';
import { isOrderDeleted } from '@/services/deletedOrders';

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

function writeToStorage(): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e: unknown) {
    console.error('[localStore] localStorage persist failed:', e);
    return false;
  }
}

function persist() {
  if (typeof window === 'undefined') return;
  if (persistTimer != null) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  let ok = writeToStorage();
  if (!ok && isOrdersMigrated()) {
    // Квота localStorage (~5 МБ) переполнена — раньше изменения меню молча
    // терялись и после обновления страницы «откатывались». Освобождаем место
    // за счёт старых заказов (они уже в Supabase) и пробуем снова.
    for (const days of [14, 3]) {
      const cutoff = Date.now() - days * 24 * 3600 * 1000;
      data.orders = data.orders.filter(
        (o) =>
          new Date(o.created_at).getTime() >= cutoff || hasPendingOrder(o.id)
      );
      ok = writeToStorage();
      if (ok) break;
    }
  }
  if (!ok) {
    try {
      window.dispatchEvent(new CustomEvent('pos-storage-error'));
    } catch {
      /* ignore */
    }
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

// Обновили страницу в течение 50 мс после изменения — запись не успевала.
// Сбрасываем отложенную запись при закрытии / сворачивании вкладки.
if (typeof window !== 'undefined') {
  const flushPending = () => {
    if (persistTimer != null) persist();
  };
  window.addEventListener('pagehide', flushPending);
  window.addEventListener('beforeunload', flushPending);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPending();
  });
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
  return uuid();
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

  // Номер берём из ОБЩЕГО счётчика (Supabase), чтобы у всех устройств он
  // был единым. floor — максимальный номер за сегодня, уже известный этому
  // устройству (дробную часть офлайн-номеров 12.2 отбрасываем).
  //
  // Нет сети → запасной локальный номер. Чтобы два устройства не выдали
  // одинаковый номер (и не совпал с целыми номерами общего счётчика):
  // устройство №1 → 12.1, №2 → 12.2, №3 → 12.3 (до №9; дальше по кругу).
  const today = todayStr();
  const floor = data.orders
    .filter((o) => dayOf(o.created_at) === today)
    .reduce((m, o) => Math.max(m, Math.floor(o.order_number)), 0);

  const deviceNo =
    getCachedDeviceNo() ??
    (await Promise.race([
      ensureDeviceNo(),
      new Promise<null>((r) => setTimeout(() => r(null), 1500)),
    ])) ??
    1;

  let orderNumber: number;
  try {
    orderNumber = await nextOrderNumberFromDb(today, floor);
  } catch (e: unknown) {
    console.warn('[localStore] shared counter unavailable, offline number:', e);
    const base = Math.max(floor, data.nextOrderNumber - 1) + 1;
    const suffix = (((deviceNo - 1) % 9) + 1) / 10;
    orderNumber = Number((base + suffix).toFixed(1));
  }
  data.nextOrderNumber = Math.floor(orderNumber) + 1;

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
    status_updated_at: now,
    device_no: deviceNo,
    order_items: (payload.order_items ?? []).map((i) => toOrderItem(id, i)),
  };

  data.orders.push(order);
  schedulePersist();
  notifyAll();

  queueOrderToDb(order);

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

  queueOrderToDb(updated);

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
    status_updated_at: now,
    completed_at: isFinal ? now : data.orders[idx].completed_at ?? null,
  };

  data.orders[idx] = updated;
  schedulePersist();
  notifyAll();

  queueOrderToDb(updated);

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
// ---------- Очередь синхронизации меню с Supabase ----------
// Раньше каждое изменение отправляло ВСЁ меню отдельным запросом, и запросы
// могли завершиться не по порядку (или тихо упасть) — после входа из облака
// возвращались старые позиции. Теперь: отправляем только изменённые карточки,
// строго по очереди, с повтором при ошибке.
const dbQueueChanged = new Map<string, MenuItem>();
const dbQueueRemoved = new Set<string>();
let dbFlushing = false;

// Очередь раньше жила только в памяти: если отправка в облако не удалась и
// страницу обновляли — изменение терялось, а облако возвращало СТАРОЕ меню.
// Теперь id неотправленных карточек хранятся в localStorage.
const PENDING_KEY = 'kebab-pos-menu-pending-v1';
// Какие id точно есть в облаке (нужно, чтобы отличить «удалено на другом
// устройстве» от «создано здесь, но ещё не отправлено»).
const SYNCED_IDS_KEY = 'kebab-pos-menu-synced-ids-v1';
let syncedIds: Set<string> = new Set();

function savePendingIds(): void {
  try {
    if (dbQueueChanged.size === 0 && dbQueueRemoved.size === 0) {
      localStorage.removeItem(PENDING_KEY);
      return;
    }
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({
        changed: [...dbQueueChanged.keys()],
        removed: [...dbQueueRemoved],
      })
    );
  } catch {
    /* ignore */
  }
}

function saveSyncedIds(): void {
  try {
    localStorage.setItem(SYNCED_IDS_KEY, JSON.stringify([...syncedIds]));
  } catch {
    /* ignore */
  }
}

function restoreMenuQueue(): void {
  try {
    const raw = localStorage.getItem(SYNCED_IDS_KEY);
    if (raw) {
      const arr: unknown = JSON.parse(raw);
      if (Array.isArray(arr)) {
        syncedIds = new Set(arr.filter((x): x is string => typeof x === 'string'));
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as { changed?: string[]; removed?: string[] };
    const byId = new Map(data.menuItems.map((i) => [i.id, i]));
    for (const id of p.changed ?? []) {
      const it = byId.get(id);
      if (it) dbQueueChanged.set(id, it);
    }
    for (const id of p.removed ?? []) {
      if (!byId.has(id)) dbQueueRemoved.add(id);
    }
  } catch {
    /* ignore */
  }
}

/** Время изменения карточки (мс); 0 — неизвестно. */
function itemTs(it: MenuItem | undefined): number {
  if (!it) return 0;
  const t = new Date(it.updated_at).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Состояние очереди отправки меню в Supabase (для диагностики). */
export function getMenuSyncState(): {
  flushing: boolean;
  pendingChanged: number;
  pendingRemoved: number;
} {
  return {
    flushing: dbFlushing,
    pendingChanged: dbQueueChanged.size,
    pendingRemoved: dbQueueRemoved.size,
  };
}

/** Повторная отправка застрявших изменений меню. */
export function retryMenuSync(): void {
  if (!dbFlushing && (dbQueueChanged.size > 0 || dbQueueRemoved.size > 0)) {
    void flushDbQueue();
  }
}

if (typeof window !== 'undefined') {
  restoreMenuQueue();
  // Застрявшая очередь — повторяем сами (и сразу после запуска).
  window.setInterval(retryMenuSync, 20_000);
  window.addEventListener('online', retryMenuSync);
  window.setTimeout(retryMenuSync, 1500);
}

function queueDbSync(prev: MenuItem[], next: MenuItem[]): void {
  const prevMap = new Map(prev.map((i) => [i.id, i]));
  const nextIds = new Set<string>();
  for (const n of next) {
    nextIds.add(n.id);
    if (prevMap.get(n.id) !== n) {
      dbQueueChanged.set(n.id, n);
      dbQueueRemoved.delete(n.id);
    }
  }
  for (const p of prev) {
    if (!nextIds.has(p.id)) {
      dbQueueRemoved.add(p.id);
      dbQueueChanged.delete(p.id);
    }
  }
  savePendingIds();
  void flushDbQueue();
}

async function flushDbQueue(): Promise<void> {
  if (dbFlushing) return;
  dbFlushing = true;
  try {
    while (dbQueueChanged.size > 0 || dbQueueRemoved.size > 0) {
      const changed = [...dbQueueChanged.values()];
      const removed = [...dbQueueRemoved];
      dbQueueChanged.clear();
      dbQueueRemoved.clear();

      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          await upsertProductsPartialToDb(changed, removed);
          ok = true;
          for (const it of changed) syncedIds.add(it.id);
          for (const id of removed) syncedIds.delete(id);
          saveSyncedIds();
        } catch (e: unknown) {
          console.warn('[localStore] Supabase menu sync failed:', e);
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
      if (!ok) {
        // вернуть в очередь (если за это время не появилось более новое)
        for (const it of changed) {
          if (!dbQueueChanged.has(it.id)) dbQueueChanged.set(it.id, it);
        }
        for (const id of removed) dbQueueRemoved.add(id);
        savePendingIds();
        break; // повторим при следующем изменении
      }
      savePendingIds();
    }
  } finally {
    dbFlushing = false;
  }
}

export function setMenuItems(items: MenuItem[]): void {
  const prev = data.menuItems;
  data.menuItems = items;
  persist(); // меню пишем на диск немедленно, а не через 50 мс
  notifyAll();

  queueDbSync(prev, items);

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
    next[idx] = { ...next[idx], ...patch, updated_at: new Date().toISOString() };
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
      nextParent.updated_at = new Date().toISOString();
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
        updated_at: new Date().toISOString(),
      };
      setMenuItems(next);
      return;
    }
  }
}

// ============================================================
// PULL (входящие)
// ============================================================
/** Сколько дней заказов держим в localStorage (остальное — в Supabase). */
const KEEP_LOCAL_DAYS = 45;

/**
 * Входящие заказы из Supabase — СЛИЯНИЕ, а не замена:
 *  - новых заказов добавляем;
 *  - существующие обновляем, только если пришла более свежая версия;
 *  - заказы, ещё не отправленные в облако, не трогаем (офлайн-режим).
 */
function msOf(s?: string | null): number {
  const v = s ? new Date(s).getTime() : 0;
  return Number.isFinite(v) ? v : 0;
}

function statusMs(o: Order): number {
  return msOf(o.status_updated_at) || msOf(o.created_at);
}

/**
 * Слияние двух версий заказа ПО ПОЛЯМ:
 *  - позиции / сумма / комментарий — от версии с более новым updated_at;
 *  - статус — от версии с более новым status_updated_at.
 * Поэтому правка кассира не откатывает статус кухни и наоборот.
 */
function mergeOrders(local: Order, remote: Order): Order {
  const base = msOf(remote.updated_at) > msOf(local.updated_at) ? remote : local;
  const st = statusMs(remote) > statusMs(local) ? remote : local;
  return {
    ...base,
    status: st.status,
    completed_at: st.completed_at ?? null,
    status_updated_at: st.status_updated_at ?? base.status_updated_at ?? null,
  };
}

export function applyRemoteOrders(remote: Order[]): void {
  if (!Array.isArray(remote) || remote.length === 0) return;

  const byId = new Map(data.orders.map((o) => [o.id, o]));
  let changed = false;

  for (const r of remote) {
    if (!r || !r.id) continue;
    if (isOrderDeleted(r.id)) continue; // удалён разработчиком
    const local = byId.get(r.id);
    if (!local) {
      console.warn('[order-source] +добавлен из Supabase (realtime/catch-up):', r.id, r.created_at);
      byId.set(r.id, r);
      changed = true;
      continue;
    }
    if (hasPendingOrder(r.id)) continue; // своё ещё не отправлено — сольётся после отправки
    const merged = mergeOrders(local, r);
    if (
      merged.status !== local.status ||
      msOf(r.updated_at) > msOf(local.updated_at)
    ) {
      byId.set(r.id, merged);
      changed = true;
    }
  }

  if (!changed) return;
  data.orders = [...byId.values()];
  pruneOldLocalOrders();
  schedulePersist();
  notifyAll();
}

/** Убрать заказы из localStorage этого устройства (режим разработчика). */
export function removeOrdersLocally(ids: string[]): void {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const gone = new Set(ids);
  const before = data.orders.length;
  data.orders = data.orders.filter((o) => !gone.has(o.id));
  if (data.orders.length === before) return;
  persist();
  notifyAll();
}

/** Удаление, пришедшее с другого устройства (Supabase realtime DELETE). */
export function applyRemoteDeletes(ids: string[]): void {
  removeOrdersLocally(ids);
}

/**
 * Старые заказы (> KEEP_LOCAL_DAYS) убираем из localStorage — иначе он
 * переполнится (лимит ~5 МБ). Только после того, как все локальные заказы
 * загружены в Supabase; ждущие отправки не трогаем.
 */
function pruneOldLocalOrders(): void {
  if (!isOrdersMigrated()) return;
  const cutoff = Date.now() - KEEP_LOCAL_DAYS * 24 * 3600 * 1000;
  data.orders = data.orders.filter(
    (o) => new Date(o.created_at).getTime() >= cutoff || hasPendingOrder(o.id)
  );
}

export function applyRemoteMenu(incoming: MenuItem[]): void {
  if (!Array.isArray(incoming)) return;

  // Идёт отправка наших изменений — ответ облака может быть устаревшим.
  // После отправки облако само пришлёт realtime-событие, и мы сольёмся.
  if (dbFlushing) {
    console.warn('[menu] входящее меню отложено: идёт отправка изменений');
    return;
  }

  // Пустой ответ не должен стирать локальное меню
  if (incoming.length === 0 && data.menuItems.length > 0) {
    console.warn('[menu] из облака пришло пустое меню — локальное сохранено');
    return;
  }

  // Старые данные из Supabase (например, свойство «с капустой / без
  // капусты») приводим к схеме «одно значение» и отправляем обратно.
  const remote = migrateMenuSchema(incoming);
  if (remote !== incoming) {
    upsertProductsToDb(remote).catch((e: unknown) => {
      console.warn('[localStore] Supabase migration upsert failed:', e);
    });
  }

  // ---------- СЛИЯНИЕ по карточкам ----------
  // Раньше локальное меню целиком заменялось ответом облака — любое
  // неотправленное изменение (и перестановка) пропадало после обновления.
  //  • карточка с неотправленными изменениями — остаётся локальной;
  //  • у остальных побеждает более новая (по updated_at);
  //  • создана здесь и ещё не в облаке — остаётся и отправляется;
  //  • была в облаке, а теперь её там нет — удалена на другом устройстве.
  const localById = new Map(data.menuItems.map((i) => [i.id, i]));
  const remoteIds = new Set<string>();
  const merged: MenuItem[] = [];
  const toPush: MenuItem[] = [];

  for (const r of remote) {
    if (!r || !r.id) continue;
    remoteIds.add(r.id);
    if (dbQueueRemoved.has(r.id)) continue; // удалено здесь, удаление в очереди
    const l = localById.get(r.id);
    if (!l) {
      merged.push(r);
      continue;
    }
    if (dbQueueChanged.has(r.id)) {
      merged.push(dbQueueChanged.get(r.id) ?? l);
      continue;
    }
    if (itemTs(l) > itemTs(r)) {
      merged.push(l);
      toPush.push(l); // локальная версия новее — досылаем в облако
      continue;
    }
    // Расположение карточек — СВОЁ на каждом устройстве: берём из локального
    // хранилища, а из облака только остальные данные (название, цена, фото…).
    merged.push({
      ...r,
      sort_order: l.sort_order,
      sort_order_single: l.sort_order_single,
    });
  }

  for (const l of data.menuItems) {
    if (remoteIds.has(l.id)) continue;
    if (dbQueueChanged.has(l.id) || !syncedIds.has(l.id)) {
      merged.push(l);
      toPush.push(l);
    }
    // иначе: была в облаке и пропала → удалена на другом устройстве
  }

  for (const id of remoteIds) syncedIds.add(id);
  saveSyncedIds();

  // Сохраняем прежний порядок массива: сначала локальный, затем новые
  const order = new Map(data.menuItems.map((i, idx) => [i.id, idx]));
  merged.sort(
    (a, b) =>
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );

  let same = false;
  try {
    same = JSON.stringify(data.menuItems) === JSON.stringify(merged);
  } catch {
    /* ignore */
  }

  if (!same) {
    data.menuItems = merged;
    persist();
    notifyAll();
  }

  if (toPush.length > 0) {
    for (const it of toPush) dbQueueChanged.set(it.id, it);
    savePendingIds();
    void flushDbQueue();
  }
}

// ============================================================
// RESET
// ============================================================
export function resetAllData(): void {
  data = defaultData();
  persist();
  notifyAll();
}
