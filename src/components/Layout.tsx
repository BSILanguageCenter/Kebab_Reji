// src/components/Layout.tsx
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import Sidebar from './Sidebar';
import LanguageSwitcher from './LanguageSwitcher';
import RoleSwitcher from './RoleSwitcher';
import PrinterStatusIcon from './PrinterStatusIcon';
import SyncIndicator from './SyncIndicator';
import { syncPrintersFromDb } from '@/lib/LocalPrinterService';
import { startRealtimeSync } from '@/lib/realtimeSync';

const routeKeyMap: Record<string, string> = {
  '/pos': 'nav.pos',
  '/kitchen': 'nav.kitchen',
  '/orders': 'nav.orders',
  '/menu': 'nav.menu',
  '/tables': 'nav.tables',
  '/reports': 'nav.reports',
  '/settings': 'nav.settings',
  '/settings/tickets': 'nav.settings',
};

export default function Layout() {
  const { t } = useI18n();
  const location = useLocation();
  const titleKey = routeKeyMap[location.pathname] || 'nav.pos';

  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    syncPrintersFromDb().catch(() => {
      /* ignore */
    });
    startRealtimeSync();
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-600 text-white">
              <span className="text-xl font-bold">K</span>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Kebab POS</p>
              <p className="text-xs text-gray-400">ケバブハウス</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 lg:hidden"
          >
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <Sidebar />
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2 lg:gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-600 hover:bg-gray-100 lg:hidden"
              aria-label="Открыть меню"
            >
              <Menu size={24} />
            </button>

            <h1 className="truncate text-base font-bold text-gray-900 lg:text-lg">
              {t(titleKey)}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2 lg:gap-3">
            <SyncIndicator />
            <PrinterStatusIcon />
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