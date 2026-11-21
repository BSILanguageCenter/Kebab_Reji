import { PANEL_CATS, getPlace, setPlace, type PanelPlace } from '@/components/CategoryPanels';
import { useMemo, useRef, useState } from 'react';
import { useI18n } from '@/locale';
import { useViewPrefs } from '@/lib/viewPrefs';
import {
  DEFAULT_LAYOUT,
  GRID_COLS_KEYS,
  useLayoutSettings,
  clampLayout,
  type LayoutSettings,
} from '@/lib/layoutSettings';
import {
  RotateCcw,
  Undo2,
  Maximize2,
  Minimize2,
  Sparkles,
  ChevronDown,
  Minus,
  Plus,
  ZoomIn,
} from 'lucide-react';

type PresetName = 'compact' | 'normal' | 'large';

const PRESETS: Record<PresetName, LayoutSettings> = {
  compact: {
    ordersWidth: 176,
    menuRightWidth: 160,
    menuLeftWidth: 160,
    cartWidth: 280,
    dishCardSize: 88,
    toppingCardSize: 60,
    drinkCardSize: 56,
    sauceCardSize: 56,
    cardRadius: 8,
    gridGap: 8,
    ordersRowGap: 6,
    cartItemGap: 4,
    itemTextSize: 10,
    panelHeaderSize: 8,
    orderNumberSize: 16,
    toppingsHeight: 120,
    drinksShare: 50,
    leftShare: 50,
    gridColsDishset: 0,
    gridColsDrink: 0,
    gridColsSauce: 0,
    gridColsTopping: 0,
    bottomMask: 4,
    leftMask: 0,
  },
  normal: { ...DEFAULT_LAYOUT },
  large: {
    ordersWidth: 260,
    menuRightWidth: 260,
    menuLeftWidth: 260,
    cartWidth: 420,
    dishCardSize: 160,
    toppingCardSize: 110,
    drinkCardSize: 100,
    sauceCardSize: 100,
    cardRadius: 16,
    gridGap: 16,
    ordersRowGap: 12,
    cartItemGap: 10,
    itemTextSize: 14,
    panelHeaderSize: 11,
    orderNumberSize: 22,
    toppingsHeight: 260,
    drinksShare: 50,
    leftShare: 50,
    gridColsDishset: 0,
    gridColsDrink: 0,
    gridColsSauce: 0,
    gridColsTopping: 0,
    bottomMask: 4,
    leftMask: 0,
  },
};

const CARD_KEYS = [
  'dishCardSize',
  'toppingCardSize',
  'drinkCardSize',
  'sauceCardSize',
] as const;

const SERVICE_KEYS = new Set<string>(GRID_COLS_KEYS);

/** Сравнение без служебных ключей (число колонок сетки) */
function sameLayout(a: LayoutSettings, b: LayoutSettings): boolean {
  return (Object.keys(a) as (keyof LayoutSettings)[]).every(
    (k) => SERVICE_KEYS.has(k) || a[k] === b[k]
  );
}

/** Новый набор значений, но служебные ключи берём из текущего стиля */
function keepServiceKeys(next: LayoutSettings, cur: LayoutSettings): LayoutSettings {
  const out = { ...next };
  for (const k of GRID_COLS_KEYS) out[k] = cur[k];
  return out;
}

