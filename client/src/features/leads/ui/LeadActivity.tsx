import { useMemo, useState, type ReactNode } from 'react';
import { CallRecordingPlayer } from '@/components/telephony/CallRecordingPlayer';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/hooks/useTranslation';
import { getInitials } from '@/lib/auth';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  formatCallDuration,
  telephonyStatusTranslationKey,
  type TelephonyCallStatus,
} from '@/lib/telephony';
import {
  Clock3,
  CreditCard,
  History,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Phone,
  UserRoundCog,
} from 'lucide-react';

type LeadComment = {
  id: number;
  authorName?: string | null;
  body: string;
  createdAt?: string | null;
};

export type LeadActivityData = {
  comments?: LeadComment[];
  history?: Array<{
    id: number;
    toStatusCode: string;
    enteredAt?: string | null;
    comment?: string | null;
  }>;
  communications?: Array<{
    id: number;
    channel: string;
    result?: string | null;
    comment?: string | null;
    createdAt?: string | null;
  }>;
  calls?: Array<{
    id: number;
    direction: 'incoming' | 'outgoing';
    status: TelephonyCallStatus;
    startedAt: string;
    talkSeconds: number;
    hangupCause?: string | null;
    userName?: string | null;
    hasRecording: boolean;
  }>;
  assignmentHistory?: Array<{
    id: number;
    fromManagerName?: string | null;
    toManagerName?: string | null;
    changedByName?: string | null;
    comment?: string | null;
    createdAt?: string | null;
  }>;
  payments?: Array<{
    id: number;
    amountUzs: number;
    method: string;
    paidAt?: string | null;
    createdAt?: string | null;
  }>;
};

