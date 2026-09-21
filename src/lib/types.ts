export type OrderStatus = 'new' | 'cooking' | 'ready' | 'completed' | 'cancelled';
export type OrderType = 'dine_in' | 'takeaway';
export type TableStatus = 'free' | 'occupied' | 'waiting_payment';
export type PaymentMethod = 'cash' | 'card' | 'other';
export type Language = 'ru' | 'ja';

export interface KitchenStation {
  id: string;
  name_ru: string;
  name_ja: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  name_ru: string;
  name_ja: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  category_id: string | null;
  name_ru: string;
  name_ja: string;
  description_ru: string | null;
  description_ja: string | null;
  price: number;
  image_url: string | null;
  is_available: boolean;
  kitchen_station_id: string | null;
  sort_order: number;
  /** Готовый продукт (упакованный) — не отправляется на кухню */
  is_ready_product: boolean;
  /** Свободный список свойств, доступных для выбора при заказе */
  available_modifiers: string[];
  created_at: string;
  updated_at: string;
}

export interface RestaurantTable {
  id: string;
  name: string;
  status: TableStatus;
  sort_order: number;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name_ru: string;
  product_name_ja: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  note: string | null;
  kitchen_station_id: string | null;
  status: OrderStatus;
  /** Готовый продукт — кухня его не видит */
  is_ready_product: boolean;
  created_at: string;
}

export interface Order {
  id: string;
  order_number: number;
  table_id: string | null;
  order_type: OrderType;
  status: OrderStatus;
  subtotal: number;
  discount: number;
  total: number;
  cashier_id: string | null;
  customer_note: string | null;
  created_at: string;
  sent_to_kitchen_at: string | null;
  cooking_started_at: string | null;
  ready_at: string | null;
  completed_at: string | null;
  order_items?: OrderItem[];
  table?: RestaurantTable | null;
}

export interface Payment {
  id: string;
  order_id: string;
  amount: number;
  method: PaymentMethod;
  received_amount: number;
  change_amount: number;
  created_at: string;
}

export interface User {
  id: string;
  name: string;
  role: string;
  created_at: string;
}

export interface PrinterSetting {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface RestaurantSetting {
  id: string;
  key: string;
  value: string | null;
  updated_at: string;
}