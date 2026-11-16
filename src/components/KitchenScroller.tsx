import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Красивая горизонтальная лента для кухни:
 *  - плавное колесо мыши (вертикальное колесо -> горизонтальный скролл)
 *  - перетаскивание мышью с инерцией
 *  - большие круглые стрелки (появляются, только если есть куда листать)
 *  - мягкие затемнения по краям
 *  - свой ползунок снизу (тянется и кликается), нативный скроллбар скрыт
 *  - тачпад и сенсор работают нативно
 */
export function KitchenScroller({
  children,
  itemWidth = 376,
}: {
  children: ReactNode;
  /** ширина карточки + отступ — на сколько листают стрелки */
  itemWidth?: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);

  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  // Общие функции анимации, доступные кнопкам
  const api = useRef<{ animateTo: (x: number) => void; stop: () => void }>({
    animateTo: () => {},
    stop: () => {},
  });

  useEffect(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!el || !track || !thumb) return;

    const maxScroll = () => Math.max(0, el.scrollWidth - el.clientWidth);
    const clamp = (x: number) => Math.max(0, Math.min(x, maxScroll()));

    // ---------- индикаторы: ползунок, края, стрелки ----------
    let uiRaf = 0;
    const updateUi = () => {
      uiRaf = 0;
      const max = maxScroll();
      const trackW = track.clientWidth;
      const ratio = el.scrollWidth > 0 ? el.clientWidth / el.scrollWidth : 1;
      const thumbW = Math.max(56, trackW * ratio);
      const free = Math.max(0, trackW - thumbW);
      const x = max > 0 ? (el.scrollLeft / max) * free : 0;
      thumb.style.width = `${thumbW}px`;
      thumb.style.transform = `translateX(${x}px)`;

      const left = el.scrollLeft > 4;
      const right = el.scrollLeft < max - 4;
      setCanLeft((p) => (p === left ? p : left));
      setCanRight((p) => (p === right ? p : right));
    };
    const scheduleUi = () => {
      if (!uiRaf) uiRaf = requestAnimationFrame(updateUi);
    };

    el.addEventListener('scroll', scheduleUi, { passive: true });
    const ro = new ResizeObserver(scheduleUi);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    updateUi();

    // ---------- плавная анимация к позиции ----------
    let target = el.scrollLeft;
    let current = el.scrollLeft;
    let raf = 0;

    const step = () => {
      const diff = target - current;
      if (Math.abs(diff) < 0.5) {
        current = target;
        el.scrollLeft = current;
        raf = 0;
        return;
      }
      current += diff * 0.16;
      el.scrollLeft = current;
      raf = requestAnimationFrame(step);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      target = el.scrollLeft;
      current = el.scrollLeft;
    };
    const animateTo = (x: number) => {
      if (!raf) {
        current = el.scrollLeft;
        target = el.scrollLeft;
      }
      target = clamp(x);
      if (!raf) raf = requestAnimationFrame(step);
    };
    api.current = {
      animateTo: (x) => animateTo(x),
      stop,
    };

    // ---------- колесо мыши ----------
    const onWheel = (e: WheelEvent) => {
      // тачпад (горизонтальный жест) — нативно
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        stop();
        return;
      }
      if (maxScroll() <= 0) return;
      e.preventDefault();
      const dy = (e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY) * 1.3;
      const base = raf ? target : el.scrollLeft;
      animateTo(base + dy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    // сенсорный жест — отменяем нашу анимацию, чтобы не боролась
    const onTouchStart = () => stop();
    el.addEventListener('touchstart', onTouchStart, { passive: true });

    // ---------- перетаскивание мышью + инерция ----------
    let dragging = false;
    let startX = 0;
    let startLeft = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0; // px/мс
    let inertiaRaf = 0;

    const stopInertia = () => {
      if (inertiaRaf) cancelAnimationFrame(inertiaRaf);
      inertiaRaf = 0;
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button, a, input, textarea')) {
        return;
      }
      stop();
      stopInertia();
      dragging = true;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      lastX = e.clientX;
      lastT = performance.now();
      velocity = 0;
      el.setPointerCapture(e.pointerId);
      el.classList.add('kscroll-dragging');
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      el.scrollLeft = startLeft - (e.clientX - startX);
      const t = performance.now();
      const dt = Math.max(1, t - lastT);
      velocity = (e.clientX - lastX) / dt;
      lastX = e.clientX;
      lastT = t;
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      el.classList.remove('kscroll-dragging');

      // инерция
      let v = velocity * 16; // px за кадр
      const glide = () => {
        if (Math.abs(v) < 0.3) {
          inertiaRaf = 0;
          return;
        }
        el.scrollLeft -= v;
        v *= 0.94;
        inertiaRaf = requestAnimationFrame(glide);
      };
      if (Math.abs(v) > 1) inertiaRaf = requestAnimationFrame(glide);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);

    // ---------- свой ползунок ----------
    let thumbDrag = false;
    let thumbStartX = 0;
    let thumbStartLeft = 0;

    const onThumbDown = (e: PointerEvent) => {
      e.stopPropagation();
      stop();
      stopInertia();
      thumbDrag = true;
      thumbStartX = e.clientX;
      thumbStartLeft = el.scrollLeft;
      thumb.setPointerCapture(e.pointerId);
      thumb.classList.add('kscroll-thumb-active');
    };
    const onThumbMove = (e: PointerEvent) => {
      if (!thumbDrag) return;
      const free = Math.max(1, track.clientWidth - thumb.clientWidth);
      const k = maxScroll() / free;
      el.scrollLeft = thumbStartLeft + (e.clientX - thumbStartX) * k;
    };
    const onThumbUp = (e: PointerEvent) => {
      if (!thumbDrag) return;
      thumbDrag = false;
      try {
        thumb.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      thumb.classList.remove('kscroll-thumb-active');
    };
    thumb.addEventListener('pointerdown', onThumbDown);
    thumb.addEventListener('pointermove', onThumbMove);
    thumb.addEventListener('pointerup', onThumbUp);
    thumb.addEventListener('pointercancel', onThumbUp);

    // клик по дорожке — плавно прыгнуть туда
    const onTrackDown = (e: PointerEvent) => {
      if (e.target !== track) return;
      const rect = track.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      animateTo(ratio * el.scrollWidth - el.clientWidth / 2);
    };
    track.addEventListener('pointerdown', onTrackDown);

    return () => {
      el.removeEventListener('scroll', scheduleUi);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      thumb.removeEventListener('pointerdown', onThumbDown);
      thumb.removeEventListener('pointermove', onThumbMove);
      thumb.removeEventListener('pointerup', onThumbUp);
      thumb.removeEventListener('pointercancel', onThumbUp);
      track.removeEventListener('pointerdown', onTrackDown);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      if (uiRaf) cancelAnimationFrame(uiRaf);
      if (inertiaRaf) cancelAnimationFrame(inertiaRaf);
    };
  }, []);

  const page = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    const per = Math.max(1, Math.floor(el.clientWidth / itemWidth));
    api.current.animateTo(el.scrollLeft + dir * per * itemWidth);
  };

  const hasOverflow = canLeft || canRight;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <style>{`
        .kscroll {
          scrollbar-width: none;
          -ms-overflow-style: none;
          overscroll-behavior-x: contain;
          cursor: grab;
        }
        .kscroll::-webkit-scrollbar { display: none; }
        .kscroll.kscroll-dragging { cursor: grabbing; user-select: none; }
        /* сенсорные экраны: карточки «прилипают» к краю при свайпе */
        @media (pointer: coarse) {
          .kscroll { scroll-snap-type: x proximity; scroll-padding-inline: 16px; }
          .kscroll > * > * { scroll-snap-align: start; }
        }

        .kscroll-thumb {
          background: linear-gradient(90deg, #fb923c, #f97316);
          box-shadow: 0 2px 8px rgba(249,115,22,.45), inset 0 1px 0 rgba(255,255,255,.4);
          transition: filter .15s, box-shadow .15s;
          touch-action: none;
          cursor: grab;
        }
        .kscroll-thumb:hover { filter: brightness(1.08); }
        .kscroll-thumb.kscroll-thumb-active {
          cursor: grabbing;
          filter: brightness(1.12);
          box-shadow: 0 3px 12px rgba(249,115,22,.65), inset 0 1px 0 rgba(255,255,255,.5);
        }
      `}</style>

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          className="kscroll absolute inset-0 overflow-x-auto overflow-y-hidden px-4 py-4"
        >
          {children}
        </div>

        {/* затемнения по краям */}
        <div
          className={`pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-slate-100 via-slate-100/70 to-transparent transition-opacity duration-300 ${
            canLeft ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div
          className={`pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-slate-100 via-slate-100/70 to-transparent transition-opacity duration-300 ${
            canRight ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* стрелки */}
        <button
          type="button"
          onClick={() => page(-1)}
          tabIndex={canLeft ? 0 : -1}
          aria-label="Влево"
          className={`absolute left-3 top-1/2 -translate-y-1/2 z-10 w-14 h-14 rounded-full bg-white text-slate-800 border-2 border-slate-200 shadow-xl hidden md:flex items-center justify-center transition-all duration-300 hover:bg-orange-500 hover:text-white hover:border-orange-500 active:scale-90 ${
            canLeft
              ? 'opacity-100 scale-100'
              : 'opacity-0 scale-75 pointer-events-none'
          }`}
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
        <button
          type="button"
          onClick={() => page(1)}
          tabIndex={canRight ? 0 : -1}
          aria-label="Вправо"
          className={`absolute right-3 top-1/2 -translate-y-1/2 z-10 w-14 h-14 rounded-full bg-white text-slate-800 border-2 border-slate-200 shadow-xl hidden md:flex items-center justify-center transition-all duration-300 hover:bg-orange-500 hover:text-white hover:border-orange-500 active:scale-90 ${
            canRight
              ? 'opacity-100 scale-100'
              : 'opacity-0 scale-75 pointer-events-none'
          }`}
        >
          <ChevronRight className="w-8 h-8" />
        </button>
      </div>

      {/* ползунок снизу */}
      <div
        className={`hidden md:block shrink-0 px-6 pb-3 pt-1 transition-opacity duration-300 ${
          hasOverflow ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div
          ref={trackRef}
          className="relative h-3 rounded-full bg-slate-300/70 shadow-inner cursor-pointer"
        >
          <div
            ref={thumbRef}
            className="kscroll-thumb absolute top-0 left-0 h-3 rounded-full"
            style={{ width: 56 }}
          />
        </div>
      </div>
    </div>
  );
}
