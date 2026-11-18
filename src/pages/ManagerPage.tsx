// src/pages/ManagerPage.tsx
import { useEffect, useState } from 'react';
import { useI18n } from '@/locale';
import { PageActions } from '@/components/PageActions';
import { BarChart3, Tag, Trash2 } from 'lucide-react';
import { StatistikProduct } from './Manager/StatistikProduct';
import { MenuProduct } from './Manager/MenuProduct';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { resetAllData } from '@/lib/localStore';
import { useViewport } from '@/lib/useViewport';
import { supabase } from '@/lib/supabase';
import { enqueueMenuForSync } from '@/services/googleSheetsSync';
import { getCurrentUser, canSeeStatistics, type AuthUser } from '@/lib/auth';

type Tab = 'stats' | 'menu';

export default function ManagerPage() {
  const { t } = useI18n();
  const { device } = useViewport();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  // ✅ Реактивно отслеживаем пользователя (logout в другой вкладке тоже учтётся)
  const [user, setUser] = useState<AuthUser | null>(getCurrentUser);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'kebab-pos-auth') setUser(getCurrentUser());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ✅ Статистика только для admin
  const showStatistics = user ? canSeeStatistics(user.role) : false;

  // ✅ Начальная вкладка: admin → stats, иначе → menu
  const [tab, setTab] = useState<Tab>(showStatistics ? 'stats' : 'menu');

  // ✅ Если пользователь сменился на менеджера, а открыта stats — принудительно menu
  useEffect(() => {
    if (!showStatistics && tab === 'stats') {
      setTab('menu');
    }
  }, [showStatistics, tab]);

  const handleResetAll = async () => {
    setResetting(true);
    try {
      resetAllData();

      const { error } = await supabase.from('products').delete().neq('id', '');
      if (error) {
        console.warn('[ManagerPage] Supabase clear failed:', error.message);
      }

      try {
        enqueueMenuForSync([]);
      } catch (e) {
        console.warn('[ManagerPage] enqueueMenuForSync([]) failed:', e);
      }

      window.location.reload();
    } catch (e) {
      console.error('[ManagerPage] reset failed:', e);
      setResetting(false);
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100">
      <PageActions forRole="manager">
        <div className="flex items-center gap-1">
          {/* ✅ Кнопка «Статистика» только для admin */}
          {showStatistics && (
            <TabButton
              active={tab === 'stats'}
              icon={<BarChart3 className="w-3.5 h-3.5" />}
              onClick={() => setTab('stats')}
              label={t('statistics')}
            />
          )}
          <TabButton
            active={tab === 'menu'}
            icon={<Tag className="w-3.5 h-3.5" />}
            onClick={() => setTab('menu')}
            label={t('menuManagement')}
          />
          <button
            onClick={() => setConfirmReset(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 [@media(pointer:coarse)]:min-h-[44px] rounded-lg text-xs font-bold bg-red-100 hover:bg-red-200 text-red-700 transition-all active:scale-[0.97]"
            title={t('resetAllDataTitle')}
            aria-label={t('resetAllDataBtn')}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t('resetAllDataBtn')}</span>
          </button>
        </div>
      </PageActions>

      <div className="flex-1 min-h-0 overflow-hidden">
        {/* ✅ Рендер stats с двойной защитой: и по роли, и по tab */}
        {tab === 'stats' && showStatistics && <StatistikProduct />}
        {tab === 'menu' &&
          (device === 'desktop' ? (
            <MenuProduct />
          ) : (
            <div className="h-full flex items-center justify-center p-6 text-center text-slate-500">
              <p className="max-w-xs text-sm font-semibold leading-relaxed">
                {t('menuEditorDesktopOnly')}
              </p>
            </div>
          ))}
      </div>

      <ConfirmDialog
        open={confirmReset}
        title={t('resetAllConfirmTitle')}
        message={t('resetAllConfirmMessage')}
        confirmLabel={resetting ? t('deleting') : t('deleteAllBtn')}
        cancelLabel={t('cancel')}
        variant="red"
        disabledSeconds={3}
        onConfirm={handleResetAll}
        onCancel={() => {
          if (resetting) return;
          setConfirmReset(false);
        }}
      />
    </div>
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex items-center gap-1.5 px-3 py-1.5 [@media(pointer:coarse)]:min-h-[44px] rounded-lg text-xs font-bold transition-all ${
        active
          ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
