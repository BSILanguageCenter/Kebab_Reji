// src/App.tsx
import { useState, useEffect } from 'react';
import CashierPage from '@/pages/CashierPage';
import KitchenPage from '@/pages/KitchenPage';
import ManagerPage from '@/pages/ManagerPage';
import QueuePage from '@/pages/QueuePage';
import LoginPage from '@/pages/LoginPage';
import { useI18n, languages, type Lang, type TranslationKey } from '@/locale';
import {
  PageActionsContext,
  ActiveRoleContext,
  type PageRole,
} from '@/components/PageActions';
import { SyncIndicator } from '@/components/SyncIndicator';
import { KitchenAlerts } from '@/components/KitchenAlerts'; // ← NEW
import { getSocket } from '@/lib/localStore';
import {
  startGoogleSheetsSync,
  stopGoogleSheetsSync,
} from '@/services/googleSheetsSync';
import { listenToOrders } from '@/services/firebaseSync';
import {
  fetchAllProductsFromDb,
  subscribeProductsFromDb,
} from '@/services/supabaseDb';
import { applyRemoteOrders, applyRemoteMenu } from '@/lib/localStore';
import {
  getCurrentUser,
  logout,
  allowedRoles,
  type AuthUser,
} from '@/lib/auth';
import type { Order, MenuItem } from '@/types/database';
import {
  UtensilsCrossed,
  ChefHat,
  BarChart3,
  ListOrdered,
  LogOut,
  UserCircle2,
} from 'lucide-react';

