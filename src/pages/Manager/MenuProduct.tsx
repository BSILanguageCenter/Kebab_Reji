// src/pages/Manager/MenuProduct.tsx
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
} from '@/services/menu';
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
import { useViewport } from '@/lib/useViewport';
import {
  MenuCardMenu,
  type MenuCardMenuState,
} from '@/components/MenuCardMenu';
import { StorageBar } from '@/components/StorageBar';
import { PageActions } from '@/components/PageActions';
import {
  useLayoutSettings,
  clampLayout,
  snapValue,
  DEFAULT_LAYOUT,
  type LayoutSettings,
} from '@/lib/layoutSettings';
import type {
  MenuItem,
  MenuItemType,
  Station,
  DishKind,
  SauceMode,
  HydratedProperty,
  Order,
} from '@/types/database';
import {
  Plus,
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
  ClipboardList,
} from 'lucide-react';

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

function getItemWidth(item: MenuItem): number {
  if (item.type === 'dish' && item.dish_kind === 'group') {
    return Math.max(1, item.variants?.length ?? 1);
  }
  if (item.type === 'set' && item.set_main?.dish_kind === 'group') {
    return Math.max(1, item.set_main.variants?.length ?? 1);
  }
  return 1;
}

const EMPTY_ROWS_AFTER = 3;

function hasSortConflicts(tops: MenuItem[]): boolean {
  const spaces: CategorySpace[] = ['dishset', 'drink', 'sauce', 'topping'];
  for (const sp of spaces) {
    const seen = new Set<number>();
    for (const it of tops) {
      if (getSpaceOfType(it.type) !== sp) continue;
      if (seen.has(it.sort_order)) return true;
      seen.add(it.sort_order);
    }
  }
  return false;
}

function buildCategorizedOrder(
  tops: MenuItem[],
  colsBySpace: Partial<Record<CategorySpace, number>> = {}
): { id: string; sort_order: number }[] {
  const updates: { id: string; sort_order: number }[] = [];

  const pack = (arr: MenuItem[], cols?: number) => {
    let cursor = 0;
    for (const it of arr) {
      const w = getItemWidth(it);
      if (cols && w <= cols && (cursor % cols) + w > cols) {
        cursor = Math.ceil(cursor / cols) * cols;
      }
      updates.push({ id: it.id, sort_order: cursor });
      cursor += w;
    }
  };

  const sortKeyOf = (it: MenuItem): number => {
    if (it.type === 'dish') return it.dish_kind === 'group' ? 1 : 0;
    return 2;
  };

  const dsItems = tops
    .filter((it) => it.type === 'dish' || it.type === 'set')
    .sort((a, b) => {
      const ka = sortKeyOf(a);
      const kb = sortKeyOf(b);
      if (ka !== kb) return ka - kb;
      return a.sort_order - b.sort_order;
    });
  pack(dsItems, colsBySpace.dishset);

  for (const sp of ['drink', 'sauce', 'topping'] as CategorySpace[]) {
    const arr = tops
      .filter((it) => getSpaceOfType(it.type) === sp)
      .sort((a, b) => a.sort_order - b.sort_order);
    pack(arr, colsBySpace[sp]);
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
    const iStart = it.sort_order;
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
    const iStart = it.sort_order;
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
    maxEnd = Math.max(maxEnd, it.sort_order + getItemWidth(it));
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
    maxSlot = Math.max(maxSlot, it.sort_order + getItemWidth(it));
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
  const [cols, setCols] = useState(1);

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
  minEmptyRows: number
): LayoutCell[] {
  const cells: LayoutCell[] = [];
  const occupied = new Set<number>();
  let maxRow = 0;

  for (const it of items) {
    const w = getItemWidth(it);
    const span = Math.min(w, cols);

    const row = Math.floor(it.sort_order / cols);
    let col = it.sort_order % cols;
    if (col + span > cols) col = cols - span;

    for (let k = 0; k < span; k++) {
      occupied.add(row * cols + (col + k));
    }
    maxRow = Math.max(maxRow, row);

    cells.push({ row, col, width: span, slot: it.sort_order, item: it });
  }

  const totalRows = maxRow + 1 + minEmptyRows;
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < cols; c++) {
      const slot = r * cols + c;
      if (occupied.has(slot)) continue;
      cells.push({ row: r, col: c, width: 1, slot, item: null });
    }
  }

  return cells;
}

