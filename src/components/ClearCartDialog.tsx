import { ConfirmDialog } from './ConfirmDialog';
import { useI18n } from '@/locale';

/**
 * Специализированный диалог "Корзина будет очищена".
 * Используется в CashierPage перед удалением текущей корзины
 * (при редактировании другого заказа или нажатии «Новый заказ»).
 */
export function ClearCartDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();

  return (
    <ConfirmDialog
      open={open}
      message={t('cartWillBeCleared')}
      confirmLabel={t('yes')}
      variant="yellow"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}