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
  console.error('');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

let lastOnline = false;

// ============================================================
// Состояние Realtime — используется в polling fallback
// ============================================================
let realtimeStatus = 'DISCONNECTED';

export function isSupabaseOnline() {
  return lastOnline;
}

export function getSupabaseClient() {
  return supabase;
}

// ============================================================
// BOOTSTRAP + RECONCILE
//
// ⚡ #5: грузим только 7 дней вместо 90 — быстрее старт,
// меньше трафик. Прошлые заказы подгрузит статистика менеджера
// напрямую из Supabase, когда откроют вкладку.
// ============================================================
export async function bootstrapFromSupabase() {
  console.log('[sync] Загрузка данных из Supabase...');

  const since = new Date();
  since.setDate(since.getDate() - 7);
  const sinceIso = since.toISOString();

  const [
    itemsRes,
    propsRes,
    dishSaucesRes,
    setMainRes,
    setOverridesRes,
    setGroupsRes,
    setOptionsRes,
    ordersRes,
    orderItemsRes,
    optionsRes,
  ] = await Promise.all([
    supabase.from('menu_items').select('*').order('sort_order'),
    supabase.from('menu_item_properties').select('*').order('sort_order'),
    supabase.from('menu_dish_sauces').select('*').order('sort_order'),
    supabase.from('menu_set_main').select('*'),
    supabase.from('menu_set_main_overrides').select('*'),
    supabase.from('menu_set_extra_groups').select('*').order('sort_order'),
    supabase.from('menu_set_extra_options').select('*').order('sort_order'),
    supabase.from('orders').select('*').gte('created_at', sinceIso),
    supabase.from('order_items').select('*'),
    supabase.from('order_item_options').select('*'),
  ]);

  if (itemsRes.error || ordersRes.error) {
    console.error(
      '[sync] Ошибка загрузки:',
      itemsRes.error?.message || ordersRes.error?.message
    );
    lastOnline = false;
    return;
  }

  lastOnline = true;

  store.replaceMenu({
    items: itemsRes.data ?? [],
    properties: propsRes.data ?? [],
    dishSauces: dishSaucesRes.data ?? [],
    setMain: setMainRes.data ?? [],
    setMainOverrides: setOverridesRes.data ?? [],
    setExtraGroups: setGroupsRes.data ?? [],
    setExtraOptions: setOptionsRes.data ?? [],
  });

  console.log(
    `[sync] Меню: ${itemsRes.data?.length ?? 0} товаров, ` +
      `${propsRes.data?.length ?? 0} свойств, ` +
      `${dishSaucesRes.data?.length ?? 0} соус-связок, ` +
      `${setMainRes.data?.length ?? 0} set-main, ` +
      `${setGroupsRes.data?.length ?? 0} групп extras, ` +
      `${setOptionsRes.data?.length ?? 0} опций`
  );

  const remoteOrders = ordersRes.data ?? [];
  const remoteItems = (orderItemsRes.data ?? []).filter((i) =>
    remoteOrders.some((o) => o.id === i.order_id)
  );
  const remoteOptions = (optionsRes.data ?? []).filter((opt) =>
    remoteItems.some((i) => i.id === opt.order_item_id)
  );

  reconcileOrders(remoteOrders, remoteItems, remoteOptions);

  console.log('[sync] Bootstrap завершён');

  subscribeToMenuChanges();
  subscribeToOrderChanges();

  startPollingFallback();
}

