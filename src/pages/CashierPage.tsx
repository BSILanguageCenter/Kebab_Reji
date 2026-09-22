import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchCategories, fetchMenuItems } from '@/services/menu';
import { createOrder, fetchActiveOrders, deleteOrder } from '@/services/orders';
import { printCustomerTicket } from '@/services/printer';
import { formatYen, formatTimeAgo } from '@/locale/format';
import { useI18n } from '@/locale';
import type {
  MenuCategory,
  MenuItem,
  CartItem,
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
} from 'lucide-react';

const QUICK_ACCESS_REGEX =
  /sauce|topping|extra|drink|напит|соус|топпинг|добавк|ichim|qo'shim/i;

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
  const cartIdCounter = useRef(0);

  const loadData = useCallback(async () => {
    try {
      const [cats, items] = await Promise.all([
        fetchCategories(),
        fetchMenuItems(),
      ]);
      setCategories(cats);
      setMenuItems(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToLoadMenu'));
    }
  }, [t]);

  const loadOrders = useCallback(async () => {
    try {
      const orders = await fetchActiveOrders();
      setActiveOrders(orders);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    loadData();
    loadOrders();

    const sub = supabase
      .channel('cashier-orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => {
          loadOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, [loadData, loadOrders]);

  const quickAccessCategories = categories.filter((c) =>
    QUICK_ACCESS_REGEX.test(`${c.name} ${c.short_name}`)
  );
  const quickAccessIds = new Set(quickAccessCategories.map((c) => c.id));
  const mainCategories = categories.filter((c) => !quickAccessIds.has(c.id));

  const filteredItems = menuItems.filter((item) => {
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
  });

  const groupedItems = mainCategories
    .map((cat) => ({
      category: cat,
      items: filteredItems.filter((i) => i.category_id === cat.id),
    }))
    .filter((g) => g.items.length > 0);

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find(
        (c) => c.menu_item_id === item.id && c.options.length === 0
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
        },
      ];
    });
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
    setCart((prev) => prev.filter((c) => c.id !== cartId));
  };

  const cartTotal = cart.reduce(
    (sum, item) =>
      sum +
      item.price * item.quantity +
      item.options.reduce((s, o) => s + o.price * o.quantity, 0),
    0
  );

  const handleSendToKitchen = async () => {
    if (cart.length === 0) return;
    setSending(true);
    setError(null);
    setPrintError(null);
    try {
      const order = await createOrder(orderType, cart, comment);
      setLastOrderNumber(order.order_number);

      const ticketOrder: Order = {
        ...order,
        order_items: cart.map((c) => ({
          id: 'temp',
          order_id: order.id,
          menu_item_id: c.menu_item_id,
          name: c.name,
          short_name: c.short_name,
          variant: c.variant,
          price: c.price,
          quantity: c.quantity,
          subtotal: c.price * c.quantity,
          created_at: new Date().toISOString(),
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

      const printResult = await printCustomerTicket(ticketOrder);
      if (!printResult.success) {
        setPrintError(printResult.error ?? t('printerError'));
      }

      setCart([]);
      setComment('');
      loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToSendOrder'));
    } finally {
      setSending(false);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      await deleteOrder(orderId);
      loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToDeleteOrder'));
    }
  };

  return (
    <div className="flex h-full min-h-0">
      {/* ============ LEFT: Активные заказы ============ */}
      <div className="w-40 lg:w-48 shrink-0 bg-white border-r border-gray-200 flex flex-col min-h-0">
        <div className="px-2.5 py-2 border-b border-gray-200 shrink-0">
          <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
            {t('activeOrders')}
          </h2>
          <span className="text-xl font-bold text-orange-600">
            {activeOrders.length}
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
          {activeOrders.length === 0 && (
            <p className="text-gray-400 text-[10px] text-center mt-4">
              {t('noActiveOrders')}
            </p>
          )}
          {activeOrders.map((order) => (
            <button
              key={order.id}
              onClick={() => handleDeleteOrder(order.id)}
              className={`w-full text-left p-2 rounded-lg border transition-all ${
                order.status === 'READY'
                  ? 'bg-green-50 border-green-400'
                  : order.status === 'PREPARING'
                  ? 'bg-yellow-50 border-yellow-400'
                  : 'bg-gray-50 border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-base font-bold text-gray-900">
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
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[10px] text-gray-500">
                  {formatTimeAgo(order.created_at, lang)}
                </span>
                <span className="text-[10px] font-semibold text-gray-700">
                  {formatYen(order.total_amount)}
                </span>
              </div>
              {order.status === 'READY' && (
                <div className="mt-0.5 text-[10px] text-green-600 font-bold">
                  {t('statusReady')}
                </div>
              )}
              {order.status === 'PREPARING' && (
                <div className="mt-0.5 text-[10px] text-yellow-600 font-bold">
                  {t('statusCooking')}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ============ CENTER: Меню + Quick Access ============ */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-slate-50">
        {/* Top bar: type toggle + search */}
        <div className="flex items-center gap-2 px-2 py-2 bg-white border-b border-gray-200 shrink-0">
          <div className="flex rounded-lg overflow-hidden border border-gray-300 shadow-sm">
            <button
              onClick={() => setOrderType('OUTSIDE')}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold transition-all ${
                orderType === 'OUTSIDE'
                  ? 'bg-purple-600 text-white'
                  : 'bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              {t('orderTypeOutside')}
            </button>
            <button
              onClick={() => setOrderType('INSIDE')}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold transition-all ${
                orderType === 'INSIDE'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              {t('orderTypeInside')}
            </button>
          </div>

          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('searchMenu')}
              className="w-full bg-white border border-gray-300 rounded-lg pl-8 pr-8 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2"
              >
                <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-700" />
              </button>
            )}
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 px-2 py-1.5 overflow-x-auto bg-white border-b border-gray-200 shrink-0">
          <button
            onClick={() => setActiveCategory(null)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap transition-all ${
              activeCategory === null
                ? 'bg-orange-500 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:text-gray-900 hover:bg-gray-200'
            }`}
          >
            {t('all')}
          </button>
          {mainCategories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap transition-all ${
                activeCategory === cat.id
                  ? 'bg-orange-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:text-gray-900 hover:bg-gray-200'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* === Row: [menu] + [quick access] === */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* MENU — сетка категорий, 3 квадрата с крупным текстом */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {error && (
              <div className="mb-2 p-2 bg-red-50 border border-red-300 rounded-lg text-red-700 text-xs">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {groupedItems.map(({ category, items }) => {
                // Одно фото на категорию — берём первое найденное
                const categoryImage =
                  items.find((i) => i.image_url)?.image_url ?? null;

                return (
                  <div
                    key={category.id}
                    className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm"
                  >
                    {/* Фото категории + название */}
                    <div className="relative h-16 bg-gradient-to-br from-orange-100 via-orange-50 to-amber-50 flex items-center justify-center overflow-hidden">
                      {categoryImage ? (
                        <img
                          src={categoryImage}
                          alt={category.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-2xl font-black text-orange-300 tracking-tight">
                          {category.short_name ||
                            category.name.slice(0, 3).toUpperCase()}
                        </span>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 flex items-center justify-between gap-1">
                        <h3 className="text-[11px] font-bold text-white uppercase tracking-wider truncate drop-shadow">
                          {category.name}
                        </h3>
                        <span className="text-[9px] font-bold text-white bg-black/40 px-1.5 py-0.5 rounded-full shrink-0">
                          {items.length}
                        </span>
                      </div>
                    </div>

                    {/* 3 квадрата — крупный текст по центру */}
                    <div className="p-1.5">
                      <div className="grid grid-cols-3 gap-1.5">
                        {items.map((item) => {
                          // Логика «одно фото на категорию»
                          const displayImage = item.image_url || categoryImage;

                          return (
                            <button
                              key={item.id}
                              onClick={() => addToCart(item)}
                              className="group relative aspect-square rounded-lg overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 border border-gray-200 hover:border-orange-400 hover:shadow-md transition-all active:scale-95"
                            >
                              {displayImage ? (
                                <>
                                  <img
                                    src={displayImage}
                                    alt={item.variant || item.name}
                                    className="absolute inset-0 w-full h-full object-cover"
                                  />
                                  <div className="absolute inset-0 bg-black/45 group-hover:bg-black/35 transition-colors" />
                                </>
                              ) : (
                                <div className="absolute inset-0 bg-gradient-to-br from-orange-500 to-red-500" />
                              )}

                              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1">
                                <div className="text-[13px] sm:text-sm font-black text-white leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                                  {item.variant || item.name}
                                </div>
                                {item.price > 0 && (
                                  <div className="text-[13px] sm:text-sm font-black leading-tight mt-0.5 text-yellow-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
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

          {/* QUICK ACCESS — 2 колонки, компактный */}
          <div className="w-40 lg:w-48 shrink-0 bg-white border-l border-gray-200 flex flex-col min-h-0">
            <div className="px-2 py-1.5 border-b border-gray-200 shrink-0 flex items-center gap-1">
              <Zap className="w-3 h-3 text-orange-500 shrink-0" />
              <h2 className="text-[9px] font-bold text-gray-500 uppercase tracking-wider truncate">
                {t('quickAccess')}
              </h2>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-2">
              {quickAccessCategories.length === 0 && (
                <p className="text-gray-400 text-[9px] text-center mt-3 px-1 leading-relaxed">
                  {t('quickAccess')}
                </p>
              )}

              {quickAccessCategories.map((cat) => {
                const items = menuItems.filter(
                  (i) => i.category_id === cat.id && i.active
                );
                if (items.length === 0) return null;

                const categoryImage =
                  items.find((i) => i.image_url)?.image_url ?? null;

                return (
                  <div key={cat.id}>
                    <h3 className="text-[8px] font-bold text-gray-400 uppercase tracking-wider mb-1 px-0.5">
                      {cat.name}
                    </h3>
                    <div className="grid grid-cols-2 gap-1">
                      {items.map((item) => {
                        const displayImage = item.image_url || categoryImage;

                        return (
                          <button
                            key={item.id}
                            onClick={() => addToCart(item)}
                            className="group relative aspect-square rounded-md overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 border border-gray-200 hover:border-orange-400 hover:shadow-md transition-all active:scale-95"
                          >
                            {displayImage ? (
                              <>
                                <img
                                  src={displayImage}
                                  alt={item.variant || item.name}
                                  className="absolute inset-0 w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/45 group-hover:bg-black/35 transition-colors" />
                              </>
                            ) : (
                              <div className="absolute inset-0 bg-gradient-to-br from-orange-500 to-red-500" />
                            )}

                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1">
                              <div className="text-[10px] font-black text-white leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] line-clamp-2">
                                {item.variant || item.name}
                              </div>
                              {item.price > 0 && (
                                <div className="text-[10px] font-black leading-tight mt-0.5 text-yellow-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
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
      <div className="w-64 lg:w-72 shrink-0 bg-white border-l border-gray-200 flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-gray-200 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">
              {t('currentOrder')}
            </h2>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                orderType === 'INSIDE'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-purple-100 text-purple-700'
              }`}
            >
              {orderType === 'INSIDE' ? t('inside') : t('outside')}
            </span>
          </div>
          {lastOrderNumber && (
            <p className="text-[10px] text-green-600 mt-0.5">
              {t('lastOrder')}: #{lastOrderNumber}
            </p>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5 bg-slate-50">
          {cart.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <ShoppingBag className="w-10 h-10 mb-1.5 opacity-40" />
              <p className="text-xs">{t('tapItemsToAdd')}</p>
            </div>
          )}
          {cart.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-lg p-2 border border-gray-200 shadow-sm"
            >
              <div className="flex items-start justify-between mb-1.5">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-gray-900 truncate">
                    {item.short_name} {item.variant}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {item.price > 0
                      ? `${formatYen(item.price)} ${t('each')}`
                      : t('free')}
                  </div>
                </div>
                <button
                  onClick={() => removeItem(item.id)}
                  className="text-gray-400 hover:text-red-500 p-0.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => decrementItem(item.id)}
                    className="w-7 h-7 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors text-gray-700"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-sm font-bold w-6 text-center text-gray-900">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => incrementItem(item.id)}
                    className="w-7 h-7 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors text-gray-700"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <span className="text-xs font-bold text-orange-600">
                  {formatYen(item.price * item.quantity)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="p-2 border-t border-gray-200 bg-white shrink-0">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('addComment')}
            className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
          />
        </div>

        <div className="p-2 border-t border-gray-200 space-y-2 bg-white shrink-0">
          {printError && (
            <div className="p-1.5 bg-red-50 border border-red-300 rounded-md text-red-700 text-[10px] flex items-center justify-between">
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
            <span className="text-xl font-bold text-orange-600">
              {formatYen(cartTotal)}
            </span>
          </div>
          <button
            onClick={handleSendToKitchen}
            disabled={cart.length === 0 || sending}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-bold text-sm flex items-center justify-center gap-1.5 transition-all hover:shadow-lg hover:shadow-orange-500/30 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
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
          {cart.length > 0 && (
            <button
              onClick={() => setCart([])}
              className="w-full py-1 text-[11px] text-gray-500 hover:text-red-500 font-medium"
            >
              {t('clearAll')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}