import { useEffect, useState } from 'react';

export interface LayoutSettings {
  ordersWidth: number;
  menuRightWidth: number;
  cartWidth: number;
  dishCardSize: number;
  toppingCardSize: number;
  drinkCardSize: number;
  sauceCardSize: number;
  itemTextSize: number;
  toppingsHeight: number;
  drinksShare: number;
}

const STORAGE_KEY = 'kebab-pos-layout-v1';
const CHANNEL_NAME = 'kebab-pos-layout';

export const DEFAULT_LAYOUT: LayoutSettings = {
  ordersWidth: 208,
  menuRightWidth: 200,
  cartWidth: 320,
  dishCardSize: 120,
  toppingCardSize: 80,
  drinkCardSize: 72,
  sauceCardSize: 72,
  itemTextSize: 12,
  toppingsHeight: 180,
  drinksShare: 50,
};

const LIMITS = {
  ordersWidth: { min: 140, max: 400 },
  menuRightWidth: { min: 140, max: 400 },
  cartWidth: { min: 240, max: 600 },
  dishCardSize: { min: 60, max: 220 },
  toppingCardSize: { min: 40, max: 160 },
  drinkCardSize: { min: 40, max: 160 },
  sauceCardSize: { min: 40, max: 160 },
  itemTextSize: { min: 8, max: 20 },
  toppingsHeight: { min: 80, max: 400 },
  drinksShare: { min: 20, max: 80 },
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

function loadLayout(): LayoutSettings {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
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
    return DEFAULT_LAYOUT;
  }
}

// ============================================================
// Персист через rAF — не блокирует UI при быстром drag
// ============================================================
let persistRaf: number | null = null;
let pendingPersist: LayoutSettings | null = null;

function schedulePersist(settings: LayoutSettings) {
  if (typeof window === 'undefined') return;
  pendingPersist = settings;
  if (persistRaf != null) return;
  persistRaf = window.requestAnimationFrame(() => {
    persistRaf = null;
    const p = pendingPersist;
    pendingPersist = null;
    if (!p) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
    try {
      const bc = new BroadcastChannel(CHANNEL_NAME);
      bc.postMessage(p);
      bc.close();
    } catch {
      /* ignore */
    }
  });
}

// ============================================================
// Hook
// ============================================================
type Updater = LayoutSettings | ((prev: LayoutSettings) => LayoutSettings);

export function useLayoutSettings(): [LayoutSettings, (u: Updater) => void] {
  const [settings, setSettings] = useState<LayoutSettings>(loadLayout);

  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(CHANNEL_NAME);
      bc.onmessage = (ev) => {
        const incoming = ev.data as LayoutSettings | undefined;
        if (incoming) setSettings(clampAll(incoming));
      };
    } catch {
      /* ignore */
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setSettings(loadLayout());
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('storage', onStorage);
      bc?.close();
    };
  }, []);

  const update = (u: Updater) => {
    setSettings((prev) => {
      const resolved = typeof u === 'function' ? u(prev) : u;
      const clamped = clampAll(resolved);
      schedulePersist(clamped);
      return clamped;
    });
  };

  return [settings, update];
}

// ============================================================
// Магнитная привязка
// ============================================================
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