// src/services/supabaseDb.ts
/**
 * Supabase DB — хранилище меню (таблица `products`).
 *
 * Одна строка = один MenuItem. Полный MenuItem в `data JSONB`,
 * денормализация: type, name, active, sort_order — для запросов.
 *
 * Realtime: на любое изменение в `products` → refetch all → callback.
 */
import { supabase } from '@/lib/supabase';
import type { MenuItem } from '@/types/database';

const TABLE = 'products';
const CHANNEL_NAME = 'products-realtime';

// ============================================================
// READ
// ============================================================
export async function fetchAllProductsFromDb(): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('data')
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error(
      `Supabase fetchAllProducts failed: ${error.message}`
    );
  }
  if (!data) return [];

  return data
    .map((row) => row.data as MenuItem)
    .filter((it): it is MenuItem => it != null && typeof it === 'object');
}

// ============================================================
// WRITE — full sync
// ============================================================
export async function upsertProductsToDb(
  items: MenuItem[]
): Promise<void> {
  // 1. Прочитать текущие id
  const { data: existingRows, error: readError } = await supabase
    .from(TABLE)
    .select('id');

  if (readError) {
    console.warn(
      '[supabaseDb] read existing ids failed (non-fatal):',
      readError.message
    );
  }

  const existingIds = new Set(
    (existingRows ?? []).map((r) => r.id as string)
  );
  const newIds = new Set(items.map((i) => i.id));

  // 2. Upsert всех items
  if (items.length > 0) {
    const now = new Date().toISOString();
    const rows = items.map((item) => ({
      id: item.id,
      data: item,
      type: item.type,
      name: item.name,
      active: item.active,
      sort_order: item.sort_order,
      updated_at: now,
    }));

    const { error: upsertError } = await supabase
      .from(TABLE)
      .upsert(rows, { onConflict: 'id' });

    if (upsertError) {
      throw new Error(
        `Supabase upsertProducts failed: ${upsertError.message}`
      );
    }
  }

  // 3. Delete removed
  const toDelete = Array.from(existingIds).filter((id) => !newIds.has(id));
  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from(TABLE)
      .delete()
      .in('id', toDelete);

    if (deleteError) {
      console.warn(
        '[supabaseDb] delete removed failed (non-fatal):',
        deleteError.message
      );
    }
  }
}

export async function upsertProductToDb(item: MenuItem): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from(TABLE).upsert(
    {
      id: item.id,
      data: item,
      type: item.type,
      name: item.name,
      active: item.active,
      sort_order: item.sort_order,
      updated_at: now,
    },
    { onConflict: 'id' }
  );

  if (error) {
    throw new Error(`Supabase upsertProduct failed: ${error.message}`);
  }
}

export async function deleteProductFromDb(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) {
    throw new Error(`Supabase deleteProduct failed: ${error.message}`);
  }
}

// ============================================================
// REALTIME
// ============================================================
export function subscribeProductsFromDb(
  callback: (items: MenuItem[]) => void
): () => void {
  let cancelled = false;

  fetchAllProductsFromDb()
    .then((items) => {
      if (!cancelled) callback(items);
    })
    .catch((e: unknown) => {
      console.error('[supabaseDb] initial fetch failed:', e);
    });

  const channel = supabase
    .channel(CHANNEL_NAME)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE },
      () => {
        fetchAllProductsFromDb()
          .then((items) => {
            if (!cancelled) callback(items);
          })
          .catch((e: unknown) => {
            console.error('[supabaseDb] realtime refetch failed:', e);
          });
      }
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.error(
          '[supabaseDb] realtime channel error — проверь Publication'
        );
      }
    });

  return () => {
    cancelled = true;
    supabase.removeChannel(channel).catch(() => {
      /* ignore */
    });
  };
}
