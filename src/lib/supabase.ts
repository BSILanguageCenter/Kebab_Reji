import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;

// Поддерживаем оба формата ключей:
// - новый:  sb_publishable_...
// - старый: eyJhbGciOi... (JWT anon)
const supabaseKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

if (!supabaseUrl || !supabaseKey) {
  const missing = [
    !supabaseUrl && 'VITE_SUPABASE_URL',
    !supabaseKey &&
      'VITE_SUPABASE_PUBLISHABLE_KEY (или VITE_SUPABASE_ANON_KEY)',
  ]
    .filter(Boolean)
    .join(', ');

  throw new Error(
    `[Supabase] Отсутствуют переменные окружения: ${missing}.\n` +
      `Создайте файл .env в корне проекта:\n` +
      `  VITE_SUPABASE_URL=https://your-project.supabase.co\n` +
      `  VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...\n` +
      `Затем перезапустите dev-сервер (npm run dev).`
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});