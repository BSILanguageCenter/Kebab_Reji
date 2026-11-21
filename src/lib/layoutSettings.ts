import { useEffect, useState } from 'react';
import { getViewPrefs, useViewPrefs, type GroupView } from '@/lib/viewPrefs';

export interface LayoutSettings {
  // Колонки
  ordersWidth: number;
  menuRightWidth: number;
  menuLeftWidth: number; // ширина левой панели категорий
  cartWidth: number;

  // Карточки
  dishCardSize: number;
  toppingCardSize: number;
  drinkCardSize: number;
  sauceCardSize: number;
  cardRadius: number;      // НОВОЕ

  // Отступы
  gridGap: number;         // НОВОЕ
  ordersRowGap: number;    // НОВОЕ
  cartItemGap: number;     // НОВОЕ

  // Текст
  itemTextSize: number;
  panelHeaderSize: number; // НОВОЕ
  orderNumberSize: number; // НОВОЕ

  // Панели
  toppingsHeight: number;
  drinksShare: number;
  leftShare: number; // доля высоты первой категории в левой панели, %

  // Число колонок сетки у менеджера (служебное; 0 — неизвестно).
  // Касса ставит карточки в те же ячейки, что и менеджер.
  gridColsDishset: number;
  gridColsDrink: number;
  gridColsSauce: number;
  gridColsTopping: number;

  // Какие категории стоят в нижней панели (1 — напитки, 2 — соусы, 4 — топпинги).
  // Остальные — в боковой панели справа. Служебное: пресеты его не сбрасывают.
  bottomMask: number;
  // Какие категории стоят в левой панели (те же биты). Если бит есть и в bottomMask — побеждает «снизу».
  leftMask: number;
}

/**
 * У каждого режима групп — свой независимый стиль:
 *  all    — «все блюда» (группа раскрыта, занимает несколько ячеек)
 *  single — «одна иконка» (каждая группа занимает одну ячейку)
 */
export type LayoutMode = GroupView;

/** Служебные ключи (не настраиваются ползунками) */
export const GRID_COLS_KEYS = [
  'gridColsDishset',
  'gridColsDrink',
  'gridColsSauce',
  'gridColsTopping',
  'bottomMask',
  'leftMask',
] as const;

const STORAGE_KEYS: Record<LayoutMode, string> = {
  all: 'kebab-pos-layout-v1', // прежний ключ — старые настройки сохраняются
  single: 'kebab-pos-layout-v1-single',
};
const CHANNEL_NAMES: Record<LayoutMode, string> = {
  all: 'kebab-pos-layout',
  single: 'kebab-pos-layout-single',
};

export const DEFAULT_LAYOUT: LayoutSettings = {
  ordersWidth: 208,
  menuRightWidth: 200,
  menuLeftWidth: 200,
  cartWidth: 320,
  dishCardSize: 120,
  toppingCardSize: 80,
  drinkCardSize: 72,
  sauceCardSize: 72,
  cardRadius: 12,
  gridGap: 12,
  ordersRowGap: 8,
  cartItemGap: 6,
  itemTextSize: 12,
  panelHeaderSize: 9,
  orderNumberSize: 18,
  toppingsHeight: 180,
  drinksShare: 50,
  leftShare: 50,
  gridColsDishset: 0,
  gridColsDrink: 0,
  gridColsSauce: 0,
  gridColsTopping: 0,
  bottomMask: 4,
  leftMask: 0,
};

const LIMITS = {
  ordersWidth: { min: 140, max: 400 },
  menuRightWidth: { min: 80, max: 400 },
  menuLeftWidth: { min: 80, max: 400 },
  cartWidth: { min: 240, max: 600 },
  dishCardSize: { min: 60, max: 220 },
  toppingCardSize: { min: 40, max: 160 },
  drinkCardSize: { min: 40, max: 160 },
  sauceCardSize: { min: 40, max: 160 },
  cardRadius: { min: 0, max: 32 },
  gridGap: { min: 0, max: 32 },
  ordersRowGap: { min: 0, max: 24 },
  cartItemGap: { min: 0, max: 20 },
  itemTextSize: { min: 8, max: 20 },
  panelHeaderSize: { min: 7, max: 16 },
  orderNumberSize: { min: 12, max: 32 },
  toppingsHeight: { min: 80, max: 400 },
  drinksShare: { min: 20, max: 80 },
  leftShare: { min: 20, max: 80 },
  gridColsDishset: { min: 0, max: 60 },
  gridColsDrink: { min: 0, max: 60 },
  gridColsSauce: { min: 0, max: 60 },
  gridColsTopping: { min: 0, max: 60 },
  bottomMask: { min: 0, max: 7 },
  leftMask: { min: 0, max: 7 },
} as const;

export function clampLayout(key: keyof LayoutSettings, value: number): number {
  const l = LIMITS[key];
  return Math.max(l.min, Math.min(l.max, Math.round(value)));
}

function clampAll(s: LayoutSettings): LayoutSettings {
  const out = { ...s };
  for (const key of Object.keys(out) as (keyof LayoutSettings)[]) {
    out[key] = clampLayout(key, out[key]);
  }
  return out;
}

