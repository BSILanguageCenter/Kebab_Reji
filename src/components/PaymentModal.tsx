// src/components/PaymentModal.tsx
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { formatYen } from '@/lib/format';
import { X, Banknote, CreditCard, Wallet, CheckCircle } from 'lucide-react';
import type { PaymentMethod, Order, OrderItem } from '@/lib/types';
import { LocalPrinterService } from '@/lib/LocalPrinterService';

interface CartItem {
  product_id: string;
  name_ru: string;
  name_ja: string;
  unit_price: number;
  quantity: number;
  note: string;
  modifiers?: string[];
  kitchen_station_id: string | null;
}

interface Props {
  total: number;
  onClose: () => void;
  onPaid?: () => void;

  /** Режим 1 — создать новый заказ (из POS) */
  cart?: CartItem[];
  orderType?: 'dine_in' | 'takeaway';
  tableId?: string | null;
  customerNote?: string;

  /** Режим 2 — оплатить уже существующий заказ (со страницы Заказы) */
  existingOrderId?: string | null;
  /** Существующий заказ — для печати чека */
  existingOrder?: Order | null;
}

export default function PaymentModal({
  total,
  onClose,
  onPaid,
  cart,
  orderType,
  tableId,
  customerNote,
  existingOrderId,
  existingOrder,
}: Props) {
  const { t, lang } = useI18n();
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [received, setReceived] = useState('');
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);

  const receivedNum = parseInt(received) || 0;
  const change = method === 'cash' ? Math.max(0, receivedNum - total) : 0;
  const canConfirm = method !== 'cash' || receivedNum >= total;

  const quickAmounts = [total, total + 100, total + 500, total + 1000];

  const handlePayment = async () => {
    if (!canConfirm || processing) return;
    setProcessing(true);
    try {
      let orderId = existingOrderId || null;
      const isNew = !existingOrderId;
      let orderForPrint: Order | null = null;

      // ─── Создать новый заказ (режим POS) ────────────────────────────────
      if (isNew) {
        const { data: orderData, error: orderError } = await supabase
          .from('orders')
          .insert({
            order_type: orderType,
            table_id: orderType === 'dine_in' ? tableId ?? null : null,
            status: 'completed',
            subtotal: total,
            total,
            customer_note: customerNote || null,
            completed_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (orderError) throw orderError;
        orderId = (orderData as { id: string }).id;

        const items = (cart || []).map((c) => ({
          order_id: orderId,
          product_id: c.product_id,
          product_name_ru: c.name_ru,
          product_name_ja: c.name_ja,
          quantity: c.quantity,
          unit_price: c.unit_price,
          total_price: c.unit_price * c.quantity,
          note: c.note || null,
          kitchen_station_id: c.kitchen_station_id,
          status: 'completed',
        }));

        const { error: itemsError } = await supabase
          .from('order_items')
          .insert(items);
        if (itemsError) throw itemsError;

        // Собираем объект заказа для печати
        const od = orderData as {
          id: string;
          order_number: number;
          created_at: string;
        };

        let tableObj = null;
        if (orderType === 'dine_in' && tableId) {
          const { data: tbl } = await supabase
            .from('restaurant_tables')
            .select('*')
            .eq('id', tableId)
            .maybeSingle();
          tableObj = tbl ?? null;
        }

        orderForPrint = {
          id: od.id,
          order_number: od.order_number,
          table_id: orderType === 'dine_in' ? tableId ?? null : null,
          order_type: orderType ?? 'takeaway',
          status: 'completed',
          subtotal: total,
          discount: 0,
          total,
          cashier_id: null,
          customer_note: customerNote || null,
          created_at: od.created_at,
          sent_to_kitchen_at: null,
          cooking_started_at: null,
          ready_at: null,
          completed_at: new Date().toISOString(),
          order_items: (cart || []).map((c, i): OrderItem => ({
            id: `temp-${i}`,
            order_id: od.id,
            product_id: c.product_id,
            product_name_ru: c.name_ru,
            product_name_ja: c.name_ja,
            quantity: c.quantity,
            unit_price: c.unit_price,
            total_price: c.unit_price * c.quantity,
            note: c.note || null,
            kitchen_station_id: c.kitchen_station_id,
            status: 'completed',
            is_ready_product: false,
            created_at: od.created_at,
          })),
          table: tableObj,
        };
      } else {
        // ─── Оплата существующего заказа ──────────────────────────────────
        await supabase
          .from('orders')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', existingOrderId);

        await supabase
          .from('order_items')
          .update({ status: 'completed' })
          .eq('order_id', existingOrderId);

        // Для печати — либо переданный заказ, либо загружаем из БД
        if (existingOrder) {
          orderForPrint = { ...existingOrder, status: 'completed' };
        } else if (existingOrderId) {
          const { data } = await supabase
            .from('orders')
            .select('*, order_items(*)')
            .eq('id', existingOrderId)
            .maybeSingle();
          if (data) orderForPrint = data as Order;
        }
      }

      // ─── Запись об оплате ────────────────────────────────────────────────
      await supabase.from('payments').insert({
        order_id: orderId,
        amount: total,
        method,
        received_amount: method === 'cash' ? receivedNum : total,
        change_amount: change,
      });

      // ─── Освободить стол ────────────────────────────────────────────────
      if (orderType === 'dine_in' && tableId) {
        await supabase
          .from('restaurant_tables')
          .update({ status: 'free' })
          .eq('id', tableId);
      }

      // ─── ПЕЧАТЬ ЧЕКА КЛИЕНТУ ────────────────────────────────────────────
      if (orderForPrint) {
        try {
          await LocalPrinterService.printReceipt(orderForPrint, lang);
        } catch (printErr) {
          console.error('Ошибка печати чека:', printErr);
          // Не блокируем оплату, если чек не напечатался
        }
      }

      setSuccess(true);
      setTimeout(() => {
        onPaid?.();
        onClose();
      }, 1500);
    } catch (err) {
      console.error('Payment failed:', err);
      alert('Error: ' + (err as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  if (success) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
        <div className="flex flex-col items-center gap-4 rounded-3xl bg-white p-12 shadow-2xl">
          <CheckCircle size={64} className="text-green-500" />
          <p className="text-xl font-bold text-gray-900">
            {t('payment.success')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-md flex-col rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            {t('payment.title')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
          >
            <X size={24} />
          </button>
        </div>

        {/* Total */}
        <div className="mb-6 rounded-2xl bg-gray-50 p-5 text-center">
          <p className="text-sm text-gray-500">{t('payment.total')}</p>
          <p className="text-4xl font-bold text-orange-600">
            {formatYen(total)}
          </p>
        </div>

        {/* Method */}
        <p className="mb-2 text-sm font-semibold text-gray-700">
          {t('payment.method')}
        </p>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {(
            [
              { key: 'cash', icon: Banknote, label: t('payment.cash') },
              { key: 'card', icon: CreditCard, label: t('payment.card') },
              { key: 'other', icon: Wallet, label: t('payment.other') },
            ] as const
          ).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setMethod(key)}
              className={`flex flex-col items-center gap-1 rounded-xl border-2 py-4 transition-all ${
                method === key
                  ? 'border-orange-500 bg-orange-50 text-orange-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <Icon size={24} />
              <span className="text-sm font-semibold">{label}</span>
            </button>
          ))}
        </div>

        {/* Cash input */}
        {method === 'cash' && (
          <>
            <p className="mb-2 text-sm font-semibold text-gray-700">
              {t('payment.received')}
            </p>
            <input
              type="number"
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              placeholder="0"
              className="mb-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-right text-2xl font-bold"
            />
            <div className="mb-4 flex gap-2">
              {quickAmounts.map((amt, i) => (
                <button
                  key={i}
                  onClick={() => setReceived(String(amt))}
                  className="flex-1 rounded-xl bg-gray-100 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
                >
                  {formatYen(amt)}
                </button>
              ))}
            </div>
            <div className="mb-4 flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
              <span className="text-sm text-gray-500">
                {t('payment.change')}
              </span>
              <span className="text-xl font-bold text-green-600">
                {formatYen(change)}
              </span>
            </div>
            {!canConfirm && (
              <p className="mb-4 text-center text-sm text-red-500">
                {t('payment.insufficient')}
              </p>
            )}
          </>
        )}

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="h-12 flex-1 rounded-xl bg-gray-100 font-semibold text-gray-600 hover:bg-gray-200"
          >
            {t('payment.cancel')}
          </button>
          <button
            onClick={handlePayment}
            disabled={!canConfirm || processing}
            className="h-12 flex-[2] rounded-xl bg-green-600 font-bold text-white hover:bg-green-700 disabled:opacity-40"
          >
            {t('payment.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}