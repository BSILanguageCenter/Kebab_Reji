/* eslint-disable react-refresh/only-export-components */
import { memo, useEffect, useRef, useState } from 'react';
import { MoreVertical, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatYen } from '@/locale/format';
import { useI18n } from '@/locale';
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
  /** Группа рисуется ОДНОЙ иконкой (клик → окно выбора блюда, затем свойства) */
  singleIcon?: boolean;
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

/** Фиолетовый — цвет сетов (рамка вокруг иконки/карточки). */
const FLIP_MS = 700;
const FLIP_EVERY_MS = 7000;

/** Картинки блюд внутри группы/сета (нужно ≥2, иначе пусто). */
export function collectFlipImages(
  item: MenuItem,
  variants?: MenuItem[]
): string[] {
  const uniq = (a: (string | null | undefined)[]) =>
    Array.from(new Set(a.filter((x): x is string => Boolean(x))));
  let imgs = uniq((variants ?? []).map((v) => v.image_url));
  if (imgs.length < 2 && item.type === 'set') {
    imgs = uniq(item.set_main?.variants?.map((v) => v.image_url) ?? []);
  }
  return imgs.length > 1 ? imgs : [];
}

/**
 * Несколько картинок в одной иконке: каждые 7 секунд страница
 * «перелистывается», как в книге, и открывается следующая картинка.
 */
