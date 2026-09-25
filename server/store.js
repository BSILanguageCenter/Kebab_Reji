import { randomUUID } from 'crypto';
import db from './db.js';
import { EventEmitter } from 'events';

class Store extends EventEmitter {
  constructor() {
    super();

    const row = db
      .prepare('SELECT MAX(order_number) as max_num FROM orders')
      .get();
    this.nextOrderNumber = (row?.max_num ?? 99) + 1;
  }

  setNextOrderNumber(n) {
    this.nextOrderNumber = n;
  }

  peekNextOrderNumber() {
    return this.nextOrderNumber;
  }

  // ============================================================
  // ЧТЕНИЕ ЗАКАЗОВ
  // ============================================================
  getAllOrders() {
    const orders = db
      .prepare(
        `SELECT * FROM orders
         WHERE status IN ('NEW', 'PREPARING', 'READY')
         ORDER BY created_at ASC`
      )
      .all();

    return orders.map((o) => ({
      ...o,
      synced: Boolean(o.synced),
      order_items: this.getOrderItems(o.id),
    }));
  }

  getOrder(id) {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!o) return null;
    return {
      ...o,
      synced: Boolean(o.synced),
      order_items: this.getOrderItems(o.id),
    };
  }

  getOrderItems(orderId) {
    const items = db
      .prepare(
        'SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid ASC'
      )
      .all(orderId);

    return items.map((i) => ({
      ...i,
      is_removed: Boolean(i.is_removed),
      is_added_later: Boolean(i.is_added_later),
      options: db
        .prepare(
          'SELECT * FROM order_item_options WHERE order_item_id = ? ORDER BY rowid ASC'
        )
        .all(i.id),
    }));
  }

  // ============================================================
  // СОЗДАНИЕ ЗАКАЗА
  // ============================================================
  createOrder = (order) => {
    const id = order.id || randomUUID();
    const number = order.order_number ?? this.nextOrderNumber++;
    const now = new Date().toISOString();

    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT INTO orders
         (id, order_number, order_type, status, total_amount, comment,
          created_at, updated_at, synced)
         VALUES (?, ?, ?, 'NEW', ?, ?, ?, ?, 0)`
      ).run(
        id,
        number,
        order.order_type,
        order.total_amount ?? 0,
        order.comment ?? '',
        now,
        now
      );

      for (const item of order.order_items ?? []) {
        const itemId = item.id || randomUUID();
        db.prepare(
          `INSERT INTO order_items
           (id, order_id, menu_item_id, name, short_name, variant,
            price, quantity, subtotal, is_removed, is_added_later)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          itemId,
          id,
          item.menu_item_id ?? null,
          item.name,
          item.short_name ?? '',
          item.variant ?? '',
          item.price ?? 0,
          item.quantity ?? 1,
          item.subtotal ?? 0,
          item.is_removed ? 1 : 0,
          item.is_added_later ? 1 : 0
        );

        for (const opt of item.options ?? []) {
          db.prepare(
            `INSERT INTO order_item_options
             (id, order_item_id, type, name, price, quantity)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(
            randomUUID(),
            itemId,
            opt.type,
            opt.name,
            opt.price ?? 0,
            opt.quantity ?? 1
          );
        }
      }

      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    if (number >= this.nextOrderNumber) {
      this.nextOrderNumber = number + 1;
    }

    this.emit('orders-changed');
    return this.getOrder(id);
  };

  // ============================================================
  // ОБНОВЛЕНИЕ СТАТУСА
  // ============================================================
  updateStatus(orderId, status) {
    const order = db
      .prepare('SELECT id FROM orders WHERE id = ?')
      .get(orderId);
    if (!order) return null;

    const now = new Date().toISOString();
    const completedAt =
      status === 'COMPLETED' || status === 'CANCELLED' ? now : null;

    db.prepare(
      `UPDATE orders
       SET status = ?, updated_at = ?, completed_at = COALESCE(?, completed_at),
           synced = 0, sync_error = NULL
       WHERE id = ?`
    ).run(status, now, completedAt, orderId);

    this.emit('orders-changed');
    return this.getOrder(orderId);
  }

  // ============================================================
  // РЕДАКТИРОВАНИЕ ЗАКАЗА
  // ============================================================
  updateOrder = (orderId, patch) => {
    const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(orderId);
    if (!order) return null;

    const now = new Date().toISOString();

    db.exec('BEGIN');
    try {
      db.prepare(
        `UPDATE orders
         SET order_type = COALESCE(?, order_type),
             total_amount = COALESCE(?, total_amount),
             comment = COALESCE(?, comment),
             updated_at = ?, synced = 0, sync_error = NULL
         WHERE id = ?`
      ).run(
        patch.order_type ?? null,
        patch.total_amount ?? null,
        patch.comment ?? null,
        now,
        orderId
      );

      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);

      for (const item of patch.order_items ?? []) {
        const itemId = item.id || randomUUID();
        db.prepare(
          `INSERT INTO order_items
           (id, order_id, menu_item_id, name, short_name, variant,
            price, quantity, subtotal, is_removed, is_added_later)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          itemId,
          orderId,
          item.menu_item_id ?? null,
          item.name,
          item.short_name ?? '',
          item.variant ?? '',
          item.price ?? 0,
          item.quantity ?? 1,
          item.subtotal ?? 0,
          item.is_removed ? 1 : 0,
          item.is_added_later ? 1 : 0
        );

        for (const opt of item.options ?? []) {
          db.prepare(
            `INSERT INTO order_item_options
             (id, order_item_id, type, name, price, quantity)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(
            randomUUID(),
            itemId,
            opt.type,
            opt.name,
            opt.price ?? 0,
            opt.quantity ?? 1
          );
        }
      }

      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    this.emit('orders-changed');
    return this.getOrder(orderId);
  };

  // ============================================================
  // ПРИЁМ ЗАКАЗА ИЗ SUPABASE
  // ============================================================
  writeRemoteOrder(remoteOrder) {
    const { order_items = [], ...orderData } = remoteOrder;

    const local = db
      .prepare('SELECT updated_at FROM orders WHERE id = ?')
      .get(orderData.id);

    if (local) {
      const localTime = new Date(local.updated_at).getTime();
      const remoteTime = new Date(
        orderData.updated_at || orderData.created_at
      ).getTime();
      if (localTime > remoteTime) return;
    }

    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT OR REPLACE INTO orders
         (id, order_number, order_type, status, total_amount, comment,
          created_at, updated_at, completed_at, synced, sync_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`
      ).run(
        orderData.id,
        orderData.order_number,
        orderData.order_type,
        orderData.status,
        orderData.total_amount,
        orderData.comment ?? '',
        orderData.created_at,
        orderData.updated_at,
        orderData.completed_at
      );

      const oldItemIds = db
        .prepare('SELECT id FROM order_items WHERE order_id = ?')
        .all(orderData.id)
        .map((r) => r.id);

      for (const oldId of oldItemIds) {
        db.prepare(
          'DELETE FROM order_item_options WHERE order_item_id = ?'
        ).run(oldId);
      }
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(
        orderData.id
      );

      for (const item of order_items) {
        db.prepare(
          `INSERT INTO order_items
           (id, order_id, menu_item_id, name, short_name, variant,
            price, quantity, subtotal, is_removed, is_added_later)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          item.id,
          orderData.id,
          item.menu_item_id ?? null,
          item.name,
          item.short_name ?? '',
          item.variant ?? '',
          item.price ?? 0,
          item.quantity ?? 1,
          item.subtotal ?? 0,
          item.is_removed ? 1 : 0,
          item.is_added_later ? 1 : 0
        );

        for (const opt of item.options ?? []) {
          db.prepare(
            `INSERT INTO order_item_options
             (id, order_item_id, type, name, price, quantity)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(
            opt.id,
            item.id,
            opt.type,
            opt.name,
            opt.price ?? 0,
            opt.quantity ?? 1
          );
        }
      }

      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      console.error('[store] writeRemoteOrder error:', e.message);
      return;
    }

    if (orderData.order_number >= this.nextOrderNumber) {
      this.nextOrderNumber = orderData.order_number + 1;
    }

    this.emit('orders-changed');
  }

  // ============================================================
  // СИНХРОНИЗАЦИЯ ЗАКАЗОВ
  // ============================================================
  getUnsyncedOrders() {
    return db
      .prepare(
        'SELECT id FROM orders WHERE synced = 0 ORDER BY created_at ASC LIMIT 20'
      )
      .all()
      .map((row) => this.getOrder(row.id));
  }

  markSynced(orderId) {
    db.prepare(
      'UPDATE orders SET synced = 1, sync_error = NULL WHERE id = ?'
    ).run(orderId);
  }

  markSyncError(orderId, errorMessage) {
    db.prepare('UPDATE orders SET sync_error = ? WHERE id = ?').run(
      String(errorMessage).slice(0, 500),
      orderId
    );
  }

  getMaxOrderNumber() {
    const row = db
      .prepare('SELECT MAX(order_number) as max_num FROM orders')
      .get();
    return row?.max_num ?? 99;
  }

  // ============================================================
  // МЕНЮ — СБОРКА ВЛОЖЕННОЙ СТРУКТУРЫ
  // ============================================================
  getMenu() {
    // 1. Грузим все таблицы
    const rawItems = db
      .prepare('SELECT * FROM menu_items ORDER BY sort_order')
      .all();
    const rawProps = db
      .prepare('SELECT * FROM menu_item_properties ORDER BY sort_order')
      .all();
    const rawSauces = db
      .prepare('SELECT * FROM menu_dish_sauces ORDER BY sort_order')
      .all();
    const rawSetMain = db.prepare('SELECT * FROM menu_set_main').all();
    const rawOverrides = db
      .prepare('SELECT * FROM menu_set_main_overrides')
      .all();
    const rawGroups = db
      .prepare('SELECT * FROM menu_set_extra_groups ORDER BY sort_order')
      .all();
    const rawOptions = db
      .prepare('SELECT * FROM menu_set_extra_options ORDER BY sort_order')
      .all();

    // 2. Индексы
    const itemsById = new Map();
    for (const it of rawItems) itemsById.set(it.id, it);

    const propsByItem = new Map();
    for (const p of rawProps) {
      const arr = propsByItem.get(p.item_id) ?? [];
      arr.push({ id: p.id, item_id: p.item_id, name: p.name, sort_order: p.sort_order });
      propsByItem.set(p.item_id, arr);
    }

    const sauceIdsByItem = new Map();
    for (const s of rawSauces) {
      const arr = sauceIdsByItem.get(s.dish_item_id) ?? [];
      arr.push(s.sauce_item_id);
      sauceIdsByItem.set(s.dish_item_id, arr);
    }

    const variantsByParent = new Map();
    for (const it of rawItems) {
      if (!it.parent_id) continue;
      const arr = variantsByParent.get(it.parent_id) ?? [];
      arr.push(it);
      variantsByParent.set(it.parent_id, arr);
    }

    const mainBySet = new Map();
    for (const m of rawSetMain) mainBySet.set(m.set_item_id, m.main_item_id);

    const overridesBySet = new Map();
    for (const o of rawOverrides) {
      const map = overridesBySet.get(o.set_item_id) ?? new Map();
      map.set(o.variant_item_id, o);
      overridesBySet.set(o.set_item_id, map);
    }

    const groupsBySet = new Map();
    for (const g of rawGroups) {
      const arr = groupsBySet.get(g.set_item_id) ?? [];
      arr.push(g);
      groupsBySet.set(g.set_item_id, arr);
    }

    const optionsByGroup = new Map();
    for (const o of rawOptions) {
      const arr = optionsByGroup.get(o.group_id) ?? [];
      arr.push(o);
      optionsByGroup.set(o.group_id, arr);
    }

    // 3. Гидратация одного item
    const hydrateOne = (raw) => ({
      ...raw,
      active: Boolean(raw.active),
      free: Boolean(raw.free),
      properties: propsByItem.get(raw.id) ?? [],
      allowed_sauces: (sauceIdsByItem.get(raw.id) ?? [])
        .map((sid) => itemsById.get(sid))
        .filter(Boolean)
        .map((s) => ({
          id: s.id,
          name: s.name,
          short_name: s.short_name,
          image_url: s.image_url,
          price: s.price,
          free: Boolean(s.free),
          color: s.color,
          active: Boolean(s.active),
        })),
    });

    // 4. Собираем верхнеуровневые items
    const result = [];
    for (const it of rawItems) {
      if (it.parent_id) continue;
      if (!it.active) continue;

      const base = hydrateOne(it);

      // dish-group: докидываем варианты
      if (it.type === 'dish' && it.dish_kind === 'group') {
        const variants = variantsByParent.get(it.id) ?? [];
        base.variants = variants
          .filter((v) => v.active)
          .map((v) => hydrateOne(v));
      }

      // set: main + extras
      if (it.type === 'set') {
        const mainId = mainBySet.get(it.id);
        const mainRaw = mainId ? itemsById.get(mainId) : null;
        if (mainRaw) {
          const main = hydrateOne(mainRaw);
          if (mainRaw.type === 'dish' && mainRaw.dish_kind === 'group') {
            const variants = variantsByParent.get(mainRaw.id) ?? [];
            main.variants = variants
              .filter((v) => v.active)
              .map((v) => {
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
          id: g.id,
          set_item_id: g.set_item_id,
          label: g.label,
          required: Boolean(g.required),
          sort_order: g.sort_order,
          options: (optionsByGroup.get(g.id) ?? [])
            .map((o) => {
              const optRaw = itemsById.get(o.item_id);
              if (!optRaw) return null;
              const hyd = hydrateOne(optRaw);
              if (o.price_override != null) hyd.price = o.price_override;
              if (o.image_override) hyd.image_url = o.image_override;
              return {
                option_id: o.id,
                item: hyd,
              };
            })
            .filter(Boolean),
        }));
      }

      result.push(base);
    }

    return { items: result };
  }

  // ============================================================
  // МЕНЮ — ПОЛНАЯ ЗАМЕНА
  // ============================================================
  replaceMenu = ({
    items = [],
    properties = [],
    dishSauces = [],
    setMain = [],
    setMainOverrides = [],
    setExtraGroups = [],
    setExtraOptions = [],
  }) => {
    db.exec('BEGIN');
    try {
      // Чистим всё
      db.prepare('DELETE FROM menu_set_extra_options').run();
      db.prepare('DELETE FROM menu_set_extra_groups').run();
      db.prepare('DELETE FROM menu_set_main_overrides').run();
      db.prepare('DELETE FROM menu_set_main').run();
      db.prepare('DELETE FROM menu_dish_sauces').run();
      db.prepare('DELETE FROM menu_item_properties').run();

      // Сначала обнуляем parent_id, чтобы избежать FK-конфликтов при удалении
      db.prepare('UPDATE menu_items SET parent_id = NULL').run();
      db.prepare('DELETE FROM menu_items').run();

      // Items: сначала без parent (топ-левел), потом с parent
      const insItem = db.prepare(
        `INSERT INTO menu_items
         (id, type, name, short_name, image_url, price, free,
          station, cook_time_min, color, dish_kind, sauce_mode,
          parent_id, active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const sortedItems = [...items].sort((a, b) => {
        const ap = a.parent_id ? 1 : 0;
        const bp = b.parent_id ? 1 : 0;
        return ap - bp;
      });

      for (const i of sortedItems) {
        insItem.run(
          i.id,
          i.type,
          i.name,
          i.short_name ?? '',
          i.image_url ?? null,
          i.price ?? 0,
          i.free ? 1 : 0,
          i.station ?? null,
          i.cook_time_min ?? null,
          i.color ?? null,
          i.dish_kind ?? null,
          i.sauce_mode ?? null,
          i.parent_id ?? null,
          i.active ? 1 : 0,
          i.sort_order ?? 0,
          i.created_at ?? new Date().toISOString(),
          i.updated_at ?? new Date().toISOString()
        );
      }

      const insProp = db.prepare(
        `INSERT INTO menu_item_properties (id, item_id, name, sort_order)
         VALUES (?, ?, ?, ?)`
      );
      for (const p of properties) {
        insProp.run(p.id, p.item_id, p.name, p.sort_order ?? 0);
      }

      const insSauce = db.prepare(
        `INSERT INTO menu_dish_sauces (dish_item_id, sauce_item_id, sort_order)
         VALUES (?, ?, ?)`
      );
      for (const s of dishSauces) {
        insSauce.run(s.dish_item_id, s.sauce_item_id, s.sort_order ?? 0);
      }

      const insMain = db.prepare(
        `INSERT INTO menu_set_main (set_item_id, main_item_id)
         VALUES (?, ?)`
      );
      for (const m of setMain) {
        insMain.run(m.set_item_id, m.main_item_id);
      }

      const insOv = db.prepare(
        `INSERT INTO menu_set_main_overrides
         (set_item_id, variant_item_id, price_override, image_override)
         VALUES (?, ?, ?, ?)`
      );
      for (const o of setMainOverrides) {
        insOv.run(
          o.set_item_id,
          o.variant_item_id,
          o.price_override ?? null,
          o.image_override ?? null
        );
      }

      const insGroup = db.prepare(
        `INSERT INTO menu_set_extra_groups
         (id, set_item_id, label, required, sort_order)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const g of setExtraGroups) {
        insGroup.run(
          g.id,
          g.set_item_id,
          g.label ?? '',
          g.required ? 1 : 0,
          g.sort_order ?? 0
        );
      }

      const insOpt = db.prepare(
        `INSERT INTO menu_set_extra_options
         (id, group_id, item_id, price_override, image_override, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const o of setExtraOptions) {
        insOpt.run(
          o.id,
          o.group_id,
          o.item_id,
          o.price_override ?? null,
          o.image_override ?? null,
          o.sort_order ?? 0
        );
      }

      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    this.emit('menu-changed');
  };

  getStats() {
    const unsyncedCount = db
      .prepare('SELECT COUNT(*) as c FROM orders WHERE synced = 0')
      .get().c;
    const totalOrders = db
      .prepare('SELECT COUNT(*) as c FROM orders')
      .get().c;

    return { unsyncedCount, totalOrders };
  }
}

export const store = new Store();