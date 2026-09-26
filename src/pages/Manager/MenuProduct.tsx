import { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  fetchAllMenuItems,
  createItem,
  updateItem,
  deleteItem,
  reorderItems,
  uploadItemImage,
  type SaveItemPayload,
  type VariantDraftPayload,
  type SetExtraGroupPayload,
} from '@/services/menu';
import { formatYen } from '@/locale/format';
import { useI18n, type TranslationKey } from '@/locale';
import { Resizer } from '@/components/Resizer';
import { PanelSettings } from '@/components/PanelSettings';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  useLayoutSettings,
  clampLayout,
  snapValue,
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
} from 'lucide-react';

export function MenuProduct() {
  const { t } = useI18n();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickingType, setPickingType] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [formType, setFormType] = useState<MenuItemType | null>(null);

  const [pendingDelete, setPendingDelete] = useState<MenuItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const dragId = useRef<string | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<{
    type: MenuItemType;
    slot: number;
  } | null>(null);

  const [layout, setLayout] = useLayoutSettings();
  const drinksWrapRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAllMenuItems();
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

  const handleDragStart = (id: string) => {
    dragId.current = id;
  };

  const handleDragEnd = () => {
    dragId.current = null;
    setDragOverSlot(null);
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
      loadData();
    }
  };

  /**
   * Windows-desktop-style drop.
   *   - Пустая ячейка → карточка просто переезжает, старая ячейка становится пустой
   *   - Занятая ячейка → карточка вставляется, все карточки в диапазоне (from..to)
   *     сдвигаются на одну позицию
   */
  const handleSlotDrop = async (type: MenuItemType, targetSlot: number) => {
    const fromId = dragId.current;
    dragId.current = null;
    setDragOverSlot(null);
    if (!fromId) return;

    const fromItem = items.find((i) => i.id === fromId);
    if (!fromItem) return;
    if (fromItem.type !== type) return;
    if (fromItem.sort_order === targetSlot) return;

    const fromSlot = fromItem.sort_order;

    const targetCard = items.find(
      (i) =>
        i.type === type &&
        !i.parent_id &&
        i.sort_order === targetSlot &&
        i.id !== fromId
    );

    if (!targetCard) {
      await applyReorder([{ id: fromItem.id, sort_order: targetSlot }]);
      return;
    }

    const sameType = items.filter((i) => i.type === type && !i.parent_id);

    const updates: { id: string; sort_order: number }[] = [];

    if (fromSlot < targetSlot) {
      for (const it of sameType) {
        if (it.id === fromItem.id) continue;
        if (it.sort_order > fromSlot && it.sort_order <= targetSlot) {
          updates.push({ id: it.id, sort_order: it.sort_order - 1 });
        }
      }
    } else {
      for (const it of sameType) {
        if (it.id === fromItem.id) continue;
        if (it.sort_order >= targetSlot && it.sort_order < fromSlot) {
          updates.push({ id: it.id, sort_order: it.sort_order + 1 });
        }
      }
    }

    updates.push({ id: fromItem.id, sort_order: targetSlot });
    await applyReorder(updates);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteItem(pendingDelete.id);
      setPendingDelete(null);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToDeleteItem'));
    } finally {
      setDeleting(false);
    }
  };

  const grouped: Record<MenuItemType, MenuItem[]> = {
    dish: items
      .filter((i) => i.type === 'dish' && !i.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order),
    set: items
      .filter((i) => i.type === 'set' && !i.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order),
    drink: items
      .filter((i) => i.type === 'drink' && !i.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order),
    sauce: items
      .filter((i) => i.type === 'sauce' && !i.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order),
    topping: items
      .filter((i) => i.type === 'topping' && !i.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order),
  };

  // ============================================================
  // RESIZE HANDLERS
  // ============================================================
  const startLayoutRef = useRef<typeof layout | null>(null);

  const beginResize = () => {
    startLayoutRef.current = { ...layout };
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

  const handleResizeOrders = (totalDelta: number) => {
    const base = startLayoutRef.current ?? layout;
    setLayout((prev) => ({
      ...prev,
      ordersWidth: clampLayout('ordersWidth', base.ordersWidth + totalDelta),
    }));
  };

  const handleResizeMenuRight = (totalDelta: number) => {
    const base = startLayoutRef.current ?? layout;
    setLayout((prev) => ({
      ...prev,
      menuRightWidth: clampLayout(
        'menuRightWidth',
        base.menuRightWidth - totalDelta
      ),
    }));
  };

  const handleResizeCart = (totalDelta: number) => {
    const base = startLayoutRef.current ?? layout;
    setLayout((prev) => ({
      ...prev,
      cartWidth: clampLayout('cartWidth', base.cartWidth - totalDelta),
    }));
  };

  const handleResizeToppings = (totalDelta: number) => {
    const base = startLayoutRef.current ?? layout;
    setLayout((prev) => ({
      ...prev,
      toppingsHeight: clampLayout(
        'toppingsHeight',
        base.toppingsHeight - totalDelta
      ),
    }));
  };

  const handleResizeDrinks = (totalDelta: number) => {
    const base = startLayoutRef.current ?? layout;
    const containerH = drinksWrapRef.current?.clientHeight ?? 400;
    const pctDelta = (totalDelta / containerH) * 100;
    setLayout((prev) => ({
      ...prev,
      drinksShare: clampLayout('drinksShare', base.drinksShare + pctDelta),
    }));
  };

  // ============================================================
  // GRID RENDER
  // ============================================================
  const renderGrid = (type: MenuItemType, size: number, compact: boolean) => {
    const typeItems = grouped[type];
    const maxSlot =
      typeItems.length > 0 ? Math.max(...typeItems.map((i) => i.sort_order)) : -1;
    const totalSlots = Math.max(12, maxSlot + 4);

    const bySlot = new Map<number, MenuItem>();
    for (const it of typeItems) bySlot.set(it.sort_order, it);

    const slots: { slot: number; card: MenuItem | null }[] = [];
    for (let i = 0; i < totalSlots; i++) {
      slots.push({ slot: i, card: bySlot.get(i) ?? null });
    }

    // Ширина ячейки = максимальная ширина среди карточек + отступы
    let maxW = size + 20;
    for (const it of typeItems) {
      let variants: MenuItem[] | undefined;
      if (it.type === 'dish' && it.dish_kind === 'group') {
        variants = it.variants;
      } else if (it.type === 'set' && it.set_main?.dish_kind === 'group') {
        variants = it.set_main.variants;
      }
      if (variants && variants.length > 0) {
        const gW = 8 * 2 + size * variants.length + 6 * (variants.length - 1);
        maxW = Math.max(maxW, gW);
      }
    }
    const cellW = maxW + 20;
    const cellH = compact ? size + 50 : size + 90;

    return (
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(auto-fill, ${cellW}px)`,
          gridAutoRows: `${cellH}px`,
        }}
      >
        {slots.map(({ slot, card }) => {
          const isDragOver =
            dragOverSlot?.type === type && dragOverSlot?.slot === slot;

          let variants: MenuItem[] | undefined;
          if (card) {
            if (card.type === 'dish' && card.dish_kind === 'group') {
              variants = card.variants;
            } else if (
              card.type === 'set' &&
              card.set_main?.dish_kind === 'group'
            ) {
              variants = card.set_main.variants;
            }
          }

          return (
            <div
              key={slot}
              data-slot={slot}
              onDragOver={(e) => {
                if (!dragId.current) return;
                e.preventDefault();
                if (
                  dragOverSlot?.type !== type ||
                  dragOverSlot?.slot !== slot
                ) {
                  setDragOverSlot({ type, slot });
                }
              }}
              onDragLeave={() => {
                if (
                  dragOverSlot?.type === type &&
                  dragOverSlot?.slot === slot
                ) {
                  setDragOverSlot(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSlotDrop(type, slot);
              }}
              className={`flex items-center justify-center rounded-xl transition-all ${
                isDragOver
                  ? 'ring-4 ring-orange-400 ring-offset-2 bg-orange-50'
                  : ''
              }`}
            >
              {card ? (
                <DraggableCard
                  item={card}
                  variants={variants}
                  onEdit={startEdit}
                  onVariantClick={(v) => {
                    if (card.type === 'dish') startEdit(v);
                    else startEdit(card);
                  }}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  size={size}
                  textSize={layout.itemTextSize}
                  compact={compact}
                />
              ) : (
                <div className="w-full h-full border-2 border-dashed border-gray-200 rounded-xl pointer-events-none" />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
      </div>
    );
  }

  const leftList: { item: MenuItem; kind: 'dish' | 'set' }[] = [
    ...grouped.dish.map((i) => ({ item: i, kind: 'dish' as const })),
    ...grouped.set.map((i) => ({ item: i, kind: 'set' as const })),
  ];

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100">
      {error && (
        <div className="m-3 p-3 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* ---- COLUMN 1: PRODUCTS LIST ---- */}
        <div
          className="shrink-0 bg-white border-r-2 border-gray-300 flex flex-col min-h-0"
          style={{ width: layout.ordersWidth }}
        >
          <div className="px-3 py-2 border-b-2 border-blue-300 shrink-0 bg-blue-50">
            <h2 className="text-[11px] font-bold text-blue-800 uppercase tracking-wider border-l-4 border-blue-500 pl-2">
              {t('productsByCategory')}
            </h2>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
            {leftList.length === 0 && (
              <p className="text-xs text-gray-400 text-center mt-4">
                {t('noMenuItems')}
              </p>
            )}
            {leftList.map(({ item, kind }) => (
              <button
                key={item.id}
                onClick={() => startEdit(item)}
                className="w-full text-left p-2 rounded-lg border border-gray-200 hover:border-orange-400 hover:bg-orange-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-gray-900 truncate">
                    {item.name}
                  </span>
                  <span
                    className={`text-[8px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${
                      kind === 'set'
                        ? 'bg-orange-100 text-orange-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {kind === 'set' ? 'SET' : 'DSH'}
                  </span>
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
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

        {/* ---- COLUMN 2: BLUDI + SET + TOPPINGS ---- */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-slate-50">
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            <div className="mb-2 px-2 py-1 rounded-md bg-orange-100 border-l-4 border-orange-500">
              <h3 className="text-[10px] font-black text-orange-800 uppercase tracking-widest">
                {t('bludiAndSet')} · {t('dragHintShort')}
              </h3>
            </div>
            {items.filter(
              (i) =>
                (i.type === 'dish' || i.type === 'set') && !i.parent_id
            ).length === 0 ? (
              <div className="text-center text-gray-400 text-sm mt-12">
                {t('noMenuItems')}
              </div>
            ) : (
              <>
                {grouped.dish.length > 0 && (
                  <div className="mb-4">
                    {renderGrid('dish', layout.dishCardSize, false)}
                  </div>
                )}
                {grouped.set.length > 0 && (
                  <div className="mb-3">
                    {renderGrid('set', layout.dishCardSize, false)}
                  </div>
                )}
              </>
            )}
          </div>

          {grouped.topping.length > 0 && (
            <>
              <Resizer
                direction="horizontal"
                onStart={beginResize}
                onResize={handleResizeToppings}
                onEnd={endResize}
              />
              <div
                className="shrink-0 bg-white px-3 py-2 overflow-hidden border-t-2 border-purple-300"
                style={{ height: layout.toppingsHeight }}
              >
                <h3 className="text-[10px] font-black text-purple-800 uppercase tracking-widest mb-1.5 border-l-4 border-purple-500 pl-2">
                  {t('type_topping')}
                </h3>
                <div className="overflow-y-auto h-[calc(100%-20px)]">
                  {renderGrid('topping', layout.toppingCardSize, true)}
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

        {/* ---- COLUMN 3: DRINKS + SAUCES ---- */}
        <div
          ref={drinksWrapRef}
          className="shrink-0 bg-white border-l-2 border-gray-300 flex flex-col min-h-0"
          style={{ width: layout.menuRightWidth }}
        >
          <div
            className="flex flex-col border-b-2 border-cyan-300"
            style={{ height: `${layout.drinksShare}%` }}
          >
            <div className="px-3 py-2 border-b-2 border-cyan-300 shrink-0 bg-cyan-50">
              <h3 className="text-[10px] font-black text-cyan-800 uppercase tracking-widest border-l-4 border-cyan-500 pl-2">
                {t('type_drink')}
              </h3>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              {grouped.drink.length === 0 ? (
                <p className="text-[10px] text-gray-400 text-center w-full py-3">
                  —
                </p>
              ) : (
                renderGrid('drink', layout.drinkCardSize, true)
              )}
            </div>
          </div>

          <Resizer
            direction="horizontal"
            onStart={beginResize}
            onResize={handleResizeDrinks}
            onEnd={endResize}
          />

          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-3 py-2 border-b-2 border-red-300 shrink-0 bg-red-50">
              <h3 className="text-[10px] font-black text-red-800 uppercase tracking-widest border-l-4 border-red-500 pl-2">
                {t('type_sauce')}
              </h3>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              {grouped.sauce.length === 0 ? (
                <p className="text-[10px] text-gray-400 text-center w-full py-3">
                  —
                </p>
              ) : (
                renderGrid('sauce', layout.sauceCardSize, true)
              )}
            </div>
          </div>
        </div>

        <Resizer
          onStart={beginResize}
          onResize={handleResizeCart}
          onEnd={endResize}
        />

        {/* ---- COLUMN 4: ADD BUTTON + PANEL SETTINGS ---- */}
        <div
          className="shrink-0 bg-white border-l-2 border-gray-300 flex flex-col min-h-0"
          style={{ width: layout.cartWidth }}
        >
          <div className="p-3 border-b-2 border-gray-300 shrink-0 bg-gray-50">
            <button
              onClick={() => setPickingType(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-black shadow-md shadow-orange-500/20 active:scale-[0.97] transition-all"
            >
              <Plus className="w-4 h-4" />
              {t('addProduct')}
            </button>
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
          onClose={() => {
            setFormType(null);
            setEditingItem(null);
          }}
          onSaved={() => {
            setFormType(null);
            setEditingItem(null);
            loadData();
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
    </div>
  );
}

// ============================================================
// DRAGGABLE CARD
// ============================================================
const DraggableCard = memo(function DraggableCard({
  item,
  variants,
  onEdit,
  onVariantClick,
  onDragStart,
  onDragEnd,
  size,
  textSize,
  compact,
}: {
  item: MenuItem;
  variants?: MenuItem[];
  onEdit: (i: MenuItem) => void;
  onVariantClick?: (v: MenuItem) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  size: number;
  textSize: number;
  compact?: boolean;
}) {
  const isGroup = (variants?.length ?? 0) > 0;
  const nameSize = compact ? Math.max(8, textSize - 2) : textSize;
  const priceSize = compact ? Math.max(8, textSize - 2) : textSize;

  // ============ SINGLE ============
  if (!isGroup) {
    const nameAndPrice = (
      <>
        <div
          className="mt-1 text-center font-black text-gray-900 truncate w-full px-0.5"
          style={{ fontSize: nameSize }}
          title={item.name}
        >
          {item.short_name || item.name}
        </div>
        <div
          className="text-center font-black text-orange-600 w-full px-0.5"
          style={{ fontSize: priceSize }}
        >
          {item.free ? '' : formatYen(item.price)}
        </div>
      </>
    );

    const square = (
      <div
        className="relative rounded-xl overflow-hidden bg-gradient-to-br from-orange-500 to-red-500 border-2 border-gray-300 hover:border-orange-400 transition-all"
        style={{ width: size, height: size }}
      >
        {item.image_url ? (
          <>
            <img
              src={item.image_url}
              alt={item.name}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              loading="lazy"
              draggable={false}
            />
            <div className="absolute inset-0 bg-black/40" />
          </>
        ) : null}
        {!item.active && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <span
              className="text-white font-black uppercase tracking-widest"
              style={{ fontSize: Math.max(8, nameSize - 2) }}
            >
              inactive
            </span>
          </div>
        )}
        {item.type === 'sauce' && item.color && (
          <div
            className="absolute inset-0"
            style={{ backgroundColor: item.color, opacity: 0.3 }}
          />
        )}
      </div>
    );

    return (
      <div
        draggable
        data-card-id={item.id}
        onDragStart={() => onDragStart(item.id)}
        onDragEnd={onDragEnd}
        onClick={() => onEdit(item)}
        style={{ width: size }}
        className="flex flex-col items-center select-none cursor-grab active:cursor-grabbing"
      >
        {square}
        {nameAndPrice}
      </div>
    );
  }

  // ============ GROUP ============
  const gap = 6;
  const pad = 8;
  const headerH = nameSize + 12;
  const cardH = size + nameSize * 2 + 8;
  const groupW =
    pad * 2 + size * variants!.length + gap * (variants!.length - 1);

  return (
    <div
      draggable
      data-card-id={item.id}
      onDragStart={() => onDragStart(item.id)}
      onDragEnd={onDragEnd}
      style={{ width: groupW, minHeight: headerH + cardH + pad * 2 }}
      className="rounded-xl border-2 border-gray-400 bg-white transition-all select-none cursor-grab active:cursor-grabbing hover:border-orange-400"
    >
      <button
        onClick={() => onEdit(item)}
        className="flex items-center justify-between w-full px-2 py-1 border-b border-gray-200 bg-gray-50 rounded-t-lg hover:bg-orange-50 transition-colors"
      >
        <span
          className="font-black text-gray-900 uppercase tracking-wide truncate text-left"
          style={{ fontSize: nameSize }}
        >
          {item.name}
        </span>
        {item.type === 'set' && (
          <span
            className="font-black bg-orange-500 text-white px-1.5 py-0.5 rounded-full shrink-0 ml-1"
            style={{ fontSize: Math.max(7, nameSize - 3) }}
          >
            SET
          </span>
        )}
      </button>

      <div className="flex items-start" style={{ gap, padding: pad }}>
        {variants!.map((v) => (
          <div
            key={v.id}
            onClick={(e) => {
              e.stopPropagation();
              if (onVariantClick) onVariantClick(v);
              else onEdit(v);
            }}
            style={{ width: size }}
            className="flex flex-col items-center cursor-pointer active:scale-95 transition-transform"
          >
            <div
              className="relative rounded-xl overflow-hidden border-2 border-gray-300 hover:border-orange-400 bg-gradient-to-br from-orange-500 to-red-500 transition-all"
              style={{ width: size, height: size }}
            >
              {(v.image_url || item.image_url) && (
                <>
                  <img
                    src={v.image_url || item.image_url || ''}
                    alt={v.name}
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                    loading="lazy"
                    draggable={false}
                  />
                  <div className="absolute inset-0 bg-black/40" />
                </>
              )}
            </div>
            <div
              className="mt-1 text-center font-black text-gray-900 truncate w-full px-0.5"
              style={{ fontSize: nameSize }}
            >
              {v.name}
            </div>
            <div
              className="text-center font-black text-orange-600 w-full px-0.5"
              style={{ fontSize: priceSize }}
            >
              {v.free ? '' : formatYen(v.price)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

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
        className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black text-gray-900">
            {t('pickCategory')}
          </h3>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {types.map((tp) => (
            <button
              key={tp.key}
              onClick={() => onPick(tp.key)}
              className="flex flex-col items-center gap-2 p-5 rounded-2xl border-2 border-gray-200 hover:border-orange-400 hover:bg-orange-50 transition-all active:scale-[0.97]"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 text-white flex items-center justify-center shadow-md shadow-orange-500/20">
                {tp.icon}
              </div>
              <span className="text-sm font-bold text-gray-900">
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

function ItemFormModal({
  type,
  item,
  allItems,
  onClose,
  onSaved,
  onDelete,
}: {
  type: MenuItemType;
  item: MenuItem | null;
  allItems: MenuItem[];
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

  const [mainOverrides, setMainOverrides] = useState<
    Record<
      string,
      { price_override: number | null; image_override: string | null }
    >
  >(() => {
    const out: Record<
      string,
      { price_override: number | null; image_override: string | null }
    > = {};
    if (item?.set_main?.variants) {
      for (const v of item.set_main.variants) {
        out[v.id] = { price_override: v.price, image_override: null };
      }
    }
    return out;
  });

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

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const tempId = item?.id ?? crypto.randomUUID();
      const url = await uploadItemImage(file, tempId);
      if (url) setImageUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToUploadImage'));
    } finally {
      setUploading(false);
    }
  };

  const addProperty = () => {
    setProperties((p) => [
      ...p,
      {
        id: `new-${crypto.randomUUID()}`,
        item_id: item?.id ?? '',
        name: '',
        sort_order: p.length,
      },
    ]);
  };
  const updateProperty = (idx: number, v: string) => {
    setProperties((p) => p.map((x, i) => (i === idx ? { ...x, name: v } : x)));
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
    val: string
  ) => {
    setVariants((arr) =>
      arr.map((v, i) =>
        i === varIdx
          ? {
              ...v,
              properties: v.properties.map((p, j) =>
                j === propIdx ? { ...p, name: val } : p
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
    setExtraGroups((g) => g.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
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
    setSaving(true);
    setError(null);
    try {
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
          base.sauce_mode = sauceMode;
          base.allowed_sauce_ids =
            sauceMode === 'with' ? allowedSauceIds : [];
          base.properties = properties
            .filter((p) => p.name.trim())
            .map((p) => ({ name: p.name }));
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
              .map((p) => ({ name: p.name })),
            allowed_sauce_ids:
              v.sauce_mode === 'with' ? v.allowed_sauce_ids : [],
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

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl border border-gray-200 p-5 w-full max-w-3xl max-h-[92vh] overflow-y-auto m-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-black text-gray-900">{title}</h3>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-900"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {error && (
            <div className="mb-3 p-2 bg-red-50 border border-red-300 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* ============ TOPPING ============ */}
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
                  onUpload={handleUpload}
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
                  onChange={updateProperty}
                  onAdd={addProperty}
                  onRemove={removeProperty}
                  t={t}
                />
              </Field>
            </>
          )}

          {/* ============ SAUCE ============ */}
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
                  onUpload={handleUpload}
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

          {/* ============ DRINK ============ */}
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
                  onUpload={handleUpload}
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

          {/* ============ DISH ============ */}
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
                      onUpload={handleUpload}
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
                        <span className="text-sm text-gray-700">
                          {allowedSauceIds.length > 0
                            ? allowedSauceIds
                                .map(
                                  (id) =>
                                    allSauces.find((s) => s.id === id)?.name ??
                                    '?'
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
                        className="border border-gray-200 rounded-xl p-3 bg-slate-50 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-gray-500 uppercase tracking-wider">
                            {t('variant')} #{i + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeVariant(i)}
                            className="text-gray-400 hover:text-red-600"
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
                              updateVariant(i, 'price', Number(e.target.value))
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
                            onUpload={async (f) => {
                              try {
                                const url = await uploadItemImage(
                                  f,
                                  crypto.randomUUID()
                                );
                                if (url) updateVariant(i, 'image_url', url);
                              } catch {
                                /* ignore */
                              }
                            }}
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
                            onChange={(idx, val) =>
                              updateVariantProperty(i, idx, val)
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
                              <span className="text-sm text-gray-700">
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
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-100 hover:bg-orange-200 text-orange-800 text-xs font-bold w-full justify-center"
                    >
                      <Plus className="w-3.5 h-3.5" /> {t('addDishBtn')}
                    </button>
                  </div>
                </Field>
              )}
            </>
          )}

          {/* ============ SET ============ */}
          {type === 'set' && (
            <>
              <NameAndShort
                name={name}
                shortName={shortName}
                setName={setName}
                setShortName={setShortName}
                t={t}
              />
              <div className="mb-3 p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-[11px] text-blue-800 font-medium leading-snug">
                Цена сета определяется по выбранному варианту основного блюда
                (переопределения ниже). Своей цены у сета нет.
              </div>
              <Field label={t('image')}>
                <ImageUploader
                  imageUrl={imageUrl}
                  uploading={uploading}
                  onUpload={handleUpload}
                  onClear={() => setImageUrl('')}
                  t={t}
                />
              </Field>
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
                        ? ` (${d.variants?.length ?? 0} ${t('variantsShort')})`
                        : ''}
                    </option>
                  ))}
                </select>
              </Field>

              {(() => {
                const main = allItems.find((i) => i.id === setMainId);
                if (!main || main.dish_kind !== 'group' || !main.variants) {
                  return null;
                }
                return (
                  <Field label="Цена сета для каждого варианта">
                    <div className="space-y-2">
                      {main.variants.map((v) => {
                        const ov = mainOverrides[v.id] ?? {
                          price_override: null,
                          image_override: null,
                        };
                        return (
                          <div
                            key={v.id}
                            className="grid grid-cols-12 gap-2 items-center border border-gray-200 rounded-lg p-2 bg-slate-50"
                          >
                            <span className="col-span-5 text-xs font-bold text-gray-800 truncate">
                              {v.name}
                              <span className="ml-1 text-[10px] text-gray-400 font-normal">
                                (база {formatYen(v.price)})
                              </span>
                            </span>
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
                              className="form-input col-span-4 text-xs"
                              placeholder={`${formatYen(v.price)}`}
                            />
                            <label className="col-span-3 cursor-pointer flex items-center gap-1.5">
                              {ov.image_override ? (
                                <img
                                  src={ov.image_override}
                                  className="w-8 h-8 rounded object-cover border border-gray-200"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded bg-gray-100 border border-gray-200 flex items-center justify-center">
                                  <Upload className="w-3 h-3 text-gray-400" />
                                </div>
                              )}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={async (e) => {
                                  const f = e.target.files?.[0];
                                  if (!f) return;
                                  try {
                                    const url = await uploadItemImage(
                                      f,
                                      crypto.randomUUID()
                                    );
                                    if (url)
                                      setMainOverrides((m) => ({
                                        ...m,
                                        [v.id]: {
                                          ...ov,
                                          image_override: url,
                                        },
                                      }));
                                  } catch {
                                    /* ignore */
                                  }
                                }}
                              />
                            </label>
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
                      className="border border-gray-200 rounded-xl p-3 bg-slate-50 space-y-2"
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
                          className="p-1.5 text-gray-400 hover:text-red-600"
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
                              className="grid grid-cols-12 gap-2 items-center border border-gray-200 rounded-lg p-2 bg-white"
                            >
                              <div className="col-span-5 flex items-center gap-2 min-w-0">
                                {it.image_url ? (
                                  <img
                                    src={it.image_url}
                                    alt=""
                                    className="w-8 h-8 rounded object-cover shrink-0"
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded bg-gray-100 shrink-0" />
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
                                    className="w-8 h-8 rounded object-cover border border-gray-200"
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded bg-gray-100 border border-gray-200 flex items-center justify-center">
                                    <Upload className="w-3 h-3 text-gray-400" />
                                  </div>
                                )}
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={async (e) => {
                                    const f = e.target.files?.[0];
                                    if (!f) return;
                                    try {
                                      const url = await uploadItemImage(
                                        f,
                                        crypto.randomUUID()
                                      );
                                      if (url)
                                        updateExtraGroup(gi, {
                                          options: g.options.map((x, j) =>
                                            j === oi
                                              ? {
                                                  ...x,
                                                  image_override: url,
                                                }
                                              : x
                                          ),
                                        });
                                    } catch {
                                      /* ignore */
                                    }
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => removeOptionFromGroup(gi, oi)}
                                className="col-span-1 p-1 text-gray-400 hover:text-red-600 justify-self-end"
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
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-100 hover:bg-orange-200 text-orange-800 text-xs font-bold w-full justify-center"
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
              className={`relative w-12 h-6 rounded-full transition-colors ${
                active ? 'bg-orange-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow ${
                  active ? 'translate-x-6' : ''
                }`}
              />
            </button>
          </Field>

          <div className="flex gap-2 mt-4">
            {onDelete && (
              <button
                onClick={onDelete}
                className="px-4 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-sm font-semibold flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                {t('delete')}
              </button>
            )}
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold"
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name}
              className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-40"
            >
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        </div>
      </div>

      {pickingOption && (
        <ItemPickerModal
          items={extraCandidates.filter(
            (x) =>
              !extraGroups[pickingOption.groupIndex].options.some(
                (o) => o.item_id === x.id
              )
          )}
          onCancel={() => setPickingOption(null)}
          onPick={(itemId) => {
            addOptionToGroup(pickingOption.groupIndex, itemId);
            setPickingOption(null);
          }}
          t={t}
        />
      )}

      {pickingSaucesFor && (
        <SaucePickerModal
          sauces={allSauces}
          selectedIds={
            pickingSaucesFor.kind === 'main'
              ? allowedSauceIds
              : variants[pickingSaucesFor.index]?.allowed_sauce_ids ?? []
          }
          onCancel={() => setPickingSaucesFor(null)}
          onSave={(ids) => {
            if (pickingSaucesFor.kind === 'main') setAllowedSauceIds(ids);
            else updateVariant(pickingSaucesFor.index, 'allowed_sauce_ids', ids);
            setPickingSaucesFor(null);
          }}
          t={t}
        />
      )}
    </>
  );
}

// ============================================================
// SHARED SUB-COMPONENTS
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
    <div className="grid grid-cols-2 gap-3">
      <Field label={t('name')}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="form-input"
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
        active={station === 'kitchen'}
        onClick={() => setStation('kitchen')}
        title={t('stationKitchen')}
        hint=""
      />
      <RadioCard
        active={station === 'ready'}
        onClick={() => setStation('ready')}
        title={t('stationReady')}
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
  const palette = [
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#eab308',
    '#84cc16',
    '#10b981',
    '#06b6d4',
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
    '#78716c',
    '#1f2937',
    '#ffffff',
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {palette.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => setColor(c)}
          className={`w-8 h-8 rounded-full border-2 transition-transform active:scale-95 ${
            color === c
              ? 'border-gray-900 ring-2 ring-orange-400'
              : 'border-gray-300'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
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
    <div className="mb-3">
      <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">
        {label}
      </label>
      {children}
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
      className={`flex flex-col items-start gap-1 p-3 rounded-xl border-2 text-left transition-all ${
        active
          ? 'bg-orange-50 border-orange-500'
          : 'bg-white border-gray-200 hover:border-gray-300'
      }`}
    >
      <span className="text-sm font-bold text-gray-900">{title}</span>
      {hint && (
        <span className="text-[10px] text-gray-500 leading-tight">{hint}</span>
      )}
    </button>
  );
}

function PropertiesEditor({
  properties,
  onChange,
  onAdd,
  onRemove,
  t,
}: {
  properties: HydratedProperty[];
  onChange: (idx: number, name: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  t: (k: TranslationKey) => string;
}) {
  return (
    <div className="space-y-1.5">
      {properties.map((p, i) => (
        <div key={p.id ?? i} className="flex gap-2 items-center">
          <input
            value={p.name}
            onChange={(e) => onChange(i, e.target.value)}
            className="form-input flex-1 text-sm"
            placeholder={t('propertyName')}
          />
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="p-2 text-gray-400 hover:text-red-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold"
      >
        <Plus className="w-3.5 h-3.5" /> {t('addProperty')}
      </button>
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
  return (
    <div className={`flex items-center gap-3 ${compact ? 'text-xs' : ''}`}>
      <div
        className={`${
          compact ? 'w-12 h-12' : 'w-20 h-20'
        } rounded-lg overflow-hidden bg-gray-100 shrink-0 border border-gray-200 flex items-center justify-center`}
      >
        {imageUrl ? (
          <img src={imageUrl} className="w-full h-full object-cover" />
        ) : (
          <Upload
            className={`${compact ? 'w-4 h-4' : 'w-6 h-6'} text-gray-400`}
          />
        )}
      </div>
      <div className="flex-1 flex flex-col gap-1.5">
        <label className="cursor-pointer">
          <span
            className={`block ${
              compact ? 'py-1.5 text-xs' : 'py-2 text-sm'
            } px-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-bold text-center transition-colors`}
          >
            {uploading ? t('uploading') : t('uploadImage')}
          </span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
        </label>
        {imageUrl && (
          <button
            type="button"
            onClick={onClear}
            className="py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-bold"
          >
            {t('removeCover')}
          </button>
        )}
      </div>
    </div>
  );
}

function ItemPickerModal({
  items,
  onPick,
  onCancel,
  t,
}: {
  items: MenuItem[];
  onPick: (id: string) => void;
  onCancel: () => void;
  t: (k: TranslationKey) => string;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-black text-gray-900">{t('pickItem')}</h3>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {items.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-6">
              {t('noItemsInCategory')}
            </p>
          )}
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => onPick(it.id)}
              className="w-full flex items-center gap-3 p-3 rounded-xl border-2 border-gray-200 hover:border-orange-400 hover:bg-orange-50 transition-all text-left"
            >
              <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                {it.image_url ? (
                  <img
                    src={it.image_url}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-200" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-900 truncate">
                  {it.name}
                </div>
                <div className="text-xs text-gray-500">
                  {t(`type_${it.type}` as TranslationKey)}
                  {!it.free && ` · ${formatYen(it.price)}`}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SaucePickerModal({
  sauces,
  selectedIds,
  onSave,
  onCancel,
  t,
}: {
  sauces: MenuItem[];
  selectedIds: string[];
  onSave: (ids: string[]) => void;
  onCancel: () => void;
  t: (k: TranslationKey) => string;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(selectedIds));

  const toggle = (id: string) => {
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-black text-gray-900">
            {t('pickSauces')}
          </h3>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {sauces.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-6">
              {t('noSauces')}
            </p>
          )}
          {sauces.map((s) => {
            const on = sel.has(s.id);
            return (
              <button
                key={s.id}
                onClick={() => toggle(s.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                  on
                    ? 'bg-orange-50 border-orange-500'
                    : 'bg-white border-gray-200'
                }`}
              >
                <div
                  className="w-8 h-8 rounded-full border border-gray-200 shrink-0"
                  style={{ backgroundColor: s.color ?? '#e5e7eb' }}
                />
                <span className="flex-1 text-sm font-bold text-gray-900">
                  {s.name}
                </span>
                {on && <span className="text-orange-500 font-black">✓</span>}
              </button>
            );
          })}
        </div>
        <div className="p-3 border-t border-gray-200 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold"
          >
            {t('cancel')}
          </button>
          <button
            onClick={() => onSave([...sel])}
            className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold"
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}