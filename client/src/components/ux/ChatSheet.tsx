import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { UnreadCountBadge } from '@/components/ux/UnreadCountBadge';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { MessageCircle, Send, User, Circle, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
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

interface ChatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ChatSheet({ open, onOpenChange }: ChatSheetProps) {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const locale = language === 'en' ? enUS : ru;
  const queryClient = useQueryClient();
  
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [draftsByEmployee, setDraftsByEmployee] = useState<Record<number, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const readAttemptedFor = useRef<number | null>(null);
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
  const { data: employees = [] } = useQuery<ConversationUserDto[]>({
    queryKey: ['/api/users'],
    enabled: open && !!searchQuery.trim(),
  });

  // Fetch employees with whom user has conversations
  const { data: conversationEmployees = [] } = useQuery<ConversationUserDto[]>({
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
  const { data: messagesData, isLoading: messagesLoading } = useQuery<MessageDto[]>({
    queryKey: messageQueryKeys.thread(selectedEmployeeId ?? 0),
    queryFn: () => messagesApi.getThread(selectedEmployeeId!),
    enabled: open && !!selectedEmployeeId,
  });

  // Ensure messages is always an array
  const messages = Array.isArray(messagesData) ? messagesData : [];

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
    onError: (_error, _employeeId, context) => {
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
    onSettled: (_result, _error, employeeId) => {
      if (readAttemptedFor.current === employeeId) {
        readAttemptedFor.current = null;
      }
      queryClient.invalidateQueries({ queryKey: messageQueryKeys.thread(employeeId) });
      queryClient.invalidateQueries({ queryKey: messageQueryKeys.conversations });
    },
  });

  useEffect(() => {
    readAttemptedFor.current = null;
  }, [open, selectedEmployeeId]);

  useEffect(() => {
    if (!open || !selectedEmployeeId || !Array.isArray(messagesData)) return;
    const hasUnreadInbound = messagesData.some(
      (message: MessageDto) => message.receiverId === user?.id && !message.isRead,
    );
    if (hasUnreadInbound && readAttemptedFor.current !== selectedEmployeeId) {
      readAttemptedFor.current = selectedEmployeeId;
      markConversationRead.mutate(selectedEmployeeId);
    }
  }, [messagesData, open, selectedEmployeeId, user?.id]);

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
    mutationFn: (messageData: SendMessageRequest & { draftSnapshot: string }) =>
      messagesApi.send({
        receiverId: messageData.receiverId,
        content: messageData.content,
      }),
    onSuccess: (createdMessage, variables) => {
      setDraftsByEmployee((current) => {
        if ((current[variables.receiverId] ?? '') !== variables.draftSnapshot) return current;
        const { [variables.receiverId]: _removed, ...rest } = current;
        return rest;
      });
      if (createdMessage?.id) {
        queryClient.setQueryData(messageQueryKeys.thread(variables.receiverId), (prev: MessageDto[] | undefined) =>
          prev ? [...prev, createdMessage] : [createdMessage]
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
    },
  });

  const handleSendMessage = () => {
    if (!newMessage.trim() || !selectedEmployeeId || sendMessageMutation.isPending) return;
    
    sendMessageMutation.mutate({
      receiverId: selectedEmployeeId,
      content: newMessage.trim(),
      draftSnapshot: newMessage,
    });
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
      isOnline: userStatus?.isOnline || false,
      lastSeenAt: userStatus?.lastSeenAt,
    };
  }, [selectedEmployeeId, employees, conversationEmployees, usersWithStatus]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
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
          <SheetDescription>
            {t('chatWithEmployees')}
          </SheetDescription>
        </SheetHeader>

        <div className="flex h-[calc(100vh-101px)] min-h-0">
          {/* Employee List */}
          <div className="flex w-40 shrink-0 flex-col border-r border-border sm:w-64 lg:w-72">
            <div className="border-b border-border p-3 sm:p-4">
              <h3 className="mb-3 hidden font-medium text-foreground sm:block">{t('employees')}</h3>
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
                      onClick={() => setSelectedEmployeeId(employee.id)}
                    >
                      <Avatar className="size-10">
                        <AvatarFallback>
                          {employee.fullName?.split(' ').map((name) => name[0]).join('').toUpperCase() || t('unknown').charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
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
                {filteredEmployees.length === 0 && (
                  <div className="py-8 text-center text-muted-foreground">
                    <User className="mx-auto mb-2 size-8 opacity-40" />
                    <p className="text-sm">
                      {searchQuery ? t('noSearchResults') : t('noConversationsYet')}
                    </p>
                    {!searchQuery && (
                      <p className="text-xs text-muted-foreground mt-1">{t('useSearchToStartChat')}</p>
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Chat Area */}
          <div className="flex min-w-0 flex-1 flex-col">
            {selectedEmployee ? (
              <>
                {/* Chat Header */}
                <div className="border-b border-border bg-muted/40 p-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarFallback>
                        {selectedEmployee.fullName?.split(' ').map((n: string) => n[0]).join('').toUpperCase() || t('unknown').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{selectedEmployee.fullName}</p>
                      <p className="text-xs text-muted-foreground">{selectedEmployee.position}</p>
                    </div>
                    <Badge
                      variant={selectedEmployee.isOnline ? "default" : "secondary"}
                      className={`ml-auto ${selectedEmployee.isOnline ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}
                    >
                      <Circle className={`w-2 h-2 mr-1 ${selectedEmployee.isOnline ? 'fill-emerald-500 text-emerald-500' : 'fill-muted-foreground/40 text-muted-foreground/40'}`} />
                      {selectedEmployee.isOnline ? t('online') : t('offline')}
                    </Badge>
                  </div>
                </div>

                {/* Messages */}
                <ScrollArea className="flex-1 p-4">
                  <div className="flex flex-col gap-4">
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
                              className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl ${
                                isOwnMessage
                                  ? 'text-white rounded-br-sm'
                                  : 'bg-muted text-foreground rounded-bl-sm'
                              }`}
                              style={isOwnMessage ? { background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))' } : undefined}
                            >
                              <p className="text-sm leading-relaxed">{message.content}</p>
                              <p
                                className={`text-xs mt-1 ${
                                  isOwnMessage ? 'text-white/70' : 'text-muted-foreground'
                                }`}
                              >
                                {(() => {
                                  try {
                                    return message.createdAt ? format(new Date(message.createdAt), 'HH:mm', { locale }) : '';
                                  } catch (e) {
                                    return t('now');
                                  }
                                })()}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">{t('noMessagesYet')}</p>
                        <p className="text-xs text-muted-foreground mt-1">{t('startConversation')}</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>

                {/* Message Input */}
                <div className="border-t border-border/70 p-4">
                  <div className="flex gap-2">
                    <Input
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
                      disabled={!newMessage.trim() || sendMessageMutation.isPending}
                      size="icon"
                    >
                      <Send />
                      <span className="sr-only">{t('send')}</span>
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="text-lg font-medium mb-2 text-foreground">{t('selectEmployee')}</p>
                  <p className="text-sm text-muted-foreground">{t('chatWithEmployees')}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
