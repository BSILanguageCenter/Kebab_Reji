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
import { formatYen } from '@/locale/format';
import { useI18n, type TranslationKey } from '@/locale';
import { Resizer } from '@/components/Resizer';
import { PanelSettings } from '@/components/PanelSettings';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ImageCropDialog } from '@/components/ImageCropDialog';
import { MenuCard } from '@/components/MenuCard';
import { useViewport } from '@/lib/useViewport';
import {
  MenuCardMenu,
  type MenuCardMenuState,
} from '@/components/MenuCardMenu';
import { StorageBar } from '@/components/StorageBar';
import {
  useLayoutSettings,
  clampLayout,
  snapValue,
  type LayoutSettings,
} from '@/lib/layoutSettings';
import type {
  MenuItem,
  MenuItemType,
  Station,
  DishKind,
  SauceMode,
  HydratedProperty,
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
  LayoutGrid,
} from 'lucide-react';

// ============================================================
// ПРОСТРАНСТВО КАТЕГОРИЙ
// ============================================================
type CategorySpace = 'dishset' | 'drink' | 'sauce' | 'topping';

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

  const cellH = Math.round(
    size + (compact ? 32 : 50) * (layout.itemTextSize / 12)
  );
  const gap = layout.gridGap;

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

export function MenuProduct() {
  const { t } = useI18n();
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

  const [pendingDelete, setPendingDelete] = useState<MenuItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const [cardMenu, setCardMenu] = useState<MenuCardMenuState | null>(null);

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<{
    space: CategorySpace;
    slot: number;
  } | null>(null);

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
  const { scale: ui } = useViewport();

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
  const drinksWrapRef = useRef<HTMLDivElement>(null);

  const colsRef = useRef<Partial<Record<CategorySpace, number>>>({});
  const registerCols = useCallback((s: CategorySpace, c: number) => {
    colsRef.current[s] = c;
  }, []);

  const loadData = useCallback(async (silent = false) => {
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
  }, [t]);

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

  const handleResetOrder = async () => {
    const updates = buildCategorizedOrder(allTops, colsRef.current);
    if (updates.length === 0) return;
    await applyReorder(updates);
  };

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
      menuRightWidth: clampLayout('menuRightWidth', base.menuRightWidth - d / ui),
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
      toppingsHeight: clampLayout('toppingsHeight', base.toppingsHeight - d / ui),
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

  const hasTopping = getSpaceItems(allTops, 'topping').length > 0;
  const hasAny = allTops.length > 0;

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-200/70">
      {error && (
        <div className="m-3 p-3 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div
          className="shrink-0 bg-white border-r border-slate-300 flex flex-col min-h-0"
          style={{ width: layout.ordersWidth }}
        >
          <div className="px-3 py-2 border-b border-blue-200 shrink-0 bg-blue-50">
            <h2
              className="font-black text-blue-800 tracking-wide border-l-4 border-blue-500 pl-2 leading-none"
              style={{ fontSize: layout.panelHeaderSize }}
            >
              {t('productsByCategory')}
            </h2>
          </div>

          <div className="p-2 space-y-2 border-b border-slate-200 bg-white shrink-0">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="form-input !py-2 text-xs"
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
                  className={`flex-1 py-1.5 rounded-lg text-[0.6875rem] font-bold transition-colors ${
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

          <div
            className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col"
            style={{ rowGap: layout.ordersRowGap }}
          >
            {leftList.length === 0 && (
              <p className="text-xs text-slate-400 text-center mt-4">
                {t('noMenuItems')}
              </p>
            )}
            {leftList.map(({ item, kind }) => (
              <button
                key={item.id}
                onClick={() => startEdit(item)}
                className={`w-full text-left p-2.5 rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md hover:border-orange-400 hover:bg-orange-50 transition-all shrink-0 ${
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
          </div>
        </div>

        <Resizer
          onStart={beginResize}
          onResize={handleResizeOrders}
          onEnd={endResize}
        />

        <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-slate-100">
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-orange-100 border-l-4 border-orange-500">
                <h3
                  className="font-black text-orange-800 tracking-wide truncate leading-none"
                  style={{ fontSize: layout.panelHeaderSize }}
                >
                  {t('bludiAndSet')} · {t('dragHintShort')}
                </h3>
              </div>
              <button
                onClick={() => setResetConfirmOpen(true)}
                disabled={!hasAny}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold active:scale-[0.97] transition-all shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                title={t('menuResetBtn')}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                {t('menuResetBtn')}
              </button>
            </div>
            <GridSpace
              space="dishset"
              size={layout.dishCardSize}
              compact={false}
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
          </div>

          {hasTopping && (
            <>
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
                  style={{ fontSize: layout.panelHeaderSize }}
                >
                  {t('type_topping')}
                </h3>
                <div className="overflow-y-auto h-[calc(100%-16px)]">
                  <GridSpace
                    space="topping"
                    size={layout.toppingCardSize}
                    compact={true}
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
                </div>
              </div>
            </>
          )}
        </div>

        <Resizer
          onStart={beginResize}
          onResize={handleResizeMenuRight}
          onEnd={endResize}
        />

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
                style={{ fontSize: layout.panelHeaderSize }}
              >
                {t('type_drink')}
              </h3>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              <GridSpace
                space="drink"
                size={layout.drinkCardSize}
                compact={true}
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
                style={{ fontSize: layout.panelHeaderSize }}
              >
                {t('type_sauce')}
              </h3>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              <GridSpace
                space="sauce"
                size={layout.sauceCardSize}
                compact={true}
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
            </div>
          </div>
        </div>

        <Resizer
          onStart={beginResize}
          onResize={handleResizeCart}
          onEnd={endResize}
        />

        <div
          className="shrink-0 bg-white border-l border-slate-300 flex flex-col min-h-0"
          style={{ width: layout.cartWidth }}
        >
          <div className="p-3 border-b border-slate-200 shrink-0 bg-slate-50 space-y-2">
            <button
              onClick={() => setPickingType(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-3.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-black shadow-lg shadow-orange-500/30 active:scale-[0.97] transition-all"
            >
              <Plus className="w-4 h-4" />
              {t('addProduct')}
            </button>
            <StorageBar onImportComplete={() => loadData(true)} />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <PanelSettings />
          </div>
        </div>
      </div>

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

      <ConfirmDialog
        open={resetConfirmOpen}
        title={t('confirmTitle')}
        message={t('menuResetConfirm')}
        confirmLabel={t('yes')}
        cancelLabel={t('cancel')}
        variant="yellow"
        disabledSeconds={4}
        onConfirm={async () => {
          setResetConfirmOpen(false);
          await handleResetOrder();
        }}
        onCancel={() => setResetConfirmOpen(false)}
      />
    </div>
  );
}

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

// ============================================================
// ⚠️ ФИКС: mainOverrides ключуется id ОРИГИНАЛЬНЫХ вариантов
// главного блюда (из allItems), а НЕ клонов из item.set_main.
// Раньше при handleSave mainOverrides[v.id] (v — оригинал) не
// находился → в базу уходили null.
// ============================================================
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

    // «своё» фото сета = image_url клона, если он не совпадает с фото базового блюда
    const customImage =
      cl.image_url && cl.image_url !== orig.image_url
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
  const [sauceMode, setSauceMode] = useState<SauceMode>(
    item?.sauce_mode ?? 'none'
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
  const [pickingSaucesFor, setPickingSaucesFor] = useState<
    | { kind: 'main' }
    | { kind: 'variant'; index: number }
    | null
  >(null);

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

  const allSauces = allItems.filter((i) => i.type === 'sauce' && i.active);
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
        // ⚠️ ФИКС: больше не затираем image_url сета в null
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
          base.sauce_mode = sauceMode;
          base.allowed_sauce_ids =
            sauceMode === 'with' ? allowedSauceIds : [];
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
            sauce_mode: v.sauce_mode,
            properties: v.properties
              .filter((p) => p.name.trim())
              .map((p) => ({
                name: p.name,
                options: p.options ?? [],
                required: p.required ?? false,
              })),
            allowed_sauce_ids:
              v.sauce_mode === 'with' ? v.allowed_sauce_ids : [],
          }));
        }
      }

      if (type === 'set') {
        base.set_main_item_id = setMainId || null;

        const main = allItems.find((i) => i.id === setMainId);
        if (main && main.dish_kind === 'group' && main.variants) {
          // ⚠️ v.id здесь — ОРИГИНАЛЬНЫЙ id варианта главного блюда
          // (не клон). mainOverrides после фикса инициализируется
          // именно по этим id — совпадает.
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
                    <Field label={t('sauceMode')}>
                      <div className="grid grid-cols-2 gap-2">
                        <RadioCard
                          active={sauceMode === 'none'}
                          onClick={() => setSauceMode('none')}
                          title={t('sauceNone')}
                          hint=""
                        />
                        <RadioCard
                          active={sauceMode === 'with'}
                          onClick={() => setSauceMode('with')}
                          title={t('sauceWith')}
                          hint=""
                        />
                      </div>
                    </Field>
                    {sauceMode === 'with' && (
                      <Field label={t('allowedSauces')}>
                        <button
                          type="button"
                          onClick={() => setPickingSaucesFor({ kind: 'main' })}
                          className="w-full text-left form-input flex items-center justify-between"
                        >
                          <span className="text-sm text-slate-700">
                            {allowedSauceIds.length > 0
                              ? allowedSauceIds
                                  .map(
                                    (id) =>
                                      allSauces.find((s) => s.id === id)
                                        ?.name ?? '?'
                                  )
                                  .join(', ')
                              : t('pickSauces')}
                          </span>
                          <span className="text-xs text-orange-600 font-bold shrink-0 ml-2">
                            {t('edit')}
                          </span>
                        </button>
                      </Field>
                    )}
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

                          <Field label={t('sauceMode')}>
                            <div className="grid grid-cols-2 gap-2">
                              <RadioCard
                                active={v.sauce_mode === 'none'}
                                onClick={() =>
                                  updateVariant(i, 'sauce_mode', 'none')
                                }
                                title={t('sauceNone')}
                                hint=""
                              />
                              <RadioCard
                                active={v.sauce_mode === 'with'}
                                onClick={() =>
                                  updateVariant(i, 'sauce_mode', 'with')
                                }
                                title={t('sauceWith')}
                                hint=""
                              />
                            </div>
                          </Field>
                          {v.sauce_mode === 'with' && (
                            <Field label={t('allowedSauces')}>
                              <button
                                type="button"
                                onClick={() =>
                                  setPickingSaucesFor({
                                    kind: 'variant',
                                    index: i,
                                  })
                                }
                                className="w-full text-left form-input flex items-center justify-between"
                              >
                                <span className="text-sm text-slate-700">
                                  {v.allowed_sauce_ids.length > 0
                                    ? `${v.allowed_sauce_ids.length} ${t(
                                        'saucesShort'
                                      )}`
                                    : t('pickSauces')}
                                </span>
                                <span className="text-xs text-orange-600 font-bold shrink-0 ml-2">
                                  {t('edit')}
                                </span>
                              </button>
                            </Field>
                          )}
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

                {/* ⚠️ ФИКС: даём загрузить обложку сета — раньше сохранение
                    всегда писало image_url = null */}
                <Field label={t('image')}>
                  <ImageUploader
                    imageUrl={imageUrl}
                    uploading={uploading}
                    onUpload={(f) => requestCrop(f, (url) => setImageUrl(url))}
                    onClear={() => setImageUrl('')}
                    t={t}
                  />
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
                        // Инициализируем оверрайды по id ОРИГИНАЛЬНЫХ вариантов
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
                          const effectiveImage =
                            ov.image_override || v.image_url || null;
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
                                  placeholder={`Цена: ${formatYen(v.price)}`}
                                />

                                <label className="col-span-7 cursor-pointer flex items-center gap-2 p-1.5 rounded-xl border-2 border-dashed border-orange-300 hover:border-orange-500 hover:bg-orange-50 bg-white transition-colors">
                                  {effectiveImage ? (
                                    <img
                                      src={effectiveImage}
                                      alt=""
                                      className={`w-10 h-10 rounded object-cover border shrink-0 ${
                                        usingOverride
                                          ? 'border-orange-500 ring-2 ring-orange-200'
                                          : 'border-slate-200 opacity-60'
                                      }`}
                                    />
                                  ) : (
                                    <div className="w-10 h-10 rounded bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                                      <Upload className="w-4 h-4 text-slate-400" />
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[0.6875rem] font-bold text-slate-800 truncate">
                                      {usingOverride
                                        ? t('menuSetOwnPhoto')
                                        : effectiveImage
                                        ? t('menuSetCurrentDishPhoto')
                                        : t('menuSetUploadPhoto')}
                                    </div>
                                    <div className="text-[0.625rem] text-slate-500 truncate">
                                      {usingOverride
                                        ? t('menuSetClickToReplace')
                                        : t('menuSetClickToSet')}
                                    </div>
                                  </div>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (!f) return;
                                      requestCrop(f, (url) =>
                                        setMainOverrides((m) => ({
                                          ...m,
                                          [v.id]: {
                                            ...ov,
                                            image_override: url,
                                          },
                                        }))
                                      );
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
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
                        <div className="flex items-center gap-2">
                          <input
                            value={g.label}
                            onChange={(e) =>
                              updateExtraGroup(gi, { label: e.target.value })
                            }
                            className="form-input flex-1"
                            placeholder={t('groupLabel')}
                          />
                          <label className="flex items-center gap-1 text-xs font-bold whitespace-nowrap">
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
                          <button
                            type="button"
                            onClick={() => removeExtraGroup(gi)}
                            className="p-1.5 text-slate-400 hover:text-red-600"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="space-y-1.5">
                          {g.options.map((o, oi) => {
                            const it = allItems.find((x) => x.id === o.item_id);
                            if (!it) return null;
                            return (
                              <div
                                key={oi}
                                className="grid grid-cols-12 gap-2 items-center border border-slate-200 rounded-xl p-2 bg-white"
                              >
                                <div className="col-span-5 flex items-center gap-2 min-w-0">
                                  {it.image_url ? (
                                    <img
                                      src={it.image_url}
                                      alt=""
                                      className="w-8 h-8 rounded object-cover shrink-0 bg-white"
                                    />
                                  ) : (
                                    <div className="w-8 h-8 rounded bg-slate-100 shrink-0" />
                                  )}
                                  <span className="text-xs font-bold truncate">
                                    {it.name}
                                  </span>
                                </div>
                                <input
                                  type="number"
                                  value={o.price_override ?? ''}
                                  onChange={(e) =>
                                    updateExtraGroup(gi, {
                                      options: g.options.map((x, j) =>
                                        j === oi
                                          ? {
                                              ...x,
                                              price_override: e.target.value
                                                ? Number(e.target.value)
                                                : null,
                                            }
                                          : x
                                      ),
                                    })
                                  }
                                  className="form-input col-span-3 text-xs"
                                  placeholder="0"
                                />
                                <label className="col-span-3 cursor-pointer flex items-center gap-1.5">
                                  {o.image_override ? (
                                    <img
                                      src={o.image_override}
                                      className="w-8 h-8 rounded object-cover border border-slate-200 bg-white"
                                    />
                                  ) : (
                                    <div className="w-8 h-8 rounded bg-slate-100 border border-slate-200 flex items-center justify-center">
                                      <Upload className="w-3 h-3 text-slate-400" />
                                    </div>
                                  )}
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (!f) return;
                                      requestCrop(f, (url) =>
                                        updateExtraGroup(gi, {
                                          options: g.options.map((x, j) =>
                                            j === oi
                                              ? {
                                                  ...x,
                                                  image_override: url,
                                                }
                                              : x
                                          ),
                                        })
                                      );
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => removeOptionFromGroup(gi, oi)}
                                  className="col-span-1 p-1 text-slate-400 hover:text-red-600 justify-self-end"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })}

                          <button
                            type="button"
                            onClick={() => setPickingOption({ groupIndex: gi })}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-100 hover:bg-purple-200 text-purple-800 text-xs font-bold"
                          >
                            <Plus className="w-3.5 h-3.5" /> {t('addOption')}
                          </button>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addExtraGroup}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-orange-100 hover:bg-orange-200 text-orange-800 text-xs font-bold w-full justify-center"
                    >
                      <Plus className="w-3.5 h-3.5" /> {t('addExtraGroup')}
                    </button>
                  </div>
                </Field>
              </>
            )}

            <Field label={t('active')}>
              <button
                type="button"
                onClick={() => setActive(!active)}
                className={`relative w-14 h-7 rounded-full transition-colors ${
                  active ? 'bg-orange-500' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white transition-transform shadow ${
                    active ? 'translate-x-7' : ''
                  }`}
                />
              </button>
            </Field>
          </div>

          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 shrink-0">
            <div className="flex gap-2">
              {onDelete && (
                <button
                  onClick={onDelete}
                  disabled={isBusy}
                  className="px-4 py-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  {t('delete')}
                </button>
              )}
              <button
                onClick={handleClose}
                disabled={isBusy}
                className="flex-1 py-3 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleSave}
                title="Ctrl + Enter"
                disabled={saving || !name || pendingOpsCount > 0}
                className="flex-1 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white text-sm font-black shadow-lg shadow-orange-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {saving ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('saving')}
                  </>
                ) : pendingOpsCount > 0 ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('menuWaitingPhoto')}
                  </>
                ) : (
                  t('save')
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ImageCropDialog
        open={cropState !== null}
        file={cropState?.file ?? null}
        onCancel={cancelCrop}
        onConfirm={handleCropConfirm}
      />

      {pickingSaucesFor && (
        <SaucePicker
          sauces={allSauces}
          initial={
            pickingSaucesFor.kind === 'main'
              ? allowedSauceIds
              : variants[pickingSaucesFor.index]?.allowed_sauce_ids ?? []
          }
          onCancel={() => setPickingSaucesFor(null)}
          onSave={(ids) => {
            if (pickingSaucesFor.kind === 'main') {
              setAllowedSauceIds(ids);
            } else {
              updateVariant(pickingSaucesFor.index, 'allowed_sauce_ids', ids);
            }
            setPickingSaucesFor(null);
          }}
          t={t}
        />
      )}

      {pickingOption && (
        <ItemPicker
          items={extraCandidates}
          onCancel={() => setPickingOption(null)}
          onPick={(item) => {
            addOptionToGroup(pickingOption.groupIndex, item.id);
            setPickingOption(null);
          }}
          t={t}
        />
      )}
    </>
  );
}