type Role = 'cashier' | 'queue' | 'kitchen' | 'manager';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => getCurrentUser());
  const [role, setRole] = useState<Role | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const { t, lang, setLang } = useI18n();

  const [visited, setVisited] = useState<Set<Role>>(() => new Set());

  useEffect(() => {
    getSocket();
  }, []);

  useEffect(() => {
    startGoogleSheetsSync();
    return () => {
      stopGoogleSheetsSync();
    };
  }, []);

  // Firebase RTDB — заказы
  useEffect(() => {
    const unsubOrders = listenToOrders((orders: Order[]) => {
      applyRemoteOrders(orders);
    });
    return () => {
      unsubOrders();
    };
  }, []);

  // Supabase DB — меню
  useEffect(() => {
    let cancelled = false;

    void fetchAllProductsFromDb()
      .then((items: MenuItem[]) => {
        if (!cancelled) applyRemoteMenu(items);
      })
      .catch((e: unknown) => {
        console.error('[App] fetchAllProductsFromDb failed:', e);
      });

    const unsub = subscribeProductsFromDb((items: MenuItem[]) => {
      applyRemoteMenu(items);
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

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

  const handleLogout = () => {
    logout();
    setUser(null);
    setRole(null);
    setVisited(new Set());
  };

  // ---------- 1. Нет пользователя → логин ----------
  if (!user) {
    return <LoginPage onLoggedIn={setUser} />;
  }

  // ---------- 2. Роль не выбрана → выбор роли с фильтром ----------
  if (!role) {
    return (
      <RoleSelectionScreen
        user={user}
        lang={lang}
        setLang={setLang}
        onSelectRole={setRole}
        onLogout={handleLogout}
      />
    );
  }

  // ---------- 3. Роль выбрана → сам экран ----------
  const roleLabel =
    user.role === 'admin' ? 'ADMIN' : user.role === 'manager' ? 'MANAGER' : 'CASHIER';

  return (
    <PageActionsContext.Provider value={slot}>
      <div className="h-dvh w-full bg-slate-100 text-gray-900 flex flex-col overflow-hidden">
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

          {/* ← NEW: мигающие счётчики для кухни */}
          {role === 'kitchen' && <KitchenAlerts />}

          <div className="flex items-center gap-3 shrink-0">
            {/* Бейдж пользователя */}
            <span className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-600">
              <UserCircle2 className="w-3.5 h-3.5" />
              {user.login}
              <span className="ml-1 text-[9px] uppercase text-orange-600">
                {roleLabel}
              </span>
            </span>
            <SyncIndicator />
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

        <ActiveRoleContext.Provider value={role as PageRole}>
          <main className="flex-1 min-h-0 overflow-hidden relative">
            {visited.has('cashier') && (
              <div className={role === 'cashier' ? 'absolute inset-0 flex flex-col' : 'hidden'}>
                <CashierPage />
              </div>
            )}
            {visited.has('queue') && (
              <div className={role === 'queue' ? 'absolute inset-0 flex flex-col' : 'hidden'}>
                <QueuePage />
              </div>
            )}
            {visited.has('kitchen') && (
              <div className={role === 'kitchen' ? 'absolute inset-0 flex flex-col' : 'hidden'}>
                <KitchenPage />
              </div>
            )}
            {visited.has('manager') && (
              <div className={role === 'manager' ? 'absolute inset-0 flex flex-col' : 'hidden'}>
                <ManagerPage />
              </div>
            )}
          </main>
        </ActiveRoleContext.Provider>
      </div>
    </PageActionsContext.Provider>
  );
}

// ============================================================
// ROLE SELECTION SCREEN
// ============================================================
function RoleSelectionScreen({
  user,
  lang,
  setLang,
  onSelectRole,
  onLogout,
}: {
  user: AuthUser;
  lang: Lang;
  setLang: (l: Lang) => void;
  onSelectRole: (role: Role) => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const allowed = allowedRoles(user.role);

  const roleCards: Array<{
    key: Role;
    icon: React.ReactNode;
    label: string;
    color: 'orange' | 'yellow' | 'blue' | 'purple';
  }> = [
    { key: 'cashier', icon: <UtensilsCrossed className="w-9 h-9" />, label: t('cashier'), color: 'orange' },
    { key: 'queue',   icon: <ListOrdered className="w-9 h-9" />,     label: t('queue'),   color: 'purple' },
    { key: 'kitchen', icon: <ChefHat className="w-9 h-9" />,         label: t('kitchen'), color: 'yellow' },
    { key: 'manager', icon: <BarChart3 className="w-9 h-9" />,       label: t('manager'), color: 'blue' },
  ];

  const visibleCards = roleCards.filter((c) => allowed.includes(c.key));
  const roleLabel =
    user.role === 'admin' ? 'ADMIN' : user.role === 'manager' ? 'MANAGER' : 'CASHIER';

  return (
    <div className="h-dvh w-full bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 flex flex-col">
      <div className="flex-1 min-h-0 w-full flex flex-col p-6 overflow-y-auto">
        <div className="shrink-0 flex flex-col items-center gap-3 mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
            <UtensilsCrossed className="w-9 h-9 text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-black tracking-tight text-gray-900">
              {t('appName')}
            </h1>
            <p className="text-sm text-gray-500 font-medium mt-0.5">
              {t('selectRole')}
            </p>
            <p className="mt-2 text-xs font-bold text-slate-600">
              <UserCircle2 className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
              {user.login}
              <span className="ml-2 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] uppercase">
                {roleLabel}
              </span>
            </p>
          </div>
        </div>

        <div
          className={`flex-1 w-full grid gap-4 md:gap-5 ${
            visibleCards.length === 1
              ? 'grid-cols-1 max-w-md mx-auto'
              : 'grid-cols-2 auto-rows-fr'
          }`}
        >
          {visibleCards.map((c) => (
            <RoleCard
              key={c.key}
              icon={c.icon}
              label={c.label}
              color={c.color}
              onClick={() => onSelectRole(c.key)}
            />
          ))}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white border-t border-gray-200 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <SyncIndicator />
          <DateLabel lang={lang} />
        </div>
        <div className="flex items-center gap-2">
          {languages.length > 1 && (
            <LanguageSwitcher lang={lang} setLang={setLang} />
          )}
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold transition-colors active:scale-[0.98] border border-red-200"
          >
            <LogOut className="w-3.5 h-3.5" />
            Выйти
          </button>
        </div>
      </footer>
    </div>
  );
}

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
      className={`group w-full h-full flex flex-col items-center justify-center gap-4 p-8 md:p-10 rounded-3xl bg-white border-2 border-gray-200 hover:border-transparent hover:shadow-2xl ring-4 ring-transparent transition-all active:scale-[0.98] ${rings[color]}`}
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

function DateLabel({ lang }: { lang: Lang }) {
  return (
    <span className="text-xs text-gray-500 hidden md:block">
      {new Date().toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
        month: 'short',
        day: 'numeric',
      })}
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
