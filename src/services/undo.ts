import { useEffect, useState } from 'react';
import type { OrderStatus } from '@/types/database';

export interface UndoRecord {
  orderId: string;
  orderNumber: number;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  timestamp: number;
}

const STORAGE_KEY = 'kebab-pos-undo-stack';
const MAX_UNDO = 3;

type Listener = (stack: UndoRecord[]) => void;

let stack: UndoRecord[] = loadFromStorage();
const listeners = new Set<Listener>();

function loadFromStorage(): UndoRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-MAX_UNDO);
  } catch {
    return [];
  }
}

function saveToStorage() {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stack));
  listeners.forEach((l) => l(stack));
}

export function getUndoStack(): UndoRecord[] {
  return [...stack];
}

export function pushUndo(record: UndoRecord) {
  stack = [...stack, record].slice(-MAX_UNDO);
  saveToStorage();
}

export function popUndo(): UndoRecord | null {
  if (stack.length === 0) return null;
  const last = stack[stack.length - 1];
  stack = stack.slice(0, -1);
  saveToStorage();
  return last;
}

export function clearUndo() {
  stack = [];
  saveToStorage();
}

function subscribeUndo(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React-хук для чтения стека отмены. */
export function useUndoStack(): UndoRecord[] {
  const [state, setState] = useState<UndoRecord[]>(() => getUndoStack());
  useEffect(() => subscribeUndo(setState), []);
  return state;
}