function GridSpace({
  space,
  size,
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
  const cols = useGridCols(gridRef, size, layout.gridGap);

  useEffect(() => {
    registerCols(space, cols);
  }, [space, cols, registerCols]);

  const spaceItems = useMemo(
    () => getSpaceItems(allTops, space),
    [allTops, space]
  );

  const cells = useMemo(
    () => buildRenderLayout(spaceItems, cols, EMPTY_ROWS_AFTER),
    [spaceItems, cols]
  );

  const gap = layout.gridGap;
  let cellH = Math.round(
    size + (compact ? 32 : 50) * (layout.itemTextSize / 12)
  );
  // строка должна вмещать самую высокую группу — тогда зазоры равны
  for (const it of spaceItems) {
    const w = getItemWidth(it);
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
        const isHighlighted = highlightSlot === card.sort_order;
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
            data-slot-index={card.sort_order}
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
const SAMPLE_CART: { id: string; name: string; qty: number; price: number }[] =
  [
    { id: 'c1', name: 'Шаурма классик', qty: 2, price: 350 },
    { id: 'c2', name: 'Кола', qty: 1, price: 150 },
  ];

// Примеры заказов: показываются в левой колонке, когда реальных заказов нет
const SAMPLE_ORDERS: {
  id: string;
  number: number;
  status: string;
  total: number;
  time: string;
  sample: boolean;
}[] = [
  { id: 's1', number: 14, status: 'NEW', total: 420, time: 'только что', sample: true },
  { id: 's2', number: 13, status: 'READY', total: 1200, time: '1 мин', sample: true },
  { id: 's3', number: 12, status: 'PREPARING', total: 850, time: '3 мин', sample: true },
];

function CartSample({
  cartItemGap,
  cardRadius,
}: {
  cartItemGap: number;
  cardRadius: number;
}) {
  const { t } = useI18n();
  const total = SAMPLE_CART.reduce((s, c) => s + c.qty * c.price, 0);
  return (
    <>
      <div className="px-4 py-3 border-b border-slate-200 shrink-0">
        <h2 className="text-base font-black text-slate-900">
          {t('currentOrder')}
        </h2>
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-auto p-2 bg-slate-50 flex flex-col"
        style={{ rowGap: cartItemGap }}
      >
        {SAMPLE_CART.map((c) => (
          <div
            key={c.id}
            className="bg-white border-2 border-slate-200 p-3 shadow-sm"
            style={{ borderRadius: cardRadius }}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm font-bold text-slate-900 truncate">
                {c.name}
              </span>
              <span className="text-sm font-black text-slate-700 tabular-nums">
                {formatYen(c.price * c.qty)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 font-black">
                −
              </div>
              <span className="text-lg font-black w-8 text-center tabular-nums">
                {c.qty}
              </span>
              <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-700 font-black">
                +
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-slate-200 bg-white shrink-0">
        <div className="flex items-end justify-between">
          <span className="text-sm font-bold text-slate-500">{t('total')}</span>
          <span className="text-2xl font-black text-slate-900 tabular-nums leading-none">
            {formatYen(total)}
          </span>
        </div>
        <div className="mt-3 w-full h-12 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-black flex items-center justify-center text-sm shadow-lg shadow-orange-500/30">
          {t('sendToKitchen')}
        </div>
      </div>
    </>
  );
}

export function MenuProduct() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<MenuItem[]>([]);
  const itemsRef = useRef<MenuItem[]>([]);
  itemsRef.current = items;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickingType, setPickingType] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [formType, setFormType] = useState<MenuItemType | null>(null);

  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'dish' | 'set'>('all');
  const [productsOpen, setProductsOpen] = useState(false);

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
  const [settingsWindowOpen, setSettingsWindowOpen] = useState(false);

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
  const { scale: ui, device } = useViewport();
  const isDesktop = device === 'desktop';

  // Только для не-desktop режима (там остаются вкладки категорий)
  const [activeCat, setActiveCat] = useState<CategorySpace>('dishset');

  const drinksWrapRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => {
    const s = (v: number) => Math.round(v * ui);
    return {
      ...rawLayout,
      ordersWidth: s(rawLayout.ordersWidth),
      menuRightWidth: s(rawLayout.menuRightWidth),
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
  const registerCols = useCallback((s: CategorySpace, c: number) => {
    colsRef.current[s] = c;
  }, []);

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
          const updates = buildCategorizedOrder(tops);
          await reorderItems(updates);
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
    setItems((prev) =>
      prev.map((it) => {
        const newOrder = updateMap.get(it.id);
        return newOrder != null ? { ...it, sort_order: newOrder } : it;
      })
    );
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
        (i) => i.sort_order === targetSlot && i.id !== fromItem.id
      );

      if (targetCard) {
        if (targetCard.sort_order === fromItem.sort_order) return;

        const wB = getItemWidth(targetCard);
        const newFromStart = targetCard.sort_order;
        const newTargetStart = fromItem.sort_order;
        const excludeIds = new Set([fromItem.id, targetCard.id]);

        const fromFits =
          fitsInRow(newFromStart, w, cols) &&
          isRangeFreeMulti(spaceItems, newFromStart, w, excludeIds);
        const targetFits =
          fitsInRow(newTargetStart, wB, cols) &&
          isRangeFreeMulti(spaceItems, newTargetStart, wB, excludeIds);

        if (fromFits && targetFits) {
          setItems((prev) =>
            prev.map((it) => {
              if (it.id === fromItem.id) {
                return { ...it, sort_order: newFromStart };
              }
              if (it.id === targetCard.id) {
                return { ...it, sort_order: newTargetStart };
              }
              return it;
            })
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
        if (dest < 0 || dest === fromItem.sort_order) return;
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

      if (dest === fromItem.sort_order) return;
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
        item.sort_order + direction,
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
        { id: item.id, sort_order: item.sort_order + direction },
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
        await saveStyle(name, rawLayout);
        setSaveDialogOpen(false);
        setStyleNotice(`${t('styleSaved')}: ${name}`);
      } catch (e) {
        setStyleError(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setStyleSyncing('idle');
      }
    },
    [rawLayout, t]
  );

  const openLoadDialog = useCallback(() => {
    if (styleSyncing !== 'idle') return;
    setStyleError(null);
    setStyleNotice(null);
    setLoadDialogOpen(true);
  }, [styleSyncing]);

  const applyLoadedStyle = useCallback(
    (style: SavedStyle) => {
      setLayout({ ...DEFAULT_LAYOUT, ...style.layout });
      setLoadDialogOpen(false);
      setStyleNotice(`${t('styleLoaded')}: ${style.name}`);
    },
    [setLayout, t]
  );

  const q = query.trim().toLowerCase();
  const leftList: { item: MenuItem; kind: 'dish' | 'set' }[] = [
    ...allTops
      .filter((i) => i.type === 'dish')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ item: i, kind: 'dish' as const })),
    ...allTops
      .filter((i) => i.type === 'set')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ item: i, kind: 'set' as const })),
  ].filter(
    ({ item, kind }) =>
      (kindFilter === 'all' || kindFilter === kind) &&
      (!q ||
        item.name.toLowerCase().includes(q) ||
        (item.short_name ?? '').toLowerCase().includes(q))
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
      }));

  const ordersInner = (
    <>
      <div className="px-3 py-2 border-b border-slate-200 shrink-0 bg-slate-50">
        <h2
          className="font-black text-slate-700 tracking-wide border-l-4 border-slate-400 pl-2 leading-none"
          style={{ fontSize: hdrSize }}
        >
          {t('activeOrders')}
        </h2>
        <span
          className="font-black text-orange-600 leading-none mt-1.5 block pl-2 tabular-nums"
          style={{ fontSize: numSize }}
        >
          {displayOrders.length}
        </span>
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
            </div>
          );
        })}
      </div>
    </>
  );

  // ---------- Desktop: касса — orders | dish+toppings | drinks+sauces | cart ----------
  const desktopLayout = (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* LEFT: ORDERS */}
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

      {/* CENTER: блюда/сеты + топпинги снизу */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-slate-100">
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-orange-100 border-l-4 border-orange-500">
              <h3
                className="font-black text-orange-800 tracking-wide truncate leading-none"
                style={{ fontSize: hdrSize }}
              >
                {t('bludiAndSet')} · {t('dragHintShort')}
              </h3>
            </div>
          </div>
          {renderSpace('dishset')}
        </div>

        <Resizer
          direction="horizontal"
          onStart={beginResize}
          onResize={handleResizeToppings}
          onEnd={endResize}
        />
        <div
          className="shrink-0 bg-white px-2 py-1.5 overflow-hidden border-t-2 border-purple-300"
          style={{ height: layout.toppingsHeight }}
        >
          <h3
            className="font-black text-purple-800 tracking-wide mb-1 border-l-4 border-purple-500 pl-2 leading-none"
            style={{ fontSize: hdrSize }}
          >
            {t('type_topping')}
          </h3>
          <div className="overflow-y-auto h-[calc(100%-16px)]">
            {renderSpace('topping')}
          </div>
        </div>
      </div>

      <Resizer
        onStart={beginResize}
        onResize={handleResizeMenuRight}
        onEnd={endResize}
      />

      {/* RIGHT: напитки сверху, соусы снизу */}
      <div
        ref={drinksWrapRef}
        className="shrink-0 bg-white border-l border-slate-300 flex flex-col min-h-0"
        style={{ width: layout.menuRightWidth }}
      >
        <div
          className="flex flex-col border-b-2 border-cyan-300"
          style={{ height: `${layout.drinksShare}%` }}
        >
          <div className="px-2 py-1.5 border-b border-cyan-200 shrink-0 bg-cyan-50">
            <h3
              className="font-black text-cyan-800 tracking-wide border-l-4 border-cyan-500 pl-2 leading-none"
              style={{ fontSize: hdrSize }}
            >
              {t('type_drink')}
            </h3>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {renderSpace('drink')}
          </div>
        </div>

        <Resizer
          direction="horizontal"
          onStart={beginResize}
          onResize={handleResizeDrinks}
          onEnd={endResize}
        />

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-2 py-1.5 border-b border-red-200 shrink-0 bg-red-50">
            <h3
              className="font-black text-red-800 tracking-wide border-l-4 border-red-500 pl-2 leading-none"
              style={{ fontSize: hdrSize }}
            >
              {t('type_sauce')}
            </h3>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {renderSpace('sauce')}
          </div>
        </div>
      </div>

      <Resizer
        onStart={beginResize}
        onResize={handleResizeCart}
        onEnd={endResize}
      />

      {/* CART (пример, чтобы видеть реальную ширину) */}
      <div
        className="shrink-0 bg-white border-l border-slate-300 flex flex-col min-h-0"
        style={{ width: layout.cartWidth }}
      >
        <CartSample
          cartItemGap={layout.cartItemGap}
          cardRadius={layout.cardRadius}
        />
      </div>
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
      {/* === ШАПКА (PageActions) === */}
      <PageActions forRole="manager">
        <div className="flex items-center gap-2">
          {/* Dropdown: Products List */}
          <div className="relative">
            <button
              onClick={() => setProductsOpen((v) => !v)}
              className="flex items-center gap-2 px-3 py-2 sm:px-5 sm:py-3 rounded-xl text-sm font-bold border-2 border-blue-200 bg-white hover:border-blue-400 hover:bg-blue-50 text-blue-700 active:scale-95 transition-all"
            >
              <ClipboardList className="w-4 h-4" />
              <span className="hidden sm:inline">{t('productsByCategory')}</span>
            </button>

            {/* Backdrop */}
            {productsOpen && (
              <div
                className="fixed inset-0 z-40"
                onClick={() => setProductsOpen(false)}
              />
            )}

            {/* Dropdown body */}
            {productsOpen && (
              <div className="absolute top-full left-0 mt-2 w-80 max-h-[80vh] bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-slate-200 bg-slate-50 space-y-2 shrink-0">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-sm text-slate-800">
                      {t('productsByCategory')}
                    </span>
                    <button onClick={() => setProductsOpen(false)}>
                      <X className="w-4 h-4 text-slate-400 hover:text-slate-700" />
                    </button>
                  </div>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="form-input !py-1.5 text-xs"
                    placeholder="Поиск…"
                  />
                  <div className="flex gap-1">
                    {(
                      [
                        ['all', 'Все'],
                        ['dish', 'Блюда'],
                        ['set', 'Сеты'],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => setKindFilter(k)}
                        className={`flex-1 py-1.5 rounded-lg text-[0.6875rem] font-bold ${
                          kindFilter === k
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                  {leftList.length === 0 && (
                    <p className="text-xs text-slate-400 text-center mt-4">
                      {t('noMenuItems')}
                    </p>
                  )}
                  {leftList.map(({ item, kind }) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        startEdit(item);
                        setProductsOpen(false);
                      }}
                      className={`w-full text-left p-2.5 rounded-xl border border-slate-200 bg-white shadow-sm hover:border-orange-400 hover:bg-orange-50 transition-all ${
                        !item.active ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {item.name}
                        </span>
                        <span
                          className={`text-[0.5625rem] font-black px-1.5 py-0.5 rounded-full shrink-0 ${
                            kind === 'set'
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {kind === 'set' ? 'SET' : 'DSH'}
                        </span>
                      </div>
                      <div className="text-[0.6875rem] text-slate-500 mt-0.5 tabular-nums">
                        {item.free ? '' : formatYen(item.price)}
                      </div>
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setPickingType(true);
                      setProductsOpen(false);
                    }}
                    className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-black mt-2 flex items-center justify-center gap-1"
                  >
                    <Plus className="w-4 h-4" /> {t('addProduct')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Settings Button */}
          <button
            onClick={() => setSettingsWindowOpen(true)}
            className="flex items-center gap-2 px-3 py-2 sm:px-5 sm:py-3 rounded-xl text-sm font-bold border-2 border-violet-200 bg-white hover:border-violet-400 hover:bg-violet-50 text-violet-700 active:scale-95 transition-all"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden sm:inline">{t('styleSettingsBtn')}</span>
          </button>
        </div>
      </PageActions>

      {error && (
        <div className="m-3 p-3 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {isDesktop ? desktopLayout : compactLayout}

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

      {settingsWindowOpen && (
        <FloatingWindow
          title={t('styleSettingsWindowTitle')}
          storageKey="kebab-panel-settings-window"
          initialPos={{ x: 60, y: 100 }}
          width={420}
          onClose={() => setSettingsWindowOpen(false)}
        >
          <div className="p-4 flex flex-col gap-4">
            <StorageBar onImportComplete={() => loadData(true)} />

            <div className="h-px bg-slate-200" />

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
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
  allowed_sauce_ids: string[];
  properties: HydratedProperty[];
};

type ExtraGroupForm = {
  label: string;
  required: boolean;
  options: {
    item_id: string;
    price_override: number | null;
    image_override: string | null;
  }[];
};

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
  const { t, lang } = useI18n();

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
  const [allowedSauceIds, setAllowedSauceIds] = useState<string[]>(
    item?.allowed_sauces?.map((s) => s.id) ?? []
  );
  const [properties, setProperties] = useState<HydratedProperty[]>(
    item?.properties ?? []
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
      allowed_sauce_ids: v.allowed_sauces?.map((s) => s.id) ?? [],
      properties: v.properties ?? [],
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
      const tempId = item?.id ?? crypto.randomUUID();
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
  const allDishes = allItems.filter(
    (i) => i.type === 'dish' && !i.parent_id && i.active
  );
  const extraCandidates = allItems.filter(
    (i) =>
      i.active &&
      !i.parent_id &&
      (i.type === 'drink' || i.type === 'topping' || i.type === 'dish')
  );

  const addProperty = () => {
    setProperties((p) => [
      ...p,
      {
        id: `new-${crypto.randomUUID()}`,
        item_id: item?.id ?? '',
        name: '',
        options: [],
        required: false,
        sort_order: p.length,
      },
    ]);
  };
  const updateProperty = (idx: number, patch: Partial<HydratedProperty>) => {
    setProperties((p) => p.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  };
  const removeProperty = (idx: number) => {
    setProperties((p) => p.filter((_, i) => i !== idx));
  };

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
        allowed_sauce_ids: [],
        properties: [],
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

  const addVariantProperty = (varIdx: number) => {
    setVariants((arr) =>
      arr.map((v, i) =>
        i === varIdx
          ? {
              ...v,
              properties: [
                ...v.properties,
                {
                  id: `new-${crypto.randomUUID()}`,
                  item_id: '',
                  name: '',
                  options: [],
                  required: false,
                  sort_order: v.properties.length,
                },
              ],
            }
          : v
      )
    );
  };
  const updateVariantProperty = (
    varIdx: number,
    propIdx: number,
    patch: Partial<HydratedProperty>
  ) => {
    setVariants((arr) =>
      arr.map((v, i) =>
        i === varIdx
          ? {
              ...v,
              properties: v.properties.map((p, j) =>
                j === propIdx ? { ...p, ...patch } : p
              ),
            }
          : v
      )
    );
  };
  const removeVariantProperty = (varIdx: number, propIdx: number) => {
    setVariants((arr) =>
      arr.map((v, i) =>
        i === varIdx
          ? { ...v, properties: v.properties.filter((_, j) => j !== propIdx) }
          : v
      )
    );
  };

  const addExtraGroup = () => {
    setExtraGroups((g) => [...g, { label: '', required: true, options: [] }]);
  };
  /** Новая группа: пустая, со всеми соусами или со всеми напитками. */
  const addExtraGroupPreset = (kind: 'empty' | 'sauce' | 'drink') => {
    setGroupPresetOpen(false);
    if (kind === 'empty') {
      addExtraGroup();
      return;
    }
    const source = kind === 'sauce' ? allSauces : allDrinks;
    setExtraGroups((g) => [
      ...g,
      {
        label: t(kind === 'sauce' ? 'type_sauce' : 'type_drink'),
        required: true,
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
        image_url: imageUrl || null,
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

      if (type === 'dish') {
        base.dish_kind = dishKind;

        if (dishKind === 'single') {
          base.sauce_mode = allowedSauceIds.length > 0 ? 'with' : 'none';
          base.allowed_sauce_ids = allowedSauceIds;
          base.properties = properties
            .filter((p) => p.name.trim())
            .map((p) => ({
              name: p.name,
              options: p.options ?? [],
              required: p.required ?? false,
            }));
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
            sauce_mode: v.allowed_sauce_ids.length > 0 ? 'with' : 'none',
            properties: v.properties
              .filter((p) => p.name.trim())
              .map((p) => ({
                name: p.name,
                options: p.options ?? [],
                required: p.required ?? false,
              })),
            allowed_sauce_ids: v.allowed_sauce_ids,
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
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
                <Field label={t('properties')}>
                  <PropertiesEditor
                    properties={properties}
                    history={propertyHistory}
                    onChange={updateProperty}
                    onAdd={addProperty}
                    onRemove={removeProperty}
                    t={t}
                  />
                </Field>
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
                    <Field label={t('properties')}>
                      <PropertiesEditor
                        properties={properties}
                        history={propertyHistory}
                        onChange={updateProperty}
                        onAdd={addProperty}
                        onRemove={removeProperty}
                        t={t}
                      />
                    </Field>
                    <Field label={t('allowedSauces')}>
                      <ItemTilePicker
                        items={allSauces}
                        selectedIds={allowedSauceIds}
                        onChange={setAllowedSauceIds}
                      />
                    </Field>
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

                          <Field label={t('properties')}>
                            <PropertiesEditor
                              properties={v.properties}
                              history={propertyHistory}
                              onChange={(idx, patch) =>
                                updateVariantProperty(i, idx, patch)
                              }
                              onAdd={() => addVariantProperty(i)}
                              onRemove={(idx) => removeVariantProperty(i, idx)}
                              t={t}
                            />
                          </Field>

                          <Field label={t('allowedSauces')}>
                            <ItemTilePicker
                              items={allSauces}
                              selectedIds={v.allowed_sauce_ids}
                              onChange={(ids) =>
                                updateVariant(i, 'allowed_sauce_ids', ids)
                              }
                            />
                          </Field>
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

                <Field label={t('image')}>
                  <ImageUploader
                    imageUrl={imageUrl}
                    uploading={uploading}
                    onUpload={(f) => requestCrop(f, (url) => setImageUrl(url))}
                    onClear={() => setImageUrl('')}
                    t={t}
                  />
                  <p className="mt-1.5 text-[0.6875rem] text-slate-500 leading-snug">
                    {lang === 'ru'
                      ? 'Фото самого сета: показывается у всех вариантов, у которых ниже не загружено своё фото.'
                      : 'Photo of the set itself: used for every variant that has no own photo below.'}
                  </p>
                </Field>

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
          sauceCount={allSauces.length}
          drinkCount={allDrinks.length}
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

function PropertiesEditor({
  properties,
  history,
  onChange,
  onAdd,
  onRemove,
  t,
}: {
  properties: HydratedProperty[];
  history: HydratedProperty[];
  onChange: (idx: number, patch: Partial<HydratedProperty>) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  t: (k: TranslationKey) => string;
}) {
  return (
    <div className="space-y-2">
      {properties.map((p, i) => (
        <div
          key={p.id || i}
          className="border border-slate-200 rounded-xl p-3 bg-white space-y-2"
        >
          <div className="flex items-center gap-2">
            <input
              list={`props-history-${i}`}
              value={p.name}
              onChange={(e) => onChange(i, { name: e.target.value })}
              className="form-input flex-1"
              placeholder={t('propertyName')}
            />
            <datalist id={`props-history-${i}`}>
              {history.map((h) => (
                <option key={h.name} value={h.name} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="text-slate-400 hover:text-red-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            value={p.options.join(', ')}
            onChange={(e) =>
              onChange(i, {
                options: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            className="form-input text-xs"
            placeholder={t('propertyOptions')}
          />
          <label className="flex items-center gap-1.5 text-xs font-bold">
            <input
              type="checkbox"
              checked={p.required}
              onChange={(e) => onChange(i, { required: e.target.checked })}
            />
            {t('required')}
          </label>
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold w-full justify-center"
      >
        <Plus className="w-3.5 h-3.5" /> {t('addProperty')}
      </button>
    </div>
  );
}

function GroupPresetPicker({
  sauceCount,
  drinkCount,
  onPick,
  onCancel,
}: {
  sauceCount: number;
  drinkCount: number;
  onPick: (kind: 'empty' | 'sauce' | 'drink') => void;
  onCancel: () => void;
}) {
  const { t, lang } = useI18n();
  const ru = lang === 'ru';

  const cards: {
    kind: 'empty' | 'sauce' | 'drink';
    title: string;
    hint: string;
    icon: React.ReactNode;
    disabled: boolean;
    cls: string;
  }[] = [
    {
      kind: 'sauce',
      title: ru ? 'Все соусы' : 'All sauces',
      hint: `${sauceCount} ${ru ? 'шт.' : 'pcs'}`,
      icon: <Droplet className="w-7 h-7" />,
      disabled: sauceCount === 0,
      cls: 'from-red-500 to-rose-600',
    },
    {
      kind: 'drink',
      title: ru ? 'Все напитки' : 'All drinks',
      hint: `${drinkCount} ${ru ? 'шт.' : 'pcs'}`,
      icon: <CupSoda className="w-7 h-7" />,
      disabled: drinkCount === 0,
      cls: 'from-cyan-500 to-blue-600',
    },
    {
      kind: 'empty',
      title: ru ? 'Пустая группа' : 'Empty group',
      hint: ru ? 'выбрать вручную' : 'pick manually',
      icon: <Plus className="w-7 h-7" />,
      disabled: false,
      cls: 'from-slate-500 to-slate-700',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
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
// ВЫБОР ИЗ СУЩЕСТВУЮЩИХ ПОЗИЦИЙ (соусы) — плитки с картинками.
// Ничего не выбрано = блюдо без соуса.
// ============================================================
function ItemTilePicker({
  items,
  selectedIds,
  onChange,
}: {
  items: MenuItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useI18n();

  if (items.length === 0) {
    return <p className="text-xs text-slate-400">{t('noMenuItems')}</p>;
  }

  const toggle = (id: string) =>
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
    );

  return (
    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
      {items.map((s) => {
        const on = selectedIds.includes(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => toggle(s.id)}
            className={`flex flex-col items-center gap-1 p-1.5 rounded-xl transition-all active:scale-95 ${
              on
                ? 'bg-orange-50 ring-4 ring-orange-300'
                : 'bg-white ring-1 ring-slate-200 hover:ring-orange-300'
            }`}
          >
            <div
              className="relative w-full aspect-square rounded-lg overflow-hidden"
              style={{ border: `3px solid ${s.color ?? '#e5e7eb'}` }}
            >
              {s.image_url ? (
                <img
                  src={s.image_url}
                  alt={s.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div
                  className="absolute inset-0"
                  style={{ backgroundColor: s.color ?? '#e5e7eb', opacity: 0.25 }}
                />
              )}
              {on && (
                <div className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-orange-500 text-white flex items-center justify-center shadow">
                  <Check className="w-2.5 h-2.5" />
                </div>
              )}
            </div>
            <span className="text-[0.6875rem] font-black text-slate-800 truncate w-full text-center">
              {s.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
