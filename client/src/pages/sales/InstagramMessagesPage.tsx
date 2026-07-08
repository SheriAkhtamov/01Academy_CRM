import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearch } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  isInstagramLead,
  isSyntheticInstagramPhone,
  visibleLeadPhones,
} from '@/lib/leadContact';
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertCircle,
  ArrowDown,
  ArrowDownUp,
  AtSign,
  Check,
  CheckCheck,
  ChevronLeft,
  Clock3,
  Copy,
  CornerDownLeft,
  CornerUpLeft,
  ExternalLink,
  Image as ImageIcon,
  Info,
  Instagram,
  Loader2,
  MailOpen,
  Maximize2,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  SearchX,
  Send,
  Smile,
  Sparkles,
  Trash2,
  UserRound,
  UserRoundCog,
  X,
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
  lastReadMessageAt?: string | null;
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
  attachments?: InstagramMessageAttachment[];
  deliveredAt?: string | null;
  readAt?: string | null;
  createdAt: string;
}

type MediaType =
  | 'image'
  | 'video'
  | 'animated_gif'
  | 'audio'
  | 'share'
  | 'sticker'
  | 'like'
  | 'file'
  | 'generic';

interface InstagramMessageAttachment {
  type: MediaType;
  url?: string;
  previewUrl?: string;
  link?: string;
  title?: string;
  subtitle?: string;
}

type ThreadMessage = InstagramMessage & { pending?: boolean; failed?: boolean };

type ThreadItem =
  | { kind: 'date'; id: string; label: string }
  | { kind: 'unread'; id: string; label: string }
  | { kind: 'message'; id: number; message: ThreadMessage; showTime: boolean };

interface InstagramSyncStats {
  accounts: number;
  conversations: number;
  conversationsCreated: number;
  messages: number;
  leadsCreated: number;
  skipped: number;
  errors: number;
}

interface InstagramSyncStatus {
  status: 'idle' | 'running' | 'completed' | 'partial' | 'failed';
  requestedBy?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  stats: InstagramSyncStats;
  error?: string | null;
  started?: boolean;
  alreadyRunning?: boolean;
}

const LEGACY_ATTACHMENT = /^\[(image|video|animated_gif|audio|share|sticker|like|attachment|generic)\]\s*(\S+)\s*$/;

const parseLegacyAttachment = (content?: string): InstagramMessageAttachment[] => {
  if (!content) return [];
  const match = content.match(LEGACY_ATTACHMENT);
  if (!match) return [];
  const type = match[1] as MediaType;
  const url = match[2];
  if (type === 'share') return [{ type: 'share', link: url }];
  return [{ type, url }];
};

