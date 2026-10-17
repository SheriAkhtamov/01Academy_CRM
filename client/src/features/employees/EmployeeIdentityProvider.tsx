import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EmployeeIdentity } from '@shared/contracts/employee-identity';
import { useAuth } from '@/hooks/useAuth';
import { employeeIdentitiesQueryOptions } from './employee-identities';

const emptyDirectory: ReadonlyMap<number, EmployeeIdentity> = new Map();
export const EmployeeIdentityContext = createContext(emptyDirectory);

/** A single staff-scoped query supplies every employee avatar on the page. */
export function EmployeeIdentityProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const employees = useQuery({ ...employeeIdentitiesQueryOptions, enabled: Boolean(user) });
  const directory = useMemo(() => {
    if (!user) return emptyDirectory;
    const identities = new Map((employees.data ?? []).map((employee) => [employee.id, employee]));
    identities.set(user.id, { id: user.id, fullName: user.fullName, avatarUrl: user.avatarUrl ?? null });
    return identities;
  }, [employees.data, user]);
  return <EmployeeIdentityContext.Provider value={directory}>{children}</EmployeeIdentityContext.Provider>;
}

export const useEmployeeIdentity = (id?: number | null) => useContext(EmployeeIdentityContext).get(id ?? 0);
