// src/components/LanModal.tsx
import { useEffect, useState } from 'react';
import {
  X, Wifi, Plus, Radio, Trash2, Check, Loader2, RefreshCw, Unplug,
} from 'lucide-react';
import {
  listActiveLans, createLan, deleteMyLan, joinLan, leaveLan,
  getJoinedLan, getMyHubId, type LanHub,
} from '@/lib/lanHub';

export default function LanModal({ onClose }: { onClose: () => void }) {
  const [hubs, setHubs] = useState<LanHub[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [lanName, setLanName] = useState('');
  const [joined, setJoined] = useState<LanHub | null>(() => getJoinedLan());
  const [myHubId, setMyHubId] = useState<string | null>(() => getMyHubId());

  const load = async () => {
    try {
      setHubs(await listActiveLans());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const handleCreate = async () => {
    if (!lanName.trim()) return;
    setCreating(true);
    const result = await createLan(lanName.trim());
    setCreating(false);
    if (result.ok && result.hub) {
      setShowCreate(false);
      setLanName('');
      setMyHubId(getMyHubId());
      joinLan(result.hub);
      setJoined(result.hub);
      await load();
    } else {
      alert(result.error || 'Не удалось создать LAN');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Удалить свой LAN? Другие устройства отключатся.')) return;
    await deleteMyLan();
    setMyHubId(null);
    setJoined(null);
    await load();
  };

  const handleConnect = (hub: LanHub) => {
    joinLan(hub);
    setJoined(hub);
    window.location.reload();
  };

  const handleDisconnect = () => {
    leaveLan();
    setJoined(null);
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl">
        {/* Шапка */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                joined ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'
              }`}
            >
              <Wifi size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Локальная сеть</h2>
              <p className="text-xs text-gray-500">
                {joined ? `Подключено: ${joined.name}` : 'Не подключено'}
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

        {/* Список */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Доступные сети
            </p>
            <button
              onClick={load}
              disabled={loading}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              title="Обновить"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {loading && hubs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 className="animate-spin text-gray-400" size={32} />
              <p className="text-sm text-gray-500">Поиск сетей…</p>
            </div>
          ) : hubs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 py-12">
              <Radio size={40} className="text-gray-300" />
              <p className="text-sm font-semibold text-gray-600">Сетей не найдено</p>
              <p className="px-8 text-center text-xs text-gray-400">
                Создайте LAN на устройстве с запущенным Python-сервером
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {hubs.map((hub) => {
                const isJoined = joined?.id === hub.id;
                return (
                  <div
                    key={hub.id}
                    className={`flex items-center gap-3 rounded-2xl border-2 p-4 transition-all ${
                      isJoined
                        ? 'border-green-400 bg-green-50'
                        : 'border-gray-200 bg-white hover:border-blue-300'
                    }`}
                  >
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                        hub.isOwn
                          ? 'bg-purple-100 text-purple-600'
                          : 'bg-blue-100 text-blue-600'
                      }`}
                    >
                      <Radio size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-base font-bold text-gray-900">
                        {hub.name}
                        {hub.isOwn && (
                          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700">
                            МОЙ
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {hub.hubIp}:{hub.port}
                      </p>
                    </div>
                    {isJoined ? (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-green-500 px-3 py-1.5 text-xs font-bold text-white">
                        <Check size={12} />
                        Подключено
                      </span>
                    ) : (
                      <button
                        onClick={() => handleConnect(hub)}
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
          {!myHubId && !showCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-orange-300 text-sm font-bold text-orange-600 transition-colors hover:bg-orange-50"
            >
              <Plus size={18} />
              Создать LAN
            </button>
          )}

          {showCreate && (
            <div className="mt-4 rounded-2xl border-2 border-orange-200 bg-orange-50 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-700">
                Новая LAN
              </p>
              <input
                type="text"
                value={lanName}
                onChange={(e) => setLanName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Название, напр. Kebab POS"
                autoFocus
                className="w-full rounded-xl border-2 border-orange-200 px-4 py-3 text-sm focus:border-orange-400 focus:outline-none"
              />
              <p className="mt-2 text-xs text-orange-600">
                LAN создаётся на этом устройстве. Нужен запущенный Python-сервер.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    setShowCreate(false);
                    setLanName('');
                  }}
                  className="h-11 flex-1 rounded-xl bg-white text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Отмена
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating || !lanName.trim()}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-40"
                >
                  {creating && <Loader2 size={14} className="animate-spin" />}
                  {creating ? 'Создание…' : 'Создать'}
                </button>
              </div>
            </div>
          )}

          {myHubId && (
            <button
              onClick={handleDelete}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-50 text-sm font-semibold text-red-600 hover:bg-red-100"
            >
              <Trash2 size={16} />
              Удалить мой LAN
            </button>
          )}
        </div>

        {/* Низ */}
        <div className="flex gap-2 border-t border-gray-100 p-4">
          {joined && (
            <button
              onClick={handleDisconnect}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-red-50 text-sm font-semibold text-red-600 hover:bg-red-100"
            >
              <Unplug size={16} />
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
    </div>
  );
}