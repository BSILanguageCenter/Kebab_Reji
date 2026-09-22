/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import {
  translations,
  languageLabels,
  defaultLang,
  type Lang,
} from './config';
import type { TranslationKey } from './lg';

export type { Lang, TranslationKey };
export { languageLabels, defaultLang };

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = 'kebab-pos-lang';
const allCodes = Object.keys(translations) as Lang[];

function isLang(value: string | null): value is Lang {
  return value !== null && allCodes.includes(value as Lang);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === 'undefined') return defaultLang;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLang(stored) ? stored : defaultLang;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, lang);
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const setLang = (l: Lang) => setLangState(l);

  const t = (key: TranslationKey): string => {
    const dict = translations[lang] ?? translations[defaultLang];
    return (dict as Record<TranslationKey, string>)[key] ?? String(key);
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

// Список для переключателя в шапке
export const languages: Array<{ code: Lang; label: string }> = allCodes.map(
  (code) => ({
    code,
    label: languageLabels[code],
  })
);