import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { getInitials } from '@/lib/auth';
import { safeUserPhotoUrl } from '@shared/user-photo';

export function UserAvatar({ user, className }: { user?: { fullName?: string; avatarUrl?: string | null } | null; className?: string }) {
  return <Avatar className={className}>
    <AvatarImage src={safeUserPhotoUrl(user?.avatarUrl)} alt={user?.fullName ?? ''} className="object-cover" />
    <AvatarFallback className="font-semibold text-white" style={{ background: 'linear-gradient(135deg, var(--brand-gradient-from), var(--brand-gradient-to))' }}>
      {getInitials(user?.fullName ?? '')}
    </AvatarFallback>
  </Avatar>;
}