// ============================================================
// ХЕЛПЕР-КОМПОНЕНТЫ
// ============================================================

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
    <div className="grid grid-cols-2 gap-2">
      <Field label={t('name')}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="form-input"
          placeholder={t('fullName')}
        />
      </Field>
      <Field label={t('shortName')}>
        <input
          value={shortName}
          onChange={(e) => setShortName(e.target.value)}
          className="form-input"
        />
      </Field>
    </div>
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
  setPrice: (n: number) => void;
  setFree: (b: boolean) => void;
  t: (k: TranslationKey) => string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 items-end">
      <Field label={t('price')}>
        <input
          type="number"
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          className="form-input"
          disabled={free}
        />
      </Field>
      <Field label={t('free')}>
        <label className="flex items-center gap-2 h-[42px]">
          <input
            type="checkbox"
            checked={free}
            onChange={(e) => setFree(e.target.checked)}
          />
          <span className="text-sm font-bold">{t('free')}</span>
        </label>
      </Field>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
        {label}
      </label>
      {children}
    </div>
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
  const size = compact ? 'w-16 h-16' : 'w-24 h-24';
  return (
    <div className="flex items-center gap-2">
      <div
        className={`${size} rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden relative`}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <Upload className="w-5 h-5 text-slate-400" />
        )}
        {uploading && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
          </div>
        )}
      </div>
      <label className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 cursor-pointer text-xs font-bold">
        {t('uploadImage')}
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
          className="text-xs text-red-600 font-bold hover:underline"
        >
          {t('removeCover')}
        </button>
      )}
    </div>
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
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="w-14 h-10 rounded-lg border border-slate-300 cursor-pointer"
      />
      <span className="text-xs font-mono text-slate-500">{color}</span>
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
          key={i}
          className="border border-slate-200 rounded-2xl p-3 bg-slate-50/80 space-y-2"
        >
          <div className="flex items-center gap-2">
            <input
              value={p.name}
              onChange={(e) => onChange(i, { name: e.target.value })}
              className="form-input flex-1"
              placeholder={t('propertyName')}
              list={`prop-hist-${i}`}
            />
            <datalist id={`prop-hist-${i}`}>
              {history.map((h) => (
                <option key={h.name} value={h.name} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="text-slate-400 hover:text-red-600 p-1"
              title={t('remove')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            value={(p.options ?? []).join(', ')}
            onChange={(e) =>
              onChange(i, {
                options: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            className="form-input"
            placeholder="вар1, вар2, вар3 (пусто = чекбокс)"
          />
          <label className="flex items-center gap-2 text-xs font-bold">
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
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
      >
        <Plus className="w-3.5 h-3.5" /> {t('addProperty')}
      </button>
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
      className={`text-left p-3 rounded-xl border-2 transition-all ${
        active
          ? 'border-orange-500 bg-orange-50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="text-sm font-bold text-slate-900">{title}</div>
      {hint && (
        <div className="text-[0.6875rem] text-slate-500 mt-0.5 leading-snug">
          {hint}
        </div>
      )}
    </button>
  );
}

function SaucePicker({
  sauces,
  initial,
  onCancel,
  onSave,
  t,
}: {
  sauces: MenuItem[];
  initial: string[];
  onCancel: () => void;
  onSave: (ids: string[]) => void;
  t: (k: TranslationKey) => string;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial));

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h3 className="text-lg font-black">{t('chooseSauceStep')}</h3>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 grid grid-cols-2 gap-2">
          {sauces.map((s) => {
            const on = picked.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle(s.id)}
                className={`p-3 rounded-xl border-2 text-left transition-all ${
                  on
                    ? 'border-orange-500 bg-orange-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  {s.image_url ? (
                    <img
                      src={s.image_url}
                      alt=""
                      className="w-10 h-10 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-red-100 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">{s.name}</div>
                    <div className="text-xs text-slate-500">
                      {s.free ? t('free') : formatYen(s.price)}
                    </div>
                  </div>
                  {on && <span className="text-orange-500 font-black">✓</span>}
                </div>
              </button>
            );
          })}
          {sauces.length === 0 && (
            <p className="col-span-2 text-sm text-slate-400 text-center py-6">
              {t('noSauces')}
            </p>
          )}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-sm font-bold"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={() => onSave(Array.from(picked))}
            className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-black"
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemPicker({
  items,
  onPick,
  onCancel,
  t,
}: {
  items: MenuItem[];
  onPick: (item: MenuItem) => void;
  onCancel: () => void;
  t: (k: TranslationKey) => string;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h3 className="text-lg font-black">{t('pickItem')}</h3>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onPick(it)}
              className="w-full text-left p-3 rounded-xl border border-slate-200 bg-white hover:border-orange-400 hover:bg-orange-50 transition-all flex items-center gap-2"
            >
              {it.image_url ? (
                <img
                  src={it.image_url}
                  alt=""
                  className="w-10 h-10 rounded object-cover shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded bg-slate-100 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate">{it.name}</div>
                <div className="text-xs text-slate-500">
                  {formatYen(it.price)}
                </div>
              </div>
            </button>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">
              {t('noResults')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
