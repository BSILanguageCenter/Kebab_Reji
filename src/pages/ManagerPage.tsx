import { useState } from 'react';
import { useI18n } from '@/locale';
import { PageActions } from '@/components/PageActions';
import { BarChart3, Tag, RotateCcw, Trash2 } from 'lucide-react';
import { StatistikProduct } from './Manager/StatistikProduct';
import { MenuProduct } from './Manager/MenuProduct';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { buildTestMenu } from '@/lib/seedMenu';
import { setMenuItems, resetAllData, getMenuItems } from '@/lib/localStore';
import { useViewport } from '@/lib/useViewport';

type Tab = 'stats' | 'menu';

export default function ManagerPage() {
  const { t } = useI18n();
  const { device } = useViewport();
  const [tab, setTab] = useState<Tab>('stats');
  const [confirmSeed, setConfirmSeed] = useState(false);

  const hasMenu = getMenuItems().length > 0;

  const handleSeed = () => {
    setMenuItems(buildTestMenu());
    setConfirmSeed(false);
    // Перезагружаем страницу, чтобы MenuProduct подхватил новое меню
    window.location.reload();
  };

  const handleResetAll = () => {
    if (
      !window.confirm(
        'Удалить ВСЁ: меню и заказы? Действие необратимо.'
      )
    ) {
      return;
    }
    resetAllData();
    window.location.reload();
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100">
      <PageActions forRole="manager">
        <div className="flex items-center gap-1">
          <TabButton
            active={tab === 'stats'}
            icon={<BarChart3 className="w-3.5 h-3.5" />}
            onClick={() => setTab('stats')}
            label={t('statistics')}
          />
          <TabButton
            active={tab === 'menu'}
            icon={<Tag className="w-3.5 h-3.5" />}
            onClick={() => setTab('menu')}
            label={t('menuManagement')}
          />
          <button
            onClick={() => setConfirmSeed(true)}
            className="ml-1 md:ml-2 flex items-center gap-1.5 px-3 py-1.5 [@media(pointer:coarse)]:min-h-[44px] rounded-lg text-xs font-bold bg-slate-200 hover:bg-slate-300 text-slate-700 transition-all active:scale-[0.97]"
            title="Загрузить тестовое меню (перезапишет текущее)"
            aria-label="Тестовое меню"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden md:inline">
              {hasMenu ? 'Пересоздать меню' : 'Тестовое меню'}
            </span>
          </button>
          <button
            onClick={handleResetAll}
            className="flex items-center gap-1.5 px-3 py-1.5 [@media(pointer:coarse)]:min-h-[44px] rounded-lg text-xs font-bold bg-red-100 hover:bg-red-200 text-red-700 transition-all active:scale-[0.97]"
            title="Удалить все данные (меню + заказы)"
            aria-label="Сброс всё"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Сброс всё</span>
          </button>
        </div>
      </PageActions>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'stats' && <StatistikProduct />}
        {tab === 'menu' &&
          (device === 'desktop' ? (
            <MenuProduct />
          ) : (
            <div className="h-full flex items-center justify-center p-6 text-center text-slate-500">
              <p className="max-w-xs text-sm font-semibold leading-relaxed">
                Редактор меню рассчитан на широкий экран (от 1024 px). Откройте
                его на компьютере или планшете в альбомной ориентации.
              </p>
            </div>
          ))}
      </div>

      <ConfirmDialog
        open={confirmSeed}
        title="Тестовое меню"
        message={
          hasMenu
            ? 'Текущее меню будет заменено тестовым. Заказы сохранятся. Продолжить?'
            : 'Загрузить тестовое меню (блюда, сеты, напитки, соусы, топпинги)?'
        }
        confirmLabel="Загрузить"
        cancelLabel="Отмена"
        variant="yellow"
        onConfirm={handleSeed}
        onCancel={() => setConfirmSeed(false)}
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
