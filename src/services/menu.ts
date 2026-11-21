// src/services/menu.ts
import { patchSlots } from '@/lib/menuOrder';
import type {
  MenuItem,
  MenuItemType,
  DishKind,
  Station,
  SauceMode,
  HydratedProperty,
  HydratedSauce,
  HydratedSetExtraGroup,
  HydratedSetExtraOption,
} from '@/types/database';
import { migrateMenuSchema, pickSingleOption } from '@/lib/menuMigrations';
import {
  getMenuItems,
  setMenuItems,
  newId,
} from '@/lib/localStore';
import { uploadImageToSupabase } from '@/services/supabaseStorage';

// ============================================================
// ТИПЫ ПЕЙЛОАДОВ
// ============================================================
/** Выбранный для продукта соус / напиток / топпинг + доплата. */
export interface AddonPick {
  id: string;
  extra_price: number;
}

export interface PropertyDraftPayload {
  name: string;
  /** Одно значение свойства (массив оставлен для совместимости данных). */
  options: string[];
  required: boolean;
  sort_order?: number;
  price?: number;
}

export interface VariantDraftPayload {
  id?: string;
  name: string;
  short_name: string;
  image_url: string | null;
  price: number;
  free: boolean;
  station: Station;
  cook_time_min: number | null;
  sauce_mode: SauceMode;
  allowed_sauces?: AddonPick[];
  allowed_drinks?: AddonPick[];
  allowed_toppings?: AddonPick[];
  max_sauces?: number;
  max_drinks?: number;
  max_toppings?: number;
  properties?: PropertyDraftPayload[];
}

export interface SetExtraOptionPayload {
  item_id: string;
  price_override: number | null;
  image_override: string | null;
}

export interface SetExtraGroupPayload {
  label: string;
  required: boolean;
  popup?: boolean;
  pick_count?: number;
  pick_set?: boolean;
  options: SetExtraOptionPayload[];
}

export interface SetMainOverridePayload {
  variant_item_id: string;
  price_override: number | null;
  image_override: string | null;
}

export interface SaveItemPayload {
  type: MenuItemType;
  name: string;
  short_name: string;
  image_url: string | null;
  price: number;
  free: boolean;
  active: boolean;
  sort_order: number;
  station: Station | null;
  cook_time_min: number | null;
  color: string | null;
  dish_kind: DishKind | null;
  sauce_mode: SauceMode | null;
  allowed_sauces?: AddonPick[];
  allowed_drinks?: AddonPick[];
  allowed_toppings?: AddonPick[];
  max_sauces?: number;
  max_drinks?: number;
  max_toppings?: number;
  properties?: PropertyDraftPayload[];
  variants?: VariantDraftPayload[];
  set_main_item_id?: string | null;
  set_main_overrides?: SetMainOverridePayload[];
  set_extra_groups?: SetExtraGroupPayload[];
}

export interface ReorderUpdate {
  id: string;
  sort_order: number;
}

// ============================================================
// READ
// ============================================================
export async function fetchAllMenuItems(): Promise<MenuItem[]> {
  const stored = getMenuItems();

  // Миграция схемы (одно значение у свойства). setMenuItems заодно
  // отправит исправленное меню в Supabase.
  const items = migrateMenuSchema(stored);

  // ✅ ФИКС: при каждой загрузке пересобираем set_main всех сетов
  // из актуальных блюд (фото, имена, цены, свойства, варианты).
  // Overrides (своя цена/фото варианта сета) сохраняются.
  const resolved = resolveSetsFromDishes(items);
  if (resolved !== stored) {
    setMenuItems(resolved);
  }
  return resolved;
}

// ============================================================
// CREATE
// ============================================================
export async function createItem(
  payload: SaveItemPayload
): Promise<MenuItem> {
  const now = new Date().toISOString();
  const id = newId();
  const currentMenu = getMenuItems();
  const item = buildItem(id, payload, currentMenu, now, null);
  setMenuItems([...currentMenu, item]);
  return item;
}

