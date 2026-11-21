// ============================================================
// РЕЕСТР ЯЗЫКОВ
//
// Чтобы добавить новый язык:
//   1. Создайте src/locale/xx.ts  (скопируйте uz.ts, переведите)
//   2. Импортируйте его ниже и добавьте в translations и languageLabels
//   3. Сохраните — переключатель в шапке появится сам
// ============================================================

import { ru } from './ru';
import { en } from './en';
import { uz } from './uz';
import { tr } from './tr';
import { ja } from './ja';
import { ne } from './ne';

export const translations = {
  ru,
  en,
  uz,
  tr,
  ja,
  ne,
};

// Метки кнопок-переключателя в шапке
export const languageLabels: Record<keyof typeof translations, string> = {
  ru: 'RU',
  en: 'EN',
  uz: "O'z",
  tr: 'TR',
  ja: '日本語',
  ne: 'नेपा',
};

// Язык по умолчанию (если в localStorage ничего не сохранено)
export const defaultLang: keyof typeof translations = 'ru';

export type Lang = keyof typeof translations;

// Ключ localStorage для выбранного языка
export const LANG_STORAGE_KEY = 'kebab-pos-lang';
