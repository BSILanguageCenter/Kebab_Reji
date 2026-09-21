import { NavLink } from 'react-router-dom';
import { ShoppingCart, ChefHat, ClipboardList, BookOpen, LayoutGrid, BarChart3, Settings } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Language } from '@/lib/types';

const navItems = [
  { path: '/pos', key: 'nav.pos', icon: ShoppingCart },
  { path: '/kitchen', key: 'nav.kitchen', icon: ChefHat },
  { path: '/orders', key: 'nav.orders', icon: ClipboardList },
  { path: '/menu', key: 'nav.menu', icon: BookOpen },
  { path: '/tables', key: 'nav.tables', icon: LayoutGrid },
  { path: '/reports', key: 'nav.reports', icon: BarChart3 },
  { path: '/settings', key: 'nav.settings', icon: Settings },
] as const;

export default function Sidebar() {
  const { t } = useI18n();

  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      {navItems.map(({ path, key, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-4 py-3 text-base font-medium transition-all ${
              isActive
                ? 'bg-orange-600 text-white shadow-md shadow-orange-600/30'
                : 'text-gray-600 hover:bg-gray-100'
            }`
          }
        >
          <Icon size={24} strokeWidth={2} />
          <span>{t(key)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export type { Language };
