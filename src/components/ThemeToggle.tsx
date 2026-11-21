// src/components/ThemeToggle.tsx
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { useI18n } from '@/locale';

export function ThemeToggle() {
  const { t } = useI18n();
  const [theme, toggle] = useTheme();
  const isDark = theme === 'dark';
  const label = isDark
    ? t('themeLight')
    : t('themeDark');

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 hover:bg-slate-200 active:scale-95 transition-all shrink-0"
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-amber-500" />
      ) : (
        <Moon className="w-4 h-4 text-slate-600" />
      )}
    </button>
  );
}
