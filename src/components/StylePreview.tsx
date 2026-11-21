// src/components/StylePreview.tsx
import { useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import { SendToKitchenButton } from '@/components/SendToKitchenButton';
import { useI18n, type TranslationKey } from '@/locale';
import { formatYen } from '@/locale/format';
import { useLayoutSettings } from '@/lib/layoutSettings';
import { useViewport } from '@/lib/useViewport';
import type { OrderType } from '@/types/database';

// ============================================================
// ТИПЫ
// ============================================================
type PreviewTab = 'cashier' | 'hall';

interface MockCard {
  id: string;
  name: string;
  price: number;
  emoji: string;
}

interface MockOrder {
  id: string;
  number: number;
  total: number;
  status: 'NEW' | 'PREPARING' | 'READY';
  type: OrderType;
  minutesAgo: number;
}

interface MockCartLine {
  id: string;
  name: string;
  qty: number;
  price: number;
}

/** Все пиксельные настройки после масштабирования под экран */
type ScaledLayout = {
  ordersWidth: number;
  menuRightWidth: number;
  cartWidth: number;
  dishCardSize: number;
  toppingCardSize: number;
  drinkCardSize: number;
  sauceCardSize: number;
  cardRadius: number;
  gridGap: number;
  ordersRowGap: number;
  cartItemGap: number;
  itemTextSize: number;
  panelHeaderSize: number;
  orderNumberSize: number;
  toppingsHeight: number;
  drinksShare: number;
};

// ============================================================
// MOCK-ДАННЫЕ (превью не зависит от БД)
// ============================================================
const MOCK_DISHES: MockCard[] = [
  { id: 'd1', name: 'Шаурма классик', price: 350, emoji: '🌯' },
  { id: 'd2', name: 'Шаурма острая', price: 380, emoji: '🌶️' },
  { id: 'd3', name: 'Донер', price: 420, emoji: '🥙' },
  { id: 'd4', name: 'Сет семейный', price: 1200, emoji: '🍱' },
  { id: 'd5', name: 'Люля-кебаб', price: 320, emoji: '🥩' },
  { id: 'd6', name: 'Шаурма-боул', price: 390, emoji: '🥗' },
];

const MOCK_DRINKS: MockCard[] = [
  { id: 'dr1', name: 'Кола', price: 150, emoji: '🥤' },
  { id: 'dr2', name: 'Сок', price: 120, emoji: '🧃' },
];

const MOCK_SAUCES: MockCard[] = [
  { id: 's1', name: 'Чесночный', price: 30, emoji: '🧄' },
  { id: 's2', name: 'Острый', price: 30, emoji: '🔥' },
];

const MOCK_TOPPINGS: MockCard[] = [
  { id: 't1', name: 'Сыр', price: 50, emoji: '🧀' },
  { id: 't2', name: 'Бекон', price: 70, emoji: '🥓' },
  { id: 't3', name: 'Халапеньо', price: 40, emoji: '🌶️' },
];

const MOCK_ORDERS: MockOrder[] = [
  { id: 'o1', number: 12, total: 850, status: 'PREPARING', type: 'INSIDE', minutesAgo: 3 },
  { id: 'o2', number: 13, total: 1200, status: 'READY', type: 'OUTSIDE', minutesAgo: 1 },
  { id: 'o3', number: 14, total: 420, status: 'NEW', type: 'ON_THE_WAY', minutesAgo: 0 },
];

const MOCK_CART: MockCartLine[] = [
  { id: 'c1', name: 'Шаурма классик', qty: 2, price: 350 },
  { id: 'c2', name: 'Кола', qty: 1, price: 150 },
];

// ============================================================
// ХЕЛПЕРЫ
// ============================================================
type TFn = (key: TranslationKey) => string;

function typeEmoji(t: OrderType): string {
  if (t === 'INSIDE') return '🍽️';
  if (t === 'ON_THE_WAY') return '🚶';
  return '🥡';
}

function typeLabel(type: OrderType, t: TFn): string {
  if (type === 'INSIDE') return t('typeInside');
  if (type === 'ON_THE_WAY') return t('typeOnTheWay');
  return t('typeTakeaway');
}

function typeBadgeCls(t: OrderType): string {
  if (t === 'INSIDE') return 'bg-blue-100 text-blue-700';
  if (t === 'ON_THE_WAY') return 'bg-amber-100 text-amber-700';
  return 'bg-purple-100 text-purple-700';
}

function statusLabel(s: MockOrder['status'], t: TFn): string {
  if (s === 'READY') return t('statusReadyShort');
  if (s === 'PREPARING') return t('statusPreparing');
  return t('statusNew');
}

// ============================================================
// МИНИ-КАРТОЧКА
// ============================================================
function MiniCard({
  card,
  size,
  compact,
  radius,
  textSize,
}: {
  card: MockCard;
  size: number;
  compact: boolean;
  radius: number;
  textSize: number;
}) {
  const imgH = compact ? Math.round(size * 0.55) : Math.round(size * 0.68);
  const textPx = Math.max(10, Math.round(textSize));
  return (
    <div
      className="bg-white border border-slate-200 shadow-sm overflow-hidden flex flex-col"
      style={{ width: size, borderRadius: radius }}
    >
      <div
        className="flex items-center justify-center bg-slate-100"
        style={{ height: imgH, fontSize: Math.round(imgH * 0.55) }}
      >
        {card.emoji}
      </div>
      <div className="px-1.5 py-1 flex-1 flex flex-col justify-between">
        <div
          className="font-bold text-slate-900 leading-tight truncate"
          style={{ fontSize: textPx }}
        >
          {card.name}
        </div>
        <div
          className="text-slate-500 tabular-nums mt-0.5"
          style={{ fontSize: Math.max(9, textPx - 2) }}
        >
          {formatYen(card.price)}
        </div>
      </div>
    </div>
  );
}

// Сетка мини-карточек
function MiniGrid({
  cards,
  size,
  compact,
  layout,
}: {
  cards: MockCard[];
  size: number;
  compact: boolean;
  layout: ScaledLayout;
}) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(auto-fill, ${size}px)`,
        gap: layout.gridGap,
      }}
    >
      {cards.map((card) => (
        <MiniCard
          key={card.id}
          card={card}
          size={size}
          compact={compact}
          radius={layout.cardRadius}
          textSize={layout.itemTextSize}
        />
      ))}
    </div>
  );
}

// ============================================================
// ПАНЕЛЬ ЗАКАЗОВ (левая колонка)
// ============================================================
function OrdersPanel({
  orders,
  layout,
  headerSize,
  numberSize,
}: {
  orders: MockOrder[];
  layout: ScaledLayout;
  headerSize: number;
  numberSize: number;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="px-3 py-2 border-b border-slate-200 shrink-0 bg-slate-50">
        <h2
          className="font-black text-slate-700 tracking-wide border-l-4 border-slate-400 pl-2 leading-none"
          style={{ fontSize: headerSize }}
        >
          {t('activeOrders')}
        </h2>
        <span
          className="font-black text-orange-600 leading-none mt-1.5 block pl-2 tabular-nums"
          style={{ fontSize: numberSize }}
        >
          {orders.length}
        </span>
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col"
        style={{ rowGap: layout.ordersRowGap }}
      >
        {orders.map((o) => (
          <div
            key={o.id}
            className={`p-3 border border-slate-200 border-l-[6px] ${
              o.status === 'READY'
                ? 'bg-green-50 border-l-green-500'
                : o.status === 'PREPARING'
                ? 'bg-amber-50 border-l-amber-400'
                : 'bg-white border-l-slate-300'
            }`}
            style={{ borderRadius: layout.cardRadius }}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className="font-black text-slate-900 tabular-nums"
                style={{ fontSize: numberSize }}
              >
                #{o.number}
              </span>
              <span
                className={`text-[0.6875rem] px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${typeBadgeCls(
                  o.type
                )}`}
              >
                {typeEmoji(o.type)} {typeLabel(o.type, t)}
              </span>
            </div>
            <div className="mt-1 text-[0.6875rem] font-bold text-slate-500">
              {statusLabel(o.status, t)}
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[0.6875rem] text-slate-500">
                {o.minutesAgo === 0
                  ? t('timeAgoJustNow')
                  : `${o.minutesAgo} ${t('min')}`}
              </span>
              <span className="text-sm font-black text-slate-700 tabular-nums">
                {formatYen(o.total)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ============================================================
// ПАНЕЛЬ КОРЗИНЫ
// ============================================================
function CartPanel({
  cart,
  layout,
}: {
  cart: MockCartLine[];
  layout: ScaledLayout;
}) {
  const { t } = useI18n();
  const total = cart.reduce((s, c) => s + c.qty * c.price, 0);
  return (
    <>
      <div className="px-4 py-3 border-b border-slate-200 shrink-0 bg-slate-50">
        <h2 className="text-base font-black text-slate-900">
          {t('previewCurrentOrder')}
        </h2>
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-auto p-2 bg-slate-50 flex flex-col"
        style={{ rowGap: layout.cartItemGap }}
      >
        {cart.map((c) => (
          <div
            key={c.id}
            className="bg-white border-2 border-slate-200 p-3 shadow-sm"
            style={{ borderRadius: layout.cardRadius }}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm font-bold text-slate-900 truncate">
                {c.name}
              </span>
              <span className="text-sm font-black text-slate-700 tabular-nums">
                {formatYen(c.price * c.qty)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700 font-black">
                −
              </div>
              <span className="text-base font-black w-7 text-center tabular-nums">
                {c.qty}
              </span>
              <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center text-orange-700 font-black">
                +
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-slate-200 bg-white shrink-0">
        <div className="flex items-end justify-between">
          <span className="text-sm font-bold text-slate-500">
            {t('total')}
          </span>
          <span className="text-2xl font-black text-slate-900 tabular-nums leading-none">
            {formatYen(total)}
          </span>
        </div>
        <div className="mt-3">
          <SendToKitchenButton
            icon={<Send className="w-5 h-5" />}
            label={t('sendToKitchen')}
          />
        </div>
      </div>
    </>
  );
}

// ============================================================
// ОСНОВНОЙ КОМПОНЕНТ
// ============================================================
export function StylePreview({ className }: { className?: string } = {}) {
  const { t } = useI18n();
  const { scale: ui } = useViewport();
  const [rawLayout] = useLayoutSettings();
  const [tab, setTab] = useState<PreviewTab>('cashier');

  // Масштабирование всех пиксельных настроек — точно как в CashierPage
  const layout = useMemo<ScaledLayout>(() => {
    const s = (v: number) => Math.round(v * ui);
    return {
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
      drinksShare: rawLayout.drinksShare ?? 50,
    };
  }, [rawLayout, ui]);

  const headerSize = Math.max(layout.panelHeaderSize, 14);
  const numberSize = Math.max(layout.orderNumberSize, 20);

  return (
    <div
      className={`h-full min-h-0 flex flex-col bg-slate-200/70 ${className ?? ''}`}
    >
      {/* === Переключатель: Касса / Зал === */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-300">
        <span className="text-[0.6875rem] font-black text-slate-500 uppercase tracking-wide">
          {t('stylePreview')}
        </span>
        <div className="ml-auto flex gap-1 rounded-lg bg-slate-100 p-1">
          {(
            [
              ['cashier', t('cashier')],
              ['hall', t('hall')],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-md text-xs font-black transition-all ${
                tab === key
                  ? 'bg-white shadow text-slate-900'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'cashier' ? (
        <CashierPreview
          layout={layout}
          headerSize={headerSize}
          numberSize={numberSize}
        />
      ) : (
        <HallPreview layout={layout} headerSize={headerSize} />
      )}
    </div>
  );
}

// ============================================================
// ПРЕВЬЮ КАССЫ: [Orders] | [Dish + Toppings] | [Drinks + Sauces] | [Cart]
// ============================================================
function CashierPreview({
  layout,
  headerSize,
  numberSize,
}: {
  layout: ScaledLayout;
  headerSize: number;
  numberSize: number;
}) {
  const { t } = useI18n();
  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* ORDERS */}
      <div
        className="shrink-0 bg-white border-r border-slate-300 flex flex-col min-h-0"
        style={{ width: layout.ordersWidth }}
      >
        <OrdersPanel
          orders={MOCK_ORDERS}
          layout={layout}
          headerSize={headerSize}
          numberSize={numberSize}
        />
      </div>

      {/* CENTER: блюда + топпинги снизу */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-slate-100">
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <div className="mb-3 px-3 py-2 rounded-lg bg-orange-100 border-l-4 border-orange-500">
            <h3
              className="font-black text-orange-800 tracking-wide truncate leading-none"
              style={{ fontSize: headerSize }}
            >
              {t('bludiAndSet')}
            </h3>
          </div>
          <MiniGrid
            cards={MOCK_DISHES}
            size={layout.dishCardSize}
            compact={false}
            layout={layout}
          />
        </div>

        <div
          className="shrink-0 bg-white px-2 py-1.5 overflow-hidden border-t-2 border-purple-300"
          style={{ height: layout.toppingsHeight }}
        >
          <h3
            className="font-black text-purple-800 tracking-wide mb-1 border-l-4 border-purple-500 pl-2 leading-none"
            style={{ fontSize: headerSize }}
          >
            {t('type_topping')}
          </h3>
          <div className="overflow-y-auto h-[calc(100%-16px)]">
            <MiniGrid
              cards={MOCK_TOPPINGS}
              size={layout.toppingCardSize}
              compact
              layout={layout}
            />
          </div>
        </div>
      </div>

      {/* RIGHT: напитки сверху, соусы снизу */}
      <div
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
              style={{ fontSize: headerSize }}
            >
              {t('type_drink')}
            </h3>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            <MiniGrid
              cards={MOCK_DRINKS}
              size={layout.drinkCardSize}
              compact
              layout={layout}
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-2 py-1.5 border-b border-red-200 shrink-0 bg-red-50">
            <h3
              className="font-black text-red-800 tracking-wide border-l-4 border-red-500 pl-2 leading-none"
              style={{ fontSize: headerSize }}
            >
              {t('type_sauce')}
            </h3>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            <MiniGrid
              cards={MOCK_SAUCES}
              size={layout.sauceCardSize}
              compact
              layout={layout}
            />
          </div>
        </div>
      </div>

      {/* CART */}
      <div
        className="shrink-0 bg-white border-l border-slate-300 flex flex-col min-h-0"
        style={{ width: layout.cartWidth }}
      >
        <CartPanel cart={MOCK_CART} layout={layout} />
      </div>
    </div>
  );
}

// ============================================================
// ПРЕВЬЮ ЗАЛА (клиентское меню): [Блюда + Напитки] | [Корзина]
// ============================================================
function HallPreview({
  layout,
  headerSize,
}: {
  layout: ScaledLayout;
  headerSize: number;
}) {
  const { t } = useI18n();
  return (
    <div className="flex-1 min-h-0 flex overflow-hidden bg-slate-100">
      <div className="flex-1 min-w-0 overflow-y-auto p-3">
        <div className="mb-3 px-3 py-2 rounded-lg bg-orange-100 border-l-4 border-orange-500">
          <h3
            className="font-black text-orange-800 tracking-wide truncate leading-none"
            style={{ fontSize: headerSize }}
          >
            {t('bludiAndSet')}
          </h3>
        </div>
        <MiniGrid
          cards={MOCK_DISHES}
          size={layout.dishCardSize}
          compact={false}
          layout={layout}
        />

        <div className="mt-4 mb-2 px-3 py-2 rounded-lg bg-cyan-50 border-l-4 border-cyan-500">
          <h3
            className="font-black text-cyan-800 tracking-wide leading-none"
            style={{ fontSize: headerSize }}
          >
            {t('type_drink')}
          </h3>
        </div>
        <MiniGrid
          cards={MOCK_DRINKS}
          size={layout.dishCardSize}
          compact
          layout={layout}
        />
      </div>

      <div
        className="shrink-0 bg-white border-l border-slate-300 flex flex-col min-h-0"
        style={{ width: layout.cartWidth }}
      >
        <CartPanel cart={MOCK_CART} layout={layout} />
      </div>
    </div>
  );
}
