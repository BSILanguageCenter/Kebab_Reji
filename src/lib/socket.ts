import { io, type Socket } from 'socket.io-client';
import type { Order, MenuCategory, MenuItem } from '@/types/database';

export interface ServerMenu {
  categories: MenuCategory[];
  items: MenuItem[];
}

export interface ServerSnapshot {
  orders: Order[];
  menu: ServerMenu;
}

export interface SyncStats {
  unsyncedCount: number;
  totalOrders: number;
}

// ============================================================
// Socket singleton
// ============================================================
let socket: Socket | null = null;

// ============================================================
// Кеш последнего состояния — отдаём новым подписчикам сразу
// ============================================================
let lastOrders: Order[] | null = null;
let lastMenu: ServerMenu | null = null;

type OrdersListener = (orders: Order[]) => void;
type MenuListener = (menu: ServerMenu) => void;
type InitListener = (snap: ServerSnapshot) => void;

const ordersListeners = new Set<OrdersListener>();
const menuListeners = new Set<MenuListener>();
const initListeners = new Set<InitListener>();

function notifyOrders(orders: Order[]) {
  lastOrders = orders;
  ordersListeners.forEach((l) => l(orders));
}

function notifyMenu(menu: ServerMenu) {
  lastMenu = menu;
  menuListeners.forEach((l) => l(menu));
}

function notifyInit(snap: ServerSnapshot) {
  lastOrders = snap.orders;
  lastMenu = snap.menu;
  initListeners.forEach((l) => l(snap));
  ordersListeners.forEach((l) => l(snap.orders));
  menuListeners.forEach((l) => l(snap.menu));
}

// ============================================================
// Подписки — сразу получают кешированные данные, если есть
// ============================================================
export function subscribeOrders(listener: OrdersListener): () => void {
  ordersListeners.add(listener);
  if (lastOrders !== null) {
    listener(lastOrders);
  }
  return () => {
    ordersListeners.delete(listener);
  };
}

export function subscribeMenu(listener: MenuListener): () => void {
  menuListeners.add(listener);
  if (lastMenu !== null) {
    listener(lastMenu);
  }
  return () => {
    menuListeners.delete(listener);
  };
}

export function subscribeInit(listener: InitListener): () => void {
  initListeners.add(listener);
  if (lastOrders !== null && lastMenu !== null) {
    listener({ orders: lastOrders, menu: lastMenu });
  }
  return () => {
    initListeners.delete(listener);
  };
}

// ============================================================
// Socket getter
// ============================================================
export function getSocket(): Socket {
  if (!socket) {
    const url =
      import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

    socket = io(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 2000,
      reconnectionAttempts: Infinity,
    });

    socket.on('connect', () => {
      console.log('[ws] Подключён к серверу:', url);
    });

    socket.on('disconnect', (reason) => {
      console.warn('[ws] Отключён:', reason);
    });

    socket.on('connect_error', (err) => {
      console.error('[ws] Ошибка подключения:', err.message);
    });

    // ---------- Основные события от сервера ----------
    socket.on('init', (snap: ServerSnapshot) => {
      console.log('[ws] init: заказов', snap.orders.length, ', меню',
        snap.menu.categories.length, 'кат.');
      notifyInit(snap);
    });

    socket.on('orders', (orders: Order[]) => {
      notifyOrders(orders);
    });

    socket.on('menu', (menu: ServerMenu) => {
      notifyMenu(menu);
    });
  }
  return socket;
}

export function isConnected(): boolean {
  return socket?.connected ?? false;
}

// ============================================================
// API — методы обёртки (без изменений)
// ============================================================
export function emitCreateOrder(payload: {
  order_type: 'INSIDE' | 'OUTSIDE';
  total_amount: number;
  comment: string;
  order_items: Array<{
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
  }>;
}): Promise<Order> {
  return new Promise((resolve, reject) => {
    getSocket().emit(
      'create-order',
      payload,
      (res: { ok: boolean; order?: Order; error?: string }) => {
        if (res.ok && res.order) resolve(res.order);
        else reject(new Error(res.error || 'create-order failed'));
      }
    );
  });
}

export function emitUpdateStatus(
  orderId: string,
  status: Order['status']
): Promise<Order | null> {
  return new Promise((resolve, reject) => {
    getSocket().emit(
      'update-status',
      { orderId, status },
      (res: { ok: boolean; order?: Order | null; error?: string }) => {
        if (res.ok) resolve(res.order ?? null);
        else reject(new Error(res.error || 'update-status failed'));
      }
    );
  });
}

export function emitUpdateOrder(payload: {
  id: string;
  order_type: 'INSIDE' | 'OUTSIDE';
  total_amount: number;
  comment: string;
  order_items: Array<{
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
  }>;
}): Promise<Order | null> {
  return new Promise((resolve, reject) => {
    getSocket().emit(
      'update-order',
      payload,
      (res: { ok: boolean; order?: Order | null; error?: string }) => {
        if (res.ok) resolve(res.order ?? null);
        else reject(new Error(res.error || 'update-order failed'));
      }
    );
  });
}

export function emitForceSync(): Promise<SyncStats> {
  return new Promise((resolve) => {
    getSocket().emit('force-sync', null, (stats: SyncStats) => {
      resolve(stats);
    });
  });
}