import { useEffect, useState } from 'react';
import type { OrderStatus, OrderType } from '@/types/database';

export type Role = 'cashier' | 'queue' | 'kitchen' | 'manager';

// ============================================================
// Снимок позиций заказа (для отмены редактирования)
// ============================================================
export interface OrderSnapshot {
  order_type: OrderType;
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
}

// ============================================================
// Тип записи для отмены
// ============================================================
export interface UndoRecord {
  kind: 'status' | 'create' | 'edit';
  orderId: string;
  orderNumber: number;
  fromStatus?: OrderStatus;
  toStatus?: OrderStatus;
  snapshot?: OrderSnapshot;
  timestamp: number;
}

const STORAGE_KEY = 'kebab-pos-undo-stacks';
const MAX_PER_ROLE = 3;

type Stacks = Record<Role, UndoRecord[]>;

function emptyStacks(): Stacks {
  return {
    cashier: [],
    queue: [],
    kitchen: [],
    manager: [],
  };
}

function loadFromStorage(): Stacks {
  if (typeof window === 'undefined') return emptyStacks();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStacks();
    const parsed = JSON.parse(raw);
    const result = emptyStacks();
    (Object.keys(result) as Role[]).forEach((r) => {
      if (Array.isArray(parsed?.[r])) {
        result[r] = parsed[r].slice(-MAX_PER_ROLE);
      }
    });
    return result;
  } catch {
    return emptyStacks();
  }
}

let stacks: Stacks = loadFromStorage();
const listeners = new Set<(s: Stacks) => void>();

function saveToStorage() {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stacks));
  const snapshot = { ...stacks };
  listeners.forEach((l) => l(snapshot));
}

export function pushUndo(role: Role, record: UndoRecord) {
  const list = stacks[role] ?? [];
  stacks = {
    ...stacks,
    [role]: [...list, record].slice(-MAX_PER_ROLE),
  };
  saveToStorage();
}

export function popUndo(role: Role): UndoRecord | null {
  const list = stacks[role] ?? [];
  if (list.length === 0) return null;
  const last = list[list.length - 1];
  stacks = {
    ...stacks,
    [role]: list.slice(0, -1),
  };
  saveToStorage();
  return last;
}

export function clearUndo(role?: Role) {
  if (role) {
    stacks = { ...stacks, [role]: [] };
  } else {
    stacks = emptyStacks();
  }
  saveToStorage();
}

function subscribeUndo(listener: (s: Stacks) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUndoStack(role: Role): UndoRecord[] {
  const [state, setState] = useState<Stacks>(() => stacks);
  useEffect(() => subscribeUndo(setState), []);
  return state[role] ?? [];
}