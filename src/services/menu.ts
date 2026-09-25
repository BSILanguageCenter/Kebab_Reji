import { supabase } from '@/lib/supabase';
import type {
  MenuItem,
  MenuItemType,
  Station,
  DishKind,
  SauceMode,
} from '@/types/database';

// ============================================================
// ЗАГРУЗКА
// ============================================================
export async function fetchAllMenuItems(): Promise<MenuItem[]> {
  const [items, props, dishSauces, setMain, setOv, setGroups, setOpts] =
    await Promise.all([
      supabase.from('menu_items').select('*').order('sort_order'),
      supabase.from('menu_item_properties').select('*').order('sort_order'),
      supabase.from('menu_dish_sauces').select('*').order('sort_order'),
      supabase.from('menu_set_main').select('*'),
      supabase.from('menu_set_main_overrides').select('*'),
      supabase.from('menu_set_extra_groups').select('*').order('sort_order'),
      supabase.from('menu_set_extra_options').select('*').order('sort_order'),
    ]);

  if (items.error) throw items.error;

  // Индексы
  const itemsById = new Map<string, MenuItem>();
  const rawList: MenuItem[] = (items.data ?? []).map((i) => ({
    ...i,
    active: Boolean(i.active),
    free: Boolean(i.free),
  }));
  for (const it of rawList) itemsById.set(it.id, it);

  const propsByItem = new Map<
    string,
    { id: string; item_id: string; name: string; sort_order: number }[]
  >();
  for (const p of props.data ?? []) {
    const arr = propsByItem.get(p.item_id) ?? [];
    arr.push(p);
    propsByItem.set(p.item_id, arr);
  }

  const sauceIdsByItem = new Map<string, string[]>();
  for (const s of dishSauces.data ?? []) {
    const arr = sauceIdsByItem.get(s.dish_item_id) ?? [];
    arr.push(s.sauce_item_id);
    sauceIdsByItem.set(s.dish_item_id, arr);
  }

  const variantsByParent = new Map<string, MenuItem[]>();
  for (const it of rawList) {
    if (!it.parent_id) continue;
    const arr = variantsByParent.get(it.parent_id) ?? [];
    arr.push(it);
    variantsByParent.set(it.parent_id, arr);
  }

  const mainBySet = new Map<string, string>();
  for (const m of setMain.data ?? [])
    mainBySet.set(m.set_item_id, m.main_item_id);

  const overridesBySet = new Map<
    string,
    Map<string, { price_override: number | null; image_override: string | null }>
  >();
  for (const o of setOv.data ?? []) {
    const map = overridesBySet.get(o.set_item_id) ?? new Map();
    map.set(o.variant_item_id, {
      price_override: o.price_override,
      image_override: o.image_override,
    });
    overridesBySet.set(o.set_item_id, map);
  }

  const groupsBySet = new Map<
    string,
    {
      id: string;
      set_item_id: string;
      label: string;
      required: boolean;
      sort_order: number;
    }[]
  >();
  for (const g of setGroups.data ?? []) {
    const arr = groupsBySet.get(g.set_item_id) ?? [];
    arr.push({ ...g, required: Boolean(g.required) });
    groupsBySet.set(g.set_item_id, arr);
  }

  const optionsByGroup = new Map<
    string,
    {
      id: string;
      group_id: string;
      item_id: string;
      price_override: number | null;
      image_override: string | null;
      sort_order: number;
    }[]
  >();
  for (const o of setOpts.data ?? []) {
    const arr = optionsByGroup.get(o.group_id) ?? [];
    arr.push(o);
    optionsByGroup.set(o.group_id, arr);
  }

  // Hydrate helper
  const hydrateOne = (raw: MenuItem): MenuItem => ({
    ...raw,
    properties: propsByItem.get(raw.id) ?? [],
    allowed_sauces: (sauceIdsByItem.get(raw.id) ?? [])
      .map((sid) => itemsById.get(sid))
      .filter((x): x is MenuItem => !!x)
      .map((s) => ({
        id: s.id,
        name: s.name,
        short_name: s.short_name,
        image_url: s.image_url,
        price: s.price,
        free: s.free,
        color: s.color,
        active: s.active,
      })),
  });

  // Собираем верхнеуровневые
  const result: MenuItem[] = [];
  for (const it of rawList) {
    if (it.parent_id) continue;
    const base = hydrateOne(it);

    if (it.type === 'dish' && it.dish_kind === 'group') {
      const variants = variantsByParent.get(it.id) ?? [];
      base.variants = variants.map(hydrateOne);
    }

    if (it.type === 'set') {
      const mainId = mainBySet.get(it.id);
      const mainRaw = mainId ? itemsById.get(mainId) : null;
      if (mainRaw) {
        const main = hydrateOne(mainRaw);
        if (mainRaw.type === 'dish' && mainRaw.dish_kind === 'group') {
          const variants = variantsByParent.get(mainRaw.id) ?? [];
          main.variants = variants.map((v) => {
            const hyd = hydrateOne(v);
            const ov = overridesBySet.get(it.id)?.get(v.id);
            if (ov) {
              if (ov.price_override != null) hyd.price = ov.price_override;
              if (ov.image_override) hyd.image_url = ov.image_override;
            }
            return hyd;
          });
        }
        base.set_main = main;
      }

      const groups = groupsBySet.get(it.id) ?? [];
      base.set_extra_groups = groups.map((g) => ({
        ...g,
        options: (optionsByGroup.get(g.id) ?? [])
          .map((o) => {
            const optRaw = itemsById.get(o.item_id);
            if (!optRaw) return null;
            const hyd = hydrateOne(optRaw);
            if (o.price_override != null) hyd.price = o.price_override;
            if (o.image_override) hyd.image_url = o.image_override;
            return { option_id: o.id, item: hyd };
          })
          .filter(
            (x): x is { option_id: string; item: MenuItem } => !!x
          ),
      }));
    }

    result.push(base);
  }

  return result;
}

