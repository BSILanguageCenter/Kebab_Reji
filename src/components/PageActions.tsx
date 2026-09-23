import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const PageActionsContext = createContext<HTMLDivElement | null>(null);

/**
 * Портал в верхнюю панель App.tsx.
 * Всё, что вы положите внутрь <PageActions>...</PageActions>,
 * отрендерится в общем header приложения.
 */
export function PageActions({ children }: { children: ReactNode }) {
  const container = useContext(PageActionsContext);
  if (!container) return null;
  return createPortal(children, container);
}