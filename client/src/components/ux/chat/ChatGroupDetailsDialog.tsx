import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Image as ImageIcon, LogOut, MessageCircle, Pencil, Trash2, UsersRound } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
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
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

type Change = { kind: 'add'; ids: number[] }
  | { kind: 'remove'; id: number } | { kind: 'leave'; nextOwnerId?: number };
type ChangeRequest = { input: Change; session: { groupId: number; actorId: number | undefined } };
const accessUnavailable = (error: unknown) => [401, 403, 404].includes((error as { status?: number } | null)?.status ?? 0);
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
  const changing = useRef(false);
  const session = useMemo(() => ({ groupId: group.id, actorId: user?.id }), [group.id, user?.id]);
  const currentSession = useRef(session);
  currentSession.current = session;
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const isCurrentSession = (request: ChangeRequest) => active.current && currentSession.current === request.session;
  const query = useQuery({ queryKey: chatGroupKeys.detail(group.id), queryFn: () => chatGroupsApi.detail(group.id), refetchInterval: 15_000 });
  const denied = query.isError && accessUnavailable(query.error);
  const detail = denied ? undefined : query.data;
  const currentName = detail?.name ?? group.name;
  const messages = useQuery({ queryKey: chatGroupKeys.messages(group.id), queryFn: () => chatGroupsApi.messages(group.id), enabled: Boolean(detail), refetchInterval: 15_000 });
  const mediaDenied = messages.isError && accessUnavailable(messages.error);
  useEffect(() => {
    if (denied || !detail?.canManage) {
      setEditing(false);
      setAdding(false);
      setConfirmation((current) => denied || current?.kind === 'remove' ? null : current);
    }
    if (denied) { setMediaCategory(undefined); setPhotoOpen(false); }
  }, [denied, detail?.canManage]);
  const catalog = useMemo(() => collectChatMedia(messages.data ?? []), [messages.data]);
  const photoUrl = safeChatGroupPhotoUrl(detail?.avatarUrl, group.id);
  const change = useMutation({
    mutationFn: ({ input, session: requestSession }: ChangeRequest) => {
      const groupId = requestSession.groupId;
      switch (input.kind) {
        case 'add': return chatGroupsApi.addParticipants(groupId, input.ids);
        case 'remove': return chatGroupsApi.removeParticipant(groupId, input.id);
        case 'leave': return chatGroupsApi.leave(groupId, input.nextOwnerId ? { nextOwnerId: input.nextOwnerId } : {});
      }
    },
    onSuccess: async (_result, request) => {
      const { input, session: requestSession } = request;
      const groupId = requestSession.groupId;
      if (isCurrentSession(request)) { setError(''); setConfirmation(null); }
      if (input.kind === 'leave') {
        client.setQueryData<ChatGroupDto[]>(chatGroupKeys.all, (groups = []) => groups.filter((item) => item.id !== groupId));
        if (isCurrentSession(request)) onLeft();
        await client.cancelQueries({ queryKey: ['/api/chat-groups', groupId] });
        client.removeQueries({ queryKey: ['/api/chat-groups', groupId] });
        void client.invalidateQueries({ queryKey: chatGroupKeys.all });
        return;
      }
      if (input.kind === 'add' && isCurrentSession(request)) setAdding(false);
      await client.invalidateQueries({ queryKey: chatGroupKeys.all });
    },
    onSettled: () => { changing.current = false; },
    onError: (failure: Error & { rawMessage?: string }, request) => {
      if (!isCurrentSession(request)) return;
      const key = failure.rawMessage as TranslationKey;
      setError(t(errorKeys.has(key) ? key : 'chatGroupUpdateFailed'));
    },
  });
  const perform = (input: Change) => {
    if (change.isPending || changing.current || denied || (input.kind !== 'leave' && !detail?.canManage)) return;
    changing.current = true;
    change.mutate({ input, session });
  };
  const participants = detail?.participants ?? [];
  const successors = participants.filter((member) => member.id !== user?.id && member.isActive && !member.isArchived);
  const requiresOwner = detail?.createdBy === user?.id && participants.length > 1;
  const request = (next: Confirmation) => { setError(''); setNextOwner(''); setConfirmation(next); };

  return <>
    <Dialog open onOpenChange={(open) => { if (!open && !change.isPending && !changing.current) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="compact-modal-header">
          <DialogTitle className="break-words text-base leading-6">{currentName}</DialogTitle>
        </DialogHeader>
        <div className="compact-modal-body min-h-0 space-y-3 overflow-y-auto overscroll-contain">
          <CompactModalSection title={t('group')} icon={MessageCircle} tone="sky" collapsible={false}>
            <div className="flex items-center gap-3">
              {photoUrl ? <button type="button" aria-label={t('chatGroupPhoto')} className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setPhotoOpen(true)}>
                <ChatGroupAvatar group={{ ...group, ...detail }} className="size-14" />
              </button> : <ChatGroupAvatar group={{ ...group, ...detail }} className="size-14" />}
              <p className="text-sm text-muted-foreground">{t('chatGroupParticipantCount', { count: detail?.participantCount ?? group.participantCount })}</p>
            </div>
          </CompactModalSection>
        {query.isPending ? <p><span className="inline-flex items-center gap-2"><OrbitSpinner />{t('loading')}</span></p> : null}
        {query.isError ? <div role="alert">{t('failedToLoadData')} <Button variant="outline" onClick={() => void query.refetch()}>{t('retry')}</Button></div> : null}
        {detail ? <>
          <div className="flex flex-wrap gap-2">
            {detail.canManage ? <Button variant="outline" disabled={change.isPending} onClick={() => { setEditing(true); setError(''); }}><Pencil className="size-4" />{t('chatGroupManage')}</Button> : null}
            <Button variant="outline" className="text-destructive" disabled={change.isPending} onClick={() => request({ kind: 'leave' })}><LogOut className="size-4" />{t('chatGroupLeave')}</Button>
          </div>
          <CompactModalSection title={t('chatGroupMedia')} icon={ImageIcon} tone="violet" defaultOpen contentClassName="space-y-1">
            {messages.isPending ? <p><span className="inline-flex items-center gap-2"><OrbitSpinner />{t('loading')}</span></p> : messages.isError ? <div role="alert">{t('failedToLoadData')} <Button variant="outline" onClick={() => void messages.refetch()}>{t('retry')}</Button></div>
              : CHAT_MEDIA_CATEGORIES.every((key) => catalog[key].length === 0) ? <p className="py-3 text-center text-sm text-muted-foreground">{t('chatGroupMediaEmpty')}</p> : CHAT_MEDIA_CATEGORIES.filter((key) => catalog[key].length > 0).map((key) => { const Icon = chatMediaIcons[key]; return <button key={key} type="button" className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${t(chatMediaLabels[key])} ${catalog[key].length}`} onClick={() => setMediaCategory(key)}><Icon className="size-5 shrink-0 text-primary" /><span className="flex-1">{t(chatMediaLabels[key])}</span><span className="text-sm tabular-nums text-muted-foreground">{catalog[key].length}</span><ChevronRight className="size-4" /></button>; })}
          </CompactModalSection>
          <CompactModalSection title={t('chatGroupParticipants')} icon={UsersRound} tone="teal" count={participants.length} defaultOpen actions={detail.canManage ? <Button variant="outline" size="sm" disabled={change.isPending || editing || participants.length >= 100}
              onClick={() => { setAdding(true); setError(''); }}>{t('chatGroupAddParticipants')}</Button> : null}>
          <ul aria-label={t('chatGroupParticipants')} className="space-y-2">
            {participants.map((member) => <li key={member.id} className="flex items-center gap-3 rounded-lg border p-2">
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
          </CompactModalSection>
        </> : null}
        {error && !confirmation && !adding ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <div className="compact-modal-footer flex justify-end">
          <Button variant="outline" disabled={change.isPending} onClick={onClose}>{t('close')}</Button>
        </div>
      </DialogContent>
    </Dialog>
    {adding && detail?.canManage ? <AddChatParticipantsDialog participants={participants} pending={change.isPending} error={error}
      onClose={() => { setAdding(false); setError(''); }} onAdd={(ids) => { setError(''); perform({ kind: 'add', ids }); }} /> : null}
    <ConfirmDialog compact open={Boolean(confirmation) && !denied} onOpenChange={(open) => { if (!open) { setConfirmation(null); setError(''); } }}
      title={t(confirmation?.kind === 'remove' ? 'chatGroupRemoveParticipant' : 'chatGroupLeave')}
      description={confirmation?.kind === 'remove' ? t('chatGroupRemoveParticipantConfirm', { name: confirmation.participant.fullName }) : t('chatGroupLeaveConfirm', { name: currentName })}
      confirmLabel={t(confirmation?.kind === 'remove' ? 'chatGroupRemoveParticipant' : 'chatGroupLeave')}
      variant="destructive" isPending={change.isPending} keepOpenOnConfirm error={error}
      onConfirm={() => {
        if (confirmation?.kind === 'remove') perform({ kind: 'remove', id: confirmation.participant.id });
        else if (confirmation?.kind === 'leave') {
          if (requiresOwner && !nextOwner) { setError(t('chatGroupNextOwnerRequired')); requestAnimationFrame(() => document.getElementById('chat-next-owner')?.focus()); return; }
          setError(''); perform({ kind: 'leave', nextOwnerId: requiresOwner ? Number(nextOwner) : undefined });
        }
      }}>
      {confirmation?.kind === 'leave' && requiresOwner ? <div className="space-y-2">
        <Label htmlFor="chat-next-owner">{t('chatGroupNextOwner')}</Label>
        <Select value={nextOwner} disabled={change.isPending} onValueChange={(value) => { setNextOwner(value); setError(''); }}>
          <SelectTrigger id="chat-next-owner"><SelectValue /></SelectTrigger>
          <SelectContent>{successors.map((member) => <SelectItem key={member.id} value={String(member.id)} textValue={member.fullName}><EmployeeIdentity userId={member.id} name={member.fullName} avatarUrl={member.avatarUrl} /></SelectItem>)}</SelectContent>
        </Select>
      </div> : null}
    </ConfirmDialog>
    {editing && detail?.canManage ? <ChatGroupManageDialog group={detail} onClose={() => setEditing(false)} /> : null}
    {mediaCategory && detail && !mediaDenied ? <ChatGroupMediaDialog catalog={catalog} initialCategory={mediaCategory} onClose={() => setMediaCategory(undefined)} /> : null}
    <Dialog open={photoOpen && Boolean(photoUrl) && !denied} onOpenChange={setPhotoOpen}><DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-2xl">
      <DialogHeader className="compact-modal-header"><DialogTitle className="text-base leading-6">{t('chatGroupPhoto')}</DialogTitle></DialogHeader>
      {photoUrl ? <div className="compact-modal-body min-h-0 overflow-y-auto"><img src={photoUrl} alt={currentName} className="max-h-[70dvh] w-full object-contain" /></div> : null}
    </DialogContent></Dialog>
  </>;
}
