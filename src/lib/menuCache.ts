// src/lib/menuCache.ts
import { supabase } from '@/lib/supabase';
import type { Category, Product, RestaurantTable } from '@/lib/types';

// 24 часа — меню меняется редко
const CACHE_TTL = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'menu_cache_v2';

export interface MenuCache {
  categories: Category[];
  products: Product[];
  tables: RestaurantTable[];
  cachedAt: number;
}

let memoryCache: MenuCache | null = null;

// ─── Загрузка ───────────────────────────────────────────────────────────────
export async function loadMenu(force = false): Promise<MenuCache> {
  // 1. Память
  if (!force && memoryCache && Date.now() - memoryCache.cachedAt < CACHE_TTL) {
    return memoryCache;
  }

  // 2. LocalStorage
  if (!force) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MenuCache;
        if (Date.now() - parsed.cachedAt < CACHE_TTL) {
          memoryCache = parsed;
          return parsed;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 3. Свежая загрузка
  return refreshMenu();
}

// ─── Принудительная перезагрузка ────────────────────────────────────────────
export async function refreshMenu(): Promise<MenuCache> {
  const [cats, prods, tables] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name_ru, name_ja, icon, sort_order')
      .order('sort_order'),
    supabase
      .from('products')
      .select(
        'id, category_id, name_ru, name_ja, price, image_url, is_available, is_ready_product, kitchen_station_id, available_modifiers, sort_order'
      )
      .order('sort_order'),
    supabase
      .from('restaurant_tables')
      .select('id, name, status, sort_order')
      .order('sort_order'),
  ]);

  const fresh: MenuCache = {
    categories: (cats.data ?? []) as Category[],
    products: (prods.data ?? []) as Product[],
    tables: (tables.data ?? []) as RestaurantTable[],
    cachedAt: Date.now(),
  };

  memoryCache = fresh;
  saveToStorage(fresh);
  return fresh;
}

// ─── Инвалидация ────────────────────────────────────────────────────────────
export function invalidateMenuCache() {
  memoryCache = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ─── Обновление столов в кэше ───────────────────────────────────────────────
export async function refreshTablesInCache(): Promise<void> {
  const { data } = await supabase
    .from('restaurant_tables')
    .select('id, name, status, sort_order')
    .order('sort_order');
  if (memoryCache && data) {
    memoryCache.tables = data as RestaurantTable[];
    memoryCache.cachedAt = Date.now();
    saveToStorage(memoryCache);
  }
}

// ─── Информация о кэше ──────────────────────────────────────────────────────
export function getCacheInfo(): { cachedAt: number | null; age: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { cachedAt: null, age: '—' };
    const parsed = JSON.parse(raw) as MenuCache;
    const ageMs = Date.now() - parsed.cachedAt;
    const mins = Math.floor(ageMs / 60000);
    const hours = Math.floor(mins / 60);
    const age =
      hours > 0
        ? `${hours} ч ${mins % 60} мин назад`
        : mins > 0
        ? `${mins} мин назад`
        : 'только что';
    return { cachedAt: parsed.cachedAt, age };
  } catch {
    return { cachedAt: null, age: '—' };
  }
}

// ─── Внутреннее ─────────────────────────────────────────────────────────────
function saveToStorage(data: MenuCache) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[menuCache] localStorage save failed:', e);
  }
}