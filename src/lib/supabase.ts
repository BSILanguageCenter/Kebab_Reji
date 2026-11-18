// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

if (!supabaseUrl) {
  throw new Error('VITE_SUPABASE_URL is not configured');
}
if (!supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_ANON_KEY is not configured');
}

/**
 * Singleton Supabase client.
 * Один экземпляр на всё приложение — не создавай его в компонентах.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Имя bucket для изображений меню. */
export const MENU_IMAGES_BUCKET = 'menu-images';
