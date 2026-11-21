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

  {
    const { data: sess } = await supabase.auth.getSession();
    const who = sess.session?.user.email ?? 'anon (не вошли в Supabase)';
    console.info(`[menu] products из Supabase: ${data.length} · сессия: ${who}`);
    if (data.length === 0) {
      console.warn(
        '[menu] Supabase вернул 0 позиций — проверьте RLS SELECT для роли',
        sess.session ? 'authenticated' : 'anon'
      );
    }
  }

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

/**
 * Точечная синхронизация: отправляет только изменённые карточки и удаляет
 * только удалённые. Не затрагивает остальное меню в облаке.
 * Бросает ошибку при неудаче — вызывающий код повторяет попытку.
 */
export async function upsertProductsPartialToDb(
  changed: MenuItem[],
  removedIds: string[]
): Promise<void> {
  if (changed.length > 0) {
    const now = new Date().toISOString();
    const rows = changed.map((item) => ({
      id: item.id,
      data: item,
      type: item.type,
      name: item.name,
      active: item.active,
      sort_order: item.sort_order,
      updated_at: now,
    }));
    const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'id' });
    if (error) {
      throw new Error(`Supabase partial upsert failed: ${error.message}`);
    }
  }
  if (removedIds.length > 0) {
    const { error } = await supabase.from(TABLE).delete().in('id', removedIds);
    if (error) {
      throw new Error(`Supabase partial delete failed: ${error.message}`);
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
  let inFlight = false;

  // Загрузка меню целиком. Запускается: при старте, на каждое событие
  // realtime, после (пере)подключения канала, при возврате на вкладку,
  // при появлении сети и раз в минуту — иначе планшет, у которого
  // websocket тихо умер, не увидел бы правок меню до перезапуска.
  const refetch = () => {
    if (cancelled || inFlight) return;
    inFlight = true;
    fetchAllProductsFromDb()
      .then((items) => {
        if (!cancelled) callback(items);
      })
      .catch((e: unknown) => {
        console.error('[supabaseDb] refetch failed:', e);
      })
      .finally(() => {
        inFlight = false;
      });
  };

  refetch();

  const channel = supabase
    .channel(CHANNEL_NAME)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE },
      () => {
        // событие могло прийти, пока шёл прошлый запрос — повторим чуть позже
        if (inFlight) window.setTimeout(refetch, 800);
        else refetch();
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') refetch();
      if (status === 'CHANNEL_ERROR') {
        console.error(
          '[supabaseDb] realtime channel error — проверь Publication'
        );
      }
    });

  const onVisible = () => {
    if (document.visibilityState === 'visible') refetch();
  };
  window.addEventListener('online', refetch);
  document.addEventListener('visibilitychange', onVisible);
  const timer = window.setInterval(refetch, 60_000);

  return () => {
    cancelled = true;
    window.clearInterval(timer);
    window.removeEventListener('online', refetch);
    document.removeEventListener('visibilitychange', onVisible);
    supabase.removeChannel(channel).catch(() => {
      /* ignore */
    });
  };
}
