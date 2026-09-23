import { AlertTriangle } from 'lucide-react';
import { useI18n } from '@/locale';

type Variant = 'yellow' | 'green' | 'red' | 'gray';

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'gray',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  if (!open) return null;

  const colors: Record<Variant, string> = {
    yellow: 'bg-yellow-500 hover:bg-yellow-400',
    green: 'bg-green-600 hover:bg-green-500',
    red: 'bg-red-600 hover:bg-red-500',
    gray: 'bg-gray-700 hover:bg-gray-600',
  };

  const iconColors: Record<Variant, string> = {
    yellow: 'text-yellow-500 bg-yellow-100',
    green: 'text-green-600 bg-green-100',
    red: 'text-red-600 bg-red-100',
    gray: 'text-gray-600 bg-gray-100',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Иконка + Заголовок */}
        <div className="flex items-start gap-3 mb-4">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconColors[variant]}`}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-900">
              {title ?? t('confirmTitle')}
            </h3>
            <p className="text-sm text-gray-600 mt-1 leading-snug">{message}</p>
          </div>
        </div>

        {/* Кнопки Да / Нет */}
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-bold transition-colors active:scale-[0.98]"
          >
            {cancelLabel ?? t('no')}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-bold transition-colors active:scale-[0.98] ${colors[variant]}`}
          >
            {confirmLabel ?? t('yes')}
          </button>
        </div>
      </div>
    </div>
  );
}