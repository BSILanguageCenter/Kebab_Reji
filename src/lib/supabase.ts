// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

if (!url || !publishableKey) {
  throw new Error(
    'Отсутствуют переменные окружения: VITE_SUPABASE_URL и/или VITE_SUPABASE_PUBLISHABLE_KEY.\n' +
    'Проверь файл .env в корне проекта и перезапусти dev-сервер.'
  );
}

export const supabase = createClient(url, publishableKey, {
  realtime: { params: { eventsPerSecond: 10 } },
});