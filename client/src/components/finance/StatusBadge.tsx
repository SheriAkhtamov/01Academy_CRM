import { Badge } from '@/components/ui/badge';
import type { financeCopy } from '@/lib/financeCenter';

export function StatusBadge({ status, copy }: { status: string; copy: ReturnType<typeof financeCopy> }) {
  const statusMap: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' | 'outline' }> = {
    paid: { label: copy.paid, variant: 'success' },
    pending: { label: copy.pending, variant: 'warning' },
    planned: { label: copy.planned, variant: 'warning' },
    approved: { label: copy.approved, variant: 'success' },
    cancelled: { label: copy.cancelled, variant: 'secondary' },
    refunded: { label: copy.refunded, variant: 'secondary' },
    unconfigured: { label: copy.unconfigured, variant: 'outline' },
  };
  const item = statusMap[status] ?? { label: status || copy.recorded, variant: 'outline' as const };
  return <Badge variant={item.variant}>{item.label}</Badge>;
}
