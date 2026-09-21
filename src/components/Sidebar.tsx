// src/components/Sidebar.tsx
import { NavLink } from 'react-router-dom';
import {
  ShoppingCart,
  ChefHat,
  ClipboardList,
  BookOpen,
  LayoutGrid,
  BarChart3,
  Settings,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useRole } from '@/lib/role';

const navItems = [
  { path: '/pos', key: 'nav.pos', icon: ShoppingCart, roles: ['cashier', 'manager'] },
  { path: '/kitchen', key: 'nav.kitchen', icon: ChefHat, roles: ['kitchen', 'manager'] },
  { path: '/orders', key: 'nav.orders', icon: ClipboardList, roles: ['cashier', 'manager'] },
  { path: '/menu', key: 'nav.menu', icon: BookOpen, roles: ['cashier', 'manager'] },
  { path: '/tables', key: 'nav.tables', icon: LayoutGrid, roles: ['cashier', 'manager'] },
  { path: '/reports', key: 'nav.reports', icon: BarChart3, roles: ['manager'] },
  { path: '/settings', key: 'nav.settings', icon: Settings, roles: ['manager'] },
] as const;

export default function Sidebar() {
  const { t } = useI18n();
  const { role } = useRole();

  const visible = navItems.filter(
    (item) => !role || (item.roles as readonly string[]).includes(role)
  );

  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      {visible.map(({ path, key, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-4 py-3.5 text-base font-medium transition-colors ${
              isActive
                ? 'bg-orange-600 text-white shadow-md shadow-orange-600/30'
                : 'text-gray-600 active:bg-gray-100 lg:hover:bg-gray-100'
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