export function PanelSettings() {
  const { t } = useI18n();
  const [layout, setLayout] = useLayoutSettings();
  const [viewPrefs, setViewPrefs] = useViewPrefs();
  const mode = viewPrefs.groupView;

  // Снимок на момент открытия окна — чтобы можно было «Отменить изменения»
  const snapshot = useRef<LayoutSettings>(layout);
  const [scalePct, setScalePct] = useState(100);

  // Смена режима групп → снимок «до изменений» берём от стиля нового режима
  const prevMode = useRef(mode);
  if (prevMode.current !== mode) {
    prevMode.current = mode;
    snapshot.current = layout;
  }

  const set = <K extends keyof LayoutSettings>(key: K, value: LayoutSettings[K]) =>
    setLayout((prev) => ({ ...prev, [key]: clampLayout(key, value) }));

  const applyPreset = (name: PresetName) => {
    setLayout((prev) => keepServiceKeys({ ...PRESETS[name] }, prev));
    setScalePct(100);
  };

  const activePreset = useMemo<PresetName | null>(() => {
    for (const name of Object.keys(PRESETS) as PresetName[]) {
      if (sameLayout(layout, PRESETS[name])) return name;
    }
    return null;
  }, [layout]);

  const changedSinceOpen = !sameLayout(layout, snapshot.current);
  const isDefault = sameLayout(layout, DEFAULT_LAYOUT);

  /** Общий масштаб: умножает размеры ВСЕХ карточек, сохраняя их пропорции */
  const applyScale = (nextPct: number) => {
    const ratio = nextPct / scalePct;
    setScalePct(nextPct);
    setLayout((prev) => {
      const out = { ...prev };
      for (const k of CARD_KEYS) out[k] = clampLayout(k, prev[k] * ratio);
      return out;
    });
  };

  return (
    <div className="p-3 space-y-3">
      {/* Для какого режима групп настраиваем стиль */}
      <div className="rounded-xl border-2 border-violet-200 bg-violet-50 p-2">
        <div className="text-[0.625rem] font-bold text-violet-700 uppercase tracking-wider mb-1.5">
          {t('styleForMode')}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              ['all', t('allItems')],
              ['single', t('singleIcon')],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                if (m === mode) return;
                setViewPrefs({ groupView: m });
                setScalePct(100);
              }}
              className={`py-2 rounded-lg text-[0.6875rem] font-bold border-2 transition-all active:scale-[0.97] ${
                mode === m
                  ? 'bg-violet-600 border-violet-600 text-white'
                  : 'bg-white border-violet-200 text-violet-700 hover:bg-violet-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[0.625rem] text-violet-700/80 leading-tight">
          {t('perModeStyleHint')}
        </p>
      </div>

      {/* Верхняя панель действий */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setLayout((prev) => keepServiceKeys({ ...snapshot.current }, prev));
            setScalePct(100);
          }}
          disabled={!changedSinceOpen}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-[0.6875rem] font-bold active:scale-[0.97] transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <Undo2 className="w-3.5 h-3.5" />
          {t('undoChanges')}
        </button>
        <button
          type="button"
          onClick={() => {
            setLayout((prev) => keepServiceKeys({ ...DEFAULT_LAYOUT }, prev));
            setScalePct(100);
          }}
          disabled={isDefault}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-[0.6875rem] font-bold active:scale-[0.97] transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t('reset')}
        </button>
      </div>

      {/* Пресеты */}
      <div>
        <div className="text-[0.625rem] font-bold text-gray-500 uppercase tracking-wider mb-2">
          {t('preset')}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              ['compact', t('presetCompact'), Minimize2],
              ['normal', t('presetNormal'), Sparkles],
              ['large', t('presetLarge'), Maximize2],
            ] as const
          ).map(([name, label, Icon]) => (
            <button
              key={name}
              type="button"
              onClick={() => applyPreset(name)}
              className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all active:scale-[0.97] ${
                activePreset === name
                  ? 'border-orange-500 bg-orange-50'
                  : 'border-gray-200 hover:border-orange-400 hover:bg-orange-50'
              }`}
            >
              <Icon className="w-4 h-4 text-gray-600" />
              <span className="text-[0.625rem] font-bold text-gray-700">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Общий масштаб карточек */}
      <div className="rounded-xl border-2 border-orange-200 bg-orange-50 p-2.5">
        <SliderField
          icon={<ZoomIn className="w-3.5 h-3.5 text-orange-600" />}
          label={t('allCardsScale')}
          value={scalePct}
          min={60}
          max={160}
          step={5}
          suffix="%"
          defaultValue={100}
          onChange={applyScale}
        />
        <p className="mt-1 text-[0.625rem] text-gray-500 leading-tight">
          {t('allCardsScaleHint')}
        </p>
      </div>

      {/* Ширина колонок */}
      <Section title={t('sectionColumns')} defaultOpen>
        <SliderField label={t('colOrders')} value={layout.ordersWidth} min={140} max={400} defaultValue={DEFAULT_LAYOUT.ordersWidth} onChange={(v) => set('ordersWidth', v)} />
        <SliderField label={t('colMenuLeft')} value={layout.menuLeftWidth} min={80} max={400} defaultValue={DEFAULT_LAYOUT.menuLeftWidth} onChange={(v) => set('menuLeftWidth', v)} />
        <SliderField label={t('colMenuRight')} value={layout.menuRightWidth} min={80} max={400} defaultValue={DEFAULT_LAYOUT.menuRightWidth} onChange={(v) => set('menuRightWidth', v)} />
        <SliderField label={t('colCart')} value={layout.cartWidth} min={240} max={600} defaultValue={DEFAULT_LAYOUT.cartWidth} onChange={(v) => set('cartWidth', v)} />
      </Section>

      {/* Размер карточек */}
      <Section title={t('sectionCards')} defaultOpen>
        <SliderField label={t('dishCardSize')} value={layout.dishCardSize} min={60} max={220} defaultValue={DEFAULT_LAYOUT.dishCardSize} onChange={(v) => set('dishCardSize', v)} />
        <SliderField label={t('toppingCardSize')} value={layout.toppingCardSize} min={40} max={160} defaultValue={DEFAULT_LAYOUT.toppingCardSize} onChange={(v) => set('toppingCardSize', v)} />
        <SliderField label={t('drinkCardSize')} value={layout.drinkCardSize} min={40} max={160} defaultValue={DEFAULT_LAYOUT.drinkCardSize} onChange={(v) => set('drinkCardSize', v)} />
        <SliderField label={t('sauceCardSize')} value={layout.sauceCardSize} min={40} max={160} defaultValue={DEFAULT_LAYOUT.sauceCardSize} onChange={(v) => set('sauceCardSize', v)} />
        <SliderField label={t('cardRadius')} value={layout.cardRadius} min={0} max={32} defaultValue={DEFAULT_LAYOUT.cardRadius} onChange={(v) => set('cardRadius', v)} />
      </Section>

      {/* Отступы */}
      <Section title={t('sectionSpacing')}>
        <SliderField label={t('gridGap')} value={layout.gridGap} min={0} max={32} defaultValue={DEFAULT_LAYOUT.gridGap} onChange={(v) => set('gridGap', v)} />
        <SliderField label={t('ordersRowGap')} value={layout.ordersRowGap} min={0} max={24} defaultValue={DEFAULT_LAYOUT.ordersRowGap} onChange={(v) => set('ordersRowGap', v)} />
        <SliderField label={t('cartItemGap')} value={layout.cartItemGap} min={0} max={20} defaultValue={DEFAULT_LAYOUT.cartItemGap} onChange={(v) => set('cartItemGap', v)} />
      </Section>

      {/* Текст */}
      <Section title={t('sectionText')}>
        <SliderField label={t('itemTextSize')} value={layout.itemTextSize} min={8} max={20} defaultValue={DEFAULT_LAYOUT.itemTextSize} onChange={(v) => set('itemTextSize', v)} />
        <SliderField label={t('panelHeaderSize')} value={layout.panelHeaderSize} min={7} max={16} defaultValue={DEFAULT_LAYOUT.panelHeaderSize} onChange={(v) => set('panelHeaderSize', v)} />
        <SliderField label={t('orderNumberSize')} value={layout.orderNumberSize} min={12} max={32} defaultValue={DEFAULT_LAYOUT.orderNumberSize} onChange={(v) => set('orderNumberSize', v)} />
      </Section>

      {/* Пропорции панелей */}
      <Section title={t('sectionProportions')}>
        <SliderField label={t('toppingsHeight')} value={layout.toppingsHeight} min={80} max={400} defaultValue={DEFAULT_LAYOUT.toppingsHeight} onChange={(v) => set('toppingsHeight', v)} />
        <SliderField label={t('drinksShare')} value={layout.drinksShare} min={20} max={80} suffix="%" defaultValue={DEFAULT_LAYOUT.drinksShare} onChange={(v) => set('drinksShare', v)} />
        <SliderField label={t('leftShare')} value={layout.leftShare} min={20} max={80} suffix="%" defaultValue={DEFAULT_LAYOUT.leftShare} onChange={(v) => set('leftShare', v)} />
      </Section>

      {/* Где стоят напитки / соусы / топпинги: справа или снизу */}
      <Section title={t('panelPlacement')}>
        <div className="space-y-1.5">
          {PANEL_CATS.map((cat) => {
            const place = getPlace(layout.bottomMask, layout.leftMask, cat);
            const label =
              cat === 'drink' ? t('type_drink') : cat === 'sauce' ? t('type_sauce') : t('type_topping');
            const btn = (active: boolean) =>
              `flex-1 px-1.5 py-1.5 rounded-lg border-2 text-xs font-black transition-colors ${
                active
                  ? 'bg-orange-500 border-orange-500 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-orange-300'
              }`;
            const move = (to: PanelPlace) => {
              if (to === place) return;
              setLayout((prev) => ({
                ...prev,
                ...setPlace(prev.bottomMask, prev.leftMask, cat, to),
              }));
            };
            return (
              <div key={cat} className="flex items-center gap-1.5">
                <span className="w-16 shrink-0 text-xs font-bold text-slate-700 truncate">{label}</span>
                <button type="button" className={btn(place === 'left')} onClick={() => move('left')}>
                  {t('placeLeft')}
                </button>
                <button type="button" className={btn(place === 'right')} onClick={() => move('right')}>
                  {t('placeSide')}
                </button>
                <button type="button" className={btn(place === 'bottom')} onClick={() => move('bottom')}>
                  {t('placeBottom')}
                </button>
              </div>
            );
          })}
        </div>
        <p className="text-[0.625rem] text-gray-500 leading-tight">{t('dragPanelHint')}</p>
      </Section>
    </div>
  );
}

