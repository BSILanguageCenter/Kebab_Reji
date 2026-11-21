import type { ReactNode } from 'react';

/**
 * Главная кнопка корзины («Отправить на кухню» / «Сохранить изменения»).
 * ЕДИНЫЙ компонент: касса, предпросмотр в «Управлении меню» и
 * предпросмотр стиля используют его, поэтому выглядят одинаково.
 *
 * Без onClick — «макет» (preview): тот же вид, но кнопка не нажимается.
 */
export function SendToKitchenButton({
  icon,
  label,
  loading = false,
  loadingLabel,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const preview = !onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      tabIndex={preview ? -1 : undefined}
      aria-disabled={preview || undefined}
      className={`group relative w-full h-16 rounded-2xl overflow-hidden text-white font-black text-sm tracking-normal uppercase flex items-center justify-center px-3 bg-gradient-to-r from-orange-500 via-orange-600 to-red-600 ring-1 ring-white/10 shadow-[0_12px_26px_-10px_rgba(234,88,12,0.75),inset_0_1px_0_rgba(255,255,255,0.35)] transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:shadow-none ${
        preview ? 'pointer-events-none' : 'hover:brightness-110'
      }`}
    >
      {/* верхний блик */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
      {/* бегущий блик при наведении */}
      <span className="pointer-events-none absolute -inset-y-2 -left-1/3 w-1/4 -skew-x-12 bg-white/25 blur-md transition-transform duration-700 group-hover:translate-x-[520%]" />

      {loading ? (
        <span className="relative inline-flex items-center gap-2">
          <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <span>{loadingLabel ?? label}</span>
        </span>
      ) : (
        <span className="relative inline-flex items-center justify-center gap-2 min-w-0 max-w-full">
          <span className="flex items-center justify-center shrink-0 w-8 h-8 rounded-lg bg-white/20 ring-1 ring-white/25 shadow-inner transition-transform duration-150 group-active:translate-x-0.5">
            {icon}
          </span>
          <span className="text-left leading-tight drop-shadow-sm">{label}</span>
        </span>
      )}
    </button>
  );
}
