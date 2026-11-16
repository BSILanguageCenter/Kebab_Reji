import type {
  MenuItem,
  MenuItemType,
  Station,
  DishKind,
  SauceMode,
  HydratedProperty,
  HydratedSauce,
  HydratedSetExtraOption,
} from '@/types/database';
import {
  getMenuItems,
  setMenuItems,
  removeMenuItem,
  newId,
} from '@/lib/localStore';
import { canFitImage } from '@/lib/storageUsage';

// ============================================================
// ПУБЛИЧНЫЕ ТИПЫ
// ============================================================
export interface VariantDraftPayload {
  id?: string;
  name: string;
  short_name: string;
  image_url: string | null;
  price: number;
  free: boolean;
  station: Station | null;
  cook_time_min: number | null;
  sauce_mode: SauceMode | null;
  properties: PropertyDraftPayload[];
  allowed_sauce_ids: string[];
}

export interface PropertyDraftPayload {
  name: string;
  options?: string[];
  required?: boolean;
}

export interface SetExtraGroupPayload {
  label: string;
  required: boolean;
  options: {
    item_id: string;
    price_override: number | null;
    image_override: string | null;
  }[];
}

export interface SaveItemPayload {
  type: MenuItemType;
  name: string;
  short_name: string;
  image_url: string | null;
  price: number;
  free: boolean;
  station: Station | null;
  cook_time_min: number | null;
  color: string | null;
  dish_kind: DishKind | null;
  sauce_mode: SauceMode | null;
  active: boolean;
  sort_order: number;

  properties?: PropertyDraftPayload[];
  allowed_sauce_ids?: string[];

  variants?: VariantDraftPayload[];

  set_main_item_id?: string | null;
  set_main_overrides?: {
    variant_item_id: string;
    price_override: number | null;
    image_override: string | null;
  }[];
  set_extra_groups?: SetExtraGroupPayload[];
}

// ============================================================
// ЗАГРУЗКА
// ============================================================
export async function fetchAllMenuItems(): Promise<MenuItem[]> {
  return JSON.parse(JSON.stringify(getMenuItems())) as MenuItem[];
}

// ============================================================
// ХЕЛПЕРЫ
// ============================================================
function buildPropertyHydrated(
  itemId: string,
  properties: PropertyDraftPayload[]
): HydratedProperty[] {
  return properties
    .filter((p) => p.name.trim())
    .map((p, i) => ({
      id: newId(),
      item_id: itemId,
      name: p.name.trim(),
      options: Array.isArray(p.options) ? [...p.options] : [],
      required: Boolean(p.required),
      sort_order: i,
    }));
}

function buildSaucesFromIds(
  ids: string[],
  allItems: MenuItem[]
): HydratedSauce[] {
  return ids
    .map((id) => allItems.find((i) => i.id === id))
    .filter((x): x is MenuItem => Boolean(x))
    .map((s) => ({
      id: s.id,
      name: s.name,
      short_name: s.short_name,
      image_url: s.image_url,
      price: s.price,
      free: s.free,
      color: s.color,
      active: s.active,
    }));
}

function cloneItem(it: MenuItem): MenuItem {
  return JSON.parse(JSON.stringify(it)) as MenuItem;
}

