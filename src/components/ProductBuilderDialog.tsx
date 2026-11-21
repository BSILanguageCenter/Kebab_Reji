/* eslint-disable react-refresh/only-export-components */
// src/components/ProductBuilderDialog.tsx
import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  useLayoutEffect,
} from 'react';
import type { ReactNode } from 'react';
import { X, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '@/locale';
import { formatYen } from '@/locale/format';
import { subscribeMenu } from '@/lib/localStore';
import type {
  MenuItem,
  HydratedSauce,
  HydratedProperty,
  HydratedSetExtraGroup,
  CartItemOption,
} from '@/types/database';

type Ctx = 'main' | { extra: string };

type Step =
  | { kind: 'variant'; variants: MenuItem[] }
  | { kind: 'sauce'; ctx: Ctx; sauces: HydratedSauce[] }
  | { kind: 'addon'; addon: 'drink' | 'topping'; items: HydratedSauce[] }
  | { kind: 'extra-option'; group: HydratedSetExtraGroup };

interface ExtraSel {
  optionId: string | null;
  /** Несколько выбранных вариантов (если в группе можно выбрать больше одного) */
  optionIds?: string[];
  sauceIds: string[];
  props: Record<string, string[]>;
}

interface Selections {
  variantId: string | null;
  mainSauceIds: string[];
  /** id выбранных напитков и топпингов главного блюда */
  mainAddonIds: string[];
  mainProps: Record<string, string[]>;
  extras: Record<string, ExtraSel>;
}

/** Сколько вариантов группы можно выбрать (1…число продуктов в группе). */
export function pickLimit(group: HydratedSetExtraGroup): number {
  const n = Math.max(1, group.options.length);
  return Math.max(1, Math.min(Math.floor(group.pick_count ?? 1), n));
}

/** Группа показывается окном: включено «окном» или лимит меньше числа продуктов. */
export function groupIsPopup(group: {
  popup?: boolean;
  pick_set?: boolean;
  pick_count?: number;
  options: unknown[];
}): boolean {
  if (group.popup !== false) return true;
  const n = group.options.length;
  return Boolean(group.pick_set) && n > 1 && Math.floor(group.pick_count ?? n) < n;
}

/** Лимит выбора у блюда: соусы по умолчанию 2, напитки и топпинги без лимита. */
export function addonLimit(
  main: MenuItem | undefined,
  kind: 'sauce' | 'drink' | 'topping'
): number {
  const raw =
    kind === 'sauce'
      ? main?.max_sauces
      : kind === 'drink'
      ? main?.max_drinks
      : main?.max_toppings;
  if (typeof raw === 'number' && raw >= 1) return Math.floor(raw);
  return kind === 'sauce' ? 2 : Infinity;
}

/**
 * Какие продукты группы попадают в заказ.
 * «Показывать окном» выключено — ВСЯ группа идёт в заказ целиком.
 * Включено — то, что выбрал кассир.
 */
function pickedOptionIds(
  group: HydratedSetExtraGroup,
  ex: ExtraSel | undefined
): string[] {
  if (!groupIsPopup(group)) return group.options.map((o) => o.item.id);
  if (ex?.optionIds && ex.optionIds.length > 0) return ex.optionIds;
  if (ex?.optionId) return [ex.optionId];
  if (group.options.length === 1) return [group.options[0].item.id];
  return [];
}

/** Нужно ли окно выбора из-за дополнительных групп сета. */
export function extrasNeedDialog(item: MenuItem): boolean {
  if (item.type !== 'set') return false;
  return (item.set_extra_groups ?? []).some(
    (g) =>
      g.options.length > 0 &&
      (groupIsPopup(g) ||
        g.options.some((o) => (o.item.properties?.length ?? 0) > 0))
  );
}

/** Группы без окна: их продукты добавляются в заказ автоматически. */
export function autoExtraOptions(item: MenuItem): CartItemOption[] {
  if (item.type !== 'set') return [];
  const out: CartItemOption[] = [];
  for (const g of item.set_extra_groups ?? []) {
    if (groupIsPopup(g)) continue;
    for (const o of g.options) {
      out.push({
        type: 'extra',
        name: `${g.label}: ${o.item.name}`,
        price: 0,
        quantity: 1,
      });
    }
  }
  return out;
}

export interface BuilderResult {
  variant: string;
  price: number;
  options: CartItemOption[];
}

// ============================================================
// СЕТКА, КОТОРАЯ САМА ПОДБИРАЕТ РАЗМЕР ПЛИТОК ПОД КОНТЕЙНЕР
// ============================================================
function FitGrid({
  count,
  labelH,
  gap = 12,
  maxSize = 240,
  minSize = 44,
  render,
}: {
  count: number;
  labelH: number; // высота подписи под иконкой (px)
  gap?: number;
  maxSize?: number;
  minSize?: number;
  render: (index: number, size: number) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setBox({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { cols, size } = useMemo(() => {
    const { w, h } = box;
    if (w <= 0 || h <= 0 || count === 0) return { cols: 1, size: 0 };

    type Cand = { cols: number; size: number; empty: number; totalH: number };

    // лучше: крупнее размер → меньше пустых клеток в последней строке → больше колонок
    const better = (a: Cand, b: Cand | null) =>
      !b ||
      a.size > b.size ||
      (a.size === b.size &&
        (a.empty < b.empty || (a.empty === b.empty && a.cols > b.cols)));

    let best: Cand | null = null; // влезает по высоте без скролла
    let scroll: Cand | null = null; // запасной вариант (будет скролл)

    for (let c = 1; c <= count; c++) {
      const rows = Math.ceil(count / c);
      const size = Math.min(maxSize, Math.floor((w - gap * (c - 1)) / c));
      if (size <= 0) continue;
      const cand: Cand = {
        cols: c,
        size,
        empty: c * rows - count,
        totalH: rows * (size + labelH) + gap * (rows - 1),
      };

      if (cand.totalH <= h && better(cand, best)) best = cand;
      if (size >= minSize && (!scroll || cand.totalH < scroll.totalH)) {
        scroll = cand;
      }
    }

    // если по высоте влезает только слишком мелко, лучше крупнее и со скроллом
    const pick = best && best.size >= minSize ? best : scroll ?? best;
    return pick ? { cols: pick.cols, size: pick.size } : { cols: 1, size: 0 };
  }, [box, count, labelH, gap, maxSize, minSize]);

  return (
    <div ref={ref} className="flex-1 min-h-0 overflow-y-auto p-1">
      {size > 0 && (
        <div
          className="grid content-start"
          style={{
            gridTemplateColumns: `repeat(${cols}, ${size}px)`,
            gap,
            justifyContent: 'center',
          }}
        >
          {Array.from({ length: count }, (_, i) => render(i, size))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// НОРМАЛИЗАЦИЯ
// ============================================================
function normalizeProperty(
  p: Partial<HydratedProperty> | undefined | null
): HydratedProperty {
  return {
    id: typeof p?.id === 'string' ? p.id : '',
    item_id: typeof p?.item_id === 'string' ? p.item_id : '',
    name: typeof p?.name === 'string' ? p.name : '',
    options: Array.isArray(p?.options) ? (p!.options as string[]) : [],
    required: Boolean(p?.required),
    sort_order:
      typeof p?.sort_order === 'number' && Number.isFinite(p.sort_order)
        ? p.sort_order
        : 0,
    price: typeof p?.price === 'number' ? p.price : 0,
  };
}

function normalizeMenuItem(
  it: MenuItem | null | undefined
): MenuItem | null {
  if (!it) return null;

  const properties = Array.isArray(it.properties)
    ? it.properties.map(normalizeProperty)
    : [];

  const variants = Array.isArray(it.variants)
    ? (it.variants
        .map((v) => normalizeMenuItem(v))
        .filter(Boolean) as MenuItem[])
    : undefined;

  const set_main = it.set_main
    ? normalizeMenuItem(it.set_main) ?? undefined
    : undefined;

  const set_extra_groups = Array.isArray(it.set_extra_groups)
    ? it.set_extra_groups.map((g) => ({
        ...g,
        options: Array.isArray(g.options)
          ? (g.options
              .map((o) => {
                const norm = normalizeMenuItem(o.item);
                if (!norm) return null;
                return { option_id: o.option_id, item: norm };
              })
              .filter(
                (x): x is { option_id: string; item: MenuItem } => !!x
              ))
          : [],
      }))
    : undefined;

  return {
    ...it,
    properties,
    variants,
    set_main,
    set_extra_groups,
  };
}

function validProps(list: HydratedProperty[] | undefined): HydratedProperty[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (p) => Array.isArray(p.options) && p.options.length > 0
  );
}

// ============================================================
// ПОРЯДОК ШАГОВ (без свойств, они справа)
// ============================================================
function computeSteps(
  item: MenuItem,
  selections: Selections,
  initialVariantId?: string
): Step[] {
  const steps: Step[] = [];

  const mainItem = item.type === 'set' ? item.set_main : item;
  if (!mainItem) return steps;

  let resolvedMain: MenuItem = mainItem;

  // 1. Variant главного
  if (
    mainItem.dish_kind === 'group' &&
    mainItem.variants &&
    mainItem.variants.length > 0
  ) {
    if (!initialVariantId) {
      steps.push({ kind: 'variant', variants: mainItem.variants });
    }

    const vId = selections.variantId || initialVariantId;
    const v = vId ? mainItem.variants.find((x) => x.id === vId) : null;

    if (!v) return steps;
    resolvedMain = v;
  }

  // 2. Соусы главного
  if (
    resolvedMain.sauce_mode === 'with' &&
    (resolvedMain.allowed_sauces?.length ?? 0) > 0
  ) {
    steps.push({
      kind: 'sauce',
      ctx: 'main',
      sauces: resolvedMain.allowed_sauces!,
    });
  }

  // 2b. Напитки и топпинги главного (необязательные шаги)
  if ((resolvedMain.allowed_drinks?.length ?? 0) > 0) {
    steps.push({
      kind: 'addon',
      addon: 'drink',
      items: resolvedMain.allowed_drinks!,
    });
  }
  if ((resolvedMain.allowed_toppings?.length ?? 0) > 0) {
    steps.push({
      kind: 'addon',
      addon: 'topping',
      items: resolvedMain.allowed_toppings!,
    });
  }

  // 3. Extras сета
  if (item.type === 'set' && item.set_extra_groups) {
    for (const group of item.set_extra_groups) {
      // галочка «Показывать окном» выключена — в кассе эту группу не спрашиваем
      if (!groupIsPopup(group)) continue;
      const ex = selections.extras[group.id];

      // Шаг выбора допа остаётся в списке и ПОСЛЕ выбора. Раньше он исчезал,
      // длина steps уменьшалась, и индекс шага откатывался назад (на соусы).
      // Окно показываем и когда продукт в группе один — раньше шаг пропускался
      // (options.length > 1), и галочка «Показывать окном» ничего не делала.
      if (group.options.length >= 1) {
        steps.push({ kind: 'extra-option', group });
      }

      // соусы допа спрашиваем, только когда выбирается один вариант
      if (pickLimit(group) > 1) continue;
      const optId = pickedOptionIds(group, ex)[0] ?? null;
      if (!optId) continue;

      const optItem = group.options.find((o) => o.item.id === optId)?.item;
      if (!optItem) continue;

      if (
        optItem.sauce_mode === 'with' &&
        (optItem.allowed_sauces?.length ?? 0) > 0
      ) {
        steps.push({
          kind: 'sauce',
          ctx: { extra: group.id },
          sauces: optItem.allowed_sauces!,
        });
      }
    }
  }

  return steps;
}

function computePrice(item: MenuItem, selections: Selections): number {
  let basePrice = 0;

  if (item.type === 'set') {
    const mainItem = item.set_main;
    if (!mainItem) return 0;

    if (mainItem.dish_kind === 'group') {
      if (!selections.variantId) return 0;
      const v = mainItem.variants?.find(
        (x) => x.id === selections.variantId
      );
      basePrice = v ? v.price : 0;
    } else {
      basePrice = mainItem.price;
    }
  } else {
    if (item.dish_kind === 'group' && selections.variantId && item.variants) {
      const v = item.variants.find((x) => x.id === selections.variantId);
      basePrice = v ? v.price : item.price;
    } else {
      basePrice = item.price;
    }
  }

  // Добавляем цену свойств
  let propsPrice = 0;

  const mainItem = item.type === 'set' ? item.set_main : item;
  const resolvedMain =
    mainItem?.dish_kind === 'group' && selections.variantId
      ? mainItem.variants?.find((x) => x.id === selections.variantId)
      : mainItem;

  const mainProps = validProps(resolvedMain?.properties);
  for (const p of mainProps) {
    const values = selections.mainProps[p.id] || [];
    propsPrice += (p.price || 0) * values.length;
  }

  if (item.type === 'set' && item.set_extra_groups) {
    for (const group of item.set_extra_groups) {
      const ex = selections.extras[group.id];
      for (const optId of pickedOptionIds(group, ex)) {
        const optItem = group.options.find((o) => o.item.id === optId)?.item;
        if (!optItem) continue;

        const extraProps = validProps(optItem.properties);
        for (const p of extraProps) {
          const values = ex?.props?.[p.id] || [];
          propsPrice += (p.price || 0) * values.length;
        }
      }
    }
  }

  return basePrice + propsPrice;
}

/**
 * Доплаты за соусы / напитки / топпинги. В BuilderResult.price они НЕ входят:
 * кассa прибавляет цены options к сумме сама, иначе будет двойной учёт.
 * Эта сумма нужна только для показа итога в окне выбора.
 */
function computeAddonExtra(item: MenuItem, selections: Selections): number {
  const mainItem = item.type === 'set' ? item.set_main : item;
  const resolvedMain =
    mainItem?.dish_kind === 'group' && selections.variantId
      ? mainItem.variants?.find((x) => x.id === selections.variantId)
      : mainItem;

  let sum = 0;
  for (const id of selections.mainSauceIds) {
    const sauce =
      resolvedMain?.allowed_sauces?.find((x) => x.id === id) ??
      mainItem?.allowed_sauces?.find((x) => x.id === id);
    sum += sauce?.extra_price ?? 0;
  }
  const pool = [
    ...(resolvedMain?.allowed_drinks ?? []),
    ...(resolvedMain?.allowed_toppings ?? []),
  ];
  for (const id of selections.mainAddonIds) {
    sum += pool.find((x) => x.id === id)?.extra_price ?? 0;
  }
  return sum;
}

function buildPropertyOptionName(p: HydratedProperty, value: string): string {
  if (p.options.length > 0 && value !== '') {
    return `${p.name}: ${value}`;
  }
  return p.name;
}

function buildResult(item: MenuItem, selections: Selections): BuilderResult {
  const options: CartItemOption[] = [];
  let variantName = '';

  const mainItem = item.type === 'set' ? item.set_main : item;

  if (mainItem?.dish_kind === 'group' && selections.variantId) {
    const v = mainItem.variants?.find((x) => x.id === selections.variantId);
    if (v) {
      variantName = v.name;
      options.push({ type: 'variant', name: v.name, price: 0, quantity: 1 });
    }
  }

  const resolvedMain =
    mainItem?.dish_kind === 'group' && selections.variantId
      ? mainItem.variants?.find((x) => x.id === selections.variantId)
      : mainItem;

  const mainProps = validProps(resolvedMain?.properties);
  for (const p of mainProps) {
    const values = selections.mainProps[p.id] || [];
    for (const value of values) {
      options.push({
        type: 'property',
        name: buildPropertyOptionName(p, value),
        price: p.price || 0,
        quantity: 1,
      });
    }
  }

  for (const sauceId of selections.mainSauceIds) {
    const s =
      resolvedMain?.allowed_sauces?.find((x) => x.id === sauceId) ??
      mainItem?.allowed_sauces?.find((x) => x.id === sauceId);
    if (s) {
      options.push({
        type: 'sauce',
        name: s.name,
        price: s.extra_price ?? 0,
        quantity: 1,
      });
    }
  }

  for (const id of selections.mainAddonIds) {
    const drink = resolvedMain?.allowed_drinks?.find((x) => x.id === id);
    if (drink) {
      options.push({
        type: 'drink',
        name: drink.name,
        price: drink.extra_price ?? 0,
        quantity: 1,
      });
      continue;
    }
    const topping = resolvedMain?.allowed_toppings?.find((x) => x.id === id);
    if (topping) {
      options.push({
        type: 'topping',
        name: topping.name,
        price: topping.extra_price ?? 0,
        quantity: 1,
      });
    }
  }

  if (item.type === 'set' && item.set_extra_groups) {
    for (const group of item.set_extra_groups) {
      const ex = selections.extras[group.id];
      for (const optId of pickedOptionIds(group, ex)) {
        const optItem = group.options.find((o) => o.item.id === optId)?.item;
        if (!optItem) continue;

        options.push({
          type: 'extra',
          name: `${group.label}: ${optItem.name}`,
          price: 0,
          quantity: 1,
        });

        const extraProps = validProps(optItem.properties);
        for (const p of extraProps) {
          const values = ex?.props?.[p.id] || [];
          for (const value of values) {
            options.push({
              type: 'property',
              name: `${optItem.name}: ${buildPropertyOptionName(p, value)}`,
              price: p.price || 0,
              quantity: 1,
            });
          }
        }

        for (const sauceId of ex?.sauceIds || []) {
          const sc = optItem.allowed_sauces?.find((x) => x.id === sauceId);
          if (sc) {
            options.push({
              type: 'sauce',
              name: `${optItem.name}: ${sc.name}`,
              price: 0,
              quantity: 1,
            });
          }
        }
      }
    }
  }

  return {
    variant: variantName,
    price: computePrice(item, selections),
    options,
  };
}

// ============================================================
// Компонент
// ============================================================
// ============================================================
// Восстановление выбора из опций, которые уже лежат в корзине
// (имена строятся так же, как в buildResult)
// ============================================================
function restoreSelections(
  item: MenuItem,
  options: CartItemOption[],
  initialVariantId?: string
): Selections {
  const has = (type: CartItemOption['type'], name: string) =>
    options.some((o) => o.type === type && o.name === name);

  const sel: Selections = {
    variantId: initialVariantId ?? null,
    mainSauceIds: [],
    mainAddonIds: [],
    mainProps: {},
    extras: {},
  };

  const mainItem = item.type === 'set' ? item.set_main : item;
  if (!mainItem) return sel;

  if (!sel.variantId && mainItem.dish_kind === 'group') {
    sel.variantId =
      mainItem.variants?.find((v) => has('variant', v.name))?.id ?? null;
  }

  const resolvedMain =
    mainItem.dish_kind === 'group' && sel.variantId
      ? mainItem.variants?.find((x) => x.id === sel.variantId)
      : mainItem;

  for (const p of validProps(resolvedMain?.properties)) {
    const picked = p.options.filter((opt) =>
      has('property', buildPropertyOptionName(p, opt))
    );
    if (picked.length > 0) sel.mainProps[p.id] = picked;
  }

  const saucePool = [
    ...(resolvedMain?.allowed_sauces ?? []),
    ...(mainItem.allowed_sauces ?? []),
  ];
  sel.mainSauceIds = Array.from(
    new Set(saucePool.filter((x) => has('sauce', x.name)).map((x) => x.id))
  );

  const drinkPool = [
    ...(resolvedMain?.allowed_drinks ?? []),
    ...(mainItem.allowed_drinks ?? []),
  ];
  const toppingPool = [
    ...(resolvedMain?.allowed_toppings ?? []),
    ...(mainItem.allowed_toppings ?? []),
  ];
  sel.mainAddonIds = Array.from(
    new Set([
      ...drinkPool.filter((x) => has('drink', x.name)).map((x) => x.id),
      ...toppingPool.filter((x) => has('topping', x.name)).map((x) => x.id),
    ])
  );

  if (item.type === 'set' && item.set_extra_groups) {
    for (const group of item.set_extra_groups) {
      const picked = group.options.filter((o) =>
        has('extra', `${group.label}: ${o.item.name}`)
      );
      if (picked.length === 0) continue;

      const ex: ExtraSel = {
        optionId: picked[0].item.id,
        optionIds: picked.map((o) => o.item.id),
        sauceIds: [],
        props: {},
      };

      for (const { item: optItem } of picked) {
        for (const p of validProps(optItem.properties)) {
          const vals = p.options.filter((v) =>
            has('property', `${optItem.name}: ${buildPropertyOptionName(p, v)}`)
          );
          if (vals.length > 0) ex.props[p.id] = vals;
        }
        ex.sauceIds.push(
          ...(optItem.allowed_sauces ?? [])
            .filter((x) => has('sauce', `${optItem.name}: ${x.name}`))
            .map((x) => x.id)
        );
      }

      sel.extras[group.id] = ex;
    }
  }

  return sel;
}

export function ProductBuilderDialog({
  open,
  item: rawItem,
  initialVariantId,
  initialOptions,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  item: MenuItem | null;
  initialVariantId?: string;
  /** Уже выбранные опции (редактирование позиции из корзины) */
  initialOptions?: CartItemOption[];
  /** Подпись кнопки подтверждения (по умолчанию «Добавить») */
  confirmLabel?: string;
  onConfirm: (r: BuilderResult) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();

  const item = useMemo(() => normalizeMenuItem(rawItem), [rawItem]);

  const [liveMenu, setLiveMenu] = useState<MenuItem[]>([]);
  useEffect(() => subscribeMenu((m) => setLiveMenu(m.items)), []);
  const liveById = useMemo(() => {
    const map = new Map<string, MenuItem>();
    const walk = (it: MenuItem) => {
      map.set(it.id, it);
      it.variants?.forEach(walk);
    };
    liveMenu.forEach(walk);
    return map;
  }, [liveMenu]);
  const imageOf = (id: string, own: string | null | undefined): string | null =>
    liveById.get(id)?.image_url || own || null;
  const colorOf = (id: string, own: string | null | undefined): string | null =>
    liveById.get(id)?.color ?? own ?? null;

  const [stepIndex, setStepIndex] = useState(0);
  const [selections, setSelections] = useState<Selections>({
    variantId: null,
    mainSauceIds: [],
    mainAddonIds: [],
    mainProps: {},
    extras: {},
  });
  const [error, setError] = useState<string | null>(null);

  // Закрытие по фону только двойным кликом: второй клик должен прийти
  // в течение DOUBLE_CLICK_MS после первого (как двойной клик в Windows)
  const DOUBLE_CLICK_MS = 500;
  const lastBackdropClick = useRef(0);
  useEffect(() => {
    lastBackdropClick.current = 0;
  }, [open]);
  const handleBackdropClick = () => {
    const now = Date.now();
    if (now - lastBackdropClick.current <= DOUBLE_CLICK_MS) {
      lastBackdropClick.current = 0;
      onCancel();
    } else {
      lastBackdropClick.current = now;
    }
  };

  const itemId = item?.id;

  useEffect(() => {
    if (!open || !itemId || !item) return;
    setError(null);

    const initSel: Selections = {
      variantId: initialVariantId ?? null,
      mainSauceIds: [],
      mainAddonIds: [],
      mainProps: {},
      extras: {},
    };

    if (item.type === 'set' && item.set_extra_groups) {
      for (const group of item.set_extra_groups) {
        if (group.options.length === 1) {
          initSel.extras[group.id] = {
            optionId: group.options[0].item.id,
            sauceIds: [],
            props: {},
          };
        }
      }
    }

    if (initialOptions && initialOptions.length > 0) {
      const restored = restoreSelections(item, initialOptions, initialVariantId);
      initSel.variantId = restored.variantId;
      initSel.mainSauceIds = restored.mainSauceIds;
      initSel.mainAddonIds = restored.mainAddonIds;
      initSel.mainProps = restored.mainProps;
      initSel.extras = { ...initSel.extras, ...restored.extras };
    }

    setSelections(initSel);
    setStepIndex(0);
  }, [open, itemId, initialVariantId, initialOptions, item]);

  const steps = useMemo(
    () => (item ? computeSteps(item, selections, initialVariantId) : []),
    [item, selections, initialVariantId]
  );

  useEffect(() => {
    if (stepIndex > steps.length - 1) {
      setStepIndex(Math.max(0, steps.length - 1));
    }
  }, [steps.length, stepIndex]);

  const doFinish = useCallback(
    (sel: Selections) => {
      if (!item) return;

      // Свойства необязательные: проверки нет
      setError(null);
      onConfirm(buildResult(item, sel));
    },
    [item, onConfirm]
  );

  const goNext = () => {
    const current = steps[stepIndex];
    if (!current) {
      doFinish(selections);
      return;
    }

    if (current.kind === 'variant' && !selections.variantId) {
      setError(t('requiredChoice'));
      return;
    }

    if (current.kind === 'sauce') {
      const val =
        current.ctx === 'main'
          ? selections.mainSauceIds
          : selections.extras[(current.ctx as { extra: string }).extra]
              ?.sauceIds ?? [];
      if (val.length === 0) {
        setError(t('requiredChoice'));
        return;
      }
    }

    if (current.kind === 'extra-option') {
      const ex = selections.extras[current.group.id];
      if (current.group.required && pickedOptionIds(current.group, ex).length === 0) {
        setError(t('requiredChoice'));
        return;
      }
    }

    setError(null);
    if (stepIndex >= steps.length - 1) {
      doFinish(selections);
    } else {
      setStepIndex(stepIndex + 1);
    }
  };

  const selectVariant = (v: MenuItem) => {
    if (!item) return;
    const nextSel: Selections = {
      ...selections,
      variantId: v.id,
      mainSauceIds: [],
      mainAddonIds: [],
      mainProps: {},
    };
    setSelections(nextSel);
    setError(null);
    const nextSteps = computeSteps(item, nextSel, initialVariantId);
    if (stepIndex < nextSteps.length - 1) setStepIndex(stepIndex + 1);
  };

  /** Текущее блюдо (вариант) для лимитов соусов / напитков / топпингов. */
  const mainLimit = (kind: 'sauce' | 'drink' | 'topping'): number => {
    const m = item ? (item.type === 'set' ? item.set_main : item) : undefined;
    const r =
      m?.dish_kind === 'group' && selections.variantId
        ? m.variants?.find((x) => x.id === selections.variantId)
        : m;
    const list =
      kind === 'sauce'
        ? r?.allowed_sauces
        : kind === 'drink'
        ? r?.allowed_drinks
        : r?.allowed_toppings;
    return Math.min(addonLimit(r, kind), Math.max(1, list?.length ?? 1));
  };

  const toggleMainSauce = (sauceId: string) => {
    setSelections((s) => {
      const cur = s.mainSauceIds || [];
      if (cur.includes(sauceId)) {
        return { ...s, mainSauceIds: cur.filter((id) => id !== sauceId) };
      }
      if (cur.length >= mainLimit('sauce')) return s;
      return { ...s, mainSauceIds: [...cur, sauceId] };
    });
  };

  const toggleMainAddon = (id: string, kind: 'drink' | 'topping') => {
    const m = item ? (item.type === 'set' ? item.set_main : item) : undefined;
    const r =
      m?.dish_kind === 'group' && selections.variantId
        ? m.variants?.find((x) => x.id === selections.variantId)
        : m;
    const ofKind = new Set(
      ((kind === 'drink' ? r?.allowed_drinks : r?.allowed_toppings) ?? []).map((a) => a.id)
    );
    setSelections((s) => {
      if (s.mainAddonIds.includes(id)) {
        return { ...s, mainAddonIds: s.mainAddonIds.filter((x) => x !== id) };
      }
      const used = s.mainAddonIds.filter((x) => ofKind.has(x)).length;
      if (used >= mainLimit(kind)) return s;
      return { ...s, mainAddonIds: [...s.mainAddonIds, id] };
    });
    setError(null);
  };

  const toggleExtraSauce = (groupId: string, sauceId: string) => {
    setSelections((s) => {
      const ex = s.extras[groupId] ?? { optionId: null, sauceIds: [], props: {} };
      const cur = ex.sauceIds || [];
      let nextIds: string[];

      if (cur.includes(sauceId)) {
        nextIds = cur.filter((id) => id !== sauceId);
      } else {
        if (cur.length >= 2) return s;
        nextIds = [...cur, sauceId];
      }

      return {
        ...s,
        extras: {
          ...s.extras,
          [groupId]: { ...ex, sauceIds: nextIds },
        },
      };
    });
  };

  const selectExtraOption = (groupId: string, optionId: string) => {
    if (!item) return;
    const nextSel: Selections = {
      ...selections,
      extras: {
        ...selections.extras,
        [groupId]: { optionId, optionIds: [optionId], sauceIds: [], props: {} },
      },
    };
    setSelections(nextSel);
    setError(null);
    // Шагов может стать больше (у напитка могут быть соусы), поэтому
    // считаем их заново, а не берём старый steps
    const nextSteps = computeSteps(item, nextSel, initialVariantId);
    if (stepIndex < nextSteps.length - 1) setStepIndex(stepIndex + 1);
    else doFinish(nextSel); // последний шаг: сразу добавляем в корзину
  };

  /** Группа с выбором нескольких вариантов: нажатие включает/выключает вариант. */
  const toggleExtraOption = (group: HydratedSetExtraGroup, optionId: string) => {
    const limit = pickLimit(group);
    setSelections((s) => {
      const ex = s.extras[group.id];
      const cur = pickedOptionIds(group, ex);
      let next: string[];
      if (cur.includes(optionId)) {
        next = cur.filter((id) => id !== optionId);
      } else {
        if (cur.length >= limit) return s;
        next = [...cur, optionId];
      }
      return {
        ...s,
        extras: {
          ...s.extras,
          [group.id]: {
            optionId: next[0] ?? null,
            optionIds: next,
            sauceIds: [],
            props: ex?.props ?? {},
          },
        },
      };
    });
    setError(null);
  };

  const skipExtraOption = (groupId: string) => {
    if (!item) return;
    const nextSel: Selections = {
      ...selections,
      extras: {
        ...selections.extras,
        [groupId]: { optionId: null, optionIds: [], sauceIds: [], props: {} },
      },
    };
    setSelections(nextSel);
    setError(null);
    const nextSteps = computeSteps(item, nextSel, initialVariantId);
    if (stepIndex < nextSteps.length - 1) setStepIndex(stepIndex + 1);
    else doFinish(nextSel);
  };

  const toggleProperty = (
    ctx: Ctx,
    pid: string,
    opt: string,
    required: boolean
  ) => {
    setSelections((s) => {
      if (ctx === 'main') {
        const cur = s.mainProps[pid] || [];
        let next: string[];
        if (required) {
          next = cur.includes(opt) ? [] : [opt];
        } else {
          next = cur.includes(opt) ? cur.filter((v) => v !== opt) : [...cur, opt];
        }
        return { ...s, mainProps: { ...s.mainProps, [pid]: next } };
      } else {
        const groupId = ctx.extra;
        const ex = s.extras[groupId] ?? { optionId: null, sauceIds: [], props: {} };
        const cur = ex.props[pid] || [];
        let next: string[];
        if (required) {
          next = cur.includes(opt) ? [] : [opt];
        } else {
          next = cur.includes(opt) ? cur.filter((v) => v !== opt) : [...cur, opt];
        }
        return {
          ...s,
          extras: {
            ...s.extras,
            [groupId]: { ...ex, props: { ...ex.props, [pid]: next } },
          },
        };
      }
    });
    setError(null);
  };

  const back = () => {
    setError(null);
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
    else onCancel();
  };

  if (!open || !item) return null;

  const currentStep: Step | undefined = steps[stepIndex];
  const currentPrice =
    computePrice(item, selections) + computeAddonExtra(item, selections);

  const stepLabel = (() => {
    if (!currentStep) return '';
    if (currentStep.kind === 'variant') return t('chooseVariant');
    if (currentStep.kind === 'sauce') return t('chooseSauceStep');
    if (currentStep.kind === 'addon') {
      return t(currentStep.addon === 'drink' ? 'sectionDrinks' : 'sectionToppings');
    }
    return currentStep.group.label || t('chooseExtra');
  })();

  const mainItem = item.type === 'set' ? item.set_main : item;
  const selectedVariant = mainItem?.variants?.find(
    (x) => x.id === selections.variantId
  );
  const selectedVariantName = selectedVariant?.name;

  const resolvedMain =
    mainItem?.dish_kind === 'group' && selections.variantId
      ? mainItem.variants?.find((x) => x.id === selections.variantId)
      : mainItem;

  const mainProps = validProps(resolvedMain?.properties);

  const extraPropsToRender: { groupId: string; itemName: string; props: HydratedProperty[] }[] = [];
  if (item.type === 'set' && item.set_extra_groups) {
    for (const group of item.set_extra_groups) {
      const ex = selections.extras[group.id];
      for (const optId of pickedOptionIds(group, ex)) {
        const optItem = group.options.find((o) => o.item.id === optId)?.item;
        if (!optItem) continue;
        const props = validProps(optItem.properties);
        if (props.length > 0) {
          extraPropsToRender.push({ groupId: group.id, itemName: optItem.name, props });
        }
      }
    }
  }

  const hasProps = mainProps.length > 0 || extraPropsToRender.length > 0;
  // Свойства показываем только на шаге соусов. Если соусов в заказе нет вообще,
  // панель остаётся видимой, иначе свойства нельзя было бы выбрать.
  const showProps =
    hasProps &&
    (currentStep?.kind === 'sauce' || !steps.some((st) => st.kind === 'sauce'));

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={handleBackdropClick}>
      <div
        className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-5xl h-[85vh] max-h-[90dvh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-4 border-b border-gray-200 shrink-0 bg-slate-50">
          <div className="min-w-0">
            <div className="text-[0.625rem] font-bold text-orange-600 uppercase tracking-wider">
              {stepLabel}
              {steps.length > 0 && ` · ${stepIndex + 1}/${steps.length}`}
            </div>
            <h3 className="text-xl font-black text-gray-900 flex items-center gap-2 min-w-0">
              <span className="truncate">{item.name}</span>
              {selectedVariantName && (
                <span className="text-xs font-black text-orange-600 bg-orange-100 px-2 py-1 rounded-md shrink-0 border border-orange-200">
                  {selectedVariantName}
                </span>
              )}
            </h3>
          </div>
          {/* «Назад» по центру шапки (на первом шаге не нужна) */}
          <div className="flex justify-center">
            {stepIndex > 0 && (
              <button
                onClick={back}
                className="h-11 px-5 flex items-center justify-center gap-1.5 rounded-xl bg-white border-2 border-gray-300 hover:bg-gray-100 active:scale-95 text-gray-800 text-sm font-black transition-all"
              >
                <ChevronLeft className="w-5 h-5" strokeWidth={3} />
                {t('back')}
              </button>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={onCancel}
              aria-label={t('close')}
              className="w-11 h-11 rounded-xl bg-red-500 hover:bg-red-600 active:scale-95 text-white flex items-center justify-center shadow-md shadow-red-500/30 transition-all shrink-0"
            >
              <X className="w-6 h-6" strokeWidth={3} />
            </button>
          </div>
        </div>

        {steps.length > 0 && (
          <div className="h-1 bg-gray-100 shrink-0">
            <div className="h-full bg-gradient-to-r from-orange-500 to-red-500 transition-all" style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
          </div>
        )}

        {/* Body: Две колонки */}
        <div className="flex-1 min-h-0 flex overflow-hidden">

          {/* ЛЕВАЯ КОЛОНКА: Шаги (Варианты, Соусы, Допы) */}
          <div className="flex-1 flex flex-col min-w-0 bg-white relative">
            <div className="flex-1 min-h-0 overflow-y-auto p-5">

              {/* Варианты: квадратные плитки с фото */}
              {currentStep?.kind === 'variant' && (
                <div className="flex flex-col h-full">
                  <FitGrid
                    count={currentStep.variants.length}
                    labelH={52}
                    render={(i, size) => {
                      const v = currentStep.variants[i];
                      const selected = selections.variantId === v.id;
                      // своё фото варианта, иначе фото самого блюда
                      const vImg =
                        imageOf(v.id, v.image_url) ??
                        (mainItem ? imageOf(mainItem.id, mainItem.image_url) : null);
                      const vColor = colorOf(v.id, v.color);
                      const fontSize = Math.max(11, Math.min(19, size * 0.12));
                      const checkSize = Math.max(14, size * 0.14);

                      return (
                        <button
                          key={v.id}
                          onClick={() => selectVariant(v)}
                          style={{ width: size }}
                          className={`flex flex-col items-center gap-1 p-1 rounded-xl transition-all active:scale-[0.97] ${
                            selected
                              ? `bg-orange-50 ${size > 110 ? 'ring-4' : 'ring-2'} ring-orange-400`
                              : 'bg-white hover:bg-gray-50'
                          }`}
                        >
                          <div
                            className="relative rounded-lg overflow-hidden w-full aspect-square"
                            style={{ borderWidth: 2, borderStyle: 'solid', borderColor: selected ? '#f97316' : vColor ?? '#e5e7eb', background: '#fff' }}
                          >
                            {vImg ? (
                              <img src={vImg} alt={v.name} className="absolute inset-0 w-full h-full object-cover" />
                            ) : (
                              <div
                                className="absolute inset-0 flex items-center justify-center font-black text-gray-500"
                                style={{ backgroundColor: vColor ? `${vColor}40` : '#e5e7eb', fontSize: size * 0.3 }}
                              >
                                {v.name.trim().charAt(0).toUpperCase()}
                              </div>
                            )}
                            {selected && (
                              <div
                                className="absolute top-1 right-1 rounded-full bg-orange-500 text-white flex items-center justify-center shadow-sm"
                                style={{ width: checkSize, height: checkSize }}
                              >
                                <Check style={{ width: checkSize * 0.65, height: checkSize * 0.65 }} />
                              </div>
                            )}
                          </div>
                          <span
                            className="font-black text-gray-900 truncate w-full text-center leading-tight"
                            style={{ fontSize }}
                          >
                            {v.name}
                          </span>
                          {!v.free && (
                            <span
                              className="font-black text-orange-600 leading-none"
                              style={{ fontSize: Math.max(11, fontSize * 0.9) }}
                            >
                              {formatYen(v.price)}
                            </span>
                          )}
                        </button>
                      );
                    }}
                  />
                </div>
              )}

              {/* Напитки / топпинги (необязательно) */}
              {currentStep?.kind === 'addon' && (
                <div className="flex flex-col h-full gap-4">
                  <div className="flex items-center justify-between text-sm font-bold text-gray-500 shrink-0">
                    <span>
                      {t(currentStep.addon === 'drink' ? 'sectionDrinks' : 'sectionToppings')}
                    </span>
                    {Number.isFinite(mainLimit(currentStep.addon)) && (
                      <span className="text-orange-600 bg-orange-50 px-2 py-1 rounded-md">
                        {t('pickUpTo')} {mainLimit(currentStep.addon)} ·{' '}
                        {currentStep.items.filter((x) => selections.mainAddonIds.includes(x.id)).length}/
                        {mainLimit(currentStep.addon)}
                      </span>
                    )}
                  </div>

                  <FitGrid
                    count={currentStep.items.length}
                    labelH={34}
                    render={(i, size) => {
                      const a = currentStep.items[i];
                      const selected = selections.mainAddonIds.includes(a.id);
                      const aMaxed =
                        !selected &&
                        currentStep.items.filter((x) => selections.mainAddonIds.includes(x.id)).length >=
                          mainLimit(currentStep.addon);
                      const aImg = imageOf(a.id, a.image_url);
                      const aColor = colorOf(a.id, a.color);
                      const fontSize = Math.max(9, Math.min(17, size * 0.13));
                      const checkSize = Math.max(12, size * 0.16);

                      return (
                        <button
                          key={a.id}
                          onClick={() => toggleMainAddon(a.id, currentStep.addon)}
                          disabled={aMaxed}
                          style={{ width: size }}
                          className={`flex flex-col items-center gap-1 p-1 rounded-xl transition-all active:scale-[0.97] ${
                            selected
                              ? `bg-orange-50 ${size > 110 ? 'ring-4' : 'ring-2'} ring-orange-300`
                              : aMaxed
                              ? 'opacity-40 cursor-not-allowed bg-gray-50'
                              : 'bg-white hover:bg-gray-50'
                          }`}
                        >
                          <div
                            className="relative rounded-lg overflow-hidden w-full aspect-square"
                            style={{ borderWidth: 2, borderStyle: 'solid', borderColor: aColor ?? '#e5e7eb', background: '#fff' }}
                          >
                            {aImg ? (
                              <img src={aImg} alt={a.name} className="absolute inset-0 w-full h-full object-cover" />
                            ) : (
                              <div className="absolute inset-0" style={{ backgroundColor: aColor ?? '#e5e7eb', opacity: 0.25 }} />
                            )}
                            {a.extra_price ? (
                              <div
                                className="absolute bottom-0.5 left-0.5 right-0.5 rounded bg-orange-500/90 text-white text-center font-black leading-tight"
                                style={{ fontSize: Math.max(9, fontSize * 0.8) }}
                              >
                                +{formatYen(a.extra_price)}
                              </div>
                            ) : null}
                            {selected && (
                              <div
                                className="absolute top-0.5 right-0.5 rounded-full bg-orange-500 text-white flex items-center justify-center shadow-sm"
                                style={{ width: checkSize, height: checkSize }}
                              >
                                <Check style={{ width: checkSize * 0.65, height: checkSize * 0.65 }} />
                              </div>
                            )}
                          </div>
                          <span
                            className="font-black text-gray-900 truncate w-full text-center leading-tight"
                            style={{ fontSize }}
                          >
                            {a.name}
                          </span>
                        </button>
                      );
                    }}
                  />
                </div>
              )}

              {/* Соусы (авто-подбор размера под контейнер) */}
              {currentStep?.kind === 'sauce' && (
                <div className="flex flex-col h-full gap-4">
                  <div className="flex items-center justify-between text-sm font-bold text-gray-500 shrink-0">
                    <span>{t('chooseSauce')}</span>
                    <span className="text-orange-600 bg-orange-50 px-2 py-1 rounded-md">
                      {currentStep.ctx === 'main'
                        ? `${t('pickUpTo')} ${mainLimit('sauce')}`
                        : t('maxTwo')}
                    </span>
                  </div>

                  <FitGrid
                    count={currentStep.sauces.length}
                    labelH={34}
                    render={(i, size) => {
                      const s = currentStep.sauces[i];
                      const isExtra = currentStep.ctx !== 'main';
                      const groupId = isExtra ? (currentStep.ctx as { extra: string }).extra : null;
                      const selectedIds = isExtra
                        ? selections.extras[groupId!]?.sauceIds || []
                        : selections.mainSauceIds;
                      const selected = selectedIds.includes(s.id);
                      const isMaxed = selectedIds.length >= (isExtra ? 2 : mainLimit('sauce')) && !selected;

                      const sImg = imageOf(s.id, s.image_url);
                      const sColor = colorOf(s.id, s.color);
                      const fontSize = Math.max(9, Math.min(17, size * 0.13));
                      const checkSize = Math.max(12, size * 0.16);

                      return (
                        <button
                          key={s.id}
                          onClick={() => (isExtra ? toggleExtraSauce(groupId!, s.id) : toggleMainSauce(s.id))}
                          disabled={isMaxed}
                          style={{ width: size }}
                          className={`flex flex-col items-center gap-1 p-1 rounded-xl transition-all active:scale-[0.97] ${
                            selected
                              ? `bg-orange-50 ${size > 110 ? 'ring-4' : 'ring-2'} ring-orange-300`
                              : isMaxed
                              ? 'opacity-40 cursor-not-allowed bg-gray-50'
                              : 'bg-white hover:bg-gray-50'
                          }`}
                        >
                          <div
                            className="relative rounded-lg overflow-hidden w-full aspect-square"
                            style={{ borderWidth: 2, borderStyle: 'solid', borderColor: sColor ?? '#e5e7eb', background: '#fff' }}
                          >
                            {sImg ? (
                              <img src={sImg} alt={s.name} className="absolute inset-0 w-full h-full object-cover" />
                            ) : (
                              <div className="absolute inset-0" style={{ backgroundColor: sColor ?? '#e5e7eb', opacity: 0.25 }} />
                            )}
                            {s.extra_price ? (
                              <div
                                className="absolute bottom-0.5 left-0.5 right-0.5 rounded bg-orange-500/90 text-white text-center font-black leading-tight"
                                style={{ fontSize: Math.max(9, fontSize * 0.8) }}
                              >
                                +{formatYen(s.extra_price)}
                              </div>
                            ) : null}
                            {selected && (
                              <div
                                className="absolute top-0.5 right-0.5 rounded-full bg-orange-500 text-white flex items-center justify-center shadow-sm"
                                style={{ width: checkSize, height: checkSize }}
                              >
                                <Check style={{ width: checkSize * 0.65, height: checkSize * 0.65 }} />
                              </div>
                            )}
                          </div>
                          <span
                            className="font-black text-gray-900 truncate w-full text-center leading-tight"
                            style={{ fontSize }}
                          >
                            {s.name}
                          </span>
                        </button>
                      );
                    }}
                  />
                </div>
              )}

              {/* Дополнительные опции (Extras, авто-подбор размера) */}
              {currentStep?.kind === 'extra-option' && (
                <div className="flex flex-col h-full gap-3">
                  <div className="text-sm font-bold text-gray-500 shrink-0">
                    {currentStep.group.label || t('chooseExtra')}
                    {currentStep.group.required && <span className="text-red-500 ml-1">*</span>}
                    {pickLimit(currentStep.group) > 1 && (
                      <span className="ml-2 text-orange-600">
                        {t('pickUpTo')} {pickLimit(currentStep.group)} ·{' '}
                        {pickedOptionIds(currentStep.group, selections.extras[currentStep.group.id]).length}/
                        {pickLimit(currentStep.group)}
                      </span>
                    )}
                  </div>

                  <FitGrid
                    count={currentStep.group.options.length}
                    labelH={54}
                    render={(i, size) => {
                      const o = currentStep.group.options[i];
                      const it = o.item;
                      const selected = pickedOptionIds(currentStep.group, selections.extras[currentStep.group.id]).includes(it.id);
                      const itImg = imageOf(it.id, it.image_url);
                      const itColor = colorOf(it.id, it.color);
                      const itPrice = liveById.get(it.id)?.price ?? it.price;
                      const itFree = liveById.get(it.id)?.free ?? it.free;
                      const fontSize = Math.max(9, Math.min(17, size * 0.13));
                      const checkSize = Math.max(12, size * 0.16);

                      return (
                        <button
                          key={o.option_id}
                          onClick={() =>
                            pickLimit(currentStep.group) > 1
                              ? toggleExtraOption(currentStep.group, it.id)
                              : selectExtraOption(currentStep.group.id, it.id)
                          }
                          style={{ width: size }}
                          className={`flex flex-col items-center gap-1 p-1 rounded-xl transition-all active:scale-[0.97] ${
                            selected
                              ? `bg-purple-50 ${size > 110 ? 'ring-4' : 'ring-2'} ring-purple-300`
                              : 'bg-white hover:bg-gray-50'
                          }`}
                        >
                          <div
                            className="relative rounded-lg overflow-hidden w-full aspect-square"
                            style={{ borderWidth: 2, borderStyle: 'solid', borderColor: itColor ?? '#e5e7eb', background: '#fff' }}
                          >
                            {itImg ? (
                              <img src={itImg} alt={it.name} className="absolute inset-0 w-full h-full object-cover" />
                            ) : (
                              <div className="absolute inset-0 bg-gradient-to-br from-orange-400 via-orange-500 to-red-600 flex items-center justify-center">
                                <span className="font-black text-white/90 drop-shadow" style={{ fontSize: size * 0.25 }}>
                                  {it.name.slice(0, 2).toUpperCase()}
                                </span>
                              </div>
                            )}
                            {selected && (
                              <div
                                className="absolute top-0.5 right-0.5 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-sm"
                                style={{ width: checkSize, height: checkSize }}
                              >
                                <Check style={{ width: checkSize * 0.65, height: checkSize * 0.65 }} />
                              </div>
                            )}
                          </div>
                          <span className="font-black text-gray-900 truncate w-full text-center leading-tight" style={{ fontSize }}>
                            {it.name}
                          </span>
                          {!itFree && itPrice > 0 && (
                            <span className="font-bold text-orange-600 leading-none" style={{ fontSize: fontSize * 0.85 }}>
                              {formatYen(itPrice)}
                            </span>
                          )}
                        </button>
                      );
                    }}
                  />

                  {!currentStep.group.required && (
                    <div className="shrink-0 pt-2">
                      <button
                        onClick={() => skipExtraOption(currentStep.group.id)}
                        className="w-full py-2.5 text-xs text-gray-500 font-bold bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        {t('skip')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Если шагов нет (например, простое блюдо без соусов) */}
              {!currentStep && (
                <div className="flex flex-col items-center justify-center h-full text-slate-400">
                  <p className="text-sm">{t('allParamsSelected')}</p>
                </div>
              )}

            </div>

          </div>

          {/* ПРАВАЯ КОЛОНКА: свойства (только на шаге соусов) + квадратная кнопка */}
          <div className="w-[300px] shrink-0 border-l border-gray-200 bg-slate-50 flex flex-col min-h-0">
            {showProps ? (
              <>
              <div className="p-4 border-b border-gray-200 shrink-0">
                <h4 className="font-black text-sm text-gray-800 uppercase tracking-wide">{t('chooseProperties')}</h4>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {/* Свойства главного блюда */}
                {mainProps.length > 0 && (
                  <div className="space-y-4">
                    {mainProps.map((p) => {
                      const values = selections.mainProps[p.id] || [];
                      return (
                        <div key={p.id} className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                          <div className="text-sm font-bold text-gray-800 mb-2 flex items-start justify-between gap-2">
                            <span>{p.name}</span>
                            {p.price ? <span className="text-orange-600 text-[0.6875rem] bg-orange-50 px-1.5 py-0.5 rounded shrink-0">+{formatYen(p.price)}</span> : null}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {p.options.map((opt) => {
                              const isSelected = values.includes(opt);
                              return (
                                <button
                                  key={opt}
                                  onClick={() => toggleProperty('main', p.id, opt, p.required)}
                                  className={`px-3 py-1.5 rounded-lg border-2 font-bold text-xs transition-all active:scale-[0.98] ${
                                    isSelected
                                      ? 'bg-orange-500 border-orange-500 text-white shadow-sm'
                                      : 'bg-white border-gray-200 text-gray-700 hover:border-orange-300'
                                  }`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Свойства допов (если выбраны) */}
                {extraPropsToRender.map(({ groupId, itemName, props }) => (
                  <div key={`${groupId}:${itemName}`} className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="h-px bg-gray-300 flex-1"></span>
                      <span className="text-[0.6875rem] font-black text-gray-400 uppercase">{itemName}</span>
                      <span className="h-px bg-gray-300 flex-1"></span>
                    </div>
                    {props.map((p) => {
                      const ex = selections.extras[groupId];
                      const values = ex?.props[p.id] || [];
                      return (
                        <div key={p.id} className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                          <div className="text-sm font-bold text-gray-800 mb-2 flex items-start justify-between gap-2">
                            <span>{p.name}</span>
                            {p.price ? <span className="text-orange-600 text-[0.6875rem] bg-orange-50 px-1.5 py-0.5 rounded shrink-0">+{formatYen(p.price)}</span> : null}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {p.options.map((opt) => {
                              const isSelected = values.includes(opt);
                              return (
                                <button
                                  key={opt}
                                  onClick={() => toggleProperty({ extra: groupId }, p.id, opt, p.required)}
                                  className={`px-3 py-1.5 rounded-lg border-2 font-bold text-xs transition-all active:scale-[0.98] ${
                                    isSelected
                                      ? 'bg-orange-500 border-orange-500 text-white shadow-sm'
                                      : 'bg-white border-gray-200 text-gray-700 hover:border-orange-300'
                                  }`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
            ) : (
              <div className="flex-1" />
            )}

            {/* Квадратная кнопка: «Далее» или «Добавить» */}
            <div className="p-4 shrink-0 flex justify-center">
              <button
                onClick={goNext}
                className="w-36 h-36 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 text-white font-black shadow-lg shadow-orange-500/30 active:scale-95 transition-all flex flex-col items-center justify-center gap-1 p-2 text-center"
              >
                {stepIndex >= steps.length - 1 || steps.length === 0 ? (
                  <>
                    <Check className="w-9 h-9" strokeWidth={3} />
                    <span className="text-base leading-tight">
                      {confirmLabel ?? t('addToCartBtn')}
                    </span>
                  </>
                ) : (
                  <>
                    <ChevronRight className="w-9 h-9" strokeWidth={3} />
                    <span className="text-base leading-tight">{t('next')}</span>
                  </>
                )}
                {currentPrice > 0 && (
                  <span className="text-sm font-bold text-white/90 tabular-nums">
                    {formatYen(currentPrice)}
                  </span>
                )}
              </button>
            </div>
          </div>

        </div>

        {/* Ошибка */}
        {error && (
          <div className="p-3 bg-red-50 border-t border-red-200 text-red-700 text-sm font-bold text-center shrink-0">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
