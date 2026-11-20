// src/components/FloatingWindow.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Square, X, GripHorizontal } from 'lucide-react';

interface Props {
  title: string;
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

function loadState(key: string, fallback: SavedState): SavedState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    return {
      x: typeof parsed.x === 'number' ? parsed.x : fallback.x,
      y: typeof parsed.y === 'number' ? parsed.y : fallback.y,
      collapsed:
        typeof parsed.collapsed === 'boolean'
          ? parsed.collapsed
          : fallback.collapsed,
    };
  } catch {
    return fallback;
  }
}

export function FloatingWindow({
  title,
  children,
  initialPos = DEFAULT_POS,
  storageKey = 'kebab-floating-window',
  width = 380,
  onClose,
  defaultCollapsed = false,
}: Props) {
  const fallback: SavedState = {
    x: initialPos.x,
    y: initialPos.y,
    collapsed: defaultCollapsed,
  };

  const [pos, setPos] = useState(() => {
    const s = loadState(storageKey, fallback);
    return { x: s.x, y: s.y };
  });
  const [collapsed, setCollapsed] = useState(
    () => loadState(storageKey, fallback).collapsed
  );

  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // persist
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

  // clamp on resize
  useEffect(() => {
    const onResize = () => {
      setPos((p) => ({
        x: Math.min(p.x, Math.max(0, window.innerWidth - 100)),
        y: Math.min(p.y, Math.max(0, window.innerHeight - 60)),
      }));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };
    },
    [pos.x, pos.y]
  );

  const onHeaderPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const nx = Math.max(
      0,
      Math.min(window.innerWidth - 200, dragRef.current.origX + dx)
    );
    const ny = Math.max(
      0,
      Math.min(window.innerHeight - 60, dragRef.current.origY + dy)
    );
    setPos({ x: nx, y: ny });
  }, []);

  const onHeaderPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div
      className="fixed z-[90] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-300 overflow-hidden"
      style={{
        left: pos.x,
        top: pos.y,
        width,
        maxHeight: collapsed ? 'auto' : 'min(85vh, 720px)',
      }}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        className="flex items-center gap-1.5 px-2.5 py-2 bg-gradient-to-r from-slate-100 to-slate-50 border-b border-slate-200 cursor-grab active:cursor-grabbing shrink-0 select-none"
      >
        <GripHorizontal className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="text-xs font-black text-slate-700 uppercase tracking-wider truncate flex-1">
          {title}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="w-7 h-7 rounded-lg hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors shrink-0"
          title={collapsed ? 'Развернуть' : 'Свернуть'}
        >
          {collapsed ? (
            <Square className="w-3.5 h-3.5" />
          ) : (
            <Minus className="w-3.5 h-3.5" />
          )}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-red-100 text-slate-600 hover:text-red-600 flex items-center justify-center transition-colors shrink-0"
            title="Закрыть"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      )}
    </div>
  );
}