function buildMenuItem(
  payload: SaveItemPayload,
  id: string,
  allItems: MenuItem[],
  existing?: MenuItem
): MenuItem {
  const now = new Date().toISOString();

  const item: MenuItem = {
    id,
    type: payload.type,
    name: payload.name,
    short_name: payload.short_name,
    image_url: payload.image_url,
    price: payload.price,
    free: payload.free,
    station: payload.station,
    cook_time_min: payload.cook_time_min,
    color: payload.color,
    dish_kind: payload.dish_kind,
    sauce_mode: payload.sauce_mode,
    parent_id: null,
    active: payload.active,
    sort_order: payload.sort_order,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    properties: [],
    allowed_sauces: [],
  };

  if (
    (payload.type === 'dish' && payload.dish_kind === 'single') ||
    payload.type === 'topping'
  ) {
    item.properties = buildPropertyHydrated(id, payload.properties ?? []);
    if (payload.sauce_mode === 'with' && payload.allowed_sauce_ids?.length) {
      item.allowed_sauces = buildSaucesFromIds(
        payload.allowed_sauce_ids,
        allItems
      );
    }
  }

  if (payload.type === 'dish' && payload.dish_kind === 'group') {
    item.variants = (payload.variants ?? []).map((v, i) => {
      const vid = v.id ?? newId();
      const variant: MenuItem = {
        id: vid,
        type: 'dish',
        name: v.name,
        short_name: v.short_name,
        image_url: v.image_url,
        price: v.price,
        free: v.free,
        station: v.station,
        cook_time_min: v.cook_time_min,
        color: null,
        dish_kind: 'single',
        sauce_mode: v.sauce_mode,
        parent_id: id,
        active: true,
        sort_order: i,
        created_at: now,
        updated_at: now,
        properties: buildPropertyHydrated(vid, v.properties ?? []),
        allowed_sauces:
          v.sauce_mode === 'with'
            ? buildSaucesFromIds(v.allowed_sauce_ids ?? [], allItems)
            : [],
      };
      return variant;
    });
  }

  if (payload.type === 'set' && payload.set_main_item_id) {
    const main = allItems.find((i) => i.id === payload.set_main_item_id);
    if (main) {
      const mainCopy = cloneItem(main);
      if (
        main.dish_kind === 'group' &&
        mainCopy.variants &&
        payload.set_main_overrides
      ) {
        mainCopy.variants = mainCopy.variants.map((v) => {
          const ov = payload.set_main_overrides?.find(
            (o) => o.variant_item_id === v.id
          );
          if (!ov) return v;
          const merged = { ...v };
          if (ov.price_override != null) merged.price = ov.price_override;
          if (ov.image_override) merged.image_url = ov.image_override;
          return merged;
        });
      }
      item.set_main = mainCopy;
    }

    item.set_extra_groups = (payload.set_extra_groups ?? []).map((g, gi) => ({
      id: newId(),
      set_item_id: id,
      label: g.label,
      required: g.required,
      sort_order: gi,
      options: g.options
        .map((o): HydratedSetExtraOption | null => {
          const optItem = allItems.find((x) => x.id === o.item_id);
          if (!optItem) return null;
          const copy = cloneItem(optItem);
          if (o.price_override != null) copy.price = o.price_override;
          if (o.image_override) copy.image_url = o.image_override;
          return { option_id: newId(), item: copy };
        })
        .filter((x): x is HydratedSetExtraOption => Boolean(x)),
    }));
  }

  return item;
}

// ============================================================
// СОЗДАНИЕ
// ============================================================
export async function createItem(payload: SaveItemPayload): Promise<MenuItem> {
  const allItems = getMenuItems();
  const id = newId();
  const item = buildMenuItem(payload, id, allItems);
  setMenuItems([...allItems, item]);
  return item;
}

// ============================================================
// ОБНОВЛЕНИЕ
// ============================================================
export async function updateItem(
  id: string,
  payload: SaveItemPayload
): Promise<MenuItem> {
  const allItems = getMenuItems();
  const existing = allItems.find((i) => i.id === id);
  if (!existing) throw new Error('Продукт не найден');
  const updated = buildMenuItem(payload, id, allItems, existing);
  setMenuItems(allItems.map((i) => (i.id === id ? updated : i)));
  return updated;
}

// ============================================================
// УДАЛЕНИЕ
// ============================================================
export async function deleteItem(id: string): Promise<void> {
  removeMenuItem(id);
}

// ============================================================
// ПОРЯДОК
// ============================================================
export async function reorderItems(
  updates: { id: string; sort_order: number }[]
): Promise<void> {
  if (updates.length === 0) return;
  const map = new Map(updates.map((u) => [u.id, u.sort_order]));
  const items = getMenuItems().map((i) =>
    map.has(i.id) ? { ...i, sort_order: map.get(i.id)! } : i
  );
  setMenuItems(items);
}

