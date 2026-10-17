import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmployeeIdentity } from './EmployeeIdentity';
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
  return <Select value={value} disabled={!canViewAllManagers} onValueChange={onChange}>
    <SelectTrigger aria-label={t('salesOverviewManager')} className={cn('h-12 min-w-0 rounded-xl bg-background text-sm font-medium sm:max-w-80', className)}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {canViewAllManagers ? <SelectItem value="all">{t('allManagers')}</SelectItem> : null}
      {managers.map((manager) => <SelectItem key={manager.id} value={String(manager.id)}><EmployeeIdentity userId={manager.id} name={manager.fullName} /></SelectItem>)}
    </SelectContent>
  </Select>;
}
