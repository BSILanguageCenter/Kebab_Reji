import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');

// Загружаем .env из КОРНЯ проекта
dotenv.config({ path: envPath });

// Fallback: если есть VITE_-переменные, используем их и для сервера
if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
}

if (!process.env.SUPABASE_KEY) {
  if (process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    process.env.SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  } else if (process.env.VITE_SUPABASE_ANON_KEY) {
    process.env.SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;
  }
}

// Значения по умолчанию
if (!process.env.PORT) {
  process.env.PORT = '3001';
}

// Отладка
console.log('[env] Файл:', envPath);
console.log(
  '[env] SUPABASE_URL:',
  process.env.SUPABASE_URL ? '✓ OK' : '❌ не найден'
);
console.log(
  '[env] SUPABASE_KEY:',
  process.env.SUPABASE_KEY
    ? `✓ OK (${process.env.SUPABASE_KEY.length} симв.)`
    : '❌ не найден'
);
console.log('[env] PORT:', process.env.PORT);