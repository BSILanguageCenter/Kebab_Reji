// src/pages/ManagerPage.tsx
import { useEffect, useState } from 'react';
import { useI18n } from '@/locale';
import { PageActions } from '@/components/PageActions';
import { HeaderToggleButton } from '@/components/ViewToggles';
import { BarChart3, Tag } from 'lucide-react';
import { StatistikProduct } from './Manager/StatistikProduct';
import { MenuProduct } from './Manager/MenuProduct';
import { useViewport } from '@/lib/useViewport';
import { getCurrentUser, canSeeStatistics, type AuthUser } from '@/lib/auth';

type Tab = 'stats' | 'menu';

export default function ManagerPage() {
  const { t } = useI18n();
  const { device } = useViewport();

  // Реактивно отслеживаем пользователя (logout в другой вкладке тоже учтётся)
  const [user, setUser] = useState<AuthUser | null>(getCurrentUser);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'kebab-pos-auth') setUser(getCurrentUser());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Статистика только для admin
  const showStatistics = user ? canSeeStatistics(user.role) : false;

  // Начальная вкладка: admin → stats, иначе → menu
  const [tab, setTab] = useState<Tab>(showStatistics ? 'stats' : 'menu');

  // Если права пропали, а открыта stats — принудительно menu
  useEffect(() => {
    if (!showStatistics && tab === 'stats') setTab('menu');
  }, [showStatistics, tab]);

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100">
      {/* Шапка: у admin одна кнопка — ведёт на ДРУГУЮ вкладку.
          В статистике — «Управление меню», в меню — «Статистика». */}
      <PageActions forRole="manager">
        {showStatistics &&
          (tab === 'stats' ? (
            <HeaderToggleButton
              active={false}
              onClick={() => setTab('menu')}
              icon={<Tag className="w-4 h-4" />}
              label={t('menuManagement')}
              alwaysShowLabel
            />
          ) : (
            <HeaderToggleButton
              active={false}
              onClick={() => setTab('stats')}
              icon={<BarChart3 className="w-4 h-4" />}
              label={t('statistics')}
              alwaysShowLabel
            />
          ))}
      </PageActions>

      <div className="flex-1 min-h-0 overflow-hidden">
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
    </div>
  );
}
