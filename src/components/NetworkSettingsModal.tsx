// src/components/NetworkSettingsModal.tsx
import { useEffect, useState } from 'react';
import {
  X,
  Copy,
  Check,
  Wifi,
  ChefHat,
  Wallet,
  Settings2,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Plug,
  Users,
} from 'lucide-react';
import { useRole, type Role } from '@/lib/role';
import {
  getMyIp,
  getMyIpInfo,
  setMyIpManually,
  getDeviceIps,
  saveDeviceIps,
  copyMyIpToClipboard,
  testHubConnection,
  type DeviceIps,
  type SyncStatus,
  type MyIpInfo,
} from '@/lib/deviceInfo';
import { autoDetectHub, getLanStatus, onLanStatusChange } from '@/lib/lanSync';

interface Props {
  onClose: () => void;
}

export default function NetworkSettingsModal({ onClose }: Props) {
  const { role } = useRole();
  const [myIp, setMyIp] = useState<string | null>(null);
  const [myIpInfo, setMyIpInfo] = useState<MyIpInfo>(() => getMyIpInfo());
  const [deviceIps, setDeviceIps] = useState<DeviceIps>({
    cashier_ip: null,
    kitchen_ip: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lanConnected, setLanConnected] = useState(
    () => getLanStatus().connected
  );
  const [lanHubIp, setLanHubIp] = useState<string | null>(
    () => getLanStatus().hubIp
  );
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SyncStatus | null>(null);

  // ─── Загрузка ───────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [ip, ips] = await Promise.all([getMyIp(true), getDeviceIps()]);
        setMyIp(ip);
        setDeviceIps(ips);
        setMyIpInfo(getMyIpInfo());
        if (!ip) {
          setError('Не удалось определить IP. Задай вручную.');
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();

    const unsub = onLanStatusChange((s) => {
      setLanConnected(s.connected);
      setLanHubIp(s.hubIp);
    });
    return unsub;
  }, []);

  // ─── Копирование IP ─────────────────────────────────────────────────────
  const handleCopy = async () => {
    const ip = await copyMyIpToClipboard();
    if (ip) {
      setMyIp(ip);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setError('Не удалось скопировать IP');
    }
  };

  // ─── Задать IP вручную ──────────────────────────────────────────────────
  const handleSetManualIp = () => {
    const manual = window.prompt(
      'Введи IP этого устройства вручную.\n\n' +
        'Пример: 192.168.100.23\n\n' +
        'Оставь пустым, чтобы вернуться к автоопределению.',
      myIp || ''
    );
    if (manual === null) return;

    const clean = manual.trim();
    if (clean && !/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) {
      alert('Неверный формат IP. Пример: 192.168.100.23');
      return;
    }

    setMyIpManually(clean || null);
    window.location.reload();
  };

  // ─── Сбросить ручной IP ─────────────────────────────────────────────────
  const handleResetManualIp = () => {
    if (!confirm('Сбросить ручной IP и вернуться к автоопределению?')) return;
    setMyIpManually(null);
    window.location.reload();
  };

  // ─── Сохранение IP других устройств ─────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      const patch: Partial<DeviceIps> = {};
      if (role === 'cashier') patch.kitchen_ip = deviceIps.kitchen_ip;
      if (role === 'kitchen') patch.cashier_ip = deviceIps.cashier_ip;

      const ok = await saveDeviceIps(patch);
      if (!ok) throw new Error('Не удалось сохранить');

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);

      await autoDetectHub();
      setTimeout(() => handleTest(), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ─── Тест связи ─────────────────────────────────────────────────────────
  const handleTest = async () => {
    let targetIp: string | null = null;

    if (role === 'cashier') {
      targetIp = myIp;
    } else if (role === 'kitchen') {
      targetIp = deviceIps.cashier_ip;
    } else if (role === 'manager') {
      targetIp = deviceIps.cashier_ip;
    }

    if (!targetIp) {
      setTestResult({
        ok: false,
        connected_clients: 0,
        is_hub_active: false,
        message: 'Не указан IP для проверки',
      });
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const result = await testHubConnection(targetIp);
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  };

  // ─── Мета ролей ─────────────────────────────────────────────────────────
  const roleMeta = getRoleMeta(role);
  const RoleIcon = roleMeta.icon;
  const canEdit = role === 'cashier' || role === 'kitchen';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl">
        {/* ═══ Шапка ═══════════════════════════════════════════════════ */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${roleMeta.bgColor} ${roleMeta.textColor}`}
            >
              <RoleIcon size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                Связь устройств
              </h2>
              <p className="text-xs text-gray-500">{roleMeta.label}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
          >
            <X size={24} />
          </button>
        </div>

        {/* ═══ Индикатор LAN ═══════════════════════════════════════════ */}
        <div
          className={`flex items-center gap-3 border-b px-6 py-3 ${
            lanConnected
              ? 'border-green-100 bg-green-50'
              : 'border-amber-100 bg-amber-50'
          }`}
        >
          {lanConnected ? (
            <>
              <CheckCircle2 size={20} className="shrink-0 text-green-600" />
              <div className="flex-1">
                <p className="text-sm font-bold text-green-800">
                  LAN-соединение установлено
                </p>
                {lanHubIp && (
                  <p className="text-xs text-green-700">
                    Хаб: <b>{lanHubIp}</b>
                  </p>
                )}
              </div>
              <span className="rounded-full bg-green-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                Online
              </span>
            </>
          ) : (
            <>
              <XCircle size={20} className="shrink-0 text-amber-600" />
              <div className="flex-1">
                <p className="text-sm font-bold text-amber-800">
                  LAN не подключён
                </p>
                <p className="text-xs text-amber-700">
                  Проверь IP и нажми «Сохранить и подключить»
                </p>
              </div>
              <span className="rounded-full bg-amber-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                Offline
              </span>
            </>
          )}
        </div>

        {/* ═══ Содержимое ══════════════════════════════════════════════ */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 size={32} className="animate-spin text-gray-400" />
              <p className="text-sm text-gray-500">Определяю IP…</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 p-3">
                  <AlertCircle
                    size={18}
                    className="mt-0.5 shrink-0 text-red-600"
                  />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {/* ═══ Мой IP ══════════════════════════════════════════ */}
              <div className="mb-5 rounded-2xl border-2 border-dashed border-orange-200 bg-orange-50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">
                    IP этого устройства
                  </p>
                  {myIpInfo.source === 'auto' && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                      АВТО
                    </span>
                  )}
                  {myIpInfo.source === 'manual' && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                      ВРУЧНУЮ
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className="select-all text-2xl font-bold text-orange-900">
                    {myIp || '—'}
                  </p>
                  <button
                    onClick={handleCopy}
                    disabled={!myIp}
                    className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-40"
                  >
                    {copied ? (
                      <>
                        <Check size={16} />
                        Скопировано
                      </>
                    ) : (
                      <>
                        <Copy size={16} />
                        Копировать
                      </>
                    )}
                  </button>
                </div>

                <p className="mt-2 text-xs text-orange-600">
                  {role === 'cashier' &&
                    'Это главное устройство (хаб). Кухня подключится к нему.'}
                  {role === 'kitchen' &&
                    'Это устройство-клиент. Оно подключится к кассе.'}
                  {role === 'manager' &&
                    'Просмотр IP этого устройства (только чтение).'}
                </p>

                {/* Кнопка «Задать вручную» */}
                {canEdit && myIpInfo.source !== 'manual' && (
                  <button
                    onClick={handleSetManualIp}
                    className="mt-3 text-xs font-semibold text-orange-700 underline hover:text-orange-900"
                  >
                    Задать IP вручную
                  </button>
                )}

                {/* Кнопка «Сбросить» */}
                {canEdit && myIpInfo.source === 'manual' && (
                  <button
                    onClick={handleResetManualIp}
                    className="mt-3 text-xs font-semibold text-orange-700 underline hover:text-orange-900"
                  >
                    Сбросить и определить автоматически
                  </button>
                )}

                {/* Показ авто IP, если был override */}
                {myIpInfo.source === 'manual' && myIpInfo.autoIp && (
                  <p className="mt-2 text-xs text-orange-600">
                    Автоопределение показало: <b>{myIpInfo.autoIp}</b> (не
                    используется)
                  </p>
                )}
              </div>

              {/* ═══ IP кассы/кухни ══════════════════════════════════ */}
              {role === 'cashier' && (
                <div className="mb-4">
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <ChefHat size={16} className="text-orange-500" />
                    IP кухни (второе устройство)
                  </label>
                  <input
                    type="text"
                    value={deviceIps.kitchen_ip || ''}
                    onChange={(e) =>
                      setDeviceIps({
                        ...deviceIps,
                        kitchen_ip: e.target.value,
                      })
                    }
                    placeholder="192.168.1.101"
                    className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg font-medium focus:border-orange-400 focus:outline-none"
                  />
                  <p className="mt-2 text-xs text-gray-500">
                    Введи IP, который скопировал на кухонном устройстве
                  </p>
                </div>
              )}

              {role === 'kitchen' && (
                <div className="mb-4">
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <Wallet size={16} className="text-orange-500" />
                    IP кассы (главное устройство)
                  </label>
                  <input
                    type="text"
                    value={deviceIps.cashier_ip || ''}
                    onChange={(e) =>
                      setDeviceIps({
                        ...deviceIps,
                        cashier_ip: e.target.value,
                      })
                    }
                    placeholder="192.168.1.100"
                    className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg font-medium focus:border-orange-400 focus:outline-none"
                  />
                  <p className="mt-2 text-xs text-gray-500">
                    Введи IP, который скопировал на кассе
                  </p>
                </div>
              )}

              {role === 'manager' && (
                <div className="mb-4 flex flex-col gap-3">
                  <div className="rounded-xl bg-gray-50 p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <Wallet size={14} className="text-orange-500" />
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        IP кассы
                      </p>
                    </div>
                    <p className="select-all text-lg font-bold text-gray-900">
                      {deviceIps.cashier_ip || '—'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <ChefHat size={14} className="text-orange-500" />
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        IP кухни
                      </p>
                    </div>
                    <p className="select-all text-lg font-bold text-gray-900">
                      {deviceIps.kitchen_ip || '—'}
                    </p>
                  </div>
                  <div className="flex items-start gap-2 rounded-xl bg-blue-50 p-3">
                    <Settings2
                      size={16}
                      className="mt-0.5 shrink-0 text-blue-600"
                    />
                    <p className="text-xs text-blue-700">
                      Менеджер видит только текущие настройки. Изменять IP
                      могут касса (для кухни) и кухня (для кассы).
                    </p>
                  </div>
                </div>
              )}

              {/* ═══ Проверка связи ═══════════════════════════════════ */}
              <div className="mb-4 rounded-2xl border-2 border-blue-100 bg-blue-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Plug size={18} className="text-blue-600" />
                    <p className="text-sm font-bold text-blue-900">
                      Проверка связи
                    </p>
                  </div>
                  <button
                    onClick={handleTest}
                    disabled={testing}
                    className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {testing ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Wifi size={14} />
                    )}
                    {testing ? 'Проверка…' : 'Проверить'}
                  </button>
                </div>

                {testResult && (
                  <div
                    className={`flex items-start gap-2 rounded-xl p-3 ${
                      testResult.ok
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {testResult.ok ? (
                      <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                    ) : (
                      <XCircle size={18} className="mt-0.5 shrink-0" />
                    )}
                    <div className="flex-1">
                      <p className="text-sm font-bold">
                        {testResult.ok
                          ? 'Связь работает!'
                          : 'Связь не установлена'}
                      </p>
                      <p className="mt-0.5 text-xs">{testResult.message}</p>
                      {testResult.ok && (
                        <div className="mt-2 flex items-center gap-2">
                          <Users size={14} />
                          <span className="text-xs font-semibold">
                            Подключено устройств: {testResult.connected_clients}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {!testResult && (
                  <p className="text-xs text-blue-700">
                    Нажми «Проверить», чтобы убедиться, что Python-сервер
                    отвечает и клиенты подключены.
                  </p>
                )}
              </div>

              {/* ═══ Кнопка обновления ════════════════════════════════ */}
              <button
                onClick={async () => {
                  setLoading(true);
                  setError(null);
                  setTestResult(null);
                  try {
                    const [ip, ips] = await Promise.all([
                      getMyIp(true),
                      getDeviceIps(),
                    ]);
                    setMyIp(ip);
                    setDeviceIps(ips);
                    setMyIpInfo(getMyIpInfo());
                  } finally {
                    setLoading(false);
                  }
                }}
                className="flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-gray-700"
              >
                <RefreshCw size={12} />
                Обновить IP устройства
              </button>
            </>
          )}
        </div>

        {/* ═══ Низ ═════════════════════════════════════════════════════ */}
        {!loading && (
          <div className="flex gap-2 border-t border-gray-100 p-4">
            {canEdit ? (
              <>
                <button
                  onClick={onClose}
                  className="h-12 flex-1 rounded-xl bg-gray-100 text-sm font-semibold text-gray-600 hover:bg-gray-200"
                >
                  Закрыть
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : saved ? (
                    <Check size={18} />
                  ) : (
                    <Wifi size={18} />
                  )}
                  {saving
                    ? 'Сохранение…'
                    : saved
                    ? 'Сохранено'
                    : 'Сохранить и подключить'}
                </button>
              </>
            ) : (
              <button
                onClick={onClose}
                className="h-12 w-full rounded-xl bg-gray-100 text-sm font-semibold text-gray-600 hover:bg-gray-200"
              >
                Закрыть
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// МЕТА РОЛЕЙ
// ═══════════════════════════════════════════════════════════════════════════
function getRoleMeta(role: Role | null): {
  label: string;
  icon: typeof Wallet;
  bgColor: string;
  textColor: string;
} {
  switch (role) {
    case 'cashier':
      return {
        label: 'Касса (хаб)',
        icon: Wallet,
        bgColor: 'bg-orange-100',
        textColor: 'text-orange-600',
      };
    case 'kitchen':
      return {
        label: 'Кухня (клиент)',
        icon: ChefHat,
        bgColor: 'bg-gray-100',
        textColor: 'text-gray-700',
      };
    case 'manager':
      return {
        label: 'Менеджер',
        icon: Settings2,
        bgColor: 'bg-blue-100',
        textColor: 'text-blue-600',
      };
    default:
      return {
        label: 'Неизвестно',
        icon: Wifi,
        bgColor: 'bg-gray-100',
        textColor: 'text-gray-500',
      };
  }
}