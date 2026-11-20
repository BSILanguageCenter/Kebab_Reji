// src/components/ThemeToggle.tsx
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { useI18n } from '@/locale';

export function ThemeToggle() {
  const { lang } = useI18n();
  const [theme, toggle] = useTheme();
  const ru = lang === 'ru';
  const isDark = theme === 'dark';
  const label = isDark
    ? ru
      ? 'Светлая тема'
      : 'Light theme'
    : ru
    ? 'Тёмная тема'
    : 'Dark theme';

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 hover:bg-slate-200 active:scale-95 transition-all shrink-0"
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-amber-500" />
      ) : (
        <Moon className="w-4 h-4 text-slate-600" />
      )}
    </button>
  );
}
