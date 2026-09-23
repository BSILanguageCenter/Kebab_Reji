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
  Server,
  Smartphone,
  ArrowLeft,
  Wifi,
  RefreshCw,
  X,
} from 'lucide-react';

type Role = 'cashier' | 'queue' | 'kitchen' | 'manager';
type Mode = 'host' | 'client';

const MODE_KEY = 'kebab-pos-mode';
const HOST_IP_KEY = 'kebab-pos-host-ip';

export default function App() {
  const [mode] = useState<Mode | null>(() => {
    if (typeof window === 'undefined') return null;
    const stored = window.localStorage.getItem(MODE_KEY);
    return stored === 'host' || stored === 'client' ? stored : null;
  });
  const [role, setRole] = useState<Role | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const { t, lang, setLang } = useI18n();

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

  const handleModeSelect = (m: Mode, hostIp?: string) => {
    window.localStorage.setItem(MODE_KEY, m);
    if (m === 'client' && hostIp) {
      window.localStorage.setItem(HOST_IP_KEY, hostIp);
    } else {
      window.localStorage.removeItem(HOST_IP_KEY);
    }
    window.location.reload();
  };

  // ============================================================
  // ЭКРАН 1: ВЫБОР РЕЖИМА (Хост / Клиент)
  // ============================================================
  if (!mode) {
    return (
      <ModeSelectionScreen
        isOnline={isOnline}
        lang={lang}
        setLang={setLang}
        onSelect={handleModeSelect}
      />
    );
  }

  const hostIp = window.localStorage.getItem(HOST_IP_KEY) ?? '';

  // ============================================================
  // ЭКРАН 2: ВЫБОР РОЛИ
  // ============================================================
  if (!role) {
    return (
      <RoleSelectionScreen
        mode={mode}
        hostIp={hostIp}
        isOnline={isOnline}
        lang={lang}
        setLang={setLang}
        onSelectRole={setRole}
      />
    );
  }

  // ============================================================
  // РАБОЧИЙ ЭКРАН
  // ============================================================
  return (
    <PageActionsContext.Provider value={slot}>
      <div className="h-dvh bg-slate-100 text-gray-900 flex flex-col overflow-hidden">
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
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                mode === 'host'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-100 text-blue-700'
              }`}
            >
              {mode === 'host' ? 'HOST' : 'CLIENT'}
            </span>
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

        <main className="flex-1 min-h-0 overflow-hidden relative">
          {visited.has('cashier') && (
            <div
              className={
                role === 'cashier' ? 'absolute inset-0 flex flex-col' : 'hidden'
              }
            >
              <CashierPage />
            </div>
          )}
          {visited.has('queue') && (
            <div
              className={
                role === 'queue' ? 'absolute inset-0 flex flex-col' : 'hidden'
              }
            >
              <QueuePage />
            </div>
          )}
          {visited.has('kitchen') && (
            <div
              className={
                role === 'kitchen' ? 'absolute inset-0 flex flex-col' : 'hidden'
              }
            >
              <KitchenPage />
            </div>
          )}
          {visited.has('manager') && (
            <div
              className={
                role === 'manager' ? 'absolute inset-0 flex flex-col' : 'hidden'
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
// ЭКРАН ВЫБОРА РЕЖИМА
// ============================================================
function ModeSelectionScreen({
  isOnline,
  lang,
  setLang,
  onSelect,
}: {
  isOnline: boolean;
  lang: Lang;
  setLang: (l: Lang) => void;
  onSelect: (mode: Mode, hostIp?: string) => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<'choose' | 'enter-ip'>('choose');
  const [ip, setIp] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleClientNext = () => {
    if (!ip.trim()) {
      setError(t('hostIpRequired'));
      return;
    }
    const ipv4Regex =
      /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipv4Regex.test(ip.trim())) {
      setError(t('hostIpInvalid'));
      return;
    }
    onSelect('client', ip.trim());
  };

  return (
    <div className="h-dvh bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
        <div className="flex items-center gap-4 mb-10">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
            <UtensilsCrossed className="w-9 h-9 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-gray-900">
              {t('appName')}
            </h1>
            <p className="text-sm text-gray-500 font-medium mt-0.5">
              {step === 'choose' ? t('selectMode') : t('enterHostIp')}
            </p>
          </div>
        </div>

        {step === 'choose' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl w-full">
            <button
              onClick={() => onSelect('host')}
              className="group flex flex-col items-start gap-4 p-6 md:p-8 rounded-3xl bg-white border-2 border-gray-200 hover:border-green-400 hover:shadow-2xl ring-4 ring-transparent hover:ring-green-300 transition-all active:scale-[0.98] text-left"
            >
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white shadow-lg shadow-green-500/40 transition-transform group-hover:scale-110">
                <Server className="w-10 h-10" />
              </div>
              <div>
                <div className="text-2xl font-black text-gray-900 mb-1">
                  {t('modeHost')}
                </div>
                <div className="text-sm text-gray-600 leading-snug">
                  {t('modeHostDesc')}
                </div>
              </div>
            </button>

            <button
              onClick={() => setStep('enter-ip')}
              className="group flex flex-col items-start gap-4 p-6 md:p-8 rounded-3xl bg-white border-2 border-gray-200 hover:border-blue-400 hover:shadow-2xl ring-4 ring-transparent hover:ring-blue-300 transition-all active:scale-[0.98] text-left"
            >
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/40 transition-transform group-hover:scale-110">
                <Smartphone className="w-10 h-10" />
              </div>
              <div>
                <div className="text-2xl font-black text-gray-900 mb-1">
                  {t('modeClient')}
                </div>
                <div className="text-sm text-gray-600 leading-snug">
                  {t('modeClientDesc')}
                </div>
              </div>
            </button>
          </div>
        )}

        {step === 'enter-ip' && (
          <div className="w-full max-w-md">
            <div className="bg-white rounded-3xl border-2 border-gray-200 p-6 shadow-xl">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                  <Wifi className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-900">
                    {t('enterHostIp')}
                  </div>
                  <div className="text-xs text-gray-500">{t('hostIpHint')}</div>
                </div>
              </div>

              <input
                type="text"
                value={ip}
                onChange={(e) => {
                  setIp(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleClientNext();
                }}
                placeholder={t('hostIpPlaceholder')}
                autoFocus
                className="w-full bg-slate-50 border-2 border-gray-300 rounded-xl px-4 py-3 text-lg font-mono text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
              />

              {error && (
                <div className="mt-3 p-2.5 bg-red-50 border border-red-300 rounded-lg text-red-700 text-xs font-medium">
                  {error}
                </div>
              )}

              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => {
                    setStep('choose');
                    setError(null);
                  }}
                  className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold transition-colors active:scale-[0.98]"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {t('back')}
                </button>
                <button
                  onClick={handleClientNext}
                  disabled={!ip.trim()}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-blue-500/30"
                >
                  {t('connect')}
                </button>
              </div>
            </div>
          </div>
        )}
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
// ЭКРАН ВЫБОРА РОЛИ (с кнопкой сервера в правом верхнем углу)
// ============================================================
function RoleSelectionScreen({
  mode,
  hostIp,
  isOnline,
  lang,
  setLang,
  onSelectRole,
}: {
  mode: Mode;
  hostIp: string;
  isOnline: boolean;
  lang: Lang;
  setLang: (l: Lang) => void;
  onSelectRole: (role: Role) => void;
}) {
  const { t } = useI18n();
  const [panelOpen, setPanelOpen] = useState(false);
  const [editIp, setEditIp] = useState(hostIp);
  const [error, setError] = useState<string | null>(null);

  const handleSaveClientIp = () => {
    if (!editIp.trim()) {
      setError(t('hostIpRequired'));
      return;
    }
    const ipv4Regex =
      /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipv4Regex.test(editIp.trim())) {
      setError(t('hostIpInvalid'));
      return;
    }
    window.localStorage.setItem(MODE_KEY, 'client');
    window.localStorage.setItem(HOST_IP_KEY, editIp.trim());
    window.location.reload();
  };

  const handleSwitchToHost = () => {
    window.localStorage.setItem(MODE_KEY, 'host');
    window.localStorage.removeItem(HOST_IP_KEY);
    window.location.reload();
  };

  return (
    <div className="h-dvh bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 flex flex-col">
      {/* Шапка с выбором сервера в правом углу */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white/60 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-md shadow-orange-500/20">
            <UtensilsCrossed className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-black tracking-tight text-gray-900">
            {t('appName')}
          </span>
        </div>

        {/* Кнопка выбора сервера */}
        <div className="relative">
          <button
            onClick={() => setPanelOpen((v) => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 transition-all active:scale-[0.97] shadow-sm ${
              mode === 'host'
                ? 'bg-green-50 border-green-300 text-green-800 hover:bg-green-100'
                : 'bg-blue-50 border-blue-300 text-blue-800 hover:bg-blue-100'
            }`}
          >
            {mode === 'host' ? (
              <Server className="w-4 h-4" />
            ) : (
              <Smartphone className="w-4 h-4" />
            )}
            <span className="text-xs font-bold">
              {mode === 'host' ? t('modeHost') : t('modeClient')}
            </span>
            {mode === 'client' && hostIp && (
              <span className="text-[10px] font-mono opacity-70 hidden sm:inline">
                {hostIp}
              </span>
            )}
            <RefreshCw
              className={`w-3 h-3 opacity-60 transition-transform ${
                panelOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Выпадающая панель */}
          {panelOpen && (
            <>
              {/* Клик вне панели — закрывает */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setPanelOpen(false)}
              />

              <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-white rounded-2xl border-2 border-gray-200 shadow-2xl overflow-hidden">
                {/* Заголовок */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-slate-50">
                  <div className="text-sm font-black text-gray-900">
                    {t('selectServer')}
                  </div>
                  <button
                    onClick={() => setPanelOpen(false)}
                    className="text-gray-400 hover:text-gray-700 p-1 rounded-lg hover:bg-gray-200"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Текущий режим */}
                <div className="p-3 space-y-2">
                  {/* Хост */}
                  <button
                    onClick={() => {
                      if (mode === 'host') {
                        setPanelOpen(false);
                        return;
                      }
                      handleSwitchToHost();
                    }}
                    className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                      mode === 'host'
                        ? 'bg-green-50 border-green-400 cursor-default'
                        : 'bg-white border-gray-200 hover:border-green-400 hover:bg-green-50 active:scale-[0.98]'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        mode === 'host'
                          ? 'bg-green-500 text-white'
                          : 'bg-green-100 text-green-600'
                      }`}
                    >
                      <Server className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-900">
                        {t('modeHost')}
                      </div>
                      <div className="text-[11px] text-gray-500 leading-snug mt-0.5">
                        {t('modeHostDesc')}
                      </div>
                    </div>
                    {mode === 'host' && (
                      <span className="text-[10px] bg-green-500 text-white px-2 py-0.5 rounded-full font-black uppercase shrink-0">
                        {t('activeMode')}
                      </span>
                    )}
                  </button>

                  {/* Клиент */}
                  <div
                    className={`rounded-xl border-2 transition-all ${
                      mode === 'client'
                        ? 'bg-blue-50 border-blue-400'
                        : 'bg-white border-gray-200 hover:border-blue-400'
                    }`}
                  >
                    <button
                      onClick={() => {
                        if (mode === 'client') return;
                        // Переключаемся в режим клиент — сохранение в localStorage
                        // произойдёт при клике на "Подключиться" (там есть IP)
                      }}
                      className="w-full flex items-start gap-3 p-3 text-left"
                    >
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                          mode === 'client'
                            ? 'bg-blue-500 text-white'
                            : 'bg-blue-100 text-blue-600'
                        }`}
                      >
                        <Smartphone className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-gray-900">
                          {t('modeClient')}
                        </div>
                        <div className="text-[11px] text-gray-500 leading-snug mt-0.5">
                          {t('modeClientDesc')}
                        </div>
                      </div>
                      {mode === 'client' && (
                        <span className="text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded-full font-black uppercase shrink-0">
                          {t('activeMode')}
                        </span>
                      )}
                    </button>

                    {/* Поле IP */}
                    <div className="px-3 pb-3 space-y-2">
                      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                        {t('hostIpLabel')}
                      </div>
                      <input
                        type="text"
                        value={editIp}
                        onChange={(e) => {
                          setEditIp(e.target.value);
                          setError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveClientIp();
                        }}
                        placeholder="192.168.100.22"
                        className="w-full bg-white border-2 border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
                      />
                      {error && (
                        <div className="p-2 bg-red-50 border border-red-300 rounded-lg text-red-700 text-[11px] font-medium">
                          {error}
                        </div>
                      )}
                      <button
                        onClick={handleSaveClientIp}
                        disabled={!editIp.trim()}
                        className="w-full py-2.5 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-xs font-bold transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-blue-500/20"
                      >
                        {t('connectToServer')}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Подвал с подсказкой */}
                <div className="px-4 py-2.5 border-t border-gray-200 bg-slate-50 text-[10px] text-gray-500 leading-snug">
                  💡 {t('serverSwitchHint')}
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Основной контент — выбор роли */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
        <div className="flex flex-col items-center gap-3 mb-10">
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
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:gap-5 max-w-3xl w-full">
          <RoleCard
            icon={<UtensilsCrossed className="w-9 h-9" />}
            label={t('cashier')}
            color="orange"
            onClick={() => onSelectRole('cashier')}
          />
          <RoleCard
            icon={<ListOrdered className="w-9 h-9" />}
            label={t('queue')}
            color="purple"
            onClick={() => onSelectRole('queue')}
          />
          <RoleCard
            icon={<ChefHat className="w-9 h-9" />}
            label={t('kitchen')}
            color="yellow"
            onClick={() => onSelectRole('kitchen')}
          />
          <RoleCard
            icon={<BarChart3 className="w-9 h-9" />}
            label={t('manager')}
            color="blue"
            onClick={() => onSelectRole('manager')}
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