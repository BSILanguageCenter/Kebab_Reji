/*
# Kebab POS — Seed Initial Menu Data

Populates menu_categories and menu_items with the full initial menu from the spec.
Uses a DO block to insert categories and items idempotently, storing category IDs in variables.
*/

DO $$
DECLARE
  v_kebab_sandwich uuid;
  v_kebab_wrap uuid;
  v_kebab_don uuid;
  v_otsumami uuid;
  v_ks_set uuid;
  v_kw_set uuid;
  v_kd_set uuid;
  v_ok_set uuid;
  v_fries uuid;
  v_drinks uuid;
  v_toppings uuid;
  v_sauces uuid;
BEGIN
  -- Categories
  INSERT INTO menu_categories (name, short_name, sort_order, active)
  VALUES ('Kebab Sandwich', 'KS', 1, true)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_kebab_sandwich;

  IF v_kebab_sandwich IS NULL THEN
    SELECT id INTO v_kebab_sandwich FROM menu_categories WHERE name = 'Kebab Sandwich' LIMIT 1;
  END IF;

  INSERT INTO menu_categories (name, short_name, sort_order, active)
  VALUES ('Kebab Wrap', 'KW', 2, true)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_kebab_wrap;

  IF v_kebab_wrap IS NULL THEN
    SELECT id INTO v_kebab_wrap FROM menu_categories WHERE name = 'Kebab Wrap' LIMIT 1;
  END IF;

  INSERT INTO menu_categories (name, short_name, sort_order, active)
  VALUES ('Kebab Don', 'KD', 3, true)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_kebab_don;

  IF v_kebab_don IS NULL THEN
    SELECT id INTO v_kebab_don FROM menu_categories WHERE name = 'Kebab Don' LIMIT 1;
  END IF;

  INSERT INTO menu_categories (name, short_name, sort_order, active)
  VALUES ('Otsumami Kebab', 'OK', 4, true)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_otsumami;

  IF v_otsumami IS NULL THEN
    SELECT id INTO v_otsumami FROM menu_categories WHERE name = 'Otsumami Kebab' LIMIT 1;
  END IF;

  INSERT INTO menu_categories (name, short_name, sort_order, active)
  VALUES ('Kebab Sandwich Set', 'KSS', 5, true)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_ks_set;

  IF v_ks_set IS NULL THEN
    SELECT id INTO v_ks_set FROM menu_categories WHERE name = 'Kebab Sandwich Set' LIMIT 1;
  END IF;

  INSERT INTO menu_categories (name, short_name, sort_order, active)
  VALUES ('Kebab Wrap Set', 'KWS', 6, true)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_kw_set;

  IF v_kw_set IS NULL THEN
    SELECT id INTO v_kw_set FROM menu_categories WHERE name = 'Kebab Wrap Set' LIMIT 1;
  END IF;

  INSERT INTO menu_categories (name, short_name, sort_order, active)
  VALUES ('Kebab Don Set', 'KDS', 7, true)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_kd_set;

  IF v_kd_set IS NULL THEN
    SELECT id INTO v_kd_set FROM menu_categories WHERE name = 'Kebab Don Set' LIMIT 1;
  END IF;

  INSERT INTO menu_categories (name, short_name, sort_order, active)
  VALUES ('Otsumami Kebab Set', 'OKS', 8, true)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_ok_set;

  IF v_ok_set IS NULL THEN
    SELECT id INTO v_ok_set FROM menu_categories WHERE name = 'Otsumami Kebab Set' LIMIT 1;
  END IF;

  INSERT INTO menu_categories (name, short_name, sort_order, active)
  VALUES ('French Fries', 'FF', 9, true)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_fries;

  IF v_fries IS NULL THEN
    SELECT id INTO v_fries FROM menu_categories WHERE name = 'French Fries' LIMIT 1;
  END IF;

  INSERT INTO menu_categories (name, short_name, sort_order, active)
  VALUES ('Soft Drinks', 'SD', 10, true)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_drinks;

  IF v_drinks IS NULL THEN
    SELECT id INTO v_drinks FROM menu_categories WHERE name = 'Soft Drinks' LIMIT 1;
  END IF;

  INSERT INTO menu_categories (name, short_name, sort_order, active)
  VALUES ('Toppings', 'TOP', 11, true)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_toppings;

  IF v_toppings IS NULL THEN
    SELECT id INTO v_toppings FROM menu_categories WHERE name = 'Toppings' LIMIT 1;
  END IF;

  INSERT INTO menu_categories (name, short_name, sort_order, active)
  VALUES ('Sauces', 'SAU', 12, true)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_sauces;

  IF v_sauces IS NULL THEN
    SELECT id INTO v_sauces FROM menu_categories WHERE name = 'Sauces' LIMIT 1;
  END IF;

  -- Menu Items
  -- Kebab Sandwich
  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kebab_sandwich, 'Kebab Sandwich', 'KS', 'Chicken', 350, true, 1
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kebab_sandwich AND variant = 'Chicken');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kebab_sandwich, 'Kebab Sandwich', 'KS', 'Mix', 500, true, 2
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kebab_sandwich AND variant = 'Mix');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kebab_sandwich, 'Kebab Sandwich', 'KS', 'Beef', 650, true, 3
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kebab_sandwich AND variant = 'Beef');

  -- Kebab Wrap
  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kebab_wrap, 'Kebab Wrap', 'KW', 'Chicken', 500, true, 1
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kebab_wrap AND variant = 'Chicken');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kebab_wrap, 'Kebab Wrap', 'KW', 'Mix', 650, true, 2
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kebab_wrap AND variant = 'Mix');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kebab_wrap, 'Kebab Wrap', 'KW', 'Beef', 800, true, 3
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kebab_wrap AND variant = 'Beef');

  -- Kebab Don
  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kebab_don, 'Kebab Don', 'KD', 'Chicken', 500, true, 1
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kebab_don AND variant = 'Chicken');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kebab_don, 'Kebab Don', 'KD', 'Mix', 650, true, 2
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kebab_don AND variant = 'Mix');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kebab_don, 'Kebab Don', 'KD', 'Beef', 800, true, 3
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kebab_don AND variant = 'Beef');

  -- Otsumami Kebab
  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_otsumami, 'Otsumami Kebab', 'OK', 'Chicken', 400, true, 1
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_otsumami AND variant = 'Chicken');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_otsumami, 'Otsumami Kebab', 'OK', 'Mix', 500, true, 2
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_otsumami AND variant = 'Mix');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_otsumami, 'Otsumami Kebab', 'OK', 'Beef', 600, true, 3
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_otsumami AND variant = 'Beef');

  -- Kebab Sandwich Set
  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_ks_set, 'Kebab Sandwich Set', 'KSS', 'Chicken', 700, true, 1
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_ks_set AND variant = 'Chicken');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_ks_set, 'Kebab Sandwich Set', 'KSS', 'Mix', 850, true, 2
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_ks_set AND variant = 'Mix');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_ks_set, 'Kebab Sandwich Set', 'KSS', 'Beef', 1000, true, 3
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_ks_set AND variant = 'Beef');

  -- Kebab Wrap Set
  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kw_set, 'Kebab Wrap Set', 'KWS', 'Chicken', 850, true, 1
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kw_set AND variant = 'Chicken');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kw_set, 'Kebab Wrap Set', 'KWS', 'Mix', 1000, true, 2
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kw_set AND variant = 'Mix');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kw_set, 'Kebab Wrap Set', 'KWS', 'Beef', 1150, true, 3
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kw_set AND variant = 'Beef');

  -- Kebab Don Set
  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kd_set, 'Kebab Don Set', 'KDS', 'Chicken', 850, true, 1
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kd_set AND variant = 'Chicken');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kd_set, 'Kebab Don Set', 'KDS', 'Mix', 1000, true, 2
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kd_set AND variant = 'Mix');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_kd_set, 'Kebab Don Set', 'KDS', 'Beef', 1150, true, 3
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_kd_set AND variant = 'Beef');

  -- Otsumami Kebab Set
  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_ok_set, 'Otsumami Kebab Set', 'OKS', 'Chicken', 750, true, 1
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_ok_set AND variant = 'Chicken');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_ok_set, 'Otsumami Kebab Set', 'OKS', 'Mix', 850, true, 2
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_ok_set AND variant = 'Mix');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_ok_set, 'Otsumami Kebab Set', 'OKS', 'Beef', 950, true, 3
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_ok_set AND variant = 'Beef');

  -- French Fries
  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_fries, 'French Fries', 'FF', 'French Fries', 450, true, 1
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_fries AND variant = 'French Fries');

  -- Soft Drinks
  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_drinks, 'Soft Drink', 'SD', 'All Soft Drinks', 150, true, 1
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_drinks AND variant = 'All Soft Drinks');

  -- Toppings
  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_toppings, 'Topping', 'TOP', 'Cheese', 150, true, 1
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_toppings AND variant = 'Cheese');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_toppings, 'Topping', 'TOP', 'French Fries', 150, true, 2
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_toppings AND variant = 'French Fries');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_toppings, 'Topping', 'TOP', 'Jalapeño', 150, true, 3
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_toppings AND variant = 'Jalapeño');

  -- Sauces
  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_sauces, 'Sauce', 'SAU', 'Mild', 0, true, 1
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_sauces AND variant = 'Mild');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_sauces, 'Sauce', 'SAU', 'Mix', 0, true, 2
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_sauces AND variant = 'Mix');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_sauces, 'Sauce', 'SAU', 'Spicy', 0, true, 3
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_sauces AND variant = 'Spicy');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_sauces, 'Sauce', 'SAU', 'Garlic Yogurt', 0, true, 4
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_sauces AND variant = 'Garlic Yogurt');

  INSERT INTO menu_items (category_id, name, short_name, variant, price, active, sort_order)
  SELECT v_sauces, 'Sauce', 'SAU', 'Teriyaki Sauce', 0, true, 5
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = v_sauces AND variant = 'Teriyaki Sauce');
END $$;