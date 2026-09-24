import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type PageRole = 'cashier' | 'queue' | 'kitchen' | 'manager';

/** Контейнер (слот) в верхней панели App.tsx */
export const PageActionsContext = createContext<HTMLDivElement | null>(null);

/** Текущая активная роль */
export const ActiveRoleContext = createContext<PageRole | null>(null);

/**
 * Портал в верхнюю панель App.tsx.
 *
 * Рендерит children ТОЛЬКО если текущая активная роль === forRole.
 * Это предотвращает показ кнопок от скрытых страниц
 * (Кухня, Очередь, Касса) когда открыт другой раздел.
 */
export function PageActions({
  forRole,
  children,
}: {
  forRole: PageRole;
  children: ReactNode;
}) {
  const container = useContext(PageActionsContext);
  const activeRole = useContext(ActiveRoleContext);

  if (!container) return null;
  if (activeRole !== forRole) return null;

  return createPortal(children, container);
}