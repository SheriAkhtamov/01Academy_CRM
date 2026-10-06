import { Alert, AlertDescription } from '@/components/ui/alert';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UserAvatar } from '@/components/ux/UserAvatar';
import { Badge } from '@/components/ui/badge';
import { UnreadCountBadge } from '@/components/ux/UnreadCountBadge';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Loader2, MessageCircle, Send, User, Circle, Search, Paperclip, Plus, UsersRound } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CreateChatGroupDialog } from './chat/CreateChatGroupDialog';
import { GroupChatThread } from './chat/GroupChatThread';
import { chatGroupQueryOptions } from '@/features/messages/chat-groups-api';
import { academyDateInputValue, academyToday, formatAcademyDate } from '@/lib/localeFormat';
import { MAX_MESSAGE_FILE_BYTES, MAX_MESSAGE_FILES } from '@shared/contracts/messages';
import { ChatFileDrafts, ChatMessageAttachments } from '@/components/ux/chat/ChatAttachments';
import type {
  ConversationUserDto,
  MessageDto,
  SendMessageRequest,
} from '@shared/contracts/messages';
import {
  conversationQueryOptions,
  messageQueryKeys,
  messagesApi,
} from '@/features/messages/api';

const EMPTY_FILES: File[] = [];

interface ChatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ChatSheet({ open, onOpenChange }: ChatSheetProps) {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [createChatMode, setCreateChatMode] = useState<'group' | 'direct' | null>(null);
  const groupsQuery = useQuery({ ...chatGroupQueryOptions, enabled: open });
  const selectedGroup = groupsQuery.data?.find((group) => group.id === selectedGroupId) ?? null;
  const [draftsByEmployee, setDraftsByEmployee] = useState<Record<number, string>>({});
  const [filesByEmployee, setFilesByEmployee] = useState<Record<number, File[]>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedFiles = selectedEmployeeId ? filesByEmployee[selectedEmployeeId] ?? EMPTY_FILES : EMPTY_FILES;
  const [searchQuery, setSearchQuery] = useState('');
  const readAttemptedFor = useRef<string | null>(null);
  const [readErrorFor, setReadErrorFor] = useState<number | null>(null);
  const newMessage = selectedEmployeeId ? draftsByEmployee[selectedEmployeeId] ?? '' : '';
  const setNewMessage = (value: string) => {
    if (!selectedEmployeeId) return;
    setDraftsByEmployee((current) => {
      if (!value) {
        const { [selectedEmployeeId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [selectedEmployeeId]: value };
    });
  };

  // Fetch all employees only when searching
  const { data: employees = [], isError: employeesError, refetch: refetchEmployees } = useQuery<ConversationUserDto[]>({
    queryKey: ['/api/users'],
    enabled: open && !!searchQuery.trim(),
  });

  // Fetch employees with whom user has conversations
  const { data: conversationEmployees = [], isLoading: conversationsLoading, isError: conversationsError, refetch: refetchConversations } = useQuery<ConversationUserDto[]>({
    ...conversationQueryOptions,
    enabled: open,
  });

  // Fetch online status for all users
  const { data: usersWithStatus = [] } = useQuery<ConversationUserDto[]>({
    queryKey: messageQueryKeys.onlineUsers,
    queryFn: messagesApi.getOnlineUsers,
    enabled: open,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch messages for selected employee
  const { data: messagesData, isLoading: messagesLoading, isError: messagesError, refetch: refetchMessages } = useQuery<MessageDto[]>({
    queryKey: messageQueryKeys.thread(selectedEmployeeId ?? 0),
    queryFn: () => messagesApi.getThread(selectedEmployeeId!),
    enabled: open && !!selectedEmployeeId,
  });

  // Ensure messages is always an array
  const messages = Array.isArray(messagesData) ? messagesData : [];

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastMessageKey = messages.length > 0
    ? `${messages[messages.length - 1].id}-${messages.length}`
    : null;

  const scrollThreadToBottom = (behavior: ScrollBehavior) => {
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior });
  };

  // Jump to the latest message when a conversation is opened or first loads.
  useEffect(() => {
    if (!open || !selectedEmployeeId || messagesLoading) return;
    requestAnimationFrame(() => scrollThreadToBottom('auto'));
  }, [open, selectedEmployeeId, messagesLoading]);

  // Follow incoming messages, but only when the user is already near the bottom —
  // never yank the viewport away from someone reading older history.
  useEffect(() => {
    if (lastMessageKey === null) return;
    const viewport = messagesEndRef.current?.closest('[data-radix-scroll-area-viewport]');
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (distanceFromBottom < 320) {
      requestAnimationFrame(() => scrollThreadToBottom('smooth'));
    }
  }, [lastMessageKey]);

  const markConversationRead = useMutation({
    mutationFn: (employeeId: number) =>
      messagesApi.markConversationRead(employeeId),
    onMutate: async (employeeId) => {
      const threadQueryKey = messageQueryKeys.thread(employeeId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: threadQueryKey }),
        queryClient.cancelQueries({ queryKey: messageQueryKeys.conversations }),
      ]);
      const previousThread = queryClient.getQueryData<MessageDto[]>(threadQueryKey);
      const previousConversations = queryClient.getQueryData<ConversationUserDto[]>(
        messageQueryKeys.conversations,
      );
      queryClient.setQueryData<MessageDto[]>(threadQueryKey, (current = []) => current.map((message) => (
        message.receiverId === user?.id && !message.isRead
          ? { ...message, isRead: true }
          : message
      )));
      queryClient.setQueryData<ConversationUserDto[]>(
        messageQueryKeys.conversations,
        (current = []) => current.map((conversation) => (
          conversation.id === employeeId
            ? { ...conversation, unreadCount: 0 }
            : conversation
        )),
      );
      return { employeeId, previousThread, previousConversations };
    },
    onError: (_error, employeeId, context) => {
      setReadErrorFor(employeeId);
      if (context) {
        queryClient.setQueryData(
          messageQueryKeys.thread(context.employeeId),
          context.previousThread,
        );
        queryClient.setQueryData(
          messageQueryKeys.conversations,
          context.previousConversations,
        );
      }
    },
    onSuccess: (_result, employeeId) => {
      setReadErrorFor((current) => current === employeeId ? null : current);
      queryClient.invalidateQueries({ queryKey: messageQueryKeys.thread(employeeId) });
      queryClient.invalidateQueries({ queryKey: messageQueryKeys.conversations });
    },
  });

  const { mutate: markRead, isPending: readPending } = markConversationRead;

  useEffect(() => {
    readAttemptedFor.current = null;
    setReadErrorFor(null);
  }, [open, selectedEmployeeId]);

  useEffect(() => {
    if (!open || !selectedEmployeeId || !Array.isArray(messagesData)) return;
    const unreadIds = messagesData.filter(
      (message: MessageDto) => message.receiverId === user?.id && !message.isRead,
    ).map((message) => message.id).sort((a, b) => a - b).join(',');
    const attemptKey = `${selectedEmployeeId}:${unreadIds}`;
    if (unreadIds && !readPending && readErrorFor !== selectedEmployeeId && readAttemptedFor.current !== attemptKey) {
      readAttemptedFor.current = attemptKey;
      markRead(selectedEmployeeId);
    }
  }, [messagesData, open, selectedEmployeeId, user?.id, readErrorFor, readPending, markRead]);

  // Filter employees based on search query or show conversation history
  const filteredEmployees = useMemo(() => {
    if (searchQuery.trim()) {
      // Show search results from all employees
      const conversationsByEmployeeId = new Map(
        conversationEmployees.map((employee) => [employee.id, employee]),
      );
      const otherEmployees = Array.isArray(employees)
        ? employees
          .filter((employee) => employee.id !== user?.id)
          .map((employee) => ({
            ...employee,
            unreadCount: conversationsByEmployeeId.get(employee.id)?.unreadCount
              ?? employee.unreadCount
              ?? 0,
          }))
        : [];
      const normalizedSearch = searchQuery.toLowerCase();
      return otherEmployees.filter((employee) =>
        employee.fullName?.toLowerCase().includes(normalizedSearch) ||
        employee.position?.toLowerCase().includes(normalizedSearch)
      );
    } else {
      // Show only employees with existing conversations
      const conversations = Array.isArray(conversationEmployees) ? conversationEmployees : [];
      return conversations.filter((employee) => employee.id !== user?.id);
    }
  }, [employees, conversationEmployees, user?.id, searchQuery]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: (messageData: SendMessageRequest & { draftSnapshot: string; files: File[] }) =>
      messagesApi.send({
        receiverId: messageData.receiverId,
        content: messageData.content,
        files: messageData.files,
      }),
    onSuccess: (createdMessage, variables) => {
      setDraftsByEmployee((current) => {
        if ((current[variables.receiverId] ?? '') !== variables.draftSnapshot) return current;
        const { [variables.receiverId]: _removed, ...rest } = current;
        return rest;
      });
      setFilesByEmployee((current) => {
        const remaining = (current[variables.receiverId] ?? []).filter((file) => !variables.files.includes(file));
        if (remaining.length) return { ...current, [variables.receiverId]: remaining };
        const { [variables.receiverId]: _removed, ...rest } = current;
        return rest;
      });
      if (createdMessage?.id) {
        queryClient.setQueryData(messageQueryKeys.thread(variables.receiverId), (prev: MessageDto[] | undefined) =>
          prev?.some((message) => message.id === createdMessage.id) ? prev : [...(prev ?? []), createdMessage]
        );
      }
      // Force refresh of messages
      queryClient.invalidateQueries({ queryKey: messageQueryKeys.thread(variables.receiverId) });
      queryClient.invalidateQueries({ queryKey: messageQueryKeys.conversations });
      // Check if this is the first message to this employee
      const isNewConversation = !conversationEmployees.some((employee) => (
        employee.id === variables.receiverId
      ));
      if (isNewConversation) {
        setSearchQuery('');
      }

      requestAnimationFrame(() => scrollThreadToBottom('smooth'));
    },
    onError: (error: Error) => {
      toast({
        title: t('messageSendFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleSendMessage = () => {
    if ((!newMessage.trim() && selectedFiles.length === 0) || !selectedEmployeeId || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate({
      receiverId: selectedEmployeeId,
      content: newMessage.trim(),
      draftSnapshot: newMessage,
      files: [...selectedFiles],
    });
  };

  const attachFiles = (files: File[]) => {
    if (!selectedEmployeeId || files.length === 0) return;
    if (files.some((file) => file.size > MAX_MESSAGE_FILE_BYTES)) {
      toast({ title: t('messageFileTooLarge'), variant: 'destructive' }); return;
    }
    if (selectedFiles.length + files.length > MAX_MESSAGE_FILES) {
      toast({ title: t('messageFileLimit'), variant: 'destructive' }); return;
    }
    setFilesByEmployee((current) => ({ ...current, [selectedEmployeeId]: [...(current[selectedEmployeeId] ?? []), ...files] }));
  };

  const selectedEmployee = useMemo(() => {
    if (!selectedEmployeeId) return null;
    const employee = (Array.isArray(employees) ? employees : [])
      .concat(Array.isArray(conversationEmployees) ? conversationEmployees : [])
      .find((item) => item.id === selectedEmployeeId);
    if (!employee) return null;
    // Add online status from usersWithStatus
    const userStatus = Array.isArray(usersWithStatus) 
      ? usersWithStatus.find((item) => item.id === selectedEmployeeId)
      : null;
    return {
      ...employee,
      isOnline: userStatus?.isOnline ?? employee.isOnline ?? false,
      lastSeenAt: userStatus?.lastSeenAt ?? employee.lastSeenAt,
    };
  }, [selectedEmployeeId, employees, conversationEmployees, usersWithStatus]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent aria-describedby={undefined}
        side="right"
        showOverlay={false}
        className="w-[min(960px,calc(100vw-1rem))] max-w-none p-0 sm:max-w-2xl lg:max-w-4xl"
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="flex items-center gap-2">
            <MessageCircle />
            {t('employeeChat')}
          </SheetTitle>
        </SheetHeader>

        <div className="flex h-[calc(100dvh-101px)] min-h-0">
          {/* Employee List */}
          <div className="flex w-40 shrink-0 flex-col border-r border-border sm:w-64 lg:w-72">
            <div className="border-b border-border p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="hidden font-medium text-foreground sm:block">{t('employees')}</h3>
                <DropdownMenu><DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" className="ml-auto size-7 p-0" aria-label={t('chatCreateMenu')}><Plus className="size-4" /></Button>
                </DropdownMenuTrigger><DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setCreateChatMode('group')}><UsersRound className="mr-2 size-4" />{t('createGroup')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setCreateChatMode('direct')}><MessageCircle className="mr-2 size-4" />{t('newDirectChat')}</DropdownMenuItem>
                </DropdownMenuContent></DropdownMenu>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('searchEmployees')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-2">
                {groupsQuery.isError ? <div role="alert" className="text-sm text-destructive">{t('failedToLoadData')} <Button size="sm" variant="outline" onClick={() => void groupsQuery.refetch()}>{t('retry')}</Button></div> : null}
                {(groupsQuery.data ?? []).filter((group) => group.name.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase())).map((group) => (
                  <button key={`group-${group.id}`} type="button" className={`mb-1 flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-muted ${selectedGroupId===group.id ? 'bg-primary/10 ring-1 ring-primary/20' : ''}`}
                    onClick={() => { setSelectedEmployeeId(null); setSelectedGroupId(group.id); }}>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10"><UsersRound className="size-5 text-primary" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{group.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{t('chatGroupParticipantCount').replace('{count}', String(group.participantCount))}</span></span>
                    <UnreadCountBadge count={group.unreadCount} label={t('unreadMessageCount').replace('{count}', String(group.unreadCount))} />
                  </button>
                ))}
                {filteredEmployees.map((employee) => {
                  const employeeUnreadCount = Number(employee.unreadCount) || 0;
                  const employeeUnreadLabel = t('unreadMessageCount')
                    .replace('{count}', String(employeeUnreadCount));
                  const userStatus = Array.isArray(usersWithStatus)
                    ? usersWithStatus.find((item) => item.id === employee.id)
                    : null;
                  const isOnline = Boolean(userStatus?.isOnline);

                  return (
                    <button
                      key={employee.id}
                      type="button"
                      className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        selectedEmployeeId === employee.id ? 'bg-primary/10 ring-1 ring-primary/20' : ''
                      }`}
                      onClick={() => { setSelectedGroupId(null); setSelectedEmployeeId(employee.id); }}
                    >
                      <UserAvatar user={employee} className="size-10 shrink-0 text-xs" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {employee.fullName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {employee.position}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <UnreadCountBadge
                          count={employeeUnreadCount}
                          label={employeeUnreadLabel}
                        />
                        <div className="hidden items-center gap-1 lg:flex">
                          <Circle className={`size-2 ${isOnline ? 'fill-emerald-500 text-emerald-500' : 'fill-slate-400 text-slate-400'}`} />
                          <span className="text-xs text-muted-foreground">
                            {isOnline ? t('online') : t('offline')}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {filteredEmployees.length === 0 && conversationsLoading && (
                  <div className="py-8 text-center text-muted-foreground" aria-live="polite">
                    <Loader2 className="mx-auto mb-2 size-6 animate-spin opacity-50" />
                    <p className="text-sm">{t('loading')}</p>
                  </div>
                )}
                {(searchQuery.trim() ? employeesError : conversationsError) ? <Alert variant="destructive"><AlertDescription>
                  {t('failedToLoadData')} <Button variant="outline" size="sm" onClick={() => void (searchQuery.trim() ? refetchEmployees() : refetchConversations())}>{t('retry')}</Button>
                </AlertDescription></Alert> : null}
                {filteredEmployees.length === 0 && !groupsQuery.data?.some((group) => group.name.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase())) && !conversationsLoading && !(searchQuery.trim() ? employeesError : conversationsError) && (
                  <div className="py-8 text-center text-muted-foreground">
                    <User className="mx-auto mb-2 size-8 opacity-40" />
                    <p className="text-sm">
                      {searchQuery ? t('noSearchResults') : t('noConversationsYet')}
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Chat Area */}
          <div className="flex min-w-0 flex-1 flex-col">
            <GroupChatThread group={selectedGroup} />
            {selectedGroup ? null : selectedEmployee ? (
              <>
                {/* Chat Header */}
                <div className="border-b border-border bg-muted/40 p-4">
                  <div className="flex items-center gap-3">
                    <UserAvatar user={selectedEmployee} className="size-8 shrink-0 text-xs" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{selectedEmployee.fullName}</p>
                      <p className="text-xs text-muted-foreground">{selectedEmployee.position}</p>
                      {!selectedEmployee.isOnline && selectedEmployee.lastSeenAt && !Number.isNaN(Date.parse(selectedEmployee.lastSeenAt)) ? <p className="mt-1 text-xs text-muted-foreground">
                        {t('employeeLastSeen').replace('{date}', formatAcademyDate(selectedEmployee.lastSeenAt, language, {
                          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        }))}
                      </p> : null}
                    </div>
                    <Badge
                      variant={selectedEmployee.isOnline ? "default" : "secondary"}
                      className={`ml-auto shrink-0 ${selectedEmployee.isOnline ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}
                    >
                      <Circle className={`w-2 h-2 mr-1 ${selectedEmployee.isOnline ? 'fill-emerald-500 text-emerald-500' : 'fill-muted-foreground/40 text-muted-foreground/40'}`} />
                      {selectedEmployee.isOnline ? t('online') : t('offline')}
                    </Badge>
                  </div>
                </div>

                {/* Messages */}
                <ScrollArea className="flex-1 p-4">
                  <div className="flex flex-col gap-4">
                    {readErrorFor === selectedEmployeeId ? <Alert variant="destructive"><AlertDescription>
                      {t('messageReadFailed')} <Button variant="outline" size="sm" disabled={markConversationRead.isPending} onClick={() => markConversationRead.mutate(selectedEmployeeId!)}>{t('retryMarkRead')}</Button>
                    </AlertDescription></Alert> : null}
                    {messagesError ? <Alert variant="destructive"><AlertDescription>
                      {t('failedToLoadData')} <Button variant="outline" size="sm" onClick={() => void refetchMessages()}>{t('retry')}</Button>
                    </AlertDescription></Alert> : null}
                    {messagesLoading ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <p className="text-sm">{t('loadingMessages')}</p>
                      </div>
                    ) : Array.isArray(messages) && messages.length > 0 ? (
                      messages.map((message: MessageDto) => {
                        const isOwnMessage = message.senderId === user?.id;
                        return (
                          <div
                            key={`${message.id}-${message.createdAt}`}
                            className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`min-w-0 max-w-[85%] lg:max-w-md px-4 py-2 rounded-2xl ${
                                isOwnMessage
                                  ? 'text-white rounded-br-sm'
                                  : 'bg-muted text-foreground rounded-bl-sm'
                              }`}
                              style={isOwnMessage ? { background: 'linear-gradient(135deg, var(--brand-gradient-from), var(--brand-gradient-to))' } : undefined}
                            >
                              {message.attachments?.length ? <ChatMessageAttachments attachments={message.attachments} /> : null}
                              {message.content ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p> : null}
                              <p
                                className={`text-xs mt-1 ${
                                  isOwnMessage ? 'text-white/70' : 'text-muted-foreground'
                                }`}
                              >
                                {(() => {
                                  try {
                                    if (!message.createdAt) return '';
                                    const createdAt = new Date(message.createdAt);
                                    return formatAcademyDate(createdAt, language, {
                                      ...(academyDateInputValue(createdAt) === academyToday() ? {} : { day: 'numeric', month: 'short' }),
                                      hour: '2-digit', minute: '2-digit',
                                    });
                                  } catch (e) {
                                    return t('now');
                                  }
                                })()}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    ) : !messagesError ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">{t('noMessagesYet')}</p>
                      </div>
                    ) : null}
                    <div ref={messagesEndRef} aria-hidden="true" />
                  </div>
                </ScrollArea>

                {/* Message Input */}
                <div className="border-t border-border/70 p-4">
                  {selectedFiles.length > 0 ? <ChatFileDrafts files={selectedFiles} disabled={sendMessageMutation.isPending} onRemove={(file) => {
                    if (!selectedEmployeeId) return;
                    setFilesByEmployee((current) => ({ ...current, [selectedEmployeeId]: (current[selectedEmployeeId] ?? []).filter((item) => item !== file) }));
                  }} /> : null}
                  <input ref={fileInputRef} type="file" multiple className="sr-only" aria-label={t('attachmentsLabel')} disabled={sendMessageMutation.isPending} onChange={(event) => {
                    attachFiles(Array.from(event.target.files ?? [])); event.target.value = '';
                  }} />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="icon" title={t('messageUploadHint')} aria-label={t('attachFile')} disabled={sendMessageMutation.isPending} onClick={() => fileInputRef.current?.click()}><Paperclip className="size-4" /></Button>
                    <Input
                      className="min-w-0 flex-1"
                      placeholder={t('typeMessage')}
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                    />
                    <Button
                      onClick={handleSendMessage}
                      disabled={(!newMessage.trim() && selectedFiles.length === 0) || sendMessageMutation.isPending}
                      size="icon"
                    >
                      {sendMessageMutation.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                      <span className="sr-only">{sendMessageMutation.isPending ? t('sendingMessage') : t('send')}</span>
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="text-lg font-medium mb-2 text-foreground">{t('selectEmployee')}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
      <CreateChatGroupDialog open={createChatMode !== null} mode={createChatMode ?? 'group'}
        onOpenChange={(next) => { if (!next) setCreateChatMode(null); }}
        onCreated={(group) => { setSelectedEmployeeId(null); setSelectedGroupId(group.id); setSearchQuery(''); }}
        onSelectEmployee={(id) => { setSelectedGroupId(null); setSelectedEmployeeId(id); setSearchQuery(''); }} />
    </Sheet>
  );
}
