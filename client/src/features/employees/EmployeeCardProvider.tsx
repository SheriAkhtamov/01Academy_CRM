import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { EmployeeCardContext } from './employee-card-context';

const EmployeeCardDialog = lazy(() => import('./EmployeeCardDialog'));

export function EmployeeCardProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [selected, setSelected] = useState<{ userId: number; ownerId: number; trigger?: HTMLElement } | null>(null);
  useEffect(() => { setSelected(null); }, [user?.id]);
  const open = useCallback((userId: number, trigger?: HTMLElement) => {
    if (user && Number.isSafeInteger(userId) && userId > 0) setSelected({ userId, ownerId: user.id, trigger });
  }, [user]);

  return <EmployeeCardContext.Provider value={user ? open : null}>
    {children}
    {selected && selected.ownerId === user?.id ? <Suspense fallback={null}>
      <EmployeeCardDialog key={selected.userId} userId={selected.userId} trigger={selected.trigger} onClose={() => setSelected(null)} />
    </Suspense> : null}
  </EmployeeCardContext.Provider>;
}
