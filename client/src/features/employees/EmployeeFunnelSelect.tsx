import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/hooks/useTranslation';
import type { SalesFunnel } from '@/features/sales-funnels/api';

type Props = Omit<ComponentPropsWithoutRef<typeof Button>, 'value' | 'onChange'> & {
  funnels: Pick<SalesFunnel, 'id' | 'name' | 'isActive' | 'workflowRole'>[]; value: number[]; onChange: (value: number[]) => void;
};
export const EmployeeFunnelSelect = forwardRef<HTMLButtonElement, Props>(({ funnels, value, onChange, ...props }, ref) => {
  const { t } = useTranslation();
  const selected = funnels.filter((funnel) => value.includes(funnel.id)).map((funnel) => funnel.name).join(', ');
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button {...props} ref={ref} type="button" variant="outline" className="h-auto min-h-10 w-full justify-between gap-2 bg-background text-left font-normal" title={selected || undefined}>
        <span className="min-w-0 flex-1 truncate">{selected || t('selectSalesFunnels')}</span><ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-2rem)]">
      {funnels.map((funnel) => <DropdownMenuCheckboxItem key={funnel.id} checked={value.includes(funnel.id)} disabled={!funnel.isActive && !value.includes(funnel.id)}
        onSelect={(event) => event.preventDefault()} onCheckedChange={(checked) => onChange(checked ? [...new Set([...value, funnel.id])] : value.filter((id) => id !== funnel.id))}>
        <span className="min-w-0 flex-1 break-words">{funnel.name}</span>
        {funnel.workflowRole ? <Badge variant="outline" className="ml-2 shrink-0">{t(funnel.workflowRole === 'closer' ? 'kpiCloser' : 'kpiHunter')}</Badge> : null}
        {!funnel.isActive ? <Badge variant="secondary" className="ml-2 shrink-0">{t('inactive')}</Badge> : null}
      </DropdownMenuCheckboxItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
});
EmployeeFunnelSelect.displayName = 'EmployeeFunnelSelect';
