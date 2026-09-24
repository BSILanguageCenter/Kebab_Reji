import { createClient } from '@supabase/supabase-js';
import { store } from './store.js';
import db from './db.js';

// ============================================================
// Проверка переменных окружения
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('');
  console.error('❌ [sync] Не найдены SUPABASE_URL или SUPABASE_KEY');
  console.error('   Проверьте файл .env в КОРНЕ проекта.');
  console.error('');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let lastOnline = false;

export function isSupabaseOnline() {
  return lastOnline;
}

// ============================================================
// BOOTSTRAP + RECONCILE
// ============================================================
export async function bootstrapFromSupabase() {
  console.log('[sync] Загрузка данных из Supabase...');

  // Ограничиваем выборку заказов последними 90 днями
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceIso = since.toISOString();

  const [catsRes, itemsRes, ordersRes, orderItemsRes, optionsRes] =
    await Promise.all([
      supabase.from('menu_categories').select('*').order('sort_order'),
      supabase.from('menu_items').select('*').order('sort_order'),
      supabase
        .from('orders')
        .select('*')
        .gte('created_at', sinceIso),
      supabase.from('order_items').select('*'),
      supabase.from('order_item_options').select('*'),
    ]);

  // Проверка ошибок
  if (catsRes.error || itemsRes.error || ordersRes.error) {
    console.error(
      '[sync] Ошибка загрузки:',
      catsRes.error?.message ||
        itemsRes.error?.message ||
        ordersRes.error?.message
    );
    lastOnline = false;
    return;
  }

  lastOnline = true;

  // ---------- Меню — Supabase источник истины ----------
  store.replaceMenu(catsRes.data ?? [], itemsRes.data ?? []);
  console.log(
    `[sync] Меню: ${catsRes.data?.length ?? 0} кат., ${
      itemsRes.data?.length ?? 0
    } блюд`
  );

  // ---------- Заказы — двусторонний reconcile ----------
  const remoteOrders = ordersRes.data ?? [];
  const remoteItems = (orderItemsRes.data ?? []).filter((i) =>
    remoteOrders.some((o) => o.id === i.order_id)
  );
  const remoteOptions = (optionsRes.data ?? []).filter((opt) =>
    remoteItems.some((i) => i.id === opt.order_item_id)
  );

  reconcileOrders(remoteOrders, remoteItems, remoteOptions);

  console.log('[sync] Bootstrap завершён');
}

// ============================================================
// ДВУСТОРОННЯЯ СИНХРОНИЗАЦИЯ ЗАКАЗОВ
// ============================================================
function reconcileOrders(remoteOrders, remoteItems, remoteOptions) {
  const remoteMap = new Map();
  for (const o of remoteOrders) {
    remoteMap.set(o.id, o);
  }

  const localOrders = db
    .prepare('SELECT id, order_number, updated_at, synced FROM orders')
    .all();
  const localMap = new Map();
  for (const o of localOrders) {
    localMap.set(o.id, o);
  }

  let pulledFromRemote = 0; // из Supabase → локально
  let pushedToRemote = 0;   // локально → на отправку
  let unchanged = 0;

  // ---------- 1. Проходим по заказам из Supabase ----------
  for (const remote of remoteOrders) {
    const local = localMap.get(remote.id);
    const remoteTime = new Date(remote.updated_at || remote.created_at).getTime();

    if (!local) {
      // Заказа нет локально — вставляем полностью
      writeOrderLocally(remote, remoteItems, remoteOptions, true);
      pulledFromRemote++;
      continue;
    }

    const localTime = new Date(local.updated_at).getTime();

    if (remoteTime > localTime) {
      // Supabase новее — перезаписываем локальное
      writeOrderLocally(remote, remoteItems, remoteOptions, true);
      pulledFromRemote++;
    } else if (localTime > remoteTime) {
      // Локальное новее — помечаем на отправку
      db.prepare('UPDATE orders SET synced = 0 WHERE id = ?').run(remote.id);
      pushedToRemote++;
    } else {
      // Равны — просто убеждаемся что synced = 1
      db.prepare(
        'UPDATE orders SET synced = 1, sync_error = NULL WHERE id = ?'
      ).run(remote.id);
      unchanged++;
    }
  }

  // ---------- 2. Проходим по локальным, которых нет в Supabase ----------
  const remoteIds = new Set(remoteOrders.map((o) => o.id));
  for (const local of localOrders) {
    if (!remoteIds.has(local.id)) {
      db.prepare('UPDATE orders SET synced = 0 WHERE id = ?').run(local.id);
      pushedToRemote++;
    }
  }

  console.log(
    `[sync] Reconcile: +${pulledFromRemote} из Supabase, ${pushedToRemote} на отправку, ${unchanged} без изменений`
  );
}

