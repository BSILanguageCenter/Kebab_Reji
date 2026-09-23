import { createClient } from '@supabase/supabase-js';
import { store } from './store.js';
import db from './db.js';

// ============================================================
// Проверка переменных окружения
// (env.js уже загружен через index.js до этого импорта)
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('');
  console.error('❌ [sync] Не найдены SUPABASE_URL или SUPABASE_KEY');
  console.error('');
  console.error('   Проверьте, что в корневом .env есть ХОТЯ БЫ ОДНА пара:');
  console.error('   ─────────────────────────────────────────────────');
  console.error('   Вариант A (рекомендуется):');
  console.error('     VITE_SUPABASE_URL=https://xxx.supabase.co');
  console.error('     VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...');
  console.error('   ─────────────────────────────────────────────────');
  console.error('   Вариант B (только для сервера):');
  console.error('     SUPABASE_URL=https://xxx.supabase.co');
  console.error('     SUPABASE_KEY=sb_publishable_...');
  console.error('   ─────────────────────────────────────────────────');
  console.error('');
  console.error('   Путь к .env должен быть:');
  console.error('     D:\\MyPC\\Desktop\\Project\\Kebab_Reji\\.env');
  console.error('');
  console.error('   Затем перезапустите: npm start');
  console.error('');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let lastOnline = false;

export function isSupabaseOnline() {
  return lastOnline;
}

// ============================================================
// BOOTSTRAP — загрузка меню и активных заказов при старте
// ============================================================
export async function bootstrapFromSupabase() {
  console.log('[sync] Загрузка данных из Supabase...');

  const [catsRes, itemsRes] = await Promise.all([
    supabase.from('menu_categories').select('*').order('sort_order'),
    supabase.from('menu_items').select('*').order('sort_order'),
  ]);

  if (catsRes.error) {
    console.error('[sync] Ошибка categories:', catsRes.error.message);
    lastOnline = false;
    return;
  }
  if (itemsRes.error) {
    console.error('[sync] Ошибка items:', itemsRes.error.message);
    lastOnline = false;
    return;
  }

  if (catsRes.data && itemsRes.data) {
    store.replaceMenu(catsRes.data, itemsRes.data);
    console.log(
      `[sync] Меню загружено: ${catsRes.data.length} категорий, ${itemsRes.data.length} блюд`
    );
    lastOnline = true;
  }

  // Если локальная БД пустая — подтягиваем активные заказы из Supabase
  const localOrdersCount = db
    .prepare('SELECT COUNT(*) as c FROM orders')
    .get().c;

  if (localOrdersCount === 0) {
    const { data: remoteOrders, error } = await supabase
      .from('orders')
      .select('*')
      .in('status', ['NEW', 'PREPARING', 'READY']);

    if (!error && remoteOrders && remoteOrders.length > 0) {
      console.log(
        `[sync] Импортирую ${remoteOrders.length} активных заказов из Supabase`
      );

      for (const o of remoteOrders) {
        try {
          db.prepare(
            `INSERT OR IGNORE INTO orders
             (id, order_number, order_type, status, total_amount, comment,
              created_at, updated_at, completed_at, synced)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
          ).run(
            o.id,
            o.order_number,
            o.order_type,
            o.status,
            o.total_amount,
            o.comment ?? '',
            o.created_at,
            o.updated_at,
            o.completed_at
          );
        } catch (e) {
          console.warn(
            '[sync] Не удалось импортировать заказ:',
            o.id,
            e.message
          );
        }
      }

      // Обновим nextOrderNumber
      const maxRow = db
        .prepare('SELECT MAX(order_number) as max_num FROM orders')
        .get();
      if (maxRow?.max_num) {
        store.nextOrderNumber = maxRow.max_num + 1;
      }
    }
  } else {
    console.log(
      `[sync] Локальная БД содержит ${localOrdersCount} заказов — импорт не нужен`
    );
  }

  console.log('[sync] Bootstrap завершён');
}

// ============================================================
// СИНХРОНИЗАЦИЯ — фоновый цикл каждые 1 секунду
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
// Отправка одного заказа в Supabase
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

  // 2. Удаляем старые позиции
  const { error: delErr } = await supabase
    .from('order_items')
    .delete()
    .eq('order_id', order.id);
  if (delErr) throw delErr;

  // 3. Вставляем позиции заново
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

    // 4. Опции
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