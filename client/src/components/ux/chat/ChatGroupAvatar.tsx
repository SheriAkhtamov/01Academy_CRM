import { UsersRound } from 'lucide-react';
import type { ChatGroupDto } from '@shared/contracts/chat-groups';
import { safeChatGroupPhotoUrl } from '@shared/chat-group-photo';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
export function ChatGroupAvatar({ group, className }: { group: Pick<ChatGroupDto, 'id' | 'name' | 'avatarUrl'>; className?: string }) {
  return <Avatar className={className}>
    <AvatarImage src={safeChatGroupPhotoUrl(group.avatarUrl, group.id)} alt={group.name} className="object-cover" />
    <AvatarFallback className="bg-primary/10 text-primary"><UsersRound className="h-1/2 w-1/2" aria-hidden /></AvatarFallback>
  </Avatar>;
}
