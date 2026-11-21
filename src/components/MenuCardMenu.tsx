import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Copy, Trash2 } from 'lucide-react';
import { useI18n } from '@/locale';

export interface MenuCardMenuState {
  itemId: string;
  itemName: string;
  x: number;
  y: number;
}

export function MenuCardMenu({
  state,
  onEdit,
  onDuplicate,
  onDelete,
  onClose,
}: {
  state: MenuCardMenuState;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: state.x, top: state.y });

  // Закрытие по клику вне, Escape, прокрутке и изменению размера окна
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Навигация стрелками
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const btns = Array.from(
          ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? []
        );
        if (btns.length === 0) return;
        e.preventDefault();
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          e.key === 'ArrowDown'
            ? btns[(i + 1) % btns.length]
            : btns[(i - 1 + btns.length) % btns.length];
        next.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  // Позиция по реальному размеру меню: не вылезает за экран,
  // при нехватке места снизу — открывается вверх
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = state.x;
    let top = state.y;
    if (left + r.width > vw - 8) left = Math.max(8, vw - r.width - 8);
    if (top + r.height > vh - 8) top = Math.max(8, state.y - r.height - 32);
    setPos({ left, top });
    el.querySelector<HTMLButtonElement>('button')?.focus();
  }, [state.x, state.y]);

  const itemCls =
    'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl active:scale-[0.98] text-left transition-all focus:outline-none';

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[9000] bg-white rounded-2xl shadow-2xl border border-slate-200 p-1.5 min-w-[220px]"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5 text-[0.625rem] font-black text-slate-400 uppercase tracking-wider truncate">
        {state.itemName}
      </div>

      <button
        role="menuitem"
        onClick={() => {
          onEdit();
          onClose();
        }}
        className={`${itemCls} hover:bg-slate-100 focus:bg-slate-100`}
      >
        <Pencil className="w-4 h-4 text-slate-600" />
        <span className="text-sm font-bold text-slate-800">{t('editAction')}</span>
      </button>

      <button
        role="menuitem"
        onClick={() => {
          onDuplicate();
          onClose();
        }}
        className={`${itemCls} hover:bg-slate-100 focus:bg-slate-100`}
      >
        <Copy className="w-4 h-4 text-slate-600" />
        <span className="text-sm font-bold text-slate-800">{t('duplicate')}</span>
      </button>

      <div className="my-1 border-t border-slate-100" />

      <button
        role="menuitem"
        onClick={() => {
          onDelete();
          onClose();
        }}
        className={`${itemCls} hover:bg-red-50 focus:bg-red-50`}
      >
        <Trash2 className="w-4 h-4 text-red-600" />
        <span className="text-sm font-bold text-red-600">{t('delete')}</span>
      </button>
    </div>,
    document.body
  );
}
