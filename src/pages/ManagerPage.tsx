import { useState, useEffect, useCallback } from 'react';
import {
  fetchSalesSummary,
  fetchHourlySales,
  fetchItemSales,
  fetchCategorySales,
  getDateRange,
  type SalesSummary,
  type HourlySales,
  type ItemSales,
  type CategorySales,
} from '@/services/statistics';
import {
  fetchAllCategories,
  fetchAllMenuItems,
  createCategory,
  updateCategory,
  deleteCategory,
  createItem,
  updateItem,
  deleteItem,
  uploadItemImage,
  applyImageToCategory,
  type SaveItemPayload,
} from '@/services/menu';
import { formatYen } from '@/locale/format';
import { useI18n, type TranslationKey } from '@/locale';
import { PageActions } from '@/components/PageActions';
import type {
  MenuCategory,
  MenuItem,
  MenuItemType,
  SetSlotType,
} from '@/types/database';
import {
  BarChart3,
  Tag,
  TrendingUp,
  ShoppingBag,
  Store,
  Clock,
  Plus,
  Pencil,
  Trash2,
  X,
  Upload,
  Image as ImageIcon,
} from 'lucide-react';

type Tab = 'stats' | 'menu';

export default function ManagerPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('stats');

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100">
      <PageActions forRole="manager">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('stats')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              tab === 'stats'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            {t('statistics')}
          </button>
          <button
            onClick={() => setTab('menu')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              tab === 'menu'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            {t('menuManagement')}
          </button>
        </div>
      </PageActions>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'stats' && <StatisticsTab />}
        {tab === 'menu' && <MenuManagementTab />}
      </div>
    </div>
  );
}

