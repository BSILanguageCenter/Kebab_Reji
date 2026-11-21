// src/components/ViewToggles.tsx
// Кнопки шапки: вид групп, заказы (развёрнуты / свёрнуты).
import { LayoutGrid, Layers, ClipboardList, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useI18n } from '@/locale';
import { useViewPrefs } from '@/lib/viewPrefs';

const base =
  'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border-2 transition-all active:scale-95 [@media(pointer:coarse)]:min-h-[32px]';
const on = 'bg-orange-500 border-orange-500 text-white shadow-md shadow-orange-500/20';
const off =
  'bg-white border-slate-200 text-slate-700 hover:border-orange-400 hover:bg-orange-50';

/** Кнопка вкл/выкл: группа = одна иконка или все блюда группы */
export function GroupViewToggle() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useViewPrefs();
  const single = prefs.groupView === 'single';
  const label = single
    ? t('groupsSingleIcon')
    : t('groupsAllItems');
  return (
    <button
      type="button"
      onClick={() => setPrefs({ groupView: single ? 'all' : 'single' })}
      title={label}
      aria-label={label}
      aria-pressed={single}
      className={`${base} ${single ? on : off}`}
    >
      {single ? <Layers className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

/** Кнопка шапки «Заказы» (только касса) */
export function OrdersHeaderButton({
  active,
  count,
  onClick,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const label = t('orders');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={`${base} ${active ? on : off}`}
    >
      <ClipboardList className="w-4 h-4" />
      <span className="hidden sm:inline">{label}</span>
      {count > 0 && (
        <span
          className={`text-[0.6875rem] px-1.5 py-0.5 rounded-full font-black tabular-nums ${
            active ? 'bg-white/25 text-white' : 'bg-orange-500 text-white'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Заказы: развёрнутый / свёрнутый вид карточек */
export function OrdersExpandToggle({ withLabel = false }: { withLabel?: boolean }) {
  const { t } = useI18n();
  const [prefs, setPrefs] = useViewPrefs();
  const expanded = prefs.ordersExpanded;
  const label = expanded
    ? t('ordersExpandedLabel')
    : t('ordersCollapsedLabel');
  return (
    <button
      type="button"
      onClick={() => setPrefs({ ordersExpanded: !expanded })}
      title={label}
      aria-label={label}
      aria-pressed={expanded}
      className={`${base} ${expanded ? on : off}`}
    >
      {expanded ? <ChevronsUpDown className="w-4 h-4" /> : <ChevronsDownUp className="w-4 h-4" />}
      {withLabel && <span className="hidden lg:inline">{label}</span>}
    </button>
  );
}

/** Универсальная кнопка шапки (тот же вид, что у кнопок кассы) */
export function HeaderToggleButton({
  active,
  onClick,
  icon,
  label,
  alwaysShowLabel = false,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  /** true — подпись видна всегда, false — только на широких экранах */
  alwaysShowLabel?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title ?? label}
      aria-label={label}
      className={`${base} ${active ? on : off}`}
    >
      {icon}
      <span className={alwaysShowLabel ? '' : 'hidden lg:inline'}>{label}</span>
    </button>
  );
}
