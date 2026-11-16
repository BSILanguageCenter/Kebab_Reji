import { useEffect, useState } from 'react';

export type Device = 'phone' | 'tablet' | 'desktop';

/** Границы совпадают с Tailwind: sm = 640, lg = 1024 */
export const TABLET_MIN = 640;
export const DESKTOP_MIN = 1024;

export interface Viewport {
  width: number;
  device: Device;
}

function toViewport(width: number): Viewport {
  const device: Device =
    width < TABLET_MIN ? 'phone' : width < DESKTOP_MIN ? 'tablet' : 'desktop';
  return { width, device };
}

/**
 * Текущая ширина окна и тип устройства.
 * Обновляется при resize / повороте экрана (не чаще раза за кадр).
 * Высоту намеренно не отслеживаем: при открытии экранной клавиатуры
 * она меняется, и страница перерисовывалась бы зря.
 */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => toViewport(window.innerWidth));

  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = window.innerWidth;
        setVp((prev) => (prev.width === w ? prev : toViewport(w)));
      });
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return vp;
}
