import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import type { Category, Product, RestaurantTable, KitchenStation } from '@/lib/types';
import { formatYen } from '@/lib/format';
import {
  Flame, Beef, Salad, Soup, CupSoda, Croissant, Cake, UtensilsCrossed,
  X, Plus, Minus, Trash2, Send, CreditCard, Eraser, Package, type LucideIcon,
} from 'lucide-react';
import PaymentModal from '@/components/PaymentModal';

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
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway'>('dine_in');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [customerNote, setCustomerNote] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);

  useEffect(() => {
    supabase.from('categories').select('*').order('sort_order').then(({ data }) => {
      if (data) {
        setCategories(data);
        if (data.length > 0) setActiveCategory(data[0].id);
      }
    });
    supabase.from('products').select('*').order('sort_order').then(({ data }) => setProducts(data || []));
    supabase.from('restaurant_tables').select('*').order('sort_order').then(({ data }) => setTables(data || []));
    supabase.from('kitchen_stations').select('*').order('sort_order').then(({ data }) => setStations(data || []));
  }, []);

  const filteredProducts = products.filter((p) => p.category_id === activeCategory);

  const cartKey = (c: { product_id: string; modifiers: string[]; note: string }) =>
    c.product_id + '|' + [...c.modifiers].sort().join(',') + '|' + c.note;

  const addToCart = useCallback((product: Product, modifiers: string[] = []) => {
    const isReady = (product as any).is_ready_product === true;
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
  }, []);

  const handleProductClick = (product: Product) => {
    const avail = ((product as any).available_modifiers as string[] | undefined) || [];
    if (avail.length > 0) {
      setModifierProduct(product);
    } else {
      addToCart(product, []);
    }
  };

  const updateQty = (index: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((c, i) => (i === index ? { ...c, quantity: c.quantity + delta } : c))
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

  const subtotal = cart.reduce((sum, c) => sum + c.unit_price * c.quantity, 0);

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
      const order = orderData as { id: string };

      const items = cart.map((c) => {
        const modLine = c.modifiers.length ? c.modifiers.join(', ') : '';
        const noteCombined = [modLine, c.note].filter(Boolean).join(' | ') || null;

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

      const { error: itemsError } = await supabase.from('order_items').insert(items);
      if (itemsError) throw itemsError;

      await supabase
        .from('orders')
        .update({ sent_to_kitchen_at: new Date().toISOString() })
        .eq('id', order.id);

      if (orderType === 'dine_in' && selectedTable) {
        await supabase.from('restaurant_tables').update({ status: 'occupied' }).eq('id', selectedTable);
      }

      setToast(t('pos.sent'));
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

  const quickNotes = [t('pos.quickNotes'), t('pos.quickNotesSpicy'), t('pos.quickNotesNoSauce')];

  return (
    <div className="flex h-full gap-4 p-4">
      {/* LEFT: Categories */}
      <div className="flex w-40 shrink-0 flex-col gap-2 overflow-y-auto">
        {categories.map((cat) => {
          const Icon = iconMap[cat.icon] || UtensilsCrossed;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-4 transition-all ${
                activeCategory === cat.id
                  ? 'border-orange-500 bg-orange-50 text-orange-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <Icon size={28} />
              <span className="text-center text-sm font-semibold">
                {lang === 'ru' ? cat.name_ru : cat.name_ja}
              </span>
            </button>
          );
        })}
      </div>

      {/* CENTER: Products */}
      <div className="flex-1 overflow-y-auto">
        {filteredProducts.length === 0 ? (
          <div className="flex h-full items-center justify-center text-gray-400">
            {t('pos.noProducts')}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {filteredProducts.map((product) => {
              const avail = ((product as any).available_modifiers as string[] | undefined) || [];
              const isReady = (product as any).is_ready_product === true;
              return (
                <button
                  key={product.id}
                  disabled={!product.is_available}
                  onClick={() => handleProductClick(product)}
                  className={`relative flex flex-col rounded-2xl border-2 p-4 text-left transition-all ${
                    product.is_available
                      ? 'border-gray-200 bg-white hover:border-orange-300 hover:shadow-md'
                      : 'border-gray-200 bg-gray-50 opacity-50'
                  }`}
                >
                  {/* Бейдж типа продукта */}
                  {isReady && (
                    <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                      <Package size={10} />
                      Готовый
                    </span>
                  )}

                  <div className="mb-3 flex h-24 items-center justify-center rounded-xl bg-gray-50">
                    {product.image_url ? (
                      <img src={product.image_url} alt="" className="h-full w-full rounded-xl object-cover" />
                    ) : (
                      <UtensilsCrossed size={36} className="text-gray-300" />
                    )}
                  </div>
                  <p className="text-sm font-bold text-gray-900">
                    {lang === 'ru' ? product.name_ru : product.name_ja}
                  </p>
                  {avail.length > 0 && (
                    <p className="mt-0.5 text-[11px] font-semibold text-orange-500">
                      {avail.length} свойства
                    </p>
                  )}
                  <div className="mt-1 flex items-center justify-between">
                    <p className="text-lg font-bold text-orange-600">{formatYen(product.price)}</p>
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

      {/* RIGHT: Cart */}
      <div className="flex w-96 shrink-0 flex-col rounded-2xl border border-gray-200 bg-white">
        <div className="flex gap-2 border-b border-gray-100 p-3">
          <button
            onClick={() => setOrderType('dine_in')}
            className={`flex-1 rounded-xl py-3 text-sm font-semibold transition-all ${
              orderType === 'dine_in' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {t('pos.dineIn')}
          </button>
          <button
            onClick={() => setOrderType('takeaway')}
            className={`flex-1 rounded-xl py-3 text-sm font-semibold transition-all ${
              orderType === 'takeaway' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {t('pos.takeaway')}
          </button>
        </div>

        {orderType === 'dine_in' && (
          <div className="border-b border-gray-100 p-3">
            <select
              value={selectedTable || ''}
              onChange={(e) => setSelectedTable(e.target.value || null)}
              className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm"
            >
              <option value="">{t('pos.selectTable')}</option>
              {tables.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3">
          {cart.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-gray-400">
              {t('pos.emptyOrder')}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {cart.map((item, i) => (
                <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                        {item.is_ready_product && (
                          <Package size={14} className="text-blue-600" />
                        )}
                        {lang === 'ru' ? item.name_ru : item.name_ja}
                      </p>
                      {item.modifiers.length > 0 && (
                        <p className="mt-0.5 text-xs font-semibold text-orange-600">
                          {item.modifiers.join(' · ')}
                        </p>
                      )}
                    </div>
                    <button onClick={() => removeItem(i)} className="text-gray-400 hover:text-red-500">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQty(i, -1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white"
                      >
                        <Minus size={16} />
                      </button>
                      <span className="min-w-[2rem] text-center text-sm font-bold">{item.quantity}</span>
                      <button
                        onClick={() => updateQty(i, 1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    <p className="text-sm font-bold text-gray-700">
                      {formatYen(item.unit_price * item.quantity)}
                    </p>
                  </div>
                  <input
                    type="text"
                    value={item.note}
                    onChange={(e) => setItemNote(i, e.target.value)}
                    placeholder={t('pos.itemNotePlaceholder')}
                    className="mt-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                  />
                  <div className="mt-1 flex flex-wrap gap-1">
                    {quickNotes.map((qn) => (
                      <button
                        key={qn}
                        onClick={() => setItemNote(i, item.note === qn ? '' : qn)}
                        className={`rounded-full px-2 py-1 text-xs ${
                          item.note === qn
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
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
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
        </div>

        <div className="border-t border-gray-100 p-3">
          <div className="mb-2 flex justify-between text-sm text-gray-500">
            <span>{t('pos.subtotal')}</span>
            <span>{formatYen(subtotal)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold text-gray-900">
            <span>{t('pos.total')}</span>
            <span className="text-orange-600">{formatYen(subtotal)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 p-3">
          <button
            onClick={sendToKitchen}
            disabled={cart.length === 0 || sending}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-orange-600 font-bold text-white transition-all hover:bg-orange-700 disabled:opacity-40"
          >
            <Send size={20} />
            {t('pos.sendToKitchen')}
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => setShowPayment(true)}
              disabled={cart.length === 0}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-gray-800 font-semibold text-white transition-all hover:bg-gray-900 disabled:opacity-40"
            >
              <CreditCard size={20} />
              {t('pos.payment')}
            </button>
            <button
              onClick={clearCart}
              disabled={cart.length === 0}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-gray-100 font-semibold text-gray-600 transition-all hover:bg-gray-200 disabled:opacity-40"
            >
              <Eraser size={20} />
              {t('pos.clear')}
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-2xl bg-gray-900 px-6 py-3 text-white shadow-lg">
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

function ModifierPicker({
  product, onClose, onConfirm,
}: {
  product: Product;
  onClose: () => void;
  onConfirm: (mods: string[]) => void;
}) {
  const avail = ((product as any).available_modifiers as string[]) || [];
  const [sel, setSel] = useState<string[]>([]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{product.name_ru}</h2>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100">
            <X size={22} />
          </button>
        </div>
        <p className="mb-3 text-xs font-semibold text-gray-500">Выберите свойства (можно несколько):</p>
        <div className="flex flex-wrap gap-2">
          {avail.map((m) => {
            const on = sel.includes(m);
            return (
              <button
                key={m}
                onClick={() =>
                  setSel((p) => (on ? p.filter((k) => k !== m) : [...p, m]))
                }
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  on ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="h-12 flex-1 rounded-xl bg-gray-100 font-semibold text-gray-600"
          >
            Отмена
          </button>
          <button
            onClick={() => onConfirm(sel)}
            className="h-12 flex-1 rounded-xl bg-orange-600 font-bold text-white"
          >
            Добавить
          </button>
        </div>
      </div>
    </div>
  );
}