function readStored(mode: LayoutMode): LayoutSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[mode]);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const merged: LayoutSettings = { ...DEFAULT_LAYOUT };
    for (const key of Object.keys(DEFAULT_LAYOUT) as (keyof LayoutSettings)[]) {
      const v = parsed[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        merged[key] = clampLayout(key, v);
      }
    }
    return merged;
  } catch {
    return null;
  }
}

function loadLayout(mode: LayoutMode): LayoutSettings {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  const own = readStored(mode);
  if (own) return own;
  // Для режима «одна иконка» пока нет своего стиля — стартуем от стиля «все блюда»
  if (mode === 'single') return readStored('all') ?? DEFAULT_LAYOUT;
  return DEFAULT_LAYOUT;
}

const localChangeListeners = new Set<(s: LayoutSettings, mode: LayoutMode) => void>();

export function onLocalLayoutChange(
  listener: (s: LayoutSettings, mode: LayoutMode) => void
): () => void {
  localChangeListeners.add(listener);
  return () => {
    localChangeListeners.delete(listener);
  };
}

function notifyLocalChange(s: LayoutSettings, mode: LayoutMode) {
  localChangeListeners.forEach((l) => {
    try {
      l(s, mode);
    } catch {
      /* ignore */
    }
  });
}

function writeStored(mode: LayoutMode, s: LayoutSettings) {
  try {
    localStorage.setItem(STORAGE_KEYS[mode], JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function broadcast(mode: LayoutMode, s: LayoutSettings) {
  try {
    const bc = new BroadcastChannel(CHANNEL_NAMES[mode]);
    bc.postMessage(s);
    bc.close();
  } catch {
    /* ignore */
  }
}

/** Сохранённый стиль режима (из localStorage) — для отправки в облако */
export function getStoredLayout(mode: LayoutMode): LayoutSettings {
  return loadLayout(mode);
}

/** Применить стиль извне (по умолчанию — к текущему режиму групп) */
export function applyExternalLayout(
  settings: LayoutSettings,
  mode: LayoutMode = getViewPrefs().groupView
) {
  if (typeof window === 'undefined') return;
  const clamped = clampAll(settings);
  writeStored(mode, clamped);
  broadcast(mode, clamped);
}

const pendingBroadcast = new Map<LayoutMode, LayoutSettings>();
let persistRaf: number | null = null;

function schedulePersist(settings: LayoutSettings, mode: LayoutMode) {
  if (typeof window === 'undefined') return;
  // сохраняем сразу (чтобы смена режима не потеряла последнее значение),
  // а рассылку другим вкладкам откладываем на кадр
  writeStored(mode, settings);
  pendingBroadcast.set(mode, settings);
  if (persistRaf != null) return;
  persistRaf = window.requestAnimationFrame(() => {
    persistRaf = null;
    pendingBroadcast.forEach((s, m) => {
      broadcast(m, s);
      notifyLocalChange(s, m);
    });
    pendingBroadcast.clear();
  });
}

type Updater = LayoutSettings | ((prev: LayoutSettings) => LayoutSettings);

export function useLayoutSettings(): [LayoutSettings, (u: Updater) => void] {
  const [{ groupView: mode }] = useViewPrefs();
  const [state, setState] = useState<{ mode: LayoutMode; settings: LayoutSettings }>(
    () => ({ mode, settings: loadLayout(mode) })
  );

  // Режим групп сменился — подгружаем стиль нового режима
  let settings = state.settings;
  if (state.mode !== mode) {
    settings = loadLayout(mode);
    setState({ mode, settings });
  }

  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(CHANNEL_NAMES[mode]);
      bc.onmessage = (ev) => {
        const incoming = ev.data as LayoutSettings | undefined;
        if (incoming) setState({ mode, settings: clampAll(incoming) });
      };
    } catch {
      /* ignore */
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS[mode] && e.newValue) {
        setState({ mode, settings: loadLayout(mode) });
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('storage', onStorage);
      bc?.close();
    };
  }, [mode]);

  const update = (u: Updater) => {
    setState((prev) => {
      const base = prev.mode === mode ? prev.settings : loadLayout(mode);
      const resolved = typeof u === 'function' ? u(base) : u;
      const clamped = clampAll(resolved);
      schedulePersist(clamped, mode);
      return { mode, settings: clamped };
    });
  };

  return [settings, update];
}

export function snapValue(
  value: number,
  snapPoints: number[],
  threshold = 8
): number {
  for (const p of snapPoints) {
    if (Math.abs(value - p) <= threshold) return p;
  }
  return value;
}

/**
 * Планшеты и узкие окна: если боковые колонки не оставляют места центру,
 * временно (только при показе, настройки не меняются) сужаем их:
 * сначала левую/правую панели категорий, затем корзину.
 */
export function fitColumns(
  viewW: number,
  minCenter: number,
  fixed: number,
  cols: { left: number; right: number; cart: number },
  mins: { side: number; cart: number }
): { left: number; right: number; cart: number } {
  const out = { ...cols };
  let over = fixed + out.left + out.right + out.cart + minCenter - viewW;
  const steps: ['left' | 'right' | 'cart', number][] = [
    ['left', mins.side],
    ['right', mins.side],
    ['cart', mins.cart],
  ];
  for (const [k, min] of steps) {
    if (over <= 0) break;
    const cut = Math.min(over, Math.max(0, out[k] - min));
    out[k] -= cut;
    over -= cut;
  }
  return out;
}