// ============================================================
// UPDATE
//
// 1) top-level item → buildItem
// 2) variant блюда  → buildVariant + вставка в parent.variants
//
// Синхронизация сетов с блюдом теперь делается не здесь, а в
// fetchAllMenuItems через resolveSetsFromDishes — чтобы сет
// всегда видел свежие данные блюда, а не только при сохранении.
// ============================================================
export async function updateItem(
  itemId: string,
  payload: SaveItemPayload
): Promise<MenuItem> {
  const currentMenu = getMenuItems();
  const now = new Date().toISOString();

  // ---------- 1) Верхнеуровневый item ----------
  const topIdx = currentMenu.findIndex((i) => i.id === itemId);
  if (topIdx !== -1) {
    const prev = currentMenu[topIdx];
    const updated = buildItem(itemId, payload, currentMenu, now, prev);

    const next = [...currentMenu];
    next[topIdx] = updated;
    setMenuItems(next);
    return updated;
  }

  // ---------- 2) Variant внутри top-level dish ----------
  for (let i = 0; i < currentMenu.length; i++) {
    const parent = currentMenu[i];
    if (!parent.variants || parent.variants.length === 0) continue;

    const vIdx = parent.variants.findIndex((v) => v.id === itemId);
    if (vIdx === -1) continue;

    const prevVariant = parent.variants[vIdx];

    const draft: VariantDraftPayload = {
      id: itemId,
      name: payload.name,
      short_name: payload.short_name,
      image_url: payload.image_url,
      price: payload.price,
      free: payload.free,
      station: (payload.station ?? prevVariant.station ?? 'kitchen') as Station,
      cook_time_min: payload.cook_time_min,
      sauce_mode:
        (payload.sauce_mode ?? prevVariant.sauce_mode ?? 'none') as SauceMode,
      allowed_sauces: payload.allowed_sauces,
      allowed_drinks: payload.allowed_drinks,
      allowed_toppings: payload.allowed_toppings,
      max_sauces: payload.max_sauces,
      max_drinks: payload.max_drinks,
      max_toppings: payload.max_toppings,
      properties: payload.properties,
    };

    const updatedVariant = buildVariant(
      draft,
      parent.id,
      currentMenu,
      now,
      prevVariant
    );

    const nextParent: MenuItem = {
      ...parent,
      updated_at: now,
      variants: parent.variants.map((v, j) =>
        j === vIdx ? updatedVariant : v
      ),
    };

    const next = [...currentMenu];
    next[i] = nextParent;
    setMenuItems(next);
    return updatedVariant;
  }

  throw new Error(`Item not found: ${itemId}`);
}

// ============================================================
// ✅ РЕЗОЛВ СЕТОВ ИЗ БЛЮД
//
// Для каждого сета:
//   1. Берём актуальное блюдо из menu (по set_main.id).
//   2. Клонируем его (варианты, свойства, изображения, цены).
//   3. Применяем overrides — те поля, что в текущем set_main
//      ОТЛИЧАЮТСЯ от блюда, считаем override (своя цена/фото).
//
// Результат записывается обратно в set_main. Имя сета,
// его image_url и extra_groups не трогаются — они принадлежат
// самому сету, а не блюду.
// ============================================================
function resolveSetsFromDishes(items: MenuItem[]): MenuItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const now = new Date().toISOString();
  let anyChanged = false;

  const next = items.map((item) => {
    if (item.type !== 'set') return item;
    const mainId = item.set_main?.id;
    if (!mainId) return item;

    const dish = byId.get(mainId);
    if (!dish) return item;

    const currentMain = item.set_main!;
    const resolvedMain = deepCloneItem(dish, dish.id, now);

    // Переносим overrides из текущего set_main.
    if (resolvedMain.variants && currentMain.variants) {
      const prevVariants = currentMain.variants;

      resolvedMain.variants = resolvedMain.variants.map((v, i) => {
        const prev = prevVariants[i];
        if (!prev) return v;

        const withOv = { ...v };

        // price override
        if (prev.price !== v.price) {
          withOv.price = prev.price;
          withOv.free = prev.price === 0;
        }

        // image override
        if (prev.image_url && prev.image_url !== v.image_url) {
          withOv.image_url = prev.image_url;
        }

        return withOv;
      });
    }

    // Если ничего не поменялось — не трогаем объект (чтобы не было
    // лишних перерисовок / realtime-эхо).
    if (sameSetMain(currentMain, resolvedMain)) {
      return item;
    }

    anyChanged = true;
    return { ...item, set_main: resolvedMain };
  });

  return anyChanged ? next : items;
}

