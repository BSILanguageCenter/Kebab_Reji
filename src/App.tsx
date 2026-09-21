import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { I18nProvider } from '@/lib/i18n';
import { RoleProvider, useRole } from '@/lib/role';
import Layout from '@/components/Layout';
import RoleSwitcher from '@/components/RoleSwitcher';
import POSPage from '@/pages/POSPage';
import KitchenPage from '@/pages/KitchenPage';
import OrdersPage from '@/pages/OrdersPage';
import MenuPage from '@/pages/MenuPage';
import TablesPage from '@/pages/TablesPage';
import ReportsPage from '@/pages/ReportsPage';
import SettingsPage from '@/pages/SettingsPage';
import ReadyNotifications from '@/components/ReadyNotifications';

function App() {
  return (
    <I18nProvider>
      <RoleProvider>
        <BrowserRouter>
          <AppRoutes />
          <ReadyNotifications />
        </BrowserRouter>
      </RoleProvider>
    </I18nProvider>
  );
}

function AppRoutes() {
  const { role } = useRole();

  // Пока роль не выбрана — показываем экран выбора профиля
  if (!role) return <RoleSwitcher />;

  return (
    <Routes>
      <Route element={<Layout />}>
        {role === 'kitchen' && (
          <>
            <Route path="/kitchen" element={<KitchenPage />} />
            <Route path="*" element={<Navigate to="/kitchen" replace />} />
          </>
        )}

        {role === 'cashier' && (
          <>
            <Route path="/pos" element={<POSPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/tables" element={<TablesPage />} />
            <Route path="/menu" element={<MenuPage />} />
            <Route path="*" element={<Navigate to="/pos" replace />} />
          </>
        )}

        {role === 'manager' && (
          <>
            <Route path="/pos" element={<POSPage />} />
            <Route path="/kitchen" element={<KitchenPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/tables" element={<TablesPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/" element={<Navigate to="/pos" replace />} />
            <Route path="*" element={<Navigate to="/pos" replace />} />
          </>
        )}
      </Route>
    </Routes>
  );
}

export default App;