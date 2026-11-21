import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { formatTimeAgo } from '@/locale/format';
import {
  pushUndo,
  popUndo,
  useUndoStack,
  type UndoRecord,
} from '@/services/undo';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageActions } from '@/components/PageActions';
import { KitchenScroller } from '@/components/KitchenScroller';
import { useViewport } from '@/lib/useViewport';
import {
  getSocket,
  subscribeInit,
  subscribeOrders,
  emitUpdateStatus,
} from '@/lib/localStore';
import { useI18n, type TranslationKey, type Lang } from '@/locale';
import type { Order, OrderStatus, OrderType } from '@/types/database';
import {
  ChefHat,
  Clock,
  Check,
  Undo2,
  AlertTriangle,
  Pencil,
  Bell,
  Utensils,
  ShoppingBag,
  Footprints,
} from 'lucide-react';

const FRESH_MS = 15_000;
// Пороги срочности (минуты с момента создания заказа)
const WARN_MIN = 3; // жёлтый
const DANGER_MIN = 5; // красный
const CRITICAL_MIN = 10; // красный + пульсация

// На кухне 3 повара, одновременно готовятся ~3-4 блюда, поэтому
// «горят» (жёлтый/красный) только самые старые заказы очереди.
// Всё, что новее этого лимита, остаётся зелёным — до него просто не дошли.
const MAX_URGENT_ORDERS = 10;

// Размер шрифта позиций (px): подбирается так, чтобы заказ влез целиком
const FONT_MAX = 20;
const FONT_MIN = 9;
const MODIFIED_MS = 30_000;

const CARD_W = 360;
const CARD_GAP = 16;

// ============================================================
// ЦВЕТОВАЯ ЛОГИКА
// ============================================================
type UrgencyLevel = 'ok' | 'warning' | 'danger' | 'critical';

interface Urgency {
  level: UrgencyLevel;
  min: number;
  border: string;
  headerBg: string;
  cardBg: string;
  ring: string;
  labelKey: TranslationKey;
  pulse: boolean;
}

function getUrgency(
  createdAt: string,
  now: number,
  eligible: boolean
): Urgency {
  const min = Math.max(
    0,
    Math.floor((now - new Date(createdAt).getTime()) / 60_000)
  );
  // Заказы вне «горячих» N самых старых не краснеют/не желтеют
  const lvlMin = eligible ? min : 0;

  if (lvlMin >= CRITICAL_MIN) {
    return {
      level: 'critical',
      min,
      border: 'border-red-700',
      headerBg: 'bg-gradient-to-r from-red-700 to-red-600',
      cardBg: 'bg-red-50',
      ring: 'ring-red-600/40',
      labelKey: 'urgencyCritical',
      pulse: true,
    };
  }
  if (lvlMin >= DANGER_MIN) {
    return {
      level: 'danger',
      min,
      border: 'border-red-600',
      headerBg: 'bg-gradient-to-r from-red-600 to-red-500',
      cardBg: 'bg-red-50',
      ring: 'ring-red-500/30',
      labelKey: 'urgencyDelay',
      pulse: false,
    };
  }
  if (lvlMin >= WARN_MIN) {
    return {
      level: 'warning',
      min,
      border: 'border-amber-500',
      headerBg: 'bg-gradient-to-r from-amber-500 to-yellow-400',
      cardBg: 'bg-amber-50',
      ring: 'ring-amber-400/30',
      labelKey: 'urgencyInWork',
      pulse: false,
    };
  }
  return {
    level: 'ok',
    min,
    border: 'border-emerald-600',
    headerBg: 'bg-gradient-to-r from-emerald-600 to-green-500',
    cardBg: 'bg-white',
    ring: 'ring-emerald-500/20',
    labelKey: 'urgencyFresh',
    pulse: false,
  };
}

// ============================================================
// ЭМОДЗИ ТИПА ЗАКАЗА
// ============================================================
function typeEmoji(t: OrderType): string {
  if (t === 'INSIDE') return '🍽️';
  if (t === 'ON_THE_WAY') return '🚶';
  return '🥡';
}