// ============================================================
// RECONCILE
// ============================================================
function reconcileOrders(remoteOrders, remoteItems, remoteOptions) {
  const localOrders = db
    .prepare('SELECT id, order_number, host_uuid, updated_at, synced FROM orders')
    .all();
  const localMap = new Map();
  for (const o of localOrders) {
    localMap.set(o.id, o);
  }

  let pulledFromRemote = 0;
  let pushedToRemote = 0;
  let unchanged = 0;

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
// SYNC LOOP
// ============================================================
export function startSyncLoop() {
  console.log('[sync] Цикл отправки запущен (интервал 1 сек)');

  const OFFLINE_LOG_INTERVAL_MS = 30_000;
  const ERROR_BACKOFF_MS = 15_000;

  let lastOfflineLogAt = 0;
  let lastOfflineLogCount = -1;

  let dirty = true;
  let lastUnsyncedCount = -1;
  let nextRetryAt = 0;

  store.on('orders-changed', () => {
    dirty = true;
    nextRetryAt = 0;
  });

  setInterval(async () => {
    if (Date.now() < nextRetryAt) return;
    if (!dirty && lastUnsyncedCount === 0) return;

    const unsynced = store.getUnsyncedOrders();
    const count = unsynced.length;
    lastUnsyncedCount = count;

    if (count === 0) {
      dirty = false;
      if (lastOfflineLogCount !== -1) {
        console.log('[sync] ✓ Очередь отправки пуста');
        lastOfflineLogCount = -1;
      }
      return;
    }

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
        nextRetryAt = Date.now() + ERROR_BACKOFF_MS;
        break;
      }
    }

    dirty = false;

    if (successCount > 0) {
      console.log(`[sync] ✓ Отправлено в Supabase: ${successCount} заказ(ов)`);
    }

    const stats = store.getStats();
    if (stats.unsyncedCount > 0 && !lastOnline) {
      const now = Date.now();
      const changed = stats.unsyncedCount !== lastOfflineLogCount;
      const timePassed = now - lastOfflineLogAt >= OFFLINE_LOG_INTERVAL_MS;
      if (changed || timePassed) {
        lastOfflineLogAt = now;
        lastOfflineLogCount = stats.unsyncedCount;
        console.log(
          `[sync] ⏳ ${stats.unsyncedCount} заказ(ов) в очереди (нет интернета)`
        );
      }
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
    host_uuid: order.host_uuid ?? null,
    order_type: order.order_type,
    status: order.status,
    total_amount: order.total_amount,
    comment: order.comment,
    created_at: order.created_at,
    updated_at: order.updated_at,
    completed_at: order.completed_at,
  });

  if (orderErr) {
    if (orderErr.code === '23505') {
      console.warn(
        `[sync] ⚠️ Конфликт уникальности для #${order.order_number} ` +
          `(host=${order.host_uuid}). ` +
          `Проверь SQL-миграцию в Supabase. Повторю позже.`
      );
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
// REALTIME — ORDERS
// ============================================================
let ordersChannel = null;

function subscribeToOrderChanges() {
  if (ordersChannel) return;

  console.log('[sync] 📡 Подписываюсь на Realtime orders...');

  ordersChannel = supabase
    .channel('orders-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      (payload) => {
        const orderId = payload.new?.id || payload.old?.id;
        if (orderId) pullOrderFromSupabase(orderId);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_items' },
      (payload) => {
        const orderId = payload.new?.order_id || payload.old?.order_id;
        if (orderId) pullOrderFromSupabase(orderId);
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

        if (item?.order_id) pullOrderFromSupabase(item.order_id);
      }
    )
    .subscribe((status, err) => {
      // ⚡ #4: сохраняем статус — polling смотрит на него
      realtimeStatus = status;

      console.log(
        `[sync] Realtime orders status: ${status}`,
        err ? `— ${err.message || err}` : ''
      );
      if (status === 'SUBSCRIBED') {
        console.log('[sync] ✅ Realtime orders подписка активна');
      }
      if (status === 'CHANNEL_ERROR') {
        console.error('[sync] ❌ Realtime orders ошибка:', err);
      }
      if (status === 'TIMED_OUT') {
        console.error('[sync] ⏱ Realtime orders timeout');
      }
    });
}

// ============================================================
// PULL ЗАКАЗА ИЗ SUPABASE
// ============================================================
async function pullOrderFromSupabase(orderId) {
  try {
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (error || !order) return;

    const local = db
      .prepare('SELECT updated_at, synced FROM orders WHERE id = ?')
      .get(orderId);

    if (local) {
      const localTime = new Date(local.updated_at).getTime();
      const remoteTime = new Date(
        order.updated_at || order.created_at
      ).getTime();

      if (localTime >= remoteTime) {
        return;
      }
    }

    const { data: items } = await supabase
      .from('order_items')
      .select('*, options:order_item_options(*)')
      .eq('order_id', orderId);

    store.writeRemoteOrder({
      ...order,
      order_items: items ?? [],
    });
  } catch (e) {
    console.error('[sync] pullOrder error:', e.message);
  }
}

// ============================================================
// REALTIME — MENU
// ============================================================
let menuChannel = null;

function subscribeToMenuChanges() {
  if (menuChannel) return;

  console.log('[sync] 📡 Подписываюсь на Realtime menu...');

  menuChannel = supabase
    .channel('menu-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'menu_items' },
      () => reloadMenu()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'menu_item_properties' },
      () => reloadMenu()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'menu_dish_sauces' },
      () => reloadMenu()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'menu_set_main' },
      () => reloadMenu()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'menu_set_main_overrides' },
      () => reloadMenu()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'menu_set_extra_groups' },
      () => reloadMenu()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'menu_set_extra_options' },
      () => reloadMenu()
    )
    .subscribe((status, err) => {
      console.log(
        `[sync] Realtime menu status: ${status}`,
        err ? `— ${err.message || err}` : ''
      );
      if (status === 'SUBSCRIBED') {
        console.log('[sync] ✅ Realtime menu подписка активна');
      }
      if (status === 'CHANNEL_ERROR') {
        console.error('[sync] ❌ Realtime menu ошибка:', err);
      }
    });
}