function sameSetMain(a: MenuItem, b: MenuItem): boolean {
  // Сравниваем только те поля, что реально влияют на UI сета.
  if (a.id !== b.id) return false;
  if (a.name !== b.name) return false;
  if (a.short_name !== b.short_name) return false;
  if (a.image_url !== b.image_url) return false;
  if (a.price !== b.price) return false;
  if (addonSig(a) !== addonSig(b)) return false;

  const av = a.variants ?? [];
  const bv = b.variants ?? [];
  if (av.length !== bv.length) return false;

  for (let i = 0; i < av.length; i++) {
    const x = av[i];
    const y = bv[i];
    if (x.name !== y.name) return false;
    if (x.short_name !== y.short_name) return false;
    if (x.image_url !== y.image_url) return false;
    if (x.price !== y.price) return false;
    if (x.free !== y.free) return false;
    if (x.station !== y.station) return false;
    if (x.cook_time_min !== y.cook_time_min) return false;
    if (x.sauce_mode !== y.sauce_mode) return false;
    if (addonSig(x) !== addonSig(y)) return false;
    // properties — поверхностно
    const ap = x.properties ?? [];
    const bp = y.properties ?? [];
    if (ap.length !== bp.length) return false;
    for (let k = 0; k < ap.length; k++) {
      if (ap[k].name !== bp[k].name) return false;
      if (ap[k].required !== bp[k].required) return false;
      if (ap[k].options.join('|') !== bp[k].options.join('|')) return false;
      if ((ap[k].price ?? 0) !== (bp[k].price ?? 0)) return false;
    }
  }

  return true;
}

function addonSig(it: MenuItem): string {
  const one = (list: HydratedSauce[] | undefined) =>
    (list ?? []).map((s) => `${s.id}:${s.extra_price ?? 0}`).join(',');
  return `${one(it.allowed_sauces)}#${one(it.allowed_drinks)}#${one(
    it.allowed_toppings
  )}`;
}

// ============================================================
// DELETE
// ============================================================
export async function deleteItem(
  itemId: string,
  _type?: MenuItemType
): Promise<void> {
  const currentMenu = getMenuItems();

  const topIdx = currentMenu.findIndex((i) => i.id === itemId);
  if (topIdx !== -1) {
    setMenuItems(currentMenu.filter((i) => i.id !== itemId));
    return;
  }

  let changed = false;
  const next = currentMenu.map((parent) => {
    if (!parent.variants || parent.variants.length === 0) return parent;
    const filtered = parent.variants.filter((v) => v.id !== itemId);
    if (filtered.length === parent.variants.length) return parent;
    changed = true;
    return { ...parent, variants: filtered };
  });

  if (!changed) throw new Error(`Item not found: ${itemId}`);
  setMenuItems(next);
}

// ============================================================
// REORDER
// ============================================================
export async function reorderItems(
  updates: ReorderUpdate[]
): Promise<void> {
  if (!updates.length) return;
  const map = new Map(updates.map((u) => [u.id, u.sort_order]));
  // Режим «одна иконка» пишет в sort_order_single, «все блюда» — в sort_order
  setMenuItems(patchSlots(getMenuItems(), map));
}

// ============================================================
// DUPLICATE
// ============================================================
export async function duplicateItem(itemId: string): Promise<MenuItem> {
  const currentMenu = getMenuItems();
  const original = currentMenu.find((i) => i.id === itemId);
  if (!original) throw new Error(`Item not found: ${itemId}`);

  const now = new Date().toISOString();
  const newMainId = newId();
  const clone = deepCloneItem(original, newMainId, now, {
    nameSuffix: ' (copy)',
    sortOrderOffset: 1,
  });

  setMenuItems([...currentMenu, clone]);
  return clone;
}

// ============================================================
// IMAGE UPLOAD
// ============================================================
export async function uploadItemImage(
  file: File,
  itemId?: string
): Promise<string> {
  return uploadImageToSupabase(file, itemId);
}

// ============================================================
// HELPERS
// ============================================================
function buildItem(
  id: string,
  payload: SaveItemPayload,
  currentMenu: MenuItem[],
  now: string,
  prev: MenuItem | null
): MenuItem {
  const item: MenuItem = {
    id,
    type: payload.type,
    name: payload.name.trim(),
    short_name: payload.short_name.trim() || payload.name.trim(),
    image_url: emptyToNull(payload.image_url),
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
    sort_order_single: prev?.sort_order_single,
    created_at: prev?.created_at ?? now,
    updated_at: now,
  };

  if (
    payload.type === 'dish' &&
    payload.dish_kind === 'group' &&
    payload.variants
  ) {
    item.variants = payload.variants.map((v) => {
      const existing = prev?.variants?.find((x) => v.id && x.id === v.id);
      return buildVariant(v, id, currentMenu, now, existing);
    });
  }

  if (payload.type === 'dish' && payload.dish_kind === 'single') {
    attachAddons(item, payload, currentMenu);
    if (payload.properties) {
      item.properties = buildProperties(payload.properties, id);
    }
  }

  if (payload.type === 'topping' && payload.properties) {
    item.properties = buildProperties(payload.properties, id);
  }

  if (payload.type === 'set') {
    if (payload.set_main_item_id) {
      const mainDish = currentMenu.find(
        (i) => i.id === payload.set_main_item_id
      );
      if (mainDish) {
        const mainCopy = deepCloneItem(mainDish, mainDish.id, now);
        applyMainOverrides(
          mainCopy,
          payload.set_main_overrides ?? [],
          item.image_url
        );
        item.set_main = mainCopy;
      }
    }
    if (payload.set_extra_groups) {
      item.set_extra_groups = buildExtraGroups(
        payload.set_extra_groups,
        id,
        currentMenu
      );
    }
  }

  return item;
}

