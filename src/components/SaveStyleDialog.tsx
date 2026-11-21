// src/components/SaveStyleDialog.tsx
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Save, X, AlertCircle } from 'lucide-react';
import { useI18n } from '@/locale';
import { dateLocale } from '@/locale/format';

export function SaveStyleDialog({
  open,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  saving?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const { t, lang } = useI18n();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    const suggested = `${t('styleNamePrefix')} ${now.toLocaleDateString(dateLocale(lang))} ${now.toLocaleTimeString(
      dateLocale(lang),
      { hour: '2-digit', minute: '2-digit' }
    )}`;
    setName(suggested);
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) return null;

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= 60 && !saving;

  const submit = () => {
    if (!canSave) return;
    onConfirm(trimmed);
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      style={{ zIndex: 100000 }}
      onClick={saving ? undefined : onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black text-slate-900">
            {t('styleSaveDialogTitle')}
          </h3>
          <button
            onClick={onCancel}
            disabled={saving}
            className="text-slate-500 hover:text-slate-900 disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
          {t('styleNameLabel')}
        </label>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape' && !saving) onCancel();
          }}
          maxLength={60}
          placeholder={t('styleNamePlaceholder')}
          className="form-input mb-1"
          disabled={saving}
        />
        <p className="text-[11px] text-slate-400 mb-3">{trimmed.length}/60</p>

        {error && (
          <div className="mb-3 p-2.5 bg-red-50 border border-red-300 rounded-lg text-red-700 text-xs flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold disabled:opacity-40"
          >
            {t('cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!canSave}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {saving ? (
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {t('styleSaveBtn')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
