import { useState } from 'react';
import { useI18n } from '@/locale';
import { PageActions } from '@/components/PageActions';
import { BarChart3, Tag, Printer } from 'lucide-react';
import { StatistikProduct } from './Manager/StatistikProduct';
import { MenuProduct } from './Manager/MenuProduct';
import { PrinterSettingsPage } from './Manager/PrinterSettings';

type Tab = 'stats' | 'menu' | 'printer';

export default function ManagerPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('stats');

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100">
      <PageActions forRole="manager">
        <div className="flex gap-1">
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
          <TabButton
            active={tab === 'printer'}
            icon={<Printer className="w-3.5 h-3.5" />}
            onClick={() => setTab('printer')}
            label={t('printers')}
          />
        </div>
      </PageActions>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'stats' && <StatistikProduct />}
        {tab === 'menu' && <MenuProduct />}
        {tab === 'printer' && <PrinterSettingsPage />}
      </div>
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
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
        active
          ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}