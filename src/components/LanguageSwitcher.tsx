import { Languages } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Language } from '@/lib/types';

export default function LanguageSwitcher() {
  const { lang, setLang } = useI18n();

  return (
    <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
      <Languages size={18} className="ml-2 text-gray-500" />
      {(['ru', 'ja'] as Language[]).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition-all ${
            lang === l
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {l === 'ru' ? 'RU' : '日本'}
        </button>
      ))}
    </div>
  );
}