// ============================================================
// STATISTICS TAB
// ============================================================
function StatisticsTab() {
  const { t } = useI18n();
  const [preset, setPreset] = useState('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [hourly, setHourly] = useState<HourlySales[]>([]);
  const [items, setItems] = useState<ItemSales[]>([]);
  const [categories, setCategories] = useState<CategorySales[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const range = getDateRange(preset, customStart, customEnd);
      const [s, h, i, c] = await Promise.all([
        fetchSalesSummary(range),
        fetchHourlySales(range),
        fetchItemSales(range),
        fetchCategorySales(range),
      ]);
      setSummary(s);
      setHourly(h);
      setItems(i);
      setCategories(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToLoadStats'));
    } finally {
      setLoading(false);
    }
  }, [preset, customStart, customEnd, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const maxHourlyCount = Math.max(...hourly.map((h) => h.count), 1);
  const maxItemQty = Math.max(...items.map((i) => i.quantity), 1);
  const maxCatTotal = Math.max(...categories.map((c) => c.total), 1);

  const presetLabels: Record<string, TranslationKey> = {
    today: 'today',
    yesterday: 'yesterday',
    week: 'thisWeek',
    month: 'thisMonth',
    custom: 'custom',
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {['today', 'yesterday', 'week', 'month', 'custom'].map((p) => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              preset === p
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                : 'bg-white text-gray-600 border border-gray-200 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            {t(presetLabels[p])}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-orange-500"
            />
            <span className="text-gray-500">{t('to')}</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-orange-500"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            <SummaryCard
              label={t('totalSales')}
              value={formatYen(summary?.totalSales ?? 0)}
              icon={<TrendingUp className="w-5 h-5" />}
              color="orange"
            />
            <SummaryCard
              label={t('orders')}
              value={String(summary?.orderCount ?? 0)}
              icon={<ShoppingBag className="w-5 h-5" />}
              color="blue"
            />
            <SummaryCard
              label={t('averageOrder')}
              value={formatYen(summary?.averageOrder ?? 0)}
              icon={<BarChart3 className="w-5 h-5" />}
              color="green"
            />
            <SummaryCard
              label={t('inside')}
              value={String(summary?.insideOrders ?? 0)}
              icon={<Store className="w-5 h-5" />}
              color="purple"
            />
            <SummaryCard
              label={t('outside')}
              value={String(summary?.outsideOrders ?? 0)}
              icon={<ShoppingBag className="w-5 h-5" />}
              color="cyan"
            />
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-gray-500" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
                {t('salesByHour')}
              </h2>
            </div>
            <div className="flex items-end gap-1 h-40 overflow-x-auto">
              {hourly.map((h) => (
                <div
                  key={h.hour}
                  className="flex flex-col items-center gap-1 min-w-[28px] flex-1"
                >
                  <div className="text-xs text-gray-500 font-mono">
                    {h.count || ''}
                  </div>
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-orange-500 to-orange-400 transition-all"
                    style={{
                      height: `${(h.count / maxHourlyCount) * 100}%`,
                      minHeight: h.count > 0 ? '4px' : '0',
                    }}
                    title={`${h.hour}: ${h.count} — ${formatYen(h.total)}`}
                  />
                  <div className="text-[10px] text-gray-500 font-mono">
                    {h.hour.slice(0, 2)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">
                {t('popularItems')}
              </h2>
              {items.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">
                  {t('noSalesData')}
                </p>
              ) : (
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-6 text-right">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold truncate text-gray-900">
                            {item.name} {item.variant}
                          </span>
                          <span className="text-sm font-bold text-orange-600 ml-2">
                            {item.quantity}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-orange-500 rounded-full"
                              style={{
                                width: `${(item.quantity / maxItemQty) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs text-gray-500">
                            {formatYen(item.total)} · {item.percentage}%
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">
                {t('salesByCategory')}
              </h2>
              {categories.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">
                  {t('noSalesData')}
                </p>
              ) : (
                <div className="space-y-2">
                  {categories.map((cat, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="text-sm font-semibold flex-1 truncate text-gray-900">
                        {cat.name}
                      </span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-orange-500 to-red-500 rounded-full"
                          style={{
                            width: `${(cat.total / maxCatTotal) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-sm font-bold text-orange-600 w-20 text-right">
                        {formatYen(cat.total)}
                      </span>
                      <span className="text-xs text-gray-500 w-8 text-right">
                        {cat.quantity}x
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}) {
  const colors: Record<string, string> = {
    orange: 'from-orange-50 to-orange-100 border-orange-200 text-orange-600',
    blue: 'from-blue-50 to-blue-100 border-blue-200 text-blue-600',
    green: 'from-green-50 to-green-100 border-green-200 text-green-600',
    purple: 'from-purple-50 to-purple-100 border-purple-200 text-purple-600',
    cyan: 'from-cyan-50 to-cyan-100 border-cyan-200 text-cyan-600',
  };
  return (
    <div
      className={`bg-gradient-to-br ${colors[color]} border rounded-2xl p-4 shadow-sm`}
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-gray-600 font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}

// ============================================================
// MENU MANAGEMENT TAB
// ============================================================
function MenuManagementTab() {
  const { t } = useI18n();
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [editingCategory, setEditingCategory] = useState<MenuCategory | null>(
    null
  );
  const [showItemForm, setShowItemForm] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, its] = await Promise.all([
        fetchAllCategories(),
        fetchAllMenuItems(),
      ]);
      setCategories(cats);
      setItems(its);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToLoadMenu'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDeleteCategory = async (id: string) => {
    if (!confirm(t('deleteCategoryConfirm'))) return;
    try {
      await deleteCategory(id);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToDeleteCategory'));
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm(t('deleteItemConfirm'))) return;
    try {
      await deleteItem(id);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToDeleteItem'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4">
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">
          {t('categoriesAndItems')}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setEditingCategory(null);
              setShowCatForm(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 text-sm font-semibold transition-colors text-gray-700"
          >
            <Plus className="w-4 h-4" /> {t('categoryBtn')}
          </button>
          <button
            onClick={() => {
              setEditingItem(null);
              setShowItemForm(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors shadow-md shadow-orange-500/20"
          >
            <Plus className="w-4 h-4" /> {t('itemBtn')}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {categories.map((cat) => {
          const catItems = items.filter((i) => i.category_id === cat.id);
          const isExpanded = expandedCategory === cat.id;
          const coverImage =
            catItems.find((i) => i.image_url)?.image_url ?? null;

          return (
            <div
              key={cat.id}
              className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm"
            >
              <div
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50"
                onClick={() =>
                  setExpandedCategory(isExpanded ? null : cat.id)
                }
              >
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-lg overflow-hidden bg-orange-100 shrink-0 border border-orange-200 flex items-center justify-center">
                    {coverImage ? (
                      <img
                        src={coverImage}
                        alt={cat.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="text-sm font-black text-orange-500">
                        {cat.short_name || cat.name.slice(0, 3).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="font-bold text-gray-900">{cat.name}</div>
                    <div className="text-xs text-gray-500">
                      {catItems.length} ·{' '}
                      {cat.active ? t('active') : t('inactive')}
                    </div>
                  </div>
                </div>
                <div
                  className="flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      setEditingCategory(cat);
                      setShowCatForm(true);
                    }}
                    className="p-2 text-gray-500 hover:text-orange-600 rounded-lg hover:bg-orange-50"
                    title={t('editCategory')}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteCategory(cat.id)}
                    className="p-2 text-gray-500 hover:text-red-600 rounded-lg hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-gray-200 p-3 bg-gray-50">
                  {catItems.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-3">
                      {t('noItemsInCategory')}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {catItems.map((item) => {
                        const displayImage = item.image_url || coverImage;
                        const variantCount = item.variants?.length ?? 0;
                        const propCount = item.properties?.length ?? 0;
                        const slotCount = item.set_slots?.length ?? 0;

                        return (
                          <div
                            key={item.id}
                            className="flex items-start gap-3 bg-white rounded-xl p-3 border border-gray-200"
                          >
                            <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                              {displayImage ? (
                                <img
                                  src={displayImage}
                                  alt={item.name}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-xs text-gray-500 font-bold">
                                  {item.short_name}
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-semibold truncate text-gray-900">
                                  {item.name}
                                </span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-black uppercase shrink-0">
                                  {t(`type_${item.type}` as TranslationKey)}
                                </span>
                              </div>
                              <div className="text-xs text-gray-500">
                                {variantCount > 0
                                  ? `${variantCount} ${t('variantsShort')}`
                                  : formatYen(item.price)}{' '}
                                ·{' '}
                                {item.active ? t('active') : t('inactive')}
                              </div>
                              {(propCount > 0 || slotCount > 0) && (
                                <div className="text-[10px] text-gray-400 mt-0.5">
                                  {propCount > 0 &&
                                    `${propCount} ${t('propsShort')}`}
                                  {propCount > 0 && slotCount > 0 && ' · '}
                                  {slotCount > 0 &&
                                    `${slotCount} ${t('slotsShort')}`}
                                </div>
                              )}
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button
                                onClick={() => {
                                  setEditingItem(item);
                                  setShowItemForm(true);
                                }}
                                className="p-1.5 text-gray-500 hover:text-orange-600 rounded-lg hover:bg-orange-50"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteItem(item.id)}
                                className="p-1.5 text-gray-500 hover:text-red-600 rounded-lg hover:bg-red-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showCatForm && (
        <CategoryForm
          category={editingCategory}
          categories={categories}
          items={items}
          onClose={() => setShowCatForm(false)}
          onSaved={() => {
            setShowCatForm(false);
            loadData();
          }}
        />
      )}

      {showItemForm && (
        <ItemForm
          item={editingItem}
          categories={categories}
          allItems={items}
          onClose={() => setShowItemForm(false)}
          onSaved={() => {
            setShowItemForm(false);
            loadData();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// CATEGORY FORM
// ============================================================
function CategoryForm({
  category,
  categories,
  items,
  onClose,
  onSaved,
}: {
  category: MenuCategory | null;
  categories: MenuCategory[];
  items: MenuItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(category?.name ?? '');
  const [shortName, setShortName] = useState(category?.short_name ?? '');
  const [sortOrder, setSortOrder] = useState(
    category?.sort_order ?? categories.length + 1
  );
  const [active, setActive] = useState(category?.active ?? true);

  const initialCover = category
    ? items.find((i) => i.category_id === category.id && i.image_url)
        ?.image_url ?? ''
    : '';
  const [imageUrl, setImageUrl] = useState(initialCover);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const tempId = category?.id ?? crypto.randomUUID();
      const url = await uploadItemImage(file, `cat-${tempId}`);
      if (url) setImageUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToUploadImage'));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      let categoryId = category?.id;

      if (category) {
        await updateCategory(category.id, {
          name,
          short_name: shortName,
          sort_order: sortOrder,
          active,
        });
      } else {
        const created = await createCategory({
          name,
          short_name: shortName,
          sort_order: sortOrder,
          active,
        });
        categoryId = created.id;
      }

      if (categoryId && imageUrl) {
        await applyImageToCategory(categoryId, imageUrl);
      }

      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToSaveCategory'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={category ? t('editCategory') : t('newCategory')}
      onClose={onClose}
    >
      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-300 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <FormField label={t('name')}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="form-input"
          placeholder="Food"
        />
      </FormField>

      <FormField label={t('shortName')}>
        <input
          value={shortName}
          onChange={(e) => setShortName(e.target.value)}
          className="form-input"
          placeholder="FD"
        />
      </FormField>

      <FormField label={t('sortOrder')}>
        <input
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(Number(e.target.value))}
          className="form-input"
        />
      </FormField>

      <FormField label={t('categoryCover')}>
        <div className="flex items-center gap-3">
          <div className="w-20 h-20 rounded-lg overflow-hidden bg-orange-100 shrink-0 border border-orange-200 flex items-center justify-center">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="cover"
                className="w-full h-full object-cover"
              />
            ) : (
              <ImageIcon className="w-6 h-6 text-orange-400" />
            )}
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="cursor-pointer">
              <span className="block py-2 px-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold text-center transition-colors">
                {uploading ? t('uploading') : t('uploadImage')}
              </span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                }}
              />
            </label>
            {imageUrl && (
              <button
                type="button"
                onClick={() => setImageUrl('')}
                className="py-1.5 px-3 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-600 transition-colors"
              >
                {t('removeCover')}
              </button>
            )}
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">
          {t('categoryCoverHint')}
        </p>
      </FormField>

      <FormField label={t('active')}>
        <button
          onClick={() => setActive(!active)}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            active ? 'bg-orange-500' : 'bg-gray-300'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow ${
              active ? 'translate-x-6' : ''
            }`}
          />
        </button>
      </FormField>

      <div className="flex gap-2 mt-4">
        <button
          onClick={onClose}
          className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold"
        >
          {t('cancel')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !name}
          className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-40"
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </Modal>
  );
}

// ============================================================
// ITEM FORM
// ============================================================
type VariantDraft = { name: string; price: number };
type PropertyDraft = {
  group_name: string | null;
  name: string;
  price: number;
  is_default: boolean;
};
type SlotDraft = {
  slot_type: SetSlotType;
  label: string;
  required: boolean;
  source_mode: 'item' | 'category';
  source_id: string;
};

function ItemForm({
  item,
  categories,
  allItems,
  onClose,
  onSaved,
}: {
  item: MenuItem | null;
  categories: MenuCategory[];
  allItems: MenuItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();

  const [type, setType] = useState<MenuItemType>(item?.type ?? 'dish');
  const [categoryId, setCategoryId] = useState(
    item?.category_id ?? categories[0]?.id ?? ''
  );
  const [name, setName] = useState(item?.name ?? '');
  const [shortName, setShortName] = useState(item?.short_name ?? '');
  const [price, setPrice] = useState(item?.price ?? 0);
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? '');
  const [active, setActive] = useState(item?.active ?? true);
  const [sortOrder, setSortOrder] = useState(item?.sort_order ?? 1);

  const [variants, setVariants] = useState<VariantDraft[]>(
    (item?.variants ?? []).map((v) => ({ name: v.name, price: v.price }))
  );
  const [properties, setProperties] = useState<PropertyDraft[]>(
    (item?.properties ?? []).map((p) => ({
      group_name: p.group_name,
      name: p.name,
      price: p.price,
      is_default: p.is_default,
    }))
  );
  const [slots, setSlots] = useState<SlotDraft[]>(
    (item?.set_slots ?? []).map((s) => ({
      slot_type: s.slot_type,
      label: s.label,
      required: s.required,
      source_mode: s.fixed_item_id ? 'item' : 'category',
      source_id: (s.fixed_item_id ?? s.source_category_id) ?? '',
    }))
  );

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const tempId = item?.id ?? crypto.randomUUID();
      const url = await uploadItemImage(file, tempId);
      if (url) setImageUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToUploadImage'));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: SaveItemPayload = {
        category_id: categoryId || null,
        type,
        name,
        short_name: shortName,
        price,
        image_url: imageUrl || null,
        active,
        sort_order: sortOrder,
        variants:
          type === 'dish' || type === 'set'
            ? variants
                .filter((v) => v.name.trim())
                .map((v) => ({
                  name: v.name,
                  price: v.price,
                  sort_order: 0,
                }))
            : [],
        properties: properties
          .filter((p) => p.name.trim())
          .map((p) => ({
            group_name: p.group_name,
            name: p.name,
            price: p.price,
            is_default: p.is_default,
            sort_order: 0,
          })),
        set_slots:
          type === 'set'
            ? slots
                .filter((s) => s.source_id)
                .map((s) => ({
                  slot_type: s.slot_type,
                  label: s.label,
                  required: s.required,
                  sort_order: 0,
                  fixed_item_id:
                    s.source_mode === 'item' ? s.source_id : null,
                  source_category_id:
                    s.source_mode === 'category' ? s.source_id : null,
                }))
            : [],
      };

      if (item) await updateItem(item.id, payload);
      else await createItem(payload);

      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToSaveItem'));
    } finally {
      setSaving(false);
    }
  };

  const otherItems = allItems.filter((i) => i.id !== item?.id);

  return (
    <Modal
      title={item ? t('editItem') : t('newItemForm')}
      onClose={onClose}
      wide
    >
      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-300 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Тип */}
      <FormField label={t('itemType')}>
        <div className="grid grid-cols-5 gap-1">
          {(['dish', 'set', 'drink', 'sauce', 'topping'] as const).map(
            (tp) => (
              <button
                key={tp}
                type="button"
                onClick={() => setType(tp)}
                className={`py-2 rounded-lg text-xs font-bold transition-all ${
                  type === tp
                    ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {t(`type_${tp}` as TranslationKey)}
              </button>
            )
          )}
        </div>
      </FormField>

      {/* Категория */}
      <FormField label={t('categoryBtn')}>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="form-input"
        >
          <option value="">— {t('noCategory')} —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </FormField>

      {/* Название / короткое / цена / порядок */}
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('fullName')}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="form-input"
            placeholder="Kebab Sandwich"
          />
        </FormField>
        <FormField label={t('shortName')}>
          <input
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            className="form-input"
            placeholder="KS"
          />
        </FormField>
        <FormField label={t('price')}>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="form-input"
            disabled={(variants.length > 0 && type !== 'drink')}
          />
        </FormField>
        <FormField label={t('sortOrder')}>
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className="form-input"
          />
        </FormField>
      </div>

      {/* Варианты (dish / set) */}
      {(type === 'dish' || type === 'set') && (
        <FormField label={t('variants')}>
          <div className="space-y-1.5">
            {variants.map((v, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={v.name}
                  onChange={(e) =>
                    setVariants((p) =>
                      p.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x
                      )
                    )
                  }
                  className="form-input flex-1"
                  placeholder={t('variantName')}
                />
                <input
                  type="number"
                  value={v.price}
                  onChange={(e) =>
                    setVariants((p) =>
                      p.map((x, j) =>
                        j === i ? { ...x, price: Number(e.target.value) } : x
                      )
                    )
                  }
                  className="form-input w-28"
                  placeholder={t('price')}
                />
                <button
                  type="button"
                  onClick={() =>
                    setVariants((p) => p.filter((_, j) => j !== i))
                  }
                  className="p-2 text-gray-400 hover:text-red-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setVariants((p) => [...p, { name: '', price: 0 }])
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold"
            >
              <Plus className="w-3.5 h-3.5" /> {t('addVariant')}
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-1.5">
            {type === 'set' ? t('setVariantsHint') : t('dishVariantsHint')}
          </p>
        </FormField>
      )}

      {/* Слоты Set */}
      {type === 'set' && (
        <FormField label={t('setSlots')}>
          <div className="space-y-2">
            {slots.map((s, i) => (
              <div
                key={i}
                className="border border-gray-200 rounded-lg p-2 space-y-1.5 bg-slate-50"
              >
                <div className="grid grid-cols-12 gap-1.5 items-center">
                  <select
                    value={s.slot_type}
                    onChange={(e) =>
                      setSlots((p) =>
                        p.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                slot_type: e.target.value as SetSlotType,
                              }
                            : x
                        )
                      )
                    }
                    className="form-input col-span-3 text-xs"
                  >
                    <option value="drink">{t('slotDrink')}</option>
                    <option value="sauce">{t('slotSauce')}</option>
                    <option value="extra">{t('slotExtra')}</option>
                  </select>
                  <input
                    value={s.label}
                    onChange={(e) =>
                      setSlots((p) =>
                        p.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x
                        )
                      )
                    }
                    className="form-input col-span-5 text-xs"
                    placeholder={t('slotLabel')}
                  />
                  <label className="col-span-3 flex items-center gap-1 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={s.required}
                      onChange={(e) =>
                        setSlots((p) =>
                          p.map((x, j) =>
                            j === i
                              ? { ...x, required: e.target.checked }
                              : x
                          )
                        )
                      }
                    />
                    {t('required')}
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setSlots((p) => p.filter((_, j) => j !== i))
                    }
                    className="col-span-1 p-1 text-gray-400 hover:text-red-600 justify-self-end"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={s.source_mode}
                    onChange={(e) =>
                      setSlots((p) =>
                        p.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                source_mode: e.target.value as
                                  | 'item'
                                  | 'category',
                                source_id: '',
                              }
                            : x
                        )
                      )
                    }
                    className="form-input text-xs"
                  >
                    <option value="category">{t('fromCategory')}</option>
                    <option value="item">{t('fixedItem')}</option>
                  </select>
                  <select
                    value={s.source_id}
                    onChange={(e) =>
                      setSlots((p) =>
                        p.map((x, j) =>
                          j === i ? { ...x, source_id: e.target.value } : x
                        )
                      )
                    }
                    className="form-input text-xs"
                  >
                    <option value="">— {t('select')} —</option>
                    {s.source_mode === 'category'
                      ? categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))
                      : otherItems.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                          </option>
                        ))}
                  </select>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setSlots((p) => [
                  ...p,
                  {
                    slot_type: 'drink',
                    label: '',
                    required: true,
                    source_mode: 'category',
                    source_id: '',
                  },
                ])
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-100 hover:bg-purple-200 text-purple-800 text-xs font-bold"
            >
              <Plus className="w-3.5 h-3.5" /> {t('addSlot')}
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-1.5">
            {t('setSlotsHint')}
          </p>
        </FormField>
      )}

      {/* Свойства */}
      <FormField label={t('properties')}>
        <div className="space-y-1.5">
          {properties.map((p, i) => (
            <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
              <input
                value={p.group_name ?? ''}
                onChange={(e) =>
                  setProperties((prev) =>
                    prev.map((x, j) =>
                      j === i
                        ? { ...x, group_name: e.target.value || null }
                        : x
                    )
                  )
                }
                className="form-input col-span-3 text-xs"
                placeholder={t('groupOptional')}
              />
              <input
                value={p.name}
                onChange={(e) =>
                  setProperties((prev) =>
                    prev.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x
                    )
                  )
                }
                className="form-input col-span-4 text-xs"
                placeholder={t('propertyName')}
              />
              <input
                type="number"
                value={p.price}
                onChange={(e) =>
                  setProperties((prev) =>
                    prev.map((x, j) =>
                      j === i ? { ...x, price: Number(e.target.value) } : x
                    )
                  )
                }
                className="form-input col-span-2 text-xs"
                placeholder="+¥"
              />
              <label className="col-span-2 flex items-center gap-1 text-[10px] font-medium">
                <input
                  type="checkbox"
                  checked={p.is_default}
                  onChange={(e) =>
                    setProperties((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, is_default: e.target.checked } : x
                      )
                    )
                  }
                />
                {t('byDefault')}
              </label>
              <button
                type="button"
                onClick={() =>
                  setProperties((prev) => prev.filter((_, j) => j !== i))
                }
                className="col-span-1 p-1 text-gray-400 hover:text-red-600 justify-self-end"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setProperties((p) => [
                ...p,
                {
                  group_name: null,
                  name: '',
                  price: 0,
                  is_default: false,
                },
              ])
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold"
          >
            <Plus className="w-3.5 h-3.5" /> {t('addProperty')}
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mt-1.5">
          {t('propertiesHint')}
        </p>
      </FormField>

      {/* Изображение */}
      <FormField label={t('image')}>
        <div className="flex items-center gap-3">
          <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 shrink-0 border border-gray-200">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="preview"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                <Upload className="w-5 h-5" />
              </div>
            )}
          </div>
          <label className="flex-1 cursor-pointer">
            <span className="block py-2 px-3 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-semibold text-center transition-colors text-gray-700">
              {uploading ? t('uploading') : t('uploadImage')}
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
              }}
            />
          </label>
        </div>
      </FormField>

      {/* Активен */}
      <FormField label={t('active')}>
        <button
          type="button"
          onClick={() => setActive(!active)}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            active ? 'bg-orange-500' : 'bg-gray-300'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow ${
              active ? 'translate-x-6' : ''
            }`}
          />
        </button>
      </FormField>

      <div className="flex gap-2 mt-4">
        <button
          onClick={onClose}
          className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold"
        >
          {t('cancel')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !name}
          className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-40"
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </Modal>
  );
}

// ============================================================
// Modal + FormField
// ============================================================
function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-2xl border border-gray-200 p-5 w-full ${
          wide ? 'max-w-2xl' : 'max-w-md'
        } max-h-[90vh] overflow-y-auto m-4 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-semibold text-gray-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}