// ============================================================
// SAVE PAYLOAD
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
  properties: { name: string }[];
  allowed_sauce_ids: string[];
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

  properties?: { name: string }[];
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
// СОЗДАНИЕ
// ============================================================
export async function createItem(payload: SaveItemPayload): Promise<MenuItem> {
  const {
    properties = [],
    allowed_sauce_ids = [],
    variants = [],
    set_main_item_id,
    set_main_overrides = [],
    set_extra_groups = [],
    ...base
  } = payload;

  const { data: item, error } = await supabase
    .from('menu_items')
    .insert(base)
    .select()
    .single();
  if (error) throw error;

  const itemId = item.id as string;

  // Свойства и соусы корня — только если НЕ dish-group
  if (base.type !== 'dish' || base.dish_kind !== 'group') {
    if (properties.length) {
      const rows = properties.map((p, i) => ({
        item_id: itemId,
        name: p.name,
        sort_order: i,
      }));
      const { error: e } = await supabase
        .from('menu_item_properties')
        .insert(rows);
      if (e) throw e;
    }
    if (base.sauce_mode === 'with' && allowed_sauce_ids.length) {
      const rows = allowed_sauce_ids.map((sid, i) => ({
        dish_item_id: itemId,
        sauce_item_id: sid,
        sort_order: i,
      }));
      const { error: e } = await supabase
        .from('menu_dish_sauces')
        .insert(rows);
      if (e) throw e;
    }
  }

  // Варианты
  if (base.type === 'dish' && base.dish_kind === 'group' && variants.length) {
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const vBase = {
        type: 'dish',
        parent_id: itemId,
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
        active: true,
        sort_order: i,
      };
      const { data: newV, error: ev } = await supabase
        .from('menu_items')
        .insert(vBase)
        .select()
        .single();
      if (ev) throw ev;

      if (v.properties.length) {
        const rows = v.properties.map((p, j) => ({
          item_id: newV.id,
          name: p.name,
          sort_order: j,
        }));
        const { error: e } = await supabase
          .from('menu_item_properties')
          .insert(rows);
        if (e) throw e;
      }
      if (v.sauce_mode === 'with' && v.allowed_sauce_ids.length) {
        const rows = v.allowed_sauce_ids.map((sid, j) => ({
          dish_item_id: newV.id,
          sauce_item_id: sid,
          sort_order: j,
        }));
        const { error: e } = await supabase
          .from('menu_dish_sauces')
          .insert(rows);
        if (e) throw e;
      }
    }
  }

  // Set
  if (base.type === 'set' && set_main_item_id) {
    const { error: e1 } = await supabase.from('menu_set_main').insert({
      set_item_id: itemId,
      main_item_id: set_main_item_id,
    });
    if (e1) throw e1;

    if (set_main_overrides.length) {
      const rows = set_main_overrides.map((o) => ({
        set_item_id: itemId,
        variant_item_id: o.variant_item_id,
        price_override: o.price_override,
        image_override: o.image_override,
      }));
      const { error: e } = await supabase
        .from('menu_set_main_overrides')
        .insert(rows);
      if (e) throw e;
    }

    if (set_extra_groups.length) {
      for (let i = 0; i < set_extra_groups.length; i++) {
        const g = set_extra_groups[i];
        const { data: newG, error: eg } = await supabase
          .from('menu_set_extra_groups')
          .insert({
            set_item_id: itemId,
            label: g.label,
            required: g.required,
            sort_order: i,
          })
          .select()
          .single();
        if (eg) throw eg;

        if (g.options.length) {
          const rows = g.options.map((o, j) => ({
            group_id: newG.id,
            item_id: o.item_id,
            price_override: o.price_override,
            image_override: o.image_override,
            sort_order: j,
          }));
          const { error: e } = await supabase
            .from('menu_set_extra_options')
            .insert(rows);
          if (e) throw e;
        }
      }
    }
  }

  return item as MenuItem;
}

