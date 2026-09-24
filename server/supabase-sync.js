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

/** Экспорт клиента для host.js */
export function getSupabaseClient() {
  return supabase;
}

// ============================================================
// BOOTSTRAP + RECONCILE
// ============================================================
export async function bootstrapFromSupabase() {
  console.log('[sync] Загрузка данных из Supabase...');

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceIso = since.toISOString();

  const [catsRes, itemsRes, ordersRes, orderItemsRes, optionsRes] =
    await Promise.all([
      supabase.from('menu_categories').select('*').order('sort_order'),
      supabase.from('menu_items').select('*').order('sort_order'),
      supabase.from('orders').select('*').gte('created_at', sinceIso),
      supabase.from('order_items').select('*'),
      supabase.from('order_item_options').select('*'),
    ]);

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

  // Меню
  store.replaceMenu(catsRes.data ?? [], itemsRes.data ?? []);
  console.log(
    `[sync] Меню: ${catsRes.data?.length ?? 0} кат., ${
      itemsRes.data?.length ?? 0
    } блюд`
  );

  // Reconcile заказов
  const remoteOrders = ordersRes.data ?? [];
  const remoteItems = (orderItemsRes.data ?? []).filter((i) =>
    remoteOrders.some((o) => o.id === i.order_id)
  );
  const remoteOptions = (optionsRes.data ?? []).filter((opt) =>
    remoteItems.some((i) => i.id === opt.order_item_id)
  );

  reconcileOrders(remoteOrders, remoteItems, remoteOptions);

  console.log('[sync] Bootstrap завершён');

  // Realtime подписки
  subscribeToMenuChanges();
  subscribeToOrderChanges();
}

