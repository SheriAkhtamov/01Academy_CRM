import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LogOut, Pencil, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import ConfirmDialog from '@/components/ConfirmDialog';
import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { chatGroupKeys, chatGroupsApi } from '@/features/messages/chat-groups-api';
import type { ChatGroupDto, ChatGroupParticipantDto } from '@shared/contracts/chat-groups';
import type { TranslationKey } from '@/lib/i18n';
import { collectChatMedia, CHAT_MEDIA_CATEGORIES, type ChatMediaCategory } from '@shared/chat-media';
import { safeChatGroupPhotoUrl } from '@shared/chat-group-photo';
import { ChatGroupAvatar } from './ChatGroupAvatar';
import { ChatGroupManageDialog } from './ChatGroupManageDialog';
import { ChatGroupMediaDialog, chatMediaIcons, chatMediaLabels } from './ChatGroupMediaDialog';
import { AddChatParticipantsDialog } from './AddChatParticipantsDialog';

type Change = { kind: 'add'; ids: number[] }
  | { kind: 'remove'; id: number } | { kind: 'leave'; nextOwnerId?: number };
type Confirmation = { kind: 'remove'; participant: ChatGroupParticipantDto } | { kind: 'leave' };
const errorKeys = new Set<TranslationKey>(['chatGroupManagementDenied', 'chatGroupOwnerProtected', 'chatGroupMemberMissing',
  'chatGroupParticipantsUnavailable', 'chatGroupParticipantsLimit', 'chatGroupNextOwnerRequired', 'chatGroupNextOwnerUnavailable', 'resourceNotFound']);

