import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/ux/PageHeader';
import {
  AlertCircle,
  Camera,
  Clock3,
  Instagram,
  MessageCircle,
  Send,
  UserRound,
} from 'lucide-react';

interface InstagramConversation {
  id: number;
  accountId: number;
  leadId?: number | null;
  participantIgsid: string;
  participantUsername?: string | null;
  participantName?: string | null;
  participantProfilePictureUrl?: string | null;
  unreadCount: number;
  lastMessageAt?: string | null;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  accountUsername: string;
  accountStatus: string;
  contactName?: string | null;
  statusCode?: string | null;
  managerId?: number | null;
  managerName?: string | null;
  lastMessage?: string | null;
  lastMessageDirection?: 'inbound' | 'outbound' | null;
  canReply: boolean;
  messagingWindowExpiresAt?: string | null;
}

interface InstagramMessage {
  id: number;
  conversationId: number;
  externalMessageId?: string | null;
  direction: 'inbound' | 'outbound';
  senderIgsid: string;
  recipientIgsid: string;
  content: string;
  messageType: string;
  status: string;
  sentBy?: number | null;
  createdAt: string;
}

function MessagesSkeleton() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-6 lg:p-8">
      <Skeleton className="h-10 w-72" />
      <div className="grid min-h-[620px] grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Skeleton className="h-[620px]" />
        <Skeleton className="h-[620px]" />
      </div>
    </div>
  );
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'IG';

