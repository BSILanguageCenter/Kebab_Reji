import { useState, useEffect, useRef, useMemo } from 'react';
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
import { printCustomerTicket } from '@/services/printer';
import {
  pushUndo,
  popUndo,
  useUndoStack,
  type UndoRecord,
} from '@/services/undo';
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
  X,
  Search,
  Pencil,
  FilePlus2,
  Save,
  RotateCcw,
  Undo2,
} from 'lucide-react';

export default function CashierPage() {
  const { t, lang } = useI18n();

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('OUTSIDE');
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [lastOrderNumber, setLastOrderNumber] = useState<number | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [builderItem, setBuilderItem] = useState<MenuItem | null>(null);
  const [pendingUndo, setPendingUndo] = useState<UndoRecord | null>(null);
  const cartIdCounter = useRef(0);

  const undoStack = useUndoStack('cashier');

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

  // ---------- Группировка по типам ----------
  const dishes = useMemo(
    () =>
      menuItems
        .filter((i) => i.type === 'dish' && i.active)
        .sort((a, b) => a.sort_order - b.sort_order),
    [menuItems]
  );
  const sets = useMemo(
    () =>
      menuItems
        .filter((i) => i.type === 'set' && i.active)
        .sort((a, b) => a.sort_order - b.sort_order),
    [menuItems]
  );
  const toppings = useMemo(
    () =>
      menuItems
        .filter((i) => i.type === 'topping' && i.active)
        .sort((a, b) => a.sort_order - b.sort_order),
    [menuItems]
  );
  const drinks = useMemo(
    () =>
      menuItems
        .filter((i) => i.type === 'drink' && i.active)
        .sort((a, b) => a.sort_order - b.sort_order),
    [menuItems]
  );
  const sauces = useMemo(
    () =>
      menuItems
        .filter((i) => i.type === 'sauce' && i.active)
        .sort((a, b) => a.sort_order - b.sort_order),
    [menuItems]
  );

  const filterBySearch = (arr: MenuItem[]) =>
    searchQuery
      ? arr.filter(
          (i) =>
            i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            i.short_name.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : arr;

  const filteredDishes = useMemo(
    () => filterBySearch(dishes),
    [dishes, searchQuery]
  );
  const filteredSets = useMemo(
    () => filterBySearch(sets),
    [sets, searchQuery]
  );

  // ---------- Корзина ----------
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
    const hasVariants = (item.variants?.length ?? 0) > 0;
    const hasProps = (item.properties?.length ?? 0) > 0;
    const hasSauces =
      item.sauce_mode === 'with' && (item.allowed_sauces?.length ?? 0) > 0;
    const hasExtras = (item.set_extra_groups?.length ?? 0) > 0;

    const needsBuilder =
      item.type === 'set' ||
      (item.type === 'dish' && item.dish_kind === 'group') ||
      hasVariants ||
      hasProps ||
      hasSauces ||
      hasExtras;

    if (needsBuilder) setBuilderItem(item);
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

  // ---------- Отправка ----------
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

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100">
      {/* ============ HEADER ============ */}
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

      {/* ============ MAIN 4-COLUMN LAYOUT ============ */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* -------- COLUMN 1: ORDERS -------- */}
        <div className="w-44 lg:w-52 xl:w-56 shrink-0 bg-white border-r border-gray-200 flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-gray-200 shrink-0">
            <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">
              {t('activeOrders')}
            </h2>
            <span className="text-xl font-bold text-orange-600">
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
              const baseClasses = isCancelled
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
                  className={`w-full text-left p-2.5 rounded-xl border-2 transition-all ${baseClasses} ${
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

        {/* -------- COLUMN 2: DISHES + SETS + TOPPINGS -------- */}
        <div className="flex-1 min-w-0 bg-slate-50 flex flex-col min-h-0">
          {/* Order type + search */}
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
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('searchMenu')}
                className="w-full bg-white border-2 border-gray-300 rounded-xl pl-9 pr-9 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-orange-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg active:bg-gray-100"
                >
                  <X className="w-3.5 h-3.5 text-gray-400" />
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="m-2 p-2 bg-red-50 border border-red-300 rounded-xl text-red-700 text-xs">
              {error}
            </div>
          )}

          {/* Bludi i Set */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {(filteredDishes.length > 0 || filteredSets.length > 0) && (
              <div className="mb-2">
                <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  {t('bludiAndSet')}
                </h3>
              </div>
            )}

            {/* Dishes */}
            {filteredDishes.length > 0 && (
              <div className="mb-3">
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                  {filteredDishes.map((dish) => (
                    <DishCard key={dish.id} item={dish} onClick={handleItemClick} />
                  ))}
                </div>
              </div>
            )}

            {/* Sets */}
            {filteredSets.length > 0 && (
              <div className="mb-3">
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                  {filteredSets.map((s) => (
                    <SimpleCard
                      key={s.id}
                      item={s}
                      onClick={handleItemClick}
                      badge="SET"
                      badgeColor="bg-orange-600"
                    />
                  ))}
                </div>
              </div>
            )}

            {filteredDishes.length === 0 && filteredSets.length === 0 && (
              <div className="text-center text-gray-400 text-sm mt-12">
                {searchQuery ? t('noResults') : t('noMenuItems')}
              </div>
            )}
          </div>

          {/* Toppings */}
          {toppings.length > 0 && (
            <div className="shrink-0 border-t border-gray-200 bg-white px-3 py-2">
              <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5">
                {t('type_topping')}
              </h3>
              <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-1.5">
                {toppings.map((tp) => (
                  <SimpleCard
                    key={tp.id}
                    item={tp}
                    onClick={handleItemClick}
                    compact
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* -------- COLUMN 3: DRINKS + SAUCES -------- */}
        <div className="w-40 lg:w-48 xl:w-56 shrink-0 bg-white border-l border-gray-200 flex flex-col min-h-0">
          {/* Drinks */}
          <div className="flex-1 min-h-0 flex flex-col border-b border-gray-200">
            <div className="px-3 py-2 border-b border-gray-100 shrink-0">
              <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                {t('type_drink')}
              </h3>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              {drinks.length === 0 ? (
                <p className="text-[10px] text-gray-400 text-center py-3">—</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {drinks.map((d) => (
                    <SimpleCard
                      key={d.id}
                      item={d}
                      onClick={handleItemClick}
                      compact
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sauces */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-3 py-2 border-b border-gray-100 shrink-0">
              <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                {t('type_sauce')}
              </h3>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              {sauces.length === 0 ? (
                <p className="text-[10px] text-gray-400 text-center py-3">—</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {sauces.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleItemClick(s)}
                      className="flex flex-col items-center gap-1 p-1.5 rounded-xl border-2 border-gray-200 hover:border-orange-400 bg-white active:scale-95 transition-all"
                    >
                      <div
                        className="w-8 h-8 rounded-full border-2 border-white shadow"
                        style={{ backgroundColor: s.color ?? '#e5e7eb' }}
                      />
                      <span className="text-[10px] font-bold text-gray-700 truncate w-full text-center">
                        {s.short_name || s.name}
                      </span>
                      <span className="text-[10px] font-black text-orange-600">
                        {s.free ? t('free') : formatYen(s.price)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* -------- COLUMN 4: CART -------- */}
        <div className="w-72 lg:w-80 xl:w-96 shrink-0 bg-white border-l border-gray-200 flex flex-col min-h-0">
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
                        removed ? 'text-gray-400 line-through' : 'text-orange-600'
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

      {/* ============ DIALOGS ============ */}
      <ProductBuilderDialog
        open={builderItem !== null}
        item={builderItem}
        allItems={menuItems}
        onConfirm={({ variant, price, options }) => {
          if (builderItem)
            addToCartFromBuilder(builderItem, variant, price, options);
          setBuilderItem(null);
        }}
        onCancel={() => setBuilderItem(null)}
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
// CARD COMPONENTS
// ============================================================
function DishCard({
  item,
  onClick,
}: {
  item: MenuItem;
  onClick: (i: MenuItem) => void;
}) {
  const isGroup = item.dish_kind === 'group' && (item.variants?.length ?? 0) > 0;

  if (isGroup) {
    return (
      <div className="rounded-xl border-2 border-gray-200 bg-white p-2 shadow-sm">
        <div className="flex items-center justify-between mb-1.5 px-0.5">
          <span className="text-xs font-black text-gray-900 truncate">
            {item.name}
          </span>
          <span className="text-[9px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full shrink-0 ml-1">
            {item.variants!.length}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {item.variants!.map((v) => (
            <button
              key={v.id}
              onClick={() => onClick(v)}
              className="relative aspect-square rounded-lg overflow-hidden bg-gradient-to-br from-orange-500 to-red-500 border border-white active:scale-95 transition-transform"
            >
              {(v.image_url || item.image_url) && (
                <>
                  <img
                    src={v.image_url || item.image_url || ''}
                    alt={v.name}
                    className="absolute inset-0 w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/40" />
                </>
              )}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center px-0.5">
                <div className="text-[9px] font-black leading-tight drop-shadow">
                  {v.name}
                </div>
                <div className="text-[9px] font-black text-yellow-300 mt-0.5 drop-shadow">
                  {v.free ? '0' : formatYen(v.price)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return <SimpleCard item={item} onClick={onClick} />;
}

function SimpleCard({
  item,
  onClick,
  badge,
  badgeColor,
  compact,
}: {
  item: MenuItem;
  onClick: (i: MenuItem) => void;
  badge?: string;
  badgeColor?: string;
  compact?: boolean;
}) {
  const hasBuilder =
    item.type === 'set' ||
    (item.dish_kind === 'group' && (item.variants?.length ?? 0) > 0) ||
    (item.properties?.length ?? 0) > 0 ||
    (item.sauce_mode === 'with' && (item.allowed_sauces?.length ?? 0) > 0);

  return (
    <button
      onClick={() => onClick(item)}
      className="group relative aspect-square rounded-xl overflow-hidden bg-gradient-to-br from-orange-500 to-red-500 border-2 border-gray-200 active:border-orange-400 active:scale-95 transition-all"
    >
      {item.image_url && (
        <>
          <img
            src={item.image_url}
            alt={item.name}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/40" />
        </>
      )}
      {badge && (
        <div
          className={`absolute top-1 left-1 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full ${
            badgeColor ?? 'bg-orange-600'
          }`}
        >
          {badge}
        </div>
      )}
      {hasBuilder && (
        <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-purple-600 text-white text-[10px] font-black flex items-center justify-center shadow">
          ⋯
        </div>
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1">
        <div
          className={`${
            compact ? 'text-[10px]' : 'text-xs'
          } font-black text-white leading-tight drop-shadow line-clamp-2`}
        >
          {item.short_name || item.name}
        </div>
        <div
          className={`${
            compact ? 'text-[10px]' : 'text-xs'
          } font-black mt-1 text-yellow-300 drop-shadow`}
        >
          {item.free ? '0' : formatYen(item.price)}
        </div>
      </div>
    </button>
  );
}