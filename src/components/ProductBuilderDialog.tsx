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
// Чистые функции пересчёта шагов и цены
// ============================================================
function computeSteps(item: MenuItem, selections: Selections): Step[] {
  const steps: Step[] = [];
  const mainItem = item.type === 'set' ? item.set_main : item;
  if (!mainItem) return steps;

  let resolvedMain: MenuItem | null = mainItem;

  if (
    mainItem.dish_kind === 'group' &&
    mainItem.variants &&
    mainItem.variants.length > 0
  ) {
    steps.push({ kind: 'variant', variants: mainItem.variants });
    const v = selections.variantId
      ? mainItem.variants.find((x) => x.id === selections.variantId)
      : null;
    if (!v) return steps;
    resolvedMain = v;
  }

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

  if ((resolvedMain.properties?.length ?? 0) > 0) {
    steps.push({
      kind: 'properties',
      ctx: 'main',
      props: resolvedMain.properties!,
    });
  }

  if (item.type === 'set' && item.set_extra_groups) {
    for (const group of item.set_extra_groups) {
      const ex = selections.extras[group.id];

      // Если в группе больше одной опции и выбор ещё не сделан — показываем
      // шаг выбора. Иначе (одна опция или уже выбрано) пропускаем шаг выбора
      // и сразу идём в его sauce/properties.
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

function buildResult(
  item: MenuItem,
  selections: Selections
): BuilderResult {
  const options: CartItemOption[] = [];
  let variantName = '';

  const mainItem = item.type === 'set' ? item.set_main : item;

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

      if (ex?.props) {
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
  item,
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

  const [stepIndex, setStepIndex] = useState(0);
  const [selections, setSelections] = useState<Selections>({
    variantId: null,
    mainSauceId: null,
    mainProps: new Set(),
    extras: {},
  });
  const [error, setError] = useState<string | null>(null);

  const itemId = item?.id;

  // ---------- Инициализация при открытии ----------
  useEffect(() => {
    if (!open || !itemId || !item) return;
    setError(null);

    const initSel: Selections = {
      variantId: initialVariantId ?? null,
      mainSauceId: null,
      mainProps: new Set(),
      extras: {},
    };

    // Auto-select единственных опций в extra-группах
    if (item.type === 'set' && item.set_extra_groups) {
      for (const group of item.set_extra_groups) {
        if (group.options.length === 1) {
          initSel.extras[group.id] = {
            optionId: group.options[0].item.id,
            sauceId: null,
            props: new Set(),
          };
        }
      }
    }

    setSelections(initSel);
    setStepIndex(initialVariantId ? 1 : 0);
  }, [open, itemId, initialVariantId, item]);

  // ---------- Текущие шаги ----------
  const steps = useMemo(
    () => (item ? computeSteps(item, selections) : []),
    [item, selections]
  );

  // ---------- Клампим stepIndex ----------
  useEffect(() => {
    if (stepIndex > steps.length - 1) {
      setStepIndex(Math.max(0, steps.length - 1));
    }
  }, [steps.length, stepIndex]);

  // ---------- Финиш ----------
  const doFinish = useCallback(
    (sel: Selections) => {
      if (!item) return;
      onConfirm(buildResult(item, sel));
    },
    [item, onConfirm]
  );

  // ---------- Универсальный переход ----------
  // reuse=true — если шаг, на котором мы стояли, исчезает из списка
  //             (например extra-option → его sauce/props);
  // reuse=false — если шаг остаётся (variant, sauce, properties).
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

  // ---------- Кнопка Далее (для properties с несколькими) ----------
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

  // ---------- Обработчики выбора (с автопереходом) ----------
  const selectVariant = (v: MenuItem) => {
    advance(
      {
        ...selections,
        variantId: v.id,
        mainSauceId: null,
        mainProps: new Set(),
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
      props: new Set<string>(),
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
            props: new Set(),
          },
        },
      },
      true
    );
  };

  const skipExtraOption = (groupId: string) => {
    // Пропускаем шаг выбора extra — не создаём запись в selections
    const nextIdx = stepIndex + 1;
    if (nextIdx >= steps.length) {
      doFinish(selections);
    } else {
      setStepIndex(nextIdx);
    }
    void groupId;
  };

  // ---------- Toggle свойств (для нескольких) ----------
  const toggleMainProp = (pid: string) => {
    setSelections((s) => {
      const np = new Set(s.mainProps);
      if (np.has(pid)) np.delete(pid);
      else np.add(pid);
      return { ...s, mainProps: np };
    });
  };

  const toggleExtraProp = (groupId: string, pid: string) => {
    setSelections((s) => {
      const cur = s.extras[groupId] ?? {
        optionId: null,
        sauceId: null,
        props: new Set<string>(),
      };
      const np = new Set(cur.props);
      if (np.has(pid)) np.delete(pid);
      else np.add(pid);
      return {
        ...s,
        extras: { ...s.extras, [groupId]: { ...cur, props: np } },
      };
    });
  };

  // ---------- Ответ на одно свойство (Да/Нет) ----------
  const answerMainProp = (pid: string, on: boolean) => {
    const np = new Set(selections.mainProps);
    if (on) np.add(pid);
    else np.delete(pid);
    advance({ ...selections, mainProps: np }, false);
  };

  const answerExtraProp = (groupId: string, pid: string, on: boolean) => {
    const cur = selections.extras[groupId] ?? {
      optionId: null,
      sauceId: null,
      props: new Set<string>(),
    };
    const np = new Set(cur.props);
    if (on) np.add(pid);
    else np.delete(pid);
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

  // ---------- Единый лейбл шага ----------
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

          {/* SAUCE — 3 в ряд, клик → сразу переход */}
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
            (currentStep.props.length === 1
              ? // Одно свойство — две кнопки Да/Нет
                (() => {
                  const p = currentStep.props[0];
                  const isOn =
                    currentStep.ctx === 'main'
                      ? selections.mainProps.has(p.id)
                      : selections.extras[currentStep.ctx.extra]?.props.has(
                          p.id
                        ) ?? false;
                  return (
                    <div className="py-2">
                      <div className="text-center text-xl font-black text-gray-900 mb-6">
                        {p.name}?
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => {
                            if (currentStep.ctx === 'main')
                              answerMainProp(p.id, false);
                            else
                              answerExtraProp(
                                (currentStep.ctx as { extra: string })
                                  .extra,
                                p.id,
                                false
                              );
                          }}
                          className={`py-4 rounded-xl text-base font-black transition-all active:scale-[0.98] ${
                            !isOn
                              ? 'bg-gray-800 text-white shadow-md'
                              : 'bg-white border-2 border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {t('no')}
                        </button>
                        <button
                          onClick={() => {
                            if (currentStep.ctx === 'main')
                              answerMainProp(p.id, true);
                            else
                              answerExtraProp(
                                (currentStep.ctx as { extra: string })
                                  .extra,
                                p.id,
                                true
                              );
                          }}
                          className={`py-4 rounded-xl text-base font-black transition-all active:scale-[0.98] ${
                            isOn
                              ? 'bg-green-600 text-white shadow-md'
                              : 'bg-white border-2 border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {t('yes')}
                        </button>
                      </div>
                    </div>
                  );
                })()
              : // Несколько свойств — toggle + кнопка Далее
                currentStep.props.map((p) => {
                  const selected =
                    currentStep.ctx === 'main'
                      ? selections.mainProps.has(p.id)
                      : selections.extras[
                          (currentStep.ctx as { extra: string }).extra
                        ]?.props.has(p.id) ?? false;
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
                      className={`w-full flex items-center justify-between p-3 mb-2 rounded-xl border-2 transition-all active:scale-[0.98] ${
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
                }))}

          {/* EXTRA OPTION — клик → сразу переход */}
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

          {/* Далее показываем только если текущий шаг НЕ автопереходный */}
          {(() => {
            const showNext =
              currentStep &&
              !(
                currentStep.kind === 'variant' ||
                currentStep.kind === 'sauce' ||
                currentStep.kind === 'extra-option' ||
                (currentStep.kind === 'properties' &&
                  currentStep.props.length === 1)
              );

            if (!showNext) {
              // Показываем только цену, если это финальный автопереходный шаг
              return (
                <div className="flex-1 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white text-sm font-bold flex items-center justify-center">
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