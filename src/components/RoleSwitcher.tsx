import { useRole, type Role } from '@/lib/role';
import { useI18n } from '@/lib/i18n';
import { ChefHat, Wallet, Settings2, LogOut } from 'lucide-react';

const ROLE_META: Record<Role, { label: string; color: string; icon: React.ReactNode }> = {
  cashier: { label: 'Касса',    color: 'bg-orange-600', icon: <Wallet size={28} /> },
  kitchen: { label: 'Кухня',    color: 'bg-gray-800',   icon: <ChefHat size={28} /> },
  manager: { label: 'Менеджер', color: 'bg-blue-600',   icon: <Settings2 size={28} /> },
};

export default function RoleSwitcher() {
  const { role, setRole } = useRole();
  const { t } = useI18n();

  // --- Экран выбора профиля (роль не выбрана) ---
  if (!role) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl">
          <h1 className="mb-6 text-center text-2xl font-bold text-gray-900">
            {t('role.select') || 'Выберите профиль'}
          </h1>
          <div className="flex flex-col gap-3">
            {(Object.keys(ROLE_META) as Role[]).map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`flex items-center gap-3 rounded-2xl ${ROLE_META[r].color} p-4 text-white transition-all hover:opacity-90`}
              >
                {ROLE_META[r].icon}
                <span className="text-lg font-bold">{ROLE_META[r].label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // --- Компактный вид для шапки ---
  const meta = ROLE_META[role];

  return (
    <div className="flex items-center gap-2">
      <div className={`flex items-center gap-2 rounded-xl ${meta.color} px-3 py-2 text-white`}>
        <span className="[&_svg]:h-4 [&_svg]:w-4">{meta.icon}</span>
        <span className="text-xs font-bold">{meta.label}</span>
      </div>

      <button
        onClick={() => {
          if (confirm('Выйти из профиля?')) setRole(null);
        }}
        className="flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-100"
        title="Выход"
      >
        <LogOut size={16} />
        Выход
      </button>
    </div>
  );
}