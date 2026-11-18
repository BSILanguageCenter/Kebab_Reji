// src/components/StorageBar.tsx
import { useEffect, useState } from 'react';
import { Database, Cloud, Image, ListChecks, RefreshCw } from 'lucide-react';
import { getStorageInfo } from '@/lib/storageUsage';
import { getSyncStatus } from '@/services/googleSheetsSync';
import { useI18n } from '@/locale';
import type { SyncStatusSnapshot } from '@/types/sync';

export function StorageBar({
  onImportComplete,
}: {
  onImportComplete?: () => void;
}) {
  const { lang } = useI18n();
  const ru = lang === 'ru';

  const [info, setInfo] = useState(getStorageInfo);
  const [syncStatus, setSyncStatus] =
    useState<SyncStatusSnapshot>(getSyncStatus);

  useEffect(() => {
    const id = window.setInterval(() => {
      setInfo(getStorageInfo());
      setSyncStatus(getSyncStatus());
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    void onImportComplete;
  }, [onImportComplete]);

  const barColor =
    info.usedPct < 50
      ? 'bg-green-500'
      : info.usedPct < 80
      ? 'bg-yellow-500'
      : 'bg-red-500';

  return (
    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-[0.6875rem]">
      {/* localStorage */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1 font-black uppercase tracking-wider text-slate-600">
            <Database className="w-3 h-3" />
            localStorage
          </div>
          <div className="font-mono tabular-nums text-slate-500">
            {info.usedMB} / {info.totalMB} MB
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(100, info.usedPct)}%` }}
          />
        </div>
      </div>

      {/* Фото */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 font-bold text-slate-600">
          <Image className="w-3 h-3 text-orange-500" />
          {ru ? 'Фото' : 'Photos'}
        </div>
        <div className="font-mono tabular-nums text-slate-500">
          {info.imagesCount} → Supabase
        </div>
      </div>

      {/* Очередь заказов */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 font-bold text-slate-600">
          <Cloud className="w-3 h-3 text-blue-500" />
          {ru ? 'Заказы в Sheets' : 'Orders to Sheets'}
        </div>
        <div
          className={`font-mono tabular-nums ${
            (syncStatus.ordersFailed ?? 0) > 0
              ? 'text-red-600 font-bold'
              : (syncStatus.ordersPending ?? 0) > 0
              ? 'text-blue-600 font-bold'
              : 'text-green-600'
          }`}
        >
          {syncStatus.ordersPending ?? 0} / {syncStatus.ordersFailed ?? 0}
        </div>
      </div>

      {/* Очередь MENU */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 font-bold text-slate-600">
          <ListChecks className="w-3 h-3 text-purple-500" />
          {ru ? 'Меню в Sheets' : 'Menu to Sheets'}
        </div>
        <div
          className={`font-mono tabular-nums ${
            (syncStatus.menuFailed ?? 0) > 0
              ? 'text-red-600 font-bold'
              : (syncStatus.menuPending ?? 0) > 0
              ? 'text-blue-600 font-bold'
              : 'text-green-600'
          }`}
        >
          {syncStatus.menuPending ?? 0} / {syncStatus.menuFailed ?? 0}
        </div>
      </div>

      {/* Last sync */}
      {syncStatus.lastSyncAt && (
        <div className="flex items-center gap-1 text-[0.625rem] text-slate-400 pt-1 border-t border-slate-200">
          <RefreshCw className="w-2.5 h-2.5" />
          <span className="font-mono">
            {new Date(syncStatus.lastSyncAt).toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
          {!syncStatus.isOnline && (
            <span className="text-red-500 font-bold ml-auto">OFFLINE</span>
          )}
        </div>
      )}
    </div>
  );
}