// ============================================================
// ГЛАВНЫЙ КОМПОНЕНТ
// ============================================================
export default function KitchenPage() {
  const { t, lang } = useI18n();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingUndo, setPendingUndo] = useState<UndoRecord | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const seenRef = useRef<Map<string, number>>(new Map());
  const initializedRef = useRef(false);

  const undoStack = useUndoStack('kitchen');

  const { width: vw, scale: ui } = useViewport();
  const cardW = Math.min(
    Math.round(CARD_W * ui),
    Math.max(200, vw - Math.round(32 * ui))
  );

  // ---------- Подписка на заказы ----------
  useEffect(() => {
    const unsubInit = subscribeInit((snap) => {
      setOrders(snap.orders);
      setLoading(false);
    });
    const unsubOrders = subscribeOrders((orders) => {
      setOrders(orders);
      setLoading(false);
    });
    getSocket();
    return () => {
      unsubInit();
      unsubOrders();
    };
  }, []);

  // ---------- Тик каждую секунду ----------
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const rawKitchen = orders.filter(
    (o) => o.status === 'NEW' || o.status === 'PREPARING'
  );

  const seen = seenRef.current;
  if (!loading) {
    const current = new Set(rawKitchen.map((o) => o.id));
    for (const o of rawKitchen) {
      if (!seen.has(o.id)) {
        if (initializedRef.current) {
          seen.set(o.id, Date.now());
        } else {
          const ageMs = Date.now() - new Date(o.created_at).getTime();
          seen.set(o.id, ageMs < FRESH_MS ? Date.now() - ageMs : 0);
        }
      }
    }
    for (const id of Array.from(seen.keys())) {
      if (!current.has(id)) seen.delete(id);
    }
    initializedRef.current = true;
  }

  const kitchen = [...rawKitchen].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const isFresh = (id: string) => {
    const at = seen.get(id) ?? 0;
    return at > 0 && now - at < FRESH_MS;
  };

  const isModified = (order: Order): boolean => {
    const created = new Date(order.created_at).getTime();
    const updated = new Date(order.updated_at).getTime();
    if (updated <= created + 1000) return false;
    return now - updated < MODIFIED_MS;
  };

  // ---------- Действия ----------
  const handleReady = async (order: Order) => {
    pushUndo('kitchen', {
      kind: 'status',
      orderId: order.id,
      orderNumber: order.order_number,
      fromStatus: order.status,
      toStatus: 'READY',
      timestamp: Date.now(),
    });
    setOrders((prev) => prev.filter((o) => o.id !== order.id));
    try {
      await emitUpdateStatus(order.id, 'READY');
    } catch (e) {
      setOrders((prev) => [...prev, order]);
      setError(e instanceof Error ? e.message : t('failedToUpdateStatus'));
    }
  };

  const askUndo = () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setPendingUndo(last);
  };

  const confirmUndo = async () => {
    const rec = popUndo('kitchen');
    setPendingUndo(null);
    if (!rec) return;
    if (rec.kind !== 'status' || !rec.fromStatus) return;
    try {
      await emitUpdateStatus(rec.orderId, rec.fromStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToUpdateStatus'));
    }
  };

  const statusLabel = (s: OrderStatus): string => {
    switch (s) {
      case 'NEW':
        return t('statusNew');
      case 'PREPARING':
        return t('statusPreparing');
      case 'READY':
        return t('statusReadyDone');
      case 'COMPLETED':
        return t('statusCompleted');
      default:
        return s;
    }
  };

  const lastUndo: UndoRecord | null =
    undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100">
      <style>{`
        @keyframes kitchen-card-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .kitchen-card-in { animation: kitchen-card-in 0.3s ease-out; }

        @keyframes kitchen-flash {
          0%, 100% {
            background-color: #fef9c3;
            box-shadow: 0 4px 16px rgba(234, 179, 8, 0.25);
          }
          50% {
            background-color: #fed7aa;
            box-shadow: 0 4px 20px rgba(249, 115, 22, 0.35);
          }
        }
        .kitchen-flash { animation: kitchen-flash 2s ease-in-out infinite; }

        @keyframes kitchen-fresh-banner {
          0%, 100% { background-color: #fbbf24; color: #78350f; }
          50%      { background-color: #f97316; color: #ffffff; }
        }
        .kitchen-fresh-banner { animation: kitchen-fresh-banner 2s ease-in-out infinite; }

        @keyframes kitchen-icon-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.75; transform: scale(1.08); }
        }
        .kitchen-icon-pulse { animation: kitchen-icon-pulse 1.2s ease-in-out infinite; }

        @keyframes kitchen-critical-pulse {
          0%, 100% { box-shadow: 0 4px 16px rgba(220, 38, 38, 0.25); }
          50%      { box-shadow: 0 6px 24px rgba(220, 38, 38, 0.5); }
        }
        .kitchen-critical { animation: kitchen-critical-pulse 2.2s ease-in-out infinite; }

        @keyframes kitchen-critical-header {
          0%, 100% { filter: brightness(1); }
          50%      { filter: brightness(1.08); }
        }
        .kitchen-critical-header { animation: kitchen-critical-header 2.2s ease-in-out infinite; }

        @keyframes kitchen-modified-blink {
          0%, 100% {
            border-color: #f97316;
            box-shadow:
              0 0 0 4px rgba(249, 115, 22, 0.25),
              0 8px 24px rgba(249, 115, 22, 0.35);
          }
          50% {
            border-color: #ea580c;
            box-shadow:
              0 0 0 10px rgba(249, 115, 22, 0.55),
              0 8px 32px rgba(249, 115, 22, 0.7);
          }
        }
        .kitchen-modified { animation: kitchen-modified-blink 1.1s ease-in-out infinite; }

        @keyframes kpulse-soft {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.45; }
        }
        .animate-kpulse-soft { animation: kpulse-soft 1.4s ease-in-out infinite; }

        @keyframes kpulse-amber {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.65); }
          50%      { opacity: 0.6; box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
        }
        .animate-kpulse-amber { animation: kpulse-amber 1.1s ease-in-out infinite; }

        @keyframes kpulse-urgent {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.75);
          }
          50% {
            opacity: 0.55;
            transform: scale(1.06);
            box-shadow: 0 0 0 7px rgba(220, 38, 38, 0);
          }
        }
        .animate-kpulse-urgent { animation: kpulse-urgent 0.9s ease-in-out infinite; }

        @media (prefers-reduced-motion: reduce) {
          .animate-kpulse-soft,
          .animate-kpulse-amber,
          .animate-kpulse-urgent,
          .kitchen-flash,
          .kitchen-modified,
          .kitchen-critical,
          .kitchen-fresh-banner,
          .kitchen-icon-pulse,
          .kitchen-critical-header {
            animation: none !important;
          }
        }
      `}</style>

      {/* ============================================ */}
      {/* ВЕРХНЯЯ ПАНЕЛЬ (портал в App header)         */}
      {/* ============================================ */}
      <PageActions forRole="kitchen">
        <div className="flex items-center gap-2 sm:gap-2.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-white text-slate-900 font-black shadow-md border-2 border-slate-200">
          <ChefHat className="w-5 h-5 sm:w-6 sm:h-6 text-orange-500" />
          <span className="hidden sm:inline text-base">{t('ordersCount')}</span>
          <span className="text-xl sm:text-2xl tabular-nums">
            {kitchen.length}
          </span>
        </div>

        <button
          onClick={askUndo}
          disabled={undoStack.length === 0}
          title={
            lastUndo
              ? t('confirmUndo')
                  .replace('{n}', String(lastUndo.orderNumber))
                  .replace(
                    '{status}',
                    statusLabel(lastUndo.fromStatus ?? 'NEW')
                  )
              : t('nothingToUndo')
          }
          className="ml-auto flex items-center gap-2 px-3 py-2 sm:px-4 rounded-xl text-sm font-black bg-white text-slate-800 hover:bg-slate-100 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md border-2 border-slate-200"
        >
          <Undo2 className="w-5 h-5" />
          <span className="hidden sm:inline">{t('undoLast')}</span>
          {undoStack.length > 0 && (
            <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded-full">
              {undoStack.length}
            </span>
          )}
        </button>
      </PageActions>

      {/* ============================================ */}
      {/* ОШИБКА                                        */}
      {/* ============================================ */}
      {error && (
        <div className="mx-3 mt-2 p-3 bg-red-600 text-white rounded-xl text-base font-bold flex items-center justify-between gap-2 shadow-lg">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-2xl leading-none"
          >
            ×
          </button>
        </div>
      )}

      {/* ============================================ */}
      {/* ГОРИЗОНТАЛЬНАЯ ЛЕНТА (старые слева, новые справа)           */}
      {/* ============================================ */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-16 h-16 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
        </div>
      ) : kitchen.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
          <ChefHat className="w-20 h-20 sm:w-32 sm:h-32 mb-4 sm:mb-6 opacity-30" />
          <p className="text-2xl sm:text-4xl font-black">
            {t('noOrdersTitle')}
          </p>
          <p className="text-base sm:text-xl mt-2 px-4 text-center">
            {t('waitingForOrders')}
          </p>
        </div>
      ) : (
        <KitchenScroller itemWidth={cardW + Math.round(CARD_GAP * ui)}>
          <div className="flex gap-4 items-stretch h-full">
            {kitchen.map((order, idx) => (
              <div
                key={order.id}
                className="flex-shrink-0 h-full"
                style={{ width: cardW }}
              >
                <KitchenOrderCard
                  order={order}
                  now={now}
                  urgentEligible={idx < MAX_URGENT_ORDERS}
                  fresh={isFresh(order.id)}
                  modified={isModified(order)}
                  onReady={handleReady}
                  lang={lang}
                  t={t}
                />
              </div>
            ))}

            <div className="flex-shrink-0 w-4" aria-hidden="true" />
          </div>
        </KitchenScroller>
      )}

      {/* ============================================ */}
      {/* UNDO                                          */}
      {/* ============================================ */}
      <ConfirmDialog
        open={pendingUndo !== null}
        title={t('confirmTitle')}
        message={
          pendingUndo
            ? t('confirmUndo')
                .replace('{n}', String(pendingUndo.orderNumber))
                .replace(
                  '{status}',
                  statusLabel(pendingUndo.fromStatus ?? 'NEW')
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
// КАРТОЧКА ЗАКАЗА
// ============================================================
function KitchenOrderCard({
  order,
  now,
  urgentEligible,
  fresh,
  modified,
  onReady,
  lang,
  t,
}: {
  order: Order;
  now: number;
  urgentEligible: boolean;
  fresh: boolean;
  modified: boolean;
  onReady: (order: Order) => void;
  lang: Lang;
  t: (key: TranslationKey) => string;
}) {
  const urgency = getUrgency(order.created_at, now, urgentEligible);
  const isInside = order.order_type === 'INSIDE';
  const isCritical = urgency.level === 'critical';
  const typeLabel = isInside
    ? t('orderTypeInside')
    : order.order_type === 'ON_THE_WAY'
    ? t('orderTypeOnTheWay')
    : t('orderTypeOutside');
  const emoji = typeEmoji(order.order_type);
  const TypeIcon = isInside
    ? Utensils
    : order.order_type === 'ON_THE_WAY'
    ? Footprints
    : ShoppingBag;

  // ---------- Авто-подбор шрифта: чем больше позиций, тем мельче ----------
  const itemsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = itemsRef.current;
    if (!el) return;
    const fit = () => {
      let size = FONT_MAX;
      el.style.fontSize = `${size}px`;
      while (size > FONT_MIN && el.scrollHeight > el.clientHeight + 1) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [order.order_items, order.comment, fresh]);

  const blinkClass = fresh
    ? 'kitchen-flash'
    : modified
    ? 'kitchen-modified'
    : isCritical
    ? 'kitchen-critical'
    : 'kitchen-card-in';

  return (
    <div
      className={`rounded-2xl border-4 ${urgency.border} ${urgency.cardBg} shadow-lg flex flex-col overflow-hidden ring-2 ${urgency.ring} h-full transition-shadow duration-500 ${blinkClass}`}
    >
      {fresh && (
        <div className="kitchen-fresh-banner text-center text-xs font-black tracking-[0.25em] py-0.5">
          🔔 {t('newOrderBadge')}
        </div>
      )}

      {/* ШАПКА — маленькая, одна строка */}
      <div
        className={`${urgency.headerBg} text-white px-2.5 py-1 flex items-center gap-2 shrink-0 ${
          isCritical && !fresh ? 'kitchen-critical-header' : ''
        }`}
      >
        <span className="text-xl font-black leading-none tabular-nums drop-shadow shrink-0">
          #{order.order_number}
        </span>

        {/* Иконка типа заказа (в зале / по дороге / с собой) */}
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white/25 shrink-0"
          title={typeLabel}
          aria-label={typeLabel}
        >
          <TypeIcon className="w-5 h-5" strokeWidth={2.5} />
        </span>

        <div className="ml-auto flex items-center gap-1.5 min-w-0">
          {modified && !fresh ? (
            <span className="animate-kpulse-amber inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500 text-white text-[10px] font-black uppercase tracking-wider leading-none shadow-md whitespace-nowrap">
              <Pencil className="w-3 h-3" />
              {t('modified')}
            </span>
          ) : isCritical && !fresh ? (
            <span className="animate-kpulse-urgent inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-700 text-white text-[10px] font-black uppercase tracking-wider leading-none shadow-md whitespace-nowrap">
              <AlertTriangle className="w-3 h-3" />
              {urgency.min}м
            </span>
          ) : fresh ? (
            <span className="animate-kpulse-soft inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-600 text-white text-[10px] font-black uppercase tracking-wider leading-none shadow-md whitespace-nowrap">
              <Bell className="w-3 h-3" />
            </span>
          ) : null}

          <span className="flex items-center gap-1 text-xs font-black tabular-nums whitespace-nowrap opacity-95">
            <Clock className="w-3.5 h-3.5" />
            {formatTimeAgo(order.created_at, lang)}
          </span>
        </div>
      </div>

      {/* ПОЗИЦИИ — размер шрифта подбирается автоматически (em) */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        {/* Прозрачная иконка типа заказа в правом нижнем углу списка */}
        <span
          className="absolute bottom-6 right-2 text-6xl leading-none opacity-20 pointer-events-none select-none z-0"
          aria-hidden="true"
        >
          {emoji}
        </span>
      <div
        ref={itemsRef}
        className="relative z-10 flex-1 min-h-0 px-3 py-1 overflow-y-auto"
        style={{ fontSize: FONT_MAX }}
      >
        {order.order_items?.map((item, idx) => {
          const displayName = item.variant
            ? `${item.name} ${item.variant}`
            : item.name;
          const removed = item.is_removed ?? false;
          const isNew = item.is_added_later ?? false;

          return (
            <div
              key={idx}
              className={`border-b border-slate-200/70 last:border-b-0 ${
                isNew && !removed ? '-mx-3 px-3 bg-orange-100/80' : ''
              } ${removed ? 'opacity-60' : ''}`}
              style={{ padding: '0.25em 0' }}
            >
              <div className="flex items-start" style={{ gap: '0.5em' }}>
                <span
                  className={`inline-flex items-center justify-center rounded-md font-black shrink-0 tabular-nums shadow-sm ${
                    removed
                      ? 'bg-slate-300 text-slate-600'
                      : 'bg-slate-900 text-white'
                  }`}
                  style={{
                    fontSize: '0.9em',
                    minWidth: '1.8em',
                    height: '1.6em',
                    padding: '0 0.3em',
                  }}
                >
                  {item.quantity}
                </span>

                <div className="flex-1 min-w-0">
                  <div
                    className={`font-black leading-tight break-words ${
                      removed
                        ? 'text-red-700 line-through'
                        : isNew
                        ? 'text-orange-800'
                        : 'text-slate-900'
                    }`}
                  >
                    {displayName}
                    {(removed || isNew) && (
                      <span
                        className={`inline-block align-middle font-black uppercase rounded ${
                          removed
                            ? 'bg-red-600 text-white'
                            : 'bg-orange-500 text-white'
                        }`}
                        style={{
                          fontSize: '0.55em',
                          marginLeft: '0.6em',
                          padding: '0.1em 0.5em',
                        }}
                      >
                        {removed ? t('removed') : t('newItem')}
                      </span>
                    )}
                  </div>

                  {item.options && item.options.length > 0 && (
                    <div>
                      {item.options.map((o, optIdx) => (
                        <div
                          key={optIdx}
                          className="font-bold text-slate-700 flex items-baseline gap-1 leading-snug"
                          style={{ fontSize: '0.8em' }}
                        >
                          <span className="text-orange-600 font-black">+</span>
                          <span>
                            {o.name}
                            {o.quantity > 1 && (
                              <span className="ml-1 font-black text-slate-900">
                                ×{o.quantity}
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* КОММЕНТАРИЙ */}
        {order.comment && order.comment.trim() && (
          <div
            className="mt-1 px-2 py-1 rounded-lg bg-yellow-300 border border-yellow-600 font-black text-slate-900 leading-snug flex items-start gap-1.5 shadow-inner"
            style={{ fontSize: '0.8em' }}
          >
            <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            <div>{order.comment}</div>
          </div>
        )}
      </div>
      </div>

      {/* КНОПКА «ГОТОВО» — галочка + иконка типа заказа */}
      <button
        onClick={() => onReady(order)}
        aria-label={t('markReady')}
        title={t('markReady')}
        className="w-full h-14 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 active:from-green-700 active:to-emerald-700 text-white transition-all flex items-center justify-center gap-4 shrink-0 shadow-inner"
      >
        <Check className="w-9 h-9" strokeWidth={4} />
        <span className="text-4xl leading-none select-none" aria-hidden="true">
          {emoji}
        </span>
      </button>
    </div>
  );
}
