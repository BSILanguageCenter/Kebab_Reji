// src/components/LanModal.tsx
import { useEffect, useState } from 'react';
import {
  X, Wifi, Plus, Radio, Loader2, RefreshCw, Lock, Unlock,
  Users, Trash2, Unplug, Check, AlertCircle, Power,
} from 'lucide-react';
import {
  discoverLans, createLan, stopMyLan, joinLan, leaveLan,
  getJoinedLan, getLanStatus, onLanStatusChange, initLan,
  type LanAnnounce,
} from '@/lib/lanHub';

type Mode = 'idle' | 'creating' | 'scanning';

export default function LanModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState(() => getLanStatus());
  const [mode, setMode] = useState<Mode>('idle');
  const [lans, setLans] = useState<LanAnnounce[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  // Создание
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);

  // Подключение
  const [passwordPrompt, setPasswordPrompt] = useState<LanAnnounce | null>(
    null
  );
  const [joinPassword, setJoinPassword] = useState('');
  const [joining, setJoining] = useState(false);

  const joined = getJoinedLan();

  useEffect(() => {
    initLan();
    return onLanStatusChange(setState);
  }, []);

  const handleSearch = async () => {
    setSearching(true);
    setSearched(true);
    try {
      const list = await discoverLans();
      setLans(list);
    } catch (e) {
      alert('Ошибка поиска: ' + (e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const result = await createLan(newName.trim(), newPassword);
    setCreating(false);
    if (result.ok) {
      setNewName('');
      setNewPassword('');
      setMode('idle');
    } else {
      alert(result.error || 'Не удалось создать LAN');
    }
  };

  const handleStop = async () => {
    if (!confirm('Остановить свой LAN? Клиенты отключатся.')) return;
    await stopMyLan();
  };

  const handleConnectClick = (lan: LanAnnounce) => {
    if (lan.has_password) {
      setPasswordPrompt(lan);
      setJoinPassword('');
    } else {
      joinLan(lan, '');
      window.location.reload();
    }
  };

  const handleJoinConfirm = () => {
    if (!passwordPrompt) return;
    setJoining(true);
    joinLan(passwordPrompt, joinPassword);
    setTimeout(() => {
      setJoining(false);
      setPasswordPrompt(null);
      window.location.reload();
    }, 500);
  };

  const handleDisconnect = () => {
    leaveLan();
    window.location.reload();
  };

  const isHub = state.role === 'hub' && state.hub;
  const isClient = state.role === 'client' && state.hub;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl">
        {/* Шапка */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                isHub
                  ? 'bg-purple-100 text-purple-600'
                  : isClient
                  ? 'bg-green-100 text-green-600'
                  : 'bg-blue-100 text-blue-600'
              }`}
            >
              <Wifi size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Локальная сеть</h2>
              <p className="text-xs text-gray-500">
                {isHub && `Ваш LAN: ${state.hub!.name}`}
                {isClient && `Подключено к: ${state.hub!.name}`}
                {!isHub && !isClient && 'Не подключено'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
          >
            <X size={24} />
          </button>
        </div>

        {/* Состояние hub */}
        {isHub && (
          <div className="border-b border-purple-100 bg-purple-50 px-6 py-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-500 text-white">
                <Radio size={22} />
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">
                  Ваш LAN активен
                </p>
                <p className="text-lg font-bold text-purple-900">
                  {state.hub!.name}
                </p>
                <p className="text-xs text-purple-700">
                  {state.hub!.ip}:{state.hub!.port} ·{' '}
                  {state.hub!.has_password ? '🔒 с паролем' : '🔓 открытый'}
                </p>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5">
                  <Users size={14} className="text-purple-600" />
                  <span className="text-sm font-bold text-purple-900">
                    {state.clients}
                  </span>
                </div>
                <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-purple-500">
                  устройств
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Состояние client */}
        {isClient && (
          <div className="border-b border-green-100 bg-green-50 px-6 py-3">
            <div className="flex items-center gap-3">
              <Check size={20} className="text-green-600" />
              <div className="flex-1">
                <p className="text-sm font-bold text-green-800">
                  Подключено к {state.hub!.name}
                </p>
                <p className="text-xs text-green-700">
                  {state.hub!.ip}:{state.hub!.port} · устройств в сети:{' '}
                  <b>{state.clients}</b>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Ошибка */}
        {state.error && (
          <div className="flex items-start gap-2 border-b border-red-100 bg-red-50 px-6 py-3">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
            <p className="text-sm text-red-700">{state.error}</p>
          </div>
        )}

        {/* Тело */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Если я hub — показываем только кнопку остановки */}
          {isHub ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-xs text-gray-500">
                  Другие устройства найдут ваш LAN автоматически через
                  Wi-Fi. Пароль {state.hub!.has_password ? 'установлен' : 'не установлен'}.
                </p>
              </div>
              <button
                onClick={handleStop}
                className="flex h-12 items-center justify-center gap-2 rounded-xl bg-red-50 text-sm font-semibold text-red-600 hover:bg-red-100"
              >
                <Power size={16} />
                Остановить LAN
              </button>
            </div>
          ) : (
            <>
              {/* Список LAN */}
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Доступные LAN
                </p>
                <button
                  onClick={handleSearch}
                  disabled={searching}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {searching ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <RefreshCw size={12} />
                  )}
                  {searching ? 'Поиск…' : 'Искать'}
                </button>
              </div>

              {!searched && !searching && (
                <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 py-10">
                  <Radio size={40} className="text-gray-300" />
                  <p className="text-sm font-semibold text-gray-600">
                    Нажмите «Искать»
                  </p>
                  <p className="px-8 text-center text-xs text-gray-400">
                    Поиск идёт через Wi-Fi/Ethernet, интернет не нужен
                  </p>
                </div>
              )}

              {searching && (
                <div className="flex flex-col items-center gap-3 py-10">
                  <Loader2 size={32} className="animate-spin text-blue-500" />
                  <p className="text-sm text-gray-500">
                    Сканирую локальную сеть…
                  </p>
                </div>
              )}

              {searched && !searching && lans.length === 0 && (
                <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50 py-10">
                  <AlertCircle size={40} className="text-amber-400" />
                  <p className="text-sm font-semibold text-amber-800">
                    LAN не найдено
                  </p>
                  <p className="px-8 text-center text-xs text-amber-700">
                    Убедитесь, что касса создала LAN и оба устройства в одной
                    Wi-Fi сети
                  </p>
                </div>
              )}

              {searched && !searching && lans.length > 0 && (
                <div className="flex flex-col gap-2">
                  {lans.map((lan) => {
                    const isConnectedToThis =
                      joined?.ip === lan.ip && joined?.port === lan.port;
                    return (
                      <div
                        key={`${lan.ip}:${lan.port}`}
                        className={`flex items-center gap-3 rounded-2xl border-2 p-4 ${
                          isConnectedToThis
                            ? 'border-green-400 bg-green-50'
                            : 'border-gray-200 bg-white hover:border-blue-300'
                        }`}
                      >
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                          {lan.has_password ? (
                            <Lock size={20} />
                          ) : (
                            <Unlock size={20} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-bold text-gray-900">
                            {lan.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {lan.ip}:{lan.port} ·{' '}
                            <Users size={10} className="inline" /> {lan.clients}{' '}
                            устройств
                          </p>
                        </div>
                        {isConnectedToThis ? (
                          <button
                            onClick={handleDisconnect}
                            className="shrink-0 rounded-xl bg-red-100 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-200"
                          >
                            <Unplug size={14} className="inline mr-1" />
                            Отключить
                          </button>
                        ) : (
                          <button
                            onClick={() => handleConnectClick(lan)}
                            className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
                          >
                            Подключить
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Создать LAN */}
              <div className="mt-5 border-t border-gray-100 pt-5">
                {mode !== 'creating' ? (
                  <button
                    onClick={() => setMode('creating')}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-orange-300 text-sm font-bold text-orange-600 hover:bg-orange-50"
                  >
                    <Plus size={18} />
                    Создать свой LAN
                  </button>
                ) : (
                  <div className="rounded-2xl border-2 border-orange-200 bg-orange-50 p-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-orange-700">
                      Новый LAN
                    </p>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Название, напр. Kebab POS"
                      autoFocus
                      className="mb-2 w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-sm focus:border-orange-400 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Пароль (необязательно)"
                      className="w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-sm focus:border-orange-400 focus:outline-none"
                    />
                    <p className="mt-2 text-xs text-orange-600">
                      LAN создаётся на этом устройстве. Для подключения
                      других нужен только Wi-Fi/Ethernet.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => {
                          setMode('idle');
                          setNewName('');
                          setNewPassword('');
                        }}
                        className="h-11 flex-1 rounded-xl bg-white text-sm font-semibold text-gray-600 hover:bg-gray-50"
                      >
                        Отмена
                      </button>
                      <button
                        onClick={handleCreate}
                        disabled={creating || !newName.trim()}
                        className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-40"
                      >
                        {creating && (
                          <Loader2 size={14} className="animate-spin" />
                        )}
                        {creating ? 'Создание…' : 'Создать'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Низ */}
        <div className="flex gap-2 border-t border-gray-100 p-4">
          {isClient && (
            <button
              onClick={handleDisconnect}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-red-50 text-sm font-semibold text-red-600 hover:bg-red-100"
            >
              <Trash2 size={16} />
              Отключиться
            </button>
          )}
          <button
            onClick={onClose}
            className="h-12 flex-1 rounded-xl bg-gray-100 text-sm font-semibold text-gray-600 hover:bg-gray-200"
          >
            Закрыть
          </button>
        </div>
      </div>

      {/* Модалка пароля */}
      {passwordPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                <Lock size={22} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  Введите пароль
                </h3>
                <p className="text-xs text-gray-500">{passwordPrompt.name}</p>
              </div>
            </div>
            <input
              type="password"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' && handleJoinConfirm()
              }
              placeholder="Пароль"
              autoFocus
              className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm focus:border-blue-400 focus:outline-none"
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  setPasswordPrompt(null);
                  setJoinPassword('');
                }}
                className="h-11 flex-1 rounded-xl bg-gray-100 text-sm font-semibold text-gray-600"
              >
                Отмена
              </button>
              <button
                onClick={handleJoinConfirm}
                disabled={joining}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {joining && <Loader2 size={14} className="animate-spin" />}
                {joining ? 'Подключение…' : 'Подключить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}