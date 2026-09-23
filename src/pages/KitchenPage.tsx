import { useState, useEffect } from 'react';
import { printKitchenOrder } from '@/services/printer';
import { formatYen, formatTimeAgo } from '@/locale/format';
import { splitOrders } from '@/services/kitchen';
import {
  pushUndo,
  popUndo,
  useUndoStack,
  type UndoRecord,
} from '@/services/undo';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageActions } from '@/components/PageActions';
import {
  getSocket,
  subscribeInit,
  subscribeOrders,
  emitUpdateStatus,
} from '@/lib/socket';
import { useI18n, type TranslationKey, type Lang } from '@/locale';
import type { Order, OrderStatus } from '@/types/database';
import {
  ChefHat,
  Clock,
  CheckCircle2,
  Flame,
  ShoppingBag,
  Store,
  Undo2,
} from 'lucide-react';

export default function KitchenPage() {
  const { t, lang } = useI18n();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingUndo, setPendingUndo] = useState<UndoRecord | null>(null);

  const undoStack = useUndoStack();

  // ============================================================
  // Подписки на сервер
  // ============================================================
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

  const { kitchen } = splitOrders(orders);

  const handleReady = async (order: Order) => {
    pushUndo({
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
    const rec = popUndo();
    setPendingUndo(null);
    if (!rec) return;
    try {
      await emitUpdateStatus(rec.orderId, rec.fromStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToUpdateStatus'));
    }
  };

  const handlePrint = async (order: Order) => {
    try {
      await printKitchenOrder(order);
    } catch {
      // silent
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
      <PageActions>
        <StatPill
          label={t('preparing')}
          count={kitchen.length}
          color="yellow"
        />
        <button
          onClick={askUndo}
          disabled={undoStack.length === 0}
          title={
            lastUndo
              ? t('confirmUndo')
                  .replace('{n}', String(lastUndo.orderNumber))
                  .replace('{status}', statusLabel(lastUndo.fromStatus))
              : t('nothingToUndo')
          }
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

      {error && (
        <div className="mx-3 mt-2 p-2 bg-red-50 border border-red-300 rounded-lg text-red-700 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
        </div>
      ) : kitchen.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
          <ChefHat className="w-16 h-16 mb-3 opacity-30" />
          <p className="text-base font-medium">{t('noActiveOrdersLong')}</p>
          <p className="text-sm">{t('waitingForOrders')}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto p-2.5">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
            {kitchen.map((order) => (
              <KitchenOrderCard
                key={order.id}
                order={order}
                onReady={handleReady}
                onPrint={handlePrint}
                lang={lang}
                t={t}
              />
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingUndo !== null}
        title={t('confirmTitle')}
        message={
          pendingUndo
            ? t('confirmUndo')
                .replace('{n}', String(pendingUndo.orderNumber))
                .replace('{status}', statusLabel(pendingUndo.fromStatus))
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

function StatPill({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  const colors: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-700 border border-gray-200',
    yellow: 'bg-yellow-100 text-yellow-700 border border-yellow-300',
    green: 'bg-green-100 text-green-700 border border-green-300',
  };
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${colors[color]}`}
    >
      {label}
      <span className="text-base font-bold">{count}</span>
    </div>
  );
}

function KitchenOrderCard({
  order,
  onReady,
  onPrint,
  lang,
  t,
}: {
  order: Order;
  onReady: (order: Order) => void;
  onPrint: (order: Order) => void;
  lang: Lang;
  t: (key: TranslationKey) => string;
}) {
  return (
    <div className="rounded-xl border-2 border-yellow-400 bg-yellow-50 p-3 transition-all shadow-sm flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-2xl font-black text-gray-900 leading-none">
            #{order.order_number}
          </span>
          <span
            className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-black ${
              order.order_type === 'INSIDE'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-purple-100 text-purple-700'
            }`}
          >
            {order.order_type === 'INSIDE' ? (
              <Store className="w-2.5 h-2.5" />
            ) : (
              <ShoppingBag className="w-2.5 h-2.5" />
            )}
            {order.order_type === 'INSIDE' ? 'IN' : 'OUT'}
          </span>
        </div>
        <button
          onClick={() => onPrint(order)}
          className="text-gray-400 hover:text-orange-500 p-0.5"
          title={t('reprint')}
        >
          <Flame className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1 text-[11px] font-bold text-gray-600 mb-2">
        <Clock className="w-3 h-3" />
        {formatTimeAgo(order.created_at, lang)}
      </div>

      <div className="mb-2 flex-1">
        {order.order_items?.map((item, idx) => {
          const displayName = item.variant
            ? `${item.name} ${item.variant}`
            : item.name;
          const removed = item.is_removed ?? false;
          const isNew = item.is_added_later ?? false;

          return (
            <div
              key={idx}
              className={`flex flex-col gap-0.5 py-1.5 border-b border-yellow-200/70 last:border-b-0 ${
                removed ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-baseline gap-1.5">
                <span className="inline-flex items-center justify-center min-w-[22px] h-5 rounded bg-orange-500 text-white text-[11px] font-black shrink-0">
                  {item.quantity}
                </span>
                <span
                  className={`text-[13px] font-black leading-tight flex-1 min-w-0 break-words ${
                    removed
                      ? 'text-gray-500 line-through'
                      : isNew
                      ? 'text-orange-700'
                      : 'text-gray-900'
                  }`}
                >
                  {displayName}
                </span>
                {removed && (
                  <span className="text-[8px] bg-red-200 text-red-800 px-1 py-0.5 rounded font-black uppercase shrink-0">
                    {t('removed')}
                  </span>
                )}
                {isNew && !removed && (
                  <span className="text-[8px] bg-orange-500 text-white px-1 py-0.5 rounded font-black uppercase shrink-0">
                    {t('newItem')}
                  </span>
                )}
                <span className="text-[13px] font-black text-gray-700 shrink-0 tabular-nums">
                  {!removed && item.price > 0
                    ? formatYen(item.price * item.quantity)
                    : ''}
                </span>
              </div>

              {item.options && item.options.length > 0 && (
                <div className="pl-7 space-y-0.5">
                  {item.options.map((o, optIdx) => (
                    <div
                      key={optIdx}
                      className="text-[12px] text-gray-800 font-bold flex items-baseline gap-1 leading-tight"
                    >
                      <span className="text-orange-500 font-black">+</span>
                      <span>
                        {o.name}
                        {o.quantity > 1 && (
                          <span className="text-gray-600">
                            {' '}
                            ×{o.quantity}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {order.comment && (
        <div className="mb-2 p-1.5 bg-yellow-100 rounded text-[11px] text-yellow-900 border border-yellow-300 font-bold leading-snug">
          {t('note')}: {order.comment}
        </div>
      )}

      <div className="flex items-center justify-between py-1.5 mb-2 border-t-2 border-b-2 border-yellow-300">
        <span className="text-[10px] font-black text-gray-600 uppercase tracking-wider">
          {t('total')}
        </span>
        <span className="text-base font-black text-orange-700 tabular-nums">
          {formatYen(order.total_amount)}
        </span>
      </div>

      <button
        onClick={() => onReady(order)}
        className="w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-500 text-white font-black text-xs transition-colors active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-sm shrink-0"
      >
        <CheckCircle2 className="w-4 h-4" />
        {t('markReady')}
      </button>
    </div>
  );
}