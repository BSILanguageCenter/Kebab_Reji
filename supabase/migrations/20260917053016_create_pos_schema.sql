/*
# Kebab POS — Full Schema

Creates the complete database for a restaurant POS and kitchen order management system.
No authentication is used (single-tenant shared app), so all policies allow anon + authenticated.

## New Tables
1. `kitchen_stations` — Grill, Bar, Salad, etc. Each product is assigned to a station.
2. `categories` — Menu categories (Kebab, Shashlik, Salads, etc.) with RU/JA names and icon.
3. `products` — Menu items with RU/JA names, price, image, availability, station, sort order.
4. `restaurant_tables` — Dining tables with status (free / occupied / waiting_payment).
5. `orders` — Orders with order_number (auto-incrementing), type (dine_in / takeaway), status, timestamps.
6. `order_items` — Snapshot items per order (product name + price captured at order time).
7. `payments` — Payment records (cash / card / other) with received amount and change.
8. `users` — Cashier/staff identifiers (name + role).
9. `printer_settings` — Thermal printer configuration for future ESC/POS support.
10. `restaurant_settings` — Key/value general settings (prep warning time, currency, etc.).

## Security
- RLS enabled on every table.
- All tables allow anon + authenticated full CRUD (shared single-tenant POS terminal).

## Notes
- `order_number` uses a Postgres sequence for auto-incrementing human-readable numbers.
- `order_items` stores product name and price snapshots so old orders are unaffected by menu changes.
- `restaurant_tables` is named to avoid the SQL reserved word `tables`.
*/

-- Sequence for human-readable order numbers
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 100;

-- Kitchen stations
CREATE TABLE IF NOT EXISTS kitchen_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ru text NOT NULL,
  name_ja text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ru text NOT NULL,
  name_ja text NOT NULL,
  icon text NOT NULL DEFAULT 'UtensilsCrossed',
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Products
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  name_ru text NOT NULL,
  name_ja text NOT NULL,
  description_ru text,
  description_ja text,
  price int NOT NULL DEFAULT 0,
  image_url text,
  is_available boolean NOT NULL DEFAULT true,
  kitchen_station_id uuid REFERENCES kitchen_stations(id) ON DELETE SET NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tables (dining)
CREATE TABLE IF NOT EXISTS restaurant_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'free',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number int NOT NULL DEFAULT nextval('order_number_seq'),
  table_id uuid REFERENCES restaurant_tables(id) ON DELETE SET NULL,
  order_type text NOT NULL DEFAULT 'dine_in',
  status text NOT NULL DEFAULT 'new',
  subtotal int NOT NULL DEFAULT 0,
  discount int NOT NULL DEFAULT 0,
  total int NOT NULL DEFAULT 0,
  cashier_id uuid,
  customer_note text,
  created_at timestamptz DEFAULT now(),
  sent_to_kitchen_at timestamptz,
  cooking_started_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz
);

-- Order items (snapshot)
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name_ru text NOT NULL,
  product_name_ja text NOT NULL,
  quantity int NOT NULL DEFAULT 1,
  unit_price int NOT NULL DEFAULT 0,
  total_price int NOT NULL DEFAULT 0,
  note text,
  kitchen_station_id uuid REFERENCES kitchen_stations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz DEFAULT now()
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount int NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'cash',
  received_amount int DEFAULT 0,
  change_amount int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Users (cashiers / staff)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text NOT NULL DEFAULT 'cashier',
  created_at timestamptz DEFAULT now()
);

-- Printer settings
CREATE TABLE IF NOT EXISTS printer_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'mock',
  is_active boolean NOT NULL DEFAULT true,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Restaurant settings (key/value)
