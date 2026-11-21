// src/components/FloatingWindow.tsx
// Плавающее окно: двигается мышью за заголовок, на сенсорных экранах —
// ДОЛГИМ нажатием на заголовок (появляется подсветка и вибро-отклик).
// Сворачивается в заголовок и не пропадает с экрана.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Square, X, GripHorizontal } from 'lucide-react';
import { useI18n } from '@/locale';

interface Props {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  initialPos?: { x: number; y: number };
  storageKey?: string;
  width?: number;
  onClose?: () => void;
  defaultCollapsed?: boolean;
}

interface SavedState {
  x: number;
  y: number;
  collapsed: boolean;
}

const DEFAULT_POS = { x: 40, y: 120 };
/** Сколько надо удерживать заголовок пальцем, чтобы окно «подхватилось» */
const LONG_PRESS_MS = 350;
/** Допуск смещения пальца во время ожидания долгого нажатия */
const MOVE_TOLERANCE = 10;
/** Сколько пикселей заголовка всегда остаётся на экране */
const MIN_VISIBLE_H = 44;

let zCounter = 90;

function loadState(key: string, fallback: SavedState): SavedState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<SavedState>;
    return {
      x: typeof p.x === 'number' ? p.x : fallback.x,
      y: typeof p.y === 'number' ? p.y : fallback.y,
      collapsed: typeof p.collapsed === 'boolean' ? p.collapsed : fallback.collapsed,
    };
  } catch {
    return fallback;
  }
}

export function FloatingWindow({
  title,
  icon,
  children,
  initialPos = DEFAULT_POS,
  storageKey = 'kebab-floating-window',
  width = 380,
  onClose,
  defaultCollapsed = false,
}: Props) {
  const { t } = useI18n();
  const fallback: SavedState = {
    x: initialPos.x,
    y: initialPos.y,
    collapsed: defaultCollapsed,
  };

  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => {
    const s = loadState(storageKey, fallback);
    return { x: s.x, y: s.y };
  });
  const [collapsed, setCollapsed] = useState(
    () => loadState(storageKey, fallback).collapsed
  );
  const [z, setZ] = useState(() => ++zCounter);
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false); // палец прижат, ждём долгого нажатия

  const press = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    active: boolean;
    timer: number | null;
  } | null>(null);

  // сохраняем положение и состояние
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ x: pos.x, y: pos.y, collapsed })
      );
    } catch {
      /* ignore */
    }
  }, [pos.x, pos.y, collapsed, storageKey]);

  const clamp = useCallback((x: number, y: number) => {
    const w = rootRef.current?.offsetWidth ?? width;
    return {
      x: Math.max(0, Math.min(window.innerWidth - w, x)),
      y: Math.max(0, Math.min(window.innerHeight - MIN_VISIBLE_H, y)),
    };
  }, [width]);

  // держим окно в пределах экрана при повороте / изменении размера
  useEffect(() => {
    const fix = () => setPos((p) => clamp(p.x, p.y));
    fix();
    window.addEventListener('resize', fix);
    return () => window.removeEventListener('resize', fix);
  }, [clamp, collapsed]);

  const clearPress = () => {
    if (press.current?.timer != null) window.clearTimeout(press.current.timer);
    press.current = null;
    setDragging(false);
    setArmed(false);
  };

  useEffect(() => () => clearPress(), []);

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    setZ(++zCounter);

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    const isTouch = e.pointerType !== 'mouse';
    const state = {
      sx: e.clientX,
      sy: e.clientY,
      ox: pos.x,
      oy: pos.y,
      active: !isTouch,
      timer: null as number | null,
    };
    press.current = state;

    if (!isTouch) {
      setDragging(true);
      return;
    }
    // палец: ждём долгого нажатия
    setArmed(true);
    state.timer = window.setTimeout(() => {
      if (press.current !== state) return;
      state.active = true;
      state.timer = null;
      setArmed(false);
      setDragging(true);
      try {
        if ('vibrate' in navigator) navigator.vibrate(12);
      } catch {
        /* ignore */
      }
    }, LONG_PRESS_MS);
  };

  const onHeaderPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.sx;
    const dy = e.clientY - p.sy;
    if (!p.active) {
      // палец уехал раньше времени — это не перетаскивание
      if (Math.hypot(dx, dy) > MOVE_TOLERANCE) clearPress();
      return;
    }
    setPos(clamp(p.ox + dx, p.oy + dy));
  };

  const onHeaderPointerUp = (e: React.PointerEvent) => {
    clearPress();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      ref={rootRef}
      onPointerDownCapture={() => setZ(++zCounter)}
      className={`fixed flex flex-col rounded-2xl bg-white shadow-2xl border overflow-hidden transition-shadow ${
        dragging ? 'border-orange-400 ring-2 ring-orange-400/60' : 'border-slate-300'
      }`}
      style={{
        left: pos.x,
        top: pos.y,
        zIndex: z,
        width: `min(${collapsed ? Math.min(width, 240) : width}px, calc(100vw - 16px))`,
        maxHeight: collapsed ? undefined : 'min(85vh, 720px)',
      }}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        title={t('dragWindowHint')}
        className={`flex items-center gap-1.5 px-2.5 py-2 border-b border-slate-200 shrink-0 select-none touch-none ${
          dragging
            ? 'bg-orange-100 cursor-grabbing'
            : armed
            ? 'bg-orange-50'
            : 'bg-gradient-to-r from-slate-100 to-slate-50 cursor-grab'
        }`}
        style={{ WebkitTouchCallout: 'none' }}
      >
        <GripHorizontal
          className={`w-4 h-4 shrink-0 ${
            dragging || armed ? 'text-orange-500' : 'text-slate-400'
          }`}
        />
        {icon}
        <span className="text-[0.625rem] font-bold text-slate-600 uppercase tracking-wide truncate flex-1">
          {title}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="w-8 h-8 rounded-lg hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors shrink-0 active:scale-90"
          title={collapsed ? t('expandWindow') : t('collapseWindow')}
          aria-label={collapsed ? t('expandWindow') : t('collapseWindow')}
        >
          {collapsed ? <Square className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-red-100 text-slate-600 hover:text-red-600 flex items-center justify-center transition-colors shrink-0 active:scale-90"
            title={t('close')}
            aria-label={t('close')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {children}
        </div>
      )}
    </div>
  );
}
