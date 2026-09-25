import { useEffect, useMemo, useState } from 'react';
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

// ============================================================
// Types
// ============================================================
type Ctx = 'main' | { extra: string }; // extra: groupId

type Step =
  | { kind: 'variant'; variants: MenuItem[] }
  | { kind: 'sauce'; ctx: Ctx; sauces: HydratedSauce[] }
  | { kind: 'properties'; ctx: Ctx; props: HydratedProperty[] }
  | { kind: 'extra-option'; group: HydratedSetExtraGroup };

interface ExtraSel {
  optionId: string | null;
  sauceId: string | null;
  props: Set<string>;
}

interface Selections {
  variantId: string | null;
  mainSauceId: string | null;
  mainProps: Set<string>;
  extras: Record<string, ExtraSel>;
}

export interface BuilderResult {
  variant: string;
  price: number;
  options: CartItemOption[];
}

// ============================================================
// Build steps dynamically from current selections
// ============================================================
function buildSteps(
  item: MenuItem,
  selections: Selections
): Step[] {
  const steps: Step[] = [];
  const mainItem = item.type === 'set' ? item.set_main : item;
  if (!mainItem) return steps;

  // 1. Variant if group
  let resolvedMain: MenuItem | null = mainItem;
  if (mainItem.dish_kind === 'group' && mainItem.variants && mainItem.variants.length > 0) {
    steps.push({ kind: 'variant', variants: mainItem.variants });
    const v = selections.variantId
      ? mainItem.variants.find((x) => x.id === selections.variantId)
      : null;
    if (!v) return steps;
    resolvedMain = v;
  }

  // 2. Sauce
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

  // 3. Properties
  if ((resolvedMain.properties?.length ?? 0) > 0) {
    steps.push({
      kind: 'properties',
      ctx: 'main',
      props: resolvedMain.properties!,
    });
  }

  // 4. Extras
  if (item.type === 'set' && item.set_extra_groups) {
    for (const group of item.set_extra_groups) {
      steps.push({ kind: 'extra-option', group });
      const ex = selections.extras[group.id];
      if (!ex?.optionId) continue;

      const optItem = group.options.find((o) => o.item.id === ex.optionId)?.item;
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
      if ((optItem.properties?.length ?? 0) > 0) {
        steps.push({
          kind: 'properties',
          ctx: { extra: group.id },
          props: optItem.properties!,
        });
      }
    }
  }

  return steps;
}

// ============================================================
// Helper: get price for current selection
// ============================================================
function computePrice(
  item: MenuItem,
  selections: Selections
): number {
  if (item.type === 'set') {
    // base price or override from main variant
    const mainItem = item.set_main;
    if (
      mainItem &&
      mainItem.dish_kind === 'group' &&
      selections.variantId
    ) {
      // In our hydrated model, overridden price is already applied to the variant
      const v = mainItem.variants?.find((x) => x.id === selections.variantId);
      if (v) return v.price; // variant's price already = set's price for this variant
    }
    return item.price;
  }

  // dish
  if (item.dish_kind === 'group' && selections.variantId && item.variants) {
    const v = item.variants.find((x) => x.id === selections.variantId);
    if (v) return v.price;
  }
  return item.price;
}

