import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  RefreshCw,
  Send,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Trash2,
  Download,
  Cloud,
} from 'lucide-react';
import { useI18n } from '@/locale';
import { formatTime } from '@/locale/format';
import {
  getAllOperations,
  getQueueSnapshot,
  getState,
  retryOperation,
  removeOperation,
  retryAllFailed,
  subscribeQueue,
} from '@/services/syncQueue';
import { flushNow, getSyncStatus } from '@/services/googleSheetsSync';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { SyncOperation, SyncStatus } from '@/types/sync';

/**
 * Модальная панель диагностики синхронизации.
 *
 * Показывает:
 *  - Общую статистику (pending / syncing / synced / failed).
 *  - Последнюю синхронизацию, последнюю ошибку, consecutiveFailures.
 *  - Таблицу операций с фильтром по статусу.
 *  - Кнопки: «Отправить сейчас», «Повторить все», «Экспорт в JSON».
 *  - Per-row: retry, remove.
 *
 * Открывается из SyncIndicator в шапке.
 */
export function SyncPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [ops, setOps] = useState<SyncOperation[]>([]);
  const [filter, setFilter] = useState<SyncStatus | 'all'>('all');
  const [sending, setSending] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);
  const [pendingRemove, setPendingRemove] =
    useState<SyncOperation | null>(null);
  const [, forceTick] = useState(0);

  // Подписка на изменения очереди
  useEffect(() => {
    if (!open) return;
    const refresh = () => setOps(getAllOperations());
    refresh();
    const unsub = subscribeQueue(refresh);
    // Также принудительный тик каждые 2 сек — на случай отложенных изменений
    const id = window.setInterval(() => {
      refresh();
      forceTick((x) => x + 1);
    }, 2000);
    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, [open]);

  // ESC закрывает
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const snapshot = useMemo(() => getQueueSnapshot(), [ops]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = useMemo(() => getState(), [ops]); // eslint-disable-line react-hooks/exhaustive-deps
  const syncStatus = useMemo(() => getSyncStatus(), [ops]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const list =
      filter === 'all'
        ? ops
        : ops.filter((op) => op.syncStatus === filter);
    // Свежие сверху
    return [...list].sort((a, b) => {
      const ta = a.lastAttemptAt ?? 0;
      const tb = b.lastAttemptAt ?? 0;
      return tb - ta;
    });
  }, [ops, filter]);

  if (!open) return null;

  const handleSendNow = async () => {
    setSending(true);
    try {
      await flushNow();
      setOps(getAllOperations());
    } finally {
      setSending(false);
    }
  };

  const handleRetryAll = async () => {
    setRetryingAll(true);
    try {
      retryAllFailed();
      await flushNow();
      setOps(getAllOperations());
    } finally {
      setRetryingAll(false);
    }
  };

  const handleRetryOne = async (operationId: string) => {
    retryOperation(operationId);
    setOps(getAllOperations());
    // Не ждём — flushOnce сам подхватит
    void flushNow();
  };

  const handleRemoveConfirm = () => {
    if (!pendingRemove) return;
    removeOperation(pendingRemove.operationId);
    setPendingRemove(null);
    setOps(getAllOperations());
  };

  const handleExport = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      deviceId: localStorage.getItem('pos_device_id'),
      state,
      snapshot,
      operations: getAllOperations(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `kebab-pos-sync-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const statusBadge = (s: SyncStatus) => {
    const map: Record<
      SyncStatus,
      { cls: string; icon: JSX.Element; label: string }
    > = {
      pending: {
        cls: 'bg-blue-100 text-blue-700',
        icon: <Clock className="w-3 h-3" />,
        label: t('syncStatusPending'),
      },
      syncing: {
        cls: 'bg-amber-100 text-amber-700',
        icon: <Loader2 className="w-3 h-3 animate-spin" />,
        label: t('syncStatusSyncing'),
      },
      synced: {
        cls: 'bg-green-100 text-green-700',
        icon: <CheckCircle2 className="w-3 h-3" />,
        label: t('syncStatusSynced'),
      },
      failed: {
        cls: 'bg-red-100 text-red-700',
        icon: <AlertTriangle className="w-3 h-3" />,
        label: t('syncStatusFailed'),
      },
    };
    const m = map[s];
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[0.625rem] font-bold ${m.cls}`}
      >
        {m.icon}
        {m.label}
      </span>
    );
  };

  const opTypeLabel = (op: SyncOperation) => {
    if (op.operationType === 'create') {
      return t('opCreate');
    }
    if (op.operationType === 'update') {
      return t('opUpdate');
    }
    return t('opStatus');
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10040] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-orange-500" />
            <h3 className="text-lg font-black text-gray-900">
              {t('syncPanelTitle')}
            </h3>
            {syncStatus.isOnline ? (
              <span className="text-[0.625rem] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-md">
                ONLINE
              </span>
            ) : (
              <span className="text-[0.625rem] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-md">
                OFFLINE
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 active:scale-95"
            aria-label={t('close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {/* Stats */}
          <div>
            <div className="text-[0.625rem] font-black text-gray-400 uppercase tracking-widest mb-2">
              {t('syncPanelStats')}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatBox
                label={t('syncStatusPending')}
                value={snapshot.pending}
                cls="bg-blue-50 text-blue-700 border-blue-200"
              />
              <StatBox
                label={t('syncStatusSyncing')}
                value={snapshot.syncing}
                cls="bg-amber-50 text-amber-700 border-amber-200"
              />
              <StatBox
                label={t('syncStatusSynced')}
                value={snapshot.synced}
                cls="bg-green-50 text-green-700 border-green-200"
              />
              <StatBox
                label={t('syncStatusFailed')}
                value={snapshot.failed}
                cls="bg-red-50 text-red-700 border-red-200"
              />
            </div>
            <div className="mt-2 text-xs text-gray-500 space-y-0.5">
              <div>
                <span className="font-bold">
                  {t('syncPanelLastSync')}:
                </span>{' '}
                {state.lastSyncAt
                  ? formatTime(new Date(state.lastSyncAt).toISOString())
                  : '—'}
              </div>
              {state.lastError && (
                <div className="text-red-600">
                  <span className="font-bold">
                    {t('syncPanelLastError')}:
                  </span>{' '}
                  {state.lastError}
                </div>
              )}
              {state.consecutiveFailures > 0 && (
                <div className="text-amber-600">
                  <span className="font-bold">
                    {t('syncPanelConsecutiveFailures')}:
                  </span>{' '}
                  {state.consecutiveFailures}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSendNow}
              disabled={sending}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold active:scale-95 transition-colors disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              {t('syncPanelSendNow')}
            </button>
            <button
              onClick={handleRetryAll}
              disabled={retryingAll || snapshot.failed === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold active:scale-95 transition-colors disabled:opacity-40"
            >
              {retryingAll ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {t('syncPanelRetryAll')}
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-bold active:scale-95 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              {t('syncPanelExport')}
            </button>
          </div>

          {/* Filter */}
          <div className="flex gap-1.5 flex-wrap">
            <FilterChip
              active={filter === 'all'}
              onClick={() => setFilter('all')}
              label={`${t('syncPanelFilterAll')} (${ops.length})`}
            />
            <FilterChip
              active={filter === 'pending'}
              onClick={() => setFilter('pending')}
              label={`${t('syncStatusPending')} (${snapshot.pending})`}
            />
            <FilterChip
              active={filter === 'syncing'}
              onClick={() => setFilter('syncing')}
              label={`${t('syncStatusSyncing')} (${snapshot.syncing})`}
            />
            <FilterChip
              active={filter === 'synced'}
              onClick={() => setFilter('synced')}
              label={`${t('syncStatusSynced')} (${snapshot.synced})`}
            />
            <FilterChip
              active={filter === 'failed'}
              onClick={() => setFilter('failed')}
              label={`${t('syncStatusFailed')} (${snapshot.failed})`}
            />
          </div>

          {/* Table */}
          <div>
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                {t('syncPanelEmpty')}
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500 font-bold text-[0.625rem] uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-2 py-2">
                        {t('syncPanelColOperation')}
                      </th>
                      <th className="text-left px-2 py-2">
                        {t('syncPanelColOrder')}
                      </th>
                      <th className="text-center px-2 py-2">
                        {t('syncPanelColVersion')}
                      </th>
                      <th className="text-center px-2 py-2">
                        {t('syncPanelColAttempts')}
                      </th>
                      <th className="text-left px-2 py-2">
                        {t('syncStatusPending')}
                      </th>
                      <th className="text-right px-2 py-2 w-20">
                        {t('syncPanelColActions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((op) => (
                      <tr key={op.operationId} className="hover:bg-gray-50">
                        <td className="px-2 py-2 font-bold text-gray-800 whitespace-nowrap">
                          {opTypeLabel(op)}
                        </td>
                        <td className="px-2 py-2 text-gray-700 font-mono text-[0.625rem] truncate max-w-[8rem]">
                          {op.orderId.slice(0, 12)}…
                        </td>
                        <td className="px-2 py-2 text-center text-gray-600 tabular-nums">
                          {op.version}
                        </td>
                        <td className="px-2 py-2 text-center text-gray-600 tabular-nums">
                          {op.attempts}
                        </td>
                        <td className="px-2 py-2">
                          {statusBadge(op.syncStatus)}
                          {op.lastError && (
                            <div
                              className="text-[0.625rem] text-red-600 mt-0.5 truncate max-w-[14rem]"
                              title={op.lastError}
                            >
                              {op.lastError}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          {op.syncStatus !== 'synced' && (
                            <button
                              onClick={() =>
                                handleRetryOne(op.operationId)
                              }
                              title={t('syncPanelRetry')}
                              className="w-7 h-7 rounded-md text-blue-600 hover:bg-blue-50 active:scale-90 inline-flex items-center justify-center"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => setPendingRemove(op)}
                            title={t('syncPanelRemove')}
                            className="w-7 h-7 rounded-md text-red-600 hover:bg-red-50 active:scale-90 inline-flex items-center justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingRemove !== null}
        message={t('syncPanelConfirmRemove')}
        confirmLabel={t('syncPanelRemove')}
        variant="red"
        onConfirm={handleRemoveConfirm}
        onCancel={() => setPendingRemove(null)}
      />
    </div>,
    document.body
  );
}

function StatBox({
  label,
  value,
  cls,
}: {
  label: string;
  value: number;
  cls: string;
}) {
  return (
    <div
      className={`rounded-xl border p-2 ${cls} flex flex-col items-start`}
    >
      <div className="text-[0.625rem] font-black uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="text-xl font-black tabular-nums leading-none mt-0.5">
        {value}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[0.6875rem] font-bold border transition-colors ${
        active
          ? 'bg-orange-500 text-white border-orange-500'
          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
}