// ============================================================
// ИЗОБРАЖЕНИЯ → data URL с проверкой лимита
// ============================================================
const MAX_IMAGE_KB = 500;
const COMPRESS_MAX_SIZE = 512;
const COMPRESS_QUALITY = 0.75;

/**
 * Пережимает фото в квадрат через canvas (JPEG), возвращает data URL.
 * ImageCropDialog уже отдаёт готовый File — здесь дополнительно
 * уменьшаем до 512px и quality 0.75, чтобы данные точно помещались
 * в localStorage (5 МБ на всё).
 */
async function compressToDataUrl(
  file: File,
  maxSize: number,
  quality: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(
            1,
            maxSize / Math.max(img.width, img.height)
          );
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas недоступен'));
            return;
          }

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);

          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        } catch (e) {
          reject(e instanceof Error ? e : new Error('Ошибка сжатия'));
        }
      };
      img.onerror = () => reject(new Error('Не удалось загрузить изображение'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsDataURL(file);
  });
}

export async function uploadItemImage(
  file: File,
  itemId: string
): Promise<string | null> {
  void itemId;

  // 1) Сжимаем
  const compressed = await compressToDataUrl(
    file,
    COMPRESS_MAX_SIZE,
    COMPRESS_QUALITY
  );

  // 2) Проверяем размер одного фото
  const sizeKb = Math.round(compressed.length / 1024);
  if (sizeKb > MAX_IMAGE_KB) {
    throw new Error(
      `Фото слишком большое (${sizeKb} КБ, лимит ${MAX_IMAGE_KB} КБ). ` +
        `Уменьшите масштаб в редакторе.`
    );
  }

  // 3) Проверяем, влезет ли в localStorage
  const check = canFitImage(compressed.length);
  if (!check.ok) {
    throw new Error(check.message ?? 'Недостаточно места для фото');
  }

  return compressed;
}

// ============================================================
// ДУБЛИРОВАНИЕ
// ============================================================
function getItemWidthForDup(item: MenuItem): number {
  if (item.type === 'dish' && item.dish_kind === 'group') {
    return Math.max(1, item.variants?.length ?? 1);
  }
  if (item.type === 'set' && item.set_main?.dish_kind === 'group') {
    return Math.max(1, item.set_main.variants?.length ?? 1);
  }
  return 1;
}

export async function duplicateItem(
  sourceId: string
): Promise<MenuItem | null> {
  const allItems = getMenuItems();
  const src = allItems.find((i) => i.id === sourceId);
  if (!src) return null;

  const now = new Date().toISOString();
  const newRootId = newId();

  const clone: MenuItem = JSON.parse(JSON.stringify(src));
  clone.id = newRootId;
  clone.name = `${src.name} (копия)`;
  clone.created_at = now;
  clone.updated_at = now;

  if (clone.properties) {
    clone.properties = clone.properties.map((p) => ({
      ...p,
      id: newId(),
      item_id: newRootId,
    }));
  }

  if (clone.variants) {
    clone.variants = clone.variants.map((v) => {
      const newVid = newId();
      return {
        ...JSON.parse(JSON.stringify(v)),
        id: newVid,
        parent_id: newRootId,
        created_at: now,
        updated_at: now,
        properties: (v.properties ?? []).map((p) => ({
          ...p,
          id: newId(),
          item_id: newVid,
        })),
      };
    });
  }

  if (clone.set_extra_groups) {
    clone.set_extra_groups = clone.set_extra_groups.map((g) => ({
      ...JSON.parse(JSON.stringify(g)),
      id: newId(),
      set_item_id: newRootId,
      options: g.options.map((o) => ({
        ...o,
        option_id: newId(),
      })),
    }));
  }

  const isDishSet = src.type === 'dish' || src.type === 'set';
  const sameSpace = allItems.filter((i) => {
    if (isDishSet) return i.type === 'dish' || i.type === 'set';
    return i.type === src.type;
  });
  const maxEnd = sameSpace.reduce(
    (m, i) => Math.max(m, i.sort_order + getItemWidthForDup(i)),
    0
  );
  clone.sort_order = maxEnd;

  setMenuItems([...allItems, clone]);
  return clone;
}
