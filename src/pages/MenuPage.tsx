// src/pages/MenuPage.tsx
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import type { Category, Product, KitchenStation } from '@/lib/types';
import { formatYen } from '@/lib/format';
import {
  Plus, Pencil, Trash2, X, UtensilsCrossed, Package, ChefHat,
} from 'lucide-react';
import ImageUploader from '@/components/ImageUploader';
import { invalidateMenuCache } from '@/lib/menuCache';
import { useSyncEvent, notifyChange } from '@/hooks/useSync';

export default function MenuPage() {
  const { t, lang } = useI18n();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from('categories').select('*').order('sort_order'),
      supabase.from('kitchen_stations').select('*').order('sort_order'),
      supabase.from('products').select('*').order('sort_order'),
    ]).then(([cats, st, prods]) => {
      if (cats.data) {
        setCategories(cats.data);
        if (cats.data.length > 0 && !activeCategory) setActiveCategory(cats.data[0].id);
      }
      if (st.data) setStations(st.data);
      if (prods.data) setProducts(prods.data as Product[]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Синхронизация
  useSyncEvent('menu-changed', (_event, source) => {
    if (source === 'remote') {
      Promise.all([
        supabase.from('categories').select('*').order('sort_order'),
        supabase.from('products').select('*').order('sort_order'),
      ]).then(([cats, prods]) => {
        if (cats.data) setCategories(cats.data);
        if (prods.data) setProducts(prods.data as Product[]);
      });
    }
  });

  async function loadProducts() {
    const { data } = await supabase.from('products').select('*').order('sort_order');
    if (data) setProducts(data as Product[]);
    invalidateMenuCache();
    notifyChange('menu-changed');
  }

  const filteredProducts = products.filter((p) => p.category_id === activeCategory);

  const deleteProduct = async (id: string) => {
    if (!confirm(t('menu.deleteConfirm'))) return;
    await supabase.from('products').delete().eq('id', id);
    loadProducts();
  };

  return (
    <div className="h-full p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">{t('menu.title')}</h2>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
              activeCategory === cat.id
                ? 'bg-orange-600 text-white'
                : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {lang === 'ru' ? cat.name_ru : cat.name_ja}
          </button>
        ))}
        <button
          onClick={() => setShowCategoryForm(true)}
          className="rounded-xl bg-gray-100 px-3 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-200"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="mb-4">
        <button
          onClick={() => { setEditingProduct(null); setShowProductForm(true); }}
          className="flex h-12 items-center gap-2 rounded-xl bg-gray-800 px-4 font-semibold text-white hover:bg-gray-900"
        >
          <Plus size={20} />
          {t('menu.addProduct')}
        </button>
      </div>

      {filteredProducts.length === 0 ? (
        <p className="text-gray-400">{t('menu.noProducts')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredProducts.map((product) => {
            const mods = product.available_modifiers || [];
            const isReady = product.is_ready_product === true;
            return (
              <div key={product.id} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3">
                <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gray-50">
                  {product.image_url ? (
                    <img src={product.image_url} alt="" loading="lazy" className="h-full w-full rounded-xl object-cover" />
                  ) : (
                    <UtensilsCrossed size={24} className="text-gray-300" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-gray-900">
                    {lang === 'ru' ? product.name_ru : product.name_ja}
                  </p>
                  <p className="text-sm text-gray-500">{formatYen(product.price)}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                      product.is_available ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {product.is_available ? t('menu.available') : t('menu.unavailable')}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                      isReady ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                    }`}>
                      {isReady ? <Package size={12} /> : <ChefHat size={12} />}
                      {isReady ? 'Готовый' : 'На кухню'}
                    </span>
                    {mods.length > 0 && (
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
                        {mods.length} свойств
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => { setEditingProduct(product); setShowProductForm(true); }}
                    className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    onClick={() => deleteProduct(product.id)}
                    className="rounded-lg p-2 text-red-500 hover:bg-red-50"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showProductForm && (
        <ProductForm
          product={editingProduct}
          categories={categories}
          stations={stations}
          defaultCategoryId={activeCategory}
          onClose={() => setShowProductForm(false)}
          onSaved={() => { loadProducts(); setShowProductForm(false); }}
        />
      )}

      {showCategoryForm && (
        <CategoryForm
          onClose={() => setShowCategoryForm(false)}
          onSaved={() => {
            supabase.from('categories').select('*').order('sort_order').then(({ data }) => setCategories(data || []));
            invalidateMenuCache();
            notifyChange('menu-changed');
            setShowCategoryForm(false);
          }}
        />
      )}
    </div>
  );
}

function ProductForm({ product, categories, stations, defaultCategoryId, onClose, onSaved }: {
  product: Product | null;
  categories: Category[];
  stations: KitchenStation[];
  defaultCategoryId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name_ru: product?.name_ru || '',
    name_ja: product?.name_ja || '',
    description_ru: product?.description_ru || '',
    description_ja: product?.description_ja || '',
    price: product?.price?.toString() || '0',
    image_url: product?.image_url || '',
    is_available: product?.is_available ?? true,
    is_ready_product: product?.is_ready_product ?? false,
    category_id: product?.category_id || defaultCategoryId || '',
    kitchen_station_id: product?.kitchen_station_id || '',
    sort_order: product?.sort_order?.toString() || '0',
  });
  const [modifiers, setModifiers] = useState<string[]>(product?.available_modifiers || []);
  const [newModifier, setNewModifier] = useState('');
  const [saving, setSaving] = useState(false);

  const addModifier = () => {
    const v = newModifier.trim();
    if (!v) return;
    if (modifiers.includes(v)) { setNewModifier(''); return; }
    setModifiers([...modifiers, v]);
    setNewModifier('');
  };

  const removeModifier = (m: string) => setModifiers((p) => p.filter((x) => x !== m));

  const moveModifier = (i: number, dir: -1 | 1) => {
    setModifiers((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        name_ru: form.name_ru,
        name_ja: form.name_ja,
        description_ru: form.description_ru || null,
        description_ja: form.description_ja || null,
        price: parseInt(form.price) || 0,
        image_url: form.image_url || null,
        is_available: form.is_available,
        is_ready_product: form.is_ready_product,
        category_id: form.category_id || null,
        kitchen_station_id: form.is_ready_product ? null : (form.kitchen_station_id || null),
        sort_order: parseInt(form.sort_order) || 0,
        available_modifiers: modifiers,
        updated_at: new Date().toISOString(),
      };

      if (product) {
        const { error } = await supabase.from('products').update(payload).eq('id', product.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('products').insert(payload);
        if (error) throw error;
      }
      onSaved();
    } catch (err) {
      console.error(err);
      alert('Ошибка сохранения: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const suggestions = [
    'Без соуса', 'Мало соуса', 'Много соуса', 'Без лука', 'Без чеснока',
    'Острый', 'Не острый', 'Без майонеза',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            {product ? t('menu.editProduct') : t('menu.addProduct')}
          </h2>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('menu.nameRu')} value={form.name_ru} onChange={(v) => setForm({ ...form, name_ru: v })} />
            <Field label={t('menu.nameJa')} value={form.name_ja} onChange={(v) => setForm({ ...form, name_ja: v })} />
            <Field label={t('menu.price')} value={form.price} onChange={(v) => setForm({ ...form, price: v })} type="number" />
            <SelectField
              label={t('menu.category')}
              value={form.category_id}
              onChange={(v) => setForm({ ...form, category_id: v })}
              options={categories.map((c) => ({ value: c.id, label: c.name_ru }))}
            />
            <Field label={t('menu.sortOrder')} value={form.sort_order} onChange={(v) => setForm({ ...form, sort_order: v })} type="number" />
            <div className="col-span-2 flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <input
                  type="checkbox"
                  checked={form.is_available}
                  onChange={(e) => setForm({ ...form, is_available: e.target.checked })}
                  className="h-5 w-5"
                />
                {t('menu.available')}
              </label>
            </div>
          </div>

          <div className="mt-4">
            <ImageUploader value={form.image_url} onChange={(url) => setForm({ ...form, image_url: url })} />
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-xs font-semibold text-gray-500">Тип продукта</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, is_ready_product: false })}
                className={`flex items-center gap-2 rounded-xl border-2 p-3 text-left transition-all ${
                  !form.is_ready_product ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600'
                }`}
              >
                <ChefHat size={22} />
                <div>
                  <p className="text-sm font-bold">На кухне</p>
                  <p className="text-xs text-gray-500">Отправляется на кухню</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, is_ready_product: true })}
                className={`flex items-center gap-2 rounded-xl border-2 p-3 text-left transition-all ${
                  form.is_ready_product ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'
                }`}
              >
                <Package size={22} />
                <div>
                  <p className="text-sm font-bold">Готовый</p>
                  <p className="text-xs text-gray-500">Упакованный, без кухни</p>
                </div>
              </button>
            </div>
          </div>

          {!form.is_ready_product && (
            <div className="mt-3">
              <SelectField
                label={t('menu.station')}
                value={form.kitchen_station_id}
                onChange={(v) => setForm({ ...form, kitchen_station_id: v })}
                options={stations.map((s) => ({ value: s.id, label: s.name_ru }))}
              />
            </div>
          )}

          <div className="mt-5">
            <label className="mb-2 block text-xs font-semibold text-gray-500">
              Свойства (что можно выбрать при заказе)
            </label>

            <div className="flex gap-2">
              <input
                type="text"
                value={newModifier}
                onChange={(e) => setNewModifier(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addModifier(); } }}
                placeholder="Например: Без соуса"
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
              />
              <button
                type="button"
                onClick={addModifier}
                className="rounded-xl bg-orange-600 px-4 font-semibold text-white hover:bg-orange-700"
              >
                <Plus size={18} />
              </button>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {suggestions.filter((s) => !modifiers.includes(s)).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setModifiers([...modifiers, s])}
                  className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-200"
                >
                  + {s}
                </button>
              ))}
            </div>

            {modifiers.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5">
                {modifiers.map((m, i) => (
                  <div key={m} className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2">
                    <span className="flex-1 text-sm font-semibold text-gray-800">{m}</span>
                    <button type="button" onClick={() => moveModifier(i, -1)} className="rounded-md p-1 text-gray-400 hover:bg-gray-200">↑</button>
                    <button type="button" onClick={() => moveModifier(i, 1)} className="rounded-md p-1 text-gray-400 hover:bg-gray-200">↓</button>
                    <button type="button" onClick={() => removeModifier(m)} className="rounded-md p-1 text-red-500 hover:bg-red-50">
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="h-12 flex-1 rounded-xl bg-gray-100 font-semibold text-gray-600 hover:bg-gray-200">
            {t('menu.cancel')}
          </button>
          <button onClick={save} disabled={saving} className="h-12 flex-1 rounded-xl bg-orange-600 font-bold text-white hover:bg-orange-700 disabled:opacity-40">
            {saving ? '…' : t('menu.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [nameRu, setNameRu] = useState('');
  const [nameJa, setNameJa] = useState('');

  const save = async () => {
    if (!nameRu || !nameJa) return;
    await supabase.from('categories').insert({
      name_ru: nameRu,
      name_ja: nameJa,
      icon: 'UtensilsCrossed',
      sort_order: 99,
      is_active: true,
    });
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-sm flex-col rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{t('menu.addCategory')}</h2>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100">
            <X size={24} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <Field label={t('menu.nameRu')} value={nameRu} onChange={setNameRu} />
          <Field label={t('menu.nameJa')} value={nameJa} onChange={setNameJa} />
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="h-12 flex-1 rounded-xl bg-gray-100 font-semibold text-gray-600">
            {t('menu.cancel')}
          </button>
          <button onClick={save} className="h-12 flex-1 rounded-xl bg-orange-600 font-bold text-white">
            {t('menu.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-gray-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-gray-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
      >
        <option value="">-</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}