import { useState, useEffect } from 'react';
import CashierPage from '@/pages/CashierPage';
import KitchenPage from '@/pages/KitchenPage';
import ManagerPage from '@/pages/ManagerPage';
import { useI18n, languages, type Lang } from '@/locale';
import { UtensilsCrossed, ChefHat, BarChart3 } from 'lucide-react';

type Page = 'cashier' | 'kitchen' | 'manager';

export default function App() {
  const [page, setPage] = useState<Page>('cashier');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const { t, lang, setLang } = useI18n();

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return (
    <div className="h-dvh bg-slate-100 text-gray-900 flex flex-col overflow-hidden">
      <header className="flex items-center justify-between bg-white border-b border-gray-200 px-4 py-3 shrink-0 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 mr-6">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-md shadow-orange-500/20">
              <UtensilsCrossed className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-gray-900">
              {t('appName')}
            </span>
          </div>
          <nav className="flex gap-1">
            <NavButton
              active={page === 'cashier'}
              onClick={() => setPage('cashier')}
              icon={<UtensilsCrossed className="w-4 h-4" />}
              label={t('cashier')}
            />
            <NavButton
              active={page === 'kitchen'}
              onClick={() => setPage('kitchen')}
              icon={<ChefHat className="w-4 h-4" />}
              label={t('kitchen')}
            />
            <NavButton
              active={page === 'manager'}
              onClick={() => setPage('manager')}
              icon={<BarChart3 className="w-4 h-4" />}
              label={t('manager')}
            />
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {!isOnline && (
            <span className="flex items-center gap-1.5 text-red-600 text-sm font-medium bg-red-50 px-3 py-1 rounded-lg border border-red-200">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {t('offline')}
            </span>
          )}
          {isOnline && (
            <span className="flex items-center gap-1.5 text-green-600 text-sm font-medium">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              {t('online')}
            </span>
          )}
          {languages.length > 1 && (
            <LanguageSwitcher lang={lang} setLang={setLang} />
          )}
          <span className="text-sm text-gray-500 hidden sm:block">
            {new Date().toLocaleDateString(
              lang === 'ru' ? 'ru-RU' : 'en-US',
              { month: 'short', day: 'numeric' }
            )}
          </span>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden">
        {page === 'cashier' && <CashierPage />}
        {page === 'kitchen' && <KitchenPage />}
        {page === 'manager' && <ManagerPage />}
      </main>
    </div>
  );
}

function LanguageSwitcher({
  lang,
  setLang,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
}) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-gray-300 shadow-sm">
      {languages.map((opt) => (
        <button
          key={opt.code}
          onClick={() => setLang(opt.code)}
          className={`px-3 py-1.5 text-xs font-bold transition-colors ${
            lang === opt.code
              ? 'bg-orange-500 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-100'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
        active
          ? 'bg-orange-500 text-white shadow-md shadow-orange-500/30'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}