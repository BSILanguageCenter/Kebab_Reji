export interface ModifierDef {
  key: string;
  label_ru: string;
  label_ja: string;
}

// Глобальный список возможных свойств
export const MODIFIERS: ModifierDef[] = [
  { key: 'spicy',        label_ru: 'Острый',       label_ja: '辛い' },
  { key: 'very_spicy',   label_ru: 'Очень острый', label_ja: '激辛' },
  { key: 'no_sauce',     label_ru: 'Без соуса',    label_ja: 'ソース抜き' },
  { key: 'no_onion',     label_ru: 'Без лука',     label_ja: '玉ねぎ抜き' },
  { key: 'no_garlic',    label_ru: 'Без чеснока',  label_ja: 'にんにく抜き' },
  { key: 'no_mayo',      label_ru: 'Без майонеза', label_ja: 'マヨ抜き' },
  { key: 'extra_sauce',  label_ru: 'Больше соуса', label_ja: 'ソース多め' },
  { key: 'separate',     label_ru: 'Отдельно',     label_ja: '別盛り' },
];

export const getModifierLabel = (key: string, lang: 'ru' | 'ja') => {
  const m = MODIFIERS.find((x) => x.key === key);
  return m ? (lang === 'ru' ? m.label_ru : m.label_ja) : key;
};