interface LookupOption {
  id: number;
  name: string;
  code?: string;
  channel?: string | null;
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
  sourceName?: string | null;
  sourceChannel?: string | null;
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

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'IG';

const compact = (value: string) => value.trim();

const buildLeadDraft = (lead: LeadDetails): LeadDraft => {
  const phone = visibleLeadPhones(lead)[0] ?? '';

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

const startOfDay = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

const listTimestamp = (value?: string | null, t?: (key: TranslationKey) => string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (diffDays <= 0) return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1 && t) return t('yesterday');
  if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
};

const daySeparatorLabel = (value: string | undefined, t: (key: TranslationKey) => string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return t('today');
  if (diffDays === 1) return t('yesterday');
  const sameYear = new Date().getFullYear() === date.getFullYear();
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

const clockTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

const syncSummaryText = (stats: Partial<InstagramSyncStats> | undefined, t: (key: TranslationKey) => string) =>
  t('instagramSyncSummary')
    .replace('{conversations}', String(stats?.conversations ?? 0))
    .replace('{messages}', String(stats?.messages ?? 0))
    .replace('{leads}', String(stats?.leadsCreated ?? 0));

// Outbound receipt state, derived from the webhook-backed timestamps.
//   pending  – optimistic, not yet confirmed by the server
//   sent     – accepted by Graph API, no delivery/read event yet
//   delivered – message_deliveries webhook confirmed delivery
//   read     – messaging_seen webhook confirmed the participant saw it
type ReceiptState = 'pending' | 'sent' | 'delivered' | 'read';

const receiptStateFor = (message: ThreadMessage): ReceiptState => {
  if (message.pending) return 'pending';
  if (message.failed) return 'sent';
  if (message.direction !== 'outbound') return 'sent';
  if (message.readAt) return 'read';
  if (message.deliveredAt) return 'delivered';
  return 'sent';
};

const buildThreadItems = (
  messages: ThreadMessage[],
  t: (key: TranslationKey) => string,
  searchQuery = '',
  lastReadAt?: string | null,
): ThreadItem[] => {
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleMessages = normalizedSearch
    ? messages.filter((message) => message.content?.toLowerCase().includes(normalizedSearch))
    : messages;

  // Insert the "unread" divider above the first inbound message newer than the
  // manager's high-water mark. Only relevant when not searching (search hides
  // messages, so a divider would be misleading) and the conversation is unread.
  const readWatermark = lastReadAt ? new Date(lastReadAt).getTime() : null;
  let unreadDividerInserted = Boolean(readWatermark !== null && !normalizedSearch);

  const items: ThreadItem[] = [];
  let lastDay = '';
  let lastDirection: string | null = null;
  let lastTime = 0;

  for (const message of visibleMessages) {
    const day = (message.createdAt || '').slice(0, 10);
    if (day && day !== lastDay) {
      items.push({ kind: 'date', id: `date-${day}`, label: daySeparatorLabel(message.createdAt, t) });
      lastDay = day;
      lastDirection = null;
    }

    const time = new Date(message.createdAt).getTime();

    if (unreadDividerInserted && readWatermark !== null
      && message.direction === 'inbound' && time > readWatermark) {
      items.push({ kind: 'unread', id: 'unread-divider', label: t('unreadMessages') });
      unreadDividerInserted = false;
    }
    const withinGroup = lastDirection === message.direction && time - lastTime < 5 * 60 * 1000;
    items.push({ kind: 'message', id: message.id, message, showTime: !withinGroup });
    lastDirection = message.direction;
    lastTime = time;
  }

  return items;
};

function Highlight({ text, query }: { text: string; query: string }) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  let idx = rest.toLowerCase().indexOf(normalized);
  while (idx !== -1) {
    if (idx > 0) parts.push(<span key={key++}>{rest.slice(0, idx)}</span>);
    parts.push(
      <mark key={key++} className="rounded-sm bg-primary/30 px-0.5 text-inherit">
        {rest.slice(idx, idx + normalized.length)}
      </mark>,
    );
    rest = rest.slice(idx + normalized.length);
    idx = rest.toLowerCase().indexOf(normalized);
  }
  if (rest) parts.push(<span key={key++}>{rest}</span>);
  return <>{parts}</>;
}

const mediaTypeLabel = (type: MediaType, t: (key: TranslationKey) => string) => {
  switch (type) {
    case 'image':
    case 'sticker':
    case 'like':
      return t('mediaPhoto');
    case 'video':
      return t('mediaVideo');
    case 'animated_gif':
      return t('mediaGif');
    case 'audio':
      return t('mediaAudio');
    case 'share':
      return t('mediaAttachment');
    default:
      return t('mediaAttachment');
  }
};

function AttachmentMedia({
  attachment,
  onOpen,
}: {
  attachment: InstagramMessageAttachment;
  onOpen: (media: { url: string; type: MediaType; title?: string }) => void;
}) {
  const { t } = useTranslation();
  const mediaUrl = attachment.url || attachment.previewUrl;
  const isVisualMedia = ['image', 'animated_gif', 'sticker', 'like', 'share'].includes(attachment.type);

  if (attachment.type === 'audio') {
    return mediaUrl ? (
      <audio controls src={mediaUrl} className="max-w-full" />
    ) : null;
  }

  if (mediaUrl) {
    if (attachment.type === 'video') {
      return (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video
            controls
            src={mediaUrl}
            className="max-h-80 w-full"
            poster={attachment.previewUrl}
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute right-2 top-2 h-8 w-8 bg-background/90 shadow-sm hover:bg-background"
            aria-label={t('viewMedia')}
            onClick={() => onOpen({ url: mediaUrl, type: 'video', title: attachment.title })}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      );
    }

    if (isVisualMedia) {
      return (
        <button
          type="button"
          className="block overflow-hidden rounded-xl"
          onClick={() => onOpen({ url: mediaUrl, type: 'image', title: attachment.title })}
        >
          <img
            src={mediaUrl}
            alt={attachment.title || t('viewMedia')}
            className="max-h-80 w-full max-w-sm object-cover transition-transform hover:scale-[1.01]"
            loading="lazy"
          />
        </button>
      );
    }

    return (
      <div className="max-w-sm rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-medium text-primary underline-offset-2 hover:underline">
            {attachment.title || mediaTypeLabel(attachment.type, t)}
          </a>
        </div>
      </div>
    );
  }

  if (attachment.link) {
    return (
      <a
        href={attachment.link}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm text-primary underline"
      >
        <ExternalLink className="h-4 w-4" />
        {attachment.title || t('mediaAttachment')}
      </a>
    );
  }

  return null;
}

function MessagesSkeleton() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-6 lg:p-8">
      <Skeleton className="h-10 w-72" />
      <div className="grid h-[calc(100dvh-9rem)] min-h-[620px] grid-cols-1 rounded-2xl border border-border bg-card xl:grid-cols-[340px_minmax(0,1fr)_372px]">
        <div className="hidden flex-col gap-3 border-r border-border p-4 xl:flex">
          <Skeleton className="h-9 w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-7 w-16 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
          </div>
          <div className="mt-2 space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl p-3">
                <Skeleton className="h-11 w-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="hidden flex-col xl:flex">
          <div className="flex items-center gap-3 border-b border-border p-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
          <div className="flex-1 space-y-4 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className={`h-14 w-2/3 ${i % 2 ? 'ml-auto' : ''}`} />
            ))}
          </div>
          <div className="border-t border-border p-4">
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        </div>
        <div className="hidden border-l border-border p-4 xl:block">
          <Skeleton className="h-8 w-44" />
        </div>
      </div>
    </div>
  );
}

const FILTERS = [
  { value: 'all', labelKey: 'allConversations' },
  { value: 'unread', labelKey: 'unreadConversations' },
  { value: 'reply', labelKey: 'canReplyConversations' },
  { value: 'closed', labelKey: 'closedConversations' },
] satisfies { value: ConversationFilter; labelKey: TranslationKey }[];

const QUICK_REPLIES_STORAGE_KEY = 'ig_quick_replies_v1';

const DEFAULT_QUICK_REPLIES = [
  'Здравствуйте! Чем можем помочь? 😊',
  'Спасибо за интерес к нашей академии!',
  'Подскажите, какого возраста ребёнок?',
  'Запишитесь на бесплатное пробное занятие 🎓',
  'Отправьте, пожалуйста, удобное время для звонка',
  'Курсы стартуют уже на этой неделе 🚀',
];

const EMOJI_SET = [
  '😊', '😍', '🙂', '😉', '🤩', '👍', '🙏', '🔥', '🎉', '🎓',
  '🚀', '💡', '✅', '❤️', '👋', '🤝', '📚', '⭐', '✨', '💪',
  '📞', '⏰', '💬', '📩', '👌', '🤗', '😎', '🥳', '💯', '🌟',
];

