import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Paperclip, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { formatAcademyDate } from '@/lib/localeFormat';
import { chatGroupsApi, chatGroupKeys } from '@/features/messages/chat-groups-api';
import { MAX_MESSAGE_FILE_BYTES, MAX_MESSAGE_FILES } from '@shared/contracts/messages';
import type { ChatGroupDto, GroupMessageDto } from '@shared/contracts/chat-groups';
import { ChatFileDrafts, ChatMessageAttachments } from './ChatAttachments';
import { EmployeeAvatar } from '@/components/ux/EmployeeIdentity';
import { ChatGroupAvatar } from './ChatGroupAvatar';
import { ChatGroupDetailsDialog } from './ChatGroupDetailsDialog';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';
import { TypingIndicator } from '@/components/ui/typing-indicator';
import { useChatTyping } from '@/features/messages/useChatTyping';

type Draft = { text: string; files: File[] };
const EMPTY_DRAFT: Draft = { text: '', files: [] };
export function GroupChatThread({ group, active = true }: { group: ChatGroupDto | null; active?: boolean }) {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const { isTyping, reportTyping, stopTyping } = useChatTyping('group', group?.id ?? null, active);
  const client = useQueryClient();
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [readError, setReadError] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastReadAttempt = useRef('');
  const query = useQuery({ queryKey: chatGroupKeys.messages(group?.id ?? 0), queryFn: () => chatGroupsApi.messages(group!.id), enabled: Boolean(group), refetchInterval: group ? 15_000 : false });
  const draft = group ? drafts[group.id] ?? EMPTY_DRAFT : EMPTY_DRAFT;
  const read = useMutation({ mutationFn: ({ groupId, messageId }: { groupId: number; messageId: number }) => chatGroupsApi.read(groupId, messageId),
    onSuccess: () => { setReadError(false); void client.invalidateQueries({ queryKey: chatGroupKeys.all }); },
    onError: () => setReadError(true),
  });
  const { mutate: markRead } = read;
  const latestId = query.data?.at(-1)?.id;
  useEffect(() => {
    setReadError(false);
    setDetailsOpen(false);
    lastReadAttempt.current = '';
  }, [group?.id]);
  useEffect(() => {
    if (!group || !latestId) return;
    const key = `${group.id}:${latestId}`;
    if (lastReadAttempt.current === key) return;
    lastReadAttempt.current = key;
    markRead({ groupId: group.id, messageId: latestId });
  }, [group, latestId, markRead]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end', behavior: 'auto' }); }, [group?.id, query.isLoading]);
  useEffect(() => {
    const viewport = bottom.current?.closest('[data-radix-scroll-area-viewport]');
    if (viewport && viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight<320) bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [latestId]);
  const send = useMutation({
    mutationFn: ({ groupId, text, files }: { groupId: number } & Draft) => chatGroupsApi.send(groupId, text, files),
    onSuccess: (message, variables) => {
      client.setQueryData<GroupMessageDto[]>(chatGroupKeys.messages(variables.groupId), (current = []) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      setDrafts((current) => { const existing = current[variables.groupId] ?? EMPTY_DRAFT; return { ...current, [variables.groupId]: {
        text: existing.text === variables.text ? '' : existing.text,
        files: existing.files.filter((file) => !variables.files.includes(file)),
      } }; });
      void client.invalidateQueries({ queryKey: chatGroupKeys.all });
    },
    onError: () => toast({ title: t('messageSendFailed'), variant: 'destructive' }),
  });
  if (!group) return null;
  const setDraft = (next: Partial<Draft>) => setDrafts((current) => ({ ...current, [group.id]: { ...(current[group.id] ?? EMPTY_DRAFT), ...next } }));
  const submit = () => {
    if (send.isPending || (!draft.text.trim() && !draft.files.length)) return;
    stopTyping();
    send.mutate({ groupId: group.id, ...draft });
  };
  return <div className="flex min-h-0 flex-1 flex-col">
    <button type="button" className="flex w-full shrink-0 items-center gap-3 border-b bg-teal-50/60 p-3 text-left dark:bg-teal-950/20 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setDetailsOpen(true)} aria-haspopup="dialog" aria-label={t('chatGroupDetails')}>
      <ChatGroupAvatar group={group} className="size-10 shrink-0" /><div className="min-w-0 flex-1">
      <h3 className="truncate font-medium">{group.name}</h3><p className="text-xs text-muted-foreground">{t('chatGroupParticipantCount').replace('{count}', String(group.participantCount))}</p>
    </div><ChevronDown className="size-4 shrink-0" /></button>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-3 p-4">
      {query.isLoading ? <OrbitSpinner className="size-6" aria-label={t('loading')} /> : null}
      {query.isError ? <div role="alert">{t('failedToLoadData')} <Button variant="outline" onClick={() => void query.refetch()}>{t('retry')}</Button></div> : null}
      {readError ? <div role="alert">{t('updateFailed')} <Button variant="outline" onClick={() => { if (latestId) markRead({ groupId: group.id, messageId: latestId }); }}>{t('retry')}</Button></div> : null}
      {(query.isError ? [] : query.data ?? []).map((message) => <div key={message.id} className={`flex items-end gap-2 ${message.senderId===user?.id ? 'justify-end' : 'justify-start'}`}>
        {message.senderId !== user?.id ? <EmployeeAvatar userId={message.senderId} name={message.senderName || t('chatDeletedEmployee')} avatarUrl={message.senderAvatarUrl} className="size-8 text-xs" /> : null}
        <div className={`min-w-0 max-w-[85%] rounded-xl px-3 py-2 text-sm [overflow-wrap:anywhere] ${message.senderId===user?.id ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
          {message.senderId!==user?.id ? <p className="mb-1 font-medium">{message.senderName || t('chatDeletedEmployee')}</p> : null}
          {message.content ? <p className="whitespace-pre-wrap break-words">{message.content}</p> : null}
          {message.attachments?.length ? <ChatMessageAttachments attachments={message.attachments} /> : null}
          <p className="mt-1 text-right text-[10px] opacity-70">{formatAcademyDate(message.createdAt, language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      </div>)}
      {!query.isLoading && !query.isError && query.data?.length===0 ? <p className="py-8 text-center text-sm text-muted-foreground">{t('noMessagesYet')}</p> : null}
      <div ref={bottom} aria-hidden="true" />
    </div></ScrollArea>
    <div className="compact-modal-footer shrink-0">
      <ChatFileDrafts files={draft.files} disabled={send.isPending} onRemove={(file) => setDraft({ files: draft.files.filter((item) => item!==file) })} />
      <input ref={fileInput} type="file" multiple className="sr-only" aria-label={t('attachmentsLabel')} disabled={send.isPending} onChange={(event) => {
        const added = Array.from(event.target.files ?? []); event.target.value='';
        if (draft.files.length+added.length>MAX_MESSAGE_FILES) { toast({ title: t('messageFileLimit'), variant: 'destructive' }); return; }
        if (added.some((file) => file.size>MAX_MESSAGE_FILE_BYTES)) { toast({ title: t('messageFileTooLarge'), variant: 'destructive' }); return; }
        setDraft({ files: [...draft.files,...added] });
      }} />
      <div className="flex h-6 items-center text-muted-foreground"><TypingIndicator active={isTyping} /></div>
      <div className="flex gap-2"><Button variant="outline" size="icon" aria-label={t('attachFile')} disabled={send.isPending} onClick={() => fileInput.current?.click()}><Paperclip className="size-4" /></Button>
        <Input className="min-w-0 flex-1" aria-label={t('message')} placeholder={t('message')} value={draft.text} maxLength={10_000}
          onChange={(event) => { setDraft({ text: event.target.value }); reportTyping(Boolean(event.target.value.trim())); }} onBlur={stopTyping} onKeyDown={(event) => {
          if (event.key==='Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
        }} />
        <Button size="icon" aria-label={t('send')} disabled={send.isPending || (!draft.text.trim() && draft.files.length===0)} onClick={submit}>{send.isPending ? <OrbitSpinner className="size-4" /> : <Send className="size-4" />}</Button>
      </div>
    </div>
    {detailsOpen ? <ChatGroupDetailsDialog key={`${user?.id ?? ''}:${group.id}`} group={group} onClose={() => setDetailsOpen(false)} onLeft={() => {
      setDetailsOpen(false);
      setDrafts((current) => { const { [group.id]: _removed, ...remaining } = current; return remaining; });
    }} /> : null}
  </div>;
}
