// src/pages/Manager/MenuProduct.tsx
import { uuid } from '@/lib/uuid';
import {
  BottomPanelCats,
  SidePanelCats,
  splitPanelCats,
  getPlace,
  setPlace,
  type PanelCat,
  type PanelPlace,
} from '@/components/CategoryPanels';
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useLayoutEffect,
} from 'react';
import {
  fetchAllMenuItems,
  createItem,
  updateItem,
  deleteItem,
  reorderItems,
  uploadItemImage,
  duplicateItem,
  type SaveItemPayload,
  type VariantDraftPayload,
  type SetExtraGroupPayload,
  type AddonPick,
  type PropertyDraftPayload,
} from '@/services/menu';
import { pickSingleOption } from '@/lib/menuMigrations';
import { saveStyle, type SavedStyle } from '@/services/layoutStyle';
import { formatYen, formatTimeAgo } from '@/locale/format';
import { useI18n, type TranslationKey } from '@/locale';
import { subscribeOrders } from '@/lib/localStore';
import { Resizer } from '@/components/Resizer';
import { PanelSettings } from '@/components/PanelSettings';
import { FloatingWindow } from '@/components/FloatingWindow';
import { SaveStyleDialog } from '@/components/SaveStyleDialog';
import { LoadStyleDialog } from '@/components/LoadStyleDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ImageCropDialog } from '@/components/ImageCropDialog';
import { MenuCard, groupCardHeight } from '@/components/MenuCard';
import { slotOf, patchSlots } from '@/lib/menuOrder';
import { useViewport } from '@/lib/useViewport';
import {
  MenuCardMenu,
  type MenuCardMenuState,
} from '@/components/MenuCardMenu';
import { PageActions } from '@/components/PageActions';
import { useViewPrefs, getViewPrefs } from '@/lib/viewPrefs';
import {
  GroupViewToggle,
  OrdersHeaderButton,
  HeaderToggleButton,
} from '@/components/ViewToggles';
import {
  useLayoutSettings,
  clampLayout,
  snapValue,
  fitColumns,
  DEFAULT_LAYOUT,
  getStoredLayout,
  applyExternalLayout,
  type LayoutSettings,
} from '@/lib/layoutSettings';
import type {
  MenuItem,
  MenuItemType,
  Station,
  DishKind,
  SauceMode,
  HydratedProperty,
  HydratedSauce,
  Order,
} from '@/types/database';
import {
  Plus,
  Minus,
  Send,
  Trash2,
  X,
  Upload,
  UtensilsCrossed,
  Package,
  CupSoda,
  Droplet,
  Sparkles,
  Save,
  Download,
  Cloud,
  Check,
  Settings,
  Pin,
  PinOff,
  ChevronsUpDown,
  ChevronsDownUp,
  Eye,
  EyeOff,
  LayoutGrid,
  ArrowLeft,
} from 'lucide-react';
import { ProductsPage } from './ProductsPage';
import { SendToKitchenButton } from '@/components/SendToKitchenButton';

// ============================================================
// ПРОСТРАНСТВО КАТЕГОРИЙ
// ============================================================
type CategorySpace = 'dishset' | 'drink' | 'sauce' | 'topping';

const CAT_STYLE: Record<CategorySpace, { on: string; off: string }> = {
  dishset: {
    on: 'bg-orange-500 text-white border-orange-500',
    off: 'bg-white text-orange-700 border-orange-200',
  },
  drink: {
    on: 'bg-cyan-600 text-white border-cyan-600',
    off: 'bg-white text-cyan-700 border-cyan-200',
  },
  sauce: {
    on: 'bg-red-600 text-white border-red-600',
    off: 'bg-white text-red-700 border-red-200',
  },
  topping: {
    on: 'bg-purple-600 text-white border-purple-600',
    off: 'bg-white text-purple-700 border-purple-200',
  },
};

function getSpaceOfType(type: MenuItemType): CategorySpace {
  if (type === 'dish' || type === 'set') return 'dishset';
  return type as CategorySpace;
}

function getSpaceItems(tops: MenuItem[], space: CategorySpace): MenuItem[] {
  if (space === 'dishset') {
    return tops.filter((i) => i.type === 'dish' || i.type === 'set');
  }
  return tops.filter((i) => i.type === space);
}

/**
 * Сколько ячеек занимает карточка. В режиме «одна иконка» любая группа —
 * ровно 1 ячейка (и для отрисовки, и для проверки «свободно / занято»,
 * перетаскивания, обмена местами и стрелок).
 */
function getItemWidth(item: MenuItem): number {
  if (getViewPrefs().groupView === 'single') return 1;
  if (item.type === 'dish' && item.dish_kind === 'group') {
    return Math.max(1, item.variants?.length ?? 1);
  }
  if (item.type === 'set' && item.set_main?.dish_kind === 'group') {
    return Math.max(1, item.set_main.variants?.length ?? 1);
  }
  return 1;
}

/** Ширина для ОТРИСОВКИ (в режиме «одна иконка» группа занимает 1 клетку). */
function getRenderWidth(item: MenuItem, single: boolean): number {
  return single ? 1 : getItemWidth(item);
}

const EMPTY_ROWS_AFTER = 3;

/** Больше этого номера слот считается «битым» (например, остался временный слот обмена) */
const MAX_SANE_SLOT = 5000;

function isBrokenSlot(n: number): boolean {
  return !Number.isFinite(n) || n < 0 || n > MAX_SANE_SLOT;
}

function hasSortConflicts(tops: MenuItem[]): boolean {
  const spaces: CategorySpace[] = ['dishset', 'drink', 'sauce', 'topping'];
  for (const sp of spaces) {
    const seen = new Set<number>();
    for (const it of tops) {
      if (getSpaceOfType(it.type) !== sp) continue;
      if (isBrokenSlot(slotOf(it))) return true;
      if (seen.has(slotOf(it))) return true;
      seen.add(slotOf(it));
    }
  }
  return false;
}

/**
 * Бережно исправляет ТОЛЬКО конфликтующие позиции (две карточки в одной
 * ячейке или «битый» слот): остальные карточки не двигаются.
 * Раньше при любом конфликте всё меню пересобиралось заново
 * (одиночные блюда → группы → остальное) и твоя расстановка пропадала.
 */
function resolveSlotConflicts(
  tops: MenuItem[]
): { id: string; sort_order: number }[] {
  const updates: { id: string; sort_order: number }[] = [];
  const spaces: CategorySpace[] = ['dishset', 'drink', 'sauce', 'topping'];

  for (const sp of spaces) {
    const items = tops
      .filter((it) => getSpaceOfType(it.type) === sp)
      .sort((a, b) => {
        const sa = isBrokenSlot(slotOf(a)) ? Number.MAX_SAFE_INTEGER : slotOf(a);
        const sb = isBrokenSlot(slotOf(b)) ? Number.MAX_SAFE_INTEGER : slotOf(b);
        return sa - sb;
      });

    const seen = new Set<number>();
    let end = 0;
    for (const it of items) {
      if (isBrokenSlot(slotOf(it))) continue;
      end = Math.max(end, slotOf(it) + getItemWidth(it));
    }

    for (const it of items) {
      const slot = slotOf(it);
      if (!isBrokenSlot(slot) && !seen.has(slot)) {
        seen.add(slot);
        continue;
      }
      // конфликт — переносим карточку в конец, остальные не трогаем
      updates.push({ id: it.id, sort_order: end });
      seen.add(end);
      end += getItemWidth(it);
    }
  }
  return updates;
}

function isRangeFree(
  spaceItems: MenuItem[],
  start: number,
  width: number,
  excludeId: string
): boolean {
  if (start < 0) return false;
  const end = start + width - 1;
  for (const it of spaceItems) {
    if (it.id === excludeId) continue;
    const w = getItemWidth(it);
    const iStart = slotOf(it);
    const iEnd = iStart + w - 1;
    if (iEnd >= start && iStart <= end) return false;
  }
  return true;
}

function isRangeFreeMulti(
  spaceItems: MenuItem[],
  start: number,
  width: number,
  excludeIds: Set<string>
): boolean {
  if (start < 0) return false;
  const end = start + width - 1;
  for (const it of spaceItems) {
    if (excludeIds.has(it.id)) continue;
    const w = getItemWidth(it);
    const iStart = slotOf(it);
    const iEnd = iStart + w - 1;
    if (iEnd >= start && iStart <= end) return false;
  }
  return true;
}

function fitsInRow(start: number, width: number, cols: number): boolean {
  if (start < 0) return false;
  if (width >= cols) return start % cols === 0;
  return (start % cols) + width <= cols;
}

function isPlaceable(
  spaceItems: MenuItem[],
  start: number,
  width: number,
  excludeId: string,
  cols: number
): boolean {
  return (
    fitsInRow(start, width, cols) &&
    isRangeFree(spaceItems, start, width, excludeId)
  );
}

function getSafeTempSlot(spaceItems: MenuItem[]): number {
  let maxEnd = 0;
  for (const it of spaceItems) {
    maxEnd = Math.max(maxEnd, slotOf(it) + getItemWidth(it));
  }
  return maxEnd + 100000;
}

function findNearestFreeSlot(
  spaceItems: MenuItem[],
  target: number,
  width: number,
  excludeId: string,
  cols: number
): number {
  const tr = Math.floor(target / cols);
  const tc = target % cols;

  let maxSlot = 0;
  for (const it of spaceItems) {
    maxSlot = Math.max(maxSlot, slotOf(it) + getItemWidth(it));
  }
  const limit = maxSlot + width + cols * 2;

  let best = -1;
  let bestD = Infinity;
  for (let s = 0; s <= limit; s++) {
    if (!isPlaceable(spaceItems, s, width, excludeId, cols)) continue;
    const dr = Math.floor(s / cols) - tr;
    const dc = (s % cols) - tc;
    const d = dr * dr + dc * dc;
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

function useGridCols(
  ref: React.RefObject<HTMLDivElement | null>,
  size: number,
  gap: number
): number {
  // 0 — сетка ещё не измерена (не путать с реальной одной колонкой)
  const [cols, setCols] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const c = Math.max(1, Math.floor((w + gap) / (size + gap)));
      setCols((prev) => (prev === c ? prev : c));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, size, gap]);

  return cols;
}

/** Ширина области сетки (px); 0 — ещё не измерена */
function useGridWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW((prev) => (prev === el.clientWidth ? prev : el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

type LayoutCell = {
  row: number;
  col: number;
  width: number;
  slot: number;
  item: MenuItem | null;
};

function buildRenderLayout(
  items: MenuItem[],
  cols: number,
  minEmptyRows: number,
  single = false
): LayoutCell[] {
  const cells: LayoutCell[] = [];
  const occupied = new Set<number>();
  let maxRow = 0;

  for (const it of items) {
    const w = getRenderWidth(it, single);
    const span = Math.min(w, cols);

    const row = Math.min(Math.floor(slotOf(it) / cols), 59);
    let col = slotOf(it) % cols;
    if (col + span > cols) col = cols - span;

    for (let k = 0; k < span; k++) {
      occupied.add(row * cols + (col + k));
    }
    maxRow = Math.max(maxRow, row);

    cells.push({ row, col, width: span, slot: slotOf(it), item: it });
  }

  // защита: никогда не рисуем больше ~60 строк пустых ячеек
  const totalRows = Math.min(maxRow + 1 + minEmptyRows, 60);
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < cols; c++) {
      const slot = r * cols + c;
      if (occupied.has(slot)) continue;
      cells.push({ row: r, col: c, width: 1, slot, item: null });
    }
  }

  return cells;
}

const COLS_KEY_M = {
  dishset: 'gridColsDishset',
  drink: 'gridColsDrink',
  sauce: 'gridColsSauce',
  topping: 'gridColsTopping',
} as const;

