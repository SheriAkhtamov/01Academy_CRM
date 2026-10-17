import { UserAvatar } from './UserAvatar';
import { useEmployeeIdentity } from '@/features/employees/EmployeeIdentityProvider';
import { cn } from '@/lib/utils';
import { safeEmployeePhotoUrl } from '@shared/user-photo';

type EmployeeIdentityProps = {
  userId?: number | null;
  name?: string | null;
  avatarUrl?: string | null;
  className?: string;
  avatarClassName?: string;
};

export function EmployeeAvatar({ userId, name, avatarUrl, className }: EmployeeIdentityProps) {
  const employee = useEmployeeIdentity(userId);
  const identity = employee ?? { fullName: name ?? '', avatarUrl };
  return <UserAvatar user={{ ...identity, avatarUrl: safeEmployeePhotoUrl(identity.avatarUrl) }} className={cn('size-7 shrink-0 text-[10px]', className)} />;
}

/** Resolve by user ID only; identical employee names must never share a photo. */
export function EmployeeIdentity({ userId, name, avatarUrl, className, avatarClassName }: EmployeeIdentityProps) {
  const employee = useEmployeeIdentity(userId);
  const fullName = employee?.fullName ?? name;
  if (!fullName) return <span className={className}>—</span>;
  if (!userId && !avatarUrl) return <span className={className}>{fullName}</span>;
  const identity = employee ?? { fullName, avatarUrl };
  return <span className={cn('inline-flex min-w-0 max-w-full items-center gap-2 align-middle', className)}>
    <span aria-hidden="true" className="shrink-0"><UserAvatar user={{ ...identity, avatarUrl: safeEmployeePhotoUrl(identity.avatarUrl) }} className={cn('size-7 text-[10px]', avatarClassName)} /></span>
    <span className="min-w-0 truncate">{fullName}</span>
  </span>;
}
