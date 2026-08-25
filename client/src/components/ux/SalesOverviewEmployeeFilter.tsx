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

interface SalesOverviewEmployeeFilterProps {
  value: string;
  managers: Array<{ id: number; fullName: string }>;
  canViewAllManagers: boolean;
  onChange: (managerId: string) => void;
}

export function SalesOverviewEmployeeFilter({
  value,
  managers,
  canViewAllManagers,
  onChange,
}: SalesOverviewEmployeeFilterProps) {
  const { t } = useTranslation();
  const selectedManagerName = managers.find(
    (manager) => String(manager.id) === value,
  )?.fullName;

  return (
    <Card className="h-full border-border/60 bg-card shadow-sm">
      <CardContent className="flex h-full flex-col justify-center gap-2.5 p-3 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 shrink-0 items-center gap-2.5 xl:mr-auto">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UserCheck className="size-4" aria-hidden="true" />
          </span>
          <p className="truncate text-xs font-semibold">{t('salesOverviewManager')}</p>
          {!canViewAllManagers && selectedManagerName ? (
            <span
              className="hidden max-w-[10rem] truncate rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground lg:inline-flex"
              title={selectedManagerName}
            >
              {selectedManagerName}
            </span>
          ) : null}
        </div>
        <Select value={value} disabled={!canViewAllManagers} onValueChange={onChange}>
          <SelectTrigger
            className="h-9 w-full shrink-0 text-xs sm:w-[220px] xl:w-[200px]"
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
