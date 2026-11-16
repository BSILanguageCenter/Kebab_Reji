import type {
  MenuItem,
  Order,
  OrderItem,
  OrderItemOption,
  OrderStatus,
  OrderType,
  OptionType,
} from '@/types/database';
import { buildTestMenu } from './seedMenu';

// ============================================================
// STORAGE SHAPE
// ============================================================
const STORAGE_KEY = 'kebab-pos-data-v1';
const CHANNEL_NAME = 'kebab-pos-sync';
const CURRENT_VERSION = 2; // bump: убрали printerSettings

export interface LocalData {
  menuItems: MenuItem[];
  orders: Order[];
  nextOrderNumber: number;
  version: number;
}

function defaultData(): LocalData {
  return {
    menuItems: [],
    orders: [],
    nextOrderNumber: 100,
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
    d.version = CURRENT_VERSION;
    return d;
  } catch {
    return defaultData();
  }
}

let data: LocalData = loadData();

// Автосид: если меню пустое — заполняем тестовым (только при первом запуске)
if (data.menuItems.length === 0) {
  try {
    data.menuItems = buildTestMenu();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
    console.log(
      `[localStore] ✓ Загружено тестовое меню: ${data.menuItems.length} позиций`
    );
  } catch (e) {
    console.warn('[localStore] Не удалось загрузить тестовое меню:', e);
  }
}

// Автосид: если меню пустое — заполняем тестовым (только при первом запуске)
if (data.menuItems.length === 0) {
  try {
    // Динамический импорт, чтобы избежать цикла
    // (на самом деле seedMenu.ts импортирует только типы, цикла нет,
    //  но так безопаснее)
    const { buildTestMenu } = await import('./seedMenu');
    data.menuItems = buildTestMenu();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.warn('[localStore] Не удалось загрузить тестовое меню:', e);
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
  } catch (e) {
    console.error(
      '[localStore] Не удалось сохранить (возможно, превышен лимит localStorage):',
      e
    );
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
}

// ============================================================
// COMPAT STUBS (для старых импортов из socket.ts)
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
  return data.orders
    .filter(
      (o) =>
        o.status === 'NEW' ||
        o.status === 'PREPARING' ||
        o.status === 'READY'
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
  const id = newId();
  const orderNumber = data.nextOrderNumber;
  data.nextOrderNumber += 1;

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
  return updated;
}

export async function emitForceSync(): Promise<SyncStats> {
  return { unsyncedCount: 0, totalOrders: data.orders.length };
}

// ============================================================
// LAYOUT (no-op, для совместимости)
// ============================================================
export function emitLayoutSettings(settings: unknown): void {
  // Layout синкается через свой BroadcastChannel в layoutSettings.ts
  void settings;
}

// ============================================================
// MENU — WRITE
// ============================================================
export function setMenuItems(items: MenuItem[]): void {
  data.menuItems = items;
  schedulePersist();
  notifyAll();
}

export function addMenuItem(item: MenuItem): void {
  data.menuItems.push(item);
  schedulePersist();
  notifyAll();
}

export function updateMenuItem(itemId: string, patch: Partial<MenuItem>): void {
  const idx = data.menuItems.findIndex((i) => i.id === itemId);
  if (idx !== -1) {
    data.menuItems[idx] = { ...data.menuItems[idx], ...patch };
    schedulePersist();
    notifyAll();
    return;
  }
  for (const parent of data.menuItems) {
    if (!parent.variants) continue;
    const vIdx = parent.variants.findIndex((v) => v.id === itemId);
    if (vIdx !== -1) {
      parent.variants[vIdx] = { ...parent.variants[vIdx], ...patch };
      schedulePersist();
      notifyAll();
      return;
    }
  }
}

export function removeMenuItem(itemId: string): void {
  const before = data.menuItems.length;
  data.menuItems = data.menuItems.filter((i) => i.id !== itemId);
  if (data.menuItems.length !== before) {
    schedulePersist();
    notifyAll();
    return;
  }
  for (const parent of data.menuItems) {
    if (!parent.variants) continue;
    const idx = parent.variants.findIndex((v) => v.id === itemId);
    if (idx !== -1) {
      parent.variants.splice(idx, 1);
      schedulePersist();
      notifyAll();
      return;
    }
  }
}

// ============================================================
// RESET (для разработки)
// ============================================================
export function resetAllData(): void {
  data = defaultData();
  persist();
  notifyAll();
}
