// src/pages/Manager/ProductsPage.tsx
// Страница «Продукты»: все продукты по категориям, поиск, добавление,
// изменение, дублирование и удаление. Данные и действия приходят из MenuProduct.
import { useMemo, useState } from 'react';
import {
  Search,
  Plus,
  Pencil,
  Copy,
  Trash2,
  Package,
  UtensilsCrossed,
  CupSoda,
  Droplet,
  Sparkles,
  LayoutGrid,
  EyeOff,
  Layers,
} from 'lucide-react';
import { useI18n } from '@/locale';
import { formatYen } from '@/locale/format';
import { slotOf } from '@/lib/menuOrder';
import { FlipImage, collectFlipImages } from '@/components/MenuCard';
import type { MenuItem, MenuItemType } from '@/types/database';

type CatFilter = 'all' | MenuItemType;
type StatusFilter = 'all' | 'active' | 'hidden';

interface CatMeta {
  key: MenuItemType;
  label: string;
  icon: React.ReactNode;
  /** акцентный цвет категории (работает и в светлой, и в тёмной теме) */
  accent: string;
}

const CATS: CatMeta[] = [
  { key: 'dish', label: 'Блюда', icon: <UtensilsCrossed className="w-4 h-4" />, accent: '#3b82f6' },
  { key: 'set', label: 'Сеты', icon: <Package className="w-4 h-4" />, accent: '#8b5cf6' },
  { key: 'drink', label: 'Напитки', icon: <CupSoda className="w-4 h-4" />, accent: '#06b6d4' },
  { key: 'sauce', label: 'Соусы', icon: <Droplet className="w-4 h-4" />, accent: '#f43f5e' },
  { key: 'topping', label: 'Топпинги', icon: <Sparkles className="w-4 h-4" />, accent: '#f59e0b' },
];

const CAT_BY_KEY = Object.fromEntries(CATS.map((c) => [c.key, c])) as Record<
  MenuItemType,
  CatMeta
>;