CREATE TABLE IF NOT EXISTS restaurant_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text,
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_station ON products(kitchen_station_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

-- Enable RLS on all tables
ALTER TABLE kitchen_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE printer_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_settings ENABLE ROW LEVEL SECURITY;

-- Helper to apply full CRUD policies for a single-tenant table
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'kitchen_stations','categories','products','restaurant_tables',
    'orders','order_items','payments','users','printer_settings','restaurant_settings'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "anon_select_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "anon_select_%s" ON %I FOR SELECT TO anon, authenticated USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "anon_insert_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "anon_insert_%s" ON %I FOR INSERT TO anon, authenticated WITH CHECK (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "anon_update_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "anon_update_%s" ON %I FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "anon_delete_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "anon_delete_%s" ON %I FOR DELETE TO anon, authenticated USING (true)', t, t);
  END LOOP;
END $$;

-- Enable realtime publication for orders and order_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'order_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE order_items;
  END IF;
END $$;

-- Seed kitchen stations
INSERT INTO kitchen_stations (name_ru, name_ja, sort_order) VALUES
  ('Кухня', 'キッチン', 1),
  ('Мангал', 'グリル', 2),
  ('Бар', 'バー', 3),
  ('Салаты', 'サラダ', 4)
ON CONFLICT DO NOTHING;

-- Seed categories
INSERT INTO categories (name_ru, name_ja, icon, sort_order) VALUES
  ('Кебаб', 'ケバブ', 'Flame', 1),
  ('Шашлык', '串焼き', 'Beef', 2),
  ('Салаты', 'サラダ', 'Salad', 3),
  ('Гарниры', 'サイドメニュー', 'Potato', 4),
  ('Напитки', 'ドリンク', 'CupSoda', 5),
  ('Хлеб', 'パン', 'Croissant', 6),
  ('Десерты', 'デザート', 'Cake', 7)
ON CONFLICT DO NOTHING;

-- Seed products
INSERT INTO products (category_id, name_ru, name_ja, price, is_available, kitchen_station_id, sort_order, image_url) VALUES
  -- Кебаб
  ((SELECT id FROM categories WHERE name_ru='Кебаб'), 'Люля-кебаб', 'ルーラケバブ', 900, true, (SELECT id FROM kitchen_stations WHERE name_ru='Мангал'), 1, NULL),
  ((SELECT id FROM categories WHERE name_ru='Кебаб'), 'Куриный кебаб', 'チキンケバブ', 850, true, (SELECT id FROM kitchen_stations WHERE name_ru='Мангал'), 2, NULL),
  ((SELECT id FROM categories WHERE name_ru='Кебаб'), 'Кебаб из говядины', 'ビーフケバブ', 950, true, (SELECT id FROM kitchen_stations WHERE name_ru='Мангал'), 3, NULL),
  ((SELECT id FROM categories WHERE name_ru='Кебаб'), 'Кебаб из баранины', 'ラムケバブ', 1000, true, (SELECT id FROM kitchen_stations WHERE name_ru='Мангал'), 4, NULL),
  -- Шашлык
  ((SELECT id FROM categories WHERE name_ru='Шашлык'), 'Шашлык из свинины', 'ポーク串焼き', 800, true, (SELECT id FROM kitchen_stations WHERE name_ru='Мангал'), 1, NULL),
  ((SELECT id FROM categories WHERE name_ru='Шашлык'), 'Шашлык из курицы', 'チキン串焼き', 750, true, (SELECT id FROM kitchen_stations WHERE name_ru='Мангал'), 2, NULL),
  ((SELECT id FROM categories WHERE name_ru='Шашлык'), 'Шашлык из баранины', 'ラム串焼き', 900, true, (SELECT id FROM kitchen_stations WHERE name_ru='Мангал'), 3, NULL),
  -- Салаты
  ((SELECT id FROM categories WHERE name_ru='Салаты'), 'Салат Шопанский', 'シャパンスキーサラダ', 400, true, (SELECT id FROM kitchen_stations WHERE name_ru='Салаты'), 1, NULL),
  ((SELECT id FROM categories WHERE name_ru='Салаты'), 'Салат Греческий', 'ギリシャ風サラダ', 450, true, (SELECT id FROM kitchen_stations WHERE name_ru='Салаты'), 2, NULL),
  ((SELECT id FROM categories WHERE name_ru='Салаты'), 'Салат Цезарь', 'シーザーサラダ', 500, true, (SELECT id FROM kitchen_stations WHERE name_ru='Салаты'), 3, NULL),
  -- Гарниры
  ((SELECT id FROM categories WHERE name_ru='Гарниры'), 'Картофель фри', 'フライドポテト', 300, true, (SELECT id FROM kitchen_stations WHERE name_ru='Кухня'), 1, NULL),
  ((SELECT id FROM categories WHERE name_ru='Гарниры'), 'Картофель по-деревенски', '田舎風ポテト', 350, true, (SELECT id FROM kitchen_stations WHERE name_ru='Кухня'), 2, NULL),
  ((SELECT id FROM categories WHERE name_ru='Гарниры'), 'Рис', 'ライス', 250, true, (SELECT id FROM kitchen_stations WHERE name_ru='Кухня'), 3, NULL),
  -- Напитки
  ((SELECT id FROM categories WHERE name_ru='Напитки'), 'Кока-Кола', 'コカコーラ', 150, true, (SELECT id FROM kitchen_stations WHERE name_ru='Бар'), 1, NULL),
  ((SELECT id FROM categories WHERE name_ru='Напитки'), 'Зелёный чай', '緑茶', 130, true, (SELECT id FROM kitchen_stations WHERE name_ru='Бар'), 2, NULL),
  ((SELECT id FROM categories WHERE name_ru='Напитки'), 'Кофе', 'コーヒー', 200, true, (SELECT id FROM kitchen_stations WHERE name_ru='Бар'), 3, NULL),
  ((SELECT id FROM categories WHERE name_ru='Напитки'), 'Айран', 'アイラン', 180, true, (SELECT id FROM kitchen_stations WHERE name_ru='Бар'), 4, NULL),
  -- Хлеб
  ((SELECT id FROM categories WHERE name_ru='Хлеб'), 'Лепёшка', 'パン', 100, true, (SELECT id FROM kitchen_stations WHERE name_ru='Кухня'), 1, NULL),
  ((SELECT id FROM categories WHERE name_ru='Хлеб'), 'Пита', 'ピタパン', 100, true, (SELECT id FROM kitchen_stations WHERE name_ru='Кухня'), 2, NULL),
  -- Десерты
  ((SELECT id FROM categories WHERE name_ru='Десерты'), 'Чак-чак', 'チャクチャク', 350, true, (SELECT id FROM kitchen_stations WHERE name_ru='Кухня'), 1, NULL),
  ((SELECT id FROM categories WHERE name_ru='Десерты'), 'Мороженое', 'アイスクリーム', 250, true, (SELECT id FROM kitchen_stations WHERE name_ru='Кухня'), 2, NULL)
ON CONFLICT DO NOTHING;

-- Seed tables
INSERT INTO restaurant_tables (name, status, sort_order) VALUES
  ('Стол 1', 'free', 1),
  ('Стол 2', 'free', 2),
  ('Стол 3', 'free', 3),
  ('Стол 4', 'free', 4),
  ('Стол 5', 'free', 5),
  ('Стол 6', 'free', 6),
  ('Стол 7', 'free', 7),
  ('Стол 8', 'free', 8)
ON CONFLICT DO NOTHING;

-- Seed default settings
INSERT INTO restaurant_settings (key, value) VALUES
  ('prep_warning_minutes', '15'),
  ('currency', 'JPY'),
  ('restaurant_name_ru', 'Кебаб Хаус'),
  ('restaurant_name_ja', 'ケバブハウス')
ON CONFLICT (key) DO NOTHING;

-- Seed a default cashier
INSERT INTO users (name, role) VALUES ('Кассир 1', 'cashier') ON CONFLICT DO NOTHING;

-- Seed a default mock printer
INSERT INTO printer_settings (name, type, is_active, settings) VALUES
  ('Mock Printer', 'mock', true, '{}'::jsonb)
ON CONFLICT DO NOTHING;