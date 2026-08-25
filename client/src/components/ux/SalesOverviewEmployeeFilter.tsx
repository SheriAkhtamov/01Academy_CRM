import { UserCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

interface SalesOverviewEmployeeFilterProps {
  value: string;
  managers: Array<{ id: number; fullName: string }>;
  canViewAllManagers: boolean;
  onChange: (managerId: string) => void;
  className?: string;
}

export function SalesOverviewEmployeeFilter({
  value,
  managers,
  canViewAllManagers,
  onChange,
  className,
}: SalesOverviewEmployeeFilterProps) {
  const { t } = useTranslation();

  return (
    <Card className={cn('border-border/60 bg-card shadow-sm', className)}>
      <CardContent className="flex h-full flex-col gap-2.5 p-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UserCheck className="size-4" aria-hidden="true" />
          </span>
          <p className="text-xs font-semibold">{t('salesOverviewManager')}</p>
        </div>
        <Select value={value} disabled={!canViewAllManagers} onValueChange={onChange}>
          <SelectTrigger
            className="h-11 w-full sm:w-[220px]"
            aria-label={t('salesOverviewManager')}
          >
            <SelectValue placeholder={t('selectEmployee')} />
          </SelectTrigger>
          <SelectContent>
            {canViewAllManagers ? (
              <SelectItem value="all">{t('allManagers')}</SelectItem>
            ) : null}
            <SelectGroup>
              {managers.map((manager) => (
                <SelectItem key={manager.id} value={String(manager.id)}>
                  {manager.fullName}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