function GridSpace({
  space,
  size: baseSize,
  fitStoredCols = 0,
  sizeKey = '',
  compact,
  allTops,
  draggedId,
  dragOverSlot,
  startEdit,
  startPointerDrag,
  canMoveItem,
  moveItemByOne,
  registerCols,
  textSize,
  layout,
  onOpenCardMenu,
}: {
  space: CategorySpace;
  size: number;
  /** >0: число колонок зафиксировано, карточки подгоняются по ширине (открыты «Заказы») */
  fitStoredCols?: number;
  /** Меняется, когда пользователь меняет размер карточки/отступ — тогда число колонок измеряется заново */
  sizeKey?: string;
  compact: boolean;
  allTops: MenuItem[];
  draggedId: string | null;
  dragOverSlot: { space: CategorySpace; slot: number } | null;
  setDragOverSlot: (
    v: { space: CategorySpace; slot: number } | null
  ) => void;
  handleSlotDrop: (space: CategorySpace, slot: number, cols: number) => void;
  startEdit: (item: MenuItem) => void;
  startPointerDrag: (e: React.PointerEvent, id: string) => void;
  canMoveItem: (item: MenuItem, direction: -1 | 1, cols: number) => boolean;
  moveItemByOne: (item: MenuItem, direction: -1 | 1, cols: number) => void;
  registerCols: (space: CategorySpace, cols: number) => void;
  textSize: number;
  layout: LayoutSettings;
  onOpenCardMenu?: (x: number, y: number, item: MenuItem) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const measuredCols = useGridCols(gridRef, baseSize, layout.gridGap);
  const gridW = useGridWidth(gridRef);

  // Число колонок сетки — «логическое» и хранится в стиле: расстановка одинакова на
  // любом экране (планшет, монитор, с «Заказами» и без). Карточки подгоняются под
  // доступную ширину пропорционально — на большом экране крупнее, на малом мельче.
  // Заново число колонок измеряем только когда меняют размер карточки/отступ в настройках
  // (или если оно ещё не сохранено).
  const fitted = fitStoredCols > 0 && gridW > 0;
  const cols = fitted ? fitStoredCols : Math.max(1, measuredCols);
  const size = fitted
    ? Math.min(
        Math.round(baseSize * 1.6),
        Math.max(24, Math.floor((gridW + layout.gridGap) / fitStoredCols - layout.gridGap))
      )
    : baseSize;

  const measuredRef = useRef(0);
  measuredRef.current = measuredCols;
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (fitStoredCols <= 0 && measuredCols > 0) registerCols(space, measuredCols);
  }, [space, measuredCols, registerCols, fitStoredCols]);

  const seenStoredRef = useRef(fitStoredCols);
  useEffect(() => {
    const prev = lastKeyRef.current;
    lastKeyRef.current = sizeKey;
    // если вместе с размером поменялось и число колонок — это загрузка готового стиля
    // (из Supabase): оставляем его колонки как есть, не пересчитываем под этот экран
    const styleLoaded = seenStoredRef.current !== fitStoredCols;
    if (prev === null || prev === sizeKey || styleLoaded) return;
    const id = window.setTimeout(() => {
      if (measuredRef.current > 0) registerCols(space, measuredRef.current);
    }, 200);
    return () => window.clearTimeout(id);
  }, [sizeKey, space, registerCols, fitStoredCols]);
  useEffect(() => {
    seenStoredRef.current = fitStoredCols;
  });

  const spaceItems = useMemo(
    () => getSpaceItems(allTops, space),
    [allTops, space]
  );

  const [viewPrefs] = useViewPrefs();
  const singleGroups = viewPrefs.groupView === 'single';

  const cells = useMemo(
    () => buildRenderLayout(spaceItems, cols, EMPTY_ROWS_AFTER, singleGroups),
    [spaceItems, cols, singleGroups]
  );

  const gap = layout.gridGap;
  let cellH = Math.round(
    size + (compact ? 32 : 50) * (layout.itemTextSize / 12)
  );
  // строка должна вмещать самую высокую группу — тогда зазоры равны
  for (const it of spaceItems) {
    const w = getRenderWidth(it, singleGroups);
    if (w > 1) {
      cellH = Math.max(
        cellH,
        groupCardHeight(
          Math.min(w, cols),
          size,
          gap,
          layout.itemTextSize,
          compact
        )
      );
    }
  }

  const highlightSlot =
    dragOverSlot?.space === space ? dragOverSlot.slot : null;

  const draggedItem = draggedId
    ? allTops.find((i) => i.id === draggedId)
    : null;
  const dragW = draggedItem ? Math.min(getItemWidth(draggedItem), cols) : 1;

  return (
    <div
      ref={gridRef}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${size}px)`,
        gridAutoRows: `${cellH}px`,
        gap,
        width: '100%',
        justifyContent: 'start',
      }}
    >
      {cells.map((cell) => {
        const key = cell.item ? cell.item.id : `empty-${cell.slot}`;

        if (!cell.item) {
          const isHighlightedEmpty =
            highlightSlot !== null &&
            cell.slot >= highlightSlot &&
            cell.slot < highlightSlot + dragW &&
            Math.floor(cell.slot / cols) === Math.floor(highlightSlot / cols);

          return (
            <div
              key={key}
              data-slot-space={space}
              data-slot-index={cell.slot}
              style={{
                gridRowStart: cell.row + 1,
                gridColumnStart: cell.col + 1,
                gridColumnEnd: `span ${cell.width}`,
                touchAction: 'manipulation',
                borderRadius: layout.cardRadius,
              }}
              className={`border-2 border-dashed transition-all ${
                isHighlightedEmpty
                  ? 'border-orange-400 bg-orange-100 scale-[1.03]'
                  : 'border-slate-200/70 bg-transparent'
              }`}
            />
          );
        }

        const card = cell.item;
        const isHighlighted = highlightSlot === slotOf(card);
        const isDragged = draggedId === card.id;

        let variants: MenuItem[] | undefined;
        if (card.type === 'dish' && card.dish_kind === 'group') {
          variants = card.variants;
        } else if (
          card.type === 'set' &&
          card.set_main?.dish_kind === 'group'
        ) {
          variants = card.set_main.variants;
        }

        const canLeft = canMoveItem(card, -1, cols);
        const canRight = canMoveItem(card, 1, cols);

        return (
          <div
            key={key}
            data-slot-space={space}
            data-slot-index={slotOf(card)}
            style={{
              gridRowStart: cell.row + 1,
              gridColumnStart: cell.col + 1,
              gridColumnEnd: `span ${cell.width}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: isDragged ? 'none' : undefined,
              touchAction: 'manipulation',
              opacity: isDragged ? 0.4 : 1,
              transform: isDragged ? 'scale(0.95) rotate(-2deg)' : undefined,
              transition: 'opacity 0.15s, box-shadow 0.15s, transform 0.15s',
            }}
            className={`${
              isHighlighted
                ? 'ring-4 ring-orange-400 ring-offset-2 bg-orange-50/60'
                : ''
            }`}
          >
            <MenuCard
              mode="edit"
              item={card}
              variants={variants}
              singleIcon={singleGroups}
              onClick={startEdit}
              onVariantClick={(_parent, v) => {
                if (card.type === 'dish') startEdit(v);
                else startEdit(card);
              }}
              onEdit={startEdit}
              onPointerDragStart={startPointerDrag}
              onMoveLeft={() => moveItemByOne(card, -1, cols)}
              onMoveRight={() => moveItemByOne(card, 1, cols)}
              canMoveLeft={canLeft}
              canMoveRight={canRight}
              size={size}
              textSize={textSize}
              compact={compact}
              gap={gap}
              cardRadius={layout.cardRadius}
              isDragged={isDragged}
              onOpenMenu={
                onOpenCardMenu
                  ? (x, y) => onOpenCardMenu(x, y, card)
                  : undefined
              }
            />
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// ОБРАЗЕЦ КОРЗИНЫ (правая колонка, как в кассе — только пример)
// ============================================================
const SAMPLE_CART: {
  id: string;
  name: string;
  variant?: string;
  options: { name: string; price: number }[];
  qty: number;
  price: number;
}[] = [
  {
    id: 'c1',
    name: 'Шаурма классик',
    variant: 'L',
    options: [
      { name: 'Сыр', price: 50 },
      { name: 'Халапеньо', price: 30 },
    ],
    qty: 2,
    price: 350,
  },
  { id: 'c2', name: 'Кола', options: [], qty: 1, price: 150 },
];

// Примеры заказов: показываются в левой колонке, когда реальных заказов нет
const SAMPLE_ORDERS: {
  id: string;
  number: number;
  status: string;
  total: number;
  time: string;
  sample: boolean;
  items: string[];
}[] = [
  { id: 's1', number: 14, status: 'NEW', total: 420, time: 'только что', sample: true, items: ['2× Шаурма классик'] },
  { id: 's2', number: 13, status: 'READY', total: 1200, time: '1 мин', sample: true, items: ['1× Шаурма сыр', '2× Кола', '1× Фри'] },
  { id: 's3', number: 12, status: 'PREPARING', total: 850, time: '3 мин', sample: true, items: ['2× Донер'] },
];

/**
 * Образец корзины — ТОЧНАЯ копия корзины кассы (CashierPage → cartInner):
 * те же размеры, отступы, кнопки и масштаб `cz()` от ширины колонки.
 * Здесь это просто макет без логики, чтобы видеть реальный вид и ширину.
 */
