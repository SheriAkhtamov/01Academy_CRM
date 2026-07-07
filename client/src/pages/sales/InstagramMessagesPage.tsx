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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/ux/PageHeader';
import {
  AlertCircle,
  AtSign,
  Camera,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Instagram,
  Loader2,
  MessageCircle,
  RefreshCw,
  Save,
  Search,
  Send,
  UserRound,
  UserRoundCog,
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

interface LookupOption {
  id: number;
  name: string;
  code?: string;
  isActive?: boolean;
  isPipeline?: boolean;
  sortOrder?: number;
}

interface LeadDetails {
  id: number;
  contactName: string;
  phone?: string | null;
  phoneNumbers?: string[] | null;
  messenger?: string | null;
  studentName?: string | null;
  studentAge?: number | null;
  courseId?: number | null;
  sourceId: number;
  statusCode: string;
  managerId?: number | null;
  managerName?: string | null;
  language?: string | null;
  comment?: string | null;
  updatedAt?: string | null;
}

interface SalesWorkspaceData {
  courses?: LookupOption[];
  sources?: LookupOption[];
  statuses?: LookupOption[];
}

interface LeadDraft {
  contactName: string;
  phone: string;
  messenger: string;
  studentName: string;
  studentAge: string;
  courseId: string;
  sourceId: string;
  statusCode: string;
  language: string;
  comment: string;
}

type ConversationFilter = 'all' | 'unread' | 'reply' | 'closed';

const emptyLeadDraft: LeadDraft = {
  contactName: '',
  phone: '',
  messenger: '',
  studentName: '',
  studentAge: '',
  courseId: '',
  sourceId: '',
  statusCode: 'new_request',
  language: 'ru',
  comment: '',
};

const syntheticInstagramPhone = (value?: string | null) =>
  Boolean(value && value.startsWith('instagram:'));

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'IG';

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

const compact = (value: string) => value.trim();

const buildLeadDraft = (lead: LeadDetails): LeadDraft => {
  const phone = (lead.phoneNumbers ?? [])
    .find((item) => item && !syntheticInstagramPhone(item))
    ?? (!syntheticInstagramPhone(lead.phone) ? lead.phone : '')
    ?? '';

  return {
    contactName: lead.contactName ?? '',
    phone,
    messenger: lead.messenger ?? '',
    studentName: lead.studentName ?? '',
    studentAge: lead.studentAge ? String(lead.studentAge) : '',
    courseId: lead.courseId ? String(lead.courseId) : '',
    sourceId: lead.sourceId ? String(lead.sourceId) : '',
    statusCode: lead.statusCode ?? 'new_request',
    language: lead.language ?? 'ru',
    comment: lead.comment ?? '',
  };
};

function MessagesSkeleton() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-6 lg:p-8">
      <Skeleton className="h-10 w-72" />
      <div className="grid min-h-[680px] grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
        <Skeleton className="h-[680px]" />
        <Skeleton className="h-[680px]" />
        <Skeleton className="h-[680px]" />
      </div>
    </div>
  );
}

