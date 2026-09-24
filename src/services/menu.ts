import { supabase } from '@/lib/supabase';
import type {
  MenuCategory,
  MenuItem,
  MenuItemVariant,
  MenuItemProperty,
  MenuSetSlot,
} from '@/types/database';

// ============================================================
// КАТЕГОРИИ
// ============================================================
export async function fetchCategories(): Promise<MenuCategory[]> {
  const { data, error } = await supabase
    .from('menu_categories')
    .select('*')
    .eq('active', true)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

export async function fetchAllCategories(): Promise<MenuCategory[]> {
  const { data, error } = await supabase
    .from('menu_categories')
    .select('*')
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

export async function createCategory(
  c: Omit<MenuCategory, 'id' | 'created_at' | 'updated_at'>
): Promise<MenuCategory> {
  const { data, error } = await supabase
    .from('menu_categories')
    .insert(c)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCategory(
  id: string,
  updates: Partial<MenuCategory>
): Promise<MenuCategory> {
  const { data, error } = await supabase
    .from('menu_categories')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from('menu_categories')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ============================================================
// ПРОДУКТЫ
// ============================================================
export async function fetchMenuItems(): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('active', true)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

/**
 * Тянет весь каталог с nested-связями (variants/properties/set_slots).
 */
export async function fetchAllMenuItems(): Promise<MenuItem[]> {
  const [itemsRes, variantsRes, propsRes, slotsRes] = await Promise.all([
    supabase.from('menu_items').select('*').order('sort_order'),
    supabase.from('menu_item_variants').select('*').order('sort_order'),
    supabase.from('menu_item_properties').select('*').order('sort_order'),
    supabase.from('menu_set_slots').select('*').order('sort_order'),
  ]);

  if (itemsRes.error) throw itemsRes.error;
  if (variantsRes.error) throw variantsRes.error;
  if (propsRes.error) throw propsRes.error;
  if (slotsRes.error) throw slotsRes.error;

  const list: MenuItem[] = (itemsRes.data ?? []).map((i) => ({
    ...i,
    variants: [],
    properties: [],
    set_slots: [],
  }));
  const byId = new Map(list.map((i) => [i.id, i]));

  for (const v of variantsRes.data ?? []) {
    const it = byId.get(v.item_id);
    if (it) it.variants!.push(v);
  }
  for (const p of propsRes.data ?? []) {
    const it = byId.get(p.item_id);
    if (it) it.properties!.push(p);
  }
  for (const s of slotsRes.data ?? []) {
    const it = byId.get(s.set_item_id);
    if (it) it.set_slots!.push(s);
  }
  return list;
}

/**
 * Payload для создания/обновления продукта.
 * Принимает вложенные массивы без id/родительских ссылок — сервис сам их проставит.
 */
export interface SaveItemPayload {
  category_id: string | null;
  type: MenuItem['type'];
  name: string;
  short_name: string;
  price: number;
  image_url: string | null;
  active: boolean;
  sort_order: number;
  variants?: Omit<MenuItemVariant, 'id' | 'item_id'>[];
  properties?: Omit<MenuItemProperty, 'id' | 'item_id'>[];
  set_slots?: Omit<MenuSetSlot, 'id' | 'set_item_id'>[];
}

export async function createItem(payload: SaveItemPayload): Promise<MenuItem> {
  const { variants = [], properties = [], set_slots = [], ...base } = payload;

  const { data: item, error } = await supabase
    .from('menu_items')
    .insert(base)
    .select()
    .single();
  if (error) throw error;

  if (variants.length) {
    const rows = variants.map((v, i) => ({
      item_id: item.id,
      name: v.name,
      price: v.price,
      sort_order: i,
    }));
    const { error: e } = await supabase
      .from('menu_item_variants')
      .insert(rows);
    if (e) throw e;
  }

  if (properties.length) {
    const rows = properties.map((p, i) => ({
      item_id: item.id,
      group_name: p.group_name,
      name: p.name,
      price: p.price,
      is_default: p.is_default,
      sort_order: i,
    }));
    const { error: e } = await supabase
      .from('menu_item_properties')
      .insert(rows);
    if (e) throw e;
  }

  if (set_slots.length) {
    const rows = set_slots.map((s, i) => ({
      set_item_id: item.id,
      slot_type: s.slot_type,
      label: s.label,
      required: s.required,
      sort_order: i,
      fixed_item_id: s.fixed_item_id,
      source_category_id: s.source_category_id,
    }));
    const { error: e } = await supabase
      .from('menu_set_slots')
      .insert(rows);
    if (e) throw e;
  }

  return item;
}

export async function updateItem(
  id: string,
  payload: SaveItemPayload
): Promise<MenuItem> {
  const { variants = [], properties = [], set_slots = [], ...base } = payload;

  const { data: item, error } = await supabase
    .from('menu_items')
    .update(base)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  // Полная замена вложенных сущностей
  await Promise.all([
    supabase.from('menu_item_variants').delete().eq('item_id', id),
    supabase.from('menu_item_properties').delete().eq('item_id', id),
    supabase.from('menu_set_slots').delete().eq('set_item_id', id),
  ]);

  if (variants.length) {
    const rows = variants.map((v, i) => ({
      item_id: id,
      name: v.name,
      price: v.price,
      sort_order: i,
    }));
    const { error: e } = await supabase
      .from('menu_item_variants')
      .insert(rows);
    if (e) throw e;
  }

  if (properties.length) {
    const rows = properties.map((p, i) => ({
      item_id: id,
      group_name: p.group_name,
      name: p.name,
      price: p.price,
      is_default: p.is_default,
      sort_order: i,
    }));
    const { error: e } = await supabase
      .from('menu_item_properties')
      .insert(rows);
    if (e) throw e;
  }

  if (set_slots.length) {
    const rows = set_slots.map((s, i) => ({
      set_item_id: id,
      slot_type: s.slot_type,
      label: s.label,
      required: s.required,
      sort_order: i,
      fixed_item_id: s.fixed_item_id,
      source_category_id: s.source_category_id,
    }));
    const { error: e } = await supabase
      .from('menu_set_slots')
      .insert(rows);
    if (e) throw e;
  }

  return item;
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('menu_items').delete().eq('id', id);
  if (error) throw error;
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

/**
 * Логика «одно фото на категорию»:
 * применяет указанный URL ко всем позициям категории.
 */
export async function applyImageToCategory(
  categoryId: string,
  imageUrl: string
): Promise<void> {
  const { error } = await supabase
    .from('menu_items')
    .update({ image_url: imageUrl })
    .eq('category_id', categoryId);
  if (error) throw error;
}

/**
 * Убирает фото у всех позиций категории.
 */
export async function clearImageFromCategory(
  categoryId: string
): Promise<void> {
  const { error } = await supabase
    .from('menu_items')
    .update({ image_url: null })
    .eq('category_id', categoryId);
  if (error) throw error;
}