export function LeadCommentsCard({
  comments,
  draft,
  isPending,
  dateTime,
  onDraftChange,
  onSubmit,
}: {
  comments: LeadComment[];
  draft: string;
  isPending: boolean;
  dateTime: (value: string | null | undefined) => string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-muted/20">
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="size-5 text-primary" />
          {t('commentsLabel')}
          <Badge variant="secondary">{comments.length}</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('leadCommentsHint')}</p>
      </CardHeader>
      <CardContent className="space-y-5 pt-6">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <Textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                if (!isPending && draft.trim()) onSubmit();
              }
            }}
            placeholder={t('addCommentPlaceholder')}
            rows={3}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground/70">{t('ctrlEnterToSend')}</span>
            <Button type="submit" disabled={isPending || !draft.trim()}>
              {isPending
                ? <Loader2 className="animate-spin" data-icon="inline-start" />
                : <MessageSquare data-icon="inline-start" />}
              {t('send')}
            </Button>
          </div>
        </form>

        {comments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {t('noCommentsYet')}
          </p>
        ) : (
          <ol className="divide-y divide-border">
            {comments.map((comment) => {
              const authorName = comment.authorName || t('unknown');
              return (
                <li key={comment.id} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                  <Avatar className="size-9 shrink-0 border border-border">
                    <AvatarFallback>{getInitials(authorName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-sm font-medium">{authorName}</p>
                      <time className="text-xs text-muted-foreground">{dateTime(comment.createdAt)}</time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground/90">{comment.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

type ActivityKind = 'comment' | 'status' | 'communication' | 'call' | 'assignment' | 'payment';

type ActivityItem = {
  id: string;
  kind: ActivityKind;
  at?: string | null;
  title: string;
  text?: string | null;
  callId: number | null;
  hasRecording: boolean;
};

type ActivityFilterId = 'all' | 'comments' | 'calls' | 'stages' | 'payments' | 'other';

const ACTIVITY_FILTER_LABEL_KEYS = {
  all: 'allConversations',
  comments: 'commentsLabel',
  calls: 'activityFilterCalls',
  stages: 'activityFilterStages',
  payments: 'navPayments',
  other: 'financeCenterOther',
} as const satisfies Record<ActivityFilterId, TranslationKey>;

const ACTIVITY_FILTERS: Array<{
  id: ActivityFilterId;
  kinds: ActivityKind[] | null;
}> = [
  { id: 'all', kinds: null },
  { id: 'comments', kinds: ['comment'] },
  { id: 'calls', kinds: ['call'] },
  { id: 'stages', kinds: ['status'] },
  { id: 'payments', kinds: ['payment'] },
  { id: 'other', kinds: ['communication', 'assignment'] },
];

const ACTIVITY_KIND_ICONS: Record<ActivityKind, typeof MessageSquare> = {
  comment: MessageSquare,
  status: History,
  communication: MessagesSquare,
  call: Phone,
  assignment: UserRoundCog,
  payment: CreditCard,
};

const ACTIVITY_KIND_STYLES: Record<ActivityKind, string> = {
  comment: 'bg-slate-100 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300',
  status: 'bg-violet-100 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300',
  communication: 'bg-sky-100 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300',
  call: 'bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300',
  assignment: 'bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300',
  payment: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300',
};

const dayKeyOf = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

export function ActivityTimeline({
  lead,
  dateTime,
  leadStatusName,
  money,
  composer,
}: {
  lead: LeadActivityData;
  dateTime: (value: string | null | undefined) => string;
  leadStatusName: (code: string) => string;
  money: (value: number | string | null | undefined) => string;
  composer?: ReactNode;
}) {
  const { t, language } = useTranslation();
  const [activeFilter, setActiveFilter] = useState<ActivityFilterId>('all');

  const items = useMemo<ActivityItem[]>(() => [
    ...(lead.comments ?? []).map((item): ActivityItem => ({
      id: `lead-comment-${item.id}`,
      kind: 'comment',
      at: item.createdAt,
      title: item.authorName ? `${t('comment')} · ${item.authorName}` : t('comment'),
      text: item.body,
      callId: null,
      hasRecording: false,
    })),
    ...(lead.history ?? []).map((item): ActivityItem => ({
      id: `history-${item.id}`,
      kind: 'status',
      at: item.enteredAt,
      title: leadStatusName(item.toStatusCode),
      text: item.comment,
      callId: null,
      hasRecording: false,
    })),
    ...(lead.communications ?? []).map((item): ActivityItem => ({
      id: `communication-${item.id}`,
      kind: 'communication',
      at: item.createdAt,
      title: `${t('contact')}: ${item.channel}`,
      text: [item.result, item.comment].filter(Boolean).join(' — '),
      callId: null,
      hasRecording: false,
    })),
    ...(lead.calls ?? []).map((item): ActivityItem => ({
      id: `call-${item.id}`,
      kind: 'call',
      at: item.startedAt,
      title: `${item.direction === 'incoming' ? t('incomingCall') : t('outgoingCall')}: ${t(telephonyStatusTranslationKey(item.status))}`,
      text: [
        item.userName ? `${t('callEmployee')}: ${item.userName}` : null,
        `${t('talkTime')}: ${formatCallDuration(item.talkSeconds)}`,
        item.hangupCause,
      ].filter(Boolean).join(' • '),
      callId: item.id,
      hasRecording: item.hasRecording,
    })),
    ...(lead.assignmentHistory ?? []).map((item): ActivityItem => ({
      id: `assignment-${item.id}`,
      kind: 'assignment',
      at: item.createdAt,
      title: t('leadTransferred'),
      text: [
        `${item.fromManagerName || t('notAssigned')} → ${item.toManagerName || t('notAssigned')}`,
        item.changedByName ? `${t('changedBy')}: ${item.changedByName}` : null,
        item.comment,
      ].filter(Boolean).join(' • '),
      callId: null,
      hasRecording: false,
    })),
    ...(lead.payments ?? []).map((item): ActivityItem => ({
      id: `payment-${item.id}`,
      kind: 'payment',
      at: item.paidAt ?? item.createdAt,
      title: `${t('payment')}: ${money(item.amountUzs)}`,
      text: item.method,
      callId: null,
      hasRecording: false,
    })),
  ].sort((left, right) => (
    new Date(right.at ?? 0).getTime() - new Date(left.at ?? 0).getTime()
  )), [lead, leadStatusName, money, t]);

  const countByFilter = useMemo(() => {
    const counts = new Map<ActivityFilterId, number>();
    ACTIVITY_FILTERS.forEach((filter) => {
      counts.set(filter.id, filter.kinds === null
        ? items.length
        : items.filter((item) => filter.kinds!.includes(item.kind)).length);
    });
    return counts;
  }, [items]);

  const activeKinds = ACTIVITY_FILTERS.find((filter) => filter.id === activeFilter)?.kinds ?? null;
  const visibleItems = activeKinds === null
    ? items
    : items.filter((item) => activeKinds.includes(item.kind));

  const dayLabelOf = (value?: string | null) => {
    if (!value) return t('noData');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('noData');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (day.getTime() === today.getTime()) return t('today');
    if (day.getTime() === yesterday.getTime()) return t('yesterday');
    return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
      day: 'numeric',
      month: 'long',
      ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    }).format(date);
  };

  const dayGroups = useMemo(() => {
    const groups: Array<{ key: string; at?: string | null; items: ActivityItem[] }> = [];
    visibleItems.forEach((item) => {
      const key = dayKeyOf(item.at) ?? 'unknown';
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.key === key) {
        lastGroup.items.push(item);
      } else {
        groups.push({ key, at: item.at, items: [item] });
      }
    });
    return groups;
  }, [visibleItems]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-muted/20">
        <CardTitle className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary-700">
            <History className="size-4" aria-hidden="true" />
          </span>
          {t('activityHistory')}
          {items.length > 0 ? <Badge variant="secondary">{items.length}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {composer}

        {items.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('activityHistory')}>
            {ACTIVITY_FILTERS.map((filter) => {
              const count = countByFilter.get(filter.id) ?? 0;
              if (filter.id !== 'all' && count === 0) return null;
              const isActive = filter.id === activeFilter;
              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={isActive}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'border-primary/30 bg-primary/10 text-primary-700'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  onClick={() => setActiveFilter(filter.id)}
                >
                  {t(ACTIVITY_FILTER_LABEL_KEYS[filter.id])}
                  <span className="tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {visibleItems.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-8 text-center">
            <History className="mb-2 size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t('noActivityYet')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {dayGroups.map((group) => (
              <section key={`${group.key}-${group.items[0]?.id}`}>
                <div className="mb-2 flex items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {dayLabelOf(group.at)}
                  </span>
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </div>
                <ol className="flex flex-col">
                  {group.items.map((item, index) => {
                    const Icon = ACTIVITY_KIND_ICONS[item.kind];
                    return (
                      <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
                        {index !== group.items.length - 1 ? (
                          <span
                            aria-hidden
                            className="absolute bottom-0 left-4 top-9 w-px bg-border"
                          />
                        ) : null}
                        <div
                          className={cn(
                            'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-2 ring-background',
                            ACTIVITY_KIND_STYLES[item.kind],
                          )}
                        >
                          <Icon className="size-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-medium leading-tight">{item.title}</p>
                            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                              <Clock3 className="size-3" aria-hidden="true" />
                              {dateTime(item.at)}
                            </span>
                          </div>
                          {item.text ? (
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.text}</p>
                          ) : null}
                          {item.callId && item.hasRecording ? (
                            <CallRecordingPlayer callId={item.callId} hasRecording className="mt-1" />
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
