import { AlertCircle, Bell, Pencil } from 'lucide-react';
import { useI18n } from '@/locale';
import type { Order } from '@/types/database';

const URGENT_MIN = 5;
const MODIFIED_FRESH_MS = 60_000;

export function KitchenStatusBadge({ order }: { order: Order }) {
  const { t } = useI18n();
  const now = Date.now();
  const mins = Math.floor(
    (now - new Date(order.created_at).getTime()) / 60_000
  );

  const isModified =
    order.is_modified &&
    order.status !== 'COMPLETED' &&
    order.status !== 'CANCELLED' &&
    now - new Date(order.updated_at).getTime() <= MODIFIED_FRESH_MS;

  // Приоритет: Изменён > Срочно > Новый
  if (isModified) {
    return (
      <span className="animate-kpulse-amber inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-500 text-white text-[10px] font-black uppercase tracking-wide leading-none">
        <Pencil className="w-2.5 h-2.5" />
        {t('modified')}
      </span>
    );
  }
  if (mins >= URGENT_MIN) {
    return (
      <span className="animate-kpulse-urgent inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-red-600 text-white text-[10px] font-black uppercase tracking-wide leading-none">
        <AlertCircle className="w-2.5 h-2.5" />
        {t('urgencyCritical')} {mins}м
      </span>
    );
  }
  if (order.status === 'NEW') {
    return (
      <span className="animate-kpulse-soft inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-blue-600 text-white text-[10px] font-black uppercase tracking-wide leading-none">
        <Bell className="w-2.5 h-2.5" />
        {t('urgencyFresh')}
      </span>
    );
  }
  return null;
}
