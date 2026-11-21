// src/App.tsx
import { useState, useEffect, useRef } from 'react';
import CashierPage from '@/pages/CashierPage';
import KitchenPage from '@/pages/KitchenPage';
import ManagerPage from '@/pages/ManagerPage';
import QueuePage from '@/pages/QueuePage';
import DeveloperPage from '@/pages/DeveloperPage';
import LoginPage from '@/pages/LoginPage';
import { useI18n, languages, type Lang, type TranslationKey } from '@/locale';
import {
  PageActionsContext,
  ActiveRoleContext,
  type PageRole,
} from '@/components/PageActions';
import { dateLocale } from '@/locale/format';
import { SyncIndicator } from '@/components/SyncIndicator';
import { ThemeToggle } from '@/components/ThemeToggle';
import { KitchenAlerts } from '@/components/KitchenAlerts';
import { getSocket } from '@/lib/localStore';
import {
  startGoogleSheetsSync,
  stopGoogleSheetsSync,
} from '@/services/googleSheetsSync';
import {
  subscribeOrdersFromDb,
  startOrdersOutbox,
} from '@/services/supabaseOrders';
import { startLayoutSync } from '@/services/layoutSync';
import { startDeletionSync } from '@/services/orderDeletion';
import { subscribeProductsFromDb } from '@/services/supabaseDb';
import {
  applyRemoteOrders,
  applyRemoteDeletes,
  applyRemoteMenu,
  getAllOrders,
} from '@/lib/localStore';
import {
  getCurrentUser,
  logout,
  allowedRoles,
  isDeveloper,
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
  Code2,
  ChevronDown,
  Check,
} from 'lucide-react';

type Role = 'cashier' | 'queue' | 'kitchen' | 'manager' | 'developer';

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

  // Supabase — заказы: отправка (outbox) + получение с других устройств
  useEffect(() => {
    const stopOutbox = startOrdersOutbox(getAllOrders);
    const unsubOrders = subscribeOrdersFromDb(
      (orders: Order[]) => {
        applyRemoteOrders(orders);
      },
      // заказ удалён разработчиком на другом устройстве
      (ids: string[]) => applyRemoteDeletes(ids)
    );
    // добивает незавершённые удаления (нет сети в момент удаления)
    const stopDeletions = startDeletionSync();
    return () => {
      stopOutbox();
      unsubOrders();
      stopDeletions();
    };
  }, []);

  // Supabase DB — меню
  useEffect(() => {
    // первая загрузка, realtime, догрузка и опрос — внутри subscribeProductsFromDb
    const unsub = subscribeProductsFromDb((items: MenuItem[]) => {
      applyRemoteMenu(items);
    });
    return unsub;
  }, []);

  // Стиль (размеры, отступы, текст): менеджер задаёт — касса наследует
  const userRole = user?.role;
  useEffect(() => {
    if (!userRole) return;
    return startLayoutSync(userRole === 'admin' || userRole === 'manager');
  }, [userRole]);

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

  if (!user) {
    return <LoginPage onLoggedIn={setUser} />;
  }

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

  const roleLabel =
    user.role === 'admin'
      ? t('roleAdmin')
      : user.role === 'manager'
      ? t('manager')
      : t('roleCashier');

  return (
    <PageActionsContext.Provider value={slot}>
      <div className="h-dvh w-full bg-slate-100 text-gray-900 flex flex-col overflow-hidden">
        <header className="flex items-center gap-3 px-3 py-0.5 bg-white border-b border-gray-200 shrink-0">
          <h1 className="shrink-0 text-sm font-black uppercase tracking-wider text-orange-600">
            {t(role as TranslationKey)}
          </h1>

          {/* Слот для кнопок типа "Undo" или "Настройки" */}
          <div
            ref={setSlot}
            className="flex items-center gap-2 flex-1 min-w-0"
          />

          {role === 'kitchen' && <KitchenAlerts />}

          <Clock />

          <div className="flex items-center gap-1.5 shrink-0">
            <SyncIndicator />
            <ThemeToggle />
            {languages.length > 1 && (
              <LanguageSwitcher lang={lang} setLang={setLang} />
            )}
            <button
              onClick={() => setRole(null)}
              title={`${t('exit')} · ${user.login} (${roleLabel})`}
              aria-label={t('exit')}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors active:scale-95"
            >
              <LogOut className="w-4 h-4" />
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
            {visited.has('developer') && isDeveloper(user.login) && (
              <div className={role === 'developer' ? 'absolute inset-0 flex flex-col' : 'hidden'}>
                <DeveloperPage />
              </div>
            )}
          </main>
        </ActiveRoleContext.Provider>
      </div>
    </PageActionsContext.Provider>
  );
}

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
    key: Exclude<Role, 'developer'>;
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
    user.role === 'admin'
      ? t('roleAdmin')
      : user.role === 'manager'
      ? t('manager')
      : t('roleCashier');

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
          <ThemeToggle />
          <DateLabel lang={lang} />
        </div>
        <div className="flex items-center gap-2">
          {isDeveloper(user.login) && (
            <button
              onClick={() => onSelectRole('developer')}
              title={t('developer')}
              aria-label={t('developer')}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-900 hover:bg-slate-700 text-emerald-400 border border-slate-700 transition-colors active:scale-95"
            >
              <Code2 className="w-4 h-4" />
            </button>
          )}
          {languages.length > 1 && (
            <LanguageSwitcher lang={lang} setLang={setLang} up />
          )}
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold transition-colors active:scale-[0.98] border border-red-200"
          >
            <LogOut className="w-3.5 h-3.5" />
            {t('exit')}
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

/** Время с секундами сверху, под ним дата цифрами */
function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const p = (n: number) => String(n).padStart(2, '0');
  const time = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  const date = `${p(now.getDate())}.${p(now.getMonth() + 1)}.${now.getFullYear()}`;

  return (
    <div className="shrink-0 flex flex-col items-center leading-none tabular-nums select-none">
      <span className="text-base font-black text-gray-900">{time}</span>
      <span className="mt-0.5 text-[11px] font-semibold text-gray-500">{date}</span>
    </div>
  );
}

function DateLabel({ lang }: { lang: Lang }) {
  return (
    <span className="text-xs text-gray-500 hidden md:block">
      {new Date().toLocaleDateString(dateLocale(lang), {
        month: 'short',
        day: 'numeric',
      })}
    </span>
  );
}

const LANGUAGE_NAMES: Record<Lang, string> = {
  ru: 'Русский',
  en: 'English',
  uz: "O'zbekcha",
  tr: 'Türkçe',
  ja: '日本語',
  ne: 'नेपाली',
};

/** Переключатель языка — раскрывающийся список */
function LanguageSwitcher({
  lang,
  setLang,
  up = false,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** открывать список вверх (для нижней панели) */
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = languages.find((l) => l.code === lang) ?? languages[0];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1 h-8 px-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 text-[11px] font-bold text-gray-700 active:scale-95 transition-all"
      >
        <span>{current?.label}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className={`absolute right-0 z-[10050] min-w-[9rem] py-1 rounded-xl border border-gray-200 bg-white shadow-xl ${
            up ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {languages.map((opt) => {
            const active = lang === opt.code;
            return (
              <li key={opt.code} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    setLang(opt.code);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs font-bold transition-colors ${
                    active
                      ? 'bg-orange-50 text-orange-600'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span>{LANGUAGE_NAMES[opt.code] ?? opt.label}</span>
                  {active && <Check className="w-3.5 h-3.5" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
