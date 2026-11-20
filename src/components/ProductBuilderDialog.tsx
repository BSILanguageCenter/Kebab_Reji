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
  | { kind: 'extra-option'; group: HydratedSetExtraGroup };

interface ExtraSel {
  optionId: string | null;
  sauceIds: string[];
  props: Record<string, string[]>;
}

interface Selections {
  variantId: string | null;
  mainSauceIds: string[];
  mainProps: Record<string, string[]>;
  extras: Record<string, ExtraSel>;
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
  maxSize = 160,
  render,
}: {
  count: number;
  labelH: number; // высота подписи под иконкой (px)
  gap?: number;
  maxSize?: number;
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

    let best = { cols: count, size: 0 };
    let bestFit = { cols: 1, size: 0 }; // запасной вариант, если не влезает по высоте

    for (let c = 1; c <= count; c++) {
      const rows = Math.ceil(count / c);
      const cellW = Math.min(maxSize, Math.floor((w - gap * (c - 1)) / c));
      if (cellW <= 0) continue;
      const totalH = rows * (cellW + labelH) + gap * (rows - 1);

      if (cellW > bestFit.size) bestFit = { cols: c, size: cellW };
      if (totalH <= h && cellW > best.size) best = { cols: c, size: cellW };
    }
    // если ничего не влезло по высоте, берём самый крупный вариант (будет скролл)
    return best.size > 0 ? best : bestFit;
  }, [box, count, labelH, gap, maxSize]);

  return (
    <div ref={ref} className="flex-1 min-h-0 overflow-y-auto p-1">
      {size > 0 && (
        <div
          className="grid content-start"
          style={{
            gridTemplateColumns: `repeat(${cols}, ${size}px)`,
            gap,
            justifyContent: 'space-between', // равномерно по ширине; 'start' = прижать влево
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

  // 3. Extras сета
  if (item.type === 'set' && item.set_extra_groups) {
    for (const group of item.set_extra_groups) {
      const ex = selections.extras[group.id];

      if (!ex?.optionId && group.options.length > 1) {
        steps.push({ kind: 'extra-option', group });
        continue;
      }

      const optId =
        ex?.optionId ??
        (group.options.length === 1 ? group.options[0].item.id : null);
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
      const optId = ex?.optionId ?? (group.options.length === 1 ? group.options[0].item.id : null);
      if (!optId) continue;
      const optItem = group.options.find((o) => o.item.id === optId)?.item;
      if (!optItem) continue;

      const extraProps = validProps(optItem.properties);
      for (const p of extraProps) {
        const values = ex?.props?.[p.id] || [];
        propsPrice += (p.price || 0) * values.length;
      }
    }
  }

  return basePrice + propsPrice;
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
    const s = mainItem?.allowed_sauces?.find((x) => x.id === sauceId);
    if (s) {
      options.push({ type: 'sauce', name: s.name, price: 0, quantity: 1 });
    }
  }

  if (item.type === 'set' && item.set_extra_groups) {
    for (const group of item.set_extra_groups) {
      const ex = selections.extras[group.id];
      const optId =
        ex?.optionId ??
        (group.options.length === 1 ? group.options[0].item.id : null);
      if (!optId) continue;
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
        const s = optItem.allowed_sauces?.find((x) => x.id === sauceId);
        if (s) {
          options.push({
            type: 'sauce',
            name: `${optItem.name}: ${s.name}`,
            price: 0,
            quantity: 1,
          });
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
export function ProductBuilderDialog({
  open,
  item: rawItem,
  initialVariantId,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  item: MenuItem | null;
  initialVariantId?: string;
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
    mainProps: {},
    extras: {},
  });
  const [error, setError] = useState<string | null>(null);

  const itemId = item?.id;

  useEffect(() => {
    if (!open || !itemId || !item) return;
    setError(null);

    const initSel: Selections = {
      variantId: initialVariantId ?? null,
      mainSauceIds: [],
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

    setSelections(initSel);
    setStepIndex(0);
  }, [open, itemId, initialVariantId, item]);

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

      // Валидация обязательных свойств
      const mainItem = item.type === 'set' ? item.set_main : item;
      const resolvedMain =
        mainItem?.dish_kind === 'group' && sel.variantId
          ? mainItem.variants?.find((x) => x.id === sel.variantId)
          : mainItem;

      const mainProps = validProps(resolvedMain?.properties);
      for (const p of mainProps) {
        if (p.required && (!sel.mainProps[p.id] || sel.mainProps[p.id].length === 0)) {
          setError(`Выберите: ${p.name}`);
          return;
        }
      }

      if (item.type === 'set' && item.set_extra_groups) {
        for (const group of item.set_extra_groups) {
          const ex = sel.extras[group.id];
          const optId = ex?.optionId ?? (group.options.length === 1 ? group.options[0].item.id : null);
          if (!optId) continue;
          const optItem = group.options.find((o) => o.item.id === optId)?.item;
          if (!optItem) continue;

          const extraProps = validProps(optItem.properties);
          for (const p of extraProps) {
            if (p.required && (!ex?.props[p.id] || ex.props[p.id].length === 0)) {
              setError(`Выберите: ${p.name} (${optItem.name})`);
              return;
            }
          }
        }
      }

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
      if (current.group.required && !ex?.optionId) {
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
    setSelections(s => ({ ...s, variantId: v.id, mainSauceIds: [], mainProps: {} }));
    setError(null);
    if (stepIndex < steps.length - 1) setStepIndex(stepIndex + 1);
  };

  const toggleMainSauce = (sauceId: string) => {
    setSelections((s) => {
      const cur = s.mainSauceIds || [];
      if (cur.includes(sauceId)) {
        return { ...s, mainSauceIds: cur.filter((id) => id !== sauceId) };
      }
      if (cur.length >= 2) return s;
      return { ...s, mainSauceIds: [...cur, sauceId] };
    });
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
    setSelections(s => ({
      ...s,
      extras: {
        ...s.extras,
        [groupId]: { optionId, sauceIds: [], props: {} }
      }
    }));
    setError(null);
    if (stepIndex < steps.length - 1) setStepIndex(stepIndex + 1);
  };

  const skipExtraOption = (_groupId: string) => {
    setError(null);
    if (stepIndex < steps.length - 1) setStepIndex(stepIndex + 1);
    else doFinish(selections);
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
          next = [opt];
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
          next = [opt];
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
  const currentPrice = computePrice(item, selections);

  const stepLabel = (() => {
    if (!currentStep) return '';
    if (currentStep.kind === 'variant') return t('chooseVariant');
    if (currentStep.kind === 'sauce') return t('chooseSauceStep');
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
      const optId = ex?.optionId ?? (group.options.length === 1 ? group.options[0].item.id : null);
      if (!optId) continue;
      const optItem = group.options.find((o) => o.item.id === optId)?.item;
      if (!optItem) continue;
      const props = validProps(optItem.properties);
      if (props.length > 0) {
        extraPropsToRender.push({ groupId: group.id, itemName: optItem.name, props });
      }
    }
  }

  const hasProps = mainProps.length > 0 || extraPropsToRender.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-5xl h-[85vh] max-h-[90dvh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-200 shrink-0 bg-slate-50">
          <div className="flex-1 min-w-0">
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
          <button
            onClick={onCancel}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-200 transition-colors shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
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

              {/* Варианты */}
              {currentStep?.kind === 'variant' && (
                <div className="grid grid-cols-2 gap-3">
                  {currentStep.variants.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => selectVariant(v)}
                      className={`p-4 rounded-xl border-2 text-left transition-all active:scale-[0.98] ${
                        selections.variantId === v.id
                          ? 'bg-orange-500 border-orange-500 text-white shadow-md'
                          : 'bg-white border-gray-200 hover:border-orange-300'
                      }`}
                    >
                      <div className="text-base font-black">{v.name}</div>
                      <div className={`text-sm font-bold ${selections.variantId === v.id ? 'text-white/90' : 'text-orange-600'}`}>
                        {v.free ? '' : formatYen(v.price)}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Соусы (авто-подбор размера под контейнер) */}
              {currentStep?.kind === 'sauce' && (
                <div className="flex flex-col h-full gap-4">
                  <div className="flex items-center justify-between text-sm font-bold text-gray-500 shrink-0">
                    <span>{t('chooseSauce')}</span>
                    <span className="text-orange-600 bg-orange-50 px-2 py-1 rounded-md">Максимум 2</span>
                  </div>

                  <FitGrid
                    count={currentStep.sauces.length}
                    labelH={28}
                    render={(i, size) => {
                      const s = currentStep.sauces[i];
                      const isExtra = currentStep.ctx !== 'main';
                      const groupId = isExtra ? (currentStep.ctx as { extra: string }).extra : null;
                      const selectedIds = isExtra
                        ? selections.extras[groupId!]?.sauceIds || []
                        : selections.mainSauceIds;
                      const selected = selectedIds.includes(s.id);
                      const isMaxed = selectedIds.length >= 2 && !selected;

                      const sImg = imageOf(s.id, s.image_url);
                      const sColor = colorOf(s.id, s.color);
                      const fontSize = Math.max(9, Math.min(14, size * 0.13));
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
                  </div>

                  <FitGrid
                    count={currentStep.group.options.length}
                    labelH={42}
                    render={(i, size) => {
                      const o = currentStep.group.options[i];
                      const it = o.item;
                      const selected = selections.extras[currentStep.group.id]?.optionId === it.id;
                      const itImg = imageOf(it.id, it.image_url);
                      const itColor = colorOf(it.id, it.color);
                      const itPrice = liveById.get(it.id)?.price ?? it.price;
                      const itFree = liveById.get(it.id)?.free ?? it.free;
                      const fontSize = Math.max(9, Math.min(14, size * 0.13));
                      const checkSize = Math.max(12, size * 0.16);

                      return (
                        <button
                          key={o.option_id}
                          onClick={() => selectExtraOption(currentStep.group.id, it.id)}
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
                  <p className="text-sm">Все параметры выбраны</p>
                </div>
              )}

            </div>

            {/* Кнопки (Внизу левой колонки) */}
            <div className="p-3 border-t border-gray-200 bg-slate-50 flex gap-2 shrink-0">
              <button onClick={back} className="flex items-center justify-center gap-1 px-4 py-3 rounded-xl bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-sm font-bold transition-colors">
                <ChevronLeft className="w-4 h-4" />
                {stepIndex === 0 ? t('cancel') : t('back')}
              </button>

              <button onClick={goNext} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white text-sm font-bold transition-all active:scale-[0.98] shadow-md shadow-orange-500/30 flex items-center justify-center gap-1">
                {stepIndex >= steps.length - 1 || steps.length === 0 ? (
                  <>
                    {t('addToCartBtn')} · {currentPrice > 0 ? formatYen(currentPrice) : ''}
                  </>
                ) : (
                  <>
                    {t('next')}
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* ПРАВАЯ КОЛОНКА: Свойства */}
          {hasProps && (
            <div className="w-[340px] shrink-0 border-l border-gray-200 bg-slate-50 flex flex-col min-h-0">
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
                            <span>{p.name} {p.required && <span className="text-red-500">*</span>}</span>
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
                  <div key={groupId} className="space-y-4">
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
                            <span>{p.name} {p.required && <span className="text-red-500">*</span>}</span>
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
            </div>
          )}

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
