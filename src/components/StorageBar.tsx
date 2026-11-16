import { useState, useEffect, useCallback } from 'react';
import { Database, Download, Upload, AlertTriangle } from 'lucide-react';
import { getStorageInfo } from '@/lib/storageUsage';

const STORAGE_KEY = 'kebab-pos-data-v1';

export function StorageBar({
  onImportComplete,
}: {
  onImportComplete?: () => void;
}) {
  const [info, setInfo] = useState(() => getStorageInfo());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setInfo(getStorageInfo());
  }, []);

  useEffect(() => {
    const id = window.setInterval(refresh, 2000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const danger = info.usedPct > 85;
  const warn = info.usedPct > 65;

  const barColor = danger
    ? 'bg-red-500'
    : warn
    ? 'bg-amber-500'
    : 'bg-green-500';

  const bgClass = danger
    ? 'bg-red-50 border-red-300'
    : warn
    ? 'bg-amber-50 border-amber-300'
    : 'bg-slate-50 border-slate-200';

  const handleExport = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      alert('Нечего экспортировать — данных нет');
      return;
    }
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `kebab-pos-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setBusy(true);
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Неверный формат файла');
        }
        if (!Array.isArray(parsed.menuItems)) {
          throw new Error('Файл не содержит "menuItems"');
        }
        if (
          !window.confirm(
            'Заменить текущее меню и заказы данными из файла? Действие необратимо.'
          )
        ) {
          return;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        refresh();
        onImportComplete?.();
        alert('Импорт завершён ✓');
      } catch (err) {
        alert(
          'Ошибка импорта: ' +
            (err instanceof Error ? err.message : String(err))
        );
      } finally {
        setBusy(false);
      }
    };
    input.click();
  };

  return (
    <div className={`rounded-xl border ${bgClass} p-2.5`}>
      <div className="flex items-center gap-2 mb-1.5">
        <Database className="w-3.5 h-3.5 text-slate-600 shrink-0" />
        <span className="text-[11px] font-bold text-slate-700 truncate">
          {info.usedMB} / {info.totalMB} МБ · {info.usedPct.toFixed(0)}%
        </span>
        {danger && (
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
        )}
        <div className="flex-1" />
        <button
          onClick={handleExport}
          disabled={busy}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-[10px] font-bold text-slate-700 disabled:opacity-40 transition-colors shrink-0"
          title="Скачать меню и заказы в JSON"
        >
          <Download className="w-3 h-3" />
          Экспорт
        </button>
        <button
          onClick={handleImport}
          disabled={busy}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-[10px] font-bold text-slate-700 disabled:opacity-40 transition-colors shrink-0"
          title="Загрузить меню из JSON-файла"
        >
          <Upload className="w-3 h-3" />
          Импорт
        </button>
      </div>

      <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${Math.min(100, info.usedPct)}%` }}
        />
      </div>

      <div className="mt-1 text-[10px] text-slate-500 flex items-center justify-between gap-2">
        <span className="truncate">
          Фото: {info.imagesCount} шт ·{' '}
          {(info.imagesBytes / (1024 * 1024)).toFixed(2)} МБ
        </span>
        {danger && (
          <span className="text-red-600 font-bold shrink-0">
            мало места!
          </span>
        )}
      </div>
    </div>
  );
}
