import { useEffect, useMemo, useState, useCallback } from 'react';
import { X, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n, type TranslationKey } from '@/locale';
import { formatYen } from '@/locale/format';
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
  | { kind: 'properties'; ctx: Ctx; props: HydratedProperty[] }
  | { kind: 'extra-option'; group: HydratedSetExtraGroup };

interface ExtraSel {
  optionId: string | null;
  sauceId: string | null;
  props: Record<string, string>;
}

interface Selections {
  variantId: string | null;
  mainSauceId: string | null;
  mainProps: Record<string, string>;
  extras: Record<string, ExtraSel>;
}

export interface BuilderResult {
  variant: string;
  price: number;
  options: CartItemOption[];
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
// Раскладка вариантов свойства (с оранжевым бордером)
// ============================================================
function PropertyOptionsLayout({
  options,
  selectedValue,
  onPick,
  size = 'large',
}: {
  options: string[];
  selectedValue: string | undefined;
  onPick: (opt: string) => void;
  size?: 'large' | 'small';
}) {
  const count = options.length;

  const baseBtn =
    size === 'large'
      ? 'py-5 px-3 rounded-xl text-base font-black'
      : 'py-3 px-2 rounded-lg text-xs font-bold';

  const btnClass = (selected: boolean) =>
    `${baseBtn} transition-all active:scale-[0.98] truncate ${
      selected
        ? 'bg-orange-500 text-white border-2 border-orange-500 shadow-md'
        : 'bg-white border-2 border-orange-400 text-gray-800 hover:bg-orange-50'
    }`;

  // 1 вариант — центр
  if (count === 1) {
    const opt = options[0];
    const selected = selectedValue === opt;
    return (
      <div className="flex justify-center">
        <button
          onClick={() => onPick(opt)}
          className={`${btnClass(selected)} min-w-[55%] max-w-[240px]`}
        >
          {opt}
        </button>
      </div>
    );
  }

  // 2 варианта — по краям
  if (count === 2) {
    return (
      <div className="flex justify-between gap-2">
        {options.map((opt) => {
          const selected = selectedValue === opt;
          return (
            <button
              key={opt}
              onClick={() => onPick(opt)}
              className={`${btnClass(selected)} flex-1`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  }

  // 3+ — сетка по 3
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((opt) => {
        const selected = selectedValue === opt;
        return (
          <button
            key={opt}
            onClick={() => onPick(opt)}
            className={btnClass(selected)}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// ПОРЯДОК ШАГОВ
//
// Свойства (properties) идут В САМОМ КОНЦЕ:
//   1. variant           (если main — group)
//   2. sauce main        (если main — with sauce)
//   3. extra-option      (выбор доп. блюда в сете)
//   4. sauce extra       (соус к доп. блюду)
//   ---- сюда переехали все properties ----
//   5. properties main
//   6. properties extra
// ============================================================
function computeSteps(item: MenuItem, selections: Selections): Step[] {
  const preSteps: Step[] = [];   // всё, что не properties
  const propSteps: Step[] = [];  // сюда — все properties

  const mainItem = item.type === 'set' ? item.set_main : item;
  if (!mainItem) return [];

  let resolvedMain: MenuItem | null = mainItem;

  // 1. Variant главного
  if (
    mainItem.dish_kind === 'group' &&
    mainItem.variants &&
    mainItem.variants.length > 0
  ) {
    preSteps.push({ kind: 'variant', variants: mainItem.variants });
    const v = selections.variantId
      ? mainItem.variants.find((x) => x.id === selections.variantId)
      : null;
    if (!v) return preSteps;
    resolvedMain = v;
  }

  // 2. Соус главного
  if (
    resolvedMain.sauce_mode === 'with' &&
    (resolvedMain.allowed_sauces?.length ?? 0) > 0
  ) {
    preSteps.push({
      kind: 'sauce',
      ctx: 'main',
      sauces: resolvedMain.allowed_sauces!,
    });
  }

  // 3–4. Extras сета (выбор + соус) и сбор их properties в propSteps
  if (item.type === 'set' && item.set_extra_groups) {
    for (const group of item.set_extra_groups) {
      const ex = selections.extras[group.id];

      // Выбор extra-option
      if (!ex?.optionId && group.options.length > 1) {
        preSteps.push({ kind: 'extra-option', group });
        continue;
      }

      const optId =
        ex?.optionId ??
        (group.options.length === 1 ? group.options[0].item.id : null);
      if (!optId) continue;

      const optItem = group.options.find((o) => o.item.id === optId)?.item;
      if (!optItem) continue;

      // Соус extra
      if (
        optItem.sauce_mode === 'with' &&
        (optItem.allowed_sauces?.length ?? 0) > 0
      ) {
        preSteps.push({
          kind: 'sauce',
          ctx: { extra: group.id },
          sauces: optItem.allowed_sauces!,
        });
      }

      // Properties extra — в конец, но сразу после main props
      const extraProps = validProps(optItem.properties);
      if (extraProps.length > 0) {
        propSteps.push({
          kind: 'properties',
          ctx: { extra: group.id },
          props: extraProps,
        });
      }
    }
  }

  // Properties главного — тоже в конец, но ПЕРЕД extra props
  const mainProps = validProps(resolvedMain.properties);
  if (mainProps.length > 0) {
    propSteps.unshift({
      kind: 'properties',
      ctx: 'main',
      props: mainProps,
    });
  }

  return [...preSteps, ...propSteps];
}

function computePrice(item: MenuItem, selections: Selections): number {
  if (item.type === 'set') {
    const mainItem = item.set_main;
    if (!mainItem) return 0;

    if (mainItem.dish_kind === 'group') {
      if (!selections.variantId) return 0;
      const v = mainItem.variants?.find(
        (x) => x.id === selections.variantId
      );
      return v ? v.price : 0;
    }

    return mainItem.price;
  }

  if (item.dish_kind === 'group' && selections.variantId && item.variants) {
    const v = item.variants.find((x) => x.id === selections.variantId);
    if (v) return v.price;
  }
  return item.price;
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
      options.push({
        type: 'variant',
        name: v.name,
        price: 0,
        quantity: 1,
      });
    }
  }

  if (selections.mainSauceId) {
    const s = mainItem?.allowed_sauces?.find(
      (x) => x.id === selections.mainSauceId
    );
    if (s) {
      options.push({ type: 'sauce', name: s.name, price: 0, quantity: 1 });
    }
  }

  const resolvedMain =
    mainItem?.dish_kind === 'group' && selections.variantId
      ? mainItem.variants?.find((x) => x.id === selections.variantId)
      : mainItem;

  const mainProps = validProps(resolvedMain?.properties);
  for (const p of mainProps) {
    const value = selections.mainProps[p.id];
    if (value === undefined || value === null || value === '') continue;
    options.push({
      type: 'property',
      name: buildPropertyOptionName(p, value),
      price: 0,
      quantity: 1,
    });
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

      if (ex?.sauceId) {
        const s = optItem.allowed_sauces?.find((x) => x.id === ex.sauceId);
        if (s) {
          options.push({
            type: 'sauce',
            name: `${optItem.name}: ${s.name}`,
            price: 0,
            quantity: 1,
          });
        }
      }

      const extraProps = validProps(optItem.properties);
      for (const p of extraProps) {
        const value = ex?.props?.[p.id];
        if (value === undefined || value === null || value === '') continue;
        options.push({
          type: 'property',
          name: `${optItem.name}: ${buildPropertyOptionName(p, value)}`,
          price: 0,
          quantity: 1,
        });
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

  const [stepIndex, setStepIndex] = useState(0);
  const [selections, setSelections] = useState<Selections>({
    variantId: null,
    mainSauceId: null,
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
      mainSauceId: null,
      mainProps: {},
      extras: {},
    };

    if (item.type === 'set' && item.set_extra_groups) {
      for (const group of item.set_extra_groups) {
        if (group.options.length === 1) {
          initSel.extras[group.id] = {
            optionId: group.options[0].item.id,
            sauceId: null,
            props: {},
          };
        }
      }
    }

    setSelections(initSel);
    setStepIndex(initialVariantId ? 1 : 0);
  }, [open, itemId, initialVariantId, item]);

  const steps = useMemo(
    () => (item ? computeSteps(item, selections) : []),
    [item, selections]
  );

  useEffect(() => {
    if (stepIndex > steps.length - 1) {
      setStepIndex(Math.max(0, steps.length - 1));
    }
  }, [steps.length, stepIndex]);

  const doFinish = useCallback(
    (sel: Selections) => {
      if (!item) return;
      onConfirm(buildResult(item, sel));
    },
    [item, onConfirm]
  );

  const advance = useCallback(
    (newSel: Selections, reuse: boolean) => {
      if (!item) return;
      const newSteps = computeSteps(item, newSel);
      const nextIdx = reuse ? stepIndex : stepIndex + 1;

      if (nextIdx >= newSteps.length) {
        doFinish(newSel);
      } else {
        setSelections(newSel);
        setStepIndex(nextIdx);
      }
    },
    [item, stepIndex, doFinish]
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
          ? selections.mainSauceId
          : selections.extras[(current.ctx as { extra: string }).extra]
              ?.sauceId ?? null;
      if (!val) {
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
    advance(
      {
        ...selections,
        variantId: v.id,
        mainSauceId: null,
        mainProps: {},
      },
      false
    );
  };

  const selectMainSauce = (sauceId: string) => {
    advance({ ...selections, mainSauceId: sauceId }, false);
  };

  const selectExtraSauce = (groupId: string, sauceId: string) => {
    const cur = selections.extras[groupId] ?? {
      optionId: null,
      sauceId: null,
      props: {},
    };
    advance(
      {
        ...selections,
        extras: {
          ...selections.extras,
          [groupId]: { ...cur, sauceId },
        },
      },
      false
    );
  };

  const selectExtraOption = (groupId: string, optionId: string) => {
    advance(
      {
        ...selections,
        extras: {
          ...selections.extras,
          [groupId]: {
            optionId,
            sauceId: null,
            props: {},
          },
        },
      },
      true
    );
  };

  const skipExtraOption = (groupId: string) => {
    const nextIdx = stepIndex + 1;
    if (nextIdx >= steps.length) {
      doFinish(selections);
    } else {
      setStepIndex(nextIdx);
    }
    void groupId;
  };

  const setMainPropOption = (pid: string, opt: string) => {
    setSelections((s) => ({
      ...s,
      mainProps: { ...s.mainProps, [pid]: opt },
    }));
  };

  const setExtraPropOption = (groupId: string, pid: string, opt: string) => {
    setSelections((s) => {
      const cur = s.extras[groupId] ?? {
        optionId: null,
        sauceId: null,
        props: {},
      };
      return {
        ...s,
        extras: {
          ...s.extras,
          [groupId]: { ...cur, props: { ...cur.props, [pid]: opt } },
        },
      };
    });
  };

  const answerMainPropOption = (pid: string, opt: string) => {
    advance(
      { ...selections, mainProps: { ...selections.mainProps, [pid]: opt } },
      false
    );
  };

  const answerExtraPropOption = (
    groupId: string,
    pid: string,
    opt: string
  ) => {
    const cur = selections.extras[groupId] ?? {
      optionId: null,
      sauceId: null,
      props: {},
    };
    advance(
      {
        ...selections,
        extras: {
          ...selections.extras,
          [groupId]: { ...cur, props: { ...cur.props, [pid]: opt } },
        },
      },
      false
    );
  };

  const skipMainProp = (pid: string) => {
    const np = { ...selections.mainProps };
    delete np[pid];
    advance({ ...selections, mainProps: np }, false);
  };

  const skipExtraProp = (groupId: string, pid: string) => {
    const cur = selections.extras[groupId] ?? {
      optionId: null,
      sauceId: null,
      props: {},
    };
    const np = { ...cur.props };
    delete np[pid];
    advance(
      {
        ...selections,
        extras: {
          ...selections.extras,
          [groupId]: { ...cur, props: np },
        },
      },
      false
    );
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
    if (currentStep.kind === 'properties') return t('chooseProperties');
    return currentStep.group.label || t('chooseExtra');
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-lg max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-200 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold text-orange-600 uppercase tracking-wider">
              {stepLabel}
              {steps.length > 0 && ` · ${stepIndex + 1}/${steps.length}`}
            </div>
            <h3 className="text-lg font-black text-gray-900 truncate">
              {item.name}
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-lg text-gray-400 active:bg-gray-100 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress */}
        {steps.length > 0 && (
          <div className="h-1 bg-gray-100 shrink-0">
            <div
              className="h-full bg-gradient-to-r from-orange-500 to-red-500 transition-all"
              style={{
                width: `${((stepIndex + 1) / steps.length) * 100}%`,
              }}
            />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {currentStep?.kind === 'variant' && (
            <div className="grid grid-cols-2 gap-2">
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
                  <div
                    className={`text-sm font-bold ${
                      selections.variantId === v.id
                        ? 'text-white/90'
                        : 'text-orange-600'
                    }`}
                  >
                    {v.free ? '' : formatYen(v.price)}
                  </div>
                </button>
              ))}
            </div>
          )}

          {currentStep?.kind === 'sauce' && (
            <div className="grid grid-cols-3 gap-3">
              {currentStep.sauces.map((s) => {
                const selected =
                  currentStep.ctx === 'main'
                    ? selections.mainSauceId === s.id
                    : selections.extras[currentStep.ctx.extra]?.sauceId ===
                      s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      if (currentStep.ctx === 'main')
                        selectMainSauce(s.id);
                      else selectExtraSauce(currentStep.ctx.extra, s.id);
                    }}
                    className={`flex flex-col items-center gap-1 p-1.5 rounded-xl transition-all active:scale-[0.97] ${
                      selected
                        ? 'bg-orange-50 ring-4 ring-orange-300'
                        : 'bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div
                      className="relative rounded-lg overflow-hidden w-full max-w-[88px] aspect-square"
                      style={{
                        borderWidth: 3,
                        borderStyle: 'solid',
                        borderColor: s.color ?? '#e5e7eb',
                        background: '#ffffff',
                      }}
                    >
                      {s.image_url ? (
                        <img
                          src={s.image_url}
                          alt={s.name}
                          className="absolute inset-0 w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div
                          className="absolute inset-0"
                          style={{
                            backgroundColor: s.color ?? '#e5e7eb',
                            opacity: 0.25,
                          }}
                        />
                      )}
                      {selected && (
                        <div className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-orange-500 text-white flex items-center justify-center shadow-md">
                          <Check className="w-2.5 h-2.5" />
                        </div>
                      )}
                    </div>
                    <span className="text-[11px] font-black text-gray-900 truncate w-full text-center leading-tight">
                      {s.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* PROPERTIES */}
          {currentStep?.kind === 'properties' &&
            (() => {
              const ctx = currentStep.ctx;
              const isMain = ctx === 'main';
              const getVal = (pid: string): string | undefined =>
                isMain
                  ? selections.mainProps[pid]
                  : selections.extras[(ctx as { extra: string }).extra]?.props[
                      pid
                    ];

              if (currentStep.props.length === 1) {
                const p = currentStep.props[0];
                const val = getVal(p.id);

                const handlePick = (opt: string) => {
                  if (isMain) answerMainPropOption(p.id, opt);
                  else
                    answerExtraPropOption(
                      (ctx as { extra: string }).extra,
                      p.id,
                      opt
                    );
                };

                return (
                  <div className="py-2">
                    <div className="text-center text-xl font-black text-gray-900 mb-4">
                      {p.name}
                    </div>
                    <PropertyOptionsLayout
                      options={p.options}
                      selectedValue={val}
                      onPick={handlePick}
                      size="large"
                    />
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {currentStep.props.map((p) => {
                    const val = getVal(p.id);

                    const handlePick = (opt: string) => {
                      if (isMain) setMainPropOption(p.id, opt);
                      else
                        setExtraPropOption(
                          (ctx as { extra: string }).extra,
                          p.id,
                          opt
                        );
                    };

                    return (
                      <div
                        key={p.id}
                        className="border-2 border-gray-200 rounded-xl p-3 bg-white"
                      >
                        <div className="text-sm font-black text-gray-900 mb-2">
                          {p.name}
                        </div>
                        <PropertyOptionsLayout
                          options={p.options}
                          selectedValue={val}
                          onPick={handlePick}
                          size="small"
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })()}

          {currentStep?.kind === 'extra-option' && (
            <div className="space-y-2">
              <div className="text-sm text-gray-500 mb-2">
                {currentStep.group.label || t('chooseExtra')}
                {currentStep.group.required && (
                  <span className="text-red-500 ml-1">*</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {currentStep.group.options.map((o) => {
                  const selected =
                    selections.extras[currentStep.group.id]?.optionId ===
                    o.item.id;
                  return (
                    <button
                      key={o.option_id}
                      onClick={() =>
                        selectExtraOption(currentStep.group.id, o.item.id)
                      }
                      className={`p-3 rounded-xl border-2 text-left transition-all active:scale-[0.98] ${
                        selected
                          ? 'bg-purple-500 border-purple-500 text-white shadow-md'
                          : 'bg-white border-gray-200 hover:border-purple-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {o.item.image_url && (
                          <img
                            src={o.item.image_url}
                            alt=""
                            className="w-8 h-8 rounded object-cover shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold truncate">
                            {o.item.name}
                          </div>
                          {!o.item.free && (
                            <div
                              className={`text-[11px] font-bold ${
                                selected
                                  ? 'text-white/80'
                                  : 'text-orange-600'
                              }`}
                            >
                              {formatYen(o.item.price)}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {!currentStep.group.required && (
                <button
                  onClick={() => skipExtraOption(currentStep.group.id)}
                  className="w-full py-2 text-xs text-gray-500 underline"
                >
                  {t('skip')}
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="mt-3 p-2.5 bg-red-50 border border-red-300 rounded-lg text-red-700 text-xs font-bold">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-200 flex gap-2 shrink-0">
          <button
            onClick={back}
            className="flex items-center justify-center gap-1 px-4 py-3 rounded-xl bg-gray-100 active:bg-gray-200 text-gray-800 text-sm font-bold"
          >
            <ChevronLeft className="w-4 h-4" />
            {stepIndex === 0 ? t('cancel') : t('back')}
          </button>

          {(() => {
            const singlePropStep =
              currentStep?.kind === 'properties' &&
              currentStep.props.length === 1
                ? currentStep
                : null;

            const showNext =
              currentStep &&
              !(
                currentStep.kind === 'variant' ||
                currentStep.kind === 'sauce' ||
                currentStep.kind === 'extra-option' ||
                singlePropStep
              );

            if (singlePropStep) {
              const p = singlePropStep.props[0];
              const ctx = singlePropStep.ctx;
              const isMain = ctx === 'main';

              const handleSkip = () => {
                if (isMain) skipMainProp(p.id);
                else
                  skipExtraProp((ctx as { extra: string }).extra, p.id);
              };

              return (
                <button
                  onClick={handleSkip}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white text-sm font-bold flex items-center justify-center active:scale-[0.98] shadow-md shadow-orange-500/30 transition-all"
                  title={t('skip')}
                >
                  {currentPrice > 0 ? formatYen(currentPrice) : t('addToCartBtn')}
                </button>
              );
            }

            if (!showNext) {
              return (
                <div className="flex-1 py-3 rounded-xl bg-gray-200 text-gray-500 text-sm font-bold flex items-center justify-center cursor-not-allowed select-none">
                  {currentPrice > 0 ? formatYen(currentPrice) : t('addToCartBtn')}
                </div>
              );
            }

            return (
              <button
                onClick={goNext}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white text-sm font-bold transition-all active:scale-[0.98] shadow-md shadow-orange-500/30 flex items-center justify-center gap-1"
              >
                {stepIndex >= steps.length - 1 ? (
                  <>
                    {t('addToCartBtn')} ·{' '}
                    {currentPrice > 0 ? formatYen(currentPrice) : ''}
                  </>
                ) : (
                  <>
                    {t('next')}
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

export type { TranslationKey };