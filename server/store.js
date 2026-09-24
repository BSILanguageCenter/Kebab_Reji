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
  // СИНХРОНИЗАЦИЯ
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
  // МЕНЮ
  // ============================================================
  getMenu() {
    const categories = db
      .prepare('SELECT * FROM menu_categories ORDER BY sort_order')
      .all()
      .map((c) => ({ ...c, active: Boolean(c.active) }));

    const items = db
      .prepare('SELECT * FROM menu_items ORDER BY sort_order')
      .all()
      .map((i) => ({
        ...i,
        active: Boolean(i.active),
        variants: [],
        properties: [],
        set_slots: [],
      }));

    const byId = new Map(items.map((i) => [i.id, i]));

    const variants = db
      .prepare('SELECT * FROM menu_item_variants ORDER BY sort_order')
      .all();
    for (const v of variants) {
      const it = byId.get(v.item_id);
      if (it) it.variants.push(v);
    }

    const properties = db
      .prepare('SELECT * FROM menu_item_properties ORDER BY sort_order')
      .all();
    for (const p of properties) {
      const it = byId.get(p.item_id);
      if (it) it.properties.push({ ...p, is_default: Boolean(p.is_default) });
    }

    const slots = db
      .prepare('SELECT * FROM menu_set_slots ORDER BY sort_order')
      .all();
    for (const s of slots) {
      const it = byId.get(s.set_item_id);
      if (it) it.set_slots.push({ ...s, required: Boolean(s.required) });
    }

    return { categories, items };
  }

  replaceMenu = (
    categories,
    items,
    variants = [],
    properties = [],
    slots = []
  ) => {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM menu_set_slots').run();
      db.prepare('DELETE FROM menu_item_properties').run();
      db.prepare('DELETE FROM menu_item_variants').run();
      db.prepare('DELETE FROM menu_items').run();
      db.prepare('DELETE FROM menu_categories').run();

      const insCat = db.prepare(
        `INSERT INTO menu_categories
         (id, name, short_name, sort_order, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of categories) {
        insCat.run(
          c.id,
          c.name,
          c.short_name ?? '',
          c.sort_order ?? 0,
          c.active ? 1 : 0,
          c.created_at ?? new Date().toISOString(),
          c.updated_at ?? new Date().toISOString()
        );
      }

      const insItem = db.prepare(
        `INSERT INTO menu_items
         (id, category_id, type, name, short_name, price, image_url,
          active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const i of items) {
        insItem.run(
          i.id,
          i.category_id ?? null,
          i.type,
          i.name,
          i.short_name ?? '',
          i.price ?? 0,
          i.image_url ?? null,
          i.active ? 1 : 0,
          i.sort_order ?? 0,
          i.created_at ?? new Date().toISOString(),
          i.updated_at ?? new Date().toISOString()
        );
      }

      const insVar = db.prepare(
        `INSERT INTO menu_item_variants (id, item_id, name, price, sort_order)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const v of variants) {
        insVar.run(v.id, v.item_id, v.name, v.price ?? 0, v.sort_order ?? 0);
      }

      const insProp = db.prepare(
        `INSERT INTO menu_item_properties
         (id, item_id, group_name, name, price, is_default, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const p of properties) {
        insProp.run(
          p.id,
          p.item_id,
          p.group_name ?? null,
          p.name,
          p.price ?? 0,
          p.is_default ? 1 : 0,
          p.sort_order ?? 0
        );
      }

      const insSlot = db.prepare(
        `INSERT INTO menu_set_slots
         (id, set_item_id, slot_type, label, required, sort_order,
          fixed_item_id, source_category_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const s of slots) {
        insSlot.run(
          s.id,
          s.set_item_id,
          s.slot_type,
          s.label ?? '',
          s.required ? 1 : 0,
          s.sort_order ?? 0,
          s.fixed_item_id ?? null,
          s.source_category_id ?? null
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