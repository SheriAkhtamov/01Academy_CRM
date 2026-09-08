import { ChevronDown, UserRound } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

interface SalesOverviewEmployeeFilterProps {
  value: string;
  managers: Array<{ id: number; fullName: string }>;
  canViewAllManagers: boolean;
  onChange: (managerId: string) => void;
  className?: string;
}

export function SalesOverviewEmployeeFilter({ value, managers, canViewAllManagers, onChange, className }: SalesOverviewEmployeeFilterProps) {
  const { t } = useTranslation();
  return <label className={cn('relative flex min-w-0 items-center gap-2 rounded-xl border bg-background px-3', className)}>
    <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <span className="sr-only">{t('salesOverviewManager')}</span>
    <select value={value} disabled={!canViewAllManagers} onChange={(event) => onChange(event.target.value)}
      className="h-12 w-full min-w-0 appearance-none rounded-lg bg-transparent pr-7 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-100 sm:max-w-64">
      {canViewAllManagers ? <option value="all">{t('allManagers')}</option> : null}
      {managers.map((manager) => <option key={manager.id} value={String(manager.id)} className="bg-background text-foreground">{manager.fullName}</option>)}
    </select>
    {canViewAllManagers ? <ChevronDown className="pointer-events-none absolute right-3 size-4 text-muted-foreground" aria-hidden="true" /> : null}
  </label>;
}