function CartSample({
  cartItemGap,
  cartWidth,
  ui,
}: {
  cartItemGap: number;
  cartWidth: number;
  ui: number;
}) {
  const { t } = useI18n();

  // Тот же расчёт масштаба, что и в кассе (desktop)
  const cartBase = 340 * ui;
  const cs = Math.min(1.1, Math.max(0.8, cartWidth / cartBase));
  const cz = (n: number) => Math.round(n * cs * ui * 10) / 10;
  const btn = cz(34);

  const lineTotal = (c: (typeof SAMPLE_CART)[number]) =>
    (c.price + c.options.reduce((s, o) => s + o.price, 0)) * c.qty;
  const total = SAMPLE_CART.reduce((s, c) => s + lineTotal(c), 0);

  return (
    <>
      <div className="px-4 py-3 border-b shrink-0 border-slate-200">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-black text-slate-900 truncate">
            {t('currentOrder')}
          </h2>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto p-1.5 bg-slate-50 flex flex-col"
        style={{ rowGap: cartItemGap }}
      >
        {SAMPLE_CART.map((c) => (
          <div
            key={c.id}
            className="rounded-xl border shadow-sm bg-white border-slate-200"
            style={{ padding: cz(8) }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div
                  className="font-bold text-slate-900 leading-tight"
                  style={{ fontSize: cz(13) }}
                >
                  {c.name}
                  {c.variant && (
                    <span className="ml-1 text-orange-600">{c.variant}</span>
                  )}
                </div>
              </div>
              <div
                style={{ width: btn, height: btn }}
                className="flex items-center justify-center rounded-lg text-slate-400 shrink-0"
              >
                <Trash2 style={{ width: cz(16), height: cz(16) }} />
              </div>
            </div>

            {c.options.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {c.options.map((o, i) => (
                  <span
                    key={i}
                    className="rounded bg-orange-100 text-orange-800 font-bold leading-none"
                    style={{
                      fontSize: cz(10),
                      padding: `${cz(3)}px ${cz(6)}px`,
                    }}
                  >
                    + {o.name}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 mt-1.5">
              <div className="flex items-center gap-1">
                <div
                  style={{ width: btn, height: btn }}
                  className="rounded-lg bg-slate-100 flex items-center justify-center"
                >
                  <Minus style={{ width: cz(16), height: cz(16) }} />
                </div>
                <span
                  className="font-black text-center tabular-nums"
                  style={{ fontSize: cz(16), width: cz(28) }}
                >
                  {c.qty}
                </span>
                <div
                  style={{ width: btn, height: btn }}
                  className="rounded-lg bg-orange-100 flex items-center justify-center text-orange-700"
                >
                  <Plus style={{ width: cz(16), height: cz(16) }} />
                </div>
              </div>
              <span
                className="font-black tabular-nums text-slate-900"
                style={{ fontSize: cz(14) }}
              >
                {formatYen(lineTotal(c))}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-slate-200 space-y-3 bg-white shrink-0 shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.2)]">
        <div className="flex items-end justify-between">
          <span className="text-sm font-bold text-slate-500">{t('total')}</span>
          <span className="text-3xl font-black text-slate-900 tabular-nums leading-none">
            {formatYen(total)}
          </span>
        </div>

        <SendToKitchenButton
          icon={<Send className="w-5 h-5" />}
          label={t('sendToKitchen')}
        />

        <div className="w-full py-2.5 text-xs text-slate-500 font-bold text-center">
          {t('clearAll')}
        </div>
      </div>
    </>
  );
}

export function MenuProduct() {
  const { t, lang } = useI18n();
  const [viewPrefs, setViewPrefs] = useViewPrefs();
  const [items, setItems] = useState<MenuItem[]>([]);
  const itemsRef = useRef<MenuItem[]>([]);
  itemsRef.current = items;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickingType, setPickingType] = useState(false);
  // Отдельная страница «Продукты» (список по категориям: добавить / изменить)
  const [productsPage, setProductsPage] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [formType, setFormType] = useState<MenuItemType | null>(null);


  const [pendingDelete, setPendingDelete] = useState<MenuItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [cardMenu, setCardMenu] = useState<MenuCardMenuState | null>(null);

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<{
    space: CategorySpace;
    slot: number;
  } | null>(null);

  // ---------- Orders State (для левой колонки) ----------
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);

  // ---------- Style sync (Supabase) ----------
  const [styleSyncing, setStyleSyncing] = useState<'idle' | 'saving'>('idle');
  const [styleError, setStyleError] = useState<string | null>(null);
  const [styleNotice, setStyleNotice] = useState<string | null>(null);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);

  const pointerDragRef = useRef<{
    id: string | null;
    pointerId: number;
    startX: number;
    startY: number;
    activated: boolean;
    longPressTimer: number | null;
    targetSpace: CategorySpace | null;
    targetSlot: number | null;
  } | null>(null);

  const [rawLayout, setLayout] = useLayoutSettings();
  const { scale: ui, device, width: vw } = useViewport();
  const isDesktop = device === 'desktop';

  // Только для не-desktop режима (там остаются вкладки категорий)
  const [activeCat, setActiveCat] = useState<CategorySpace>('dishset');

  const drinksWrapRef = useRef<HTMLDivElement>(null);
  const leftWrapRef = useRef<HTMLDivElement>(null);
  const desktopAreaRef = useRef<HTMLDivElement>(null);

  // ---------- Перенос панели категории: зажать заголовок и бросить в зону ----------
  const [panelDrag, setPanelDrag] = useState<{
    cat: PanelCat;
    x: number;
    y: number;
    over: PanelPlace | null;
  } | null>(null);

  const centerRef = useRef<HTMLDivElement>(null);
  type ZoneRect = { x: number; y: number; w: number; h: number };
  /** Реальные места панелей (в координатах окна); функция обновляется на каждом рендере */
  const zoneFnRef = useRef<() => Record<PanelPlace, ZoneRect> | null>(() => null);

  /** В какую зону попал указатель */
  const zoneAt = useCallback((x: number, y: number): PanelPlace | null => {
    const z = zoneFnRef.current();
    if (!z) return null;
    for (const place of ['left', 'right', 'bottom'] as const) {
      const r = z[place];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return place;
    }
    return null;
  }, []);

  const dragAbortRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragAbortRef.current?.(), []);

  const startPanelDrag = useCallback(
    (cat: PanelCat, e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const sx = e.clientX;
      const sy = e.clientY;
      let active = false;
      let over: PanelPlace | null = null;

      const cleanup = () => {
        window.clearTimeout(timer);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        if (active) {
          document.body.style.userSelect = '';
          document.body.style.cursor = '';
        }
      };
      // удержание ~0.35 с включает режим переноса
      const timer = window.setTimeout(() => {
        active = true;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
        over = zoneAt(sx, sy);
        setPanelDrag({ cat, x: sx, y: sy, over });
      }, 350);

      const onMove = (ev: PointerEvent) => {
        if (!active) {
          // сдвинулись раньше времени — это не перенос
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) cleanup();
          return;
        }
        over = zoneAt(ev.clientX, ev.clientY);
        setPanelDrag({ cat, x: ev.clientX, y: ev.clientY, over });
      };
      const onUp = () => {
        const dropped = active ? over : null;
        cleanup();
        setPanelDrag(null);
        if (dropped) {
          setLayout((prev) => ({
            ...prev,
            ...setPlace(prev.bottomMask, prev.leftMask, cat, dropped),
          }));
        }
      };
      const onCancel = () => {
        cleanup();
        setPanelDrag(null);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      dragAbortRef.current = onCancel;
    },
    [setLayout, zoneAt]
  );

  const layout = useMemo(() => {
    const s = (v: number) => Math.round(v * ui);
    return {
      ...rawLayout,
      ordersWidth: s(rawLayout.ordersWidth),
      menuRightWidth: s(rawLayout.menuRightWidth),
      menuLeftWidth: s(rawLayout.menuLeftWidth),
      cartWidth: s(rawLayout.cartWidth),
      dishCardSize: s(rawLayout.dishCardSize),
      toppingCardSize: s(rawLayout.toppingCardSize),
      drinkCardSize: s(rawLayout.drinkCardSize),
      sauceCardSize: s(rawLayout.sauceCardSize),
      cardRadius: s(rawLayout.cardRadius),
      gridGap: s(rawLayout.gridGap),
      ordersRowGap: s(rawLayout.ordersRowGap),
      cartItemGap: s(rawLayout.cartItemGap),
      itemTextSize: s(rawLayout.itemTextSize),
      panelHeaderSize: s(rawLayout.panelHeaderSize),
      orderNumberSize: s(rawLayout.orderNumberSize),
      toppingsHeight: s(rawLayout.toppingsHeight),
    };
  }, [rawLayout, ui]);

  const colsRef = useRef<Partial<Record<CategorySpace, number>>>({});
  const rawLayoutRef = useRef(rawLayout);
  rawLayoutRef.current = rawLayout;
  const setLayoutRef = useRef(setLayout);
  setLayoutRef.current = setLayout;
  const registerCols = useCallback(
    (s: CategorySpace, c: number) => {
      colsRef.current[s] = c;
      // Запоминаем число колонок в стиле — касса ставит карточки в те же ячейки
      const key = (
        {
          dishset: 'gridColsDishset',
          drink: 'gridColsDrink',
          sauce: 'gridColsSauce',
          topping: 'gridColsTopping',
        } as const
      )[s];
      if (c > 0 && rawLayoutRef.current[key] !== c) {
        setLayoutRef.current((prev) =>
          prev[key] === c ? prev : { ...prev, [key]: c }
        );
      }
    },
    []
  );

  useEffect(() => {
    const unsubOrders = subscribeOrders((orders) => {
      setActiveOrders(orders);
    });
    return () => {
      unsubOrders();
    };
  }, []);

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        let list = await fetchAllMenuItems();
        const tops = list.filter((i) => !i.parent_id);
        if (hasSortConflicts(tops)) {
          const updates = resolveSlotConflicts(tops);
          if (updates.length > 0) await reorderItems(updates);
          list = await fetchAllMenuItems();
        }
        setItems(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : t('failedToLoadMenu'));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const startEdit = (item: MenuItem) => {
    setEditingItem(item);
    setFormType(item.type);
  };

  const startCreate = (type: MenuItemType) => {
    setEditingItem(null);
    setFormType(type);
    setPickingType(false);
  };

  const applyReorder = async (
    updates: { id: string; sort_order: number }[]
  ) => {
    const updateMap = new Map(updates.map((u) => [u.id, u.sort_order]));
    setItems((prev) => patchSlots(prev, updateMap));
    try {
      await reorderItems(updates);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'reorder failed');
      loadData(true);
    }
  };

  const allTops = useMemo(() => items.filter((i) => !i.parent_id), [items]);

  const propertyHistory = useMemo<HydratedProperty[]>(() => {
    const byName = new Map<string, HydratedProperty>();
    for (const top of items) {
      const variants = top.variants ?? [];
      const sources: HydratedProperty[][] = [
        top.properties ?? [],
        ...variants.map((v) => v.properties ?? []),
      ];
      for (const list of sources) {
        for (const p of list) {
          const name = p.name.trim();
          if (!name) continue;
          const key = name.toLowerCase();
          const prev = byName.get(key);
          if (!prev) {
            byName.set(key, { ...p, id: '', item_id: '' });
            continue;
          }
          const prevScore = prev.options.length * 10 + (prev.required ? 5 : 0);
          const nextScore = p.options.length * 10 + (p.required ? 5 : 0);
          if (nextScore > prevScore) {
            byName.set(key, { ...p, id: '', item_id: '' });
          }
        }
      }
    }
    return [...byName.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'ru')
    );
  }, [items]);

  const handleSlotDrop = useCallback(
    async (space: CategorySpace, targetSlot: number, cols: number) => {
      const fromId = draggedId ?? pointerDragRef.current?.id ?? null;
      setDraggedId(null);
      setDragOverSlot(null);
      if (!fromId) return;

      const fromItem = items.find((i) => i.id === fromId);
      if (!fromItem || fromItem.parent_id) return;
      if (getSpaceOfType(fromItem.type) !== space) return;

      const spaceItems = getSpaceItems(allTops, space);
      const w = getItemWidth(fromItem);

      const targetCard = spaceItems.find(
        (i) => slotOf(i) === targetSlot && i.id !== fromItem.id
      );

      if (targetCard) {
        if (slotOf(targetCard) === slotOf(fromItem)) return;

        const wB = getItemWidth(targetCard);
        const newFromStart = slotOf(targetCard);
        const newTargetStart = slotOf(fromItem);
        const excludeIds = new Set([fromItem.id, targetCard.id]);

        const fromFits =
          fitsInRow(newFromStart, w, cols) &&
          isRangeFreeMulti(spaceItems, newFromStart, w, excludeIds);
        const targetFits =
          fitsInRow(newTargetStart, wB, cols) &&
          isRangeFreeMulti(spaceItems, newTargetStart, wB, excludeIds);

        if (fromFits && targetFits) {
          setItems((prev) =>
            patchSlots(
              prev,
              new Map([
                [fromItem.id, newFromStart],
                [targetCard.id, newTargetStart],
              ])
            )
          );

          const tempSlot = getSafeTempSlot(spaceItems);
          (async () => {
            try {
              await reorderItems([{ id: fromItem.id, sort_order: tempSlot }]);
              await reorderItems([
                { id: targetCard.id, sort_order: newTargetStart },
              ]);
              await reorderItems([
                { id: fromItem.id, sort_order: newFromStart },
              ]);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'reorder failed');
              loadData(true);
            }
          })();
          return;
        }

        const dest = findNearestFreeSlot(
          spaceItems,
          targetSlot,
          w,
          fromItem.id,
          cols
        );
        if (dest < 0 || dest === slotOf(fromItem)) return;
        await applyReorder([{ id: fromItem.id, sort_order: dest }]);
        return;
      }

      let dest = targetSlot;
      if (!isPlaceable(spaceItems, dest, w, fromItem.id, cols)) {
        dest = findNearestFreeSlot(
          spaceItems,
          targetSlot,
          w,
          fromItem.id,
          cols
        );
        if (dest < 0) return;
      }

      if (dest === slotOf(fromItem)) return;
      await applyReorder([{ id: fromItem.id, sort_order: dest }]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draggedId, items, allTops]
  );

  const handleSlotDropRef = useRef(handleSlotDrop);
  handleSlotDropRef.current = handleSlotDrop;

  const startPointerDrag = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-no-drag]')) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const pointerId = e.pointerId;
      const isTouch = e.pointerType !== 'mouse';

      const source = itemsRef.current.find((i) => i.id === id);
      const dragSpace = source ? getSpaceOfType(source.type) : null;

      const state: NonNullable<typeof pointerDragRef.current> = {
        id,
        pointerId,
        startX,
        startY,
        activated: false,
        longPressTimer: null,
        targetSpace: null,
        targetSlot: null,
      };
      pointerDragRef.current = state;

      let cancelled = false;
      let lastX = startX;
      let lastY = startY;
      let ghost: HTMLDivElement | null = null;
      let raf = 0;

      const createGhost = () => {
        if (!source) return;
        const g = document.createElement('div');
        g.style.cssText =
          'position:fixed;left:0;top:0;z-index:200;pointer-events:none;' +
          'width:96px;border-radius:14px;overflow:hidden;background:#fff;' +
          'border:2px solid #fb923c;box-shadow:0 14px 34px rgba(0,0,0,.35);' +
          'opacity:.95;will-change:transform;';
        if (source.image_url) {
          const img = document.createElement('img');
          img.src = source.image_url;
          img.draggable = false;
          img.style.cssText =
            'width:100%;height:96px;object-fit:cover;display:block;';
          g.appendChild(img);
        }
        const label = document.createElement('div');
        label.textContent = source.short_name || source.name;
        label.style.cssText =
          'padding:4px 6px;font:800 11px/1.1 system-ui,sans-serif;' +
          'color:#0f172a;white-space:nowrap;overflow:hidden;' +
          'text-overflow:ellipsis;';
        g.appendChild(label);
        document.body.appendChild(g);
        ghost = g;
      };
      const moveGhost = (x: number, y: number) => {
        if (ghost) {
          ghost.style.transform = `translate(${x + 14}px, ${y + 14}px) rotate(-3deg)`;
        }
      };
      const removeGhost = () => {
        ghost?.remove();
        ghost = null;
      };

      const updateTarget = () => {
        const el = document.elementFromPoint(lastX, lastY);
        const cell = el?.closest('[data-slot-space]') as HTMLElement | null;
        const sp = cell?.dataset.slotSpace as CategorySpace | undefined;
        const sl = cell ? Number(cell.dataset.slotIndex) : NaN;
        if (cell && sp && !Number.isNaN(sl) && sp === dragSpace) {
          if (state.targetSpace !== sp || state.targetSlot !== sl) {
            state.targetSpace = sp;
            state.targetSlot = sl;
            setDragOverSlot({ space: sp, slot: sl });
          }
        } else if (state.targetSpace !== null) {
          state.targetSpace = null;
          state.targetSlot = null;
          setDragOverSlot(null);
        }
      };

      const findScrollParent = (el: Element | null): HTMLElement | null => {
        let n = el as HTMLElement | null;
        while (n && n !== document.body) {
          const oy = getComputedStyle(n).overflowY;
          if (
            (oy === 'auto' || oy === 'scroll') &&
            n.scrollHeight > n.clientHeight
          ) {
            return n;
          }
          n = n.parentElement;
        }
        return null;
      };
      const tick = () => {
        raf = 0;
        if (!state.activated || cancelled || pointerDragRef.current !== state) {
          return;
        }
        const sp = findScrollParent(document.elementFromPoint(lastX, lastY));
        if (sp) {
          const r = sp.getBoundingClientRect();
          const edge = 56;
          let dy = 0;
          if (lastY < r.top + edge) {
            dy = -Math.ceil((r.top + edge - lastY) / 4);
          } else if (lastY > r.bottom - edge) {
            dy = Math.ceil((lastY - (r.bottom - edge)) / 4);
          }
          if (dy !== 0) {
            sp.scrollTop += dy;
            updateTarget();
          }
        }
        raf = window.requestAnimationFrame(tick);
      };

      const activate = () => {
        if (state.activated) return;
        state.activated = true;
        state.longPressTimer = null;
        setDraggedId(id);
        createGhost();
        moveGhost(lastX, lastY);
        document.body.style.cursor = 'grabbing';
        raf = window.requestAnimationFrame(tick);
        try {
          if ('vibrate' in navigator) navigator.vibrate(15);
        } catch {
          /* ignore */
        }
      };

      if (isTouch) {
        state.longPressTimer = window.setTimeout(activate, 350);
      }

      const blockScroll = (ev: TouchEvent) => {
        if (state.activated && ev.cancelable) ev.preventDefault();
      };
      const blockMenu = (ev: Event) => ev.preventDefault();
      document.addEventListener('touchmove', blockScroll, { passive: false });
      document.addEventListener('contextmenu', blockMenu);

      const cleanup = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('touchmove', blockScroll);
        document.removeEventListener('contextmenu', blockMenu);
        if (raf) window.cancelAnimationFrame(raf);
        raf = 0;
        removeGhost();
        document.body.style.cursor = '';
      };

      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape' || !state.activated) return;
        cancelled = true;
        state.targetSpace = null;
        state.targetSlot = null;
        setDragOverSlot(null);
        removeGhost();
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        lastX = ev.clientX;
        lastY = ev.clientY;

        if (!state.activated) {
          const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
          if (isTouch) {
            if (dist > 10) {
              if (state.longPressTimer) {
                window.clearTimeout(state.longPressTimer);
                state.longPressTimer = null;
              }
              pointerDragRef.current = null;
              cleanup();
            }
            return;
          }
          if (dist > 5) {
            activate();
          } else {
            return;
          }
        }

        ev.preventDefault();
        if (cancelled) return;
        moveGhost(ev.clientX, ev.clientY);
        updateTarget();
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;

        if (state.longPressTimer) {
          window.clearTimeout(state.longPressTimer);
          state.longPressTimer = null;
        }

        const shouldDrop =
          state.activated &&
          !cancelled &&
          state.targetSpace !== null &&
          state.targetSlot !== null;

        if (shouldDrop) {
          const sp = state.targetSpace!;
          const sl = state.targetSlot!;
          const cols = colsRef.current[sp] ?? 1;
          void handleSlotDropRef.current(sp, sl, cols);
        } else {
          setDraggedId(null);
          setDragOverSlot(null);
        }

        pointerDragRef.current = null;
        cleanup();
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
      document.addEventListener('keydown', onKey);
    },
    []
  );

  const canMoveItem = useCallback(
    (item: MenuItem, direction: -1 | 1, cols: number): boolean => {
      if (item.parent_id) return false;
      const spaceItems = getSpaceItems(allTops, getSpaceOfType(item.type));
      return isPlaceable(
        spaceItems,
        slotOf(item) + direction,
        getItemWidth(item),
        item.id,
        cols
      );
    },
    [allTops]
  );

  const moveItemByOne = useCallback(
    async (item: MenuItem, direction: -1 | 1, cols: number) => {
      if (!canMoveItem(item, direction, cols)) return;
      await applyReorder([
        { id: item.id, sort_order: slotOf(item) + direction },
      ]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canMoveItem]
  );

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteItem(pendingDelete.id, pendingDelete.type);
      setPendingDelete(null);
      loadData(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToDeleteItem'));
    } finally {
      setDeleting(false);
    }
  };

  const handleDuplicate = async (itemId: string) => {
    try {
      const copy = await duplicateItem(itemId);
      if (copy) await loadData(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось дублировать');
    }
  };

  const openCardMenu = useCallback(
    (x: number, y: number, item: MenuItem) => {
      setCardMenu({ itemId: item.id, itemName: item.name, x, y });
    },
    []
  );

  // ---------- Style sync (Supabase) ----------
  const openSaveDialog = useCallback(() => {
    if (styleSyncing !== 'idle') return;
    setStyleError(null);
    setStyleNotice(null);
    setSaveDialogOpen(true);
  }, [styleSyncing]);

  const confirmSaveStyle = useCallback(
    async (name: string) => {
      setStyleSyncing('saving');
      setStyleError(null);
      try {
        // В облако уходят оба режима сразу: «все блюда» и «одна иконка»
        await saveStyle(
          name,
          getStoredLayout('all'),
          getStoredLayout('single')
        );
        setSaveDialogOpen(false);
        setStyleNotice(`${t('styleSaved')}: ${name}`);
      } catch (e) {
        setStyleError(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setStyleSyncing('idle');
      }
    },
    [t]
  );

  const openLoadDialog = useCallback(() => {
    if (styleSyncing !== 'idle') return;
    setStyleError(null);
    setStyleNotice(null);
    setLoadDialogOpen(true);
  }, [styleSyncing]);

  const applyLoadedStyle = useCallback(
    (style: SavedStyle) => {
      if (style.layoutSingle) {
        // Новый стиль: применяем оба режима сразу
        const allL = { ...DEFAULT_LAYOUT, ...style.layout };
        const singleL = { ...DEFAULT_LAYOUT, ...style.layoutSingle };
        const cur = getViewPrefs().groupView;
        setLayout(cur === 'single' ? singleL : allL);
        applyExternalLayout(cur === 'single' ? allL : singleL, cur === 'single' ? 'all' : 'single');
      } else {
        // Старый стиль (без разделения режимов) — как раньше, в текущий режим
        setLayout({ ...DEFAULT_LAYOUT, ...style.layout });
      }
      setLoadDialogOpen(false);
      setStyleNotice(`${t('styleLoaded')}: ${style.name}`);
    },
    [setLayout, t]
  );

  // ---------- Resize (те же колонки, что и в кассе) ----------
  const startLayoutRef = useRef<typeof layout | null>(null);

  const beginResize = () => {
    startLayoutRef.current = { ...rawLayout };
  };

  const endResize = () => {
    setLayout((prev) => ({
      ...prev,
      ordersWidth: clampLayout(
        'ordersWidth',
        snapValue(prev.ordersWidth, [208, 260, 320], 12)
      ),
      menuRightWidth: clampLayout(
        'menuRightWidth',
        snapValue(prev.menuRightWidth, [160, 200, 240, 300], 12)
      ),
      cartWidth: clampLayout(
        'cartWidth',
        snapValue(prev.cartWidth, [280, 320, 400, 480], 16)
      ),
      toppingsHeight: clampLayout(
        'toppingsHeight',
        snapValue(prev.toppingsHeight, [120, 180, 260, 360], 20)
      ),
      drinksShare: clampLayout(
        'drinksShare',
        snapValue(prev.drinksShare, [30, 50, 70], 8)
      ),
      menuLeftWidth: clampLayout(
        'menuLeftWidth',
        snapValue(prev.menuLeftWidth, [160, 200, 240, 300], 12)
      ),
      leftShare: clampLayout(
        'leftShare',
        snapValue(prev.leftShare, [30, 50, 70], 8)
      ),
    }));
    startLayoutRef.current = null;
  };

  const handleResizeOrders = (d: number) => {
    const base = startLayoutRef.current ?? rawLayout;
    setLayout((prev) => ({
      ...prev,
      ordersWidth: clampLayout('ordersWidth', base.ordersWidth + d / ui),
    }));
  };

  const handleResizeMenuRight = (d: number) => {
    const base = startLayoutRef.current ?? rawLayout;
    setLayout((prev) => ({
      ...prev,
      menuRightWidth: clampLayout(
        'menuRightWidth',
        base.menuRightWidth - d / ui
      ),
    }));
  };

  const handleResizeMenuLeft = (d: number) => {
    const base = startLayoutRef.current ?? rawLayout;
    setLayout((prev) => ({
      ...prev,
      menuLeftWidth: clampLayout('menuLeftWidth', base.menuLeftWidth + d / ui),
    }));
  };

  const handleResizeLeftShare = (d: number) => {
    const base = startLayoutRef.current ?? rawLayout;
    const containerH = leftWrapRef.current?.clientHeight ?? 400;
    const pctDelta = (d / containerH) * 100;
    setLayout((prev) => ({
      ...prev,
      leftShare: clampLayout('leftShare', base.leftShare + pctDelta),
    }));
  };

  const handleResizeCart = (d: number) => {
    const base = startLayoutRef.current ?? rawLayout;
    setLayout((prev) => ({
      ...prev,
      cartWidth: clampLayout('cartWidth', base.cartWidth - d / ui),
    }));
  };

  const handleResizeToppings = (d: number) => {
    const base = startLayoutRef.current ?? rawLayout;
    setLayout((prev) => ({
      ...prev,
      toppingsHeight: clampLayout(
        'toppingsHeight',
        base.toppingsHeight - d / ui
      ),
    }));
  };

  const handleResizeDrinks = (d: number) => {
    const base = startLayoutRef.current ?? rawLayout;
    const containerH = drinksWrapRef.current?.clientHeight ?? 400;
    const pctDelta = (d / containerH) * 100;
    setLayout((prev) => ({
      ...prev,
      drinksShare: clampLayout('drinksShare', base.drinksShare + pctDelta),
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
      </div>
    );
  }

  const catList = [
    {
      key: 'dishset' as const,
      label: t('bludiAndSet'),
      has: getSpaceItems(allTops, 'dishset').length > 0,
    },
    {
      key: 'drink' as const,
      label: t('type_drink'),
      has: getSpaceItems(allTops, 'drink').length > 0,
    },
    {
      key: 'sauce' as const,
      label: t('type_sauce'),
      has: getSpaceItems(allTops, 'sauce').length > 0,
    },
    {
      key: 'topping' as const,
      label: t('type_topping'),
      has: getSpaceItems(allTops, 'topping').length > 0,
    },
  ].filter((c) => c.has);

  const currentCat = catList.find((c) => c.key === activeCat) ?? catList[0];
  const currentCatKey: CategorySpace = currentCat?.key ?? 'dishset';
  const currentCatLabel = currentCat?.label ?? t('bludiAndSet');

  const panelSplit = splitPanelCats(layout.bottomMask, layout.leftMask);

  // Где панель окажется на самом деле: левая/правая — колонка шириной как в настройках
  // рядом с центром (если уже есть — это её текущее место), нижняя — полоса внизу центра.
  // На планшетах/узких окнах колонки не должны съедать всё место у центра:
  // при нехватке ширины временно сужаем боковые панели, затем корзину.
  const ordersShown = viewPrefs.ordersOpen && viewPrefs.ordersPinned;
  const eff = fitColumns(
    vw,
    Math.round(300 * ui),
    (ordersShown ? layout.ordersWidth : 0) + 40,
    {
      left: panelSplit.left.length > 0 ? layout.menuLeftWidth : 0,
      right: panelSplit.side.length > 0 ? layout.menuRightWidth : 0,
      cart: layout.cartWidth,
    },
    { side: Math.round(90 * ui), cart: Math.round(240 * ui) }
  );
  const leftW = panelSplit.left.length > 0 ? eff.left : layout.menuLeftWidth;
  const rightW = panelSplit.side.length > 0 ? eff.right : layout.menuRightWidth;

  zoneFnRef.current = () => {
    const c = centerRef.current?.getBoundingClientRect();
    if (!c) return null;
    const lw = leftW;
    const rw = rightW;
    const hasL = panelSplit.left.length > 0;
    const hasR = panelSplit.side.length > 0;
    const left: ZoneRect = { x: hasL ? c.left - lw - 8 : c.left, y: c.top, w: lw, h: c.height };
    const right: ZoneRect = { x: hasR ? c.right + 8 : c.right - rw, y: c.top, w: rw, h: c.height };
    const bx = hasL ? c.left : c.left + lw;
    const bex = hasR ? c.right : c.right - rw;
    const bh = layout.toppingsHeight;
    const bottom: ZoneRect = { x: bx, y: c.bottom - bh, w: Math.max(0, bex - bx), h: bh };
    return { left, right, bottom };
  };
  const catLabelOf = (c: PanelCat) =>
    c === 'drink' ? t('type_drink') : c === 'sauce' ? t('type_sauce') : t('type_topping');

  const hdrSize = isDesktop
    ? layout.panelHeaderSize
    : Math.max(layout.panelHeaderSize, Math.round(14 * ui));
  const numSize = isDesktop
    ? layout.orderNumberSize
    : Math.max(layout.orderNumberSize, Math.round(24 * ui));

  const sizeOf = (sp: CategorySpace): number =>
    sp === 'dishset'
      ? layout.dishCardSize
      : sp === 'drink'
      ? layout.drinkCardSize
      : sp === 'sauce'
      ? layout.sauceCardSize
      : layout.toppingCardSize;

  // Общий рендер сетки редактирования для любой категории
  const renderSpace = (sp: CategorySpace) => (
    <GridSpace
      space={sp}
      size={sizeOf(sp)}
      fitStoredCols={Number(rawLayout[COLS_KEY_M[sp]]) || 0}
      sizeKey={`${
        sp === 'dishset'
          ? rawLayout.dishCardSize
          : sp === 'drink'
          ? rawLayout.drinkCardSize
          : sp === 'sauce'
          ? rawLayout.sauceCardSize
          : rawLayout.toppingCardSize
      }|${rawLayout.gridGap}`}
      compact={sp !== 'dishset'}
      allTops={allTops}
      draggedId={draggedId}
      dragOverSlot={dragOverSlot}
      setDragOverSlot={setDragOverSlot}
      handleSlotDrop={handleSlotDrop}
      startEdit={startEdit}
      startPointerDrag={startPointerDrag}
      canMoveItem={canMoveItem}
      moveItemByOne={moveItemByOne}
      registerCols={registerCols}
      textSize={layout.itemTextSize}
      layout={layout}
      onOpenCardMenu={openCardMenu}
    />
  );

  // ---------- Левая колонка: активные заказы (как в кассе) ----------
  const visibleOrders = activeOrders.filter((o) => o.status !== 'CANCELLED');
  const showSamples = visibleOrders.length === 0;
  const displayOrders = showSamples
    ? SAMPLE_ORDERS
    : visibleOrders.map((o) => ({
        id: o.id,
        number: o.order_number,
        status: o.status as string,
        total: o.total_amount,
        time: formatTimeAgo(o.created_at, lang),
        sample: false,
        items: (o.order_items ?? [])
          .filter((i) => !i.is_removed)
          .map((i) => `${i.quantity}× ${i.short_name || i.name}`),
      }));

  const ordersInner = (
    <>
      <div className="px-3 py-2 border-b border-slate-200 shrink-0 bg-slate-50">
        <div className="flex items-center justify-between gap-1">
          <span
            className="font-black text-orange-600 leading-none pl-1 tabular-nums"
            style={{ fontSize: numSize }}
          >
            {displayOrders.length}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setViewPrefs({ ordersExpanded: !viewPrefs.ordersExpanded })}
              title={viewPrefs.ordersExpanded ? (t('collapseOrders')) : (t('expandOrders'))}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-200 active:scale-90"
            >
              {viewPrefs.ordersExpanded ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setViewPrefs({ ordersPinned: !viewPrefs.ordersPinned })}
              title={viewPrefs.ordersPinned ? (t('unpinPanel')) : (t('pinPanelLeft'))}
              className={`w-7 h-7 rounded-lg flex items-center justify-center active:scale-90 ${
                viewPrefs.ordersPinned
                  ? 'bg-orange-100 text-orange-600'
                  : 'text-slate-500 hover:bg-slate-200'
              }`}
            >
              {viewPrefs.ordersPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setViewPrefs({ ordersOpen: false })}
              title={t('hidePanel')}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-200 active:scale-90"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <h2
          className="font-black text-slate-700 tracking-wide border-l-4 border-slate-400 pl-2 leading-none mt-1.5"
          style={{ fontSize: hdrSize }}
        >
          {t('activeOrders')}
        </h2>
        {showSamples && (
          <span className="mt-1 ml-2 inline-block text-[0.625rem] font-black px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 uppercase tracking-wide">
            Пример
          </span>
        )}
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col"
        style={{ rowGap: layout.ordersRowGap }}
      >
        {displayOrders.map((order) => {
          const cls =
            order.status === 'READY'
              ? 'bg-green-50 border-l-green-500'
              : order.status === 'PREPARING'
              ? 'bg-amber-50 border-l-amber-400'
              : 'bg-white border-l-slate-300';
          return (
            <div
              key={order.id}
              className={`p-3.5 rounded-xl border border-slate-200 border-l-[6px] shadow-sm ${cls} ${
                order.sample ? 'opacity-80' : ''
              }`}
              style={{ borderRadius: layout.cardRadius }}
            >
              {viewPrefs.ordersExpanded ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="font-black text-slate-900 tabular-nums"
                      style={{ fontSize: numSize }}
                    >
                      #{order.number}
                    </span>
                  </div>
                  <div className="mt-1 text-[0.6875rem] font-bold text-slate-500">
                    {order.status === 'PREPARING'
                      ? 'Готовится'
                      : order.status === 'READY'
                      ? '✓ Готов'
                      : 'Новый'}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[0.6875rem] text-slate-500">
                      {order.time}
                    </span>
                    <span className="text-sm font-black text-slate-700 tabular-nums">
                      {formatYen(order.total)}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className="font-black text-slate-900 tabular-nums leading-none"
                      style={{ fontSize: Math.round(numSize * 0.7) }}
                    >
                      #{order.number}
                    </span>
                    <span className="text-xs font-black text-slate-700 tabular-nums shrink-0 leading-none">
                      {formatYen(order.total)}
                    </span>
                  </div>
                  <div className="text-[0.625rem] font-semibold text-slate-400 leading-none mt-1">
                    {order.time}
                  </div>
                </>
              )}
              {viewPrefs.ordersExpanded && order.items.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-200 flex flex-col gap-0.5">
                  {order.items.map((line, idx) => (
                    <span
                      key={idx}
                      className="text-[0.6875rem] font-semibold text-slate-600 truncate"
                    >
                      {line}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  // ---------- Desktop: касса — orders | dish+toppings | drinks+sauces | cart ----------
  const desktopLayout = (
    <div ref={desktopAreaRef} className="flex-1 min-h-0 flex overflow-hidden relative">
      {/* LEFT: ORDERS — закреплённая колонка */}
      {viewPrefs.ordersOpen && viewPrefs.ordersPinned && (
        <>
          <div
            className="shrink-0 bg-white border-r border-slate-300 flex flex-col min-h-0"
            style={{ width: layout.ordersWidth }}
          >
            {ordersInner}
          </div>

          <Resizer
            onStart={beginResize}
            onResize={handleResizeOrders}
            onEnd={endResize}
          />
        </>
      )}

      {/* LEFT: ORDERS — выезжает поверх меню */}
      {viewPrefs.ordersOpen && !viewPrefs.ordersPinned && (
        <div className="absolute inset-0 z-40 flex">
          <div
            className="bg-white shadow-2xl border-r border-slate-300 flex flex-col min-h-0"
            style={{ width: layout.ordersWidth }}
          >
            {ordersInner}
          </div>
          <button
            aria-label={t('close')}
            className="flex-1 bg-black/30"
            onClick={() => setViewPrefs({ ordersOpen: false })}
          />
        </div>
      )}

      {/* LEFT: категории, поставленные слева */}
      {panelSplit.left.length > 0 && (
        <>
          <div
            ref={leftWrapRef}
            className="shrink-0 bg-white border-r border-slate-300 flex flex-col min-h-0"
            style={{ width: leftW }}
          >
            <SidePanelCats
              cats={panelSplit.left}
              hdrSize={hdrSize}
              labelFor={catLabelOf}
              renderBody={(c) => renderSpace(c)}
              onHeaderPointerDown={startPanelDrag}
              draggingCat={panelDrag?.cat ?? null}
              share={layout.leftShare}
              splitter={
                <Resizer
                  direction="horizontal"
                  onStart={beginResize}
                  onResize={handleResizeLeftShare}
                  onEnd={endResize}
                />
              }
            />
          </div>
          <Resizer
            onStart={beginResize}
            onResize={handleResizeMenuLeft}
            onEnd={endResize}
          />
        </>
      )}

      {/* CENTER: блюда/сеты + топпинги снизу */}
      <div ref={centerRef} className="flex-1 min-w-0 flex flex-col min-h-0 bg-slate-100">
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {renderSpace('dishset')}
        </div>

        <BottomPanelCats
          cats={panelSplit.bottom}
          hdrSize={hdrSize}
          labelFor={catLabelOf}
          renderBody={(c) => renderSpace(c)}
          onHeaderPointerDown={startPanelDrag}
          draggingCat={panelDrag?.cat ?? null}
          height={layout.toppingsHeight}
          splitter={
            <Resizer
              direction="horizontal"
              onStart={beginResize}
              onResize={handleResizeToppings}
              onEnd={endResize}
            />
          }
        />
      </div>

      {panelSplit.side.length > 0 && (
        <>
          <Resizer
            onStart={beginResize}
            onResize={handleResizeMenuRight}
            onEnd={endResize}
          />

          {/* RIGHT: категории, которые не стоят снизу */}
          <div
            ref={drinksWrapRef}
            className="shrink-0 bg-white border-l border-slate-300 flex flex-col min-h-0"
            style={{ width: rightW }}
          >
            <SidePanelCats
              cats={panelSplit.side}
              hdrSize={hdrSize}
              labelFor={catLabelOf}
              renderBody={(c) => renderSpace(c)}
              onHeaderPointerDown={startPanelDrag}
              draggingCat={panelDrag?.cat ?? null}
              share={layout.drinksShare}
              splitter={
                <Resizer
                  direction="horizontal"
                  onStart={beginResize}
                  onResize={handleResizeDrinks}
                  onEnd={endResize}
                />
              }
            />
          </div>
        </>
      )}

      <Resizer
        onStart={beginResize}
        onResize={handleResizeCart}
        onEnd={endResize}
      />

      {/* CART (пример, чтобы видеть реальную ширину) */}
      <div
        className="shrink-0 bg-white border-l border-slate-300 flex flex-col min-h-0"
        style={{ width: eff.cart }}
      >
        <CartSample
          cartItemGap={layout.cartItemGap}
          cartWidth={layout.cartWidth}
          ui={ui}
        />
      </div>

      {/* Зоны переноса панели (видны, пока заголовок удерживается) */}
      {panelDrag && (() => {
        const z = zoneFnRef.current();
        const area = desktopAreaRef.current?.getBoundingClientRect();
        if (!z || !area) return null;
        const current = getPlace(layout.bottomMask, layout.leftMask, panelDrag.cat);
        const labels: Record<PanelPlace, string> = {
          left: t('dropZoneLeft'),
          right: t('dropZoneRight'),
          bottom: t('dropZoneBottom'),
        };
        return (
          <div className="absolute inset-0 z-50 pointer-events-none">
            {(['left', 'right', 'bottom'] as const).map((place) => {
              const r = z[place];
              return (
                <div
                  key={place}
                  className={`absolute rounded-xl border-2 border-dashed flex items-center justify-center text-sm font-black uppercase tracking-wider transition-colors ${
                    panelDrag.over === place
                      ? 'border-orange-500 bg-orange-500/30 text-orange-600'
                      : current === place
                      ? 'border-slate-400 bg-slate-400/10 text-slate-500'
                      : 'border-orange-300 bg-orange-200/15 text-orange-400'
                  }`}
                  style={{ left: r.x - area.left, top: r.y - area.top, width: r.w, height: r.h }}
                >
                  {labels[place]}
                </div>
              );
            })}
          </div>
        );
      })()}
      {panelDrag && (
        <div
          className="fixed z-[60] pointer-events-none px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-black shadow-xl"
          style={{ left: panelDrag.x - 24, top: panelDrag.y - 56 }}
        >
          {catLabelOf(panelDrag.cat)}
        </div>
      )}
    </div>
  );

  // ---------- Не desktop: компактный режим с вкладками категорий ----------
  const compactLayout = (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-slate-100">
        <div className="flex gap-2 px-3 py-2 overflow-x-auto shrink-0 bg-white border-b border-slate-200 [scrollbar-width:none]">
          {catList.map((c) => (
            <button
              key={c.key}
              onClick={() => setActiveCat(c.key)}
              className={`shrink-0 px-4 py-2.5 rounded-full border-2 text-sm font-black whitespace-nowrap active:scale-95 transition-all ${
                currentCatKey === c.key
                  ? CAT_STYLE[c.key].on
                  : CAT_STYLE[c.key].off
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-orange-100 border-l-4 border-orange-500">
              <h3
                className="font-black text-orange-800 tracking-wide truncate leading-none"
                style={{ fontSize: hdrSize }}
              >
                {currentCatLabel} · {t('dragHintShort')}
              </h3>
            </div>
          </div>

          {catList.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              {t('noMenuItems')}
            </div>
          ) : (
            renderSpace(currentCatKey)
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-200/70">
      {/* === ШАПКА (PageActions): как в кассе — кнопки без лишнего текста === */}
      <PageActions forRole="manager">
        {productsPage ? (
          <HeaderToggleButton
            active={false}
            onClick={() => setProductsPage(false)}
            icon={<ArrowLeft className="w-4 h-4" />}
            label="Назад к меню"
            alwaysShowLabel
          />
        ) : (
          <>
            <OrdersHeaderButton
              active={viewPrefs.ordersOpen}
              count={visibleOrders.length}
              onClick={() => setViewPrefs({ ordersOpen: !viewPrefs.ordersOpen })}
            />
            <GroupViewToggle />
            <HeaderToggleButton
              active={false}
              onClick={() => setViewPrefs({ floatingHidden: !viewPrefs.floatingHidden })}
              icon={viewPrefs.floatingHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              label={
                viewPrefs.floatingHidden
                  ? t('showSettingsProducts')
                  : t('hideSettingsProducts')
              }
            />
            <HeaderToggleButton
              active={false}
              onClick={() => setProductsPage(true)}
              icon={<LayoutGrid className="w-4 h-4" />}
              label="Продукты"
              title="Страница «Продукты»: добавить и изменить"
              alwaysShowLabel
            />
          </>
        )}
      </PageActions>

      {error && (
        <div className="m-3 p-3 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {productsPage ? (
        <ProductsPage
          items={items}
          onAdd={() => setPickingType(true)}
          onEdit={startEdit}
          onDuplicate={(it) => {
            void handleDuplicate(it.id);
          }}
          onDelete={(it) => setPendingDelete(it)}
        />
      ) : isDesktop ? (
        desktopLayout
      ) : (
        compactLayout
      )}

      {pickingType && (
        <TypePicker
          onCancel={() => setPickingType(false)}
          onPick={startCreate}
        />
      )}

      {formType && (
        <ItemFormModal
          type={formType}
          item={editingItem}
          allItems={items}
          propertyHistory={propertyHistory}
          onClose={() => {
            setFormType(null);
            setEditingItem(null);
          }}
          onSaved={() => {
            setFormType(null);
            setEditingItem(null);
            loadData(true);
          }}
          onDelete={
            editingItem
              ? () => {
                  setPendingDelete(editingItem);
                  setFormType(null);
                  setEditingItem(null);
                }
              : undefined
          }
        />
      )}

      {cardMenu && (
        <MenuCardMenu
          state={cardMenu}
          onEdit={() => {
            const item = items.find((i) => i.id === cardMenu.itemId);
            if (item) startEdit(item);
          }}
          onDuplicate={() => {
            void handleDuplicate(cardMenu.itemId);
          }}
          onDelete={() => {
            const item = items.find((i) => i.id === cardMenu.itemId);
            if (item) setPendingDelete(item);
          }}
          onClose={() => setCardMenu(null)}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('deleteItemConfirm')}
        message={
          pendingDelete
            ? `${t('deleteProductMessage')}: "${pendingDelete.name}"?`
            : ''
        }
        confirmLabel={deleting ? t('deleting') : t('delete')}
        cancelLabel={t('cancel')}
        variant="red"
        onConfirm={confirmDelete}
        onCancel={() => {
          if (deleting) return;
          setPendingDelete(null);
        }}
      />

      {/* === Style dialogs + floating settings === */}
      <SaveStyleDialog
        open={saveDialogOpen}
        saving={styleSyncing === 'saving'}
        error={styleError}
        onCancel={() => {
          if (styleSyncing === 'saving') return;
          setSaveDialogOpen(false);
          setStyleError(null);
        }}
        onConfirm={confirmSaveStyle}
      />

      <LoadStyleDialog
        open={loadDialogOpen}
        onCancel={() => setLoadDialogOpen(false)}
        onPick={applyLoadedStyle}
      />

      {!viewPrefs.floatingHidden && !productsPage && (
        <FloatingWindow
          title={t('styleSettingsBtn')}
          icon={<Settings className="w-3.5 h-3.5 text-violet-600 shrink-0" />}
          storageKey="kebab-panel-settings-window"
          initialPos={{ x: Math.max(8, window.innerWidth - 436), y: 72 }}
          width={420}
          defaultCollapsed
        >
          <div className="p-4 flex flex-col gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Cloud className="w-4 h-4 text-violet-600" />
                <span className="text-[0.6875rem] font-black text-violet-800 uppercase tracking-wide">
                  {t('styleSyncTitle')}
                </span>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={openSaveDialog}
                  disabled={styleSyncing !== 'idle'}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[0.6875rem] font-bold disabled:opacity-50"
                >
                  {styleSyncing === 'saving' ? (
                    <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  {t('styleSaveBtn')}
                </button>
                <button
                  onClick={openLoadDialog}
                  disabled={styleSyncing !== 'idle'}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg bg-white border-2 border-violet-300 text-violet-700 text-[0.6875rem] font-bold disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  {t('styleLoadBtn')}
                </button>
              </div>
              {styleNotice && (
                <div className="mt-1.5 text-[0.625rem] font-bold text-green-700 leading-tight">
                  ✓ {styleNotice}
                </div>
              )}
              {styleError && (
                <div className="mt-1.5 text-[0.625rem] font-bold text-red-600 leading-tight break-words">
                  ⚠ {styleError}
                </div>
              )}
            </div>

            <div className="h-px bg-slate-200" />
            <PanelSettings />
          </div>
        </FloatingWindow>
      )}
    </div>
  );
}

// ============================================================
// TYPE PICKER
// ============================================================
function TypePicker({
  onPick,
  onCancel,
}: {
  onPick: (t: MenuItemType) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();

  const types: { key: MenuItemType; label: string; icon: React.ReactNode }[] = [
    {
      key: 'dish',
      label: t('type_dish'),
      icon: <UtensilsCrossed className="w-6 h-6" />,
    },
    {
      key: 'set',
      label: t('type_set'),
      icon: <Package className="w-6 h-6" />,
    },
    {
      key: 'drink',
      label: t('type_drink'),
      icon: <CupSoda className="w-6 h-6" />,
    },
    {
      key: 'sauce',
      label: t('type_sauce'),
      icon: <Droplet className="w-6 h-6" />,
    },
    {
      key: 'topping',
      label: t('type_topping'),
      icon: <Sparkles className="w-6 h-6" />,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-xl font-black text-slate-900">
            {t('pickCategory')}
          </h3>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {types.map((tp) => (
            <button
              key={tp.key}
              onClick={() => onPick(tp.key)}
              className="flex flex-col items-center gap-2 p-5 rounded-2xl border-2 border-slate-200 hover:border-orange-400 hover:bg-orange-50 hover:shadow-md transition-all active:scale-[0.97]"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 text-white flex items-center justify-center shadow-md shadow-orange-500/20">
                {tp.icon}
              </div>
              <span className="text-sm font-bold text-slate-900">
                {tp.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ITEM FORM MODAL
// ============================================================
type MenuVariantForm = {
  id?: string;
  name: string;
  short_name: string;
  image_url: string;
  price: number;
  free: boolean;
  station: Station;
  cook_time_min: number;
  sauce_mode: SauceMode;
  extras: ExtrasForm;
};

type ExtraGroupForm = {
  label: string;
  required: boolean;
  /** показывать окном выбора в кассе */
  popup: boolean;
  /** сколько вариантов можно выбрать (1…число продуктов) */
  pick_count: number;
  /** лимит задан вручную (для групп без окна) */
  pick_set?: boolean;
  options: {
    item_id: string;
    price_override: number | null;
    image_override: string | null;
  }[];
};

// ============================================================
// СОУСЫ / НАПИТКИ / ТОППИНГИ + СВОЙСТВА
// Кнопки в форме открывают отдельные окна. По умолчанию у нового
// продукта выбраны ВСЕ позиции; рядом с каждой можно задать доплату.
// ============================================================
type AddonKind = 'sauce' | 'drink' | 'topping';

type ExtrasForm = {
  sauces: AddonPick[];
  drinks: AddonPick[];
  toppings: AddonPick[];
  /** лимиты выбора (0 = по умолчанию: соусы 2, остальное без лимита) */
  maxSauces: number;
  maxDrinks: number;
  maxToppings: number;
  properties: HydratedProperty[];
};

function addonPool(allItems: MenuItem[], kind: AddonKind): MenuItem[] {
  return allItems.filter((i) => i.type === kind && i.active && !i.parent_id);
}

function picksFrom(list: HydratedSauce[] | undefined): AddonPick[] {
  return (list ?? []).map((s) => ({ id: s.id, extra_price: s.extra_price ?? 0 }));
}

function picksAll(items: MenuItem[]): AddonPick[] {
  return items.map((i) => ({ id: i.id, extra_price: 0 }));
}

/** Новый продукт → всё выбрано. Существующий → то, что сохранено. */
function initExtras(item: MenuItem | null, allItems: MenuItem[]): ExtrasForm {
  if (!item) {
    return {
      sauces: picksAll(addonPool(allItems, 'sauce')),
      drinks: picksAll(addonPool(allItems, 'drink')),
      toppings: picksAll(addonPool(allItems, 'topping')),
      maxSauces: 0,
      maxDrinks: 0,
      maxToppings: 0,
      properties: [],
    };
  }
  return {
    sauces: picksFrom(item.allowed_sauces),
    drinks: picksFrom(item.allowed_drinks),
    toppings: picksFrom(item.allowed_toppings),
    maxSauces: item.max_sauces ?? 0,
    maxDrinks: item.max_drinks ?? 0,
    maxToppings: item.max_toppings ?? 0,
    // у свойства одно значение
    properties: (item.properties ?? []).map((p) => ({
      ...p,
      options: pickSingleOption(p.options),
    })),
  };
}

function toPropertyPayload(list: HydratedProperty[]): PropertyDraftPayload[] {
  return list
    .filter((p) => p.name.trim())
    .map((p) => ({
      name: p.name,
      options: pickSingleOption(p.options),
      required: p.required ?? false,
      price: p.price,
    }));
}

function initMainOverrides(
  item: MenuItem | null,
  allItems: MenuItem[]
): Record<
  string,
  { price_override: number | null; image_override: string | null }
> {
  const out: Record<
    string,
    { price_override: number | null; image_override: string | null }
  > = {};

  const setMain = item?.set_main;
  if (!setMain) return out;

  const originalMain = allItems.find((i) => i.id === setMain.id);
  const origVariants = originalMain?.variants ?? [];
  const clonedVariants = setMain.variants ?? [];

  for (let i = 0; i < clonedVariants.length; i++) {
    const orig = origVariants[i];
    const cl = clonedVariants[i];
    if (!orig) continue;

    // фото, совпадающее с фото самого сета, — не override
    const customImage =
      cl.image_url &&
      cl.image_url !== orig.image_url &&
      cl.image_url !== item?.image_url
        ? cl.image_url
        : null;

    out[orig.id] = {
      price_override: cl.price,
      image_override: customImage,
    };
  }

  return out;
}

function ItemFormModal({
  type,
  item,
  allItems,
  propertyHistory,
  onClose,
  onSaved,
  onDelete,
}: {
  type: MenuItemType;
  item: MenuItem | null;
  allItems: MenuItem[];
  propertyHistory: HydratedProperty[];
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const { t } = useI18n();

  const [name, setName] = useState(item?.name ?? '');
  const [shortName, setShortName] = useState(item?.short_name ?? '');
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? '');
  const [price, setPrice] = useState(item?.price ?? 0);
  const [free, setFree] = useState(item?.free ?? false);
  const [active, setActive] = useState(item?.active ?? true);

  const [station, setStation] = useState<Station>(item?.station ?? 'ready');
  const [cookTimeMin, setCookTimeMin] = useState<number>(
    item?.cook_time_min ?? 10
  );

  const [color, setColor] = useState(item?.color ?? '#ef4444');

  const [dishKind, setDishKind] = useState<DishKind>(
    item?.dish_kind ?? 'single'
  );
  const [extras, setExtras] = useState<ExtrasForm>(() =>
    initExtras(item, allItems)
  );

  const [variants, setVariants] = useState<MenuVariantForm[]>(
    (item?.variants ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      short_name: v.short_name,
      image_url: v.image_url ?? '',
      price: v.price,
      free: v.free,
      station: v.station ?? 'ready',
      cook_time_min: v.cook_time_min ?? 10,
      sauce_mode: v.sauce_mode ?? 'none',
      extras: initExtras(v, allItems),
    }))
  );

  const [setMainId, setSetMainId] = useState<string>(item?.set_main?.id ?? '');

  const [mainOverrides, setMainOverrides] = useState(() =>
    initMainOverrides(item, allItems)
  );

  const [extraGroups, setExtraGroups] = useState<ExtraGroupForm[]>(
    (item?.set_extra_groups ?? []).map((g) => ({
      label: g.label,
      required: g.required,
      popup: g.popup !== false,
      pick_count: g.pick_count ?? 1,
      pick_set: g.pick_set,
      options: g.options.map((o) => ({
        item_id: o.item.id,
        price_override: null,
        image_override: null,
      })),
    }))
  );

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickingOption, setPickingOption] = useState<{
    groupIndex: number;
  } | null>(null);
  const [groupPresetOpen, setGroupPresetOpen] = useState(false);

  const [cropState, setCropState] = useState<{
    file: File;
    onDone: (url: string) => void;
  } | null>(null);

  const pendingOpsRef = useRef(0);
  const waitersRef = useRef<Array<() => void>>([]);
  const [pendingOpsCount, setPendingOpsCount] = useState(0);

  const incPending = () => {
    pendingOpsRef.current += 1;
    setPendingOpsCount(pendingOpsRef.current);
  };

  const decPending = () => {
    pendingOpsRef.current = Math.max(0, pendingOpsRef.current - 1);
    setPendingOpsCount(pendingOpsRef.current);
    if (pendingOpsRef.current === 0) {
      const waiters = waitersRef.current;
      waitersRef.current = [];
      waiters.forEach((w) => {
        try {
          w();
        } catch {
          /* ignore */
        }
      });
    }
  };

  const waitForPending = () =>
    new Promise<void>((resolve) => {
      if (pendingOpsRef.current === 0) {
        resolve();
        return;
      }
      waitersRef.current.push(resolve);
    });

  const requestCrop = (file: File, onDone: (url: string) => void) => {
    if (saving) return;
    incPending();
    setCropState({ file, onDone });
  };

  const cancelCrop = () => {
    if (!cropState) return;
    setCropState(null);
    decPending();
  };

  const handleCropConfirm = async (croppedFile: File) => {
    if (!cropState) return;
    const { onDone } = cropState;
    setCropState(null);
    setUploading(true);
    setError(null);
    try {
      const tempId = item?.id ?? uuid();
      const url = await uploadItemImage(croppedFile, tempId);
      if (url) onDone(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToUploadImage'));
    } finally {
      setUploading(false);
      decPending();
    }
  };

  const allSauces = allItems.filter(
    (i) => i.type === 'sauce' && i.active && !i.parent_id
  );
  const allDrinks = allItems.filter(
    (i) => i.type === 'drink' && i.active && !i.parent_id
  );
  const allToppings = allItems.filter(
    (i) => i.type === 'topping' && i.active && !i.parent_id
  );
  const allDishes = allItems.filter(
    (i) => i.type === 'dish' && !i.parent_id && i.active
  );
  const extraCandidates = allItems.filter(
    (i) =>
      i.active &&
      !i.parent_id &&
      (i.type === 'drink' || i.type === 'topping' || i.type === 'dish')
  );

  const addVariant = () => {
    setVariants((v) => [
      ...v,
      {
        id: undefined,
        name: '',
        short_name: '',
        image_url: '',
        price: 0,
        free: false,
        station: 'ready',
        cook_time_min: 10,
        sauce_mode: 'none',
        extras: initExtras(null, allItems),
      },
    ]);
  };
  const updateVariant = <K extends keyof MenuVariantForm>(
    idx: number,
    key: K,
    value: MenuVariantForm[K]
  ) => {
    setVariants((v) =>
      v.map((x, i) => (i === idx ? { ...x, [key]: value } : x))
    );
  };
  const removeVariant = (idx: number) => {
    setVariants((v) => v.filter((_, i) => i !== idx));
  };

  const addExtraGroup = () => {
    setExtraGroups((g) => [
      ...g,
      { label: '', required: true, popup: true, pick_count: 1, options: [] },
    ]);
  };
  /**
   * Новая группа: пустая, со всеми соусами, напитками, топпингами или
   * со всеми продуктами (блюда; без соусов, напитков и топпингов).
   */
  const addExtraGroupPreset = (kind: GroupPresetKind) => {
    setGroupPresetOpen(false);
    if (kind === 'empty') {
      addExtraGroup();
      return;
    }
    const source =
      kind === 'sauce'
        ? allSauces
        : kind === 'drink'
        ? allDrinks
        : kind === 'topping'
        ? allToppings
        : allDishes;
    setExtraGroups((g) => [
      ...g,
      {
        label: t(
          kind === 'sauce'
            ? 'type_sauce'
            : kind === 'drink'
            ? 'type_drink'
            : kind === 'topping'
            ? 'type_topping'
            : 'allDishes'
        ),
        required: true,
        popup: true,
        pick_count: 1,
        options: source.map((i) => ({
          item_id: i.id,
          price_override: null,
          image_override: null,
        })),
      },
    ]);
  };
  const updateExtraGroup = (idx: number, patch: Partial<ExtraGroupForm>) => {
    setExtraGroups((g) =>
      g.map((x, i) => (i === idx ? { ...x, ...patch } : x))
    );
  };
  const removeExtraGroup = (idx: number) => {
    setExtraGroups((g) => g.filter((_, i) => i !== idx));
  };
  const addOptionToGroup = (groupIndex: number, itemId: string) => {
    setExtraGroups((g) =>
      g.map((x, i) =>
        i === groupIndex
          ? {
              ...x,
              options: [
                ...x.options,
                {
                  item_id: itemId,
                  price_override: null,
                  image_override: null,
                },
              ],
            }
          : x
      )
    );
  };
  const removeOptionFromGroup = (groupIndex: number, optIdx: number) => {
    setExtraGroups((g) =>
      g.map((x, i) =>
        i === groupIndex
          ? { ...x, options: x.options.filter((_, j) => j !== optIdx) }
          : x
      )
    );
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);

    try {
      let guard = 0;
      while (pendingOpsRef.current > 0 && guard < 60) {
        if (pendingOpsRef.current > 0) {
          console.log(
            `[save] Жду загрузку фото: ${pendingOpsRef.current} операций`
          );
        }
        await waitForPending();
        guard++;
        if (pendingOpsRef.current > 0) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      const base: SaveItemPayload = {
        type,
        name,
        short_name: shortName,
        image_url: type === 'set' ? null : imageUrl || null,
        price: type === 'set' ? 0 : free ? 0 : price,
        free: type === 'set' ? false : free,
        active,
        sort_order: item?.sort_order ?? 0,
        station: null,
        cook_time_min: null,
        color: null,
        dish_kind: null,
        sauce_mode: null,
      };

      if (type === 'dish' || type === 'topping') {
        base.station = station;
        base.cook_time_min = station === 'kitchen' ? cookTimeMin : null;
      }

      if (type === 'sauce') {
        base.color = color;
      }

      if (type === 'topping') {
        base.properties = toPropertyPayload(extras.properties);
      }

      if (type === 'dish') {
        base.dish_kind = dishKind;

        if (dishKind === 'single') {
          base.sauce_mode = extras.sauces.length > 0 ? 'with' : 'none';
          base.allowed_sauces = extras.sauces;
          base.allowed_drinks = extras.drinks;
          base.allowed_toppings = extras.toppings;
          base.max_sauces = extras.maxSauces || undefined;
          base.max_drinks = extras.maxDrinks || undefined;
          base.max_toppings = extras.maxToppings || undefined;
          base.properties = toPropertyPayload(extras.properties);
        } else {
          base.variants = variants.map<VariantDraftPayload>((v) => ({
            id: v.id,
            name: v.name,
            short_name: v.short_name,
            image_url: v.image_url || null,
            price: v.free ? 0 : v.price,
            free: v.free,
            station: v.station,
            cook_time_min: v.station === 'kitchen' ? v.cook_time_min : null,
            sauce_mode: v.extras.sauces.length > 0 ? 'with' : 'none',
            properties: toPropertyPayload(v.extras.properties),
            allowed_sauces: v.extras.sauces,
            allowed_drinks: v.extras.drinks,
            allowed_toppings: v.extras.toppings,
            max_sauces: v.extras.maxSauces || undefined,
            max_drinks: v.extras.maxDrinks || undefined,
            max_toppings: v.extras.maxToppings || undefined,
          }));
        }
      }

      if (type === 'set') {
        base.set_main_item_id = setMainId || null;

        const main = allItems.find((i) => i.id === setMainId);
        if (main && main.dish_kind === 'group' && main.variants) {
          base.set_main_overrides = main.variants.map((v) => {
            const ov = mainOverrides[v.id];
            return {
              variant_item_id: v.id,
              price_override: ov?.price_override ?? null,
              image_override: ov?.image_override ?? null,
            };
          });
        }

        base.set_extra_groups = extraGroups
          .filter((g) => g.options.length > 0)
          .map<SetExtraGroupPayload>((g) => ({
            label: g.label,
            required: g.required,
            popup: g.popup,
            pick_count: Math.max(1, Math.min(g.pick_count, g.options.length)),
            pick_set: !g.popup && g.pick_set ? true : undefined,
            options: g.options,
          }));
      }

      if (item) {
        await updateItem(item.id, base);
      } else {
        await createItem(base);
      }

      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToSaveItem'));
    } finally {
      setSaving(false);
    }
  };

  const title = (() => {
    const key = `type_${type}` as TranslationKey;
    return (item ? `${t('editItem')}: ` : `${t('newItemForm')}: `) + t(key);
  })();

  const isBusy = saving || pendingOpsCount > 0;

  const handleClose = () => {
    if (isBusy) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.key !== 'Enter') return;
      if (cropState || saving || !name || pendingOpsCount > 0) return;
      ev.preventDefault();
      void handleSave();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <>
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div
          className="bg-white rounded-3xl border border-slate-200 w-full max-w-3xl max-h-[92vh] m-4 shadow-2xl relative flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {pendingOpsCount > 0 && (
            <div className="px-6 py-2 bg-orange-50 border-b border-orange-300 flex items-center gap-2 shrink-0">
              <span className="inline-block w-3.5 h-3.5 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin shrink-0" />
              <span className="text-xs font-bold text-orange-800">
                {t('menuProcessingPhotos').replace(
                  '{n}',
                  String(pendingOpsCount)
                )}
              </span>
            </div>
          )}

          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
            <h3 className="text-xl font-black text-slate-900">{title}</h3>
            <button
              onClick={handleClose}
              disabled={isBusy}
              className="text-slate-500 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
              title={isBusy ? t('menuDoNotClosePhoto') : ''}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-1">
            {error && (
              <div className="mb-3 p-2.5 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm">
                {error}
              </div>
            )}

            {type === 'topping' && (
              <>
                <NameAndShort
                  name={name}
                  shortName={shortName}
                  setName={setName}
                  setShortName={setShortName}
                  t={t}
                />
                <PriceAndFree
                  price={price}
                  free={free}
                  setPrice={setPrice}
                  setFree={setFree}
                  t={t}
                />
                <Field label={t('image')}>
                  <ImageUploader
                    imageUrl={imageUrl}
                    uploading={uploading}
                    onUpload={(f) => requestCrop(f, (url) => setImageUrl(url))}
                    onClear={() => setImageUrl('')}
                    t={t}
                  />
                </Field>
                <Field label={t('station')}>
                  <StationPicker
                    station={station}
                    setStation={setStation}
                    t={t}
                  />
                </Field>
                {station === 'kitchen' && (
                  <Field label={t('cookTimeMin')}>
                    <input
                      type="number"
                      value={cookTimeMin}
                      onChange={(e) => setCookTimeMin(Number(e.target.value))}
                      className="form-input"
                      placeholder="10"
                    />
                  </Field>
                )}
                <ItemExtrasEditor
                  value={extras}
                  onChange={setExtras}
                  allItems={allItems}
                  propertyHistory={propertyHistory}
                  showAddons={false}
                />
              </>
            )}

            {type === 'sauce' && (
              <>
                <NameAndShort
                  name={name}
                  shortName={shortName}
                  setName={setName}
                  setShortName={setShortName}
                  t={t}
                />
                <Field label={t('sauceColor')}>
                  <ColorPicker color={color} setColor={setColor} />
                </Field>
                <Field label={t('image')}>
                  <ImageUploader
                    imageUrl={imageUrl}
                    uploading={uploading}
                    onUpload={(f) => requestCrop(f, (url) => setImageUrl(url))}
                    onClear={() => setImageUrl('')}
                    t={t}
                  />
                </Field>
                <PriceAndFree
                  price={price}
                  free={free}
                  setPrice={setPrice}
                  setFree={setFree}
                  t={t}
                />
              </>
            )}

            {type === 'drink' && (
              <>
                <NameAndShort
                  name={name}
                  shortName={shortName}
                  setName={setName}
                  setShortName={setShortName}
                  t={t}
                />
                <Field label={t('image')}>
                  <ImageUploader
                    imageUrl={imageUrl}
                    uploading={uploading}
                    onUpload={(f) => requestCrop(f, (url) => setImageUrl(url))}
                    onClear={() => setImageUrl('')}
                    t={t}
                  />
                </Field>
                <PriceAndFree
                  price={price}
                  free={free}
                  setPrice={setPrice}
                  setFree={setFree}
                  t={t}
                />
              </>
            )}

            {type === 'dish' && (
              <>
                <NameAndShort
                  name={name}
                  shortName={shortName}
                  setName={setName}
                  setShortName={setShortName}
                  t={t}
                />
                <Field label={t('dishKind')}>
                  <div className="grid grid-cols-2 gap-2">
                    <RadioCard
                      active={dishKind === 'single'}
                      onClick={() => setDishKind('single')}
                      title={t('dishKindSingle')}
                      hint={t('dishKindSingleHint')}
                    />
                    <RadioCard
                      active={dishKind === 'group'}
                      onClick={() => setDishKind('group')}
                      title={t('dishKindGroup')}
                      hint={t('dishKindGroupHint')}
                    />
                  </div>
                </Field>

                {dishKind === 'single' && (
                  <>
                    <Field label={t('image')}>
                      <ImageUploader
                        imageUrl={imageUrl}
                        uploading={uploading}
                        onUpload={(f) =>
                          requestCrop(f, (url) => setImageUrl(url))
                        }
                        onClear={() => setImageUrl('')}
                        t={t}
                      />
                    </Field>
                    <PriceAndFree
                      price={price}
                      free={free}
                      setPrice={setPrice}
                      setFree={setFree}
                      t={t}
                    />
                    <Field label={t('station')}>
                      <StationPicker
                        station={station}
                        setStation={setStation}
                        t={t}
                      />
                    </Field>
                    {station === 'kitchen' && (
                      <Field label={t('cookTimeMin')}>
                        <input
                          type="number"
                          value={cookTimeMin}
                          onChange={(e) =>
                            setCookTimeMin(Number(e.target.value))
                          }
                          className="form-input"
                          placeholder="10"
                        />
                      </Field>
                    )}
                    <ItemExtrasEditor
                      value={extras}
                      onChange={setExtras}
                      allItems={allItems}
                      propertyHistory={propertyHistory}
                    />
                  </>
                )}

                {dishKind === 'group' && (
                  <Field label={t('variants')}>
                    <div className="space-y-3">
                      {variants.map((v, i) => (
                        <div
                          key={i}
                          className="border border-slate-200 rounded-2xl p-4 bg-slate-50/80 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-slate-500 tracking-wide">
                              {t('variant')} #{i + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeVariant(i)}
                              className="text-slate-400 hover:text-red-600"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <input
                              value={v.name}
                              onChange={(e) =>
                                updateVariant(i, 'name', e.target.value)
                              }
                              className="form-input"
                              placeholder={t('name')}
                            />
                            <input
                              value={v.short_name}
                              onChange={(e) =>
                                updateVariant(i, 'short_name', e.target.value)
                              }
                              className="form-input"
                              placeholder={t('shortName')}
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={v.price}
                              onChange={(e) =>
                                updateVariant(
                                  i,
                                  'price',
                                  Number(e.target.value)
                                )
                              }
                              className="form-input flex-1"
                              disabled={v.free}
                              placeholder={t('price')}
                            />
                            <label className="flex items-center gap-1.5 text-xs font-bold whitespace-nowrap">
                              <input
                                type="checkbox"
                                checked={v.free}
                                onChange={(e) =>
                                  updateVariant(i, 'free', e.target.checked)
                                }
                              />
                              {t('free')}
                            </label>
                          </div>

                          <Field label={t('image')}>
                            <ImageUploader
                              imageUrl={v.image_url}
                              uploading={false}
                              onUpload={(f) =>
                                requestCrop(f, (url) =>
                                  updateVariant(i, 'image_url', url)
                                )
                              }
                              onClear={() => updateVariant(i, 'image_url', '')}
                              t={t}
                              compact
                            />
                          </Field>

                          <Field label={t('station')}>
                            <div className="grid grid-cols-2 gap-2">
                              <RadioCard
                                active={v.station === 'ready'}
                                onClick={() =>
                                  updateVariant(i, 'station', 'ready')
                                }
                                title={t('stationReady')}
                                hint=""
                              />
                              <RadioCard
                                active={v.station === 'kitchen'}
                                onClick={() =>
                                  updateVariant(i, 'station', 'kitchen')
                                }
                                title={t('stationKitchen')}
                                hint=""
                              />
                            </div>
                          </Field>
                          {v.station === 'kitchen' && (
                            <Field label={t('cookTimeMin')}>
                              <input
                                type="number"
                                value={v.cook_time_min}
                                onChange={(e) =>
                                  updateVariant(
                                    i,
                                    'cook_time_min',
                                    Number(e.target.value)
                                  )
                                }
                                className="form-input"
                              />
                            </Field>
                          )}

                          <ItemExtrasEditor
                            value={v.extras}
                            onChange={(next) => updateVariant(i, 'extras', next)}
                            allItems={allItems}
                            propertyHistory={propertyHistory}
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addVariant}
                        className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-orange-100 hover:bg-orange-200 text-orange-800 text-xs font-bold w-full justify-center"
                      >
                        <Plus className="w-3.5 h-3.5" /> {t('addDishBtn')}
                      </button>
                    </div>
                  </Field>
                )}
              </>
            )}

            {type === 'set' && (
              <>
                <NameAndShort
                  name={name}
                  shortName={shortName}
                  setName={setName}
                  setShortName={setShortName}
                  t={t}
                />

                <div className="mb-3 p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-[0.6875rem] text-blue-800 font-medium leading-snug">
                  {t('menuSetPriceHint')}
                </div>

                <Field label={t('mainProduct')}>
                  <select
                    value={setMainId}
                    onChange={(e) => {
                      const newMainId = e.target.value;
                      setSetMainId(newMainId);
                      const newMain = allItems.find((i) => i.id === newMainId);
                      if (newMain?.dish_kind === 'group' && newMain.variants) {
                        const auto: Record<
                          string,
                          {
                            price_override: number | null;
                            image_override: string | null;
                          }
                        > = {};
                        for (const v of newMain.variants) {
                          auto[v.id] = {
                            price_override: v.price,
                            image_override: null,
                          };
                        }
                        setMainOverrides(auto);
                      } else {
                        setMainOverrides({});
                      }
                    }}
                    className="form-input"
                  >
                    <option value="">— {t('select')} —</option>
                    {allDishes.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.dish_kind === 'group'
                          ? ` (${d.variants?.length ?? 0} ${t(
                              'variantsShort'
                            )})`
                          : ''}
                      </option>
                    ))}
                  </select>
                </Field>

                {(() => {
                  const main = allItems.find((i) => i.id === setMainId);
                  if (!main) return null;

                  if (main.dish_kind !== 'group' || !main.variants) {
                    return (
                      <div className="mb-3 p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-[0.6875rem] text-blue-800 leading-snug">
                        {t('menuSetNoVariantsHint')}
                      </div>
                    );
                  }

                  return (
                    <Field label={t('menuSetPhotoByVariant')}>
                      <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded-xl text-[0.6875rem] text-amber-800 leading-snug">
                        {t('menuSetPhotoIsSetHint')}
                      </div>

                      <div className="space-y-2">
                        {main.variants.map((v) => {
                          const ov = mainOverrides[v.id] ?? {
                            price_override: null,
                            image_override: null,
                          };
                          const usingOverride = Boolean(ov.image_override);

                          return (
                            <div
                              key={v.id}
                              className="border border-slate-200 rounded-xl p-2.5 bg-slate-50/80 space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-800 truncate">
                                  {v.name}
                                  <span className="ml-1 text-[0.625rem] text-slate-400 font-normal">
                                    (база {formatYen(v.price)})
                                  </span>
                                </span>
                                {usingOverride && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setMainOverrides((m) => ({
                                        ...m,
                                        [v.id]: {
                                          ...ov,
                                          image_override: null,
                                        },
                                      }))
                                    }
                                    className="text-[0.625rem] text-orange-600 font-bold hover:underline shrink-0"
                                  >
                                    {t('menuSetPhotoReset')}
                                  </button>
                                )}
                              </div>

                              <div className="grid grid-cols-12 gap-2 items-center">
                                <input
                                  type="number"
                                  value={ov.price_override ?? ''}
                                  onChange={(e) =>
                                    setMainOverrides((m) => ({
                                      ...m,
                                      [v.id]: {
                                        ...ov,
                                        price_override: e.target.value
                                          ? Number(e.target.value)
                                          : null,
                                      },
                                    }))
                                  }
                                  className="form-input col-span-5 text-xs"
                                  placeholder={t('menuSetPricePlaceholder')}
                                />
                                <div className="col-span-7">
                                  <ImageUploader
                                    imageUrl={ov.image_override ?? ''}
                                    uploading={false}
                                    onUpload={(f) =>
                                      requestCrop(f, (url) =>
                                        setMainOverrides((m) => ({
                                          ...m,
                                          [v.id]: {
                                            ...ov,
                                            image_override: url,
                                          },
                                        }))
                                      )
                                    }
                                    onClear={() =>
                                      setMainOverrides((m) => ({
                                        ...m,
                                        [v.id]: {
                                          ...ov,
                                          image_override: null,
                                        },
                                      }))
                                    }
                                    t={t}
                                    compact
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Field>
                  );
                })()}

                <Field label={t('extraGroups')}>
                  <div className="space-y-3">
                    {extraGroups.map((g, gi) => (
                      <div
                        key={gi}
                        className="border border-slate-200 rounded-2xl p-4 bg-slate-50/80 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-slate-500 tracking-wide">
                            {t('extraGroup')} #{gi + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeExtraGroup(gi)}
                            className="text-slate-400 hover:text-red-600"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <input
                          value={g.label}
                          onChange={(e) =>
                            updateExtraGroup(gi, { label: e.target.value })
                          }
                          className="form-input"
                          placeholder={t('extraGroupLabel')}
                        />
                        <label className="flex items-center gap-1.5 text-xs font-bold">
                          <input
                            type="checkbox"
                            checked={g.required}
                            onChange={(e) =>
                              updateExtraGroup(gi, {
                                required: e.target.checked,
                              })
                            }
                          />
                          {t('required')}
                        </label>
                        <label className="flex items-center gap-1.5 text-xs font-bold">
                          <input
                            type="checkbox"
                            checked={g.popup}
                            onChange={(e) =>
                              updateExtraGroup(gi, {
                                popup: e.target.checked,
                              })
                            }
                          />
                          {t('extraGroupPopup')}
                        </label>
                        {g.options.length > 1 && (
                          <label className="flex items-center gap-2 text-xs font-bold">
                            {t('extraGroupPickCount')}
                            <input
                              type="number"
                              min={1}
                              max={g.options.length}
                              value={
                                g.popup || g.pick_set
                                  ? Math.min(g.pick_count, g.options.length)
                                  : g.options.length
                              }
                              onChange={(e) => {
                                const v = Math.floor(Number(e.target.value) || 1);
                                updateExtraGroup(gi, {
                                  pick_count: Math.max(1, Math.min(v, g.options.length)),
                                  pick_set: true,
                                });
                              }}
                              className="form-input !py-1 !px-2 w-16 text-center"
                            />
                            <span className="text-slate-400 font-semibold">
                              / {g.options.length}
                            </span>
                          </label>
                        )}
                        {!g.popup && (
                          <p className="text-[0.6875rem] text-slate-500 leading-snug">
                            {t('extraGroupAutoHint')}
                            {g.options.length > 1 && ` ${t('extraGroupAutoPickHint')}`}
                          </p>
                        )}
                        <div className="space-y-2">
                          {g.options.map((opt, oi) => {
                            const optItem = allItems.find(
                              (i) => i.id === opt.item_id
                            );
                            return (
                              <div
                                key={oi}
                                className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-2"
                              >
                                {optItem?.image_url ? (
                                  <img
                                    src={optItem.image_url}
                                    alt=""
                                    className="w-9 h-9 rounded-lg object-cover shrink-0"
                                  />
                                ) : (
                                  <div className="w-9 h-9 rounded-lg bg-slate-100 shrink-0" />
                                )}
                                <span className="text-xs font-bold text-slate-800 flex-1 truncate">
                                  {optItem?.name ?? '?'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    removeOptionFromGroup(gi, oi)
                                  }
                                  className="text-slate-400 hover:text-red-600"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => setPickingOption({ groupIndex: gi })}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold w-full justify-center"
                          >
                            <Plus className="w-3.5 h-3.5" /> {t('addOption')}
                          </button>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setGroupPresetOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-orange-100 hover:bg-orange-200 text-orange-800 text-xs font-bold w-full justify-center"
                    >
                      <Plus className="w-3.5 h-3.5" /> {t('addExtraGroup')}
                    </button>
                  </div>
                </Field>
              </>
            )}

            <Field label={t('active')}>
              <label className="flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                {active ? t('active') : t('inactive')}
              </label>
            </Field>
          </div>

          <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0 bg-slate-50">
            <div>
              {onDelete && (
                <button
                  onClick={onDelete}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold hover:bg-red-100 disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('delete')}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClose}
                disabled={isBusy}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-sm font-bold hover:bg-slate-50 disabled:opacity-40"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={isBusy || !name}
                className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-black flex items-center gap-1.5 disabled:opacity-40"
              >
                {saving ? (
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                {t('save')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {groupPresetOpen && (
        <GroupPresetPicker
          counts={{
            sauce: allSauces.length,
            drink: allDrinks.length,
            topping: allToppings.length,
            dish: allDishes.length,
          }}
          onPick={addExtraGroupPreset}
          onCancel={() => setGroupPresetOpen(false)}
        />
      )}

      {pickingOption && (
        <OptionPicker
          items={extraCandidates}
          onCancel={() => setPickingOption(null)}
          onPick={(itemId) => {
            addOptionToGroup(pickingOption.groupIndex, itemId);
            setPickingOption(null);
          }}
        />
      )}

      {cropState && (
        <ImageCropDialog
          open={true}
          file={cropState.file}
          onCancel={cancelCrop}
          onConfirm={(f) => void handleCropConfirm(f)}
        />
      )}
    </>
  );
}

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ КОМПОНЕНТЫ ФОРМЫ
// ============================================================

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-black text-slate-600 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function NameAndShort({
  name,
  shortName,
  setName,
  setShortName,
  t,
}: {
  name: string;
  shortName: string;
  setName: (v: string) => void;
  setShortName: (v: string) => void;
  t: (k: TranslationKey) => string;
}) {
  return (
    <>
      <Field label={t('name')}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="form-input"
          placeholder={t('name')}
        />
      </Field>
      <Field label={t('shortName')}>
        <input
          value={shortName}
          onChange={(e) => setShortName(e.target.value)}
          className="form-input"
          placeholder={t('shortName')}
        />
      </Field>
    </>
  );
}

function PriceAndFree({
  price,
  free,
  setPrice,
  setFree,
  t,
}: {
  price: number;
  free: boolean;
  setPrice: (v: number) => void;
  setFree: (v: boolean) => void;
  t: (k: TranslationKey) => string;
}) {
  return (
    <Field label={t('price')}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          className="form-input flex-1"
          disabled={free}
        />
        <label className="flex items-center gap-1.5 text-xs font-bold whitespace-nowrap">
          <input
            type="checkbox"
            checked={free}
            onChange={(e) => setFree(e.target.checked)}
          />
          {t('free')}
        </label>
      </div>
    </Field>
  );
}

function StationPicker({
  station,
  setStation,
  t,
}: {
  station: Station;
  setStation: (s: Station) => void;
  t: (k: TranslationKey) => string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <RadioCard
        active={station === 'ready'}
        onClick={() => setStation('ready')}
        title={t('stationReady')}
        hint=""
      />
      <RadioCard
        active={station === 'kitchen'}
        onClick={() => setStation('kitchen')}
        title={t('stationKitchen')}
        hint=""
      />
    </div>
  );
}

function ColorPicker({
  color,
  setColor,
}: {
  color: string;
  setColor: (c: string) => void;
}) {
  const colors = [
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#06b6d4',
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
    '#64748b',
    '#0f172a',
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => setColor(c)}
          className={`w-9 h-9 rounded-full border-4 transition-all ${
            color === c ? 'border-slate-900 scale-110' : 'border-white'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

function RadioCard({
  active,
  onClick,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-3 rounded-xl border-2 text-left transition-all ${
        active
          ? 'border-orange-500 bg-orange-50'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="text-sm font-bold text-slate-900">{title}</div>
      {hint && (
        <div className="text-[0.6875rem] text-slate-500 mt-0.5">{hint}</div>
      )}
    </button>
  );
}

function ImageUploader({
  imageUrl,
  uploading,
  onUpload,
  onClear,
  t,
  compact,
}: {
  imageUrl: string;
  uploading: boolean;
  onUpload: (f: File) => void;
  onClear: () => void;
  t: (k: TranslationKey) => string;
  compact?: boolean;
}) {
  const size = compact ? 'w-20 h-20' : 'w-28 h-28';
  return (
    <div className="flex items-center gap-3">
      <div
        className={`${size} rounded-xl overflow-hidden bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center shrink-0`}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <Upload className="w-6 h-6 text-slate-400" />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="cursor-pointer px-3 py-1.5 rounded-lg bg-orange-100 hover:bg-orange-200 text-orange-800 text-xs font-bold text-center">
          {uploading ? t('uploading') : t('upload')}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = '';
            }}
          />
        </label>
        {imageUrl && (
          <button
            type="button"
            onClick={onClear}
            className="px-3 py-1 rounded-lg text-red-600 text-xs font-bold hover:bg-red-50"
          >
            {t('delete')}
          </button>
        )}
      </div>
    </div>
  );
}

type GroupPresetKind = 'empty' | 'sauce' | 'drink' | 'topping' | 'dish';

function GroupPresetPicker({
  counts,
  onPick,
  onCancel,
}: {
  counts: Record<'sauce' | 'drink' | 'topping' | 'dish', number>;
  onPick: (kind: GroupPresetKind) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();

  const cards: {
    kind: GroupPresetKind;
    title: string;
    hint: string;
    icon: React.ReactNode;
    disabled: boolean;
    cls: string;
  }[] = [
    {
      kind: 'sauce',
      title: t('allSauces'),
      hint: `${counts.sauce} ${t('pcs')}`,
      icon: <Droplet className="w-7 h-7" />,
      disabled: counts.sauce === 0,
      cls: 'from-red-500 to-rose-600',
    },
    {
      kind: 'drink',
      title: t('allDrinks'),
      hint: `${counts.drink} ${t('pcs')}`,
      icon: <CupSoda className="w-7 h-7" />,
      disabled: counts.drink === 0,
      cls: 'from-cyan-500 to-blue-600',
    },
    {
      kind: 'topping',
      title: t('allToppings'),
      hint: `${counts.topping} ${t('pcs')}`,
      icon: <Sparkles className="w-7 h-7" />,
      disabled: counts.topping === 0,
      cls: 'from-amber-400 to-yellow-600',
    },
    {
      // все продукты, кроме соусов, напитков и топпингов
      kind: 'dish',
      title: t('allDishes'),
      hint: `${counts.dish} ${t('pcs')}`,
      icon: <UtensilsCrossed className="w-7 h-7" />,
      disabled: counts.dish === 0,
      cls: 'from-blue-500 to-indigo-600',
    },
    {
      kind: 'empty',
      title: t('emptyGroup'),
      hint: t('pickManually'),
      icon: <Plus className="w-7 h-7" />,
      disabled: false,
      cls: 'from-slate-500 to-slate-700',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h4 className="font-black text-slate-900">{t('addExtraGroup')}</h4>
          <button onClick={onCancel}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 grid grid-cols-3 gap-2">
          {cards.map((c) => (
            <button
              key={c.kind}
              type="button"
              disabled={c.disabled}
              onClick={() => onPick(c.kind)}
              className="flex flex-col items-center gap-2 p-3 rounded-2xl border-2 border-slate-200 hover:border-orange-400 hover:bg-orange-50 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              <div
                className={`w-12 h-12 rounded-xl bg-gradient-to-br ${c.cls} text-white flex items-center justify-center shadow-md`}
              >
                {c.icon}
              </div>
              <span className="text-xs font-black text-slate-900 text-center leading-tight">
                {c.title}
              </span>
              <span className="text-[0.6875rem] font-bold text-slate-500">
                {c.hint}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function OptionPicker({
  items,
  onCancel,
  onPick,
}: {
  items: MenuItem[];
  onCancel: () => void;
  onPick: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
          <h4 className="font-black text-slate-900">{t('pickOption')}</h4>
          <button onClick={onCancel}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 grid grid-cols-3 gap-2 content-start">
          {items.length === 0 && (
            <p className="col-span-3 text-xs text-slate-400 text-center mt-4">
              {t('noMenuItems')}
            </p>
          )}
          {items.map((i) => (
            <button
              key={i.id}
              onClick={() => onPick(i.id)}
              className="flex flex-col items-center gap-1 p-1.5 rounded-xl bg-white ring-1 ring-slate-200 hover:ring-orange-400 active:scale-95 transition-all"
            >
              <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-slate-100">
                {i.image_url && (
                  <img
                    src={i.image_url}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
              </div>
              <span className="text-[0.6875rem] font-black text-slate-800 truncate w-full text-center">
                {i.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// КНОПКИ «СОУСЫ / НАПИТКИ / ТОППИНГИ» И «СВОЙСТВА»
// ============================================================
function ItemExtrasEditor({
  value,
  onChange,
  allItems,
  propertyHistory,
  showAddons = true,
}: {
  value: ExtrasForm;
  onChange: (next: ExtrasForm) => void;
  allItems: MenuItem[];
  propertyHistory: HydratedProperty[];
  showAddons?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<AddonKind | 'props' | null>(null);

  const kinds: { kind: AddonKind; label: string; picks: AddonPick[] }[] = [
    { kind: 'sauce', label: t('sectionSauces'), picks: value.sauces },
    { kind: 'drink', label: t('sectionDrinks'), picks: value.drinks },
    { kind: 'topping', label: t('sectionToppings'), picks: value.toppings },
  ];

  const setPicks = (kind: AddonKind, next: AddonPick[]) => {
    if (kind === 'sauce') onChange({ ...value, sauces: next });
    else if (kind === 'drink') onChange({ ...value, drinks: next });
    else onChange({ ...value, toppings: next });
  };

  const btn =
    'flex flex-col items-center justify-center gap-0.5 px-3 py-3 rounded-xl border-2 text-sm font-black transition-all active:scale-[0.98]';
  const btnOn = 'bg-orange-50 border-orange-300 text-orange-800';
  const btnOff = 'bg-white border-slate-200 text-slate-700 hover:border-orange-300';

  const namedProps = value.properties.filter((p) => p.name.trim()).length;
  const openKind = open && open !== 'props' ? open : null;

  return (
    <div className="space-y-2 mb-3">
      {showAddons && (
        <div className="grid grid-cols-3 gap-2">
          {kinds.map(({ kind, label, picks }) => (
            <button
              key={kind}
              type="button"
              onClick={() => setOpen(kind)}
              className={`${btn} ${picks.length > 0 ? btnOn : btnOff}`}
            >
              <span>{label}</span>
              <span className="text-[0.6875rem] font-bold opacity-70">
                {picks.length} / {addonPool(allItems, kind).length}
              </span>
            </button>
          ))}
        </div>
      )}

      {showAddons && (
        <div className="grid grid-cols-3 gap-2">
          {kinds.map(({ kind, label, picks }) => {
            const key =
              kind === 'sauce' ? 'maxSauces' : kind === 'drink' ? 'maxDrinks' : 'maxToppings';
            const cur = value[key];
            const defaultMax = kind === 'sauce' ? 2 : 0;
            const shown = cur || defaultMax;
            return (
              <label
                key={kind}
                className={`flex items-center justify-between gap-1 text-[0.6875rem] font-bold text-slate-600 ${
                  picks.length > 1 ? '' : 'opacity-40'
                }`}
                title={t('maxPickLabel')}
              >
                <span className="truncate">{t('maxPickLabel')}</span>
                <input
                  type="number"
                  min={0}
                  max={picks.length}
                  disabled={picks.length <= 1}
                  value={shown || ''}
                  placeholder="∞"
                  onChange={(e) => {
                    const v = Math.floor(Number(e.target.value) || 0);
                    onChange({ ...value, [key]: Math.max(0, Math.min(v, picks.length)) });
                  }}
                  className="form-input !py-1 !px-1 w-12 text-center"
                />
              </label>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen('props')}
        className={`${btn} w-full flex-row gap-2 ${namedProps > 0 ? btnOn : btnOff}`}
      >
        <span>{t('properties')}</span>
        {namedProps > 0 && (
          <span className="text-[0.6875rem] font-bold opacity-70">{namedProps}</span>
        )}
      </button>

      {openKind && (
        <AddonPickerModal
          kind={openKind}
          items={addonPool(allItems, openKind)}
          picks={kinds.find((k) => k.kind === openKind)!.picks}
          onChange={(next) => setPicks(openKind, next)}
          onClose={() => setOpen(null)}
        />
      )}

      {open === 'props' && (
        <PropertiesModal
          properties={value.properties}
          history={propertyHistory}
          onChange={(next) => onChange({ ...value, properties: next })}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function AddonPickerModal({
  kind,
  items,
  picks,
  onChange,
  onClose,
}: {
  kind: AddonKind;
  items: MenuItem[];
  picks: AddonPick[];
  onChange: (next: AddonPick[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const title = t(
    kind === 'sauce'
      ? 'sectionSauces'
      : kind === 'drink'
      ? 'sectionDrinks'
      : 'sectionToppings'
  );
  const byId = new Map(picks.map((p) => [p.id, p]));
  const allSelected = items.length > 0 && items.every((i) => byId.has(i.id));

  const toggle = (id: string) =>
    onChange(
      byId.has(id)
        ? picks.filter((p) => p.id !== id)
        : [...picks, { id, extra_price: 0 }]
    );
  const setPrice = (id: string, v: number) =>
    onChange(picks.map((p) => (p.id === id ? { ...p, extra_price: v } : p)));
  const selectAll = () =>
    onChange(items.map((i) => byId.get(i.id) ?? { id: i.id, extra_price: 0 }));

  return (
    <div
      className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
          <h4 className="font-black text-slate-900">
            {title}{' '}
            <span className="text-slate-400 font-bold text-sm">
              {picks.length} / {items.length}
            </span>
          </h4>
          <button type="button" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {items.length > 0 && (
          <div className="px-4 py-2 border-b flex gap-2 shrink-0">
            <button
              type="button"
              onClick={selectAll}
              disabled={allSelected}
              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-xs font-bold text-slate-800"
            >
              {t('addonSelectAll')}
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={picks.length === 0}
              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-xs font-bold text-slate-800"
            >
              {t('addonClearAll')}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {items.length === 0 && (
            <p className="text-xs text-slate-400 text-center mt-4">
              {t('addonNoItems')}
            </p>
          )}
          {items.map((i) => {
            const pick = byId.get(i.id);
            const on = !!pick;
            return (
              <div
                key={i.id}
                className={`flex items-center gap-3 p-2 rounded-xl border transition-colors ${
                  on
                    ? 'border-orange-300 bg-orange-50'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(i.id)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <span
                    className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                      on
                        ? 'bg-orange-500 text-white'
                        : 'border-2 border-slate-300'
                    }`}
                  >
                    {on && <Check className="w-3.5 h-3.5" />}
                  </span>
                  <span
                    className="relative w-10 h-10 rounded-lg overflow-hidden bg-slate-100 shrink-0"
                    style={{ border: `2px solid ${i.color ?? '#e5e7eb'}` }}
                  >
                    {i.image_url && (
                      <img
                        src={i.image_url}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    )}
                  </span>
                  <span className="font-bold text-sm text-slate-800 truncate">
                    {i.name}
                  </span>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[0.6875rem] font-bold text-slate-500">
                    {t('addonExtraPrice')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    disabled={!on}
                    value={pick && pick.extra_price > 0 ? pick.extra_price : ''}
                    placeholder="0"
                    onChange={(e) =>
                      setPrice(i.id, Math.max(0, Number(e.target.value) || 0))
                    }
                    className="form-input w-20 text-right"
                  />
                  <span className="text-xs font-bold text-slate-500">¥</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm"
          >
            {t('addonDone')}
          </button>
        </div>
      </div>
    </div>
  );
}

function PropertiesModal({
  properties,
  history,
  onChange,
  onClose,
}: {
  properties: HydratedProperty[];
  history: HydratedProperty[];
  onChange: (next: HydratedProperty[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const add = () =>
    onChange([
      ...properties,
      {
        id: `new-${uuid()}`,
        item_id: '',
        name: '',
        options: [],
        required: false,
        sort_order: properties.length,
      },
    ]);
  const patch = (idx: number, p: Partial<HydratedProperty>) =>
    onChange(properties.map((x, i) => (i === idx ? { ...x, ...p } : x)));
  const remove = (idx: number) =>
    onChange(properties.filter((_, i) => i !== idx));

  return (
    <div
      className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
          <div>
            <h4 className="font-black text-slate-900">{t('properties')}</h4>
            <p className="text-[0.6875rem] text-slate-400">{t('propertySingleValueHint')}</p>
          </div>
          <button type="button" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {properties.map((p, i) => (
            <div
              key={p.id || i}
              className="flex items-center gap-2 border border-slate-200 rounded-xl p-2 bg-white"
            >
              <input
                list={`props-history-${i}`}
                value={p.name}
                onChange={(e) => patch(i, { name: e.target.value })}
                className="form-input flex-1 min-w-0"
                placeholder={t('propertyName')}
              />
              <datalist id={`props-history-${i}`}>
                {history.map((h) => (
                  <option key={h.name} value={h.name} />
                ))}
              </datalist>
              <input
                value={p.options[0] ?? ''}
                onChange={(e) =>
                  patch(i, {
                    options: e.target.value === '' ? [] : [e.target.value],
                  })
                }
                className="form-input flex-1 min-w-0"
                placeholder={t('propertyValuePlaceholder')}
                aria-label={t('propertyValue')}
              />
              <div className="relative shrink-0 w-24">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={10}
                  value={p.price ? p.price : ''}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    patch(i, {
                      price: Number.isFinite(n) && n > 0 ? Math.round(n) : 0,
                    });
                  }}
                  className="form-input w-full !pr-6 text-right tabular-nums"
                  placeholder="0"
                  aria-label={t('price')}
                  title={t('price')}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">
                  ¥
                </span>
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-slate-400 hover:text-red-600 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={add}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold w-full justify-center"
          >
            <Plus className="w-3.5 h-3.5" /> {t('addProperty')}
          </button>
        </div>

        <div className="p-3 border-t shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm"
          >
            {t('addonDone')}
          </button>
        </div>
      </div>
    </div>
  );
}
