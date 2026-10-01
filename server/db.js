import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_DIR = join(__dirname, 'data');
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = join(DATA_DIR, 'pos.db');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number INTEGER NOT NULL,
    host_uuid TEXT,
    order_type TEXT NOT NULL,
    status TEXT NOT NULL,
    total_amount INTEGER NOT NULL DEFAULT 0,
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    synced INTEGER NOT NULL DEFAULT 0,
    sync_error TEXT
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    menu_item_id TEXT,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL DEFAULT '',
    variant TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    subtotal INTEGER NOT NULL DEFAULT 0,
    is_removed INTEGER NOT NULL DEFAULT 0,
    is_added_later INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS order_item_options (
    id TEXT PRIMARY KEY,
    order_item_id TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id             TEXT PRIMARY KEY,
    type           TEXT NOT NULL,
    name           TEXT NOT NULL,
    short_name     TEXT NOT NULL DEFAULT '',
    image_url      TEXT,
    price          INTEGER NOT NULL DEFAULT 0,
    free           INTEGER NOT NULL DEFAULT 0,
    station        TEXT,
    cook_time_min  INTEGER,
    color          TEXT,
    dish_kind      TEXT,
    sauce_mode     TEXT,
    parent_id      TEXT,
    active         INTEGER NOT NULL DEFAULT 1,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT,
    updated_at     TEXT,
    FOREIGN KEY (parent_id) REFERENCES menu_items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS menu_item_properties (
    id            TEXT PRIMARY KEY,
    item_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    options_json  TEXT NOT NULL DEFAULT '[]',
    options       TEXT NOT NULL DEFAULT '[]',
    required      INTEGER NOT NULL DEFAULT 0,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (item_id) REFERENCES menu_items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS menu_dish_sauces (
    dish_item_id   TEXT NOT NULL,
    sauce_item_id  TEXT NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (dish_item_id, sauce_item_id),
    FOREIGN KEY (dish_item_id)  REFERENCES menu_items(id) ON DELETE CASCADE,
    FOREIGN KEY (sauce_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS menu_set_main (
    set_item_id   TEXT PRIMARY KEY,
    main_item_id  TEXT NOT NULL,
    FOREIGN KEY (set_item_id)  REFERENCES menu_items(id) ON DELETE CASCADE,
    FOREIGN KEY (main_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS menu_set_main_overrides (
    set_item_id      TEXT NOT NULL,
    variant_item_id  TEXT NOT NULL,
    price_override   INTEGER,
    image_override   TEXT,
    PRIMARY KEY (set_item_id, variant_item_id),
    FOREIGN KEY (set_item_id)     REFERENCES menu_items(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS menu_set_extra_groups (
    id          TEXT PRIMARY KEY,
    set_item_id TEXT NOT NULL,
    label       TEXT NOT NULL DEFAULT '',
    required    INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (set_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS menu_set_extra_options (
    id             TEXT PRIMARY KEY,
    group_id       TEXT NOT NULL,
    item_id        TEXT NOT NULL,
    price_override INTEGER,
    image_override TEXT,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (group_id) REFERENCES menu_set_extra_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id)  REFERENCES menu_items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS printer_settings (
    id            TEXT PRIMARY KEY,
    kitchen_json  TEXT NOT NULL DEFAULT '{}',
    cashier_json  TEXT NOT NULL DEFAULT '{}',
    encoding      TEXT NOT NULL DEFAULT 'cp866',
    updated_at    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_orders_status        ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_synced        ON orders(synced);
  CREATE INDEX IF NOT EXISTS idx_orders_number        ON orders(order_number);
  CREATE INDEX IF NOT EXISTS idx_orders_host_uuid     ON orders(host_uuid);
  CREATE INDEX IF NOT EXISTS idx_orders_host_number   ON orders(host_uuid, order_number);
  CREATE INDEX IF NOT EXISTS idx_items_order          ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_options_item         ON order_item_options(order_item_id);

  CREATE INDEX IF NOT EXISTS idx_menu_items_type      ON menu_items(type);
  CREATE INDEX IF NOT EXISTS idx_menu_items_parent    ON menu_items(parent_id);
  CREATE INDEX IF NOT EXISTS idx_menu_items_active    ON menu_items(active);

  CREATE INDEX IF NOT EXISTS idx_properties_item      ON menu_item_properties(item_id);
  CREATE INDEX IF NOT EXISTS idx_dish_sauces_dish     ON menu_dish_sauces(dish_item_id);
  CREATE INDEX IF NOT EXISTS idx_extra_groups_set     ON menu_set_extra_groups(set_item_id);
  CREATE INDEX IF NOT EXISTS idx_extra_options_group  ON menu_set_extra_options(group_id);
`);

// ============================================================
// МИГРАЦИЯ: printer_settings → JSON-схема
// ============================================================
try {
  const cols = db.prepare('PRAGMA table_info(printer_settings)').all();
  if (cols.length > 0 && !cols.some((c) => c.name === 'kitchen_json')) {
    console.log('[db] Миграция printer_settings → JSON-схема');
    db.exec('DROP TABLE printer_settings');
    db.exec(`
      CREATE TABLE printer_settings (
        id            TEXT PRIMARY KEY,
        kitchen_json  TEXT NOT NULL DEFAULT '{}',
        cashier_json  TEXT NOT NULL DEFAULT '{}',
        encoding      TEXT NOT NULL DEFAULT 'cp866',
        updated_at    TEXT
      )
    `);
  }
} catch (e) {
  console.warn('[db] Migration check failed:', e.message);
}

// ============================================================
// МИГРАЦИЯ: orders → host_uuid
// ============================================================
try {
  const cols = db.prepare('PRAGMA table_info(orders)').all();
  if (cols.length > 0 && !cols.some((c) => c.name === 'host_uuid')) {
    console.log('[db] Миграция orders → добавление host_uuid');
    db.exec('ALTER TABLE orders ADD COLUMN host_uuid TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_host_uuid ON orders(host_uuid)');
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_orders_host_number ON orders(host_uuid, order_number)'
    );
  }
} catch (e) {
  console.warn('[db] orders migration failed:', e.message);
}

// ============================================================
// МИГРАЦИЯ: menu_item_properties → options_json + options + required
// ============================================================
try {
  const cols = db.prepare('PRAGMA table_info(menu_item_properties)').all();
  if (cols.length > 0) {
    const has = (name) => cols.some((c) => c.name === name);

    if (!has('options_json')) {
      console.log('[db] Миграция menu_item_properties → options_json');
      db.exec(
        "ALTER TABLE menu_item_properties ADD COLUMN options_json TEXT NOT NULL DEFAULT '[]'"
      );
    }
    if (!has('options')) {
      console.log('[db] Миграция menu_item_properties → options');
      db.exec(
        "ALTER TABLE menu_item_properties ADD COLUMN options TEXT NOT NULL DEFAULT '[]'"
      );
    }
    if (!has('required')) {
      console.log('[db] Миграция menu_item_properties → required');
      db.exec(
        'ALTER TABLE menu_item_properties ADD COLUMN required INTEGER NOT NULL DEFAULT 0'
      );
    }
  }
} catch (e) {
  console.warn('[db] menu_item_properties migration failed:', e.message);
}

export default db;