// ============================================================
// ДВУСТОРОННЯЯ СИНХРОНИЗАЦИЯ (bootstrap)
// ============================================================
function reconcileOrders(remoteOrders, remoteItems, remoteOptions) {
  const localOrders = db
    .prepare('SELECT id, order_number, updated_at, synced FROM orders')
    .all();
  const localMap = new Map();
  for (const o of localOrders) {
    localMap.set(o.id, o);
  }

  let pulledFromRemote = 0;
  let pushedToRemote = 0;
  let unchanged = 0;

  // Заказы из Supabase
  for (const remote of remoteOrders) {
    const local = localMap.get(remote.id);
    const remoteTime = new Date(
      remote.updated_at || remote.created_at
    ).getTime();

    if (!local) {
      const items = remoteItems
        .filter((i) => i.order_id === remote.id)
        .map((i) => ({
          ...i,
          options: remoteOptions.filter((o) => o.order_item_id === i.id),
        }));

      store.writeRemoteOrder({ ...remote, order_items: items });
      pulledFromRemote++;
      continue;
    }

    const localTime = new Date(local.updated_at).getTime();

    if (remoteTime > localTime) {
      const items = remoteItems
        .filter((i) => i.order_id === remote.id)
        .map((i) => ({
          ...i,
          options: remoteOptions.filter((o) => o.order_item_id === i.id),
        }));

      store.writeRemoteOrder({ ...remote, order_items: items });
      pulledFromRemote++;
    } else if (localTime > remoteTime) {
      db.prepare('UPDATE orders SET synced = 0 WHERE id = ?').run(remote.id);
      pushedToRemote++;
    } else {
      db.prepare(
        'UPDATE orders SET synced = 1, sync_error = NULL WHERE id = ?'
      ).run(remote.id);
      unchanged++;
    }
  }

  // Локальные, которых нет в Supabase
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
// ЦИКЛ ОТПРАВКИ В SUPABASE
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
// ОТПРАВКА ЗАКАЗА В SUPABASE
// ============================================================
async function pushOrderToSupabase(order) {
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

  // Защита от дубликатов
  if (orderErr) {
    if (
      orderErr.code === '23505' ||
      orderErr.message?.includes('orders_order_number_unique')
    ) {
      console.warn(
        `[sync] ⚠️ Конфликт order_number #${order.order_number}. Пропускаем.`
      );
      store.markSynced(order.id);
      return true;
    }
    throw orderErr;
  }

  const { error: delErr } = await supabase
    .from('order_items')
    .delete()
    .eq('order_id', order.id);
  if (delErr) throw delErr;

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

// ============================================================
// REALTIME — ПОДПИСКА НА ORDERS
// ============================================================
let ordersChannel = null;

function subscribeToOrderChanges() {
  if (ordersChannel) return;

  ordersChannel = supabase
    .channel('orders-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      async (payload) => {
        const orderId = payload.new?.id || payload.old?.id;
        if (orderId) await pullOrderFromSupabase(orderId);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_items' },
      async (payload) => {
        const orderId = payload.new?.order_id || payload.old?.order_id;
        if (orderId) await pullOrderFromSupabase(orderId);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_item_options' },
      async (payload) => {
        const orderItemId =
          payload.new?.order_item_id || payload.old?.order_item_id;
        if (!orderItemId) return;

        const { data: item } = await supabase
          .from('order_items')
          .select('order_id')
          .eq('id', orderItemId)
          .maybeSingle();

        if (item?.order_id) await pullOrderFromSupabase(item.order_id);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[sync] Realtime orders подписка активна');
      }
    });
}

// ============================================================
// ПОЛУЧЕНИЕ ЗАКАЗА ИЗ SUPABASE — С ЗАЩИТОЙ ОТ ЭХА
// ============================================================
async function pullOrderFromSupabase(orderId) {
  try {
    // 1. Загружаем заказ
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (error || !order) return;

    // ============================================================
    // 🛡️ ЗАЩИТА ОТ ЭХА
    // Если локально уже есть такая же (или более новая) версия —
    // это НАШЕ СОБСТВЕННОЕ изменение, которое вернулось через Realtime.
    // Не перезаписываем и не эмитим.
    // ============================================================
    const local = db
      .prepare('SELECT updated_at, synced FROM orders WHERE id = ?')
      .get(orderId);

    if (local) {
      const localTime = new Date(local.updated_at).getTime();
      const remoteTime = new Date(
        order.updated_at || order.created_at
      ).getTime();

      // Локальная версия свежее или равна удалённой → ЭХО, игнорируем
      if (localTime >= remoteTime) {
        return;
      }
    }

    // 2. Загружаем items + options
    const { data: items } = await supabase
      .from('order_items')
      .select('*, options:order_item_options(*)')
      .eq('order_id', orderId);

    // 3. Пишем в SQLite с synced=1
    store.writeRemoteOrder({
      ...order,
      order_items: items ?? [],
    });

    console.log(
      `[sync] 📥 Pulled from other host: #${order.order_number} (${order.status})`
    );
  } catch (e) {
    console.error('[sync] pullOrder error:', e.message);
  }
}

// ============================================================
// REALTIME — ПОДПИСКА НА МЕНЮ
// ============================================================
let menuChannel = null;

function subscribeToMenuChanges() {
  if (menuChannel) return;

  menuChannel = supabase
    .channel('menu-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'menu_categories' },
      async () => {
        console.log('[sync] Меню изменилось (categories) — перезагрузка');
        await reloadMenu();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'menu_items' },
      async () => {
        console.log('[sync] Меню изменилось (items) — перезагрузка');
        await reloadMenu();
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[sync] Realtime menu подписка активна');
      }
    });
}

async function reloadMenu() {
  try {
    const [catsRes, itemsRes] = await Promise.all([
      supabase.from('menu_categories').select('*').order('sort_order'),
      supabase.from('menu_items').select('*').order('sort_order'),
    ]);

    if (catsRes.data && itemsRes.data) {
      store.replaceMenu(catsRes.data, itemsRes.data);
      console.log(
        `[sync] Меню обновлено: ${catsRes.data.length} кат., ${itemsRes.data.length} блюд`
      );
    }
  } catch (e) {
    console.error('[sync] Ошибка перезагрузки меню:', e.message);
  }
}