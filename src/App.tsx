import { useState, useEffect } from 'react';
import CashierPage from '@/pages/CashierPage';
import KitchenPage from '@/pages/KitchenPage';
import ManagerPage from '@/pages/ManagerPage';
import QueuePage from '@/pages/QueuePage';
import { useI18n, languages, type Lang, type TranslationKey } from '@/locale';
import { PageActionsContext } from '@/components/PageActions';
import {
  UtensilsCrossed,
  ChefHat,
  BarChart3,
  ListOrdered,
  LogOut,
} from 'lucide-react';

type Role = 'cashier' | 'queue' | 'kitchen' | 'manager';

export default function App() {
  const [role, setRole] = useState<Role | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const { t, lang, setLang } = useI18n();

  // Храним роли, которые уже открывались — они остаются смонтированными
  const [visited, setVisited] = useState<Set<Role>>(() => new Set());

  useEffect(() => {
    if (role) {
      setVisited((prev) => {
        if (prev.has(role)) return prev;
        const next = new Set(prev);
        next.add(role);
        return next;
      });
    }
  }, [role]);

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

  // ============================================================
  // ЭКРАН ВЫБОРА РОЛИ
  // ============================================================
  if (!role) {
    return (
      <div className="h-dvh bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
          <div className="flex items-center gap-4 mb-12">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
              <UtensilsCrossed className="w-9 h-9 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-gray-900">
                {t('appName')}
              </h1>
              <p className="text-sm text-gray-500 font-medium mt-0.5">
                {t('selectRole')}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 md:gap-5 max-w-3xl w-full">
            <RoleCard
              icon={<UtensilsCrossed className="w-9 h-9" />}
              label={t('cashier')}
              color="orange"
              onClick={() => setRole('cashier')}
            />
            <RoleCard
              icon={<ListOrdered className="w-9 h-9" />}
              label={t('queue')}
              color="purple"
              onClick={() => setRole('queue')}
            />
            <RoleCard
              icon={<ChefHat className="w-9 h-9" />}
              label={t('kitchen')}
              color="yellow"
              onClick={() => setRole('kitchen')}
            />
            <RoleCard
              icon={<BarChart3 className="w-9 h-9" />}
              label={t('manager')}
              color="blue"
              onClick={() => setRole('manager')}
            />
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white border-t border-gray-200 shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <OnlineBadge isOnline={isOnline} />
            <DateLabel lang={lang} />
          </div>
          <div className="flex items-center gap-2">
            {languages.length > 1 && (
              <LanguageSwitcher lang={lang} setLang={setLang} />
            )}
          </div>
        </footer>
      </div>
    );
  }

  // ============================================================
  // РАБОЧИЙ ЭКРАН
  // ============================================================
  return (
    <PageActionsContext.Provider value={slot}>
      <div className="h-dvh bg-slate-100 text-gray-900 flex flex-col overflow-hidden">
        {/* Единая верхняя панель */}
        <header className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shrink-0 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-md shadow-orange-500/20">
              <UtensilsCrossed className="w-5 h-5 text-white" />
            </div>
            <span className="text-base font-black tracking-tight text-gray-900 hidden sm:block">
              {t('appName')}
            </span>
          </div>

          <div className="flex items-center gap-2 pl-3 border-l border-gray-200 shrink-0">
            <h1 className="text-lg font-bold text-orange-600">
              {t(role as TranslationKey)}
            </h1>
          </div>

          <div
            ref={setSlot}
            className="flex items-center gap-2 flex-1 min-w-0"
          />

          <div className="flex items-center gap-3 shrink-0">
            <OnlineBadge isOnline={isOnline} />
            <DateLabel lang={lang} />
            {languages.length > 1 && (
              <LanguageSwitcher lang={lang} setLang={setLang} />
            )}
            <button
              onClick={() => setRole(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors active:scale-[0.98]"
            >
              <LogOut className="w-3.5 h-3.5" />
              {t('exit')}
            </button>
          </div>
        </header>

        {/* Все посещённые страницы остаются в DOM, скрыты через hidden */}
        <main className="flex-1 min-h-0 overflow-hidden relative">
          {visited.has('cashier') && (
            <div
              className={
                role === 'cashier'
                  ? 'absolute inset-0 flex flex-col'
                  : 'hidden'
              }
            >
              <CashierPage />
            </div>
          )}
          {visited.has('queue') && (
            <div
              className={
                role === 'queue'
                  ? 'absolute inset-0 flex flex-col'
                  : 'hidden'
              }
            >
              <QueuePage />
            </div>
          )}
          {visited.has('kitchen') && (
            <div
              className={
                role === 'kitchen'
                  ? 'absolute inset-0 flex flex-col'
                  : 'hidden'
              }
            >
              <KitchenPage />
            </div>
          )}
          {visited.has('manager') && (
            <div
              className={
                role === 'manager'
                  ? 'absolute inset-0 flex flex-col'
                  : 'hidden'
              }
            >
              <ManagerPage />
            </div>
          )}
        </main>
      </div>
    </PageActionsContext.Provider>
  );
}

// ============================================================
// КАРТОЧКА РОЛИ
// ============================================================
function RoleCard({
  icon,
  label,
  color,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  color: 'orange' | 'yellow' | 'blue' | 'purple';
  onClick: () => void;
}) {
  const colors: Record<string, string> = {
    orange: 'from-orange-500 to-red-600 shadow-orange-500/40',
    yellow: 'from-yellow-400 to-amber-500 shadow-yellow-500/40',
    blue: 'from-blue-500 to-indigo-600 shadow-blue-500/40',
    purple: 'from-purple-500 to-pink-600 shadow-purple-500/40',
  };
  const rings: Record<string, string> = {
    orange: 'group-hover:ring-orange-300',
    yellow: 'group-hover:ring-yellow-300',
    blue: 'group-hover:ring-blue-300',
    purple: 'group-hover:ring-purple-300',
  };

  return (
    <button
      onClick={onClick}
      className={`group flex flex-col items-center justify-center gap-4 p-8 md:p-10 rounded-3xl bg-white border-2 border-gray-200 hover:border-transparent hover:shadow-2xl ring-4 ring-transparent transition-all active:scale-[0.98] ${rings[color]}`}
    >
      <div
        className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${colors[color]} flex items-center justify-center text-white shadow-lg transition-transform group-hover:scale-110`}
      >
        {icon}
      </div>
      <span className="text-lg md:text-xl font-bold text-gray-900">
        {label}
      </span>
    </button>
  );
}

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ
// ============================================================
function OnlineBadge({ isOnline }: { isOnline: boolean }) {
  const { t } = useI18n();
  if (!isOnline) {
    return (
      <span className="flex items-center gap-1.5 text-red-600 text-xs font-medium bg-red-50 px-2.5 py-1 rounded-lg border border-red-200">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        {t('offline')}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-green-600 text-xs font-medium">
      <span className="w-2 h-2 rounded-full bg-green-500" />
      {t('online')}
    </span>
  );
}

function DateLabel({ lang }: { lang: Lang }) {
  return (
    <span className="text-xs text-gray-500 hidden md:block">
      {new Date().toLocaleDateString(
        lang === 'ru' ? 'ru-RU' : 'en-US',
        { month: 'short', day: 'numeric' }
      )}
    </span>
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
          className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${
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