import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import ConfirmDialog from '@/components/ConfirmDialog';
import { UserAvatar } from '@/components/ux/UserAvatar';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { chatGroupKeys, chatGroupsApi } from '@/features/messages/chat-groups-api';
import type { ChatGroupDto, ChatGroupParticipantDto } from '@shared/contracts/chat-groups';
import type { TranslationKey } from '@/lib/i18n';
import { AddChatParticipantsDialog } from './AddChatParticipantsDialog';

type Change = { kind: 'rename'; name: string } | { kind: 'add'; ids: number[] }
  | { kind: 'remove'; id: number } | { kind: 'leave'; nextOwnerId?: number };
type Confirmation = { kind: 'remove'; participant: ChatGroupParticipantDto } | { kind: 'leave' };
const errorKeys = new Set<TranslationKey>(['chatGroupManagementDenied', 'chatGroupOwnerProtected', 'chatGroupMemberMissing',
  'chatGroupParticipantsUnavailable', 'chatGroupParticipantsLimit', 'chatGroupNextOwnerRequired', 'chatGroupNextOwnerUnavailable', 'resourceNotFound']);

export function ChatGroupDetailsDialog({ group, onClose, onLeft }: { group: ChatGroupDto; onClose: () => void; onLeft: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [adding, setAdding] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [nextOwner, setNextOwner] = useState('');
  const [error, setError] = useState('');
  const query = useQuery({ queryKey: chatGroupKeys.detail(group.id), queryFn: () => chatGroupsApi.detail(group.id), refetchInterval: 15_000 });
  const detail = query.data;
  const currentName = detail?.name ?? group.name;
  useEffect(() => { if (!editing) setName(currentName); }, [currentName, editing]);
  const change = useMutation({
    mutationFn: (input: Change) => {
      switch (input.kind) {
        case 'rename': return chatGroupsApi.rename(group.id, input.name);
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
      if (input.kind === 'rename') setEditing(false);
      if (input.kind === 'add') setAdding(false);
      await client.invalidateQueries({ queryKey: chatGroupKeys.all });
    },
    onError: (failure: Error & { rawMessage?: string }) => {
      const key = failure.rawMessage as TranslationKey;
      setError(t(errorKeys.has(key) ? key : 'chatGroupUpdateFailed'));
    },
  });
  const guard = useUnsavedChangesGuard({ open: true, isDirty: editing && name !== currentName, isPending: change.isPending,
    onOpenChange: (open) => { if (!open) onClose(); } });
  const participants = detail?.participants ?? [];
  const successors = participants.filter((member) => member.id !== user?.id && member.isActive && !member.isArchived);
  const requiresOwner = detail?.createdBy === user?.id && participants.length > 1;
  const request = (next: Confirmation) => { setError(''); setNextOwner(''); setConfirmation(next); };

  return <>
    <Dialog open onOpenChange={guard.handleOpenChange}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader><DialogTitle className="break-words">{currentName}</DialogTitle></DialogHeader>
        {query.isPending ? <p>{t('loading')}</p> : null}
        {query.isError ? <div role="alert">{t('failedToLoadData')} <Button variant="outline" onClick={() => void query.refetch()}>{t('retry')}</Button></div> : null}
        {detail && !query.isError ? <>
          {detail.canManage ? editing ? <form className="space-y-2" onSubmit={(event) => {
            event.preventDefault(); if (!name.trim()) { setError(t('chatGroupNameRequired')); return; }
            setError(''); change.mutate({ kind: 'rename', name: name.trim() });
          }}>
            <Label htmlFor="edit-chat-group-name">{t('groupName')}</Label>
            <Input id="edit-chat-group-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} disabled={change.isPending} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={change.isPending} onClick={() => guard.requestAction(() => { setEditing(false); setError(''); })}>{t('cancel')}</Button>
              <Button type="submit" disabled={change.isPending || name === currentName}>{t(change.isPending ? 'saving' : 'saveChanges')}</Button>
            </div>
          </form> : <Button variant="outline" className="self-start" disabled={change.isPending} onClick={() => { setEditing(true); setError(''); }}>
            <Pencil className="size-4" />{t('editGroup')}
          </Button> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{t('chatGroupParticipantCount', { count: participants.length })}</h3>
            {detail.canManage ? <Button variant="outline" size="sm" disabled={change.isPending || editing || participants.length >= 100}
              onClick={() => { setAdding(true); setError(''); }}>{t('chatGroupAddParticipants')}</Button> : null}
          </div>
          <ul aria-label={t('chatGroupParticipants')} className="min-h-0 space-y-2 overflow-y-auto">
            {participants.map((member) => <li key={member.id} className="flex items-center gap-3 rounded-lg border p-3">
              <UserAvatar user={member} className="size-9 shrink-0 text-xs" />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">{member.fullName}{member.id === user?.id ? <span className="ml-2 text-xs">{t('chatGroupYou')}</span> : null}</p>
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
        <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t pt-4">
          <Button variant="outline" className="text-destructive" disabled={change.isPending || !detail || query.isError || editing}
            onClick={() => request({ kind: 'leave' })}>{t('chatGroupLeave')}</Button>
          <Button variant="outline" disabled={change.isPending} onClick={() => guard.handleOpenChange(false)}>{t('close')}</Button>
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
        <select id="chat-next-owner" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={nextOwner}
          disabled={change.isPending} onChange={(event) => { setNextOwner(event.target.value); setError(''); }}>
          <option value="">{t('chatGroupNextOwnerRequired')}</option>
          {successors.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
        </select>
      </div> : null}
    </ConfirmDialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
