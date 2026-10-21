import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { boardTransportSession, hasMiniBoardSession, subscribeBoardTransportSession } from '@/features/board/transport';
import { fetchMiniBoardUserPhoto } from '@/features/board/user-photo';
import { safeEmployeePhotoUrl } from '@shared/user-photo';
import { useEmployeeIdentity } from '@/features/employees/EmployeeIdentityProvider';
import { EmployeeCardTrigger } from '@/features/employees/EmployeeCardTrigger';

interface BoardUserAvatarProps {
  user?: { id?: number; fullName?: string; avatarUrl?: string | null } | null;
  className?: string;
  miniMode?: boolean;
}

function MiniPhotoImage({ photoUrl }: { photoUrl: string }) {
  const session = useSyncExternalStore(subscribeBoardTransportSession, boardTransportSession, boardTransportSession);
  const photo = useQuery({
    queryKey: ['board-user-photo', session, photoUrl],
    queryFn: ({ signal }) => fetchMiniBoardUserPhoto(photoUrl, signal),
    enabled: hasMiniBoardSession(),
    retry: false,
    staleTime: Infinity,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const [image, setImage] = useState<{ blob: Blob; session: number; photoUrl: string; src: string }>();
  useEffect(() => {
    if (!photo.data) return;
    const src = URL.createObjectURL(photo.data);
    setImage({ blob: photo.data, session, photoUrl, src });
    return () => URL.revokeObjectURL(src);
  }, [photo.data, session, photoUrl]);
  // Do not keep a previous person's/session's image visible while the next one loads.
  const src = image && image.blob === photo.data && image.session === session && image.photoUrl === photoUrl ? image.src : undefined;
  return <AvatarImage src={src} alt="" draggable={false} />;
}

export function BoardUserAvatar({ user, className, miniMode = false }: BoardUserAvatarProps) {
  const identity = useEmployeeIdentity(miniMode ? undefined : user?.id) ?? user;
  const name = identity?.fullName?.trim();
  const photoUrl = safeEmployeePhotoUrl(identity?.avatarUrl);
  return (
    <Avatar aria-hidden="true" className={cn('size-6 border border-border', className)}>
      {miniMode && photoUrl ? <MiniPhotoImage key={photoUrl} photoUrl={photoUrl} />
        : <AvatarImage src={miniMode ? undefined : photoUrl} alt="" draggable={false} />}
      <AvatarFallback className={cn('text-[10px] font-semibold', name ? 'bg-primary/10 text-primary-700' : 'bg-muted text-muted-foreground')}>
        {name ? getInitials(name) : <UserRound className="size-3" />}
      </AvatarFallback>
    </Avatar>
  );
}

export function BoardUserIdentity({ user, miniMode = false, className, avatarClassName }: BoardUserAvatarProps & { avatarClassName?: string }) {
  const identity = useEmployeeIdentity(miniMode ? undefined : user?.id) ?? user;
  return <EmployeeCardTrigger userId={user?.id} name={identity?.fullName} interactive={!miniMode} className={cn('inline-flex min-w-0 max-w-full items-center gap-2 align-middle', className)}>
    {identity ? <BoardUserAvatar user={identity} miniMode={miniMode} className={avatarClassName} /> : null}
    <span className="min-w-0 truncate">{identity?.fullName || '—'}</span>
  </EmployeeCardTrigger>;
}
