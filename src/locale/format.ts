import {
  translations,
  defaultLang,
  LANG_STORAGE_KEY,
  type Lang,
} from './config';
import type { TranslationKey } from './en';

export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString('en-US')}`;
}

export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatTimeAgo(
  dateStr: string,
  lang: Lang = defaultLang
): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);

  const dict = translations[lang] ?? translations[defaultLang];
  const justNow = dict.timeAgoJustNow;
  const minutesTpl = dict.timeAgoMinutes;
  const hoursTpl = dict.timeAgoHours;

  if (mins < 1) return justNow;
  if (mins < 60) return minutesTpl.replace('{n}', String(mins));
  const hrs = Math.floor(mins / 60);
  return hoursTpl.replace('{n}', String(hrs));
}

/** Текущий язык вне React (для сервисов) */
export function getStoredLang(): Lang {
  try {
    const v = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (v && v in translations) return v as Lang;
  } catch {
    /* ignore */
  }
  return defaultLang;
}

/** Перевод вне React-компонентов */
export function tr(key: TranslationKey, lang: Lang = getStoredLang()): string {
  const dict = (translations[lang] ?? translations[defaultLang]) as Record<
    TranslationKey,
    string
  >;
  return dict[key] ?? String(key);
}

/** Локаль для toLocaleString / toLocaleDateString */
export function dateLocale(lang: Lang = getStoredLang()): string {
  const map: Record<Lang, string> = {
    ru: 'ru-RU',
    en: 'en-US',
    uz: 'uz-UZ',
    tr: 'tr-TR',
    ja: 'ja-JP',
    ne: 'ne-NP',
  };
  return map[lang] ?? 'en-US';
}