function useQuickReplies() {
  const [replies, setReplies] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(QUICK_REPLIES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_QUICK_REPLIES;
  });

  const persist = (next: string[]) => {
    setReplies(next);
    try {
      localStorage.setItem(QUICK_REPLIES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const addReply = (text: string) => {
    const value = text.trim();
    if (!value || replies.includes(value)) return;
    persist([...replies, value]);
  };

  const removeReply = (text: string) => persist(replies.filter((item) => item !== text));

  return { replies, addReply, removeReply };
}

function Popover({
  open,
  onClose,
  align = 'left',
  trigger,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  align?: 'left' | 'right';
  trigger: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div className="relative" ref={ref}>
      {trigger}
      {open ? (
        <div
          className={cn(
            'absolute bottom-full z-50 mb-2 w-72 origin-bottom rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function LeadPanel({
  leadId,
  conversation,
  workspaceData,
  statusName,
  onCollapsedChange,
  onChanged,
  onCloseMobile,
}: {
  leadId?: number | null;
  conversation?: InstagramConversation | null;
  workspaceData?: SalesWorkspaceData;
  statusName: (code: string) => string;
  onCollapsedChange: () => void;
  onChanged: () => void;
  onCloseMobile: () => void;
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
    mutationFn: () => {
      const nextPhone = compact(draft.phone);
      const hasOnlyHiddenInstagramPhone = Boolean(
        lead
        && !nextPhone
        && visibleLeadPhones(lead).length === 0
        && (
          isSyntheticInstagramPhone(lead.phone)
          || (lead.phoneNumbers ?? []).some(isSyntheticInstagramPhone)
        ),
      );

      return apiRequest('PATCH', `/api/academy/leads/${leadId}`, {
        contactName: compact(draft.contactName),
        ...(hasOnlyHiddenInstagramPhone ? {} : { phoneNumbers: nextPhone ? [nextPhone] : [] }),
        messenger: compact(draft.messenger) || null,
        studentName: compact(draft.studentName) || null,
        studentAge: compact(draft.studentAge) ? Number(draft.studentAge) : null,
        courseId: draft.courseId ? Number(draft.courseId) : null,
        sourceId: Number(draft.sourceId || lead?.sourceId),
        statusCode: draft.statusCode,
        language: draft.language,
        comment: compact(draft.comment) || null,
      });
    },
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

  const Header = (
    <div className="flex items-center justify-between gap-2 border-b border-border p-4">
      <div className="flex min-w-0 items-center gap-2">
        <UserRoundCog className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="truncate text-sm font-semibold text-slate-900">{t('leadCard')}</p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="xl:hidden"
          aria-label={t('closeLeadPanel')}
          onClick={onCloseMobile}
        >
          <X className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="hidden xl:inline-flex"
          aria-label={t('collapseLeadCard')}
          onClick={onCollapsedChange}
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  if (!leadId) {
    const participantLabel = conversation?.participantName
      || conversation?.participantUsername
      || conversation?.contactName
      || t('instagramUser');
    return (
      <aside className="flex min-h-0 flex-col border-t border-border bg-muted/20 xl:border-l xl:border-t-0">
        {Header}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('conversationDetails')}</p>
          <div className="rounded-xl border border-border bg-background p-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-11 w-11">
                {conversation?.participantProfilePictureUrl ? (
                  <AvatarImage src={conversation.participantProfilePictureUrl} alt="" />
                ) : null}
                <AvatarFallback>{initials(participantLabel)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{participantLabel}</p>
                {conversation?.participantUsername ? (
                  <p className="truncate text-xs text-slate-500">@{conversation.participantUsername}</p>
                ) : null}
              </div>
            </div>

            <div className="mt-3 space-y-2 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <AtSign className="h-3.5 w-3.5 shrink-0" />
                <span className="shrink-0 font-medium text-slate-400">{t('conversationAccount')}:</span>
                <span className="truncate">@{conversation?.accountUsername}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={conversation?.canReply ? 'success' : 'secondary'}>
                  {conversation?.canReply ? t('replyWindowOpen') : t('replyWindowClosed')}
                </Badge>
                {conversation?.leadId ? <Badge variant="outline">#{conversation.leadId}</Badge> : null}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-amber-800">{t('notLinkedToLead')}</p>
                <p className="mt-1 text-xs text-amber-700">{t('notLinkedToLeadHint')}</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  if (leadQuery.isLoading || !lead) {
    return (
      <aside className="flex min-h-0 flex-col border-t border-border bg-background xl:border-l xl:border-t-0">
        {Header}
        <div className="space-y-4 p-4">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </aside>
    );
  }

  if (leadQuery.isError) {
    return (
      <aside className="flex min-h-0 flex-col border-t border-border bg-background xl:border-l xl:border-t-0">
        {Header}
        <div className="p-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t('failedToLoadData')}</AlertTitle>
            <AlertDescription>
              <Button className="mt-3" variant="outline" size="sm" onClick={() => leadQuery.refetch()}>
                {t('retry')}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
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
          <div className="flex shrink-0 items-center gap-1">
            <Button asChild variant="outline" size="icon" aria-label={t('openPipeline')}>
              <a href={`/sales/pipeline?lead=${lead.id}`}>
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="xl:hidden"
              aria-label={t('closeLeadPanel')}
              onClick={onCloseMobile}
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="hidden xl:inline-flex"
              aria-label={t('collapseLeadCard')}
              onClick={onCollapsedChange}
            >
              <PanelRightClose className="h-4 w-4" />
            </Button>
          </div>
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
              <Label htmlFor="instagram-lead-messenger">{isInstagramLead(lead) ? t('instagramContactChannel') : t('telegramWhatsapp')}</Label>
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
  const routeSearch = useSearch();
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [draftsByConversation, setDraftsByConversation] = useState<Record<number, string>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [leadCollapsed, setLeadCollapsed] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list');
  const [mobileLeadOpen, setMobileLeadOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [lightbox, setLightbox] = useState<{ url: string; type: MediaType; title?: string } | null>(null);
  const [threadSearch, setThreadSearch] = useState('');
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [newTemplate, setNewTemplate] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [sortByUnread, setSortByUnread] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ig_sort_unread_v1') === '1';
    } catch {
      return false;
    }
  });
  const [activeMessageId, setActiveMessageId] = useState<number | null>(null);
  const [replyTarget, setReplyTarget] = useState<{ id: number; text: string } | null>(null);
  const [participantTyping, setParticipantTyping] = useState(false);

  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inboxCardRef = useRef<HTMLDivElement | null>(null);
  const initialScrollConversation = useRef<number | null>(null);

  const { replies: quickReplies, addReply, removeReply } = useQuickReplies();
  const draft = selectedConversationId ? draftsByConversation[selectedConversationId] ?? '' : '';
  const setDraft = (value: string | ((current: string) => string)) => {
    if (!selectedConversationId) return;
    setDraftsByConversation((currentDrafts) => {
      const current = currentDrafts[selectedConversationId] ?? '';
      const next = typeof value === 'function' ? value(current) : value;
      if (!next) {
        const { [selectedConversationId]: _removed, ...rest } = currentDrafts;
        return rest;
      }
      return { ...currentDrafts, [selectedConversationId]: next };
    });
  };

  const workspaceQuery = useQuery<SalesWorkspaceData>({
    queryKey: ['/api/academy/workspaces/sales'],
  });

  const conversationsQuery = useQuery<InstagramConversation[]>({
    queryKey: ['/api/instagram/conversations'],
  });

  const syncStatusQuery = useQuery<InstagramSyncStatus>({
    queryKey: ['/api/instagram/conversations/sync/status'],
    queryFn: () => apiRequest('GET', '/api/instagram/conversations/sync/status'),
    refetchInterval: (query) => (
      query.state.data?.status === 'running' ? 5000 : false
    ),
  });

  const conversations = conversationsQuery.data ?? [];
  const syncStatus = syncStatusQuery.data;
  const syncStatusRunning = syncStatus?.status === 'running';
  const requestedLeadId = useMemo(() => {
    const value = new URLSearchParams(routeSearch).get('lead');
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [routeSearch]);

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

  // Two-tier ordering: unread first (by most recent inbound), then the rest by
  // most recent activity. Toggleable so users who prefer strict chronological
  // order can keep the old behavior.
  const sortedConversations = useMemo(() => {
    if (!sortByUnread) return filteredConversations;
    const time = (value?: string | null) => (value ? new Date(value).getTime() : 0);
    return [...filteredConversations].sort((left, right) => {
      const lu = left.unreadCount > 0;
      const ru = right.unreadCount > 0;
      if (lu !== ru) return lu ? -1 : 1;
      const lt = time(lu ? left.lastInboundAt : left.lastMessageAt);
      const rt = time(ru ? right.lastInboundAt : right.lastMessageAt);
      return rt - lt;
    });
  }, [filteredConversations, sortByUnread]);

  const toggleSortByUnread = (next: boolean) => {
    setSortByUnread(next);
    try {
      localStorage.setItem('ig_sort_unread_v1', next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  const messagesKey = useMemo(
    () => ['/api/instagram/conversations', selectedConversationId, 'messages'] as const,
    [selectedConversationId],
  );

  const messagesQuery = useQuery<InstagramMessage[]>({
    queryKey: messagesKey,
    queryFn: () => apiRequest('GET', `/api/instagram/conversations/${selectedConversationId}/messages`),
    enabled: Boolean(selectedConversationId),
  });

  const messages = useMemo<ThreadMessage[]>(
    () => (messagesQuery.data ?? []).map((message) => message as ThreadMessage),
    [messagesQuery.data],
  );

  // Stable selection: keep the open conversation even if a filter/search hides it,
  // instead of jumping to the first visible item.
  useEffect(() => {
    if (conversations.length === 0) {
      setSelectedConversationId(null);
      return;
    }
    const exists = conversations.some((conversation) => conversation.id === selectedConversationId);
    if (!exists) {
      const target = filteredConversations[0]?.id ?? conversations[0].id;
      setSelectedConversationId(target);
    }
  }, [conversations, filteredConversations, selectedConversationId]);

  useEffect(() => {
    if (!requestedLeadId || conversations.length === 0) return;
    const target = conversations.find((conversation) => Number(conversation.leadId) === requestedLeadId);
    if (!target) return;
    setFilter('all');
    setSearch('');
    setLeadCollapsed(false);
    setMobileLeadOpen(false);
    if (target.id !== selectedConversationId) {
      setSelectedConversationId(target.id);
    }
    setMobileView('thread');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, requestedLeadId]);

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

  const getViewport = () => {
    const root = threadScrollRef.current;
    if (!root) return null;
    return root.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement | null;
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const viewport = getViewport();
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    setAtBottom(true);
  };

  const messageCount = messages.length;
  const prevMessageCount = useRef(messageCount);

  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    const updateAtBottom = () => {
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setAtBottom(distance < 80);
    };

    updateAtBottom();
    viewport.addEventListener('scroll', updateAtBottom, { passive: true });
    return () => viewport.removeEventListener('scroll', updateAtBottom);
  }, [selectedConversationId, messageCount, threadSearchOpen]);

  // Reliable initial scroll: when the open conversation's messages finish loading
  // (or change because the user switched conversations), jump to the latest message.
  useEffect(() => {
    if (!selectedConversationId) return;
    if (initialScrollConversation.current !== selectedConversationId) {
      if (messages.length > 0 || !messagesQuery.isLoading) {
        requestAnimationFrame(() => scrollToBottom('auto'));
        initialScrollConversation.current = selectedConversationId;
      }
    }
  }, [selectedConversationId, messages, messagesQuery.isLoading]);

  useEffect(() => {
    if (!selectedConversationId) return;
    const grew = messageCount > prevMessageCount.current;
    if (grew && atBottom) {
      requestAnimationFrame(() => scrollToBottom('auto'));
    } else if (messageCount === 0) {
      requestAnimationFrame(() => scrollToBottom('auto'));
    }
    prevMessageCount.current = messageCount;
  }, [messageCount, selectedConversationId, atBottom]);

  const sendMessage = useMutation({
    mutationFn: (content: string) =>
      apiRequest('POST', `/api/instagram/conversations/${selectedConversationId}/messages`, { content }),
    onMutate: (content) => {
      if (!selectedConversationId) return;
      const optimistic: ThreadMessage = {
        id: -Date.now(),
        conversationId: selectedConversationId,
        externalMessageId: null,
        direction: 'outbound',
        senderIgsid: '',
        recipientIgsid: '',
        content,
        messageType: 'text',
        status: 'pending',
        sentBy: null,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      setDraft('');
      queryClient.setQueryData<ThreadMessage[]>(messagesKey, (previous = []) => [...previous, optimistic]);
    },
    onSuccess: (message: InstagramMessage) => {
      queryClient.setQueryData<ThreadMessage[]>(messagesKey, (previous = []) =>
        previous.map((item) => (item.pending ? (message as ThreadMessage) : item)),
      );
      queryClient.invalidateQueries({ queryKey: ['/api/instagram/conversations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] });
    },
    onError: (error: Error) => {
      queryClient.setQueryData<ThreadMessage[]>(messagesKey, (previous = []) =>
        previous.map((item) => (item.pending ? { ...item, pending: false, failed: true } : item)),
      );
      toast({
        title: t('instagramMessageNotSent'),
        description: error.message || t('instagramSendFailed'),
        variant: 'destructive',
      });
    },
  });

  const retryMessage = (content: string) => {
    queryClient.setQueryData<ThreadMessage[]>(messagesKey, (previous = []) =>
      previous.filter((item) => !(item.failed && item.content === content)),
    );
    if (selectedConversationId) sendMessage.mutate(content);
  };

  const syncConversations = useMutation({
    mutationFn: () => apiRequest('POST', '/api/instagram/conversations/sync'),
    onSuccess: (status: InstagramSyncStatus) => {
      queryClient.setQueryData(['/api/instagram/conversations/sync/status'], status);
      if (status.status === 'running') {
        toast({
          title: status.alreadyRunning ? t('instagramSyncRunning') : t('instagramSyncStarted'),
          description: t('instagramSyncStartedDesc'),
        });
        return;
      }
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/instagram/conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] }),
      ]);
      toast({
        title: status.status === 'failed'
          ? t('instagramSyncFailed')
          : status.status === 'partial'
            ? t('instagramSyncPartial')
            : t('instagramSyncComplete'),
        description: syncSummaryText(status.stats, t),
        variant: status.status === 'failed' ? 'destructive' : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: t('instagramSyncFailed'), description: error.message, variant: 'destructive' });
    },
  });
  const syncRunning = syncConversations.isPending || syncStatusRunning;

  const statusName = (code: string) => {
    const status = workspaceQuery.data?.statuses?.find((item) => item.code === code);
    return status?.name ?? code;
  };

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  useEffect(() => {
    autoResize();
  }, [draft]);

  const submitMessage = () => {
    const content = draft.trim();
    if (!content || !selectedConversationId || !selectedConversation?.canReply) return;
    if (sendMessage.isPending) return;
    sendMessage.mutate(content);
  };

  const insertAtCursor = (text: string) => {
    const el = textareaRef.current;
    if (!el) {
      setDraft((current) => current + text);
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
      autoResize();
    });
  };

  const copyMessage = (text: string, id: number) => {
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1400);
  };

  const selectConversation = (id: number) => {
    setSelectedConversationId(id);
    setThreadSearch('');
    setThreadSearchOpen(false);
    setQuickOpen(false);
    setEmojiOpen(false);
    setMobileLeadOpen(false);
    if (window.matchMedia('(max-width: 1279px)').matches) {
      setMobileView('thread');
      requestAnimationFrame(() => {
        inboxCardRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
  };

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const handleListKeyDown = (event: React.KeyboardEvent) => {
    if (filteredConversations.length === 0) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = filteredConversations.findIndex((c) => c.id === selectedConversationId);
    let nextIndex = index;
    if (event.key === 'ArrowDown') {
      nextIndex = index < 0 ? 0 : Math.min(index + 1, filteredConversations.length - 1);
    } else {
      nextIndex = index < 0 ? filteredConversations.length - 1 : Math.max(index - 1, 0);
    }
    const next = filteredConversations[nextIndex];
    if (next) selectConversation(next.id);
  };

  const unreadCount = conversations.reduce((count, conversation) => count + (conversation.unreadCount > 0 ? 1 : 0), 0);
  const replyableCount = conversations.filter((conversation) => conversation.canReply).length;

  const threadQuery = threadSearch.trim().toLowerCase();
  const threadItems = useMemo(
    () => buildThreadItems(messages, t, threadQuery),
    [messages, t, threadQuery],
  );
  const threadMatchCount = useMemo(
    () => threadItems.filter((item) => item.kind === 'message').length,
    [threadItems],
  );
  const showSyncStatus = Boolean(syncStatus && syncStatus.status !== 'idle');
  const syncStatusTitle = syncStatus?.status === 'running'
    ? t('instagramSyncing')
    : syncStatus?.status === 'partial'
      ? t('instagramSyncPartial')
      : syncStatus?.status === 'failed'
        ? t('instagramSyncFailed')
        : t('instagramSyncComplete');
  const hasSyncProgress = Object.values(syncStatus?.stats ?? {}).some((value) => Number(value) > 0);
  const syncStatusError = syncStatus?.error && syncStatus.error !== 'instagramSyncPartial'
    ? syncStatus.error
    : '';
  const syncStatusDescription = syncStatus?.status === 'running'
    ? hasSyncProgress
      ? syncSummaryText(syncStatus?.stats, t)
      : t('instagramSyncRunningDesc')
    : [syncSummaryText(syncStatus?.stats, t), syncStatusError].filter(Boolean).join(' ');

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

  const gridCols = 'xl:grid-cols-[340px_minmax(0,1fr)_372px]';

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
            disabled={syncRunning}
          >
            {syncRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {syncRunning ? t('instagramSyncing') : t('instagramSync')}
          </Button>
        )}
      />

      {showSyncStatus ? (
        <div
          className={cn(
            'mt-4 flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between',
            syncStatus?.status === 'failed'
              ? 'border-red-200 bg-red-50 text-red-900'
              : syncStatus?.status === 'partial'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-primary/20 bg-primary/10 text-primary',
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            {syncStatus?.status === 'running' ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <Clock3 className="h-4 w-4 shrink-0" />
            )}
            <span className="font-medium">{syncStatusTitle}</span>
          </div>
          <span className="text-xs sm:text-right">{syncStatusDescription}</span>
        </div>
      ) : null}

      <Card
        ref={inboxCardRef}
        className="mt-6 flex h-[calc(100dvh-9rem)] min-h-[600px] flex-col overflow-hidden rounded-2xl border-border shadow-sm"
      >
        {conversations.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div>
              <div
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-primary"
                style={{ background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))' }}
              >
                <MessageCircle className="h-8 w-8" />
              </div>
              <h2 className="mt-5 text-lg font-semibold text-slate-900">{t('noConversations')}</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                {t('noConversationsDesc')}
              </p>
              <Button
                className="mt-5"
                onClick={() => syncConversations.mutate()}
                disabled={syncRunning}
              >
                {syncRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {syncRunning ? t('instagramSyncing') : t('instagramSync')}
              </Button>
            </div>
          </div>
        ) : (
          <div className={cn('grid min-h-0 flex-1 grid-cols-1', gridCols)}>
            {/* Conversation list */}
            <div
              className={cn(
                'flex min-h-0 flex-col border-border',
                mobileView === 'list' ? 'flex' : 'hidden',
                'xl:flex xl:border-r',
              )}
            >
              <div className="space-y-3 border-b border-border bg-gradient-to-b from-primary/5 to-transparent p-4">
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-primary"
                    style={{ background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))' }}
                  >
                    <Instagram className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-semibold leading-tight text-slate-900">{t('conversations')}</h2>
                    <p className="text-xs text-muted-foreground">
                      {t('messagesCount').replace('{count}', String(conversations.length))}
                      {unreadCount > 0 ? ` · ${unreadCount} ${t('unreadConversations').toLowerCase()}` : ''}
                    </p>
                  </div>
                  {conversations.length > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ml-auto"
                      aria-label={t('instagramSync')}
                      onClick={() => syncConversations.mutate()}
                      disabled={syncRunning}
                    >
                      {syncRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  ) : null}
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
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {FILTERS.map(({ value, labelKey }) => {
                    const count = value === 'all'
                      ? conversations.length
                      : value === 'unread'
                        ? unreadCount
                        : value === 'reply'
                          ? replyableCount
                          : conversations.length - replyableCount;
                    const active = filter === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setFilter(value)}
                        className={cn(
                          'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          active
                            ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                            : 'border-border bg-background text-slate-600 hover:bg-muted',
                        )}
                      >
                        <span>{t(labelKey)}</span>
                        <span className={cn('tabular-nums', active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                ref={listRef}
                className="min-h-0 flex-1"
                onKeyDown={handleListKeyDown}
              >
                <ScrollArea className="h-full">
                  <div className="space-y-1 p-2">
                    {filteredConversations.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">{t('noSearchResults')}</div>
                    ) : filteredConversations.map((conversation) => {
                      const participantLabel = conversation.participantName
                        || conversation.participantUsername
                        || conversation.contactName
                        || t('instagramUser');
                      const selected = conversation.id === selectedConversationId;
                      const unread = conversation.unreadCount > 0;
                      const previewPrefix = conversation.lastMessageDirection === 'outbound' ? `${t('linkOutbound')}: ` : '';
                      return (
                        <button
                          key={conversation.id}
                          type="button"
                          aria-current={selected}
                          className={cn(
                            'relative flex w-full items-start gap-3 rounded-xl p-3 text-left transition-colors',
                            selected ? 'bg-primary/10 ring-1 ring-inset ring-primary/20' : 'hover:bg-muted',
                          )}
                          onClick={() => selectConversation(conversation.id)}
                        >
                          {selected ? (
                            <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-primary" />
                          ) : null}
                          <div className="relative shrink-0">
                            <Avatar className="h-11 w-11">
                              {conversation.participantProfilePictureUrl ? (
                                <AvatarImage src={conversation.participantProfilePictureUrl} alt="" />
                              ) : null}
                              <AvatarFallback>{initials(participantLabel)}</AvatarFallback>
                            </Avatar>
                            {unread ? (
                              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 rounded-full border-2 border-background bg-primary" />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className={cn('truncate text-sm', unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-800')}>
                                <Highlight text={conversation.participantUsername ? `@${conversation.participantUsername}` : participantLabel} query={search} />
                              </p>
                              <span className="ml-auto shrink-0 text-[11px] text-slate-400">
                                {listTimestamp(conversation.lastMessageAt, t)}
                              </span>
                            </div>
                            <p className={cn('mt-1 flex items-center gap-1 truncate text-xs', unread ? 'text-slate-700' : 'text-slate-500')}>
                              {(() => {
                                const previewLegacy = conversation.lastMessage?.match(LEGACY_ATTACHMENT);
                                if (previewLegacy) {
                                  return (
                                    <>
                                      <ImageIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                                      <span className="truncate">{mediaTypeLabel(previewLegacy[1] as MediaType, t)}</span>
                                    </>
                                  );
                                }
                                return (
                                  <Highlight
                                    text={`${previewPrefix}${conversation.lastMessage || t('noMessagesYet')}`}
                                    query={search}
                                  />
                                );
                              })()}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {conversation.leadId ? (
                                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">#{conversation.leadId}</Badge>
                              ) : null}
                              <Badge
                                variant={conversation.canReply ? 'success' : 'secondary'}
                                className="px-1.5 py-0 text-[10px]"
                              >
                                {conversation.canReply ? t('replyWindowOpen') : t('replyWindowClosed')}
                              </Badge>
                              {unread ? (
                                <Badge className="ml-auto h-5 min-w-5 justify-center px-1.5">
                                  {conversation.unreadCount}
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </div>

            {/* Thread */}
            <div
              className={cn(
                'flex min-h-0 min-w-0 flex-col',
                mobileView === 'thread' ? 'flex' : 'hidden',
                'xl:flex',
              )}
            >
              {selectedConversation ? (
                <>
                  <div className="flex items-center gap-3 border-b border-border bg-background/80 p-3 backdrop-blur sm:p-4">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="xl:hidden"
                      aria-label={t('backToConversations')}
                      onClick={() => setMobileView('list')}
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </Button>
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
                        {[
                          selectedConversation.leadId ? `${t('lead')} #${selectedConversation.leadId}` : null,
                          `@${selectedConversation.accountUsername}`,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('search')}
                            onClick={() => setThreadSearchOpen((value) => !value)}
                            className={threadSearchOpen ? 'bg-muted text-primary' : ''}
                          >
                            <Search className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('search')}</TooltipContent>
                      </Tooltip>
                      <Badge variant={selectedConversation.canReply ? 'success' : 'secondary'}>
                        {selectedConversation.canReply ? (
                          <CheckCheck className="mr-1 h-3.5 w-3.5" />
                        ) : (
                          <Clock3 className="mr-1 h-3.5 w-3.5" />
                        )}
                        {selectedConversation.canReply ? t('replyWindowOpen') : t('replyWindowClosed')}
                      </Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="xl:hidden"
                        aria-label={t('openLeadPanel')}
                        onClick={() => setMobileLeadOpen(true)}
                      >
                        <UserRoundCog className="h-5 w-5" />
                      </Button>
                    </div>
                  </div>

                  {threadSearchOpen ? (
                    <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 sm:px-4">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          autoFocus
                          value={threadSearch}
                          onChange={(event) => setThreadSearch(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setThreadSearch('');
                              setThreadSearchOpen(false);
                            }
                          }}
                          placeholder={t('searchInConversation')}
                          className="pl-9"
                        />
                      </div>
                      {threadQuery ? (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {threadMatchCount}
                        </span>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('closeLeadPanel')}
                        onClick={() => {
                          setThreadSearch('');
                          setThreadSearchOpen(false);
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}

                  {!selectedConversation.canReply ? (
                    <Alert className="m-4 mb-0">
                      <Clock3 className="h-4 w-4" />
                      <AlertTitle>{t('instagramMessagingWindowExpiredTitle')}</AlertTitle>
                      <AlertDescription>{t('instagramMessagingWindowExpiredDesc')}</AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="relative min-h-0 flex-1 bg-[radial-gradient(theme(colors.slate.200)_1px,transparent_1px)] [background-size:24px_24px] bg-muted/20">
                    <ScrollArea
                      ref={threadScrollRef}
                      className="h-full"
                    >
                      <div className="space-y-1 px-4 py-4">
                        {messagesQuery.isLoading ? (
                          Array.from({ length: 5 }).map((_, index) => (
                            <Skeleton key={index} className={`h-16 w-2/3 ${index % 2 ? 'ml-auto' : ''}`} />
                          ))
                        ) : messagesQuery.isError ? (
                          <div className="mx-auto max-w-md py-12">
                            <Alert variant="destructive">
                              <AlertCircle className="h-4 w-4" />
                              <AlertTitle>{t('failedToLoadData')}</AlertTitle>
                              <AlertDescription>
                                <div className="space-y-3">
                                  <p>
                                    {messagesQuery.error instanceof Error
                                      ? messagesQuery.error.message
                                      : t('instagramSendFailed')}
                                  </p>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => messagesQuery.refetch()}
                                  >
                                    {t('retry')}
                                  </Button>
                                </div>
                              </AlertDescription>
                            </Alert>
                          </div>
                        ) : messages.length === 0 ? (
                          <div className="py-16 text-center text-sm text-slate-500">
                            <MessageCircle className="mx-auto mb-3 h-8 w-8 text-slate-400" />
                            {t('noMessagesYet')}
                          </div>
                        ) : threadQuery && threadMatchCount === 0 ? (
                          <div className="py-16 text-center text-sm text-slate-500">
                            <SearchX className="mx-auto mb-3 h-8 w-8 text-slate-400" />
                            {t('noSearchResults')}
                          </div>
                        ) : (
                          threadItems.map((item) => {
                            if (item.kind === 'date') {
                              return (
                                <div key={item.id} className="my-4 flex items-center gap-3">
                                  <div className="h-px flex-1 bg-border" />
                                  <span className="rounded-full bg-background px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm">
                                    {item.label}
                                  </span>
                                  <div className="h-px flex-1 bg-border" />
                                </div>
                              );
                            }
                            if (item.kind === 'unread') {
                              return (
                                <div key={item.id} className="my-4 flex items-center gap-3">
                                  <div className="h-px flex-1 bg-primary/30" />
                                  <span className="rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground shadow-sm">
                                    {item.label}
                                  </span>
                                  <div className="h-px flex-1 bg-primary/30" />
                                </div>
                              );
                            }
                            const message = item.message;
                            const outbound = message.direction === 'outbound';
                            const legacy = message.content?.match(LEGACY_ATTACHMENT);
                            const attachments = message.attachments?.length
                              ? message.attachments
                              : legacy
                                ? parseLegacyAttachment(message.content)
                                : [];
                            const hasRealText = Boolean(message.content) && !legacy && !/^\[.+\]$/.test(message.content);
                            const meta = (
                              <div
                                className={cn(
                                  'mt-0.5 flex items-center gap-1.5 px-1 text-[10px]',
                                  outbound ? 'justify-end text-primary-foreground/70' : 'text-slate-400',
                                )}
                              >
                                {item.showTime ? <span>{clockTime(message.createdAt)}</span> : null}
                                {message.pending ? (
                                  <span title={t('sendingMessage')}>
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  </span>
                                ) : message.failed ? (
                                  <button
                                    type="button"
                                    className="font-medium underline underline-offset-2"
                                    title={t('messageFailed')}
                                    onClick={() => retryMessage(message.content)}
                                  >
                                    {t('retrySend')}
                                  </button>
                                ) : outbound ? (
                                  <CheckCheck className="h-3 w-3" />
                                ) : null}
                              </div>
                            );
                            return (
                              <div
                                key={item.id}
                                className={cn('flex', outbound ? 'justify-end' : 'justify-start', item.showTime ? 'mt-3' : 'mt-0.5')}
                              >
                                <div
                                  className={cn(
                                    'group/bubble relative flex max-w-[82%] flex-col',
                                    outbound ? 'items-end' : 'items-start',
                                  )}
                                >
                                  {hasRealText ? (
                                    <button
                                      type="button"
                                      onClick={() => copyMessage(message.content, message.id)}
                                      className={cn(
                                        'absolute -top-3 z-10 hidden h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-slate-500 shadow-sm transition hover:text-primary group-hover/bubble:flex',
                                        outbound ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2',
                                      )}
                                      aria-label={t('copy')}
                                    >
                                      {copiedId === message.id ? (
                                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                                      ) : (
                                        <Copy className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  ) : null}
                                  {attachments.map((attachment, index) => (
                                    <div
                                      key={index}
                                      className={cn('w-full max-w-sm', outbound ? 'self-end' : 'self-start')}
                                    >
                                      <AttachmentMedia attachment={attachment} onOpen={(media) => setLightbox(media)} />
                                    </div>
                                  ))}
                                  {hasRealText ? (
                                    <div
                                      className={cn(
                                        'rounded-2xl px-4 py-2.5 shadow-sm',
                                        outbound
                                          ? 'rounded-br-md bg-primary text-primary-foreground shadow-primary'
                                          : 'rounded-bl-md border border-border bg-card text-card-foreground',
                                        message.failed ? 'opacity-60 ring-1 ring-destructive' : '',
                                      )}
                                    >
                                      <p className="whitespace-pre-wrap break-words text-sm">
                                        <Highlight text={message.content} query={threadSearch} />
                                      </p>
                                    </div>
                                  ) : null}
                                  {meta}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </ScrollArea>

                    {!atBottom && messages.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => scrollToBottom('smooth')}
                        className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground shadow-lg transition-transform hover:scale-105"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                        {t('jumpToLatest')}
                      </button>
                    ) : null}
                  </div>

                  <div className="border-t border-border bg-background/80 p-3 backdrop-blur sm:p-4">
                    <div className="mb-2 flex items-center gap-1">
                      <Popover
                        open={quickOpen}
                        onClose={() => setQuickOpen(false)}
                        trigger={
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={cn('gap-1.5 text-xs', quickOpen && 'bg-muted text-primary')}
                            onClick={() => setQuickOpen((value) => !value)}
                            disabled={!selectedConversation.canReply}
                          >
                            <Sparkles className="h-4 w-4" />
                            {t('quickReplies')}
                          </Button>
                        }
                      >
                        <div className="flex items-center justify-between px-2 pb-1">
                          <span className="text-xs font-semibold text-slate-700">{t('quickReplies')}</span>
                        </div>
                        <ScrollArea className="max-h-56">
                          <div className="space-y-1 pr-1">
                            {quickReplies.length === 0 ? (
                              <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t('noQuickReplies')}</p>
                            ) : (
                              quickReplies.map((reply) => (
                                <div
                                  key={reply}
                                  className="group/qr flex items-start gap-1 rounded-lg px-2 py-1.5 hover:bg-muted"
                                >
                                  <button
                                    type="button"
                                    className="flex-1 text-left text-xs leading-snug text-slate-700"
                                    onClick={() => {
                                      insertAtCursor(reply);
                                      setQuickOpen(false);
                                    }}
                                  >
                                    {reply}
                                  </button>
                                  <button
                                    type="button"
                                    className="hidden h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-destructive/10 hover:text-destructive group-hover/qr:flex"
                                    aria-label={t('delete')}
                                    onClick={() => removeReply(reply)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </ScrollArea>
                        <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
                          <Input
                            value={newTemplate}
                            onChange={(event) => setNewTemplate(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                addReply(newTemplate);
                                setNewTemplate('');
                              }
                            }}
                            placeholder={t('newTemplatePlaceholder')}
                            className="h-8 text-xs"
                          />
                          <Button
                            type="button"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            aria-label={t('add')}
                            disabled={!newTemplate.trim()}
                            onClick={() => {
                              addReply(newTemplate);
                              setNewTemplate('');
                            }}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </Popover>

                      <Popover
                        open={emojiOpen}
                        onClose={() => setEmojiOpen(false)}
                        align="left"
                        trigger={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn('h-8 w-8', emojiOpen && 'bg-muted text-primary')}
                            aria-label={t('emoji')}
                            onClick={() => setEmojiOpen((value) => !value)}
                            disabled={!selectedConversation.canReply}
                          >
                            <Smile className="h-4 w-4" />
                          </Button>
                        }
                      >
                        <div className="grid grid-cols-6 gap-1 p-1">
                          {EMOJI_SET.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className="flex h-9 w-9 items-center justify-center rounded-lg text-lg transition hover:bg-muted"
                              onClick={() => {
                                insertAtCursor(emoji);
                                setEmojiOpen(false);
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </Popover>

                      <span className="ml-auto text-[11px] tabular-nums text-slate-400">
                        {draft.length}/1000
                      </span>
                    </div>

                    <div className="flex items-end gap-2">
                      <Textarea
                        ref={textareaRef}
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
                        className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl"
                        maxLength={1000}
                        aria-label={t('instagramMessagePlaceholder')}
                      />
                      <Button
                        className="h-11 w-11 shrink-0 rounded-xl p-0 shadow-primary"
                        onClick={submitMessage}
                        disabled={!draft.trim() || !selectedConversation.canReply || sendMessage.isPending}
                        aria-label={t('sendMessage')}
                      >
                        {sendMessage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="mt-2 flex items-center gap-1 text-xs text-slate-400">
                      <CornerDownLeft className="h-3 w-3" />
                      {t('instagramReplyPolicyHint')}
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center p-8 text-center text-slate-500">
                  <div>
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-slate-400">
                      <MessageCircle className="h-8 w-8" />
                    </div>
                    <p className="mt-4 font-medium">{t('selectConversation')}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Lead panel (desktop) */}
            {leadCollapsed ? (
              <div className="hidden xl:flex flex-col items-center border-l border-border bg-background py-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('expandLeadCard')}
                  onClick={() => setLeadCollapsed(false)}
                >
                  <PanelRightOpen className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="hidden min-h-0 flex-col border-l border-border bg-background xl:flex">
                <LeadPanel
                  leadId={selectedConversation?.leadId}
                  conversation={selectedConversation}
                  workspaceData={workspaceQuery.data}
                  statusName={statusName}
                  onCollapsedChange={() => setLeadCollapsed(true)}
                  onChanged={() => {
                    queryClient.invalidateQueries({ queryKey: ['/api/instagram/conversations'] });
                    queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] });
                  }}
                  onCloseMobile={() => setMobileLeadOpen(false)}
                />
              </div>
            )}

            {/* Lead panel (mobile overlay) */}
            {mobileLeadOpen ? (
              <>
                <div
                  className="fixed inset-0 z-40 bg-black/40 xl:hidden"
                  onClick={() => setMobileLeadOpen(false)}
                />
                <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-background shadow-xl xl:hidden">
                  <LeadPanel
                    leadId={selectedConversation?.leadId}
                    conversation={selectedConversation}
                    workspaceData={workspaceQuery.data}
                    statusName={statusName}
                    onCollapsedChange={() => setMobileLeadOpen(false)}
                    onChanged={() => {
                      queryClient.invalidateQueries({ queryKey: ['/api/instagram/conversations'] });
                      queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] });
                    }}
                    onCloseMobile={() => setMobileLeadOpen(false)}
                  />
                </div>
              </>
            ) : null}
          </div>
        )}
      </Card>

      {lightbox ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label={t('viewMedia')}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 text-white hover:bg-white/10 hover:text-white"
            aria-label={t('closeLeadPanel')}
            onClick={() => setLightbox(null)}
          >
            <X className="h-5 w-5" />
          </Button>
          <div className="max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
            {lightbox.type === 'video' ? (
              <video
                src={lightbox.url}
                controls
                autoPlay
                className="max-h-[90vh] max-w-[90vw] rounded-lg bg-black"
              />
            ) : (
              <img
                src={lightbox.url}
                alt={lightbox.title || ''}
                className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
