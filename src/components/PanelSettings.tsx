import { useI18n } from '@/locale';
import {
  DEFAULT_LAYOUT,
  useLayoutSettings,
  type LayoutSettings,
} from '@/lib/layoutSettings';
import { RotateCcw, Maximize2, Minimize2, Sparkles } from 'lucide-react';

// ============================================================
// Пресеты
// ============================================================
type PresetName = 'compact' | 'normal' | 'large';

const PRESETS: Record<PresetName, LayoutSettings> = {
  compact: {
    ordersWidth: 176,
    menuRightWidth: 160,
    cartWidth: 280,
    dishCardSize: 88,
    toppingCardSize: 60,
    drinkCardSize: 56,
    sauceCardSize: 56,
    itemTextSize: 10,
    toppingsHeight: 120,
    drinksShare: 50,
  },
  normal: { ...DEFAULT_LAYOUT },
  large: {
    ordersWidth: 260,
    menuRightWidth: 260,
    cartWidth: 420,
    dishCardSize: 160,
    toppingCardSize: 110,
    drinkCardSize: 100,
    sauceCardSize: 100,
    itemTextSize: 14,
    toppingsHeight: 260,
    drinksShare: 50,
  },
};

export function PanelSettings() {
  const { t } = useI18n();
  const [layout, setLayout] = useLayoutSettings();

  const set = <K extends keyof LayoutSettings>(
    key: K,
    value: LayoutSettings[K]
  ) => setLayout({ ...layout, [key]: value });

  const applyPreset = (name: PresetName) => {
    setLayout({ ...PRESETS[name] });
  };

  return (
    <div className="p-3 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-orange-500" />
          {t('layoutSettings')}
        </h3>
        <button
          onClick={() => setLayout(DEFAULT_LAYOUT)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-[10px] font-bold active:scale-[0.97] transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          {t('reset')}
        </button>
      </div>

      {/* Presets */}
      <div>
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
          {t('preset')}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => applyPreset('compact')}
            className="flex flex-col items-center gap-1 p-2 rounded-lg border-2 border-gray-200 hover:border-orange-400 hover:bg-orange-50 transition-all active:scale-[0.97]"
          >
            <Minimize2 className="w-4 h-4 text-gray-600" />
            <span className="text-[10px] font-bold text-gray-700">
              {t('presetCompact')}
            </span>
          </button>
          <button
            onClick={() => applyPreset('normal')}
            className="flex flex-col items-center gap-1 p-2 rounded-lg border-2 border-gray-200 hover:border-orange-400 hover:bg-orange-50 transition-all active:scale-[0.97]"
          >
            <Sparkles className="w-4 h-4 text-gray-600" />
            <span className="text-[10px] font-bold text-gray-700">
              {t('presetNormal')}
            </span>
          </button>
          <button
            onClick={() => applyPreset('large')}
            className="flex flex-col items-center gap-1 p-2 rounded-lg border-2 border-gray-200 hover:border-orange-400 hover:bg-orange-50 transition-all active:scale-[0.97]"
          >
            <Maximize2 className="w-4 h-4 text-gray-600" />
            <span className="text-[10px] font-bold text-gray-700">
              {t('presetLarge')}
            </span>
          </button>
        </div>
      </div>

      {/* Column widths */}
      <Section title={t('sectionColumns')}>
        <SliderField
          label={t('colOrders')}
          value={layout.ordersWidth}
          min={140}
          max={400}
          onChange={(v) => set('ordersWidth', v)}
        />
        <SliderField
          label={t('colMenuRight')}
          value={layout.menuRightWidth}
          min={140}
          max={400}
          onChange={(v) => set('menuRightWidth', v)}
        />
        <SliderField
          label={t('colCart')}
          value={layout.cartWidth}
          min={240}
          max={600}
          onChange={(v) => set('cartWidth', v)}
        />
      </Section>

      {/* Card sizes */}
      <Section title={t('sectionCards')}>
        <SliderField
          label={t('dishCardSize')}
          value={layout.dishCardSize}
          min={60}
          max={220}
          onChange={(v) => set('dishCardSize', v)}
        />
        <SliderField
          label={t('toppingCardSize')}
          value={layout.toppingCardSize}
          min={40}
          max={160}
          onChange={(v) => set('toppingCardSize', v)}
        />
        <SliderField
          label={t('drinkCardSize')}
          value={layout.drinkCardSize}
          min={40}
          max={160}
          onChange={(v) => set('drinkCardSize', v)}
        />
        <SliderField
          label={t('sauceCardSize')}
          value={layout.sauceCardSize}
          min={40}
          max={160}
          onChange={(v) => set('sauceCardSize', v)}
        />
      </Section>

      {/* Text */}
      <Section title={t('sectionText')}>
        <SliderField
          label={t('itemTextSize')}
          value={layout.itemTextSize}
          min={8}
          max={20}
          onChange={(v) => set('itemTextSize', v)}
        />
      </Section>

      {/* Panel proportions */}
      <Section title={t('sectionProportions')}>
        <SliderField
          label={t('toppingsHeight')}
          value={layout.toppingsHeight}
          min={80}
          max={400}
          onChange={(v) => set('toppingsHeight', v)}
        />
        <SliderField
          label={t('drinksShare')}
          value={layout.drinksShare}
          min={20}
          max={80}
          suffix="%"
          onChange={(v) => set('drinksShare', v)}
        />
      </Section>
    </div>
  );
}

// ============================================================
// Section
// ============================================================
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-gray-200 pt-3">
      <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

// ============================================================
// SliderField
// ============================================================
function SliderField({
  label,
  value,
  min,
  max,
  suffix = 'px',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
          {label}
        </label>
        <span className="text-[10px] font-black text-orange-600 tabular-nums bg-orange-50 px-1.5 py-0.5 rounded">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-orange-500 cursor-pointer"
      />
    </div>
  );
}