import { useReadyOrders } from '@/hooks/useReadyOrders';
import { useI18n } from '@/lib/i18n';
import { CheckCircle, X } from 'lucide-react';

export default function ReadyNotifications() {
  const { t, lang } = useI18n();
  const { readyOrders, dismiss } = useReadyOrders();

  if (readyOrders.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {readyOrders.map((r) => (
        <div
          key={r.orderNumber}
          className="flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 px-5 py-4 shadow-lg shadow-green-600/10"
        >
          <CheckCircle size={28} className="text-green-600" />
          <p className="text-base font-semibold text-green-800">
            {lang === 'ru'
              ? `Заказ #${r.orderNumber} ${t('notif.ready')}`
              : `注文 #${r.orderNumber} ${t('notif.ready')}`}
          </p>
          <button
            onClick={() => dismiss(r.orderNumber)}
            className="ml-2 rounded-lg p-1 text-green-600 hover:bg-green-100"
          >
            <X size={20} />
          </button>
        </div>
      ))}
    </div>
  );
}
