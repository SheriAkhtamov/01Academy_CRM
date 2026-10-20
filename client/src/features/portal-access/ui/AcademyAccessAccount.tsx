import { KeyRound } from 'lucide-react';
import type { AcademyPortalAccount } from '@shared/contracts/academy-portal-access';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const statusKeys: Record<AcademyPortalAccount['status'], TranslationKey> = {
  active: 'academyAccessIssued',
  pending: 'academyAccessNotIssued',
  suspended: 'academyAccessSuspended',
  archived: 'academyAccessArchived',
};
const statusVariants = {
  active: 'success', pending: 'warning', suspended: 'destructive', archived: 'secondary',
} as const;

export function AcademyAccessStatus({ status }: { status: AcademyPortalAccount['status'] }) {
  const { t } = useTranslation();
  return <Badge variant={statusVariants[status]} className="shrink-0">{t(statusKeys[status])}</Badge>;
}

export function AcademyAccessAccount({ account, onOpen }: { account: AcademyPortalAccount; onOpen: () => void }) {
  const { t } = useTranslation();
  const available = account.status === 'active' || account.status === 'pending';
  return <div className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="min-w-0 break-all font-mono text-sm">{account.login}</span>
      <AcademyAccessStatus status={account.status} />
    </div>
    {available && <Button type="button" variant="outline" size="sm" className="h-auto min-h-10 max-w-full gap-2 whitespace-normal text-left" onClick={onOpen}>
      <KeyRound className="size-4 shrink-0" aria-hidden="true" />
      {t(account.status === 'pending' ? 'academyAccessIssue' : 'academyAccessShowCredentials')}
    </Button>}
  </div>;
}
