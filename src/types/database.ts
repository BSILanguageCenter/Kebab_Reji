// ============================================================
// ЗАКАЗЫ
// ============================================================
export type OrderType = 'INSIDE' | 'OUTSIDE';
export type OrderStatus =
  | 'NEW'
  | 'PREPARING'
  | 'READY'
  | 'COMPLETED'
  | 'CANCELLED';

export type OptionType =
  | 'variant'
  | 'property'
  | 'sauce'
  | 'drink'
  | 'extra'
  | 'topping'
  | 'addon';

export interface OrderItemOption {
  id: string;
  order_item_id: string;
  type: OptionType;
  name: string;
  price: number;
  quantity: number;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name: string;
  short_name: string;
  variant: string;
  price: number;
  quantity: number;
  subtotal: number;
  created_at: string;
  is_removed: boolean;
  is_added_later: boolean;
  options?: OrderItemOption[];
}

export interface Order {
  id: string;
  order_number: number;
  order_type: OrderType;
  status: OrderStatus;
  total_amount: number;
  comment: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  order_items?: OrderItem[];
  is_modified?: boolean;
}

// ============================================================
// МЕНЮ
// ============================================================
export type MenuItemType = 'dish' | 'set' | 'drink' | 'sauce' | 'topping';
export type Station = 'kitchen' | 'ready';
export type DishKind = 'single' | 'group';
export type SauceMode = 'none' | 'with';

// Плоские строки из БД (используются для CRUD)
export interface MenuItemProperty {
  id: string;
  item_id: string;
  name: string;
  sort_order: number;
}

export interface MenuDishSauce {
  dish_item_id: string;
  sauce_item_id: string;
  sort_order: number;
}

export interface MenuSetMain {
  set_item_id: string;
  main_item_id: string;
}

export interface MenuSetMainOverride {
  set_item_id: string;
  variant_item_id: string;
  price_override: number | null;
  image_override: string | null;
}

export interface MenuSetExtraGroup {
  id: string;
  set_item_id: string;
  label: string;
  required: boolean;
  sort_order: number;
}

export interface MenuSetExtraOption {
  id: string;
  group_id: string;
  item_id: string;
  price_override: number | null;
  image_override: string | null;
  sort_order: number;
}

// Hydrated-структуры (то, что приходит с Node-сервера через getMenu)
export interface HydratedSauce {
  id: string;
  name: string;
  short_name: string;
  image_url: string | null;
  price: number;
  free: boolean;
  color: string | null;
  active: boolean;
}

export interface HydratedProperty {
  id: string;
  item_id: string;
  name: string;
  sort_order: number;
}

export interface HydratedSetExtraOption {
  option_id: string;
  item: MenuItem;
}

export interface HydratedSetExtraGroup {
  id: string;
  set_item_id: string;
  label: string;
  required: boolean;
  sort_order: number;
  options: HydratedSetExtraOption[];
}

// Основной тип товара (как приходит с сервера)
export interface MenuItem {
  id: string;
  type: MenuItemType;
  name: string;
  short_name: string;
  image_url: string | null;
  price: number;
  free: boolean;
  station: Station | null;
  cook_time_min: number | null;
  color: string | null;
  dish_kind: DishKind | null;
  sauce_mode: SauceMode | null;
  parent_id: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;

  // Собирается на сервере:
  properties?: HydratedProperty[];
  allowed_sauces?: HydratedSauce[];
  variants?: MenuItem[];                    // для dish-group
  set_main?: MenuItem;                      // для set
  set_extra_groups?: HydratedSetExtraGroup[]; // для set
}

// ============================================================
// КОРЗИНА
// ============================================================
export interface CartItemOption {
  type: OptionType;
  name: string;
  price: number;
  quantity: number;
}

export interface CartItem {
  id: string;
  menu_item_id: string;
  name: string;
  short_name: string;
  variant: string;
  price: number;
  quantity: number;
  options: CartItemOption[];
  is_removed?: boolean;
  is_added_later?: boolean;
  db_id?: string;
}