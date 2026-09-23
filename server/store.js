import { randomUUID } from 'crypto';
import db from './db.js';
import { EventEmitter } from 'events';

/**
 * Обёртка для транзакций (node:sqlite не имеет .transaction())
 */
function tx(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
}

class Store extends EventEmitter {
  constructor() {
    super();

    const row = db
      .prepare('SELECT MAX(order_number) as max_num FROM orders')
      .get();
    this.nextOrderNumber = (row?.max_num ?? 100) + 1;
  }

  // ============================================================
  // ЗАКАЗЫ — чтение
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
  // ЗАКАЗЫ — запись
  // ============================================================
  createOrder = (order) => {
    const id = order.id || randomUUID();
    const number = this.nextOrderNumber++;
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

    this.emit('orders-changed');
    return this.getOrder(id);
  };

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
  // СИНХРОНИЗАЦИЯ С SUPABASE
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
      .map((i) => ({ ...i, active: Boolean(i.active) }));

    return { categories, items };
  }

  replaceMenu = (categories, items) => {
    db.exec('BEGIN');
    try {
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
         (id, category_id, name, short_name, variant, price, image_url,
          active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const i of items) {
        insItem.run(
          i.id,
          i.category_id,
          i.name,
          i.short_name ?? '',
          i.variant ?? '',
          i.price ?? 0,
          i.image_url ?? null,
          i.active ? 1 : 0,
          i.sort_order ?? 0,
          i.created_at ?? new Date().toISOString(),
          i.updated_at ?? new Date().toISOString()
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