async function reloadMenu() {
  try {
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

    if (items.data) {
      store.replaceMenu({
        items: items.data,
        properties: props.data ?? [],
        dishSauces: dishSauces.data ?? [],
        setMain: setMain.data ?? [],
        setMainOverrides: setOv.data ?? [],
        setExtraGroups: setGroups.data ?? [],
        setExtraOptions: setOpts.data ?? [],
      });
    }
  } catch (e) {
    console.error('[sync] Ошибка перезагрузки меню:', e.message);
  }
}

// ============================================================
// POLLING FALLBACK
//
// ⚡ #4: если Realtime подписка жива — polling НЕ работает.
// Polling включается только когда Realtime отвалился или в
// состоянии ошибки. Это экономит ~20% трафика Supabase.
// ============================================================
let lastPollTime = null;
let lastMenuCheck = 0;

export function startPollingFallback() {
  console.log(
    '[sync] 🔁 Polling fallback запущен (5 сек, но пропускает при Realtime)'
  );

  const row = db
    .prepare('SELECT MAX(updated_at) as max_time FROM orders')
    .get();
  lastPollTime = row?.max_time ?? new Date(0).toISOString();

  setInterval(async () => {
    // Скипаем, если Realtime работает
    if (realtimeStatus === 'SUBSCRIBED') return;

    try {
      const { data: updatedOrders, error } = await supabase
        .from('orders')
        .select('id, updated_at, order_number')
        .gt('updated_at', lastPollTime)
        .order('updated_at', { ascending: true })
        .limit(20);

      if (error) {
        console.error('[sync] Polling error:', error.message);
        return;
      }

      if (!updatedOrders || updatedOrders.length === 0) {
        return;
      }

      const newestTime = updatedOrders[updatedOrders.length - 1].updated_at;
      if (newestTime > lastPollTime) {
        lastPollTime = newestTime;
      }

      for (const o of updatedOrders) {
        await pullOrderFromSupabase(o.id);
      }
    } catch (e) {
      console.error('[sync] Polling exception:', e.message);
    }
  }, 5000);

  // Меню перезагружаем реже и тоже только если Realtime не работает
  setInterval(async () => {
    if (realtimeStatus === 'SUBSCRIBED') return;
    const now = Date.now();
    if (now - lastMenuCheck < 30000) return;
    lastMenuCheck = now;
    await reloadMenu();
  }, 30000);
}