// ============================================================
// ВСТАВКА ИЛИ ОБНОВЛЕНИЕ ЗАКАЗА В SQLITE
// ============================================================
function writeOrderLocally(remote, allItems, allOptions, synced) {
  const items = allItems.filter((i) => i.order_id === remote.id);

  db.exec('BEGIN');
  try {
    // Вставляем / обновляем заказ
    db.prepare(
      `INSERT OR REPLACE INTO orders
       (id, order_number, order_type, status, total_amount, comment,
        created_at, updated_at, completed_at, synced, sync_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      remote.id,
      remote.order_number,
      remote.order_type,
      remote.status,
      remote.total_amount,
      remote.comment ?? '',
      remote.created_at,
      remote.updated_at,
      remote.completed_at,
      synced ? 1 : 0
    );

    // Удаляем старые items и options
    const oldItemIds = db
      .prepare('SELECT id FROM order_items WHERE order_id = ?')
      .all(remote.id)
      .map((r) => r.id);

    for (const oldId of oldItemIds) {
      db.prepare('DELETE FROM order_item_options WHERE order_item_id = ?').run(
        oldId
      );
    }
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(remote.id);

    // Вставляем новые items
    for (const item of items) {
      db.prepare(
        `INSERT INTO order_items
         (id, order_id, menu_item_id, name, short_name, variant,
          price, quantity, subtotal, is_removed, is_added_later)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        item.id,
        item.order_id,
        item.menu_item_id,
        item.name,
        item.short_name ?? '',
        item.variant ?? '',
        item.price,
        item.quantity,
        item.subtotal,
        item.is_removed ? 1 : 0,
        item.is_added_later ? 1 : 0
      );

      // Опции для этого item
      const opts = allOptions.filter((o) => o.order_item_id === item.id);
      for (const opt of opts) {
        db.prepare(
          `INSERT INTO order_item_options
           (id, order_item_id, type, name, price, quantity)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          opt.id,
          opt.order_item_id,
          opt.type,
          opt.name,
          opt.price,
          opt.quantity
        );
      }
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('[sync] Ошибка записи заказа:', remote.id, e.message);
  }
}

// ============================================================
// ЦИКЛ ОТПРАВКИ В SUPABASE — как было
// ============================================================
export function startSyncLoop() {
  console.log('[sync] Цикл синхронизации запущен (интервал 1 сек)');

  setInterval(async () => {
    const unsynced = store.getUnsyncedOrders();
    if (unsynced.length === 0) return;

    let successCount = 0;

    for (const order of unsynced) {
      try {
        await pushOrderToSupabase(order);
        store.markSynced(order.id);
        successCount++;
        lastOnline = true;
      } catch (e) {
        lastOnline = false;
        store.markSyncError(order.id, e.message);
        break;
      }
    }

    if (successCount > 0) {
      console.log(`[sync] ✓ Отправлено в Supabase: ${successCount} заказ(ов)`);
    }

    const stats = store.getStats();
    if (stats.unsyncedCount > 0 && !lastOnline) {
      console.log(
        `[sync] ⏳ ${stats.unsyncedCount} заказ(ов) в очереди (нет интернета)`
      );
    }
  }, 1000);
}

// ============================================================
// ОТПРАВКА ОДНОГО ЗАКАЗА В SUPABASE
// ============================================================
async function pushOrderToSupabase(order) {
  // 1. UPSERT заказа
  const { error: orderErr } = await supabase.from('orders').upsert({
    id: order.id,
    order_number: order.order_number,
    order_type: order.order_type,
    status: order.status,
    total_amount: order.total_amount,
    comment: order.comment,
    created_at: order.created_at,
    updated_at: order.updated_at,
    completed_at: order.completed_at,
  });
  if (orderErr) throw orderErr;

  // 2. Удаляем старые items
  const { error: delErr } = await supabase
    .from('order_items')
    .delete()
    .eq('order_id', order.id);
  if (delErr) throw delErr;

  // 3. Вставляем заново
  if (order.order_items?.length) {
    const itemsPayload = order.order_items.map((i) => ({
      id: i.id,
      order_id: order.id,
      menu_item_id: i.menu_item_id,
      name: i.name,
      short_name: i.short_name,
      variant: i.variant,
      price: i.price,
      quantity: i.quantity,
      subtotal: i.subtotal,
      is_removed: i.is_removed,
      is_added_later: i.is_added_later,
    }));

    const { error: itemsErr } = await supabase
      .from('order_items')
      .insert(itemsPayload);
    if (itemsErr) throw itemsErr;

    const optsPayload = [];
    for (const i of order.order_items) {
      for (const o of i.options ?? []) {
        optsPayload.push({
          id: o.id,
          order_item_id: i.id,
          type: o.type,
          name: o.name,
          price: o.price,
          quantity: o.quantity,
        });
      }
    }

    if (optsPayload.length) {
      const { error: optsErr } = await supabase
        .from('order_item_options')
        .insert(optsPayload);
      if (optsErr) throw optsErr;
    }
  }

  return true;
}