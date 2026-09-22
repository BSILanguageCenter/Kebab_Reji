// ============================================================
// РЕЕСТР ЯЗЫКОВ
//
// Чтобы добавить новый язык (например, узбекский):
//   1. Создайте src/locale/uz.ts  (скопируйте en.ts, переведите)
//   2. Раскомментируйте 3 строки ниже, помеченные // ← UZ
//   3. Сохраните — переключатель в шапке появится сам
// ============================================================

import { ru } from './ru';
import { en } from './en';
// import { uz } from './uz';           // ← UZ: раскомментировать

export const translations = {
  ru,
  en,
  // uz,                                  // ← UZ: раскомментировать
};

// Метки кнопок-переключателя в шапке
export const languageLabels: Record<keyof typeof translations, string> = {
  ru: 'RU',
  en: 'EN',
  // uz: "O'z",                           // ← UZ: раскомментировать
};

// Язык по умолчанию (если в localStorage ничего не сохранено)
export const defaultLang: keyof typeof translations = 'ru';

export type Lang = keyof typeof translations;