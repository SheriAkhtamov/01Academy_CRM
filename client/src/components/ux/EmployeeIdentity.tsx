import { UserAvatar } from './UserAvatar';
import { useEmployeeIdentity } from '@/features/employees/EmployeeIdentityProvider';
import { cn } from '@/lib/utils';
import { safeEmployeePhotoUrl } from '@shared/user-photo';
import { EmployeeCardTrigger } from '@/features/employees/EmployeeCardTrigger';

type EmployeeIdentityProps = {
  userId?: number | null;
  name?: string | null;
  avatarUrl?: string | null;
  className?: string;
  avatarClassName?: string;
  interactive?: boolean;
  wrapName?: boolean;
  showAvatar?: boolean;
};

export function EmployeeAvatar({ userId, name, avatarUrl, className, interactive = true }: EmployeeIdentityProps) {
  const employee = useEmployeeIdentity(userId);
  const identity = employee ?? { fullName: name ?? '', avatarUrl };
  return <EmployeeCardTrigger userId={userId} name={identity.fullName} interactive={interactive} className="inline-flex shrink-0">
    <UserAvatar user={{ ...identity, avatarUrl: safeEmployeePhotoUrl(identity.avatarUrl) }} className={cn('size-7 shrink-0 text-[10px]', className)} />
  </EmployeeCardTrigger>;
}

/** Resolve by user ID only; identical employee names must never share a photo. */
export function EmployeeIdentity({ userId, name, avatarUrl, className, avatarClassName, interactive = true, wrapName = false, showAvatar = false }: EmployeeIdentityProps) {
  const employee = useEmployeeIdentity(userId);
  const fullName = employee?.fullName ?? name;
  if (!fullName) return <span className={className}>—</span>;
  if (!userId && !avatarUrl && !showAvatar) return <span className={className}>{fullName}</span>;
  const identity = employee ?? { fullName, avatarUrl };
  return <EmployeeCardTrigger userId={userId} name={fullName} interactive={interactive} className={cn('inline-flex min-w-0 max-w-full items-center gap-2 align-middle', className)}>
    <span aria-hidden="true" className="shrink-0"><UserAvatar user={{ ...identity, avatarUrl: safeEmployeePhotoUrl(identity.avatarUrl) }} className={cn('size-7 text-[10px]', avatarClassName)} /></span>
    <span className={cn('min-w-0', wrapName ? 'break-words' : 'truncate')}>{fullName}</span>
  </EmployeeCardTrigger>;
}
