import { useEffect, useState } from 'react';
import { AlertCircle, Bell, Pencil } from 'lucide-react';
import { subscribeOrders } from '@/lib/localStore';
import { splitOrders } from '@/services/kitchen';
import { useI18n } from '@/locale';
import type { Order } from '@/types/database';

const URGENT_MIN = 5;
const MODIFIED_FRESH_MS = 60_000;

export function KitchenAlerts() {
  const { t } = useI18n();
  const [orders, setOrders] = useState<Order[]>([]);
  const [, force] = useState(0);

  useEffect(() => {
    const unsub = subscribeOrders(setOrders);
    const id = window.setInterval(() => force((x) => x + 1), 5_000);
    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, []);

  const now = Date.now();
  const { kitchen } = splitOrders(orders);

  const urgent = kitchen.filter(
    (o) => now - new Date(o.created_at).getTime() > URGENT_MIN * 60_000
  );
  const fresh = kitchen.filter(
    (o) => now - new Date(o.created_at).getTime() <= URGENT_MIN * 60_000
  );
  const modified = orders.filter(
    (o) =>
      o.is_modified &&
      o.status !== 'COMPLETED' &&
      o.status !== 'CANCELLED' &&
      now - new Date(o.updated_at).getTime() <= MODIFIED_FRESH_MS
  );

  if (!urgent.length && !fresh.length && !modified.length) return null;

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {urgent.length > 0 && (
        <span
          className="animate-kpulse-urgent inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-600 text-white text-[11px] font-black shadow-md"
          title={t('urgencyCritical')}
        >
          <AlertCircle className="w-3.5 h-3.5" />
          {t('urgencyCritical')} · {urgent.length}
        </span>
      )}
      {fresh.length > 0 && (
        <span
          className="animate-kpulse-soft inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-600 text-white text-[11px] font-black shadow-md"
          title={t('newOrderBadge')}
        >
          <Bell className="w-3.5 h-3.5" />
          {t('newOrderBadge')} · {fresh.length}
        </span>
      )}
      {modified.length > 0 && (
        <span
          className="animate-kpulse-amber inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500 text-white text-[11px] font-black shadow-md"
          title={t('modified')}
        >
          <Pencil className="w-3.5 h-3.5" />
          {t('modified')} · {modified.length}
        </span>
      )}
    </div>
  );
}