/** Сворачиваемая секция (аккордеон) */
function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-gray-200 pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between py-1.5 text-[0.625rem] font-black text-gray-500 uppercase tracking-widest"
      >
        {title}
        <ChevronDown
          className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="space-y-3 pt-1.5 pb-1">{children}</div>}
    </div>
  );
}

/** Ползунок + кнопки −/+ (для пальца) + ввод числа + сброс к значению по умолчанию */
function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = 'px',
  defaultValue,
  icon,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  defaultValue?: number;
  icon?: React.ReactNode;
  onChange: (v: number) => void;
}) {
  const { t } = useI18n();
  const clampV = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const modified = defaultValue !== undefined && value !== defaultValue;
  const stepBtn =
    'w-8 h-8 shrink-0 rounded-lg bg-gray-100 hover:bg-gray-200 active:scale-90 flex items-center justify-center text-gray-700 transition-all disabled:opacity-30';

  return (
    <div>
      <div className="flex items-center justify-between mb-1 gap-2">
        <label className="flex items-center gap-1 text-[0.625rem] font-bold text-gray-500 uppercase tracking-wider min-w-0">
          {icon}
          <span className="truncate">{label}</span>
          {modified && (
            <button
              type="button"
              onClick={() => onChange(defaultValue!)}
              title={t('byDefault')}
              className="ml-0.5 w-5 h-5 rounded-full hover:bg-orange-100 text-orange-500 flex items-center justify-center shrink-0"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
        </label>
        <span className="text-[0.625rem] font-black text-orange-600 tabular-nums bg-orange-50 px-1.5 py-0.5 rounded shrink-0">
          {value}
          {suffix}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" className={stepBtn} disabled={value <= min} onClick={() => onChange(clampV(value - step))} aria-label="−">
          <Minus className="w-3.5 h-3.5" />
        </button>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(clampV(Number(e.target.value)))}
          className="flex-1 min-w-0 accent-orange-500 cursor-pointer touch-pan-x"
        />
        <button type="button" className={stepBtn} disabled={value >= max} onClick={() => onChange(clampV(value + step))} aria-label="+">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
