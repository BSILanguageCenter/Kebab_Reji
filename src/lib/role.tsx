import { createContext, useContext, useState, ReactNode } from 'react';

export type Role = 'cashier' | 'kitchen' | 'manager';

interface RoleCtx {
  role: Role | null;
  setRole: (r: Role | null) => void;
}

const Ctx = createContext<RoleCtx>({ role: null, setRole: () => {} });

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role | null>(
    () => (localStorage.getItem('app_role') as Role) || null
  );
  const setRole = (r: Role | null) => {
    setRoleState(r);
    if (r) localStorage.setItem('app_role', r);
    else localStorage.removeItem('app_role');
  };
  return <Ctx.Provider value={{ role, setRole }}>{children}</Ctx.Provider>;
}

export const useRole = () => useContext(Ctx);