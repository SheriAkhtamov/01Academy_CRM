import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { hasLeadershipAccess } from '@shared/academy';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { Phone, Shield, UserRound } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmployeeAvatar } from '@/components/ux/EmployeeIdentity';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { formatUserModule } from '@/lib/auth';
import { getEmployeeProfile } from './employees-api';
import { LoadingRegion } from '@/components/ui/loading-region';

export default function EmployeeCardDialog({ userId, trigger, onClose }: {
  userId: number; trigger?: HTMLElement; onClose: () => void;
}) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const profile = useQuery({ queryKey: ['/api/users', 'profile', userId], queryFn: () => getEmployeeProfile(userId), staleTime: 0, retry: false });
  const employee = profile.isError ? undefined : profile.data;

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="compact-modal flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden p-0" aria-describedby={undefined} onCloseAutoFocus={event => {
      if (trigger?.isConnected) { event.preventDefault(); trigger.focus(); }
    }}>
      <DialogHeader data-topographic="card" className="compact-modal-header"><DialogTitle>{t('employeeCard')}</DialogTitle></DialogHeader>
      <div className="compact-modal-body space-y-3 overflow-y-auto overscroll-contain">
      {profile.isPending ? <LoadingRegion role="status" aria-label={t('loading')} className="space-y-4"><Skeleton className="size-20 rounded-full" /><Skeleton className="h-6 w-2/3" /><Skeleton className="h-12 w-full" /></LoadingRegion> : null}
      {profile.isError ? <div className="space-y-3" role="alert"><p>{t('employeeCardUnavailable')}</p><Button type="button" variant="outline" onClick={() => void profile.refetch()}>{t('retry')}</Button></div> : null}
      {employee ? <div className="space-y-3">
        <CompactModalSection title={t('employeeProfileSection')} icon={UserRound} tone="sky" collapsible={false} contentClassName="space-y-3">
        <div className="flex items-center gap-3">
          <EmployeeAvatar interactive={false} userId={employee.id} name={employee.fullName} avatarUrl={employee.avatarUrl} className="size-14 text-lg" />
          <div className="min-w-0 space-y-2"><h3 className="break-words text-lg font-semibold">{employee.fullName}</h3>{employee.isArchived ? <Badge variant="outline">{t('employeeArchived')}</Badge> : null}</div>
        </div>
        {employee.position ? <dl><dt className="text-sm text-muted-foreground">{t('position')}</dt><dd className="mt-1 break-words font-medium">{employee.position}</dd></dl> : null}
        </CompactModalSection>
        {employee.modules.length ? <CompactModalSection title={t('accessModules')} icon={Shield} tone="violet" collapsible={false}><div className="flex flex-wrap gap-1.5">{employee.modules.map(module => <Badge key={module} variant="secondary">{formatUserModule(module, t)}</Badge>)}</div></CompactModalSection> : null}
        {employee.phoneNumbers.length ? <CompactModalSection title={t('employeeContactsSection')} icon={Phone} tone="teal" collapsible={false}><dl><dt className="text-sm text-muted-foreground">{t('phone')}</dt><dd className="mt-1 flex flex-col items-start gap-2">{employee.phoneNumbers.map(phone => <a key={phone} className="break-all text-primary underline-offset-4 hover:underline" href={`tel:${phone.replace(/[^+\d]/g, '')}`}>{phone}</a>)}</dd></dl></CompactModalSection> : null}
      </div> : null}
      </div>
      {employee && hasLeadershipAccess(user) ? <div className="compact-modal-footer flex justify-end"><Button type="button" variant="outline" onClick={() => { onClose(); navigate(`/employees?employee=${employee.id}`); }}>{t('editUser')}</Button></div> : null}
    </DialogContent>
  </Dialog>;
}
