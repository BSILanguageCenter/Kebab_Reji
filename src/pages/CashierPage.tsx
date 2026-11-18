import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
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
} from '@/lib/localStore';
import { ClearCartDialog } from '@/components/ClearCartDialog';
import { ProductBuilderDialog } from '@/components/ProductBuilderDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageActions } from '@/components/PageActions';
import { Resizer } from '@/components/Resizer';
import { MenuCard } from '@/components/MenuCard';
import { useViewport } from '@/lib/useViewport';
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
  RotateCcw,
  Undo2,
  FilePlus2,
  Pencil,
  Save,
  ShoppingCart,
  ClipboardList,
  UtensilsCrossed,
  X,
} from 'lucide-react';

type CategorySpace = 'dishset' | 'drink' | 'sauce' | 'topping';

type MobileTab = 'menu' | 'cart' | 'orders';

/** Отступ между карточками в адаптивной (телефон / планшет) сетке */
const FLUID_GAP = 6;

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

function getSpaceItems(items: MenuItem[], space: CategorySpace): MenuItem[] {
  if (space === 'dishset') {
    return items.filter((i) => i.type === 'dish' || i.type === 'set');
  }
  return items.filter((i) => i.type === space);
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

function statusLabel(status: Order['status']): string {
  switch (status) {
    case 'READY':
      return '✓ Готов';
    case 'PREPARING':
      return 'Готовится';
    case 'CANCELLED':
      return 'Отменён';
    default:
      return 'Новый';
  }
}

function typeEmoji(t: OrderType): string {
  if (t === 'INSIDE') return '🍽️';
  if (t === 'ON_THE_WAY') return '🚶';
  return '🥡';
}

export default function CashierPage() {
  const { t, lang } = useI18n();

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('OUTSIDE');
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastOrderNumber, setLastOrderNumber] = useState<number | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Модалка выбора способа получения (после "Отправить на кухню")
  const [showTypePicker, setShowTypePicker] = useState(false);

  const [builder, setBuilder] = useState<{
    item: MenuItem;
    variantId?: string;
  } | null>(null);

  const [pendingUndo, setPendingUndo] = useState<UndoRecord | null>(null);
  const cartIdCounter = useRef(0);

  const undoStack = useUndoStack('cashier');
  const [rawLayout, setLayout] = useLayoutSettings();
  const drinksWrapRef = useRef<HTMLDivElement>(null);

  // ---------- адаптивность ----------
  const { width: vw, device, scale: ui } = useViewport();
  const isDesktop = device === 'desktop';
  const isPhone = device === 'phone';

  // Все «пиксельные» настройки (ширины колонок, размеры карточек, шрифты)
  // умножаем на масштаб экрана: на большом мониторе всё крупнее, на малом мельче.
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
  const [mobileTab, setMobileTab] = useState<MobileTab>('menu');
  const [menuCat, setMenuCat] = useState<CategorySpace>('dishset');
  const [ordersOpen, setOrdersOpen] = useState(false);

  // ---------- единые функции для типа заказа ----------
  const typeLabelFor = (tp: OrderType): string => {
    if (tp === 'INSIDE') return t('inside');
    if (tp === 'ON_THE_WAY') return t('orderTypeOnTheWay');
    return t('outside');
  };

  const typeBadgeCls = (tp: OrderType): string => {
    if (tp === 'INSIDE') return 'bg-blue-100 text-blue-700';
    if (tp === 'ON_THE_WAY') return 'bg-amber-100 text-amber-700';
    return 'bg-purple-100 text-purple-700';
  };

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

  const confirmIfCartNotEmpty = useCallback(
    (action: () => void) => {
      if (cart.length > 0) setPendingAction(() => action);
      else action();
    },
    [cart.length]
  );

  const addToCart = useCallback(
    (item: MenuItem) => {
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
            original_quantity: undefined,
          },
        ];
      });
    },
    [editingOrder]
  );

  const addToCartFromBuilder = useCallback(
    (
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
          original_quantity: undefined,
        },
      ]);
    },
    [editingOrder]
  );

  // ✅ ФИКС: карточка группы (dish-group / set с групповым main) ВСЕГДА
  // открывает окно выбора, чтобы пользователь сначала выбрал вариант.
  const handleItemClick = useCallback(
    (item: MenuItem) => {
      // Топпинги, напитки, соусы — всегда сразу в корзину
      if (
        item.type === 'topping' ||
        item.type === 'drink' ||
        item.type === 'sauce'
      ) {
        addToCart(item);
        return;
      }

      // Блюдо-группа или сет с групповым main — всегда через окно,
      // чтобы пользователь сначала выбрал вариант, потом свойства/соусы.
      const hasGroupVariants =
        (item.type === 'dish' &&
          item.dish_kind === 'group' &&
          (item.variants?.length ?? 0) > 0) ||
        (item.type === 'set' &&
          item.set_main?.dish_kind === 'group' &&
          (item.set_main.variants?.length ?? 0) > 0);

      if (hasGroupVariants) {
        setBuilder({ item });
        return;
      }

      // Одиночное блюдо: если нечего выбирать — сразу в корзину
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
    },
    [addToCart]
  );

  // ✅ ФИКС: единый обработчик клика по КОНКРЕТНОМУ варианту карточки
  // (блюдо-группа ИЛИ сет). Открываем builder для РОДИТЕЛЯ с предвыбранным
  // вариантом. Если у варианта нечего выбирать — сразу в корзину.
  const handleVariantClick = useCallback(
    (parent: MenuItem, variant: MenuItem) => {
      const vHasProps = (variant.properties?.length ?? 0) > 0;
      const vHasSauces =
        variant.sauce_mode === 'with' &&
        (variant.allowed_sauces?.length ?? 0) > 0;

      const setHasExtras =
        parent.type === 'set' &&
        (parent.set_extra_groups?.some((g) => g.options.length > 0) ??
          false);

      if (!vHasProps && !vHasSauces && !setHasExtras) {
        // Нечего выбирать — сразу в корзину с меткой варианта
        addToCartFromBuilder(
          parent,
          variant.short_name || variant.name,
          variant.price,
          [
            {
              type: 'variant',
              name: variant.name,
              price: 0,
              quantity: 1,
            },
          ]
        );
        return;
      }

      setBuilder({ item: parent, variantId: variant.id });
    },
    [addToCartFromBuilder]
  );

  const incrementItem = (cartId: string) => {
    try {
      if ('vibrate' in navigator) navigator.vibrate(8);
    } catch {
      /* ignore */
    }
    setCart((prev) =>
      prev.map((c) =>
        c.id === cartId
          ? { ...c, quantity: c.quantity + 1, is_removed: false }
          : c
      )
    );
  };

  const decrementItem = (cartId: string) => {
    try {
      if ('vibrate' in navigator) navigator.vibrate(8);
    } catch {
      /* ignore */
    }
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.id !== cartId) return c;
          if (c.quantity <= 1) {
            if (editingOrder && c.db_id) {
              return { ...c, is_removed: true, quantity: 1 };
            }
            return { ...c, quantity: 0 };
          }
          return { ...c, quantity: c.quantity - 1 };
        })
        .filter((c) => c.quantity > 0 || c.is_removed)
    );
  };

  const removeItem = (cartId: string) => {
    setCart((prev) => {
      const item = prev.find((c) => c.id === cartId);
      if (!item) return prev;
      if (editingOrder && !item.is_added_later && item.db_id) {
        return prev.map((c) =>
          c.id === cartId
            ? { ...c, is_removed: !c.is_removed, quantity: 1 }
            : c
        );
      }
      return prev.filter((c) => c.id !== cartId);
    });
  };

  // Клик по "Отправить на кухню" — сначала выбор способа получения
  const handleSendToKitchen = () => {
    if (!hasActiveItems || sending) return;
    setShowTypePicker(true);
  };

  // Собственно отправка заказа с выбранным типом
  const performCreateOrder = async (type: OrderType) => {
    setShowTypePicker(false);
    if (!hasActiveItems || sending) return;
    setSending(true);
    setError(null);
    try {
      const created = await emitCreateOrder({
        order_type: type,
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

      try {
        if ('vibrate' in navigator) navigator.vibrate(30);
      } catch {
        /* ignore */
      }

      setCart([]);
      setComment('');
      setEditingOrder(null);
      setMobileTab('menu');
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

    const undoSnapshot = {
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
    };

    try {
      pushUndo('cashier', {
        kind: 'edit',
        orderId: editingOrder.id,
        orderNumber: editingOrder.order_number,
        snapshot: undoSnapshot,
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

      try {
        if ('vibrate' in navigator) navigator.vibrate(30);
      } catch {
        /* ignore */
      }

      setCart([]);
      setComment('');
      setEditingOrder(null);
      setMobileTab('menu');
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
        original_quantity: item.quantity,
      };
    });
    setCart(restored);
    setOrderType(order.order_type);
    setComment(order.comment ?? '');
    setEditingOrder(order);
    setMobileTab('cart');
    setOrdersOpen(false);
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
      setMobileTab('menu');
      setOrdersOpen(false);
    });
  };

  const handleCancelEdit = () => {
    setCart([]);
    setComment('');
    setEditingOrder(null);
    setMobileTab('menu');
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

  const renderGrid = (
    space: CategorySpace,
    size: number,
    compact: boolean,
    fluidCols?: number
  ) => {
    const fluid = fluidCols != null;
    const spaceItems = getSpaceItems(tops, space);
    const sorted = [...spaceItems].sort(
      (a, b) => a.sort_order - b.sort_order
    );
    const cellH = Math.round(
      size + (compact ? 32 : 50) * (layout.itemTextSize / 12)
    );

    return (
      <div
        className="grid"
        style={{
          gridTemplateColumns: fluid
            ? `repeat(${fluidCols}, minmax(0, 1fr))`
            : `repeat(auto-fill, ${size}px)`,
          gridAutoRows: fluid ? 'auto' : `${cellH}px`,
          gap: fluid ? FLUID_GAP * ui : layout.gridGap,
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
                gridColumn: fluid
                  ? variants
                    ? '1 / -1'
                    : 'span 1'
                  : `span ${w}`,
                display: 'flex',
                alignItems: fluid ? 'flex-start' : 'center',
                justifyContent: 'center',
              }}
            >
              <MenuCard
                mode="view"
                item={card}
                variants={variants}
                onClick={handleItemClick}
                // ✅ ФИКС: единый обработчик для блюд-групп и сетов.
                // Клик по конкретному варианту → окно builder'а родителя
                // с предвыбранным вариантом (или сразу в корзину, если
                // у варианта нет свойств/соусов и у сета нет групп).
                onVariantClick={handleVariantClick}
                size={size}
                textSize={
                  fluid
                    ? layout.itemTextSize
                    : layout.itemTextSize
                }
                compact={fluid ? false : compact}
                wrapVariants={fluid}
                cardRadius={layout.cardRadius}
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

  // ---------- адаптивные размеры ----------
  const hdrSize = isDesktop
    ? layout.panelHeaderSize
    : Math.max(layout.panelHeaderSize, Math.round(14 * ui));
  const numSize = isDesktop
    ? layout.orderNumberSize
    : Math.max(layout.orderNumberSize, Math.round(24 * ui));

  const cartQty = cart
    .filter((i) => !i.is_removed)
    .reduce((s, i) => s + i.quantity, 0);
  const ordersCount = activeOrders.filter(
    (o) => o.status !== 'CANCELLED'
  ).length;

  const tabletCartW = Math.round(
    Math.min(400 * ui, Math.max(300 * ui, vw * 0.34))
  );
  const padX = 24 * ui;
  const menuAvail =
    (isPhone ? vw - padX : vw - tabletCartW - padX - 1) - 8 * ui;
  const fluidGrid = (space: CategorySpace) => {
    const fg = FLUID_GAP * ui;
    const target =
      (space === 'dishset' ? (isPhone ? 118 : 135) : isPhone ? 100 : 108) * ui;
    const cols = Math.max(
      2,
      Math.floor((menuAvail + fg) / (target + fg))
    );
    const size = Math.floor((menuAvail - fg * (cols - 1)) / cols);
    return { cols, size };
  };

  const catList = [
    { key: 'dishset' as const, label: t('bludiAndSet'), has: hasDishSet },
    { key: 'drink' as const, label: t('type_drink'), has: hasDrink },
    { key: 'sauce' as const, label: t('type_sauce'), has: hasSauce },
    { key: 'topping' as const, label: t('type_topping'), has: hasTopping },
  ].filter((c) => c.has);
  const activeCat = catList.find((c) => c.key === menuCat) ?? catList[0];

  // ---------- общие куски интерфейса ----------
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
          {activeOrders.filter((o) => o.status !== 'CANCELLED').length}
        </span>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col"
        style={{ rowGap: layout.ordersRowGap }}
      >
        {activeOrders.length === 0 && (
          <p className="text-slate-400 text-sm text-center mt-8">
            {t('noActiveOrders')}
          </p>
        )}
        {activeOrders.map((order) => {
          const isCancelled = order.status === 'CANCELLED';
          const isEditing = editingOrder?.id === order.id;
          const badgeCls = typeBadgeCls(order.order_type);
          const badgeLabel = typeLabelFor(order.order_type);
          const cls = isCancelled
            ? 'bg-red-50 border-l-red-400 opacity-60'
            : isEditing
            ? 'bg-orange-100 border-l-orange-500 ring-2 ring-orange-300 shadow-md'
            : order.status === 'READY'
            ? 'bg-green-50 border-l-green-500 shadow-sm'
            : order.status === 'PREPARING'
            ? 'bg-amber-50 border-l-amber-400 shadow-sm'
            : 'bg-white border-l-slate-300 shadow-sm';
          return (
            <button
              key={order.id}
              onClick={() => handleEditOrder(order)}
              disabled={isCancelled}
              className={`w-full text-left p-3.5 rounded-xl border border-slate-200 border-l-[6px] transition-all ${cls} ${
                isCancelled
                  ? 'cursor-not-allowed'
                  : 'cursor-pointer hover:shadow-md active:scale-[0.97]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="font-black text-slate-900 tabular-nums"
                  style={{ fontSize: numSize }}
                >
                  #{order.order_number}
                </span>
                <span
                  className={`text-[0.6875rem] px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${badgeCls}`}
                >
                  {typeEmoji(order.order_type)} {badgeLabel}
                </span>
              </div>
              <div className="mt-1 text-[0.6875rem] font-bold text-slate-500">
                {statusLabel(order.status)}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[0.6875rem] text-slate-500">
                  {formatTimeAgo(order.created_at, lang)}
                </span>
                <span className="text-sm font-black text-slate-700 tabular-nums">
                  {formatYen(order.total_amount)}
                </span>
              </div>
              {isEditing && (
                <div className="mt-1.5 text-[0.6875rem] text-orange-700 font-bold flex items-center gap-1">
                  <Pencil className="w-3 h-3" />
                  {t('editingOrder')}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="p-2 border-t border-slate-200 shrink-0">
        <button
          onClick={handleNewOrder}
          className="w-full flex items-center justify-center gap-2 px-3 py-4 rounded-xl bg-orange-500 hover:bg-orange-600 active:scale-[0.97] text-white text-sm font-black shadow-lg shadow-orange-500/30 transition-all"
        >
          <FilePlus2 className="w-5 h-5" />
          {t('newOrder')}
        </button>
      </div>
    </>
  );

  const cartInner = (
    <>
      <div
        className={`px-4 py-3 border-b shrink-0 ${
          editingOrder
            ? 'bg-orange-50 border-orange-300'
            : 'border-slate-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-black text-slate-900 truncate">
            {editingOrder
              ? `${t('editingOrder')} #${editingOrder.order_number}`
              : t('currentOrder')}
          </h2>
          <span
            className={`text-[0.6875rem] px-2.5 py-1 rounded-full font-bold shrink-0 ml-2 ${typeBadgeCls(
              orderType
            )}`}
          >
            {typeEmoji(orderType)} {typeLabelFor(orderType)}
          </span>
        </div>
        {editingOrder && (
          <button
            onClick={handleCancelEdit}
            className="mt-2 flex items-center gap-1 text-xs text-orange-700 font-bold px-2 py-1 rounded-lg hover:bg-orange-100"
          >
            <RotateCcw className="w-3 h-3" />
            {t('cancelEdit')}
          </button>
        )}
        {!editingOrder && lastOrderNumber && (
          <p className="text-[0.6875rem] text-green-600 mt-0.5 font-bold">
            {t('lastOrder')}: #{lastOrderNumber}
          </p>
        )}
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto p-2 bg-slate-50 flex flex-col"
        style={{ rowGap: layout.cartItemGap }}
      >
        {cart.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <ShoppingBag className="w-14 h-14 mb-2 opacity-30" />
            <p className="text-sm">{t('tapItemsToAdd')}</p>
          </div>
        )}
        {cart.map((item) => {
          const removed = item.is_removed ?? false;
          const isNew = item.is_added_later ?? false;
          const qtyChanged =
            editingOrder &&
            item.db_id &&
            item.original_quantity != null &&
            item.quantity !== item.original_quantity &&
            !removed;

          const cardClass = removed
            ? 'bg-red-50 border-red-300 opacity-70'
            : isNew || qtyChanged
            ? 'bg-orange-50 border-orange-400 ring-1 ring-orange-300'
            : 'bg-white border-slate-200';
          const lineTotal =
            item.price * item.quantity +
            item.options.reduce((s, o) => s + o.price * o.quantity, 0) *
              item.quantity;

          return (
            <div
              key={item.id}
              className={`rounded-2xl p-3 border-2 shadow-sm ${cardClass}`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div
                  className={`flex-1 min-w-0 ${
                    removed ? 'line-through' : ''
                  }`}
                >
                  <div className="text-sm font-bold text-slate-900 truncate">
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
                  className={`w-11 h-11 flex items-center justify-center rounded-xl transition-colors ${
                    removed
                      ? 'text-green-600 hover:bg-green-50'
                      : 'text-slate-400 hover:text-red-600 hover:bg-red-50 active:scale-90'
                  }`}
                >
                  {removed ? (
                    <RotateCcw className="w-5 h-5" />
                  ) : (
                    <Trash2 className="w-5 h-5" />
                  )}
                </button>
              </div>

              {item.options.length > 0 && !removed && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {item.options.map((opt, i) => (
                    <span
                      key={i}
                      className="px-2 py-1 rounded-md bg-orange-100 text-orange-800 text-[0.6875rem] font-bold"
                    >
                      + {opt.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => decrementItem(item.id)}
                    disabled={removed}
                    className="w-12 h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 active:scale-90 flex items-center justify-center transition-all disabled:opacity-40"
                  >
                    <Minus className="w-5 h-5" />
                  </button>
                  <span className="text-xl font-black w-10 text-center tabular-nums">
                    {removed ? 0 : item.quantity}
                  </span>
                  <button
                    onClick={() => incrementItem(item.id)}
                    disabled={removed}
                    className="w-12 h-12 rounded-2xl bg-orange-100 hover:bg-orange-200 active:scale-90 flex items-center justify-center text-orange-700 transition-all disabled:opacity-40"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
                <span
                  className={`text-base font-black tabular-nums ${
                    removed
                      ? 'text-slate-400 line-through'
                      : 'text-slate-900'
                  }`}
                >
                  {removed ? formatYen(0) : formatYen(lineTotal)}
                </span>
              </div>

              {qtyChanged && (
                <div className="mt-2 text-[0.6875rem] text-orange-700 font-bold">
                  {t('qtyChangedFromTo')
                    .replace(
                      '{from}',
                      String(item.original_quantity ?? 0)
                    )
                    .replace('{to}', String(item.quantity))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-2 border-t border-slate-200 bg-white shrink-0">
        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t('addComment')}
          className="form-input text-sm !py-3"
        />
      </div>

      <div className="p-3 border-t border-slate-200 space-y-3 bg-white shrink-0 shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.2)]">
        <div className="flex items-end justify-between">
          <span className="text-sm font-bold text-slate-500">
            {t('total')}
          </span>
          <span className="text-3xl font-black text-slate-900 tabular-nums leading-none">
            {formatYen(cartTotal)}
          </span>
        </div>

        {editingOrder ? (
          <button
            onClick={handleSaveChanges}
            disabled={!hasActiveItems || sending}
            className="w-full h-16 rounded-2xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-black text-base flex items-center justify-center gap-2 shadow-lg shadow-orange-500/30 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none transition-all"
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
            className="w-full h-16 rounded-2xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-black text-base flex items-center justify-center gap-2 shadow-lg shadow-orange-500/30 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none transition-all"
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
            className="w-full py-2.5 text-xs text-slate-500 hover:text-red-600 font-bold"
          >
            {t('clearAll')}
          </button>
        )}
      </div>
    </>
  );

  const errorBox = (
    <>
      {error && (
        <div className="mx-2 mt-2 p-3 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}
    </>
  );

  const dishBlock = (
    <>
      {hasDishSet ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <div className="mb-3 px-3 py-2 rounded-lg bg-orange-100 border-l-4 border-orange-500">
            <h3
              className="font-black text-orange-800 tracking-wide truncate leading-none"
              style={{ fontSize: hdrSize }}
            >
              {t('bludiAndSet')}
            </h3>
          </div>
          {renderGrid('dishset', layout.dishCardSize, false)}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center text-slate-400 text-sm">
          {t('noMenuItems')}
        </div>
      )}
    </>
  );

  const toppingBlock = (
    <>
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
              style={{ fontSize: hdrSize }}
            >
              {t('type_topping')}
            </h3>
            <div className="overflow-y-auto h-[calc(100%-16px)]">
              {renderGrid('topping', layout.toppingCardSize, true)}
            </div>
          </div>
        </>
      )}
    </>
  );

  const fluidMenu = (
    <>
      <div className="flex gap-2 px-3 py-2 overflow-x-auto shrink-0 bg-white border-b border-slate-200 [scrollbar-width:none]">
        {catList.map((c) => (
          <button
            key={c.key}
            onClick={() => setMenuCat(c.key)}
            className={`shrink-0 px-4 py-2.5 rounded-full border-2 text-sm font-black whitespace-nowrap active:scale-95 transition-all ${
              activeCat?.key === c.key
                ? CAT_STYLE[c.key].on
                : CAT_STYLE[c.key].off
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      {activeCat ? (
        <div
          className={`flex-1 min-h-0 overflow-y-auto p-3 ${
            isPhone && hasActiveItems ? 'pb-24' : ''
          }`}
        >
          {(() => {
            const { cols, size } = fluidGrid(activeCat.key);
            return renderGrid(activeCat.key, size, false, cols);
          })()}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center text-slate-400 text-sm">
          {t('noMenuItems')}
        </div>
      )}
    </>
  );

  const phoneTabs: {
    key: MobileTab;
    label: string;
    icon: ReactNode;
    badge: number;
  }[] = [
    {
      key: 'menu',
      label: lang === 'ru' ? 'Меню' : 'Menu',
      icon: <UtensilsCrossed className="w-5 h-5" />,
      badge: 0,
    },
    {
      key: 'cart',
      label: lang === 'ru' ? 'Корзина' : 'Cart',
      icon: <ShoppingCart className="w-5 h-5" />,
      badge: cartQty,
    },
    {
      key: 'orders',
      label: lang === 'ru' ? 'Заказы' : 'Orders',
      icon: <ClipboardList className="w-5 h-5" />,
      badge: ordersCount,
    },
  ];

  const phoneLayout = (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col bg-slate-100 relative">
        {mobileTab === 'menu' && (
          <>
            {errorBox}
            {fluidMenu}
            {hasActiveItems && (
              <button
                onClick={() => setMobileTab('cart')}
                className="absolute left-3 right-3 bottom-3 z-10 h-14 rounded-2xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-black flex items-center justify-between px-5 shadow-xl shadow-orange-500/40 active:scale-[0.98] transition-all"
              >
                <span className="flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5" />
                  {cartQty}
                </span>
                <span className="tabular-nums text-lg">
                  {formatYen(cartTotal)}
                </span>
              </button>
            )}
          </>
        )}
        {mobileTab === 'cart' && (
          <div className="flex-1 min-h-0 bg-white flex flex-col">
            {errorBox}
            {cartInner}
          </div>
        )}
        {mobileTab === 'orders' && (
          <div className="flex-1 min-h-0 bg-white flex flex-col">
            {ordersInner}
          </div>
        )}
      </div>

      <nav className="shrink-0 grid grid-cols-3 bg-white border-t border-slate-300 pb-[env(safe-area-inset-bottom)]">
        {phoneTabs.map((tab) => {
          const active = mobileTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setMobileTab(tab.key)}
              className={`relative flex flex-col items-center justify-center gap-0.5 py-2 min-h-[3.5rem] text-[0.6875rem] font-black transition-colors ${
                active ? 'text-orange-600 bg-orange-50' : 'text-slate-500'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.badge > 0 && (
                <span className="absolute top-1 left-1/2 ml-2 min-w-[18px] px-1 h-[1.125rem] rounded-full bg-orange-500 text-white text-[0.625rem] font-black flex items-center justify-center tabular-nums">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );

  const tabletLayout = (
    <div className="flex-1 min-h-0 flex overflow-hidden relative">
      <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-slate-100">
        <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-200 shrink-0">
          <button
            onClick={() => setOrdersOpen(true)}
            className="shrink-0 flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-slate-200 bg-white text-sm font-black text-slate-700 active:scale-95 transition-all"
          >
            <ClipboardList className="w-4 h-4" />
            {lang === 'ru' ? 'Заказы' : 'Orders'}
            {ordersCount > 0 && (
              <span className="text-[0.6875rem] bg-orange-500 text-white px-2 py-0.5 rounded-full tabular-nums">
                {ordersCount}
              </span>
            )}
          </button>
        </div>
        {errorBox}
        {fluidMenu}
      </div>

      <div
        className="shrink-0 bg-white border-l border-slate-300 flex flex-col min-h-0"
        style={{ width: tabletCartW }}
      >
        {cartInner}
      </div>

      {ordersOpen && (
        <div className="absolute inset-0 z-40 flex">
          <div className="w-[min(22rem,85%)] bg-white shadow-2xl flex flex-col min-h-0 border-r border-slate-300">
            <div className="flex justify-end p-1 border-b border-slate-200 shrink-0">
              <button
                onClick={() => setOrdersOpen(false)}
                aria-label="Close"
                className="w-11 h-11 rounded-xl hover:bg-slate-100 active:scale-90 flex items-center justify-center text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">{ordersInner}</div>
          </div>
          <button
            aria-label="Close"
            className="flex-1 bg-black/40"
            onClick={() => setOrdersOpen(false)}
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-200/70">
      <PageActions forRole="cashier">
        <button
          onClick={askUndo}
          disabled={undoStack.length === 0}
          className="ml-auto flex items-center gap-2 px-3 py-2 sm:px-5 sm:py-3 rounded-xl text-sm font-bold border-2 border-slate-200 bg-white hover:border-orange-400 hover:bg-orange-50 text-slate-700 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
        >
          <Undo2 className="w-4 h-4" />
          <span className="hidden sm:inline">{t('undoLast')}</span>
          {undoStack.length > 0 && (
            <span className="text-[0.6875rem] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-black">
              {undoStack.length}
            </span>
          )}
        </button>
      </PageActions>

      {isDesktop ? (
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

          {/* CENTER */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-slate-100">
            {errorBox}
            {dishBlock}
            {toppingBlock}
          </div>

          <Resizer
            onStart={beginResize}
            onResize={handleResizeMenuRight}
            onEnd={endResize}
          />

          {/* RIGHT */}
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
              {hasDrink ? (
                <div className="flex-1 min-h-0 overflow-y-auto p-2">
                  {renderGrid('drink', layout.drinkCardSize, true)}
                </div>
              ) : (
                <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-slate-300">
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
              <div className="px-2 py-1.5 border-b border-red-200 shrink-0 bg-red-50">
                <h3
                  className="font-black text-red-800 tracking-wide border-l-4 border-red-500 pl-2 leading-none"
                  style={{ fontSize: hdrSize }}
                >
                  {t('type_sauce')}
                </h3>
              </div>
              {hasSauce ? (
                <div className="flex-1 min-h-0 overflow-y-auto p-2">
                  {renderGrid('sauce', layout.sauceCardSize, true)}
                </div>
              ) : (
                <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-slate-300">
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

          {/* CART */}
          <div
            className="shrink-0 bg-white border-l border-slate-300 flex flex-col min-h-0"
            style={{ width: layout.cartWidth }}
          >
            {cartInner}
          </div>
        </div>
      ) : isPhone ? (
        phoneLayout
      ) : (
        tabletLayout
      )}

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

      {/* ============================================ */}
      {/* МОДАЛКА: выбор способа получения (3 квадрата) */}
      {/* ============================================ */}
      {showTypePicker && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowTypePicker(false)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-black text-slate-900 text-center">
              {t('chooseOrderTypeTitle')}
            </h3>
            <p className="text-sm text-slate-500 text-center mt-1 mb-4">
              {t('chooseOrderTypeHint')}
            </p>

            <div className="grid grid-cols-3 gap-3">
              {/* ЗДЕСЬ — синий */}
              <button
                onClick={() => performCreateOrder('INSIDE')}
                disabled={sending}
                className="aspect-square flex flex-col items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 active:scale-95 disabled:opacity-50 transition-all shadow-lg shadow-blue-600/40 p-3"
              >
                <span className="text-5xl sm:text-6xl leading-none drop-shadow-lg">
                  🍽️
                </span>
                <span className="font-black text-sm sm:text-base text-white text-center leading-tight drop-shadow">
                  {t('inside')}
                </span>
              </button>

              {/* С СОБОЙ — фиолетовый */}
              <button
                onClick={() => performCreateOrder('OUTSIDE')}
                disabled={sending}
                className="aspect-square flex flex-col items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-700 hover:from-purple-400 hover:to-purple-600 active:scale-95 disabled:opacity-50 transition-all shadow-lg shadow-purple-600/40 p-3"
              >
                <span className="text-5xl sm:text-6xl leading-none drop-shadow-lg">
                  🥡
                </span>
                <span className="font-black text-sm sm:text-base text-white text-center leading-tight drop-shadow">
                  {t('outside')}
                </span>
              </button>

              {/* ПО ДОРОГЕ — оранжевый */}
              <button
                onClick={() => performCreateOrder('ON_THE_WAY')}
                disabled={sending}
                className="aspect-square flex flex-col items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-700 hover:from-amber-400 hover:to-orange-600 active:scale-95 disabled:opacity-50 transition-all shadow-lg shadow-orange-600/40 p-3"
              >
                <span className="text-5xl sm:text-6xl leading-none drop-shadow-lg">
                  🚶
                </span>
                <span className="font-black text-sm sm:text-base text-white text-center leading-tight drop-shadow">
                  {t('orderTypeOnTheWay')}
                </span>
              </button>
            </div>

            <button
              onClick={() => setShowTypePicker(false)}
              disabled={sending}
              className="mt-3 w-full py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold transition-colors disabled:opacity-50"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

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
