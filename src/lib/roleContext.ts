import { createContext } from 'react';

export type Role = 'cashier' | 'kitchen' | 'manager';

export interface RoleCtx {
  role: Role | null;
  setRole: (r: Role | null) => void;
}

export const RoleContext = createContext<RoleCtx>({
  role: null,
  setRole: () => {},
});