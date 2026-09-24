import { useEffect, useMemo, useState } from 'react';
import { X, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n, type TranslationKey } from '@/locale';
import { formatYen } from '@/locale/format';
import type {
  MenuItem,
  MenuItemVariant,
  MenuItemProperty,
  MenuSetSlot,
  CartItemOption,
} from '@/types/database';

type Step =
  | { kind: 'variant'; variants: MenuItemVariant[] }
  | {
      kind: 'property';
      group_name: string | null;
      props: MenuItemProperty[];
    }
  | {
      kind: 'set-slot';
      slot: MenuSetSlot;
      options: MenuItem[];
      slotIndex: number;
    };

export interface BuilderResult {
  variant: string;
  price: number;
  options: CartItemOption[];
}

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
  const [variantId, setVariantId] = useState<string | null>(null);
  const [propSel, setPropSel] = useState<Record<string, Set<string>>>({});
  const [slotSel, setSlotSel] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const itemId = item?.id;
  const itemVariants = item?.variants;
  const itemProperties = item?.properties;
  const itemSetSlots = item?.set_slots;

  // ============================================================
  // Вычисляем шаги
  // ============================================================
  const steps = useMemo<Step[]>(() => {
    if (!item) return [];
    const s: Step[] = [];

    if (itemVariants && itemVariants.length > 0) {
      s.push({
        kind: 'variant',
        variants: [...itemVariants].sort(
          (a, b) => a.sort_order - b.sort_order
        ),
      });
    }

    if (item.type === 'set' && itemSetSlots && itemSetSlots.length > 0) {
      const sorted = [...itemSetSlots].sort(
        (a, b) => a.sort_order - b.sort_order
      );
      let idx = 0;
      for (const slot of sorted) {
        const options = resolveSlotOptions(slot, allItems);
        if (options.length === 0) continue;
        s.push({ kind: 'set-slot', slot, options, slotIndex: idx++ });
      }
    }

    if (itemProperties && itemProperties.length > 0) {
      const groups = new Map<string | null, MenuItemProperty[]>();
      for (const p of itemProperties) {
        const k = p.group_name;
        const arr = groups.get(k) ?? [];
        arr.push(p);
        groups.set(k, arr);
      }
      for (const [group_name, props] of groups) {
        s.push({
          kind: 'property',
          group_name,
          props: [...props].sort((a, b) => a.sort_order - b.sort_order),
        });
      }
    }

    return s;
  }, [item, itemVariants, itemProperties, itemSetSlots, allItems]);

  // Сброс при открытии + предустановка default-property
  useEffect(() => {
    if (!open || !itemId) return;
    setStepIndex(0);
    setVariantId(null);
    setSlotSel({});
    setError(null);

    const initial: Record<string, Set<string>> = {};
    for (const p of itemProperties ?? []) {
      if (p.group_name === null) continue;
      const key = p.group_name;
      const set = initial[key] ?? new Set<string>();
      if (p.is_default && set.size === 0) set.add(p.id);
      initial[key] = set;
    }
    setPropSel(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemId]);

  if (!open || !item) return null;

  const currentStep: Step | undefined = steps[stepIndex];

  // ============================================================
  // Проверка текущего шага
  // ============================================================
  const canProceed = (): boolean => {
    if (!currentStep) return true;
    if (currentStep.kind === 'variant') return variantId !== null;
    if (currentStep.kind === 'set-slot') {
      if (!currentStep.slot.required) return true;
      return !!slotSel[currentStep.slot.id];
    }
    if (currentStep.kind === 'property') {
      const key = currentStep.group_name ?? '';
      const set = propSel[key];
      if (currentStep.group_name !== null) return !!set && set.size > 0;
      return true;
    }
    return true;
  };

  const next = () => {
    if (!canProceed()) {
      setError(t('requiredChoice'));
      return;
    }
    setError(null);
    if (stepIndex < steps.length - 1) setStepIndex(stepIndex + 1);
    else finish();
  };

  const back = () => {
    setError(null);
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
    else onCancel();
  };

  const finish = () => {
    if (!item) return;
    const chosen = itemVariants?.find((v) => v.id === variantId);
    const price = chosen ? chosen.price : item.price;
    const options: CartItemOption[] = [];

    if (chosen) {
      options.push({
        type: 'variant',
        name: chosen.name,
        price: 0,
        quantity: 1,
      });
    }

    for (const set of Object.values(propSel)) {
      for (const propId of set) {
        const p = itemProperties?.find((x) => x.id === propId);
        if (p) {
          options.push({
            type: 'property',
            name: p.name,
            price: p.price,
            quantity: 1,
          });
        }
      }
    }

    if (item.type === 'set' && itemSetSlots) {
      for (const slot of itemSetSlots) {
        const chosenId = slotSel[slot.id];
        if (!chosenId) continue;
        const optItem = allItems.find((x) => x.id === chosenId);
        if (optItem) {
          options.push({
            type: slot.slot_type,
            name:
              optItem.name +
              (optItem.short_name ? ` (${optItem.short_name})` : ''),
            price: 0,
            quantity: 1,
          });
        }
      }
    }

    onConfirm({
      variant: chosen?.name ?? '',
      price,
      options,
    });
  };

  const currentPrice = (() => {
    const chosen = itemVariants?.find((v) => v.id === variantId);
    return chosen ? chosen.price : item.price;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-200 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold text-orange-600 uppercase tracking-wider">
              {steps.length > 0
                ? `${stepLabel(currentStep, t)} · ${stepIndex + 1}/${
                    steps.length
                  }`
                : t('addToCartBtn')}
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
                  onClick={() => {
                    setVariantId(v.id);
                    setError(null);
                  }}
                  className={`p-4 rounded-xl border-2 text-left transition-all active:scale-[0.98] ${
                    variantId === v.id
                      ? 'bg-orange-500 border-orange-500 text-white shadow-md'
                      : 'bg-white border-gray-200'
                  }`}
                >
                  <div className="text-base font-black">{v.name}</div>
                  <div
                    className={`text-sm font-bold ${
                      variantId === v.id ? 'text-white/90' : 'text-orange-600'
                    }`}
                  >
                    {formatYen(v.price)}
                  </div>
                </button>
              ))}
            </div>
          )}

          {currentStep?.kind === 'set-slot' && (
            <div className="space-y-2">
              <div className="text-sm text-gray-500 mb-3">
                {currentStep.slot.label ||
                  t(slotLabelKey(currentStep.slot.slot_type))}
                {currentStep.slot.required && (
                  <span className="text-red-500 ml-1">*</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {currentStep.options.map((o) => {
                  const isOn = slotSel[currentStep.slot.id] === o.id;
                  return (
                    <button
                      key={o.id}
                      onClick={() => {
                        setSlotSel((prev) => ({
                          ...prev,
                          [currentStep.slot.id]: o.id,
                        }));
                        setError(null);
                      }}
                      className={`p-3 rounded-xl border-2 text-left transition-all active:scale-[0.98] ${
                        isOn
                          ? 'bg-purple-500 border-purple-500 text-white shadow-md'
                          : 'bg-white border-gray-200'
                      }`}
                    >
                      <div className="text-sm font-bold truncate">
                        {o.name}
                      </div>
                      {o.short_name && (
                        <div
                          className={`text-[11px] ${
                            isOn ? 'text-white/80' : 'text-gray-500'
                          }`}
                        >
                          {o.short_name}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              {!currentStep.slot.required && (
                <button
                  onClick={() => {
                    setSlotSel((p) => ({
                      ...p,
                      [currentStep.slot.id]: '',
                    }));
                    setError(null);
                  }}
                  className="w-full py-2 text-xs text-gray-500 underline"
                >
                  {t('skip')}
                </button>
              )}
            </div>
          )}

          {currentStep?.kind === 'property' && (
            <div className="space-y-2">
              <div className="text-sm text-gray-500 mb-3">
                {currentStep.group_name ?? t('extras')}
                {currentStep.group_name !== null && (
                  <span className="text-red-500 ml-1">*</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {currentStep.props.map((p) => {
                  const key = currentStep.group_name ?? '';
                  const set = propSel[key] ?? new Set<string>();
                  const isOn = set.has(p.id);
                  const toggle = () => {
                    setPropSel((prev) => {
                      const cur = new Set(prev[key] ?? []);
                      if (currentStep.group_name !== null) {
                        cur.clear();
                        cur.add(p.id);
                      } else {
                        if (cur.has(p.id)) cur.delete(p.id);
                        else cur.add(p.id);
                      }
                      return { ...prev, [key]: cur };
                    });
                    setError(null);
                  };
                  return (
                    <button
                      key={p.id}
                      onClick={toggle}
                      className={`p-3 rounded-xl border-2 text-left transition-all active:scale-[0.98] flex items-center gap-2 ${
                        isOn
                          ? 'bg-green-500 border-green-500 text-white shadow-md'
                          : 'bg-white border-gray-200'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          isOn ? 'bg-white border-white' : 'border-gray-300'
                        }`}
                      >
                        {isOn && (
                          <Check className="w-3 h-3 text-green-600" />
                        )}
                      </div>
                      <div className="text-sm font-bold flex-1">
                        {p.name}
                      </div>
                      {p.price > 0 && (
                        <div
                          className={`text-xs font-bold ${
                            isOn ? 'text-white/90' : 'text-gray-500'
                          }`}
                        >
                          +{formatYen(p.price)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
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
            {stepIndex === steps.length - 1 ? (
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

// ============================================================
// Хелперы
// ============================================================
function resolveSlotOptions(
  slot: MenuSetSlot,
  allItems: MenuItem[]
): MenuItem[] {
  if (slot.fixed_item_id) {
    const f = allItems.find((i) => i.id === slot.fixed_item_id);
    return f ? [f] : [];
  }
  if (slot.source_category_id) {
    return allItems.filter(
      (i) => i.category_id === slot.source_category_id && i.active
    );
  }
  return [];
}

function stepLabel(
  step: Step | undefined,
  t: (k: TranslationKey) => string
): string {
  if (!step) return '';
  if (step.kind === 'variant') return t('chooseVariant');
  if (step.kind === 'set-slot') return t(slotLabelKey(step.slot.slot_type));
  if (step.kind === 'property') return step.group_name ?? t('extras');
  return '';
}

function slotLabelKey(type: 'drink' | 'sauce' | 'extra'): TranslationKey {
  if (type === 'drink') return 'chooseDrink';
  if (type === 'sauce') return 'chooseSauce';
  return 'chooseExtra';
}