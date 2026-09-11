import type { Control } from 'react-hook-form';
import type { UserFormValues } from '@/features/employees/employeeFormSchema';
import { KPI_ROLES, type KpiEmployeeAssignment, type KpiRole } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { roleKeys } from '../copy';

export function EmployeeKpiField({ control, assignment, onRoleChange }: {
  control: Control<UserFormValues>;
  assignment?: KpiEmployeeAssignment | null;
  onRoleChange?: (role: KpiRole | null) => void;
}) {
  const { t } = useTranslation();
  return <FormField control={control} name="salesKpiRole" render={({ field }) => (
    <FormItem className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <FormLabel>{t('kpiSystem')}</FormLabel>
      <Select value={field.value ?? 'none'} onValueChange={(value) => {
        const role = value === 'none' ? null : value as KpiRole;
        field.onChange(role);
        onRoleChange?.(role);
      }}>
        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
        <SelectContent>
          <SelectItem value="none">{t('kpiNotAssigned')}</SelectItem>
          {KPI_ROLES.map((role) => <SelectItem key={role} value={role}>{t(roleKeys[role])}</SelectItem>)}
        </SelectContent>
      </Select>
      <p className="text-xs leading-relaxed text-muted-foreground">{t('kpiAssignmentHint')}</p>
      {assignment?.current ? <p className="text-xs">{t('kpiCurrentAssignment').replace('{role}', assignment.current.role ? t(roleKeys[assignment.current.role]) : t('kpiNotAssigned'))}</p> : null}
      {assignment?.scheduled ? <p className="text-xs text-primary">{t('kpiAssignmentScheduled')
        .replace('{month}', assignment.scheduled.effectiveMonth)
        .replace('{role}', assignment.scheduled.role ? t(roleKeys[assignment.scheduled.role]) : t('kpiNotAssigned'))}</p> : null}
      <FormMessage />
    </FormItem>
  )} />;
}