function LeadPanel({
  leadId,
  workspaceData,
  statusName,
  onChanged,
}: {
  leadId?: number | null;
  workspaceData?: SalesWorkspaceData;
  statusName: (code: string) => string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<LeadDraft>(emptyLeadDraft);
  const hydratedKey = useRef<string | null>(null);

  const leadQuery = useQuery<LeadDetails>({
    queryKey: ['/api/academy/leads', leadId],
    queryFn: () => apiRequest('GET', `/api/academy/leads/${leadId}`),
    enabled: Boolean(leadId),
  });

  const lead = leadQuery.data;
  const leadSnapshotKey = useMemo(() => {
    if (!lead) return null;
    return [
      lead.id,
      lead.contactName,
      (lead.phoneNumbers ?? []).join(','),
      lead.phone ?? '',
      lead.messenger ?? '',
      lead.studentName ?? '',
      lead.studentAge ?? '',
      lead.courseId ?? '',
      lead.sourceId ?? '',
      lead.statusCode,
      lead.language ?? '',
      lead.comment ?? '',
      lead.updatedAt ?? '',
    ].join('|');
  }, [lead]);

  useEffect(() => {
    if (!lead || !leadSnapshotKey) return;
    if (hydratedKey.current !== leadSnapshotKey) {
      setDraft(buildLeadDraft(lead));
      hydratedKey.current = leadSnapshotKey;
    }
  }, [lead, leadSnapshotKey]);

  useEffect(() => {
    if (!leadId) {
      setDraft(emptyLeadDraft);
      hydratedKey.current = null;
    }
  }, [leadId]);

  const baselineDraft = useMemo(() => (lead ? buildLeadDraft(lead) : emptyLeadDraft), [lead]);
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baselineDraft),
    [baselineDraft, draft],
  );

  const courses = workspaceData?.courses ?? [];
  const sources = workspaceData?.sources ?? [];
  const statuses = useMemo(
    () => [...(workspaceData?.statuses ?? [])]
      .filter((status) => status.isActive !== false && (status.code !== 'paid' || lead?.statusCode === 'paid'))
      .sort((left, right) => Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0)),
    [lead?.statusCode, workspaceData?.statuses],
  );

  const updateLead = useMutation({
    mutationFn: () => apiRequest('PATCH', `/api/academy/leads/${leadId}`, {
      contactName: compact(draft.contactName),
      phoneNumbers: compact(draft.phone) ? [compact(draft.phone)] : [],
      messenger: compact(draft.messenger) || null,
      studentName: compact(draft.studentName) || null,
      studentAge: compact(draft.studentAge) ? Number(draft.studentAge) : null,
      courseId: draft.courseId ? Number(draft.courseId) : null,
      sourceId: Number(draft.sourceId || lead?.sourceId),
      statusCode: draft.statusCode,
      language: draft.language,
      comment: compact(draft.comment) || null,
    }),
    onSuccess: async () => {
      toast({ title: t('leadSaved') });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/academy/leads', leadId] }),
        queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/instagram/conversations'] }),
      ]);
      onChanged();
    },
    onError: (error: Error) => {
      toast({ title: t('leadSaveFailed'), description: error.message, variant: 'destructive' });
    },
  });

  const patchDraft = (changes: Partial<LeadDraft>) => setDraft((current) => ({ ...current, ...changes }));

  if (!leadId) {
    return (
      <aside className="flex min-h-[260px] items-center justify-center border-t border-border bg-muted/20 p-6 text-center xl:border-l xl:border-t-0">
        <div>
          <UserRound className="mx-auto mb-3 h-9 w-9 text-slate-400" />
          <p className="text-sm font-medium text-slate-700">{t('selectConversation')}</p>
        </div>
      </aside>
    );
  }

  if (leadQuery.isLoading || !lead) {
    return (
      <aside className="space-y-4 border-t border-border p-4 xl:border-l xl:border-t-0">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-28 w-full" />
      </aside>
    );
  }

  if (leadQuery.isError) {
    return (
      <aside className="border-t border-border p-4 xl:border-l xl:border-t-0">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('failedToLoadData')}</AlertTitle>
          <AlertDescription>
            <Button className="mt-3" variant="outline" size="sm" onClick={() => leadQuery.refetch()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </aside>
    );
  }

  return (
    <aside className="flex min-h-0 flex-col border-t border-border bg-background xl:border-l xl:border-t-0">
      <div className="border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-muted-foreground">{t('leadCard')}</p>
            <h2 className="mt-1 truncate text-base font-semibold text-slate-900">{lead.contactName}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{statusName(lead.statusCode)}</Badge>
              {lead.managerName ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <UserRoundCog className="h-3.5 w-3.5" />
                  {lead.managerName}
                </span>
              ) : null}
            </div>
          </div>
          <Button asChild variant="outline" size="icon" aria-label={t('openPipeline')}>
            <a href={`/sales/pipeline?lead=${lead.id}`}>
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <Label htmlFor="instagram-lead-contact">{t('contactPersonName')}</Label>
            <Input
              id="instagram-lead-contact"
              value={draft.contactName}
              onChange={(event) => patchDraft({ contactName: event.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="space-y-2">
              <Label htmlFor="instagram-lead-phone">{t('phone')}</Label>
              <Input
                id="instagram-lead-phone"
                value={draft.phone}
                onChange={(event) => patchDraft({ phone: event.target.value })}
                placeholder="+998..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="instagram-lead-messenger">{t('telegramWhatsapp')}</Label>
              <Input
                id="instagram-lead-messenger"
                value={draft.messenger}
                onChange={(event) => patchDraft({ messenger: event.target.value })}
                placeholder="@username"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="space-y-2">
              <Label htmlFor="instagram-student-name">{t('studentName')}</Label>
              <Input
                id="instagram-student-name"
                value={draft.studentName}
                onChange={(event) => patchDraft({ studentName: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="instagram-student-age">{t('age')}</Label>
              <Input
                id="instagram-student-age"
                type="number"
                min="1"
                value={draft.studentAge}
                onChange={(event) => patchDraft({ studentAge: event.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('course')}</Label>
            <Select value={draft.courseId || 'none'} onValueChange={(value) => patchDraft({ courseId: value === 'none' ? '' : value })}>
              <SelectTrigger>
                <SelectValue placeholder={t('courseNotSelected')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">{t('courseNotSelected')}</SelectItem>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="space-y-2">
              <Label>{t('status')}</Label>
              <Select
                value={draft.statusCode}
                onValueChange={(value) => patchDraft({ statusCode: value })}
                disabled={lead.statusCode === 'paid'}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {statuses.map((status) => (
                      <SelectItem key={status.code ?? status.id} value={String(status.code)}>
                        {statusName(String(status.code))}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('source')}</Label>
              <Select value={draft.sourceId} onValueChange={(value) => patchDraft({ sourceId: value })}>
                <SelectTrigger>
                  <SelectValue placeholder={t('selectSource')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {sources.map((source) => (
                      <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('communicationLanguage')}</Label>
            <Select value={draft.language} onValueChange={(value) => patchDraft({ language: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="ru">{t('russian')}</SelectItem>
                  <SelectItem value="uz">{t('uzbekLang')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="instagram-lead-comment">{t('comment')}</Label>
            <Textarea
              id="instagram-lead-comment"
              value={draft.comment}
              onChange={(event) => patchDraft({ comment: event.target.value })}
              className="min-h-24 resize-none"
            />
          </div>
        </div>
      </ScrollArea>

      <div className="border-t border-border p-4">
        <Button
          className="w-full"
          onClick={() => updateLead.mutate()}
          disabled={!isDirty || updateLead.isPending || !compact(draft.contactName) || !draft.sourceId}
        >
          {updateLead.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {updateLead.isPending ? t('saving') : t('saveChanges')}
        </Button>
      </div>
    </aside>
  );
}

export default function MessagesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const workspaceQuery = useQuery<SalesWorkspaceData>({
    queryKey: ['/api/academy/workspaces/sales'],
  });

  const conversationsQuery = useQuery<InstagramConversation[]>({
    queryKey: ['/api/instagram/conversations'],
  });

  const conversations = conversationsQuery.data ?? [];
  const filteredConversations = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const matchesFilter = filter === 'all'
        || (filter === 'unread' && conversation.unreadCount > 0)
        || (filter === 'reply' && conversation.canReply)
        || (filter === 'closed' && !conversation.canReply);
      if (!matchesFilter) return false;
      if (!normalizedSearch) return true;

      const haystack = [
        conversation.participantUsername,
        conversation.participantName,
        conversation.contactName,
        conversation.lastMessage,
        conversation.accountUsername,
        conversation.leadId ? `#${conversation.leadId}` : '',
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [conversations, filter, search]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  useEffect(() => {
    if (filteredConversations.length === 0) {
      setSelectedConversationId(null);
      return;
    }
    if (!selectedConversationId || !filteredConversations.some((conversation) => conversation.id === selectedConversationId)) {
      setSelectedConversationId(filteredConversations[0].id);
    }
  }, [filteredConversations, selectedConversationId]);

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
      queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] });
    },
    onError: (error: Error) => {
      toast({
        title: t('instagramMessageNotSent'),
        description: error.message || t('instagramSendFailed'),
        variant: 'destructive',
      });
    },
  });

  const syncConversations = useMutation({
    mutationFn: () => apiRequest('POST', '/api/instagram/conversations/sync'),
    onSuccess: async (stats: any) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/instagram/conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] }),
      ]);
      toast({
        title: t('instagramSyncComplete'),
        description: t('instagramSyncSummary')
          .replace('{conversations}', String(stats?.conversations ?? 0))
          .replace('{messages}', String(stats?.messages ?? 0))
          .replace('{leads}', String(stats?.leadsCreated ?? 0)),
      });
    },
    onError: (error: Error) => {
      toast({ title: t('instagramSyncFailed'), description: error.message, variant: 'destructive' });
    },
  });

  const statusName = (code: string) => {
    const status = workspaceQuery.data?.statuses?.find((item) => item.code === code);
    return status?.name ?? code;
  };

  const submitMessage = () => {
    const content = draft.trim();
    if (!content || !selectedConversationId || !selectedConversation?.canReply) return;
    sendMessage.mutate(content);
  };

  const unreadCount = conversations.reduce((count, conversation) => count + (conversation.unreadCount > 0 ? 1 : 0), 0);
  const replyableCount = conversations.filter((conversation) => conversation.canReply).length;

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
        title={t('messages')}
        subtitle={t('messagesDesc')}
        breadcrumbs={[
          { label: t('navDashboard'), href: '/sales' },
          { label: t('messages') },
        ]}
        actions={(
          <Button
            size="sm"
            variant="outline"
            onClick={() => syncConversations.mutate()}
            disabled={syncConversations.isPending}
          >
            {syncConversations.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {syncConversations.isPending ? t('instagramSyncing') : t('instagramSync')}
          </Button>
        )}
      />

      <Card className="mt-6 overflow-hidden">
        {conversations.length === 0 ? (
          <div className="flex min-h-[620px] items-center justify-center p-8 text-center">
            <div>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <MessageCircle className="h-7 w-7" />
              </div>
              <h2 className="mt-4 font-semibold text-slate-900">{t('noConversations')}</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                {t('noConversationsDesc')}
              </p>
              <Button
                className="mt-4"
                onClick={() => syncConversations.mutate()}
                disabled={syncConversations.isPending}
              >
                {syncConversations.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {syncConversations.isPending ? t('instagramSyncing') : t('instagramSync')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid min-h-[720px] grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
            <div className="min-h-0 border-b border-border xl:border-b-0 xl:border-r">
              <div className="space-y-3 border-b border-border p-4">
                <div className="flex items-center gap-2">
                  <Instagram className="h-5 w-5 text-primary" />
                  <h2 className="font-semibold text-slate-900">{t('conversations')}</h2>
                  <Badge className="ml-auto" variant="secondary">{conversations.length}</Badge>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('instagramSearchPlaceholder')}
                    className="pl-9"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['all', t('allConversations'), conversations.length],
                    ['unread', t('unreadConversations'), unreadCount],
                    ['reply', t('canReplyConversations'), replyableCount],
                    ['closed', t('closedConversations'), conversations.length - replyableCount],
                  ].map(([value, label, count]) => (
                    <Button
                      key={String(value)}
                      type="button"
                      variant={filter === value ? 'default' : 'outline'}
                      size="sm"
                      className="justify-between"
                      onClick={() => setFilter(value as ConversationFilter)}
                    >
                      <span className="truncate">{label}</span>
                      <span className="tabular-nums">{count}</span>
                    </Button>
                  ))}
                </div>
              </div>

              <ScrollArea className="h-[320px] xl:h-[632px]">
                <div className="p-2">
                  {filteredConversations.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">{t('noSearchResults')}</div>
                  ) : filteredConversations.map((conversation) => {
                    const participantLabel = conversation.participantName
                      || conversation.participantUsername
                      || conversation.contactName
                      || t('instagramUser');
                    const selected = conversation.id === selectedConversationId;
                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        className={`flex w-full items-start gap-3 rounded-md p-3 text-left transition-colors ${
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
                          <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                            <span className="inline-flex min-w-0 items-center gap-1 truncate">
                              <AtSign className="h-3 w-3 shrink-0" />
                              <span className="truncate">{conversation.accountUsername}</span>
                            </span>
                            <span className="ml-auto shrink-0">{formatDateTime(conversation.lastMessageAt)}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {conversation.leadId ? (
                              <Badge variant="outline">#{conversation.leadId}</Badge>
                            ) : null}
                            <Badge variant={conversation.canReply ? 'success' : 'secondary'}>
                              {conversation.canReply ? t('replyWindowOpen') : t('replyWindowClosed')}
                            </Badge>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            <div className="flex min-h-[720px] min-w-0 flex-col">
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
                        {t('lead')} #{selectedConversation.leadId} - @{selectedConversation.accountUsername}
                      </p>
                    </div>
                    <Badge className="ml-auto" variant={selectedConversation.canReply ? 'success' : 'secondary'}>
                      {selectedConversation.canReply ? (
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                      ) : (
                        <Clock3 className="mr-1 h-3.5 w-3.5" />
                      )}
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
                        {sendMessage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
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

            <LeadPanel
              leadId={selectedConversation?.leadId}
              workspaceData={workspaceQuery.data}
              statusName={statusName}
              onChanged={() => {
                queryClient.invalidateQueries({ queryKey: ['/api/instagram/conversations'] });
                queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] });
              }}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
