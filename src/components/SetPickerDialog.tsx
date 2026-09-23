import { useEffect, useState } from 'react';
import { X, Check, Flame } from 'lucide-react';
import { useI18n } from '@/locale';
import { formatYen } from '@/locale/format';
import type {
  MenuItem,
  MenuCategory,
  CartItemOption,
} from '@/types/database';

/** Категория с уже подгруженными позициями */
export interface CategoryWithItems extends MenuCategory {
  items: MenuItem[];
}

export function SetPickerDialog({
  open,
  item,
  sauceCategory,
  drinkCategory,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  item: MenuItem | null;
  sauceCategory: CategoryWithItems | null;
  drinkCategory: CategoryWithItems | null;
  onConfirm: (options: CartItemOption[]) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [sauce, setSauce] = useState<string | null>(null);
  const [drink, setDrink] = useState<string | null>(null);
  const [error, setError] = useState(false);

  // Сброс при открытии
  useEffect(() => {
    if (open) {
      setSauce(null);
      setDrink(null);
      setError(false);
    }
  }, [open, item?.id]);

  if (!open || !item) return null;

  const handleConfirm = () => {
    if (!sauce || !drink) {
      setError(true);
      return;
    }

    const options: CartItemOption[] = [
      { type: 'sauce', name: sauce, price: 0, quantity: 1 },
      { type: 'topping', name: 'French Fries', price: 0, quantity: 1 },
      { type: 'drink', name: drink, price: 0, quantity: 1 },
    ];

    onConfirm(options);
  };

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
              {t('chooseSet')}
            </div>
            <h3 className="text-lg font-black text-gray-900 truncate">
              {item.name} {item.variant}
            </h3>
            <div className="text-sm font-bold text-orange-600">
              {formatYen(item.price)}
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-lg text-gray-400 active:bg-gray-100 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {/* Fries (auto-included) */}
          <div className="flex items-center gap-2 p-3 bg-orange-50 border-2 border-orange-200 rounded-xl">
            <div className="w-9 h-9 rounded-lg bg-orange-500 text-white flex items-center justify-center shrink-0">
              <Check className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold text-orange-900">
                {t('friesIncluded')}
              </div>
              <div className="text-[11px] text-orange-700 font-medium">
                French Fries
              </div>
            </div>
          </div>

          {/* Sauce */}
          {sauceCategory && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-xs font-black text-gray-500 uppercase tracking-wider">
                  {t('chooseSauce')}
                </span>
                <span className="text-[10px] text-red-500 font-bold">*</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {sauceCategory.items.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSauce(s.name);
                      setError(false);
                    }}
                    className={`px-3 py-3 rounded-xl border-2 text-sm font-bold transition-all active:scale-[0.97] ${
                      sauce === s.name
                        ? 'bg-orange-500 border-orange-500 text-white shadow-md shadow-orange-500/30'
                        : 'bg-white border-gray-200 text-gray-800'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Drink */}
          {drinkCategory && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-xs font-black text-gray-500 uppercase tracking-wider">
                  {t('chooseDrink')}
                </span>
                <span className="text-[10px] text-red-500 font-bold">*</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {drinkCategory.items.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      setDrink(d.name);
                      setError(false);
                    }}
                    className={`px-3 py-3 rounded-xl border-2 text-sm font-bold transition-all active:scale-[0.97] text-left leading-tight ${
                      drink === d.name
                        ? 'bg-blue-500 border-blue-500 text-white shadow-md shadow-blue-500/30'
                        : 'bg-white border-gray-200 text-gray-800'
                    }`}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-300 rounded-lg text-red-700 text-xs font-bold">
              <Flame className="w-4 h-4" />
              {t('requiredChoice')}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-200 flex gap-2 shrink-0">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl bg-gray-100 active:bg-gray-200 text-gray-800 text-sm font-bold transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!sauce || !drink}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-orange-500/30"
          >
            {t('addToCartBtn')} • {formatYen(item.price)}
          </button>
        </div>
      </div>
    </div>
  );
}