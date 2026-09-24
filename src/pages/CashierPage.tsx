import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import {
  SetPickerDialog,
  type CategoryWithItems,
} from '@/components/SetPickerDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageActions } from '@/components/PageActions';
import { printCustomerTicket } from '@/services/printer';
import {
  pushUndo,
  popUndo,
  useUndoStack,
  type UndoRecord,
} from '@/services/undo';
import type {
  MenuCategory,
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
  X,
  Search,
  Zap,
  Pencil,
  FilePlus2,
  Save,
  RotateCcw,
  Undo2,
} from 'lucide-react';

const QUICK_ACCESS_REGEX =
  /sauce|topping|extra|drink|напит|соус|топпинг|добавк|ichim|qo'shim/i;

const SET_REGEX = /set/i;

export default function CashierPage() {
  const { t, lang } = useI18n();

  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('OUTSIDE');
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [lastOrderNumber, setLastOrderNumber] = useState<number | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [setPickerItem, setSetPickerItem] = useState<MenuItem | null>(null);
  const [pendingUndo, setPendingUndo] = useState<UndoRecord | null>(null);
  const cartIdCounter = useRef(0);

  const undoStack = useUndoStack('cashier');

  useEffect(() => {
    const unsubInit = subscribeInit((snap) => {
      setActiveOrders(snap.orders);
      setCategories(snap.menu.categories);
      setMenuItems(snap.menu.items);
    });

    const unsubOrders = subscribeOrders((orders) => {
      if (sending) return;
      setActiveOrders(orders);
    });

    const unsubMenu = subscribeMenu((m) => {
      setCategories(m.categories);
      setMenuItems(m.items);
    });

    getSocket();

    return () => {
      unsubInit();
      unsubOrders();
      unsubMenu();
    };
  }, [sending]);

  const quickAccessCategories = useMemo(
    () =>
      categories.filter((c) =>
        QUICK_ACCESS_REGEX.test(`${c.name} ${c.short_name}`)
      ),
    [categories]
  );

  const quickAccessIds = useMemo(
    () => new Set(quickAccessCategories.map((c) => c.id)),
    [quickAccessCategories]
  );

  const mainCategories = useMemo(
    () => categories.filter((c) => !quickAccessIds.has(c.id)),
    [categories, quickAccessIds]
  );

  const sauceCategory: CategoryWithItems | null = useMemo(() => {
    const cat = categories.find((c) => /sauce/i.test(c.name));
    if (!cat) return null;
    return {
      ...cat,
      items: menuItems.filter((i) => i.category_id === cat.id && i.active),
    };
  }, [categories, menuItems]);

  const drinkCategory: CategoryWithItems | null = useMemo(() => {
    const cat = categories.find((c) => /drink|напит/i.test(c.name));
    if (!cat) return null;
    return {
      ...cat,
      items: menuItems.filter((i) => i.category_id === cat.id && i.active),
    };
  }, [categories, menuItems]);

  const isSetItem = useCallback(
    (item: MenuItem) => {
      const cat = categories.find((c) => c.id === item.category_id);
      return cat ? SET_REGEX.test(cat.name) : false;
    },
    [categories]
  );

  const filteredItems = useMemo(
    () =>
      menuItems.filter((item) => {
        if (quickAccessIds.has(item.category_id)) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          return (
            item.name.toLowerCase().includes(q) ||
            item.variant.toLowerCase().includes(q) ||
            item.short_name.toLowerCase().includes(q)
          );
        }
        if (activeCategory) return item.category_id === activeCategory;
        return true;
      }),
    [menuItems, quickAccessIds, searchQuery, activeCategory]
  );

  const groupedItems = useMemo(
    () =>
      mainCategories
        .map((cat) => ({
          category: cat,
          items: filteredItems.filter((i) => i.category_id === cat.id),
        }))
        .filter((g) => g.items.length > 0),
    [mainCategories, filteredItems]
  );

  const cartTotal = useMemo(
    () =>
      cart
        .filter((i) => !i.is_removed)
        .reduce(
          (sum, item) =>
            sum +
            item.price * item.quantity +
            item.options.reduce((s, o) => s + o.price * o.quantity, 0),
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
          variant: item.variant,
          price: item.price,
          quantity: 1,
          options: [],
          is_removed: false,
          is_added_later: Boolean(editingOrder),
        },
      ];
    });
  };

  const addToCartWithOptions = (item: MenuItem, options: CartItemOption[]) => {
    cartIdCounter.current += 1;
    setCart((prev) => [
      ...prev,
      {
        id: `cart-${cartIdCounter.current}`,
        menu_item_id: item.id,
        name: item.name,
        short_name: item.short_name,
        variant: item.variant,
        price: item.price,
        quantity: 1,
        options,
        is_removed: false,
        is_added_later: Boolean(editingOrder),
      },
    ]);
  };

  const handleItemClick = (item: MenuItem) => {
    if (isSetItem(item)) setSetPickerItem(item);
    else addToCart(item);
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
        .map((c) =>
          c.id === cartId ? { ...c, quantity: c.quantity - 1 } : c
        )
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
            subtotal: c.price * c.quantity,
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
          subtotal: c.is_removed ? 0 : c.price * c.quantity,
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

  return (
    <div className="flex h-full min-h-0">
      <PageActions forRole="cashier">
        <button
          onClick={askUndo}
          disabled={undoStack.length === 0}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-300 bg-white hover:bg-gray-100 text-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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

      {/* ============ LEFT: Заказы ============ */}
      <div className="w-44 lg:w-56 xl:w-60 shrink-0 bg-white border-r border-gray-200 flex flex-col min-h-0">
        <div className="px-3 py-2.5 border-b border-gray-200 shrink-0">
          <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
            {t('activeOrders')}
          </h2>
          <span className="text-2xl font-bold text-orange-600">
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
            const isModified = order.is_modified === true;

            const baseClasses = isCancelled
              ? 'bg-red-50 border-red-300 opacity-60'
              : isEditing
              ? 'bg-orange-100 border-orange-500 ring-2 ring-orange-300'
              : isModified
              ? 'bg-orange-50 border-orange-400'
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
                className={`w-full text-left p-3 rounded-xl border-2 transition-all ${baseClasses} ${
                  isCancelled
                    ? 'cursor-not-allowed'
                    : 'cursor-pointer active:scale-[0.97]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xl font-bold ${
                      isCancelled
                        ? 'text-red-700'
                        : isEditing || isModified
                        ? 'text-orange-700'
                        : 'text-gray-900'
                    }`}
                  >
                    #{order.order_number}
                  </span>
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-bold ${
                      order.order_type === 'INSIDE'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-purple-100 text-purple-700'
                    }`}
                  >
                    {order.order_type === 'INSIDE' ? 'IN' : 'OUT'}
                  </span>
                </div>

                <div className={isCancelled ? 'line-through' : ''}>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-gray-500">
                      {formatTimeAgo(order.created_at, lang)}
                    </span>
                    <span className="text-sm font-bold text-gray-700">
                      {formatYen(order.total_amount)}
                    </span>
                  </div>
                </div>

                {order.status === 'READY' && !isEditing && !isModified && (
                  <div className="mt-1 text-xs text-green-600 font-bold">
                    {t('statusReady')}
                  </div>
                )}
                {order.status === 'PREPARING' && !isEditing && !isModified && (
                  <div className="mt-1 text-xs text-yellow-600 font-bold">
                    {t('statusCooking')}
                  </div>
                )}
                {isCancelled && (
                  <div className="mt-1 text-xs text-red-600 font-bold">
                    {t('cancelled')}
                  </div>
                )}
                {isEditing && (
                  <div className="mt-1 text-xs text-orange-700 font-bold flex items-center gap-1">
                    <Pencil className="w-3 h-3" />
                    {t('editingOrder')}
                  </div>
                )}
                {!isEditing && isModified && !isCancelled && (
                  <div className="mt-1 text-xs text-orange-700 font-bold flex items-center gap-1">
                    <Pencil className="w-3 h-3" />
                    {t('modified')}
                  </div>
                )}

                {!isCancelled && !isEditing && !isModified && (
                  <div className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-400 font-medium">
                    <Pencil className="w-3 h-3" />
                    {t('editOrder')}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="p-2 border-t border-gray-200 shrink-0">
          <button
            onClick={handleNewOrder}
            className="w-full flex items-center justify-center gap-2 px-3 py-3.5 rounded-xl bg-orange-500 active:bg-orange-600 text-white text-sm font-bold transition-all active:scale-[0.97] shadow-md shadow-orange-500/20"
          >
            <FilePlus2 className="w-5 h-5" />
            {t('newOrder')}
          </button>
        </div>
      </div>

      {/* ============ CENTER: Меню ============ */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-slate-50">
        <div className="flex items-center gap-2 px-3 py-2.5 bg-white border-b border-gray-200 shrink-0">
          <div className="flex rounded-xl overflow-hidden border-2 border-gray-300 shadow-sm">
            <button
              onClick={() => setOrderType('OUTSIDE')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold transition-all ${
                orderType === 'OUTSIDE'
                  ? 'bg-purple-600 text-white'
                  : 'bg-white text-gray-600'
              }`}
            >
              <ShoppingBag className="w-4 h-4" />
              {t('orderTypeOutside')}
            </button>
            <button
              onClick={() => setOrderType('INSIDE')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold transition-all ${
                orderType === 'INSIDE'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600'
              }`}
            >
              <Store className="w-4 h-4" />
              {t('orderTypeInside')}
            </button>
          </div>

          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('searchMenu')}
              className="w-full bg-white border-2 border-gray-300 rounded-xl pl-10 pr-10 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-orange-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg active:bg-gray-100"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-1.5 px-3 py-2 overflow-x-auto bg-white border-b border-gray-200 shrink-0">
          <button
            onClick={() => setActiveCategory(null)}
            className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all active:scale-95 ${
              activeCategory === null
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                : 'bg-gray-100 text-gray-700'
            }`}
          >
            {t('all')}
          </button>
          {mainCategories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all active:scale-95 ${
                activeCategory === cat.id
                  ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {error && (
              <div className="mb-3 p-3 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
              {groupedItems.map(({ category, items }) => {
                const categoryImage =
                  items.find((i) => i.image_url)?.image_url ?? null;

                return (
                  <div
                    key={category.id}
                    className="bg-white border-2 border-gray-200 rounded-2xl overflow-hidden shadow-sm"
                  >
                    <div className="relative h-20 bg-gradient-to-br from-orange-100 via-orange-50 to-amber-50 flex items-center justify-center overflow-hidden">
                      {categoryImage ? (
                        <img
                          src={categoryImage}
                          alt={category.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="text-3xl font-black text-orange-300 tracking-tight">
                          {category.short_name ||
                            category.name.slice(0, 3).toUpperCase()}
                        </span>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 px-3 py-1.5 flex items-center justify-between gap-1">
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider truncate drop-shadow">
                          {category.name}
                        </h3>
                        <span className="text-xs font-bold text-white bg-black/40 px-2 py-0.5 rounded-full shrink-0">
                          {items.length}
                        </span>
                      </div>
                    </div>

                    <div className="p-2">
                      <div className="grid grid-cols-3 gap-2">
                        {items.map((item) => {
                          const displayImage =
                            item.image_url || categoryImage;

                          return (
                            <button
                              key={item.id}
                              onClick={() => handleItemClick(item)}
                              className="group relative aspect-square rounded-xl overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 border-2 border-gray-200 active:border-orange-400 transition-all active:scale-95"
                            >
                              {displayImage ? (
                                <>
                                  <img
                                    src={displayImage}
                                    alt={item.variant || item.name}
                                    className="absolute inset-0 w-full h-full object-cover"
                                    loading="lazy"
                                  />
                                  <div className="absolute inset-0 bg-black/45" />
                                </>
                              ) : (
                                <div className="absolute inset-0 bg-gradient-to-br from-orange-500 to-red-500" />
                              )}

                              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1">
                                <div className="text-sm sm:text-base font-black text-white leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                                  {item.variant || item.name}
                                </div>
                                {item.price > 0 && (
                                  <div className="text-sm sm:text-base font-black leading-tight mt-1 text-yellow-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                                    {formatYen(item.price)}
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="w-48 lg:w-56 xl:w-60 shrink-0 bg-white border-l border-gray-200 flex flex-col min-h-0">
            <div className="px-3 py-2.5 border-b border-gray-200 shrink-0 flex items-center gap-2">
              <Zap className="w-4 h-4 text-orange-500 shrink-0" />
              <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider truncate">
                {t('quickAccess')}
              </h2>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-3">
              {quickAccessCategories.map((cat) => {
                const items = menuItems.filter(
                  (i) => i.category_id === cat.id && i.active
                );
                if (items.length === 0) return null;

                const categoryImage =
                  items.find((i) => i.image_url)?.image_url ?? null;

                return (
                  <div key={cat.id}>
                    <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 px-1">
                      {cat.name}
                    </h3>
                    <div className="grid grid-cols-2 gap-1.5">
                      {items.map((item) => {
                        const displayImage =
                          item.image_url || categoryImage;

                        return (
                          <button
                            key={item.id}
                            onClick={() => addToCart(item)}
                            className="group relative aspect-square rounded-xl overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 border-2 border-gray-200 active:border-orange-400 transition-all active:scale-95"
                          >
                            {displayImage ? (
                              <>
                                <img
                                  src={displayImage}
                                  alt={item.variant || item.name}
                                  className="absolute inset-0 w-full h-full object-cover"
                                  loading="lazy"
                                />
                                <div className="absolute inset-0 bg-black/45" />
                              </>
                            ) : (
                              <div className="absolute inset-0 bg-gradient-to-br from-orange-500 to-red-500" />
                            )}

                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1">
                              <div className="text-xs font-black text-white leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] line-clamp-2">
                                {item.variant || item.name}
                              </div>
                              {item.price > 0 && (
                                <div className="text-xs font-black leading-tight mt-1 text-yellow-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                                  ¥{item.price}
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ============ RIGHT: Корзина ============ */}
      <div className="w-80 lg:w-96 xl:w-[26rem] shrink-0 bg-white border-l border-gray-200 flex flex-col min-h-0">
        <div
          className={`px-4 py-3 border-b shrink-0 ${
            editingOrder
              ? 'bg-orange-50 border-orange-300'
              : 'border-gray-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900">
              {editingOrder
                ? `${t('editingOrder')} #${editingOrder.order_number}`
                : t('currentOrder')}
            </h2>
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                orderType === 'INSIDE'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-purple-100 text-purple-700'
              }`}
            >
              {orderType === 'INSIDE' ? t('inside') : t('outside')}
            </span>
          </div>
          {!editingOrder && lastOrderNumber && (
            <p className="text-xs text-green-600 mt-1">
              {t('lastOrder')}: #{lastOrderNumber}
            </p>
          )}
          {editingOrder && (
            <button
              onClick={handleCancelEdit}
              className="mt-2 flex items-center gap-1.5 text-xs text-orange-700 font-bold active:text-orange-800"
            >
              <RotateCcw className="w-4 h-4" />
              {t('cancelEdit')}
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2 bg-slate-50">
          {cart.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <ShoppingBag className="w-14 h-14 mb-2 opacity-40" />
              <p className="text-sm">{t('tapItemsToAdd')}</p>
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

            return (
              <div
                key={item.id}
                className={`rounded-xl p-3 border-2 shadow-sm transition-all ${cardClass}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div
                    className={`flex-1 min-w-0 ${
                      removed ? 'line-through' : ''
                    }`}
                  >
                    <div className="text-sm font-bold text-gray-900 truncate">
                      {item.name} {item.variant}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {item.price > 0 ? formatYen(item.price) : t('free')}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {removed && (
                      <span className="text-[9px] bg-red-200 text-red-800 px-1.5 py-0.5 rounded font-black uppercase">
                        {t('removed')}
                      </span>
                    )}
                    {isNew && !removed && (
                      <span className="text-[9px] bg-orange-500 text-white px-1.5 py-0.5 rounded font-black uppercase">
                        {t('newItem')}
                      </span>
                    )}
                    <button
                      onClick={() => removeItem(item.id)}
                      className={`p-2 rounded-lg active:scale-95 transition-transform ${
                        removed
                          ? 'text-green-600 active:bg-green-100'
                          : 'text-gray-400 active:bg-red-100'
                      }`}
                    >
                      {removed ? (
                        <RotateCcw className="w-5 h-5" />
                      ) : (
                        <Trash2 className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>

                {item.options.length > 0 && !removed && (
                  <div className="mb-2 pl-1 space-y-0.5">
                    {item.options.map((opt, i) => (
                      <div
                        key={i}
                        className="text-[11px] text-gray-600 flex items-center gap-1"
                      >
                        <span className="text-orange-500 font-bold">+</span>
                        <span className="font-medium">{opt.name}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div
                    className={`flex items-center gap-2 ${
                      removed ? 'opacity-50' : ''
                    }`}
                  >
                    <button
                      onClick={() => decrementItem(item.id)}
                      disabled={removed}
                      className="w-11 h-11 rounded-xl bg-gray-100 active:bg-gray-200 flex items-center justify-center transition-colors text-gray-700 disabled:opacity-50 active:scale-95"
                    >
                      <Minus className="w-5 h-5" />
                    </button>
                    <span className="text-xl font-bold w-10 text-center text-gray-900">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => incrementItem(item.id)}
                      disabled={removed}
                      className="w-11 h-11 rounded-xl bg-gray-100 active:bg-gray-200 flex items-center justify-center transition-colors text-gray-700 disabled:opacity-50 active:scale-95"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                  <span
                    className={`text-base font-bold ${
                      removed
                        ? 'text-gray-400 line-through'
                        : isNew
                        ? 'text-orange-700'
                        : 'text-orange-600'
                    }`}
                  >
                    {removed
                      ? formatYen(0)
                      : formatYen(item.price * item.quantity)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-gray-200 bg-white shrink-0">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('addComment')}
            className="w-full bg-white border-2 border-gray-300 rounded-xl px-3.5 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-orange-500"
          />
        </div>

        <div className="p-3 border-t border-gray-200 space-y-3 bg-white shrink-0">
          {printError && (
            <div className="p-2.5 bg-red-50 border border-red-300 rounded-lg text-red-700 text-xs flex items-center justify-between">
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
            <span className="text-sm text-gray-500">{t('total')}</span>
            <span className="text-2xl font-bold text-orange-600">
              {formatYen(cartTotal)}
            </span>
          </div>

          {editingOrder ? (
            <button
              onClick={handleSaveChanges}
              disabled={!hasActiveItems || sending}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-bold text-base flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-orange-500/30"
            >
              {sending ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('sending')}
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  {t('saveChanges')}
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleSendToKitchen}
              disabled={!hasActiveItems || sending}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-bold text-base flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-orange-500/30"
            >
              {sending ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('sending')}
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  {t('sendToKitchen')}
                </>
              )}
            </button>
          )}

          {cart.length > 0 && !editingOrder && (
            <button
              onClick={() => setCart([])}
              className="w-full py-2.5 text-sm text-gray-500 active:text-red-500 font-medium rounded-lg active:bg-gray-100"
            >
              {t('clearAll')}
            </button>
          )}
        </div>
      </div>

      <SetPickerDialog
        open={setPickerItem !== null}
        item={setPickerItem}
        sauceCategory={sauceCategory}
        drinkCategory={drinkCategory}
        onConfirm={(options) => {
          if (setPickerItem) addToCartWithOptions(setPickerItem, options);
          setSetPickerItem(null);
        }}
        onCancel={() => setSetPickerItem(null)}
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