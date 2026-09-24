import { useState, useEffect, useMemo } from 'react';
import { formatTimeAgo } from '@/locale/format';
import { splitOrders, KITCHEN_LIMIT } from '@/services/kitchen';
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
  Hourglass,
  CheckCircle2,
  Flame,
  ChefHat,
  Undo2,
} from 'lucide-react';

export default function QueuePage() {
  const { t, lang } = useI18n();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingUndo, setPendingUndo] = useState<UndoRecord | null>(null);

  const undoStack = useUndoStack('queue');

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

  const { kitchen, waiting, ready } = splitOrders(orders);

  // ============================================================
  // Последний приготовленный заказ для правой панели
  // Приоритет:
  //   1. Самый новый READY (по updated_at)
  //   2. Если READY пусто — самый новый PREPARING (по updated_at)
  //   3. Если совсем пусто — null
  // ============================================================
  const focusOrder = useMemo(() => {
    if (ready.length > 0) {
      return [...ready].sort(
        (a, b) =>
          new Date(b.updated_at).getTime() -
          new Date(a.updated_at).getTime()
      )[0];
    }
    if (kitchen.length > 0) {
      return [...kitchen].sort(
        (a, b) =>
          new Date(b.updated_at).getTime() -
          new Date(a.updated_at).getTime()
      )[0];
    }
    return null;
  }, [ready, kitchen]);

  const handleIssue = async (order: Order) => {
    pushUndo('queue', {
      kind: 'status',
      orderId: order.id,
      orderNumber: order.order_number,
      fromStatus: order.status,
      toStatus: 'COMPLETED',
      timestamp: Date.now(),
    });

    setOrders((prev) => prev.filter((o) => o.id !== order.id));

    try {
      await emitUpdateStatus(order.id, 'COMPLETED');
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
    const rec = popUndo('queue');
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

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100">
      <PageActions forRole="queue">
        <span className="text-[10px] text-gray-400 font-mono">
          {lang === 'ru'
            ? `Кухня: макс ${KITCHEN_LIMIT}`
            : `Kitchen: max ${KITCHEN_LIMIT}`}
        </span>
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

      {error && (
        <div className="mx-3 mt-2 p-2 bg-red-50 border border-red-300 rounded-lg text-red-700 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-3 p-3">
          <div className="grid grid-rows-3 gap-3 min-h-0">
            <CompactBlock
              variant="waiting"
              title={t('columnNew')}
              icon={<Hourglass className="w-5 h-5" />}
              count={waiting.length}
              size="large"
            >
              {waiting.map((order) => (
                <MiniCard
                  key={order.id}
                  order={order}
                  lang={lang}
                  variant="waiting"
                  size="large"
                />
              ))}
            </CompactBlock>

            <CompactBlock
              variant="cooking"
              title={t('columnPreparing')}
              icon={<ChefHat className="w-5 h-5" />}
              count={kitchen.length}
              size="small"
            >
              {kitchen.map((order) => (
                <MiniCard
                  key={order.id}
                  order={order}
                  lang={lang}
                  variant="cooking"
                  size="small"
                />
              ))}
            </CompactBlock>

            <CompactBlock
              variant="ready"
              title={t('columnReady')}
              icon={<CheckCircle2 className="w-5 h-5" />}
              count={ready.length}
              size="small"
            >
              {ready.map((order) => (
                <MiniCard
                  key={order.id}
                  order={order}
                  lang={lang}
                  variant="ready"
                  size="small"
                  action={{ onClick: () => handleIssue(order) }}
                />
              ))}
            </CompactBlock>
          </div>

          <BigFocus order={focusOrder} lang={lang} t={t} />
        </div>
      )}

      <ConfirmDialog
        open={pendingUndo !== null}
        title={t('confirmTitle')}
        message={
          pendingUndo
            ? t('confirmUndo')
                .replace('{n}', String(pendingUndo.orderNumber))
                .replace(
                  '{status}',
                  statusLabel(pendingUndo.fromStatus ?? 'READY')
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
// COMPACT BLOCK
// ============================================================
type Variant = 'waiting' | 'cooking' | 'ready';
type Size = 'large' | 'small';

function CompactBlock({
  variant,
  title,
  icon,
  count,
  size,
  children,
}: {
  variant: Variant;
  title: string;
  icon: React.ReactNode;
  count: number;
  size: Size;
  children: React.ReactNode;
}) {
  const styles: Record<
    Variant,
    {
      outer: string;
      header: string;
      icon: string;
      title: string;
      badge: string;
      dot: string;
    }
  > = {
    waiting: {
      outer: 'border-gray-300 shadow-gray-300/50',
      header: 'bg-gradient-to-r from-gray-100 to-gray-200',
      icon: 'text-gray-600',
      title: 'text-gray-900',
      badge: 'bg-gray-300 text-gray-900',
      dot: 'bg-gray-500',
    },
    cooking: {
      outer: 'border-yellow-400 shadow-yellow-300/60',
      header: 'bg-gradient-to-r from-yellow-100 to-amber-200',
      icon: 'text-yellow-700',
      title: 'text-yellow-900',
      badge: 'bg-yellow-400 text-yellow-900',
      dot: 'bg-yellow-500 animate-pulse',
    },
    ready: {
      outer: 'border-green-400 shadow-green-300/60',
      header: 'bg-gradient-to-r from-green-100 to-emerald-200',
      icon: 'text-green-700',
      title: 'text-green-900',
      badge: 'bg-green-400 text-green-900',
      dot: 'bg-green-500',
    },
  };
  const s = styles[variant];

  const gridCols =
    size === 'large'
      ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
      : 'grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8';

  return (
    <div
      className={`rounded-2xl border-2 ${s.outer} bg-white shadow-md flex flex-col min-h-0 overflow-hidden`}
    >
      <div
        className={`flex items-center gap-2.5 px-4 py-2.5 border-b-2 ${s.header} shrink-0`}
      >
        <div className={`w-3 h-3 rounded-full ${s.dot}`} />
        <span className={s.icon}>{icon}</span>
        <span
          className={`text-xl font-black uppercase tracking-wider ${s.title}`}
        >
          {title}
        </span>
        <span
          className={`ml-auto text-lg font-black px-3 py-0.5 rounded-full ${s.badge}`}
        >
          {count}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {count === 0 ? (
          <p className="text-sm text-gray-400 text-center py-3 font-medium">
            —
          </p>
        ) : (
          <div className={`grid ${gridCols} gap-1.5`}>{children}</div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// MINI CARD
// ============================================================
function MiniCard({
  order,
  lang,
  variant,
  size,
  action,
}: {
  order: Order;
  lang: Lang;
  variant: Variant;
  size: Size;
  action?: { onClick: () => void };
}) {
  const styles: Record<
    Variant,
    { card: string; number: string; time: string; border: string }
  > = {
    waiting: {
      card: 'bg-gray-50',
      number: 'text-gray-900',
      time: 'text-gray-500',
      border: 'border-gray-300',
    },
    cooking: {
      card: 'bg-yellow-50',
      number: 'text-yellow-800',
      time: 'text-yellow-700',
      border: 'border-yellow-300',
    },
    ready: {
      card: 'bg-green-50',
      number: 'text-green-800',
      time: 'text-green-700',
      border: 'border-green-300',
    },
  };
  const s = styles[variant];

  const numberClass =
    size === 'large' ? 'text-4xl lg:text-5xl' : 'text-xl lg:text-2xl';
  const timeClass = size === 'large' ? 'text-xs' : 'text-[10px]';
  const padding = size === 'large' ? 'px-3 py-2.5' : 'px-2 py-1.5';
  const radius = size === 'large' ? 'rounded-xl' : 'rounded-lg';

  const isClickable = Boolean(action);

  return (
    <div
      onClick={action?.onClick}
      className={`relative border ${s.border} ${s.card} ${padding} ${radius} flex flex-col items-center justify-center transition-all shadow-sm min-h-0 ${
        isClickable
          ? 'cursor-pointer hover:bg-green-100 hover:border-green-500 hover:shadow-md active:scale-95 select-none'
          : ''
      }`}
    >
      <span
        className={`font-black tabular-nums leading-none ${numberClass} ${s.number}`}
      >
        {order.order_number}
      </span>

      <span
        className={`font-semibold mt-1 leading-tight ${timeClass} ${s.time}`}
      >
        {formatTimeAgo(order.created_at, lang)}
      </span>

      {action && (
        <span
          className={`absolute top-0.5 right-0.5 rounded-full bg-green-600 text-white flex items-center justify-center shadow-sm ${
            size === 'large' ? 'w-4 h-4' : 'w-3 h-3'
          }`}
        >
          <CheckCircle2
            className={size === 'large' ? 'w-3 h-3' : 'w-2.5 h-2.5'}
          />
        </span>
      )}
    </div>
  );
}

// ============================================================
// BIG FOCUS
// ============================================================
function BigFocus({
  order,
  lang,
  t,
}: {
  order: Order | null;
  lang: Lang;
  t: (key: TranslationKey) => string;
}) {
  if (!order) {
    return (
      <div className="rounded-2xl border-2 border-gray-200 bg-white flex flex-col items-center justify-center shadow-md">
        <p className="text-sm uppercase tracking-[0.3em] text-gray-300 font-bold mb-4">
          {t('queue')}
        </p>
        <p className="text-[140px] leading-none font-black text-gray-200 tabular-nums select-none">
          —
        </p>
      </div>
    );
  }

  const isReady = order.status === 'READY';
  const statusLabel = isReady ? t('columnReady') : t('columnPreparing');
  const statusColor = isReady
    ? 'text-green-700 bg-green-50 border-green-400'
    : 'text-yellow-800 bg-yellow-50 border-yellow-400';
  const numberColor = isReady ? 'text-green-600' : 'text-yellow-600';
  const borderColor = isReady ? 'border-green-400' : 'border-yellow-400';

  return (
    <div
      className={`rounded-2xl border-4 ${borderColor} bg-gradient-to-br from-white to-slate-50 flex flex-col items-center justify-center shadow-lg relative overflow-hidden`}
    >
      <div className="absolute top-6 left-0 right-0 flex justify-center">
        <div
          className={`flex items-center gap-2 px-5 py-2 rounded-full border-2 font-black uppercase tracking-widest text-base shadow-sm ${statusColor}`}
        >
          {isReady ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : (
            <Flame className="w-5 h-5" />
          )}
          {statusLabel}
        </div>
      </div>

      <div
        className={`text-[140px] xl:text-[180px] leading-none font-black tabular-nums select-none ${numberColor}`}
      >
        {order.order_number}
      </div>

      <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-3">
        <span
          className={`text-sm px-4 py-1.5 rounded-full font-black uppercase tracking-wider shadow-sm ${
            order.order_type === 'INSIDE'
              ? 'bg-blue-100 text-blue-700'
              : 'bg-purple-100 text-purple-700'
          }`}
        >
          {order.order_type === 'INSIDE'
            ? t('orderTypeInside')
            : t('orderTypeOutside')}
        </span>
        <span className="text-sm px-4 py-1.5 rounded-full font-bold bg-gray-100 text-gray-600 shadow-sm">
          {formatTimeAgo(order.created_at, lang)}
        </span>
      </div>
    </div>
  );
}