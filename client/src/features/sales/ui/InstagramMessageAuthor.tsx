import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { useTranslation } from '@/hooks/useTranslation';
import { getInitials } from '@/lib/auth';

export function InstagramMessageAuthor({ sentBy, employee, accountUsername, accountPhotoUrl }: {
  sentBy?: number | null;
  employee?: { fullName: string; avatarUrl?: string | null } | null;
  accountUsername?: string | null;
  accountPhotoUrl?: string | null;
}) {
  const { t } = useTranslation();
  if (sentBy != null) return <EmployeeIdentity userId={sentBy} name={employee?.fullName ?? t('financeCenterEmployee')}
    avatarUrl={employee?.avatarUrl} className="mb-1 text-xs text-muted-foreground" avatarClassName="size-6 text-[9px]" />;
  const name = accountUsername ? `@${accountUsername.replace(/^@/, '')}` : t('socialNetworkInstagram');
  return <span className="mb-1 inline-flex min-w-0 max-w-full items-center gap-2 text-xs text-muted-foreground">
    <Avatar className="size-6 text-[9px]" aria-hidden="true">
      <AvatarImage src={accountPhotoUrl ? `/api/instagram/media-proxy?url=${encodeURIComponent(accountPhotoUrl)}` : undefined} alt="" />
      <AvatarFallback>{getInitials(accountUsername ?? name)}</AvatarFallback>
    </Avatar>
    <span className="truncate">{name}</span>
  </span>;
}