function buildVariant(
  v: VariantDraftPayload,
  parentId: string,
  currentMenu: MenuItem[],
  now: string,
  existing: MenuItem | undefined
): MenuItem {
  const variantId = v.id ?? newId();

  const variant: MenuItem = {
    id: variantId,
    type: 'dish',
    name: v.name.trim(),
    short_name: v.short_name.trim() || v.name.trim(),
    image_url: emptyToNull(v.image_url),
    price: v.free ? 0 : v.price,
    free: v.free,
    station: v.station,
    cook_time_min: v.station === 'kitchen' ? v.cook_time_min : null,
    color: null,
    dish_kind: 'single',
    sauce_mode: v.sauce_mode,
    parent_id: parentId,
    active: true,
    sort_order: existing?.sort_order ?? 0,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  attachAddons(variant, v, currentMenu);
  if (v.properties) {
    variant.properties = buildProperties(v.properties, variantId);
  }
  return variant;
}

function buildProperties(
  drafts: PropertyDraftPayload[],
  itemId: string
): HydratedProperty[] {
  return drafts
    .filter((p) => p.name.trim())
    .map((p, i) => ({
      id: newId(),
      item_id: itemId,
      name: p.name.trim(),
      // у свойства ровно одно значение
      options: pickSingleOption(p.options),
      required: Boolean(p.required),
      sort_order: p.sort_order ?? i,
      ...(typeof p.price === 'number' && p.price > 0 ? { price: p.price } : {}),
    }));
}

type AddonKind = 'sauce' | 'drink' | 'topping';

function resolveAddons(
  picks: AddonPick[],
  currentMenu: MenuItem[],
  kind: AddonKind
): HydratedSauce[] {
  const out: HydratedSauce[] = [];
  for (const pick of picks) {
    const src = currentMenu.find((i) => i.id === pick.id && i.type === kind);
    if (!src || !src.active) continue;
    const extra = Number(pick.extra_price);
    out.push({
      id: src.id,
      name: src.name,
      short_name: src.short_name,
      image_url: src.image_url,
      price: src.price,
      free: src.free,
      color: src.color,
      active: src.active,
      extra_price: Number.isFinite(extra) && extra > 0 ? extra : 0,
    });
  }
  return out;
}

/** Соусы / напитки / топпинги продукта (или варианта группы). */
function attachAddons(
  target: MenuItem,
  src: {
    sauce_mode?: SauceMode | null;
    allowed_sauces?: AddonPick[];
    allowed_drinks?: AddonPick[];
    allowed_toppings?: AddonPick[];
    max_sauces?: number;
    max_drinks?: number;
    max_toppings?: number;
  },
  currentMenu: MenuItem[]
): void {
  const lim = (n: number | undefined) =>
    typeof n === 'number' && n >= 1 ? Math.floor(n) : undefined;
  target.max_sauces = lim(src.max_sauces);
  target.max_drinks = lim(src.max_drinks);
  target.max_toppings = lim(src.max_toppings);
  if (src.sauce_mode === 'with' && src.allowed_sauces) {
    target.allowed_sauces = resolveAddons(src.allowed_sauces, currentMenu, 'sauce');
  }
  if (src.allowed_drinks) {
    target.allowed_drinks = resolveAddons(src.allowed_drinks, currentMenu, 'drink');
  }
  if (src.allowed_toppings) {
    target.allowed_toppings = resolveAddons(
      src.allowed_toppings,
      currentMenu,
      'topping'
    );
  }
}

// ============================================================
// ФИКС: применяем overrides ПО ИНДЕКСУ, а не по variant_item_id.
// После deepCloneItem id вариантов новые, а порядок сохраняется.
// ============================================================
//
// Собственное фото сета (setImage) — картинка по умолчанию для всех
// вариантов, у которых нет своего фото-override.
function applyMainOverrides(
  mainCopy: MenuItem,
  overrides: SetMainOverridePayload[],
  setImage: string | null = null
): void {
  if (!mainCopy.variants || mainCopy.variants.length === 0) return;

  mainCopy.variants = mainCopy.variants.map((v, i) => {
    const ov = overrides[i];
    if (!ov) return setImage ? { ...v, image_url: setImage } : v;
    const next = { ...v };
    if (ov.price_override != null) {
      next.price = ov.price_override;
      next.free = ov.price_override === 0;
    }
    if (ov.image_override != null) {
      next.image_url = ov.image_override;
    } else if (setImage) {
      next.image_url = setImage;
    }
    return next;
  });
}

function buildExtraGroups(
  payloads: SetExtraGroupPayload[],
  setId: string,
  currentMenu: MenuItem[]
): HydratedSetExtraGroup[] {
  const now = new Date().toISOString();
  const groups: HydratedSetExtraGroup[] = [];

  payloads.forEach((g, gi) => {
    const options: HydratedSetExtraOption[] = [];

    for (const opt of g.options) {
      const source = currentMenu.find((i) => i.id === opt.item_id);
      if (!source) continue;

      const copy = deepCloneItem(source, source.id, now);

      if (opt.price_override != null) {
        copy.price = opt.price_override;
        copy.free = opt.price_override === 0;
      }
      if (opt.image_override != null) {
        copy.image_url = opt.image_override;
      }

      options.push({ option_id: newId(), item: copy });
    }

    if (options.length === 0) return;

    groups.push({
      id: newId(),
      set_item_id: setId,
      label: g.label.trim() || '',
      required: Boolean(g.required),
      popup: g.popup !== false,
      pick_count: Math.max(1, Math.min(Math.floor(g.pick_count ?? 1), options.length)),
      pick_set: g.pick_set ? true : undefined,
      sort_order: gi,
      options,
    });
  });

  return groups;
}

function deepCloneItem(
  src: MenuItem,
  newMainId: string,
  now: string,
  opts?: { nameSuffix?: string; sortOrderOffset?: number }
): MenuItem {
  const copy: MenuItem = {
    ...src,
    id: newMainId,
    name: opts?.nameSuffix ? src.name + opts.nameSuffix : src.name,
    short_name: opts?.nameSuffix
      ? src.short_name + opts.nameSuffix
      : src.short_name,
    sort_order: src.sort_order + (opts?.sortOrderOffset ?? 0),
    sort_order_single:
      src.sort_order_single != null
        ? src.sort_order_single + (opts?.sortOrderOffset ?? 0)
        : undefined,
    created_at: now,
    updated_at: now,
    parent_id: null,
  };

  if (src.variants) {
    copy.variants = src.variants.map((v) => ({
      ...v,
      id: newId(),
      parent_id: newMainId,
      created_at: now,
      updated_at: now,
      properties: v.properties
        ? cloneProperties(v.properties, newId())
        : undefined,
      allowed_sauces: v.allowed_sauces ? [...v.allowed_sauces] : undefined,
      allowed_drinks: v.allowed_drinks ? [...v.allowed_drinks] : undefined,
      allowed_toppings: v.allowed_toppings ? [...v.allowed_toppings] : undefined,
    }));
  }

  if (src.properties) {
    copy.properties = cloneProperties(src.properties, newMainId);
  }
  if (src.allowed_sauces) {
    copy.allowed_sauces = [...src.allowed_sauces];
  }
  if (src.allowed_drinks) {
    copy.allowed_drinks = [...src.allowed_drinks];
  }
  if (src.allowed_toppings) {
    copy.allowed_toppings = [...src.allowed_toppings];
  }
  if (src.set_main) {
    copy.set_main = deepCloneItem(src.set_main, src.set_main.id, now);
  }
  if (src.set_extra_groups) {
    copy.set_extra_groups = src.set_extra_groups.map((g) => ({
      ...g,
      id: newId(),
      set_item_id: newMainId,
      options: g.options.map((o) => ({
        option_id: newId(),
        item: deepCloneItem(o.item, o.item.id, now),
      })),
    }));
  }

  return copy;
}

function cloneProperties(
  props: HydratedProperty[],
  itemId: string
): HydratedProperty[] {
  return props.map((p) => ({
    ...p,
    id: newId(),
    item_id: itemId,
  }));
}

function emptyToNull(v: string | null | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}