export function ChatGroupDetailsDialog({ group, onClose, onLeft }: { group: ChatGroupDto; onClose: () => void; onLeft: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [mediaCategory, setMediaCategory] = useState<ChatMediaCategory>();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [nextOwner, setNextOwner] = useState('');
  const [error, setError] = useState('');
  const query = useQuery({ queryKey: chatGroupKeys.detail(group.id), queryFn: () => chatGroupsApi.detail(group.id), refetchInterval: 15_000 });
  const detail = query.data;
  const currentName = detail?.name ?? group.name;
  const messages = useQuery({ queryKey: chatGroupKeys.messages(group.id), queryFn: () => chatGroupsApi.messages(group.id), enabled: Boolean(detail && !query.isError), refetchInterval: 15_000 });
  const catalog = useMemo(() => collectChatMedia(messages.data ?? []), [messages.data]);
  const photoUrl = safeChatGroupPhotoUrl(detail?.avatarUrl, group.id);
  const change = useMutation({
    mutationFn: (input: Change) => {
      switch (input.kind) {
        case 'add': return chatGroupsApi.addParticipants(group.id, input.ids);
        case 'remove': return chatGroupsApi.removeParticipant(group.id, input.id);
        case 'leave': return chatGroupsApi.leave(group.id, input.nextOwnerId ? { nextOwnerId: input.nextOwnerId } : {});
      }
    },
    onSuccess: async (_result, input) => {
      setError(''); setConfirmation(null);
      if (input.kind === 'leave') {
        client.setQueryData<ChatGroupDto[]>(chatGroupKeys.all, (groups = []) => groups.filter((item) => item.id !== group.id));
        onLeft();
        await client.cancelQueries({ queryKey: ['/api/chat-groups', group.id] });
        client.removeQueries({ queryKey: ['/api/chat-groups', group.id] });
        void client.invalidateQueries({ queryKey: chatGroupKeys.all });
        return;
      }
      if (input.kind === 'add') setAdding(false);
      await client.invalidateQueries({ queryKey: chatGroupKeys.all });
    },
    onError: (failure: Error & { rawMessage?: string }) => {
      const key = failure.rawMessage as TranslationKey;
      setError(t(errorKeys.has(key) ? key : 'chatGroupUpdateFailed'));
    },
  });
  const participants = detail?.participants ?? [];
  const successors = participants.filter((member) => member.id !== user?.id && member.isActive && !member.isArchived);
  const requiresOwner = detail?.createdBy === user?.id && participants.length > 1;
  const request = (next: Confirmation) => { setError(''); setNextOwner(''); setConfirmation(next); };

  return <>
    <Dialog open onOpenChange={(open) => { if (!open && !change.isPending) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <div className="min-h-0 space-y-5 overflow-y-auto p-5 sm:p-6">
        <DialogHeader className="items-center space-y-3 pt-4">
          {photoUrl ? <button type="button" aria-label={t('chatGroupPhoto')} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setPhotoOpen(true)}>
            <ChatGroupAvatar group={{ ...group, ...detail }} className="size-24" />
          </button> : <ChatGroupAvatar group={{ ...group, ...detail }} className="size-24" />}
          <DialogTitle className="break-words text-center text-xl">{currentName}</DialogTitle>
          <p className="text-center text-sm text-muted-foreground">{t('chatGroupParticipantCount', { count: detail?.participantCount ?? group.participantCount })}</p>
        </DialogHeader>
        {query.isPending ? <p>{t('loading')}</p> : null}
        {query.isError ? <div role="alert">{t('failedToLoadData')} <Button variant="outline" onClick={() => void query.refetch()}>{t('retry')}</Button></div> : null}
        {detail && !query.isError ? <>
          <div className="flex flex-wrap justify-center gap-3">
            {detail.canManage ? <Button variant="outline" disabled={change.isPending} onClick={() => { setEditing(true); setError(''); }}><Pencil className="size-4" />{t('chatGroupManage')}</Button> : null}
            <Button variant="outline" className="text-destructive" disabled={change.isPending} onClick={() => request({ kind: 'leave' })}><LogOut className="size-4" />{t('chatGroupLeave')}</Button>
          </div>
          <div className="space-y-1 border-y py-3">
            {messages.isPending ? <p>{t('loading')}</p> : messages.isError ? <div role="alert">{t('failedToLoadData')} <Button variant="outline" onClick={() => void messages.refetch()}>{t('retry')}</Button></div>
              : CHAT_MEDIA_CATEGORIES.every((key) => catalog[key].length === 0) ? <p className="py-3 text-center text-sm text-muted-foreground">{t('chatGroupMediaEmpty')}</p> : CHAT_MEDIA_CATEGORIES.filter((key) => catalog[key].length > 0).map((key) => { const Icon = chatMediaIcons[key]; return <button key={key} type="button" className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${t(chatMediaLabels[key])} ${catalog[key].length}`} onClick={() => setMediaCategory(key)}><Icon className="size-5 shrink-0 text-primary" /><span className="flex-1">{t(chatMediaLabels[key])}</span><span className="text-sm tabular-nums text-muted-foreground">{catalog[key].length}</span><ChevronRight className="size-4" /></button>; })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{t('chatGroupParticipantCount', { count: participants.length })}</h3>
            {detail.canManage ? <Button variant="outline" size="sm" disabled={change.isPending || editing || participants.length >= 100}
              onClick={() => { setAdding(true); setError(''); }}>{t('chatGroupAddParticipants')}</Button> : null}
          </div>
          <ul aria-label={t('chatGroupParticipants')} className="space-y-2">
            {participants.map((member) => <li key={member.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><EmployeeIdentity userId={member.id} name={member.fullName} avatarUrl={member.avatarUrl} className="text-sm font-medium" avatarClassName="size-9 text-xs" wrapName />{member.id === user?.id ? <span className="text-xs">{t('chatGroupYou')}</span> : null}</div>
                {member.position ? <p className="break-words text-xs text-muted-foreground">{member.position}</p> : null}
                {member.id === detail.createdBy ? <Badge variant="secondary" className="mt-1">{t('chatGroupOwner')}</Badge> : null}
              </div>
              {detail.canManage && member.id !== user?.id && member.id !== detail.createdBy ? <Button variant="ghost" size="icon"
                aria-label={t('chatGroupRemoveNamedParticipant', { name: member.fullName })} disabled={change.isPending || editing}
                onClick={() => request({ kind: 'remove', participant: member })}><Trash2 className="size-4 text-destructive" /></Button> : null}
            </li>)}
          </ul>
        </> : null}
        {error && !confirmation && !adding ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <div className="flex shrink-0 justify-end border-t p-4">
          <Button variant="outline" disabled={change.isPending} onClick={onClose}>{t('close')}</Button>
        </div>
      </DialogContent>
    </Dialog>
    {adding ? <AddChatParticipantsDialog participants={participants} pending={change.isPending} error={error}
      onClose={() => { setAdding(false); setError(''); }} onAdd={(ids) => { setError(''); change.mutate({ kind: 'add', ids }); }} /> : null}
    <ConfirmDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open) { setConfirmation(null); setError(''); } }}
      title={t(confirmation?.kind === 'remove' ? 'chatGroupRemoveParticipant' : 'chatGroupLeave')}
      description={confirmation?.kind === 'remove' ? t('chatGroupRemoveParticipantConfirm', { name: confirmation.participant.fullName }) : t('chatGroupLeaveConfirm', { name: currentName })}
      confirmLabel={t(confirmation?.kind === 'remove' ? 'chatGroupRemoveParticipant' : 'chatGroupLeave')}
      variant="destructive" isPending={change.isPending} keepOpenOnConfirm error={error}
      onConfirm={() => {
        if (confirmation?.kind === 'remove') change.mutate({ kind: 'remove', id: confirmation.participant.id });
        else if (confirmation?.kind === 'leave') {
          if (requiresOwner && !nextOwner) { setError(t('chatGroupNextOwnerRequired')); return; }
          setError(''); change.mutate({ kind: 'leave', nextOwnerId: requiresOwner ? Number(nextOwner) : undefined });
        }
      }}>
      {confirmation?.kind === 'leave' && requiresOwner ? <div className="space-y-2">
        <Label htmlFor="chat-next-owner">{t('chatGroupNextOwner')}</Label>
        <Select value={nextOwner} disabled={change.isPending} onValueChange={(value) => { setNextOwner(value); setError(''); }}>
          <SelectTrigger id="chat-next-owner"><SelectValue placeholder={t('chatGroupNextOwnerRequired')} /></SelectTrigger>
          <SelectContent>{successors.map((member) => <SelectItem key={member.id} value={String(member.id)} textValue={member.fullName}><EmployeeIdentity userId={member.id} name={member.fullName} avatarUrl={member.avatarUrl} /></SelectItem>)}</SelectContent>
        </Select>
      </div> : null}
    </ConfirmDialog>
    {editing && detail && !query.isError ? <ChatGroupManageDialog group={detail} onClose={() => setEditing(false)} /> : null}
    {mediaCategory && !messages.isError && !query.isError ? <ChatGroupMediaDialog catalog={catalog} initialCategory={mediaCategory} onClose={() => setMediaCategory(undefined)} /> : null}
    <Dialog open={photoOpen && Boolean(photoUrl) && !query.isError} onOpenChange={setPhotoOpen}><DialogContent aria-describedby={undefined} className="sm:max-w-2xl">
      <DialogHeader><DialogTitle>{t('chatGroupPhoto')}</DialogTitle></DialogHeader>
      {photoUrl ? <img src={photoUrl} alt={currentName} className="max-h-[70dvh] w-full object-contain" /> : null}
    </DialogContent></Dialog>
  </>;
}
