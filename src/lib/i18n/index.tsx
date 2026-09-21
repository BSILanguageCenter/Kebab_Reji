import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { Language } from '@/lib/types';
import ru from './ru';
import ja from './ja';
import type { Translations } from './ru';

const dictionaries: Record<Language, Translations> = { ru, ja };
const STORAGE_KEY = 'pos-language';

interface I18nContextValue {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLang(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'ru' || stored === 'ja' ? stored : 'ru';
}

function resolveKey(dict: Translations, key: string): string {
  const parts = key.split('.');
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof cur === 'string' ? cur : key;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(getInitialLang);

  const setLang = useCallback((l: Language) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: string) => resolveKey(dictionaries[lang], key),
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

export function useT() {
  return useI18n().t;
}
