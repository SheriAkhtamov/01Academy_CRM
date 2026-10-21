import { useContext, type ReactNode } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { useEmployeeCard } from './employee-card-context';
import { NestedControlContext } from '@/lib/nested-control-context';
import { Button } from '@/components/ui/button';
import { ContactRound } from 'lucide-react';

export function EmployeeCardButton({ userId, name }: { userId?: number | null; name?: string | null }) {
  const open = useEmployeeCard();
  const { t } = useTranslation();
  if (!open || !userId) return null;
  return <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-haspopup="dialog"
    aria-label={t('openEmployeeCardName', { name: name || t('user') })}
    onClick={event => { event.preventDefault(); event.stopPropagation(); open(userId, event.currentTarget); }}><ContactRound className="size-4" /></Button>;
}

export function EmployeeCardTrigger({ userId, name, interactive = true, children, className }: {
  userId?: number | null; name?: string | null; interactive?: boolean; children: ReactNode; className?: string;
}) {
  const open = useEmployeeCard();
  const nested = useContext(NestedControlContext);
  const { t } = useTranslation();
  if (!open || nested || !interactive || !userId) return <span className={className}>{children}</span>;
  return <button type="button" className={cn('rounded text-left align-middle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    aria-label={t('openEmployeeCardName', { name: name || t('user') })} aria-haspopup="dialog"
    onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
    onClick={event => { event.preventDefault(); event.stopPropagation(); open(userId, event.currentTarget); }}>
    {children}
  </button>;
}
