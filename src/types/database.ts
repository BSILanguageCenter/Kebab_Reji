export type OrderType = 'INSIDE' | 'OUTSIDE';
export type OrderStatus = 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
export type OptionType = 'sauce' | 'topping';

export interface MenuCategory {
  id: string;
  name: string;
  short_name: string;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  short_name: string;
  variant: string;
  price: number;
  image_url: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

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
}

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
}

export interface MenuItemWithCategory extends MenuItem {
  category?: MenuCategory;
}
