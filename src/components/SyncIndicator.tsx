import { useEffect, useState } from 'react';
import {
  Cloud,
  CloudOff,
  RefreshCw,
  X,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { useI18n } from '@/locale';
import {
  getSyncStatus,
  hasUnsyncedWork,
  flushNow,
  retryAllSyncFailed,
} from '@/services/googleSheetsSync';
import type { SyncStatusSnapshot } from '@/types/sync';

export function SyncIndicator() {
  const { t } = useI18n();
  const [status, setStatus] = useState<SyncStatusSnapshot | null>(() =>
    getSyncStatus()
  );
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const tick = () => setStatus(getSyncStatus());
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, []);

  if (!status) return null;

  const isOnline = status.isOnline;
  const hasWork = hasUnsyncedWork();
  const hasError = status.failed > 0 || !!status.lastError;

  const handleSendNow = async () => {
    setSending(true);
    try {
      await flushNow();
      setStatus(getSyncStatus());
    } finally {
      setSending(false);
    }
  };

  const handleRetryAll = () => {
    retryAllSyncFailed();
    setStatus(getSyncStatus());
  };

  // Что показывать иконкой:
  //  - офлайн → CloudOff (красный)
  //  - в очереди есть работа / syncing → RefreshCw (крутится, синий)
  //  - ошибка → AlertTriangle (янтарный)
  //  - всё хорошо → Cloud (зелёный)
  const isSpinning = isOnline && (hasWork || status.syncing > 0);
  const isError = isOnline && !isSpinning && hasError;

  const dotColor = !isOnline
    ? 'bg-red-500'
    : isError
    ? 'bg-amber-500'
    : isSpinning
    ? 'bg-blue-500 animate-pulse'
    : 'bg-green-500';

  return (
    <>
      {/* ============================================ */}
      {/* ТОЛЬКО ИКОНКА — без текста                   */}
      {/* ============================================ */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('syncPanelTitle')}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 hover:bg-slate-200 active:scale-95 transition-all"
      >
        {!isOnline ? (
          <CloudOff className="w-4 h-4 text-red-600" />
        ) : isSpinning ? (
          <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
        ) : isError ? (
          <AlertTriangle className="w-4 h-4 text-amber-600" />
        ) : (
          <Cloud className="w-4 h-4 text-green-600" />
        )}

        <span
          className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${dotColor}`}
        />
      </button>

      {/* ============================================ */}
      {/* МОДАЛКА С ИНФО                               */}
      {/* ============================================ */}
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-lg font-black text-slate-900">
                {t('syncPanelTitle')}
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-2.5">
              <div className="flex items-center justify-center gap-2 py-2 rounded-xl bg-slate-50 border border-slate-200">
                {!isOnline ? (
                  <>
                    <CloudOff className="w-5 h-5 text-red-600" />
                    <span className="font-black text-red-700 text-sm">
                      {t('offline')}
                    </span>
                  </>
                ) : hasError ? (
                  <>
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                    <span className="font-black text-amber-700 text-sm">
                      {t('syncStatusFailed')}
                    </span>
                  </>
                ) : hasWork ? (
                  <>
                    <RefreshCw className="w-5 h-5 text-blue-600 animate-spin" />
                    <span className="font-black text-blue-700 text-sm">
                      {t('syncStatusSyncing')}
                    </span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <span className="font-black text-green-700 text-sm">
                      {t('online')}
                    </span>
                  </>
                )}
              </div>

              <Row label={t('syncPanelLastSync')}>
                {status.lastSyncAt
                  ? new Date(status.lastSyncAt).toLocaleString()
                  : '—'}
              </Row>

              <Row label={t('syncPanelQueue')}>
                <span className="tabular-nums">
                  <span className="text-slate-900">{status.pending}</span>
                  <span className="text-slate-400"> / </span>
                  <span className="text-blue-600">{status.syncing}</span>
                  <span className="text-slate-400"> / </span>
                  <span className="text-red-600">{status.failed}</span>
                </span>
              </Row>

              {hasError && status.lastError && (
                <Row label={t('syncPanelLastError')}>
                  <span className="text-red-600 text-xs break-all max-w-[60%] text-right">
                    {status.lastError}
                  </span>
                </Row>
              )}

              {status.consecutiveFailures > 0 && (
                <Row label={t('syncPanelConsecutiveFailures')}>
                  <span className="text-red-600 font-black">
                    {status.consecutiveFailures}
                  </span>
                </Row>
              )}

              <div className="flex gap-2 pt-3 border-t border-slate-200">
                <button
                  onClick={handleSendNow}
                  disabled={sending || !isOnline}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold disabled:opacity-50 active:scale-95 transition-all"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${sending ? 'animate-spin' : ''}`}
                  />
                  {t('syncPanelSendNow')}
                </button>
                {status.failed > 0 && (
                  <button
                    onClick={handleRetryAll}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold active:scale-95 transition-all"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    {t('syncPanelRetryAll')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500 font-bold">{label}</span>
      <span className="font-bold text-slate-900 text-right">{children}</span>
    </div>
  );
}
