// src/pages/POSPage.tsx
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import type { Category, Product, RestaurantTable, Order } from '@/lib/types';
import { formatYen } from '@/lib/format';
import {
  Flame,
  Beef,
  Salad,
  Soup,
  CupSoda,
  Croissant,
  Cake,
  UtensilsCrossed,
  X,
  Plus,
  Minus,
  Trash2,
  Send,
  CreditCard,
  Eraser,
  Package,
  Armchair,
  Check,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import PaymentModal from '@/components/PaymentModal';
import { LocalPrinterService as PrinterService } from '@/lib/LocalPrinterService';
import { loadMenu, refreshTablesInCache } from '@/lib/menuCache';
import { useSyncEvent, notifyChange } from '@/hooks/useSync';

const iconMap: Record<string, LucideIcon> = {
  Flame, Beef, Salad, Soup, CupSoda, Croissant, Cake, UtensilsCrossed,
};

interface CartItem {
  product_id: string;
  name_ru: string;
  name_ja: string;
  unit_price: number;
  quantity: number;
  note: string;
  modifiers: string[];
  is_ready_product: boolean;
  kitchen_station_id: string | null;
}

export default function POSPage() {
  const { t, lang } = useI18n();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway'>('dine_in');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [customerNote, setCustomerNote] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);
  const [showTablePicker, setShowTablePicker] = useState(false);

  // Загрузка меню
  useEffect(() => {
    loadMenu().then(({ categories, products, tables }) => {
      setCategories(categories);
      setProducts(products);
      setTables(tables);
      if (categories.length > 0) setActiveCategory(categories[0].id);
    });
  }, []);

  // Синхронизация: меню и столы изменились на другом устройстве
  useSyncEvent(['menu-changed', 'tables-changed'], () => {
    loadMenu(true).then(({ categories, products, tables }) => {
      setCategories(categories);
      setProducts(products);
      setTables(tables);
    });
  });

  const filteredProducts = products.filter(
    (p) => p.category_id === activeCategory
  );

  const cartKey = (c: {
    product_id: string;
    modifiers: string[];
    note: string;
  }) => c.product_id + '|' + [...c.modifiers].sort().join(',') + '|' + c.note;

  const addToCart = useCallback(
    (product: Product, modifiers: string[] = []) => {
      const isReady = product.is_ready_product === true;
      setCart((prev) => {
        const wantKey = product.id + '|' + [...modifiers].sort().join(',') + '|';
        const existing = prev.find((c) => cartKey(c) === wantKey);
        if (existing) {
          return prev.map((c) =>
            cartKey(c) === wantKey ? { ...c, quantity: c.quantity + 1 } : c
          );
        }
        return [
          ...prev,
          {
            product_id: product.id,
            name_ru: product.name_ru,
            name_ja: product.name_ja,
            unit_price: product.price,
            quantity: 1,
            note: '',
            modifiers,
            is_ready_product: isReady,
            kitchen_station_id: isReady ? null : product.kitchen_station_id,
          },
        ];
      });
    },
    []
  );

  const handleProductClick = (product: Product) => {
    const avail = product.available_modifiers || [];
    if (avail.length > 0) {
      setModifierProduct(product);
    } else {
      addToCart(product, []);
    }
  };

  const updateQty = (index: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((c, i) =>
          i === index ? { ...c, quantity: c.quantity + delta } : c
        )
        .filter((c) => c.quantity > 0)
    );
  };

  const setItemNote = (index: number, note: string) => {
    setCart((prev) => prev.map((c, i) => (i === index ? { ...c, note } : c)));
  };

  const removeItem = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  const clearCart = () => {
    if (cart.length === 0) return;
    if (confirm(t('pos.clearConfirm'))) {
      setCart([]);
      setCustomerNote('');
    }
  };

  const subtotal = cart.reduce(
    (sum, c) => sum + c.unit_price * c.quantity,
    0
  );

  const selectedTableObj = tables.find((tb) => tb.id === selectedTable) || null;

  const sendToKitchen = async () => {
    if (cart.length === 0 || sending) return;
    setSending(true);
    try {
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert({
          order_type: orderType,
          table_id: orderType === 'dine_in' ? selectedTable : null,
          status: 'new',
          subtotal,
          total: subtotal,
          customer_note: customerNote || null,
        })
        .select()
        .single();

      if (orderError) throw orderError;
      const order = orderData as {
        id: string;
        order_number: number;
        created_at: string;
      };

      const items = cart.map((c) => {
        const modLine = c.modifiers.length ? c.modifiers.join(', ') : '';
        const noteCombined =
          [modLine, c.note].filter(Boolean).join(' | ') || null;

        return {
          order_id: order.id,
          product_id: c.product_id,
          product_name_ru: c.name_ru,
          product_name_ja: c.name_ja,
          quantity: c.quantity,
          unit_price: c.unit_price,
          total_price: c.unit_price * c.quantity,
          note: noteCombined,
          kitchen_station_id: c.is_ready_product ? null : c.kitchen_station_id,
          is_ready_product: c.is_ready_product,
          status: c.is_ready_product ? 'completed' : 'new',
        };
      });

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(items);
      if (itemsError) throw itemsError;

      const tasks: PromiseLike<unknown>[] = [
        supabase
          .from('orders')
          .update({ sent_to_kitchen_at: new Date().toISOString() })
          .eq('id', order.id),
      ];
      if (orderType === 'dine_in' && selectedTable) {
        tasks.push(
          supabase
            .from('restaurant_tables')
            .update({ status: 'occupied' })
            .eq('id', selectedTable)
        );
      }
      await Promise.all(tasks);

      const kitchenItems = items.filter((it) => !it.is_ready_product);

      if (kitchenItems.length > 0) {
        const table = selectedTable
          ? tables.find((tb) => tb.id === selectedTable) ?? null
          : null;

        const orderForPrint: Order = {
          id: order.id,
          order_number: order.order_number,
          table_id: orderType === 'dine_in' ? selectedTable : null,
          order_type: orderType,
          status: 'new',
          subtotal,
          discount: 0,
          total: subtotal,
          cashier_id: null,
          customer_note: customerNote || null,
          created_at: order.created_at,
          sent_to_kitchen_at: null,
          cooking_started_at: null,
          ready_at: null,
          completed_at: null,
          order_items: kitchenItems.map((it, i) => ({
            id: `temp-${i}`,
            order_id: order.id,
            product_id: it.product_id,
            product_name_ru: it.product_name_ru,
            product_name_ja: it.product_name_ja,
            quantity: it.quantity,
            unit_price: it.unit_price,
            total_price: it.total_price,
            note: it.note,
            kitchen_station_id: it.kitchen_station_id,
            status: 'new',
            is_ready_product: false,
            created_at: order.created_at,
          })),
          table,
        };

        try {
          await PrinterService.printKitchenTicket(orderForPrint, lang);
          setToast(t('pos.sent') + ' · тикет напечатан');
        } catch (printErr) {
          console.error('Ошибка печати:', printErr);
          setToast(t('pos.sent') + ' · ошибка печати');
        }
      } else {
        setToast(t('pos.sent'));
      }

      if (orderType === 'dine_in' && selectedTable) {
        setTables((prev) =>
          prev.map((tb) =>
            tb.id === selectedTable ? { ...tb, status: 'occupied' } : tb
          )
        );
        refreshTablesInCache().catch(() => {});
      }

      // ─── Сообщаем всем устройствам ────────────────────────────────────
      notifyChange('orders-changed');
      notifyChange('tables-changed');

      setTimeout(() => setToast(null), 3000);
      setCart([]);
      setCustomerNote('');
    } catch (err) {
      console.error('Failed to send order:', err);
      alert('Error: ' + (err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const quickNotes = [
    t('pos.quickNotes'),
    t('pos.quickNotesSpicy'),
    t('pos.quickNotesNoSauce'),
  ];

  return (
    <div className="flex h-full gap-3 p-3 lg:gap-4 lg:p-4">
      {/* Категории */}
      <div className="flex w-24 shrink-0 flex-col gap-2 overflow-y-auto lg:w-40">
        {categories.map((cat) => {
          const Icon = iconMap[cat.icon] || UtensilsCrossed;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 px-2 py-4 transition-all active:scale-95 lg:p-4 ${
                activeCategory === cat.id
                  ? 'border-orange-500 bg-orange-50 text-orange-700'
                  : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              <Icon size={28} />
              <span className="text-center text-xs font-semibold leading-tight lg:text-sm">
                {lang === 'ru' ? cat.name_ru : cat.name_ja}
              </span>
            </button>
          );
        })}
      </div>

      {/* Товары */}
      <div className="flex-1 overflow-y-auto">
        {filteredProducts.length === 0 ? (
          <div className="flex h-full items-center justify-center text-gray-400">
            {t('pos.noProducts')}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {filteredProducts.map((product) => {
              const avail = product.available_modifiers || [];
              const isReady = product.is_ready_product === true;
              return (
                <button
                  key={product.id}
                  disabled={!product.is_available}
                  onClick={() => handleProductClick(product)}
                  className={`relative flex min-h-[160px] flex-col rounded-2xl border-2 p-4 text-left transition-all active:scale-95 ${
                    product.is_available
                      ? 'border-gray-200 bg-white'
                      : 'border-gray-200 bg-gray-50 opacity-50'
                  }`}
                >
                  {isReady && (
                    <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                      <Package size={10} />
                      Готовый
                    </span>
                  )}

                  <div className="mb-3 flex h-24 items-center justify-center rounded-xl bg-gray-50">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt=""
                        loading="lazy"
                        className="h-full w-full rounded-xl object-cover"
                      />
                    ) : (
                      <UtensilsCrossed size={36} className="text-gray-300" />
                    )}
                  </div>
                  <p className="text-base font-bold leading-tight text-gray-900">
                    {lang === 'ru' ? product.name_ru : product.name_ja}
                  </p>
                  {avail.length > 0 && (
                    <p className="mt-1 text-xs font-semibold text-orange-500">
                      {avail.length} свойства
                    </p>
                  )}
                  <div className="mt-1 flex items-center justify-between">
                    <p className="text-lg font-bold text-orange-600">
                      {formatYen(product.price)}
                    </p>
                    {!product.is_available && (
                      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500">
                        {t('menu.unavailable')}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Корзина */}
      <div className="flex w-[340px] shrink-0 flex-col rounded-2xl border border-gray-200 bg-white lg:w-96">
        <div className="flex gap-2 border-b border-gray-100 p-3">
          <button
            onClick={() => setOrderType('dine_in')}
            className={`flex-1 rounded-xl py-3.5 text-sm font-semibold transition-all active:scale-95 ${
              orderType === 'dine_in'
                ? 'bg-orange-600 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {t('pos.dineIn')}
          </button>
          <button
            onClick={() => setOrderType('takeaway')}
            className={`flex-1 rounded-xl py-3.5 text-sm font-semibold transition-all active:scale-95 ${
              orderType === 'takeaway'
                ? 'bg-orange-600 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {t('pos.takeaway')}
          </button>
        </div>

        {orderType === 'dine_in' && (
          <div className="border-b border-gray-100 p-3">
            <button
              onClick={() => setShowTablePicker(true)}
              className={`group flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition-all active:scale-[0.98] ${
                selectedTableObj
                  ? 'border-orange-300 bg-orange-50'
                  : 'border-dashed border-gray-300 bg-gray-50 hover:border-orange-300 hover:bg-orange-50'
              }`}
            >
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                  selectedTableObj
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                <Armchair size={22} />
              </div>

              <div className="min-w-0 flex-1">
                {selectedTableObj ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">
                      Стол выбран
                    </p>
                    <p className="truncate text-base font-bold text-gray-900">
                      {selectedTableObj.name}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-base font-bold text-gray-700">
                      {t('pos.selectTable')}
                    </p>
                    <p className="text-xs text-gray-500">Нажми, чтобы выбрать</p>
                  </>
                )}
              </div>

              <ChevronRight
                size={20}
                className="shrink-0 text-gray-400 group-hover:text-orange-500"
              />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3">
          {cart.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-base text-gray-400">
              {t('pos.emptyOrder')}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {cart.map((item, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-gray-100 bg-gray-50 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="flex items-center gap-1.5 text-base font-semibold text-gray-900">
                        {item.is_ready_product && (
                          <Package size={16} className="text-blue-600" />
                        )}
                        {lang === 'ru' ? item.name_ru : item.name_ja}
                      </p>
                      {item.modifiers.length > 0 && (
                        <p className="mt-0.5 text-sm font-semibold text-orange-600">
                          {item.modifiers.join(' · ')}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => removeItem(i)}
                      className="rounded-lg p-2 text-gray-400 active:bg-red-50 active:text-red-500"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQty(i, -1)}
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white active:bg-gray-100"
                      >
                        <Minus size={20} />
                      </button>
                      <span className="min-w-[2.5rem] text-center text-lg font-bold">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQty(i, 1)}
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white active:bg-gray-100"
                      >
                        <Plus size={20} />
                      </button>
                    </div>
                    <p className="text-lg font-bold text-gray-700">
                      {formatYen(item.unit_price * item.quantity)}
                    </p>
                  </div>

                  <input
                    type="text"
                    value={item.note}
                    onChange={(e) => setItemNote(i, e.target.value)}
                    placeholder={t('pos.itemNotePlaceholder')}
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />

                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {quickNotes.map((qn) => (
                      <button
                        key={qn}
                        onClick={() =>
                          setItemNote(i, item.note === qn ? '' : qn)
                        }
                        className={`rounded-full px-3 py-1.5 text-xs font-medium active:scale-95 ${
                          item.note === qn
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {qn}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 p-3">
          <input
            type="text"
            value={customerNote}
            onChange={(e) => setCustomerNote(e.target.value)}
            placeholder={t('pos.notes')}
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base"
          />
        </div>

        <div className="border-t border-gray-100 p-3">
          <div className="mb-2 flex justify-between text-sm text-gray-500">
            <span>{t('pos.subtotal')}</span>
            <span>{formatYen(subtotal)}</span>
          </div>
          <div className="flex justify-between text-xl font-bold text-gray-900">
            <span>{t('pos.total')}</span>
            <span className="text-orange-600">{formatYen(subtotal)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 p-3">
          <button
            onClick={sendToKitchen}
            disabled={cart.length === 0 || sending}
            className="flex h-14 items-center justify-center gap-2 rounded-xl bg-orange-600 text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
          >
            <Send size={22} />
            {sending ? 'Отправка…' : t('pos.sendToKitchen')}
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => setShowPayment(true)}
              disabled={cart.length === 0}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-gray-800 text-base font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-40"
            >
              <CreditCard size={22} />
              {t('pos.payment')}
            </button>
            <button
              onClick={clearCart}
              disabled={cart.length === 0}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-gray-100 text-base font-semibold text-gray-600 transition-all active:scale-[0.98] disabled:opacity-40"
            >
              <Eraser size={22} />
              {t('pos.clear')}
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-2xl bg-gray-900 px-6 py-4 text-base text-white shadow-lg">
          {toast}
        </div>
      )}

      {showPayment && (
        <PaymentModal
          total={subtotal}
          cart={cart}
          orderType={orderType}
          tableId={selectedTable}
          customerNote={customerNote}
          onClose={() => setShowPayment(false)}
        />
      )}

      {showTablePicker && (
        <TablePickerModal
          tables={tables}
          selectedId={selectedTable}
          onSelect={(id) => {
            setSelectedTable(id);
            setShowTablePicker(false);
          }}
          onClose={() => setShowTablePicker(false)}
        />
      )}

      {modifierProduct && (
        <ModifierPicker
          product={modifierProduct}
          onClose={() => setModifierProduct(null)}
          onConfirm={(mods) => {
            addToCart(modifierProduct, mods);
            setModifierProduct(null);
          }}
        />
      )}
    </div>
  );
}

// Модалка выбора стола
function TablePickerModal({
  tables,
  selectedId,
  onSelect,
  onClose,
}: {
  tables: RestaurantTable[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'free' | 'occupied'>('all');

  const filtered = tables.filter((tb) => {
    if (filter === 'all') return true;
    return tb.status === filter;
  });

  const freeCount = tables.filter((t) => t.status === 'free').length;
  const occupiedCount = tables.filter((t) => t.status === 'occupied').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 p-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Выберите стол</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {freeCount} свободно · {occupiedCount} занято
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
          >
            <X size={26} />
          </button>
        </div>

        <div className="flex gap-2 border-b border-gray-100 px-6 py-3">
          <button
            onClick={() => setFilter('all')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all active:scale-95 ${
              filter === 'all'
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            Все ({tables.length})
          </button>
          <button
            onClick={() => setFilter('free')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all active:scale-95 ${
              filter === 'free'
                ? 'bg-green-500 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            Свободные ({freeCount})
          </button>
          <button
            onClick={() => setFilter('occupied')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all active:scale-95 ${
              filter === 'occupied'
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            Занятые ({occupiedCount})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {filtered.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-gray-400">
              Нет столов в этой категории
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {filtered.map((tb) => {
                const isSelected = tb.id === selectedId;
                const isFree = tb.status === 'free';
                const isOccupied = tb.status === 'occupied';

                return (
                  <button
                    key={tb.id}
                    onClick={() => onSelect(tb.id)}
                    className={`relative flex aspect-square flex-col items-center justify-center gap-1.5 rounded-2xl border-2 p-3 transition-all active:scale-95 ${
                      isSelected
                        ? 'border-orange-500 bg-orange-50 shadow-md'
                        : isFree
                        ? 'border-green-200 bg-green-50 hover:border-green-400'
                        : isOccupied
                        ? 'border-orange-200 bg-orange-50 hover:border-orange-400'
                        : 'border-yellow-200 bg-yellow-50 hover:border-yellow-400'
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-white">
                        <Check size={12} />
                      </div>
                    )}

                    <Armchair
                      size={26}
                      className={
                        isSelected
                          ? 'text-orange-600'
                          : isFree
                          ? 'text-green-600'
                          : isOccupied
                          ? 'text-orange-600'
                          : 'text-yellow-600'
                      }
                    />

                    <span
                      className={`text-sm font-bold ${
                        isSelected ? 'text-orange-700' : 'text-gray-900'
                      }`}
                    >
                      {tb.name.replace(/^\D+/, '') || tb.name}
                    </span>

                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wide ${
                        isFree
                          ? 'text-green-600'
                          : isOccupied
                          ? 'text-orange-600'
                          : 'text-yellow-600'
                      }`}
                    >
                      {isFree ? 'Свободен' : isOccupied ? 'Занят' : 'Ожид.'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-gray-100 p-4">
          <button
            onClick={() => {
              onSelect('');
              onClose();
            }}
            className="h-12 flex-1 rounded-xl bg-gray-100 font-semibold text-gray-600 active:scale-[0.98]"
          >
            Без стола
          </button>
          <button
            onClick={onClose}
            className="h-12 flex-1 rounded-xl bg-gray-800 font-bold text-white active:scale-[0.98]"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

// Модалка выбора свойств
function ModifierPicker({
  product,
  onClose,
  onConfirm,
}: {
  product: Product;
  onClose: () => void;
  onConfirm: (mods: string[]) => void;
}) {
  const avail = product.available_modifiers || [];
  const [sel, setSel] = useState<string[]>([]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] min-h-[500px] w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-gray-900">
              {product.name_ru}
            </h2>
            <p className="text-xs text-gray-500">Выберите свойства</p>
          </div>
          <button
            onClick={onClose}
            className="ml-2 shrink-0 rounded-lg p-2 text-gray-400 active:bg-gray-100"
          >
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className="mb-3 text-sm font-semibold text-gray-500">
            Можно выбрать несколько:
          </p>
          <div className="flex flex-wrap gap-2">
            {avail.map((m) => {
              const on = sel.includes(m);
              return (
                <button
                  key={m}
                  onClick={() =>
                    setSel((p) => (on ? p.filter((k) => k !== m) : [...p, m]))
                  }
                  className={`flex items-center gap-1.5 rounded-full px-5 py-3 text-base font-semibold transition-all active:scale-95 ${
                    on
                      ? 'bg-orange-600 text-white shadow-md shadow-orange-500/30'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {on && <Check size={16} />}
                  {m}
                </button>
              );
            })}
          </div>

          {sel.length > 0 && (
            <div className="mt-6 rounded-xl bg-orange-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">
                Выбрано ({sel.length}):
              </p>
              <p className="mt-1 text-sm font-medium text-orange-800">
                {sel.join(' · ')}
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-gray-100 p-4">
          <button
            onClick={onClose}
            className="h-14 flex-1 rounded-xl bg-gray-100 text-base font-semibold text-gray-600 active:scale-[0.98]"
          >
            Отмена
          </button>
          <button
            onClick={() => onConfirm(sel)}
            className="h-14 flex-1 rounded-xl bg-orange-600 text-base font-bold text-white active:scale-[0.98]"
          >
            {sel.length > 0 ? `Добавить (${sel.length})` : 'Без свойств'}
          </button>
        </div>
      </div>
    </div>
  );
}