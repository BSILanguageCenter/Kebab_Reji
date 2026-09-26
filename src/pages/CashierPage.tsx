import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { formatYen, formatTimeAgo } from '@/locale/format';
import { useI18n } from '@/locale';
import {
  getSocket,
  subscribeInit,
  subscribeOrders,
  subscribeMenu,
  emitCreateOrder,
  emitUpdateOrder,
  emitUpdateStatus,
} from '@/lib/socket';
import { ClearCartDialog } from '@/components/ClearCartDialog';
import { ProductBuilderDialog } from '@/components/ProductBuilderDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageActions } from '@/components/PageActions';
import { Resizer } from '@/components/Resizer';
import { printCustomerTicket } from '@/services/printer';
import {
  pushUndo,
  popUndo,
  useUndoStack,
  type UndoRecord,
} from '@/services/undo';
import {
  useLayoutSettings,
  clampLayout,
  snapValue,
} from '@/lib/layoutSettings';
import type {
  MenuItem,
  CartItem,
  CartItemOption,
  Order,
  OrderType,
} from '@/types/database';
import {
  Plus,
  Minus,
  Trash2,
  Send,
  ShoppingBag,
  Store,
  RotateCcw,
  Undo2,
  FilePlus2,
  Pencil,
  Save,
} from 'lucide-react';

// ============================================================
// Категории (пространства) — dish и set вместе
// ============================================================
type CategorySpace = 'dishset' | 'drink' | 'sauce' | 'topping';

function getSpaceItems(items: MenuItem[], space: CategorySpace): MenuItem[] {
  if (space === 'dishset') {
    return items.filter((i) => i.type === 'dish' || i.type === 'set');
  }
  return items.filter((i) => i.type === space);
}

// ============================================================
// Ширина карточки в ячейках
// ============================================================
function getItemWidth(item: MenuItem): number {
  if (item.type === 'dish' && item.dish_kind === 'group') {
    return Math.max(1, item.variants?.length ?? 1);
  }
  if (item.type === 'set' && item.set_main?.dish_kind === 'group') {
    return Math.max(1, item.set_main.variants?.length ?? 1);
  }
  return 1;
}

const GRID_GAP = 12;

