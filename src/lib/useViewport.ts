import { useSyncExternalStore } from 'react';

export type Device = 'phone' | 'tablet' | 'desktop';

/** Границы раскладок совпадают с Tailwind: sm = 640, lg = 1024 */
export const TABLET_MIN = 640;
export const DESKTOP_MIN = 1024;

/**
 * ЭТАЛОННЫЙ ДИЗАЙН: 1366x768 при шрифте <html> 16px = масштаб 1.0.
 * Весь интерфейс (Tailwind в rem + все «пиксельные» значения, которые
 * страницы умножают на `scale`) масштабируется ОДНИМ числом — размером
 * шрифта <html>. Никаких transform / обёрток фиксированного размера:
 * приложение всегда занимает 100% окна, а поведение drag, fixed-диалогов
 * и vh/dvh остаётся нативным.
 */
const REF_H = 768;
const BASE_PX = 16;

/**
 * Размер шрифта <html> (px) для данной ширины окна.
 * Кусочно-линейная кривая БЕЗ скачков и БЕЗ пределов: между опорными точками
 * линейная интерполяция, за пределами продолжается пропорционально.
 * Хотите весь интерфейс крупнее/мельче: меняйте числа справа.
 */
const ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [320, 9],
  [390, 10.5],
  [640, 11.5],
  [1024, 12.3],
  [1366, 16],
  [1920, 22.5],
  [2560, 30],
];

/**
 * Доля высоты окна, которую шрифт не должен превышать (низкие окна).
 * Ровно BASE_PX / REF_H, чтобы эталон 1366x768 давал именно 1.0
 * (раньше было округлённое 0.0208 -> 15.97px).
 */
const HEIGHT_FACTOR = BASE_PX / REF_H;

export function computeRootPx(width: number, height: number): number {
  const first = ANCHORS[0];
  const last = ANCHORS[ANCHORS.length - 1];
  let px: number;
  if (width <= first[0]) {
    px = (width / first[0]) * first[1];
  } else if (width >= last[0]) {
    px = (width / last[0]) * last[1];
  } else {
    let i = 1;
    while (ANCHORS[i][0] < width) i++;
    const [x0, y0] = ANCHORS[i - 1];
    const [x1, y1] = ANCHORS[i];
    px = y0 + ((width - x0) / (x1 - x0)) * (y1 - y0);
  }
  return Math.min(px, height * HEIGHT_FACTOR);
}

export interface Viewport {
  width: number;
  device: Device;
  /** Во сколько раз текущий размер шрифта html больше 16px */
  scale: number;
}

function measure(): Viewport {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const device: Device =
    width < TABLET_MIN ? 'phone' : width < DESKTOP_MIN ? 'tablet' : 'desktop';
  return { width, device, scale: computeRootPx(width, height) / BASE_PX };
}

/** Записывает масштаб в <html>: единственное место, где он применяется. */
function apply(vp: Viewport) {
  const root = document.documentElement;
  root.style.fontSize = `${vp.scale * BASE_PX}px`;
  root.style.setProperty('--ui-scale', String(vp.scale));
}

/** Выставляет размер шрифта <html> по текущему окну. Вызывается сразу и при resize. */
export function applyUiScale(): number {
  const vp = measure();
  apply(vp);
  return vp.scale;
}

// ============================================================
// ЕДИНОЕ ХРАНИЛИЩЕ
// font-size <html> и значение `scale` для React обновляются в одном месте
// и в одном кадре, поэтому rem-размеры и «пиксельные» размеры
// (ширины колонок, карточки) никогда не расходятся.
// ============================================================
const SSR_VIEWPORT: Viewport = { width: 1366, device: 'desktop', scale: 1 };

let current: Viewport =
  typeof window === 'undefined' ? SSR_VIEWPORT : measure();
if (typeof window !== 'undefined') apply(current);

const listeners = new Set<() => void>();

function sync() {
  const next = measure();
  // Применяем к <html> всегда, когда изменился масштаб (он зависит и от высоты)
  if (next.scale !== current.scale) apply(next);
  // React обновляем только при смене ширины или масштаба (как раньше)
  if (next.width !== current.width || next.scale !== current.scale) {
    current = next;
    listeners.forEach((l) => l());
  }
}

if (typeof window !== 'undefined') {
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      sync();
    });
  };
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', () => {
    schedule();
    // iOS Safari отдаёт новые размеры не сразу после поворота
    window.setTimeout(schedule, 300);
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Ширина окна, тип устройства и масштаб интерфейса.
 * Обновляется при resize / повороте (не чаще раза за кадр) и только
 * если изменилась ширина или масштаб.
 */
export function useViewport(): Viewport {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => SSR_VIEWPORT
  );
}
