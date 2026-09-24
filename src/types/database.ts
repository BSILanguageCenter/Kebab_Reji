export type OrderType = 'INSIDE' | 'OUTSIDE';
export type OrderStatus = 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
export type OptionType =
  | 'variant'
  | 'property'
  | 'drink'
  | 'sauce'
  | 'extra'
  | 'addon';

// ============================================================
// МЕНЮ
// ============================================================
export type MenuItemType = 'dish' | 'set' | 'drink' | 'sauce' | 'topping';
export type SetSlotType = 'drink' | 'sauce' | 'extra';

export interface MenuCategory {
  id: string;
  name: string;
  short_name: string;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MenuItemVariant {
  id: string;
  item_id: string;
  name: string;
  price: number;
  sort_order: number;
}

export interface MenuItemProperty {
  id: string;
  item_id: string;
  group_name: string | null;
  name: string;
  price: number;
  is_default: boolean;
  sort_order: number;
}

export interface MenuSetSlot {
  id: string;
  set_item_id: string;
  slot_type: SetSlotType;
  label: string;
  required: boolean;
  sort_order: number;
  fixed_item_id: string | null;
  source_category_id: string | null;
}

export interface MenuItem {
  id: string;
  category_id: string | null;
  type: MenuItemType;
  name: string;
  short_name: string;
  price: number;
  image_url: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  variants?: MenuItemVariant[];
  properties?: MenuItemProperty[];
  set_slots?: MenuSetSlot[];
}

// ============================================================
// ЗАКАЗЫ
// ============================================================
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

export interface MenuItemWithCategory extends MenuItem {
  category?: MenuCategory;
}