// ============================================================
// Main component
// ============================================================
export function ProductBuilderDialog({
  open,
  item,
  allItems,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  item: MenuItem | null;
  allItems: MenuItem[];
  onConfirm: (r: BuilderResult) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();

  const [stepIndex, setStepIndex] = useState(0);
  const [selections, setSelections] = useState<Selections>({
    variantId: null,
    mainSauceId: null,
    mainProps: new Set(),
    extras: {},
  });
  const [error, setError] = useState<string | null>(null);

  // Reset on open
  const itemId = item?.id;
  useEffect(() => {
    if (!open || !itemId) return;
    setStepIndex(0);
    setError(null);

    // Pre-fill default properties (there are none in v3, but keep structure)
    setSelections({
      variantId: null,
      mainSauceId: null,
      mainProps: new Set(),
      extras: {},
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemId]);

  const steps = useMemo<Step[]>(() => {
    if (!item) return [];
    return buildSteps(item, selections);
  }, [item, selections]);

  // Clamp stepIndex if steps array changed
  useEffect(() => {
    if (stepIndex > steps.length - 1) {
      setStepIndex(Math.max(0, steps.length - 1));
    }
  }, [steps.length, stepIndex]);

  if (!open || !item) return null;

  const currentStep: Step | undefined = steps[stepIndex];
  const currentPrice = computePrice(item, selections);

  // ---- Step validation ----
  const canProceed = (): boolean => {
    if (!currentStep) return true;

    if (currentStep.kind === 'variant') {
      return selections.variantId !== null;
    }
    if (currentStep.kind === 'sauce') {
      if (currentStep.ctx === 'main') return selections.mainSauceId !== null;
      const ex = selections.extras[currentStep.ctx.extra];
      return ex?.sauceId != null;
    }
    if (currentStep.kind === 'properties') {
      // properties are optional — can always proceed
      return true;
    }
    if (currentStep.kind === 'extra-option') {
      const ex = selections.extras[currentStep.group.id];
      if (!currentStep.group.required) return true;
      return ex?.optionId != null;
    }
    return true;
  };

  const next = () => {
    if (!canProceed()) {
      setError(t('requiredChoice'));
      return;
    }
    setError(null);

    // Compute updated selections synchronously
    const updated = { ...selections };

    // If we've answered the LAST step, finish
    if (stepIndex >= steps.length - 1) {
      finish(updated);
      return;
    }

    setStepIndex(stepIndex + 1);
  };

  const back = () => {
    setError(null);
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
    else onCancel();
  };

  // ---- Setters ----
  const setVariant = (v: MenuItem) => {
    setSelections((s) => ({
      ...s,
      variantId: v.id,
      // reset downstream main selections when variant changes
      mainSauceId: null,
      mainProps: new Set(),
    }));
    setError(null);
  };

  const setMainSauce = (sauceId: string) => {
    setSelections((s) => ({ ...s, mainSauceId: sauceId }));
    setError(null);
    // auto-advance
    setTimeout(() => {
      setStepIndex((idx) => Math.min(idx + 1, steps.length));
    }, 100);
  };

  const toggleMainProp = (propId: string) => {
    setSelections((s) => {
      const np = new Set(s.mainProps);
      if (np.has(propId)) np.delete(propId);
      else np.add(propId);
      return { ...s, mainProps: np };
    });
  };

  const setExtraOption = (groupId: string, optionId: string) => {
    setSelections((s) => ({
      ...s,
      extras: {
        ...s.extras,
        [groupId]: {
          optionId,
          sauceId: null,
          props: new Set(),
        },
      },
    }));
    setError(null);
  };

  const setExtraSauce = (groupId: string, sauceId: string) => {
    setSelections((s) => ({
      ...s,
      extras: {
        ...s.extras,
        [groupId]: {
          ...(s.extras[groupId] ?? {
            optionId: null,
            props: new Set(),
          }),
          sauceId,
        },
      },
    }));
    setError(null);
    setTimeout(() => {
      setStepIndex((idx) => Math.min(idx + 1, steps.length));
    }, 100);
  };

  const toggleExtraProp = (groupId: string, propId: string) => {
    setSelections((s) => {
      const cur = s.extras[groupId] ?? {
        optionId: null,
        sauceId: null,
        props: new Set<string>(),
      };
      const np = new Set(cur.props);
      if (np.has(propId)) np.delete(propId);
      else np.add(propId);
      return {
        ...s,
        extras: { ...s.extras, [groupId]: { ...cur, props: np } },
      };
    });
  };

  // ---- Finish ----
  const finish = (_updated: Selections) => {
    if (!item) return;
    const options: CartItemOption[] = [];
    let variantName = '';

    const mainItem = item.type === 'set' ? item.set_main : item;

    // Variant
    if (mainItem?.dish_kind === 'group' && selections.variantId) {
      const v = mainItem.variants?.find(
        (x) => x.id === selections.variantId
      );
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

    // Main sauce
    if (selections.mainSauceId) {
      const s = mainItem?.allowed_sauces?.find(
        (x) => x.id === selections.mainSauceId
      );
      if (s) {
        options.push({
          type: 'sauce',
          name: s.name,
          price: 0,
          quantity: 1,
        });
      }
    }

    // Main props
    const resolvedMain =
      mainItem?.dish_kind === 'group' && selections.variantId
        ? mainItem.variants?.find((x) => x.id === selections.variantId)
        : mainItem;
    for (const propId of selections.mainProps) {
      const p = resolvedMain?.properties?.find((x) => x.id === propId);
      if (p) {
        options.push({
          type: 'property',
          name: p.name,
          price: 0,
          quantity: 1,
        });
      }
    }

    // Extras
    if (item.type === 'set' && item.set_extra_groups) {
      for (const group of item.set_extra_groups) {
        const ex = selections.extras[group.id];
        if (!ex?.optionId) continue;
        const optItem = group.options.find(
          (o) => o.item.id === ex.optionId
        )?.item;
        if (!optItem) continue;

        options.push({
          type: 'extra',
          name: `${group.label}: ${optItem.name}`,
          price: 0,
          quantity: 1,
        });

        if (ex.sauceId) {
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

        for (const propId of ex.props) {
          const p = optItem.properties?.find((x) => x.id === propId);
          if (p) {
            options.push({
              type: 'property',
              name: `${optItem.name}: ${p.name}`,
              price: 0,
              quantity: 1,
            });
          }
        }
      }
    }

    onConfirm({
      variant: variantName,
      price: currentPrice,
      options,
    });
  };

  // ---- Render current step ----
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
                  onClick={() => setVariant(v)}
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
                    {v.free ? t('free') : formatYen(v.price)}
                  </div>
                </button>
              ))}
            </div>
          )}

          {currentStep?.kind === 'sauce' && (
            <div className="grid grid-cols-2 gap-2">
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
                      if (currentStep.ctx === 'main') setMainSauce(s.id);
                      else setExtraSauce(currentStep.ctx.extra, s.id);
                    }}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all active:scale-[0.98] ${
                      selected
                        ? 'bg-orange-500 border-orange-500 text-white shadow-md'
                        : 'bg-white border-gray-200 hover:border-orange-300'
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded-full border border-gray-200 shrink-0"
                      style={{ backgroundColor: s.color ?? '#e5e7eb' }}
                    />
                    <span className="text-sm font-bold flex-1 truncate">
                      {s.name}
                    </span>
                    {selected && <Check className="w-4 h-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {currentStep?.kind === 'properties' && (
            <div className="space-y-2">
              {currentStep.props.map((p) => {
                const selected =
                  currentStep.ctx === 'main'
                    ? selections.mainProps.has(p.id)
                    : selections.extras[currentStep.ctx.extra]?.props.has(
                        p.id
                      ) ?? false;
                const toggle = () => {
                  if (currentStep.ctx === 'main') toggleMainProp(p.id);
                  else
                    toggleExtraProp(
                      (currentStep.ctx as { extra: string }).extra,
                      p.id
                    );
                };
                return (
                  <button
                    key={p.id}
                    onClick={toggle}
                    className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all active:scale-[0.98] ${
                      selected
                        ? 'bg-green-50 border-green-500'
                        : 'bg-white border-gray-200'
                    }`}
                  >
                    <span className="text-sm font-bold text-gray-900">
                      {p.name}
                    </span>
                    <div
                      className={`w-10 h-6 rounded-full transition-colors relative ${
                        selected ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow ${
                          selected ? 'translate-x-4' : ''
                        }`}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

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
                        setExtraOption(currentStep.group.id, o.item.id)
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
                  onClick={() => {
                    // clear selection
                    setSelections((s) => {
                      const cp = { ...s.extras };
                      delete cp[currentStep.group.id];
                      return { ...s, extras: cp };
                    });
                    setStepIndex((i) => i + 1);
                  }}
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
          <button
            onClick={next}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white text-sm font-bold transition-all active:scale-[0.98] shadow-md shadow-orange-500/30 flex items-center justify-center gap-1"
          >
            {stepIndex >= steps.length - 1 ? (
              <>
                {t('addToCartBtn')} • {formatYen(currentPrice)}
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
    </div>
  );
}

// Silence unused variable warning
export type { TranslationKey };