export function ProductsPage({
  items,
  onAdd,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  items: MenuItem[];
  onAdd: () => void;
  onEdit: (item: MenuItem) => void;
  onDuplicate: (item: MenuItem) => void;
  onDelete: (item: MenuItem) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<CatFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');

  const tops = useMemo(() => items.filter((i) => !i.parent_id), [items]);

  const counts = useMemo(() => {
    const m: Record<CatFilter, number> = {
      all: tops.length,
      dish: 0,
      set: 0,
      drink: 0,
      sauce: 0,
      topping: 0,
    };
    for (const i of tops) m[i.type] += 1;
    return m;
  }, [tops]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      tops
        .filter((i) => cat === 'all' || i.type === cat)
        .filter(
          (i) =>
            status === 'all' ||
            (status === 'active' ? i.active : !i.active)
        )
        .filter(
          (i) =>
            !q ||
            i.name.toLowerCase().includes(q) ||
            (i.short_name ?? '').toLowerCase().includes(q)
        ),
    [tops, cat, status, q]
  );

  // Секции по категориям (в «Все» — по порядку категорий, внутри — как в меню)
  const sections = useMemo(() => {
    const order: MenuItemType[] = cat === 'all' ? CATS.map((c) => c.key) : [cat];
    return order
      .map((key) => ({
        meta: CAT_BY_KEY[key],
        list: visible
          .filter((i) => i.type === key)
          .sort((a, b) => slotOf(a) - slotOf(b)),
      }))
      .filter((s) => s.list.length > 0);
  }, [visible, cat]);

  return (
    <div className="pp-root flex-1 min-h-0 flex flex-col">
      {/* ---------- Верхняя панель страницы ---------- */}
      <div className="pp-bar shrink-0 px-6 pt-5 pb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3 mr-auto">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/30">
              <LayoutGrid className="w-6 h-6" />
            </div>
            <div>
              <h1 className="pp-title text-xl font-black leading-tight">
                Продукты
              </h1>
              <p className="pp-sub text-xs font-semibold">
                {t('productsByCategory')} · {counts.all}
              </p>
            </div>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pp-sub w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск продукта…"
              className="pp-search w-full text-sm"
            />
          </div>

          <button
            type="button"
            onClick={onAdd}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 active:scale-95 text-white text-sm font-black shadow-lg shadow-orange-500/30 transition-all"
          >
            <Plus className="w-5 h-5" />
            Добавить продукт
          </button>
        </div>

        {/* Категории + статус */}
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <Pill active={cat === 'all'} onClick={() => setCat('all')}>
            <Layers className="w-4 h-4" />
            {t('all')}
            <Count n={counts.all} />
          </Pill>
          {CATS.map((c) => (
            <Pill
              key={c.key}
              accent={c.accent}
              active={cat === c.key}
              onClick={() => setCat(c.key)}
            >
              {c.icon}
              {c.label}
              <Count n={counts[c.key]} />
            </Pill>
          ))}

          <div className="pp-seg ml-auto flex items-center gap-1 p-1 rounded-xl">
            {(
              [
                ['all', t('all')],
                ['active', t('active')],
                ['hidden', t('inactive')],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatus(k)}
                className={`pp-seg-btn px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                  status === k ? 'is-active' : ''
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- Список ---------- */}
      <div className="pp-body flex-1 min-h-0 overflow-y-auto px-6 py-5">
        {sections.length === 0 ? (
          <div className="pp-sub h-full flex flex-col items-center justify-center gap-3">
            <Package className="w-16 h-16 opacity-30" />
            <p className="text-lg font-black">
              {tops.length === 0 ? t('noMenuItems') : 'Ничего не найдено'}
            </p>
            {tops.length === 0 && (
              <button
                type="button"
                onClick={onAdd}
                className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-black"
              >
                {t('addProduct')}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {sections.map(({ meta, list }) => (
              <section key={meta.key} style={{ ['--accent' as string]: meta.accent }}>
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="pp-sec-icon inline-flex items-center justify-center w-8 h-8 rounded-xl">
                    {meta.icon}
                  </span>
                  <h2 className="pp-title text-base font-black">{meta.label}</h2>
                  <span className="pp-count text-xs font-black tabular-nums">
                    {list.length}
                  </span>
                  <div className="pp-rule flex-1 h-px ml-2" />
                </div>

                <div
                  className="grid gap-4"
                  style={{
                    gridTemplateColumns:
                      'repeat(auto-fill, minmax(200px, 1fr))',
                  }}
                >
                  {list.map((item) => (
                    <ProductCard
                      key={item.id}
                      item={item}
                      meta={meta}
                      onEdit={onEdit}
                      onDuplicate={onDuplicate}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// КАРТОЧКА ПРОДУКТА
// ============================================================
function ProductCard({
  item,
  meta,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  item: MenuItem;
  meta: CatMeta;
  onEdit: (item: MenuItem) => void;
  onDuplicate: (item: MenuItem) => void;
  onDelete: (item: MenuItem) => void;
}) {
  const { t } = useI18n();
  const variantsCount = item.variants?.length ?? 0;
  const isGroup =
    (item.type === 'dish' && item.dish_kind === 'group') ||
    (item.type === 'set' && item.set_main?.dish_kind === 'group');
  const flipImages = collectFlipImages(item, item.variants);
  const propsCount = item.properties?.filter((p) => p.name.trim()).length ?? 0;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onEdit(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit(item);
        }
      }}
      style={{ ['--accent' as string]: meta.accent }}
      className={`pp-card group relative text-left overflow-hidden cursor-pointer focus:outline-none ${
        item.type === 'set' ? 'is-set' : ''
      } ${item.active ? '' : 'opacity-55'}`}
    >
      {/* Картинка */}
      <div className="pp-thumb relative aspect-[4/3] overflow-hidden">
        {flipImages.length > 1 ? (
          <FlipImage images={flipImages} alt={item.name} />
        ) : item.image_url ? (
          <img
            src={item.image_url}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="pp-ph w-full h-full flex items-center justify-center">
            <span className="[&>svg]:w-11 [&>svg]:h-11">{meta.icon}</span>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/35 to-transparent pointer-events-none" />

        <span className="pp-type absolute top-2 left-2 inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] font-black">
          {t(`type_${item.type}` as 'type_dish')}
        </span>

        {!item.active && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 text-white text-[0.625rem] font-black">
            <EyeOff className="w-3 h-3" />
            {t('inactive')}
          </span>
        )}

        {/* Быстрые действия */}
        <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 transition-all">
          <IconBtn
            title={t('duplicate')}
            onClick={(e) => {
              stop(e);
              onDuplicate(item);
            }}
          >
            <Copy className="w-4 h-4" />
          </IconBtn>
          <IconBtn
            title={t('delete')}
            danger
            onClick={(e) => {
              stop(e);
              onDelete(item);
            }}
          >
            <Trash2 className="w-4 h-4" />
          </IconBtn>
        </div>
      </div>

      {/* Текст */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <h3
            className={`pp-name text-sm font-black leading-tight line-clamp-2 ${
              item.free ? 'is-free' : ''
            }`}
          >
            {item.name}
          </h3>
          {item.free ? null : (
            <span className="pp-price shrink-0 text-sm font-black tabular-nums">
              {formatYen(item.price)}
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center gap-1.5 flex-wrap min-h-[1.25rem]">
          {isGroup && variantsCount > 0 && <Chip>{variantsCount} вар.</Chip>}
          {propsCount > 0 && <Chip>{propsCount} свойств</Chip>}
          {item.short_name && item.short_name !== item.name && (
            <Chip>{item.short_name}</Chip>
          )}
        </div>

        <div className="pp-edit mt-3 flex items-center gap-1.5 text-xs font-black transition-colors">
          <Pencil className="w-3.5 h-3.5" />
          {t('edit')}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// МЕЛОЧИ
// ============================================================
function Pill({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={accent ? ({ ['--accent' as string]: accent } as React.CSSProperties) : undefined}
      className={`pp-pill flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black transition-all active:scale-95 ${
        active ? 'is-active' : ''
      }`}
    >
      {children}
    </button>
  );
}

function Count({ n }: { n: number; active?: boolean }) {
  return (
    <span className="pp-pill-count px-1.5 py-0.5 rounded-md text-[0.625rem] tabular-nums leading-none">
      {n}
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="pp-chip px-1.5 py-0.5 rounded-md text-[0.625rem] font-bold leading-none truncate max-w-full">
      {children}
    </span>
  );
}

function IconBtn({
  title,
  danger,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`pp-iconbtn w-8 h-8 rounded-lg flex items-center justify-center ${
        danger ? 'is-danger' : ''
      }`}
    >
      {children}
    </button>
  );
}
