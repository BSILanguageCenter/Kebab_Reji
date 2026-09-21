import { Outlet, useLocation } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import Sidebar from './Sidebar';
import LanguageSwitcher from './LanguageSwitcher';
import RoleSwitcher from './RoleSwitcher';

const routeKeyMap: Record<string, string> = {
  '/pos': 'nav.pos',
  '/kitchen': 'nav.kitchen',
  '/orders': 'nav.orders',
  '/menu': 'nav.menu',
  '/tables': 'nav.tables',
  '/reports': 'nav.reports',
  '/settings': 'nav.settings',
};

export default function Layout() {
  const { t } = useI18n();
  const location = useLocation();
  const titleKey = routeKeyMap[location.pathname] || 'nav.pos';

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-600 text-white">
            <span className="text-xl font-bold">K</span>
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Kebab POS</p>
            <p className="text-xs text-gray-400">ケバブハウス</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Sidebar />
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
          <h1 className="text-lg font-bold text-gray-900">{t(titleKey)}</h1>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <RoleSwitcher />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}