// ============================================================
// ОБНОВЛЕНИЕ
// ============================================================
export async function updateItem(
  id: string,
  payload: SaveItemPayload
): Promise<MenuItem> {
  const {
    properties = [],
    allowed_sauce_ids = [],
    variants = [],
    set_main_item_id,
    set_main_overrides = [],
    set_extra_groups = [],
    ...base
  } = payload;

  // 1. Обновляем корень
  const { data: item, error } = await supabase
    .from('menu_items')
    .update(base)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  // 2. Чистим вложенные
  await Promise.all([
    supabase.from('menu_item_properties').delete().eq('item_id', id),
    supabase.from('menu_dish_sauces').delete().eq('dish_item_id', id),
    supabase.from('menu_set_main').delete().eq('set_item_id', id),
    supabase.from('menu_set_main_overrides').delete().eq('set_item_id', id),
  ]);

  const { data: oldGroups } = await supabase
    .from('menu_set_extra_groups')
    .select('id')
    .eq('set_item_id', id);

  if (oldGroups?.length) {
    const ids = oldGroups.map((g) => g.id);
    await supabase.from('menu_set_extra_options').delete().in('group_id', ids);
    await supabase
      .from('menu_set_extra_groups')
      .delete()
      .eq('set_item_id', id);
  }

  // 3. Варианты (dish-group)
  if (base.type === 'dish' && base.dish_kind === 'group') {
    const { data: existingChildren } = await supabase
      .from('menu_items')
      .select('id')
      .eq('parent_id', id);

    const existingIds = new Set((existingChildren ?? []).map((c) => c.id));
    const incomingIds = new Set(
      variants.map((v) => v.id).filter((v): v is string => !!v)
    );

    const toDelete = [...existingIds].filter((x) => !incomingIds.has(x));
    if (toDelete.length) {
      await supabase.from('menu_items').delete().in('id', toDelete);
    }

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const vBase = {
        type: 'dish',
        parent_id: id,
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
        active: true,
        sort_order: i,
      };

      let variantId: string;
      if (v.id && existingIds.has(v.id)) {
        await supabase.from('menu_items').update(vBase).eq('id', v.id);
        variantId = v.id;
        await supabase
          .from('menu_item_properties')
          .delete()
          .eq('item_id', v.id);
        await supabase
          .from('menu_dish_sauces')
          .delete()
          .eq('dish_item_id', v.id);
      } else {
        const { data: newV, error: ev } = await supabase
          .from('menu_items')
          .insert(vBase)
          .select()
          .single();
        if (ev) throw ev;
        variantId = newV.id;
      }

      if (v.properties.length) {
        const rows = v.properties.map((p, j) => ({
          item_id: variantId,
          name: p.name,
          sort_order: j,
        }));
        const { error: e } = await supabase
          .from('menu_item_properties')
          .insert(rows);
        if (e) throw e;
      }
      if (v.sauce_mode === 'with' && v.allowed_sauce_ids.length) {
        const rows = v.allowed_sauce_ids.map((sid, j) => ({
          dish_item_id: variantId,
          sauce_item_id: sid,
          sort_order: j,
        }));
        const { error: e } = await supabase
          .from('menu_dish_sauces')
          .insert(rows);
        if (e) throw e;
      }
    }
  } else {
    // Обычные свойства / соусы
    if (properties.length) {
      const rows = properties.map((p, i) => ({
        item_id: id,
        name: p.name,
        sort_order: i,
      }));
      const { error: e } = await supabase
        .from('menu_item_properties')
        .insert(rows);
      if (e) throw e;
    }
    if (base.sauce_mode === 'with' && allowed_sauce_ids.length) {
      const rows = allowed_sauce_ids.map((sid, i) => ({
        dish_item_id: id,
        sauce_item_id: sid,
        sort_order: i,
      }));
      const { error: e } = await supabase
        .from('menu_dish_sauces')
        .insert(rows);
      if (e) throw e;
    }
  }

  // 4. Set
  if (base.type === 'set' && set_main_item_id) {
    const { error: e1 } = await supabase.from('menu_set_main').insert({
      set_item_id: id,
      main_item_id: set_main_item_id,
    });
    if (e1) throw e1;

    if (set_main_overrides.length) {
      const rows = set_main_overrides.map((o) => ({
        set_item_id: id,
        variant_item_id: o.variant_item_id,
        price_override: o.price_override,
        image_override: o.image_override,
      }));
      const { error: e } = await supabase
        .from('menu_set_main_overrides')
        .insert(rows);
      if (e) throw e;
    }

    if (set_extra_groups.length) {
      for (let i = 0; i < set_extra_groups.length; i++) {
        const g = set_extra_groups[i];
        const { data: newG, error: eg } = await supabase
          .from('menu_set_extra_groups')
          .insert({
            set_item_id: id,
            label: g.label,
            required: g.required,
            sort_order: i,
          })
          .select()
          .single();
        if (eg) throw eg;

        if (g.options.length) {
          const rows = g.options.map((o, j) => ({
            group_id: newG.id,
            item_id: o.item_id,
            price_override: o.price_override,
            image_override: o.image_override,
            sort_order: j,
          }));
          const { error: e } = await supabase
            .from('menu_set_extra_options')
            .insert(rows);
          if (e) throw e;
        }
      }
    }
  }

  return item as MenuItem;
}

// ============================================================
// УДАЛЕНИЕ
// ============================================================
export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('menu_items').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
// ПОРЯДОК ОТОБРАЖЕНИЯ
// ============================================================
export async function reorderItems(
  updates: { id: string; sort_order: number }[]
): Promise<void> {
  if (updates.length === 0) return;
  const results = await Promise.all(
    updates.map(({ id, sort_order }) =>
      supabase.from('menu_items').update({ sort_order }).eq('id', id)
    )
  );
  const err = results.find((r) => r.error);
  if (err?.error) throw err.error;
}

// ============================================================
// ИЗОБРАЖЕНИЯ
// ============================================================
export async function uploadItemImage(
  file: File,
  itemId: string
): Promise<string | null> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `menu-items/${itemId}.${ext}`;
  const { error } = await supabase.storage
    .from('menu-images')
    .upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('menu-images').getPublicUrl(path);
  return data.publicUrl;
}