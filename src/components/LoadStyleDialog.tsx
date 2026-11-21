// src/components/LoadStyleDialog.tsx
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import {
  Download,
  Trash2,
  Loader2,
  X,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { useI18n } from '@/locale';
import { dateLocale } from '@/locale/format';
import {
  fetchAllStyles,
  deleteStyle,
  type SavedStyle,
} from '@/services/layoutStyle';

export function LoadStyleDialog({
  open,
  onCancel,
  onPick,
}: {
  open: boolean;
  onCancel: () => void;
  onPick: (style: SavedStyle) => void;
}) {
  const { t, lang } = useI18n();
  const [styles, setStyles] = useState<SavedStyle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setStyles(await fetchAllStyles());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  if (!open) return null;

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteStyle(id);
      setStyles((s) => s.filter((x) => x.id !== id));
      setConfirmDeleteId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      style={{ zIndex: 100000 }}
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h3 className="text-lg font-black text-slate-900">
            {t('styleListTitle')}
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-600 flex items-center justify-center disabled:opacity-40"
              title={t('styleRefresh')}
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              />
            </button>
            <button
              onClick={onCancel}
              className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-600 flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {error && (
            <div className="mb-2 p-2.5 bg-red-50 border border-red-300 rounded-lg text-red-700 text-xs flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {loading && styles.length === 0 && (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}

          {!loading && styles.length === 0 && !error && (
            <p className="text-center text-slate-400 text-sm py-10">
              {t('styleListEmpty')}
            </p>
          )}

          <div className="space-y-2">
            {styles.map((s) => {
              const isConfirmingDelete = confirmDeleteId === s.id;
              const isDeleting = deletingId === s.id;

              return (
                <div
                  key={s.id}
                  className="border border-slate-200 rounded-xl p-3 bg-slate-50/60 hover:bg-white hover:border-violet-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 truncate">
                        {s.name}
                      </div>
                      <div className="text-[10px] font-bold mt-0.5 text-violet-600">
                        {s.layoutSingle
                          ? t('styleFormatBoth')
                          : t('styleFormatLegacy')}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {new Date(s.updatedAt).toLocaleString(dateLocale(lang), {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>

                  {isConfirmingDelete ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="flex-1 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold"
                      >
                        {t('cancel')}
                      </button>
                      <button
                        onClick={() => void handleDelete(s.id)}
                        disabled={isDeleting}
                        className="flex-1 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1"
                      >
                        {isDeleting && (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        )}
                        {t('styleDeleteConfirm')}
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => onPick(s)}
                        className="flex-1 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center justify-center gap-1"
                      >
                        <Download className="w-3 h-3" />
                        {t('styleLoadBtn')}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(s.id)}
                        className="px-3 py-1.5 rounded-lg bg-white border border-red-200 hover:bg-red-50 text-red-600 text-xs font-bold flex items-center gap-1"
                        title={t('styleDeleteLabel')}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
