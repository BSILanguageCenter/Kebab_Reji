// src/components/OrderDetailModal.tsx
import { useState } from 'react';
import type { Order, Payment } from '@/lib/types';
import { useI18n } from '@/lib/i18n';
import { formatYen, formatTime, formatDate, statusColors } from '@/lib/format';
import { X, CreditCard, CheckCircle } from 'lucide-react';
import PaymentModal from '@/components/PaymentModal';

interface Props {
  order: Order;
  payment: Payment | null;
  onClose: () => void;
  onPaid?: () => void;
}

export default function OrderDetailModal({
  order,
  payment,
  onClose,
  onPaid,
}: Props) {
  const { t, lang } = useI18n();
  const [showPayment, setShowPayment] = useState(false);

  const items = order.order_items ?? [];

  const handlePaid = () => {
    setShowPayment(false);
    onPaid?.();
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 p-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                #{order.order_number}
              </h2>
              <p className="text-sm text-gray-500">
                {formatDate(order.created_at, lang)} ·{' '}
                {formatTime(order.created_at, lang)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
            >
              <X size={24} />
            </button>
          </div>

          {/* Status */}
          <div className="flex flex-wrap gap-2 border-b border-gray-100 px-6 py-3">
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                statusColors[order.status]
              }`}
            >
              {t(`status.${order.status}`)}
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
              {t(`orderType.${order.order_type}`)}
            </span>
            {order.table && (
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                {order.table.name}
              </span>
            )}
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex flex-col gap-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between rounded-xl bg-gray-50 px-3 py-2"
                >
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900">
                      {lang === 'ru'
                        ? item.product_name_ru
                        : item.product_name_ja}
                    </p>
                    {item.note && (
                      <p className="mt-0.5 text-xs font-semibold uppercase text-orange-600">
                        {item.note}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-gray-500">
                      {formatYen(item.unit_price)} × {item.quantity}
                    </p>
                  </div>
                  <span className="ml-2 text-sm font-bold text-gray-700">
                    {formatYen(item.total_price)}
                  </span>
                </div>
              ))}
            </div>

            {order.customer_note && (
              <div className="mt-4 rounded-xl bg-yellow-50 p-3">
                <p className="text-xs font-semibold text-gray-500">
                  {t('orders.customerNote')}:
                </p>
                <p className="text-sm text-gray-700">{order.customer_note}</p>
              </div>
            )}
          </div>

          {/* Total */}
          <div className="border-t border-gray-100 px-6 py-4">
            <div className="flex justify-between text-lg font-bold text-gray-900">
              <span>{t('pos.total')}</span>
              <span className="text-orange-600">{formatYen(order.total)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="border-t border-gray-100 p-6 pt-4">
            {payment ? (
              <div className="flex items-center gap-3 rounded-xl bg-green-50 p-3">
                <CheckCircle size={20} className="text-green-600" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-green-700">
                    {t('payment.title')}: {t(`payment.${payment.method}`)}
                  </p>
                  <p className="text-xs text-green-600">
                    {formatYen(payment.amount)}
                  </p>
                </div>
              </div>
            ) : order.status !== 'cancelled' ? (
              <button
                onClick={() => setShowPayment(true)}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-600 font-bold text-white hover:bg-green-700"
              >
                <CreditCard size={20} />
                Оплатить
              </button>
            ) : (
              <p className="text-center text-sm text-gray-500">
                {t('status.cancelled')}
              </p>
            )}
          </div>
        </div>
      </div>

      {showPayment && (
        <PaymentModal
          total={order.total}
          existingOrderId={order.id}
          existingOrder={order}
          tableId={order.table_id}
          orderType={order.order_type}
          onClose={() => setShowPayment(false)}
          onPaid={handlePaid}
        />
      )}
    </>
  );
}