export function FlipImage({ images, alt }: { images: string[]; alt: string }) {
  const n = images.length;
  const [idx, setIdx] = useState(0);
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    if (n < 2) return;
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let tick: number | undefined;
    let done: number | undefined;
    const run = () => {
      if (document.hidden) return;
      if (reduce) {
        setIdx((i) => (i + 1) % n);
        return;
      }
      setFlipping(true);
      done = window.setTimeout(() => {
        setIdx((i) => (i + 1) % n);
        setFlipping(false);
      }, FLIP_MS);
    };
    // небольшой случайный сдвиг, чтобы карточки не листались хором
    const first = window.setTimeout(() => {
      run();
      tick = window.setInterval(run, FLIP_EVERY_MS);
    }, Math.random() * 1200);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(tick);
      window.clearTimeout(done);
    };
  }, [n]);

  const cur = idx % n;
  const next = (cur + 1) % n;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ perspective: 900 }}
    >
      {/* следующая картинка — лежит под страницей */}
      <img
        src={images[next]}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />
      {flipping && <div className="page-flip-under absolute inset-0 bg-black" />}
      {/* текущая «страница» */}
      <div
        className={`absolute inset-0 ${flipping ? 'page-flip' : ''}`}
        style={{ transformOrigin: 'left center', backfaceVisibility: 'hidden' }}
      >
        <img
          src={images[cur]}
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
        {flipping && (
          <div className="page-flip-shade absolute inset-0 bg-gradient-to-l from-black/50 via-transparent to-transparent" />
        )}
      </div>
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
  images,
  accent,
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
  /** несколько картинок — листаются каждые 3 секунды */
  images?: string[];
  /** цвет рамки (фиолетовый у сетов) */
  accent?: string;
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
        borderColor: accent
          ? accent
          : isSauce
          ? color ?? '#e5e7eb'
          : 'var(--card-ring, #ffffff)',
        borderWidth: accent ? 3 : isSauce ? 4 : 2,
      }}
    >
      {src || (images && images.length > 0) ? (
        <>
          {images && images.length > 1 ? (
            <FlipImage images={images} alt={name} />
          ) : (
            <img
              src={src ?? images![0]}
              alt={name}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              loading="lazy"
              draggable={false}
            />
          )}
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
  const { t } = useI18n();
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
          title={t('shiftLeft')}
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
          title={t('shiftRight')}
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
  singleIcon,
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
  const { t } = useI18n();
  const groupCount = variants?.length ?? 0;
  const isGroup = groupCount > 0 && !singleIcon;
  const isSingleGroup = groupCount > 0 && Boolean(singleIcon);
  const groupMinPrice = isSingleGroup
    ? Math.min(...variants!.filter((v) => !v.free).map((v) => v.price), Infinity)
    : Infinity;
  const shownPrice =
    item.price > 0 ? item.price : Number.isFinite(groupMinPrice) ? groupMinPrice : 0;
  const isInactive = !item.active;
  const nameSize = compact ? textSize * 0.85 : textSize;
  const priceSize = compact ? textSize * 0.85 : textSize;
  const { onPointerDown, shouldClick } = useClickOrDrag();

  // Одна иконка у группы/сета с несколькими блюдами: картинки листаются
  const flipImages: string[] = isSingleGroup
    ? collectFlipImages(item, variants)
    : [];

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
      title={t('actions')}
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
                  : isSingleGroup
                  ? (variants![0]?.image_url ?? null)
                  : null
              }
              images={flipImages.length > 1 ? flipImages : undefined}
              name={item.name}
              type={item.type}
              color={item.color}
              size={size}
              radius={cardRadius}
              fontSize={nameSize}
            />

            {item.type === 'set' && (
              <div
                aria-hidden
                className="absolute inset-0 z-10 pointer-events-none border-2 border-orange-500"
                style={{ borderRadius: cardRadius }}
              />
            )}

            {isSingleGroup && (
              <span
                className="absolute top-1.5 left-1.5 font-black bg-orange-500 text-white px-1.5 py-0.5 rounded-md shadow-md pointer-events-none leading-none"
                style={{ fontSize: nameSize * 0.75 }}
              >
                ×{groupCount}
              </span>
            )}

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
            className={`mt-1 text-center font-black truncate w-full px-0.5 leading-[1.05] ${
              item.type === 'set'
                ? 'bg-orange-500 text-white rounded-md py-0.5 shadow-sm'
                : item.free
                ? 'text-green-600'
                : 'text-slate-800'
            }`}
            style={{ fontSize: nameSize }}
            title={item.name}
          >
            {item.short_name || item.name}
          </div>

          <div
            className={`mt-0.5 text-center font-black w-full leading-none ${
              shownPrice > 0 ? 'text-orange-600' : 'text-slate-400'
            }`}
            style={{ fontSize: priceSize }}
          >
            {item.free
              ? '\u00A0'
              : shownPrice > 0
              ? `${isSingleGroup && item.price <= 0 ? (t('fromPrefix')) : ''}${formatYen(shownPrice)}`
              : '—'}
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
        className={`bg-slate-200 shadow-md hover:ring-orange-400 flex flex-col overflow-hidden transition-all ${
          item.type === 'set'
            ? 'ring-2 ring-orange-500'
            : 'ring-1 ring-slate-400/70'
        } ${isInactive ? 'opacity-70' : ''}`}
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
          className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center w-full py-1.5 border-b transition-colors shrink-0 leading-none ${
            item.type === 'set'
              ? 'border-orange-600 bg-orange-500 hover:bg-orange-600'
              : 'border-slate-300 bg-gradient-to-r from-slate-300/80 to-slate-300 hover:from-orange-100 hover:to-orange-100'
          }`}
          style={{
            borderTopLeftRadius: cardRadius,
            borderTopRightRadius: cardRadius,
            // отступ растёт вместе со скруглением — текст не заходит в угол
            paddingInline: Math.max(8, Math.round(cardRadius * 0.75)),
            columnGap: 4,
          }}
        >
          {/* слева — бейджи, по центру — название, справа — место под меню «⋮» */}
          <div className="flex items-center gap-1 justify-start min-w-0 overflow-hidden">
            {isInactive && (
              <span
                className="font-black bg-slate-700 text-white px-1.5 rounded-full leading-none py-0.5 uppercase tracking-wider"
                style={{ fontSize: nameSize * 0.75 }}
              >
                off
              </span>
            )}
          </div>

          <span
            className={`font-black tracking-wide text-center leading-none truncate min-w-0 max-w-full ${
              item.type === 'set' ? 'text-white' : 'text-slate-900'
            }`}
            style={{ fontSize: nameSize }}
            title={item.name}
          >
            {item.name}
          </span>

          <div aria-hidden className="min-w-0" />
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
                className={`mt-1 text-center font-black truncate w-full px-0.5 leading-[1.05] ${
                  v.free ? 'text-green-600' : 'text-slate-800'
                }`}
                style={{ fontSize: nameSize }}
                title={v.name}
              >
                {v.name}
              </div>
              <div
                className="mt-0.5 text-center font-black w-full leading-none text-orange-600"
                style={{ fontSize: priceSize }}
              >
                {v.free ? '\u00A0' : formatYen(v.price)}
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
