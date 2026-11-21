import { Fragment, type ReactNode } from 'react';

/** Категории, которые можно ставить в боковую (справа) или нижнюю панель. */
export type PanelCat = 'drink' | 'sauce' | 'topping';
export const PANEL_CATS: PanelCat[] = ['drink', 'sauce', 'topping'];

/** Заголовки панелей (напитки / соусы / топпинги) — компактные: меньше шрифт и отступы */
const compactHdr = (hdrSize: number) => Math.max(8, Math.round(hdrSize * 0.75));

const BIT: Record<PanelCat, number> = { drink: 1, sauce: 2, topping: 4 };

/** Маска «что стоит в нижней панели»: 1 — напитки, 2 — соусы, 4 — топпинги. */
export const DEFAULT_BOTTOM_MASK = 4;

export function isBottom(mask: number, cat: PanelCat): boolean {
  return (mask & BIT[cat]) !== 0;
}

export function toggleBottom(mask: number, cat: PanelCat): number {
  return mask ^ BIT[cat];
}

/** Где стоит категория: слева, справа или снизу */
export type PanelPlace = 'left' | 'right' | 'bottom';

export function getPlace(bottomMask: number, leftMask: number, cat: PanelCat): PanelPlace {
  if (isBottom(bottomMask, cat)) return 'bottom'; // «снизу» главнее
  if ((leftMask & BIT[cat]) !== 0) return 'left';
  return 'right';
}

/** Новые маски после переноса категории в указанное место */
export function setPlace(
  bottomMask: number,
  leftMask: number,
  cat: PanelCat,
  place: PanelPlace
): { bottomMask: number; leftMask: number } {
  const b = bottomMask & ~BIT[cat];
  const l = leftMask & ~BIT[cat];
  return {
    bottomMask: place === 'bottom' ? b | BIT[cat] : b,
    leftMask: place === 'left' ? l | BIT[cat] : l,
  };
}

export function splitPanelCats(
  bottomMask: number,
  leftMask = 0
): { bottom: PanelCat[]; left: PanelCat[]; side: PanelCat[] } {
  return {
    bottom: PANEL_CATS.filter((c) => getPlace(bottomMask, leftMask, c) === 'bottom'),
    left: PANEL_CATS.filter((c) => getPlace(bottomMask, leftMask, c) === 'left'),
    side: PANEL_CATS.filter((c) => getPlace(bottomMask, leftMask, c) === 'right'),
  };
}

const THEME: Record<
  PanelCat,
  { head: string; headText: string; divider: string; top: string }
> = {
  drink: {
    head: 'border-cyan-200 bg-cyan-50',
    headText: 'text-cyan-800 border-cyan-500',
    divider: 'border-cyan-300',
    top: 'border-cyan-300',
  },
  sauce: {
    head: 'border-red-200 bg-red-50',
    headText: 'text-red-800 border-red-500',
    divider: 'border-red-300',
    top: 'border-red-300',
  },
  topping: {
    head: 'border-purple-200 bg-purple-50',
    headText: 'text-purple-800 border-purple-500',
    divider: 'border-purple-300',
    top: 'border-purple-300',
  },
};

interface CommonProps {
  cats: PanelCat[];
  hdrSize: number;
  labelFor: (cat: PanelCat) => string;
  renderBody: (cat: PanelCat) => ReactNode;
  /** Нажатие на заголовок — менеджер по зажатию переносит панель в другое место */
  onHeaderPointerDown?: (cat: PanelCat, e: React.PointerEvent<HTMLElement>) => void;
  /** Какая панель сейчас перетаскивается (подсветка) */
  draggingCat?: PanelCat | null;
}

/** Общие свойства заголовка, за который можно «взять» панель */
function headerDragProps(
  cat: PanelCat,
  onDown: CommonProps['onHeaderPointerDown'],
  dragging: boolean
): {
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  style?: React.CSSProperties;
  className?: string;
} {
  if (!onDown) return {};
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => onDown(cat, e),
    // на планшете долгое нажатие не должно вызывать меню / выделение текста / прокрутку
    style: {
      touchAction: 'none' as const,
      WebkitTouchCallout: 'none' as const,
      WebkitUserSelect: 'none' as const,
      userSelect: 'none' as const,
    },
    className: `cursor-grab select-none min-h-[1.1rem] flex items-center ${
      dragging ? 'opacity-50' : ''
    }`,
  };
}

/** Боковая панель: 1–3 категории друг под другом. */
export function SidePanelCats({
  cats,
  hdrSize,
  labelFor,
  renderBody,
  onHeaderPointerDown,
  draggingCat,
  share,
  splitter,
}: CommonProps & {
  /** доля высоты первой категории (%), если категорий две */
  share: number;
  /** ручка между двумя категориями */
  splitter?: ReactNode;
}) {
  return (
    <>
      {cats.map((cat, i) => {
        const th = THEME[cat];
        const first = i === 0 && cats.length === 2;
        const last = i === cats.length - 1;
        const hp = headerDragProps(cat, onHeaderPointerDown, draggingCat === cat);
        return (
          <Fragment key={cat}>
            <div
              className={`flex flex-col min-h-0 ${first ? '' : 'flex-1'} ${
                last ? '' : `border-b-2 ${th.divider}`
              }`}
              style={first ? { height: `${share}%` } : undefined}
            >
              <div
                className={`px-1.5 py-0.5 border-b shrink-0 ${th.head} ${hp.className ?? ''}`}
                style={hp.style}
                onPointerDown={hp.onPointerDown}
                onContextMenu={onHeaderPointerDown ? (e) => e.preventDefault() : undefined}
              >
                <h3
                  className={`font-bold border-l-2 pl-1 leading-none ${th.headText}`}
                  style={{ fontSize: compactHdr(hdrSize) }}
                >
                  {labelFor(cat)}
                </h3>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-2">{renderBody(cat)}</div>
            </div>
            {first && splitter}
          </Fragment>
        );
      })}
    </>
  );
}

/** Нижняя панель: 1–3 категории рядом (колонками). */
export function BottomPanelCats({
  cats,
  hdrSize,
  labelFor,
  renderBody,
  onHeaderPointerDown,
  draggingCat,
  height,
  splitter,
}: CommonProps & { height: number; splitter?: ReactNode }) {
  if (cats.length === 0) return null;
  return (
    <>
      {splitter}
      <div
        className={`shrink-0 bg-white flex overflow-hidden border-t-2 ${THEME[cats[0]].top}`}
        style={{ height, maxHeight: '45%' }}
      >
        {cats.map((cat, i) => {
          const th = THEME[cat];
          const hp = headerDragProps(cat, onHeaderPointerDown, draggingCat === cat);
          return (
            <div
              key={cat}
              className={`flex-1 min-w-0 flex flex-col px-2 py-1 ${
                i > 0 ? 'border-l border-slate-300' : ''
              }`}
            >
              <h3
                className={`font-bold mb-0.5 border-l-2 pl-1 leading-none shrink-0 ${th.headText} ${hp.className ?? ''}`}
                style={{ fontSize: compactHdr(hdrSize), ...hp.style }}
                onPointerDown={hp.onPointerDown}
                onContextMenu={onHeaderPointerDown ? (e) => e.preventDefault() : undefined}
              >
                {labelFor(cat)}
              </h3>
              <div className="flex-1 min-h-0 overflow-y-auto">{renderBody(cat)}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
