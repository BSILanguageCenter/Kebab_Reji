import { supabase } from '@/lib/supabase';
import type { MenuCategory, MenuItem } from '@/types/database';

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

export async function fetchMenuItems(): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('active', true)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

export async function fetchAllMenuItems(): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

export async function createCategory(
  cat: Omit<MenuCategory, 'id' | 'created_at' | 'updated_at'>
): Promise<MenuCategory> {
  const { data, error } = await supabase
    .from('menu_categories')
    .insert(cat)
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

export async function createItem(
  item: Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>
): Promise<MenuItem> {
  const { data, error } = await supabase
    .from('menu_items')
    .insert(item)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateItem(
  id: string,
  updates: Partial<MenuItem>
): Promise<MenuItem> {
  const { data, error } = await supabase
    .from('menu_items')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('menu_items').delete().eq('id', id);
  if (error) throw error;
}

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
  const { data } = supabase.storage
    .from('menu-images')
    .getPublicUrl(path);
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