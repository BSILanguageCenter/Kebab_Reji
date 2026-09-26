import { useRef } from 'react';

export function Resizer({
  onStart,
  onResize,
  onEnd,
  direction = 'vertical',
}: {
  onStart?: () => void;
  onResize: (totalDelta: number) => void;
  onEnd?: (totalDelta: number) => void;
  direction?: 'vertical' | 'horizontal';
}) {
  const dragging = useRef(false);
  const startPos = useRef(0);
  const totalDelta = useRef(0);
  const rafRef = useRef<number | null>(null);
  const pending = useRef(false);
  const elRef = useRef<HTMLDivElement>(null);

  const flush = () => {
    rafRef.current = null;
    if (!pending.current) return;
    pending.current = false;
    onResize(totalDelta.current);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    startPos.current = direction === 'vertical' ? e.clientX : e.clientY;
    totalDelta.current = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor =
      direction === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    elRef.current?.classList.add('resizer-active');
    onStart?.();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const pos = direction === 'vertical' ? e.clientX : e.clientY;
    const delta = pos - startPos.current;
    if (delta === totalDelta.current) return;
    totalDelta.current = delta;
    pending.current = true;
    if (rafRef.current == null) {
      rafRef.current = window.requestAnimationFrame(flush);
    }
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;

    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pending.current = false;

    onResize(totalDelta.current);
    onEnd?.(totalDelta.current);

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    elRef.current?.classList.remove('resizer-active');
  };

  if (direction === 'vertical') {
    return (
      <div
        ref={elRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        className="shrink-0 w-2 relative cursor-col-resize group select-none"
        style={{ touchAction: 'none' }}
        title="Потяните, чтобы изменить ширину"
      >
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[4px] rounded-full bg-gray-300 group-hover:bg-orange-400 group-active:bg-orange-500 transition-colors pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="flex flex-col gap-0.5">
            <div className="w-1 h-1 rounded-full bg-orange-500" />
            <div className="w-1 h-1 rounded-full bg-orange-500" />
            <div className="w-1 h-1 rounded-full bg-orange-500" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={elRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      className="shrink-0 h-2 relative cursor-row-resize group select-none"
      style={{ touchAction: 'none' }}
      title="Потяните, чтобы изменить высоту"
    >
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[4px] rounded-full bg-gray-300 group-hover:bg-orange-400 group-active:bg-orange-500 transition-colors pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="flex gap-0.5">
          <div className="w-1 h-1 rounded-full bg-orange-500" />
          <div className="w-1 h-1 rounded-full bg-orange-500" />
          <div className="w-1 h-1 rounded-full bg-orange-500" />
        </div>
      </div>
    </div>
  );
}