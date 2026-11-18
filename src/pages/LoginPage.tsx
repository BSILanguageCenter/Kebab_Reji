// src/pages/LoginPage.tsx
import { useState, type FormEvent } from 'react';
import { login, type AuthUser } from '@/lib/auth';
import { useI18n } from '@/locale';
import { LogIn } from 'lucide-react';

export default function LoginPage({
  onLoggedIn,
}: {
  onLoggedIn: (u: AuthUser) => void;
}) {
  const { t } = useI18n();
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // ✅ await обязателен — login теперь асинхронный (Firebase)
      const user = await login(loginValue, password);
      onLoggedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loginError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6 space-y-4"
      >
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-black text-slate-900">
            {t('appName')}
          </h1>
          <p className="text-sm text-slate-500">{t('loginSubtitle')}</p>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">
            {t('loginEmailLabel')}
          </label>
          <input
            type="email"
            autoFocus
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
            placeholder={t('loginEmailPlaceholder')}
            autoComplete="username"
            className="w-full px-3 py-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">
            {t('loginPasswordLabel')}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('loginPasswordPlaceholder')}
            autoComplete="current-password"
            className="w-full px-3 py-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full h-12 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-black flex items-center justify-center gap-2 shadow-lg shadow-orange-500/30 active:scale-[0.98] disabled:opacity-50 transition-all"
        >
          <LogIn className="w-5 h-5" />
          {busy ? t('loginBusy') : t('loginButton')}
        </button>

        <p className="text-[11px] text-slate-400 text-center leading-tight">
          {t('loginHintAdmin')}
          <br />
          {t('loginHintManager')}
        </p>
      </form>
    </div>
  );
}
