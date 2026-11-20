import { memo, useRef } from 'react';
import { MoreVertical, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatYen } from '@/locale/format';
import type { MenuItem } from '@/types/database';

type Mode = 'view' | 'edit';

interface MenuCardProps {
  item: MenuItem;
  variants?: MenuItem[];
  size: number;
  textSize: number;
  compact?: boolean;
  cardRadius: number;
  mode?: Mode;
  /** Варианты группы переносятся на новую строку (узкие экраны) */
  wrapVariants?: boolean;
  /** Отступ сетки (px): карточка группы заполняет ячейку и держит тот же зазор */
  gap?: number;

  onClick: (item: MenuItem) => void;
  onVariantClick?: (parent: MenuItem, variant: MenuItem) => void;

  onEdit?: (item: MenuItem) => void;
  onDelete?: (item: MenuItem) => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  onPointerDragStart?: (e: React.PointerEvent, id: string) => void;
  isDragged?: boolean;

  onOpenMenu?: (x: number, y: number) => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Внутренний отступ карточки группы (между вариантами и по краям). */
export function groupInnerPad(gap: number): number {
  return Math.max(4, Math.round(gap / 2));
}

/**
 * Высота карточки группы из n вариантов в ячейке шириной n колонок.
 * Нужна сеткам, чтобы высота строки равнялась высоте группы —
 * тогда вертикальный зазор между карточками равен горизонтальному.
 */
export function groupCardHeight(
  n: number,
  size: number,
  gap: number,
  textSize: number,
  compact = false
): number {
  const nameSize = compact ? textSize * 0.85 : textSize;
  const pad = groupInnerPad(gap);
  const cellW = n * size + (n - 1) * gap;
  const variantSize = (cellW - 2 * pad - (n - 1) * pad) / n;
  const header = nameSize + 13;
  const label = 4 + nameSize * 1.05 + 2 + nameSize;
  return Math.ceil(header + pad + variantSize + label + pad + 2);
}

function ImagePlaceholder({
  name,
  type,
  color,
  fontSize,
}: {
  name: string;
  type: string;
  color: string | null;
  fontSize: number;
}) {
  if (type === 'sauce') {
    return (
      <div
        className="absolute inset-0"
        style={{ backgroundColor: color ?? '#e5e7eb', opacity: 0.6 }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="font-black text-white drop-shadow-md"
            style={{ fontSize: fontSize * 1.4 }}
          >
            {getInitials(name)}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-orange-400 via-orange-500 to-red-600 flex items-center justify-center">
      <span
        className="font-black text-white/90 drop-shadow-md"
        style={{ fontSize: fontSize * 1.4 }}
      >
        {getInitials(name)}
      </span>
    </div>
  );
}

function ImageSquare({
  src,
  name,
  type,
  color,
  size,
  radius,
  fontSize,
  fluid,
}: {
  src: string | null;
  name: string;
  type: string;
  color: string | null;
  size: number;
  radius: number;
  fontSize: number;
  /** true — квадрат занимает всю ширину родителя (size игнорируется) */
  fluid?: boolean;
}) {
  const isSauce = type === 'sauce';
  return (
    <div
      className="relative overflow-hidden border-2 shadow-md transition-all group-hover:shadow-xl group-hover:-translate-y-0.5 group-active:shadow-sm"
      style={{
        width: fluid ? '100%' : size,
        height: fluid ? undefined : size,
        aspectRatio: fluid ? '1 / 1' : undefined,
        borderRadius: radius,
        borderColor: isSauce ? color ?? '#e5e7eb' : '#ffffff',
        borderWidth: isSauce ? 4 : 2,
      }}
    >
      {src ? (
        <>
          <img
            src={src}
            alt={name}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            loading="lazy"
            draggable={false}
          />
          {!isSauce && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none" />
          )}
        </>
      ) : (
        <ImagePlaceholder
          name={name}
          type={type}
          color={color}
          fontSize={fontSize}
        />
      )}
    </div>
  );
}

// ============================================================
// Хук: ручной «клик» с проверкой, что это не drag
// ============================================================
function useClickOrDrag() {
  const downPos = useRef<{ x: number; y: number; t: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    downPos.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };

  const shouldClick = (e: React.PointerEvent): boolean => {
    if (!downPos.current) return false;
    const dx = e.clientX - downPos.current.x;
    const dy = e.clientY - downPos.current.y;
    const dt = Date.now() - downPos.current.t;
    downPos.current = null;
    // клик = нет движения > 5px И быстрее 500мс
    return Math.hypot(dx, dy) <= 5 && dt < 500;
  };

  return { onPointerDown, shouldClick };
}


// ============================================================
// Стрелки «сдвинуть» — внутри карточки, не перекрывают соседей
// ============================================================
function MoveArrows({
  top,
  canMoveLeft,
  canMoveRight,
  onMoveLeft,
  onMoveRight,
}: {
  top: number;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
}) {
  const cls =
    'absolute z-20 w-6 h-6 -translate-y-1/2 rounded-full border border-slate-300 bg-white/95 text-slate-700 shadow flex items-center justify-center cursor-pointer transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 hover:bg-orange-100 hover:border-orange-400';
  return (
    <>
      {canMoveLeft && (
        <button
          type="button"
          data-no-drag
          onClick={(e) => {
            e.stopPropagation();
            onMoveLeft?.();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`${cls} left-1`}
          style={{ top }}
          title="Сдвинуть влево"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}
      {canMoveRight && (
        <button
          type="button"
          data-no-drag
          onClick={(e) => {
            e.stopPropagation();
            onMoveRight?.();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`${cls} right-1`}
          style={{ top }}
          title="Сдвинуть вправо"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </>
  );
}

// ============================================================
// MenuCard
// ============================================================
export const MenuCard = memo(function MenuCard({
  item,
  variants,
  size,
  textSize,
  compact,
  cardRadius,
  mode = 'view',
  wrapVariants,
  gap = 12,
  onClick,
  onVariantClick,
  onMoveLeft,
  onMoveRight,
  canMoveLeft,
  canMoveRight,
  onPointerDragStart,
  isDragged,
  onOpenMenu,
}: MenuCardProps) {
  const isGroup = (variants?.length ?? 0) > 0;
  const isInactive = !item.active;
  const nameSize = compact ? textSize * 0.85 : textSize;
  const priceSize = compact ? textSize * 0.85 : textSize;
  const { onPointerDown, shouldClick } = useClickOrDrag();

  const onContextMenu = (e: React.MouseEvent) => {
    if (mode !== 'edit' || !onOpenMenu) return;
    e.preventDefault();
    onOpenMenu(e.clientX, e.clientY);
  };

  const MenuButton = onOpenMenu ? (
    <button
      type="button"
      data-no-drag
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onOpenMenu(r.right + 4, r.bottom + 4);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute top-1 right-1 z-30 w-7 h-7 rounded-full bg-white/95 backdrop-blur shadow-md border border-slate-300 text-slate-700 flex items-center justify-center hover:bg-white hover:border-orange-400 hover:text-orange-600 active:scale-95 transition-all"
      title="Действия"
    >
      <MoreVertical className="w-4 h-4" />
    </button>
  ) : null;

  // ---------- Одиночная карточка ----------
  if (!isGroup) {
    return (
      <div
        className={`relative group select-none ${
          isDragged ? 'opacity-40 scale-95' : ''
        } transition-all`}
        style={{ width: size }}
        onContextMenu={onContextMenu}
      >
        <div
          role="button"
          tabIndex={0}
          onPointerDown={(e) => {
            if (mode === 'edit' && onPointerDragStart) {
              onPointerDown(e);
              onPointerDragStart(e, item.id);
            }
          }}
          onPointerUp={(e) => {
            if (mode === 'edit' && shouldClick(e)) {
              onClick(item);
            }
          }}
          onClick={() => {
            if (mode === 'view') onClick(item);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onClick(item);
          }}
          className={`flex flex-col items-center w-full transition-transform ${
            mode === 'edit'
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-pointer active:scale-95'
          }`}
          style={{
            touchAction: mode === 'edit' ? 'manipulation' : undefined,
          }}
        >
          <div className="relative">
            <ImageSquare
              src={
                item.image_url
                  ? item.image_url
                  : item.type === 'set'
                  ? (item.set_main?.variants?.[0]?.image_url ??
                    item.set_main?.image_url ??
                    null)
                  : null
              }
              name={item.name}
              type={item.type}
              color={item.color}
              size={size}
              radius={cardRadius}
              fontSize={nameSize}
            />

            <div className="absolute top-1 left-1 flex flex-col gap-1 pointer-events-none">
              {item.type === 'set' && (
                <span
                  className="font-black bg-purple-600 text-white px-1.5 py-0.5 rounded shadow-md"
                  style={{ fontSize: nameSize * 0.65 }}
                >
                  SET
                </span>
              )}
              {item.free && (
                <span
                  className="font-black bg-green-500 text-white px-1.5 py-0.5 rounded shadow-md"
                  style={{ fontSize: nameSize * 0.65 }}
                >
                  FREE
                </span>
              )}
            </div>

            {isInactive && (
              <div
                className="absolute inset-0 bg-slate-900/65 backdrop-blur-[1px] flex items-center justify-center pointer-events-none"
                style={{ borderRadius: cardRadius }}
              >
                <span
                  className="text-white font-black tracking-wider uppercase"
                  style={{ fontSize: nameSize * 0.75 }}
                >
                  неактивно
                </span>
              </div>
            )}
          </div>

          <div
            className="mt-1 text-center font-black text-slate-800 truncate w-full px-0.5 leading-[1.05]"
            style={{ fontSize: nameSize }}
            title={item.name}
          >
            {item.short_name || item.name}
          </div>

          <div
            className={`mt-0.5 text-center font-black w-full leading-none ${
              item.free
                ? 'text-green-600'
                : item.price > 0
                ? 'text-orange-600'
                : 'text-slate-400'
            }`}
            style={{ fontSize: priceSize }}
          >
            {item.free ? 'FREE' : item.price > 0 ? formatYen(item.price) : '—'}
          </div>
        </div>

        {MenuButton}

        {mode === 'edit' && (
          <MoveArrows
            top={size / 2}
            canMoveLeft={canMoveLeft}
            canMoveRight={canMoveRight}
            onMoveLeft={onMoveLeft}
            onMoveRight={onMoveRight}
          />
        )}
      </div>
    );
  }

  // ---------- Группа ----------
  const headerH = nameSize * 2;
  const innerPad = groupInnerPad(gap);
  const fluidVariants = !wrapVariants;

  return (
    <div
      className={`relative group select-none ${
        isDragged ? 'opacity-40 scale-95' : ''
      } transition-all`}
      style={{ width: '100%' }}
      onContextMenu={onContextMenu}
    >
      <div
        onPointerDown={(e) => {
          if (mode === 'edit' && onPointerDragStart) {
            onPointerDown(e);
            onPointerDragStart(e, item.id);
          }
        }}
        onPointerUp={(e) => {
          if (mode === 'edit' && shouldClick(e)) {
            // клик по варианту → редактируем его, иначе — саму группу
            const vid = (e.target as HTMLElement)
              .closest('[data-variant-id]')
              ?.getAttribute('data-variant-id');
            const v = vid ? variants!.find((x) => x.id === vid) : undefined;
            if (v) {
              if (onVariantClick) onVariantClick(item, v);
              else onClick(v);
            } else {
              onClick(item);
            }
          }
        }}
        onClick={() => {
          if (mode === 'view') onClick(item);
        }}
        className={`bg-slate-200 shadow-md ring-1 ring-slate-400/70 hover:ring-orange-400 flex flex-col overflow-hidden transition-all ${
          isInactive ? 'opacity-70' : ''
        }`}
        style={{
          width: '100%',
          minHeight: wrapVariants
            ? headerH + size + nameSize * 2 + 8
            : undefined,
          borderRadius: cardRadius,
          touchAction: mode === 'edit' ? 'manipulation' : undefined,
        }}
      >
        <button
          onClick={(e) => {
            // в edit-режиме клик обрабатывает контейнер (иначе нельзя тянуть);
            // detail === 0 — активация с клавиатуры
            if (mode === 'view' || e.detail === 0) onClick(item);
          }}
          className="flex items-center justify-between w-full px-2 py-1.5 border-b border-slate-300 bg-gradient-to-r from-slate-300/80 to-slate-300 hover:from-orange-100 hover:to-orange-100 transition-colors shrink-0 leading-none"
          style={{
            borderTopLeftRadius: cardRadius,
            borderTopRightRadius: cardRadius,
          }}
        >
          <span
            className="font-black text-slate-900 tracking-wide truncate text-left leading-none pr-8"
            style={{ fontSize: nameSize }}
          >
            {item.name}
          </span>

          <div className="flex items-center gap-1 shrink-0 ml-1">
            {item.type === 'set' && (
              <span
                className="font-black bg-purple-600 text-white px-1.5 rounded-full leading-none py-0.5"
                style={{ fontSize: nameSize * 0.75 }}
              >
                SET
              </span>
            )}
            <span
              className="font-black bg-orange-500 text-white px-1.5 rounded-full leading-none py-0.5"
              style={{ fontSize: nameSize * 0.75 }}
            >
              ×{variants!.length}
            </span>
            {isInactive && (
              <span
                className="font-black bg-slate-700 text-white px-1.5 rounded-full leading-none py-0.5 uppercase tracking-wider"
                style={{ fontSize: nameSize * 0.75 }}
              >
                off
              </span>
            )}
          </div>
        </button>

        <div
          className={`flex items-stretch ${
            wrapVariants ? 'flex-wrap justify-center p-1' : ''
          }`}
          style={
            wrapVariants
              ? { gap: '0.375rem' }
              : { gap: innerPad, padding: innerPad }
          }
        >
          {variants!.map((v) => (
            <button
              key={v.id}
              data-variant-id={v.id}
              onClick={(e) => {
                // ✅ ФИКС: останавливаем всплытие клика, иначе он долетит
                // до контейнера карточки и снова вызовет onClick(item)
                e.stopPropagation();

                if (mode !== 'view' && e.detail !== 0) return;
                if (onVariantClick) onVariantClick(item, v);
                else onClick(v);
              }}
              style={
                fluidVariants
                  ? { flex: '1 1 0', minWidth: 0 }
                  : { width: size, flex: '0 0 auto' }
              }
              className="group/v flex flex-col items-center active:scale-95 transition-transform"
            >
              <ImageSquare
                src={v.image_url || item.image_url}
                name={v.name}
                type="dish"
                color={null}
                size={size}
                fluid={fluidVariants}
                radius={cardRadius}
                fontSize={nameSize}
              />
              <div
                className="mt-1 text-center font-black text-slate-800 truncate w-full px-0.5 leading-[1.05]"
                style={{ fontSize: nameSize }}
                title={v.name}
              >
                {v.name}
              </div>
              <div
                className={`mt-0.5 text-center font-black w-full leading-none ${
                  v.free ? 'text-green-600' : 'text-orange-600'
                }`}
                style={{ fontSize: priceSize }}
              >
                {v.free ? 'FREE' : formatYen(v.price)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {MenuButton}

      {mode === 'edit' && (
          <MoveArrows
            top={headerH + 4 + size / 2}
            canMoveLeft={canMoveLeft}
            canMoveRight={canMoveRight}
            onMoveLeft={onMoveLeft}
            onMoveRight={onMoveRight}
          />
        )}
    </div>
  );
});