export default function CashierPage() {
  const { t, lang } = useI18n();

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('OUTSIDE');
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [lastOrderNumber, setLastOrderNumber] = useState<number | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const [builder, setBuilder] = useState<{
    item: MenuItem;
    variantId?: string;
  } | null>(null);

  const [pendingUndo, setPendingUndo] = useState<UndoRecord | null>(null);
  const cartIdCounter = useRef(0);

  const undoStack = useUndoStack('cashier');
  const [layout, setLayout] = useLayoutSettings();
  const drinksWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubInit = subscribeInit((snap) => {
      setActiveOrders(snap.orders);
      setMenuItems(snap.menu.items);
    });
    const unsubOrders = subscribeOrders((orders) => {
      if (sending) return;
      setActiveOrders(orders);
    });
    const unsubMenu = subscribeMenu((m) => setMenuItems(m.items));
    getSocket();
    return () => {
      unsubInit();
      unsubOrders();
      unsubMenu();
    };
  }, [sending]);

  const tops = useMemo(
    () =>
      menuItems
        .filter((i) => i.active && !i.parent_id)
        .sort((a, b) => a.sort_order - b.sort_order),
    [menuItems]
  );

  const cartTotal = useMemo(
    () =>
      cart
        .filter((i) => !i.is_removed)
        .reduce(
          (sum, item) =>
            sum +
            item.price * item.quantity +
            item.options.reduce((s, o) => s + o.price * o.quantity, 0) *
              item.quantity,
          0
        ),
    [cart]
  );

  const hasActiveItems = useMemo(
    () => cart.some((i) => !i.is_removed),
    [cart]
  );

  const confirmIfCartNotEmpty = (action: () => void) => {
    if (cart.length > 0) setPendingAction(() => action);
    else action();
  };

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find(
        (c) =>
          c.menu_item_id === item.id &&
          c.options.length === 0 &&
          !c.is_removed
      );
      if (existing) {
        return prev.map((c) =>
          c.id === existing.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      cartIdCounter.current += 1;
      return [
        ...prev,
        {
          id: `cart-${cartIdCounter.current}`,
          menu_item_id: item.id,
          name: item.name,
          short_name: item.short_name,
          variant: '',
          price: item.price,
          quantity: 1,
          options: [],
          is_removed: false,
          is_added_later: Boolean(editingOrder),
        },
      ];
    });
  };

  const addToCartFromBuilder = (
    item: MenuItem,
    variant: string,
    price: number,
    options: CartItemOption[]
  ) => {
    cartIdCounter.current += 1;
    setCart((prev) => [
      ...prev,
      {
        id: `cart-${cartIdCounter.current}`,
        menu_item_id: item.id,
        name: item.name,
        short_name: item.short_name,
        variant,
        price,
        quantity: 1,
        options,
        is_removed: false,
        is_added_later: Boolean(editingOrder),
      },
    ]);
  };

  const handleItemClick = (item: MenuItem) => {
    if (
      item.type === 'topping' ||
      item.type === 'drink' ||
      item.type === 'sauce'
    ) {
      addToCart(item);
      return;
    }

    const hasProps = (item.properties?.length ?? 0) > 0;
    const hasSauces =
      item.sauce_mode === 'with' && (item.allowed_sauces?.length ?? 0) > 0;
    if (
      item.type === 'dish' &&
      item.dish_kind === 'single' &&
      !hasProps &&
      !hasSauces
    ) {
      addToCart(item);
      return;
    }

    setBuilder({ item });
  };

  const handleSetVariantClick = (setItem: MenuItem, variant: MenuItem) => {
    setBuilder({ item: setItem, variantId: variant.id });
  };

  const incrementItem = (cartId: string) => {
    setCart((prev) =>
      prev.map((c) =>
        c.id === cartId ? { ...c, quantity: c.quantity + 1 } : c
      )
    );
  };

  const decrementItem = (cartId: string) => {
    setCart((prev) =>
      prev
        .map((c) => (c.id === cartId ? { ...c, quantity: c.quantity - 1 } : c))
        .filter((c) => c.quantity > 0)
    );
  };

  const removeItem = (cartId: string) => {
    setCart((prev) => {
      const item = prev.find((c) => c.id === cartId);
      if (!item) return prev;
      if (editingOrder && !item.is_added_later) {
        return prev.map((c) =>
          c.id === cartId ? { ...c, is_removed: !c.is_removed } : c
        );
      }
      return prev.filter((c) => c.id !== cartId);
    });
  };

  const handleSendToKitchen = async () => {
    if (!hasActiveItems) return;
    setSending(true);
    setError(null);
    setPrintError(null);
    try {
      const created = await emitCreateOrder({
        order_type: orderType,
        total_amount: cartTotal,
        comment,
        order_items: cart
          .filter((c) => !c.is_removed)
          .map((c) => ({
            menu_item_id: c.menu_item_id,
            name: c.name,
            short_name: c.short_name,
            variant: c.variant,
            price: c.price,
            quantity: c.quantity,
            subtotal:
              c.price * c.quantity +
              c.options.reduce((s, o) => s + o.price * o.quantity, 0) *
                c.quantity,
            options: c.options.map((o) => ({
              type: o.type,
              name: o.name,
              price: o.price,
              quantity: o.quantity,
            })),
          })),
      });

      pushUndo('cashier', {
        kind: 'create',
        orderId: created.id,
        orderNumber: created.order_number,
        timestamp: Date.now(),
      });

      setLastOrderNumber(created.order_number);

      const ticketOrder: Order = {
        ...created,
        order_items: cart
          .filter((c) => !c.is_removed)
          .map((c) => ({
            id: 'temp',
            order_id: created.id,
            menu_item_id: c.menu_item_id,
            name: c.name,
            short_name: c.short_name,
            variant: c.variant,
            price: c.price,
            quantity: c.quantity,
            subtotal: c.price * c.quantity,
            created_at: new Date().toISOString(),
            is_removed: false,
            is_added_later: false,
            options: c.options.map((o) => ({
              id: 'temp',
              order_item_id: 'temp',
              type: o.type,
              name: o.name,
              price: o.price,
              quantity: o.quantity,
            })),
          })),
      };

      printCustomerTicket(ticketOrder).then((res) => {
        if (!res.success) setPrintError(res.error ?? t('printerError'));
      });

      setCart([]);
      setComment('');
      setEditingOrder(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToSendOrder'));
    } finally {
      setSending(false);
    }
  };

  const handleSaveChanges = async () => {
    if (!editingOrder || !hasActiveItems) return;
    setSending(true);
    setError(null);
    setPrintError(null);
    try {
      pushUndo('cashier', {
        kind: 'edit',
        orderId: editingOrder.id,
        orderNumber: editingOrder.order_number,
        snapshot: {
          order_type: editingOrder.order_type,
          total_amount: editingOrder.total_amount,
          comment: editingOrder.comment ?? '',
          order_items: (editingOrder.order_items ?? []).map((i) => ({
            menu_item_id: i.menu_item_id,
            name: i.name,
            short_name: i.short_name,
            variant: i.variant,
            price: i.price,
            quantity: i.quantity,
            subtotal: i.subtotal,
            is_removed: i.is_removed ?? false,
            is_added_later: i.is_added_later ?? false,
            options: (i.options ?? []).map((o) => ({
              type: o.type,
              name: o.name,
              price: o.price,
              quantity: o.quantity,
            })),
          })),
        },
        timestamp: Date.now(),
      });

      await emitUpdateOrder({
        id: editingOrder.id,
        order_type: orderType,
        total_amount: cartTotal,
        comment,
        order_items: cart.map((c) => ({
          menu_item_id: c.menu_item_id,
          name: c.name,
          short_name: c.short_name,
          variant: c.variant,
          price: c.price,
          quantity: c.quantity,
          subtotal: c.is_removed
            ? 0
            : c.price * c.quantity +
              c.options.reduce((s, o) => s + o.price * o.quantity, 0) *
                c.quantity,
          is_removed: c.is_removed ?? false,
          is_added_later: c.is_added_later ?? false,
          options: c.options.map((o) => ({
            type: o.type,
            name: o.name,
            price: o.price,
            quantity: o.quantity,
          })),
        })),
      });

      setCart([]);
      setComment('');
      setEditingOrder(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToSendOrder'));
    } finally {
      setSending(false);
    }
  };

  const actuallyEditOrder = (order: Order) => {
    const restored: CartItem[] = (order.order_items ?? []).map((item) => {
      cartIdCounter.current += 1;
      return {
        id: `cart-${cartIdCounter.current}`,
        menu_item_id: item.menu_item_id ?? '',
        name: item.name,
        short_name: item.short_name,
        variant: item.variant,
        price: item.price,
        quantity: item.quantity,
        options: (item.options ?? []).map((o) => ({
          type: o.type,
          name: o.name,
          price: o.price,
          quantity: o.quantity,
        })),
        is_removed: item.is_removed ?? false,
        is_added_later: item.is_added_later ?? false,
        db_id: item.id,
      };
    });
    setCart(restored);
    setOrderType(order.order_type);
    setComment(order.comment ?? '');
    setEditingOrder(order);
  };

  const handleEditOrder = (order: Order) => {
    if (order.status === 'CANCELLED') return;
    if (editingOrder) {
      actuallyEditOrder(order);
      return;
    }
    confirmIfCartNotEmpty(() => actuallyEditOrder(order));
  };

  const handleNewOrder = () => {
    confirmIfCartNotEmpty(() => {
      setCart([]);
      setComment('');
      setOrderType('OUTSIDE');
      setEditingOrder(null);
    });
  };

  const handleCancelEdit = () => {
    setCart([]);
    setComment('');
    setEditingOrder(null);
  };

  const askUndo = () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setPendingUndo(last);
  };

  const confirmUndo = async () => {
    if (!pendingUndo) return;
    const rec = popUndo('cashier');
    setPendingUndo(null);
    if (!rec) return;
    try {
      if (rec.kind === 'create') {
        await emitUpdateStatus(rec.orderId, 'CANCELLED');
      } else if (rec.kind === 'edit' && rec.snapshot) {
        await emitUpdateOrder({
          id: rec.orderId,
          order_type: rec.snapshot.order_type,
          total_amount: rec.snapshot.total_amount,
          comment: rec.snapshot.comment,
          order_items: rec.snapshot.order_items,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('unknownError'));
    }
  };

  // ---------- Resize ----------
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

  const handleResizeOrders = (d: number) => {
    const base = startLayoutRef.current ?? layout;
    setLayout((prev) => ({
      ...prev,
      ordersWidth: clampLayout('ordersWidth', base.ordersWidth + d),
    }));
  };

  const handleResizeMenuRight = (d: number) => {
    const base = startLayoutRef.current ?? layout;
    setLayout((prev) => ({
      ...prev,
      menuRightWidth: clampLayout('menuRightWidth', base.menuRightWidth - d),
    }));
  };

  const handleResizeCart = (d: number) => {
    const base = startLayoutRef.current ?? layout;
    setLayout((prev) => ({
      ...prev,
      cartWidth: clampLayout('cartWidth', base.cartWidth - d),
    }));
  };

  const handleResizeToppings = (d: number) => {
    const base = startLayoutRef.current ?? layout;
    setLayout((prev) => ({
      ...prev,
      toppingsHeight: clampLayout('toppingsHeight', base.toppingsHeight - d),
    }));
  };

  const handleResizeDrinks = (d: number) => {
    const base = startLayoutRef.current ?? layout;
    const containerH = drinksWrapRef.current?.clientHeight ?? 400;
    const pctDelta = (d / containerH) * 100;
    setLayout((prev) => ({
      ...prev,
      drinksShare: clampLayout('drinksShare', base.drinksShare + pctDelta),
    }));
  };

  // ============================================================
  // GRID RENDER — без пустых ячеек, только карточки
  // ============================================================
  const renderGrid = (
    space: CategorySpace,
    size: number,
    compact: boolean
  ) => {
    const spaceItems = getSpaceItems(tops, space);
    const sorted = [...spaceItems].sort(
      (a, b) => a.sort_order - b.sort_order
    );
    const cellH = compact ? size + 32 : size + 50;

    return (
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(auto-fill, ${size}px)`,
          gridAutoRows: `${cellH}px`,
        }}
      >
        {sorted.map((card) => {
          const w = getItemWidth(card);

          let variants: MenuItem[] | undefined;
          if (card.type === 'dish' && card.dish_kind === 'group') {
            variants = card.variants;
          } else if (
            card.type === 'set' &&
            card.set_main?.dish_kind === 'group'
          ) {
            variants = card.set_main.variants;
          }

          return (
            <div
              key={card.id}
              style={{
                gridColumn: `span ${w}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ProductCard
                item={card}
                variants={variants}
                onClick={handleItemClick}
                onVariantClick={(setItem, v) => {
                  if (setItem.type === 'set') {
                    handleSetVariantClick(setItem, v);
                  } else {
                    handleItemClick(v);
                  }
                }}
                size={size}
                textSize={layout.itemTextSize}
                compact={compact}
              />
            </div>
          );
        })}
      </div>
    );
  };

  const hasDishSet = getSpaceItems(tops, 'dishset').length > 0;
  const hasTopping = getSpaceItems(tops, 'topping').length > 0;
  const hasDrink = getSpaceItems(tops, 'drink').length > 0;
  const hasSauce = getSpaceItems(tops, 'sauce').length > 0;

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100">
      <div className="flex items-center gap-3 px-3 py-2 bg-white border-b border-gray-200 shrink-0">
        <PageActions forRole="cashier">
          <button
            onClick={askUndo}
            disabled={undoStack.length === 0}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-300 bg-white hover:bg-gray-100 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Undo2 className="w-3.5 h-3.5" />
            {t('undoLast')}
            {undoStack.length > 0 && (
              <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-black">
                {undoStack.length}
              </span>
            )}
          </button>
        </PageActions>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* ---- LEFT: ORDERS ---- */}
        <div
          className="shrink-0 bg-white border-r-2 border-gray-300 flex flex-col min-h-0"
          style={{ width: layout.ordersWidth }}
        >
          <div className="px-2 py-1 border-b-2 border-gray-300 shrink-0 bg-gray-50">
            <h2 className="text-[9px] font-black text-gray-700 uppercase tracking-wider border-l-2 border-gray-500 pl-1.5 leading-none">
              {t('activeOrders')}
            </h2>
            <span className="text-base font-black text-orange-600 leading-none mt-1 block pl-1.5">
              {activeOrders.filter((o) => o.status !== 'CANCELLED').length}
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
            {activeOrders.length === 0 && (
              <p className="text-gray-400 text-xs text-center mt-6">
                {t('noActiveOrders')}
              </p>
            )}
            {activeOrders.map((order) => {
              const isCancelled = order.status === 'CANCELLED';
              const isEditing = editingOrder?.id === order.id;
              const cls = isCancelled
                ? 'bg-red-50 border-red-300 opacity-60'
                : isEditing
                ? 'bg-orange-100 border-orange-500 ring-2 ring-orange-300'
                : order.status === 'READY'
                ? 'bg-green-50 border-green-400'
                : order.status === 'PREPARING'
                ? 'bg-yellow-50 border-yellow-400'
                : 'bg-gray-50 border-gray-200';
              return (
                <button
                  key={order.id}
                  onClick={() => handleEditOrder(order)}
                  disabled={isCancelled}
                  className={`w-full text-left p-2.5 rounded-xl border-2 transition-all ${cls} ${
                    isCancelled
                      ? 'cursor-not-allowed'
                      : 'cursor-pointer active:scale-[0.97]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold text-gray-900">
                      #{order.order_number}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                        order.order_type === 'INSIDE'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {order.order_type === 'INSIDE' ? 'IN' : 'OUT'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-gray-500">
                      {formatTimeAgo(order.created_at, lang)}
                    </span>
                    <span className="text-xs font-bold text-gray-700">
                      {formatYen(order.total_amount)}
                    </span>
                  </div>
                  {isEditing && (
                    <div className="mt-1 text-[10px] text-orange-700 font-bold flex items-center gap-1">
                      <Pencil className="w-3 h-3" />
                      {t('editingOrder')}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="p-2 border-t border-gray-200 shrink-0">
            <button
              onClick={handleNewOrder}
              className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-orange-500 active:bg-orange-600 text-white text-xs font-bold shadow-md shadow-orange-500/20"
            >
              <FilePlus2 className="w-4 h-4" />
              {t('newOrder')}
            </button>
          </div>
        </div>

        <Resizer
          onStart={beginResize}
          onResize={handleResizeOrders}
          onEnd={endResize}
        />

        {/* ---- CENTER: БЛЮДА И СЕТЫ + ТОППИНГИ ---- */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-slate-50">
          <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200 shrink-0">
            <div className="flex rounded-xl overflow-hidden border-2 border-gray-300 shadow-sm">
              <button
                onClick={() => setOrderType('OUTSIDE')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all ${
                  orderType === 'OUTSIDE'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-gray-600'
                }`}
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                {t('orderTypeOutside')}
              </button>
              <button
                onClick={() => setOrderType('INSIDE')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all ${
                  orderType === 'INSIDE'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600'
                }`}
              >
                <Store className="w-3.5 h-3.5" />
                {t('orderTypeInside')}
              </button>
            </div>
          </div>

          {error && (
            <div className="mx-2 mt-2 p-2 bg-red-50 border border-red-300 rounded-xl text-red-700 text-xs">
              {error}
            </div>
          )}

          {/* Центральная область — скролл только если есть товары */}
          {hasDishSet ? (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <div className="mb-2 px-2 py-1 rounded-md bg-orange-100 border-l-2 border-orange-500">
                <h3 className="text-[9px] font-black text-orange-800 uppercase tracking-wider truncate leading-none">
                  {t('bludiAndSet')}
                </h3>
              </div>
              {renderGrid('dishset', layout.dishCardSize, false)}
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex items-center justify-center text-gray-400 text-sm">
              {t('noMenuItems')}
            </div>
          )}

          {hasTopping && (
            <>
              <Resizer
                direction="horizontal"
                onStart={beginResize}
                onResize={handleResizeToppings}
                onEnd={endResize}
              />
              <div
                className="shrink-0 bg-white px-2 py-1 overflow-hidden border-t-2 border-purple-300"
                style={{ height: layout.toppingsHeight }}
              >
                <h3 className="text-[9px] font-black text-purple-800 uppercase tracking-wider mb-1 border-l-2 border-purple-500 pl-1.5 leading-none">
                  {t('type_topping')}
                </h3>
                <div className="overflow-y-auto h-[calc(100%-16px)]">
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

        {/* ---- RIGHT: НАПИТКИ + СОУСЫ ---- */}
        <div
          ref={drinksWrapRef}
          className="shrink-0 bg-white border-l-2 border-gray-300 flex flex-col min-h-0"
          style={{ width: layout.menuRightWidth }}
        >
          <div
            className="flex flex-col border-b-2 border-cyan-300"
            style={{ height: `${layout.drinksShare}%` }}
          >
            <div className="px-2 py-1 border-b border-cyan-300 shrink-0 bg-cyan-50">
              <h3 className="text-[9px] font-black text-cyan-800 uppercase tracking-wider border-l-2 border-cyan-500 pl-1.5 leading-none">
                {t('type_drink')}
              </h3>
            </div>
            {hasDrink ? (
              <div className="flex-1 min-h-0 overflow-y-auto p-2">
                {renderGrid('drink', layout.drinkCardSize, true)}
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex items-center justify-center text-[10px] text-gray-400">
                —
              </div>
            )}
          </div>

          <Resizer
            direction="horizontal"
            onStart={beginResize}
            onResize={handleResizeDrinks}
            onEnd={endResize}
          />

          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-2 py-1 border-b border-red-300 shrink-0 bg-red-50">
              <h3 className="text-[9px] font-black text-red-800 uppercase tracking-wider border-l-2 border-red-500 pl-1.5 leading-none">
                {t('type_sauce')}
              </h3>
            </div>
            {hasSauce ? (
              <div className="flex-1 min-h-0 overflow-y-auto p-2">
                {renderGrid('sauce', layout.sauceCardSize, true)}
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex items-center justify-center text-[10px] text-gray-400">
                —
              </div>
            )}
          </div>
        </div>

        <Resizer
          onStart={beginResize}
          onResize={handleResizeCart}
          onEnd={endResize}
        />

        {/* ---- FAR RIGHT: CART ---- */}
        <div
          className="shrink-0 bg-white border-l-2 border-gray-300 flex flex-col min-h-0"
          style={{ width: layout.cartWidth }}
        >
          <div
            className={`px-3 py-2 border-b shrink-0 ${
              editingOrder
                ? 'bg-orange-50 border-orange-300'
                : 'border-gray-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 truncate">
                {editingOrder
                  ? `${t('editingOrder')} #${editingOrder.order_number}`
                  : t('currentOrder')}
              </h2>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ml-2 ${
                  orderType === 'INSIDE'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-purple-100 text-purple-700'
                }`}
              >
                {orderType === 'INSIDE' ? t('inside') : t('outside')}
              </span>
            </div>
            {editingOrder && (
              <button
                onClick={handleCancelEdit}
                className="mt-1 flex items-center gap-1 text-[11px] text-orange-700 font-bold"
              >
                <RotateCcw className="w-3 h-3" />
                {t('cancelEdit')}
              </button>
            )}
            {!editingOrder && lastOrderNumber && (
              <p className="text-[10px] text-green-600 mt-0.5">
                {t('lastOrder')}: #{lastOrderNumber}
              </p>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5 bg-slate-50">
            {cart.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <ShoppingBag className="w-12 h-12 mb-2 opacity-40" />
                <p className="text-xs">{t('tapItemsToAdd')}</p>
              </div>
            )}
            {cart.map((item) => {
              const removed = item.is_removed ?? false;
              const isNew = item.is_added_later ?? false;
              const cardClass = removed
                ? 'bg-red-50 border-red-300 opacity-70'
                : isNew
                ? 'bg-orange-50 border-orange-400 ring-1 ring-orange-300'
                : 'bg-white border-gray-200';
              const lineTotal =
                item.price * item.quantity +
                item.options.reduce((s, o) => s + o.price * o.quantity, 0) *
                  item.quantity;
              return (
                <div
                  key={item.id}
                  className={`rounded-xl p-2.5 border-2 ${cardClass}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div
                      className={`flex-1 min-w-0 ${
                        removed ? 'line-through' : ''
                      }`}
                    >
                      <div className="text-xs font-bold text-gray-900 truncate">
                        {item.name}
                        {item.variant && (
                          <span className="ml-1 text-orange-600">
                            {item.variant}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      className={`p-1 rounded-lg ${
                        removed
                          ? 'text-green-600'
                          : 'text-gray-400 hover:text-red-600'
                      }`}
                    >
                      {removed ? (
                        <RotateCcw className="w-4 h-4" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  {item.options.length > 0 && !removed && (
                    <div className="mb-1.5 space-y-0.5">
                      {item.options.map((opt, i) => (
                        <div
                          key={i}
                          className="text-[10px] text-gray-600 flex items-center gap-1"
                        >
                          <span className="text-orange-500 font-bold">+</span>
                          <span className="truncate">{opt.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => decrementItem(item.id)}
                        disabled={removed}
                        className="w-7 h-7 rounded-lg bg-gray-100 active:bg-gray-200 flex items-center justify-center disabled:opacity-50"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-sm font-bold w-6 text-center">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => incrementItem(item.id)}
                        disabled={removed}
                        className="w-7 h-7 rounded-lg bg-gray-100 active:bg-gray-200 flex items-center justify-center disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <span
                      className={`text-sm font-black ${
                        removed
                          ? 'text-gray-400 line-through'
                          : 'text-orange-600'
                      }`}
                    >
                      {removed ? formatYen(0) : formatYen(lineTotal)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-2 border-t border-gray-200 bg-white shrink-0">
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('addComment')}
              className="w-full bg-white border-2 border-gray-300 rounded-xl px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-orange-500"
            />
          </div>

          <div className="p-2 border-t border-gray-200 space-y-2 bg-white shrink-0">
            {printError && (
              <div className="p-2 bg-red-50 border border-red-300 rounded-lg text-red-700 text-[11px] flex items-center justify-between">
                <span>{t('printerError')}</span>
                <button
                  onClick={() => setPrintError(null)}
                  className="text-red-600 font-bold underline"
                >
                  {t('retryPrint')}
                </button>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">{t('total')}</span>
              <span className="text-xl font-black text-orange-600">
                {formatYen(cartTotal)}
              </span>
            </div>

            {editingOrder ? (
              <button
                onClick={handleSaveChanges}
                disabled={!hasActiveItems || sending}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-40"
              >
                {sending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('sending')}
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    {t('saveChanges')}
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleSendToKitchen}
                disabled={!hasActiveItems || sending}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-40"
              >
                {sending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('sending')}
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    {t('sendToKitchen')}
                  </>
                )}
              </button>
            )}

            {cart.length > 0 && !editingOrder && (
              <button
                onClick={() => setCart([])}
                className="w-full py-1.5 text-[11px] text-gray-500 active:text-red-500 font-medium"
              >
                {t('clearAll')}
              </button>
            )}
          </div>
        </div>
      </div>

      <ProductBuilderDialog
        open={builder !== null}
        item={builder?.item ?? null}
        initialVariantId={builder?.variantId}
        onConfirm={({ variant, price, options }) => {
          if (builder)
            addToCartFromBuilder(builder.item, variant, price, options);
          setBuilder(null);
        }}
        onCancel={() => setBuilder(null)}
      />

      <ClearCartDialog
        open={pendingAction !== null}
        onConfirm={() => {
          const fn = pendingAction;
          setPendingAction(null);
          fn?.();
        }}
        onCancel={() => setPendingAction(null)}
      />

      <ConfirmDialog
        open={pendingUndo !== null}
        title={t('confirmTitle')}
        message={
          pendingUndo?.kind === 'create'
            ? t('undoCreateOrder').replace(
                '{n}',
                String(pendingUndo.orderNumber)
              )
            : pendingUndo?.kind === 'edit'
            ? t('undoEditOrder').replace(
                '{n}',
                String(pendingUndo.orderNumber)
              )
            : ''
        }
        confirmLabel={t('yes')}
        variant="red"
        onConfirm={confirmUndo}
        onCancel={() => setPendingUndo(null)}
      />
    </div>
  );
}

// ============================================================
// PRODUCT CARD — визуал 1:1 с MenuProduct,
// но БЕЗ drag, без стрелок, только клик
// ============================================================
const ProductCard = memo(function ProductCard({
  item,
  variants,
  onClick,
  onVariantClick,
  size,
  textSize,
  compact,
}: {
  item: MenuItem;
  variants?: MenuItem[];
  onClick: (i: MenuItem) => void;
  onVariantClick?: (setItem: MenuItem, v: MenuItem) => void;
  size: number;
  textSize: number;
  compact?: boolean;
}) {
  const isGroup = (variants?.length ?? 0) > 0;
  const nameSize = compact ? Math.max(8, textSize - 2) : textSize;
  const priceSize = compact ? Math.max(8, textSize - 2) : textSize;

  // ============ SINGLE ============
  if (!isGroup) {
    return (
      <button
        onClick={() => onClick(item)}
        style={{ width: size }}
        className="flex flex-col items-center select-none active:scale-95 transition-transform"
      >
        <div
          className="relative rounded-xl overflow-hidden border-2 border-gray-300 hover:border-orange-400 transition-all"
          style={{
            width: size,
            height: size,
            background:
              item.type === 'sauce'
                ? '#ffffff'
                : 'linear-gradient(to bottom right, #f97316, #dc2626)',
            borderColor:
              item.type === 'sauce'
                ? item.color ?? '#e5e7eb'
                : undefined,
            borderWidth: item.type === 'sauce' ? 4 : 2,
          }}
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
              {item.type !== 'sauce' && (
                <div className="absolute inset-0 bg-black/40" />
              )}
            </>
          ) : item.type === 'sauce' ? (
            <div
              className="absolute inset-0"
              style={{
                backgroundColor: item.color ?? '#e5e7eb',
                opacity: 0.25,
              }}
            />
          ) : null}
        </div>
        <div
          className="mt-0 text-center font-black text-gray-900 truncate w-full px-0.5 leading-[1.05]"
          style={{ fontSize: nameSize }}
          title={item.name}
        >
          {item.short_name || item.name}
        </div>
        <div
          className="text-center font-black text-orange-600 w-full px-0.5 leading-[1.05] -mt-px"
          style={{ fontSize: priceSize }}
        >
          {item.free ? '' : formatYen(item.price)}
        </div>
      </button>
    );
  }

  // ============ GROUP ============
  const headerH = nameSize + 8;

  return (
    <div
      style={{ width: '100%', minHeight: headerH + size + nameSize * 2 + 4 }}
      className="rounded-xl bg-white ring-2 ring-gray-400 hover:ring-orange-400 flex flex-col overflow-hidden transition-all"
    >
      <button
        onClick={() => onClick(item)}
        className="flex items-center justify-between w-full px-2 py-0.5 border-b border-gray-200 bg-gray-50 hover:bg-orange-50 transition-colors shrink-0 leading-none"
      >
        <span
          className="font-black text-gray-900 uppercase tracking-wide truncate text-left leading-none"
          style={{ fontSize: nameSize }}
        >
          {item.name}
        </span>
        {item.type === 'set' && (
          <span
            className="font-black bg-orange-500 text-white px-1.5 rounded-full shrink-0 ml-1 leading-none py-0.5"
            style={{ fontSize: Math.max(7, nameSize - 3) }}
          >
            SET
          </span>
        )}
      </button>

      <div className="flex items-stretch" style={{ gap: GRID_GAP }}>
        {variants!.map((v) => (
          <button
            key={v.id}
            onClick={() => {
              if (onVariantClick) onVariantClick(item, v);
              else onClick(v);
            }}
            style={{ width: size, flex: '0 0 auto' }}
            className="flex flex-col items-center active:scale-95 transition-transform"
          >
            <div
              className="relative rounded-xl overflow-hidden border-2 border-gray-300 hover:border-orange-400 transition-all"
              style={{
                width: size,
                height: size,
                background:
                  'linear-gradient(to bottom right, #f97316, #dc2626)',
              }}
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
              className="mt-0 text-center font-black text-gray-900 truncate w-full px-0.5 leading-[1.05]"
              style={{ fontSize: nameSize }}
            >
              {v.name}
            </div>
            <div
              className="text-center font-black text-orange-600 w-full px-0.5 leading-[1.05] -mt-px"
              style={{ fontSize: priceSize }}
            >
              {v.free ? '' : formatYen(v.price)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
});