import { useState } from 'react';
import { useI18n } from '@/locale';
import { PageActions } from '@/components/PageActions';
import { BarChart3, Tag } from 'lucide-react';
import { StatistikProduct } from './Manager/StatistikProduct';
import { MenuProduct } from './Manager/MenuProduct';

type Tab = 'stats' | 'menu';

export default function ManagerPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('stats');

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100">
      <PageActions forRole="manager">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('stats')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              tab === 'stats'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            {t('statistics')}
          </button>
          <button
            onClick={() => setTab('menu')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              tab === 'menu'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            {t('menuManagement')}
          </button>
        </div>
      </PageActions>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'stats' && <StatistikProduct />}
        {tab === 'menu' && <MenuProduct />}
      </div>
    </div>
  );
}