export default function InstagramMessagesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const conversationsQuery = useQuery<InstagramConversation[]>({
    queryKey: ['/api/instagram/conversations'],
  });

  const conversations = conversationsQuery.data ?? [];
  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  useEffect(() => {
    if (!selectedConversationId && conversations[0]) {
      setSelectedConversationId(conversations[0].id);
    } else if (
      selectedConversationId
      && conversations.length > 0
      && !conversations.some((conversation) => conversation.id === selectedConversationId)
    ) {
      setSelectedConversationId(conversations[0].id);
    }
  }, [conversations, selectedConversationId]);

  const messagesQuery = useQuery<InstagramMessage[]>({
    queryKey: ['/api/instagram/conversations', selectedConversationId, 'messages'],
    queryFn: () => apiRequest(
      'GET',
      `/api/instagram/conversations/${selectedConversationId}/messages`,
    ),
    enabled: Boolean(selectedConversationId),
  });

  const markRead = useMutation({
    mutationFn: (conversationId: number) =>
      apiRequest('POST', `/api/instagram/conversations/${conversationId}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/instagram/conversations'] });
    },
  });

  useEffect(() => {
    if (selectedConversationId && selectedConversation?.unreadCount) {
      markRead.mutate(selectedConversationId);
    }
  }, [selectedConversation?.unreadCount, selectedConversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesQuery.data?.length, selectedConversationId]);

  const sendMessage = useMutation({
    mutationFn: (content: string) =>
      apiRequest('POST', `/api/instagram/conversations/${selectedConversationId}/messages`, { content }),
    onSuccess: (message: InstagramMessage) => {
      setDraft('');
      queryClient.setQueryData<InstagramMessage[]>(
        ['/api/instagram/conversations', selectedConversationId, 'messages'],
        (previous = []) => previous.some((item) => item.id === message.id)
          ? previous
          : [...previous, message],
      );
      queryClient.invalidateQueries({ queryKey: ['/api/instagram/conversations'] });
    },
    onError: (error: Error) => {
      toast({
        title: t('instagramMessageNotSent'),
        description: error.message || t('instagramSendFailed'),
        variant: 'destructive',
      });
    },
  });

  const submitMessage = () => {
    const content = draft.trim();
    if (!content || !selectedConversationId || !selectedConversation?.canReply) return;
    sendMessage.mutate(content);
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (conversationsQuery.isLoading) return <MessagesSkeleton />;

  if (conversationsQuery.isError) {
    return (
      <div className="mx-auto max-w-[1600px] p-6 lg:p-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('failedToLoadData')}</AlertTitle>
          <AlertDescription>
            <Button className="mt-3" variant="outline" onClick={() => conversationsQuery.refetch()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] p-6 lg:p-8">
      <PageHeader
        title={t('instagramMessages')}
        subtitle={t('instagramMessagesDesc')}
        breadcrumbs={[
          { label: t('navDashboard'), href: '/sales' },
          { label: t('instagramMessages') },
        ]}
      />

      <Card className="mt-6 min-h-[620px] overflow-hidden">
        {conversations.length === 0 ? (
          <div className="flex min-h-[620px] items-center justify-center p-8 text-center">
            <div>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <MessageCircle className="h-7 w-7" />
              </div>
              <h2 className="mt-4 font-semibold text-slate-900">{t('noInstagramConversations')}</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                {t('noInstagramConversationsDesc')}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid min-h-[620px] grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="min-h-0 border-b border-border lg:border-b-0 lg:border-r">
              <div className="border-b border-border p-4">
                <div className="flex items-center gap-2">
                  <Instagram className="h-5 w-5 text-primary" />
                  <h2 className="font-semibold text-slate-900">{t('instagramDialogs')}</h2>
                  <Badge className="ml-auto" variant="secondary">{conversations.length}</Badge>
                </div>
              </div>
              <ScrollArea className="h-[280px] lg:h-[568px]">
                <div className="p-2">
                  {conversations.map((conversation) => {
                    const participantLabel = conversation.participantName
                      || conversation.participantUsername
                      || conversation.contactName
                      || t('instagramUser');
                    const selected = conversation.id === selectedConversationId;
                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors ${
                          selected ? 'bg-primary/10 ring-1 ring-primary/20' : 'hover:bg-muted'
                        }`}
                        onClick={() => setSelectedConversationId(conversation.id)}
                      >
                        <Avatar className="h-10 w-10 shrink-0">
                          {conversation.participantProfilePictureUrl ? (
                            <AvatarImage src={conversation.participantProfilePictureUrl} alt="" />
                          ) : null}
                          <AvatarFallback>{initials(participantLabel)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {conversation.participantUsername
                                ? `@${conversation.participantUsername}`
                                : participantLabel}
                            </p>
                            {conversation.unreadCount > 0 ? (
                              <Badge className="ml-auto h-5 min-w-5 justify-center px-1.5">
                                {conversation.unreadCount}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {conversation.lastMessage || t('noMessagesYet')}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                            <span className="truncate">@{conversation.accountUsername}</span>
                            <span className="ml-auto shrink-0">{formatDateTime(conversation.lastMessageAt)}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            <div className="flex min-h-[620px] min-w-0 flex-col">
              {selectedConversation ? (
                <>
                  <div className="flex items-center gap-3 border-b border-border p-4">
                    <Avatar className="h-10 w-10">
                      {selectedConversation.participantProfilePictureUrl ? (
                        <AvatarImage src={selectedConversation.participantProfilePictureUrl} alt="" />
                      ) : null}
                      <AvatarFallback>
                        {initials(
                          selectedConversation.participantName
                          || selectedConversation.participantUsername
                          || selectedConversation.contactName
                          || 'Instagram',
                        )}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">
                        {selectedConversation.participantUsername
                          ? `@${selectedConversation.participantUsername}`
                          : selectedConversation.participantName || selectedConversation.contactName}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {t('lead')} #{selectedConversation.leadId} · @{selectedConversation.accountUsername}
                      </p>
                    </div>
                    <Badge className="ml-auto" variant={selectedConversation.canReply ? 'default' : 'secondary'}>
                      {selectedConversation.canReply ? t('replyWindowOpen') : t('replyWindowClosed')}
                    </Badge>
                  </div>

                  {!selectedConversation.canReply ? (
                    <Alert className="m-4 mb-0">
                      <Clock3 className="h-4 w-4" />
                      <AlertTitle>{t('instagramMessagingWindowExpiredTitle')}</AlertTitle>
                      <AlertDescription>{t('instagramMessagingWindowExpiredDesc')}</AlertDescription>
                    </Alert>
                  ) : null}

                  <ScrollArea className="min-h-0 flex-1 bg-muted/20">
                    <div className="space-y-3 p-4">
                      {messagesQuery.isLoading ? (
                        Array.from({ length: 5 }).map((_, index) => (
                          <Skeleton key={index} className={`h-16 w-2/3 ${index % 2 ? 'ml-auto' : ''}`} />
                        ))
                      ) : (messagesQuery.data ?? []).length === 0 ? (
                        <div className="py-16 text-center text-sm text-slate-500">
                          <Camera className="mx-auto mb-3 h-8 w-8 text-slate-400" />
                          {t('noMessagesYet')}
                        </div>
                      ) : (
                        (messagesQuery.data ?? []).map((message) => {
                          const outbound = message.direction === 'outbound';
                          return (
                            <div
                              key={message.id}
                              className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
                            >
                              <div
                                className={`max-w-[82%] rounded-2xl px-4 py-2.5 ${
                                  outbound
                                    ? 'rounded-br-md bg-primary text-primary-foreground'
                                    : 'rounded-bl-md border border-border bg-card text-card-foreground'
                                }`}
                              >
                                <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                                <p className={`mt-1 text-[10px] ${outbound ? 'text-primary-foreground/70' : 'text-slate-400'}`}>
                                  {formatDateTime(message.createdAt)}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                  </ScrollArea>

                  <div className="border-t border-border p-4">
                    <div className="flex items-end gap-2">
                      <Textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            submitMessage();
                          }
                        }}
                        placeholder={selectedConversation.canReply
                          ? t('instagramMessagePlaceholder')
                          : t('replyWindowClosed')}
                        disabled={!selectedConversation.canReply || sendMessage.isPending}
                        className="min-h-[44px] resize-none"
                        maxLength={1000}
                        aria-label={t('instagramMessagePlaceholder')}
                      />
                      <Button
                        className="h-11 w-11 shrink-0 p-0"
                        onClick={submitMessage}
                        disabled={!draft.trim() || !selectedConversation.canReply || sendMessage.isPending}
                        aria-label={t('sendMessage')}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      {t('instagramReplyPolicyHint')}
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center p-8 text-center text-slate-500">
                  <div>
                    <UserRound className="mx-auto mb-3 h-9 w-9 text-slate-400" />
                    {t('selectConversation')}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
