import { CallRecordingPlayer } from '@/components/telephony/CallRecordingPlayer';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { paymentSummaryLine } from '@/components/ux/lead/LeadPaymentTab';
import { useState } from 'react';
import { getInitials } from '@/lib/auth';
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
    type?: string | null;
    discount?: string | null;
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
  // The full thread lives in the timeline below; showing only the latest note
  // here keeps the composer in view instead of repeating the same list twice.
  const comment = comments.reduce<LeadComment | null>((latest, item) => {
    if (!latest) return item;
    return new Date(item.createdAt ?? 0) > new Date(latest.createdAt ?? 0) ? item : latest;
  }, null);

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
      <CardContent className="space-y-4 pt-6">
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
                if (!isPending && draft.trim()) {
                  onSubmit();
                }
              }
            }}
            placeholder={t('addCommentPlaceholder')}
            rows={3}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground/70">{t('ctrlEnterToSend')}</span>
            <Button type="submit" disabled={isPending || !draft.trim()}>
              {isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <MessageSquare data-icon="inline-start" />}
              {t('send')}
            </Button>
          </div>
        </form>

        {comment ? (
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('leadLatestComment')}
            </p>
            <div className="mt-2 flex gap-3">
              <Avatar className="size-8 shrink-0 border border-border">
                <AvatarFallback>{getInitials(comment.authorName || t('unknown'))}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-sm font-medium">{comment.authorName || t('unknown')}</p>
                  <time className="text-xs text-muted-foreground">{dateTime(comment.createdAt)}</time>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground/90">{comment.body}</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
            {t('noCommentsYet')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

type ActivityKind = 'comments' | 'calls' | 'changes' | 'payments';

const ACTIVITY_FILTERS = [
  { value: 'all', labelKey: 'activityFilterAll' },
  { value: 'comments', labelKey: 'commentsLabel' },
  { value: 'calls', labelKey: 'activityFilterCalls' },
  { value: 'changes', labelKey: 'changes' },
  { value: 'payments', labelKey: 'activityFilterPayments' },
] as const satisfies ReadonlyArray<{ value: 'all' | ActivityKind; labelKey: TranslationKey }>;

export function ActivityTimeline({
  lead,
  dateTime,
  leadStatusName,
  money,
}: {
  lead: LeadActivityData;
  dateTime: (value: string | null | undefined) => string;
  leadStatusName: (code: string) => string;
  money: (value: number | string | null | undefined) => string;
}) {
  const { t } = useTranslation();
  const [activeFilter, setActiveFilter] = useState<'all' | ActivityKind>('all');
  const items = [
    ...(lead.comments ?? []).map((item) => ({
      id: `lead-comment-${item.id}`,
      kind: 'comments' as ActivityKind,
      at: item.createdAt,
      title: item.authorName ? `${t('comment')} · ${item.authorName}` : t('comment'),
      text: item.body,
      icon: MessageSquare,
      callId: null,
      hasRecording: false,
    })),
    ...(lead.history ?? []).map((item) => ({
      id: `history-${item.id}`,
      kind: 'changes' as ActivityKind,
      at: item.enteredAt,
      title: leadStatusName(item.toStatusCode),
      text: item.comment,
      icon: History,
      callId: null,
      hasRecording: false,
    })),
    ...(lead.communications ?? []).map((item) => ({
      id: `communication-${item.id}`,
      kind: 'calls' as ActivityKind,
      at: item.createdAt,
      title: `${t('contact')}: ${item.channel}`,
      text: [item.result, item.comment].filter(Boolean).join(' — '),
      icon: MessageSquare,
      callId: null,
      hasRecording: false,
    })),
    ...(lead.calls ?? []).map((item) => ({
      id: `call-${item.id}`,
      kind: 'calls' as ActivityKind,
      at: item.startedAt,
      title: `${item.direction === 'incoming' ? t('incomingCall') : t('outgoingCall')}: ${t(telephonyStatusTranslationKey(item.status))}`,
      text: [
        item.userName ? `${t('callEmployee')}: ${item.userName}` : null,
        `${t('talkTime')}: ${formatCallDuration(item.talkSeconds)}`,
        item.hangupCause,
      ].filter(Boolean).join(' • '),
      icon: Phone,
      callId: item.id,
      hasRecording: item.hasRecording,
    })),
    ...(lead.assignmentHistory ?? []).map((item) => ({
      id: `assignment-${item.id}`,
      kind: 'changes' as ActivityKind,
      at: item.createdAt,
      title: t('leadTransferred'),
      text: [
        `${item.fromManagerName || t('notAssigned')} → ${item.toManagerName || t('notAssigned')}`,
        item.changedByName ? `${t('changedBy')}: ${item.changedByName}` : null,
        item.comment,
      ].filter(Boolean).join(' • '),
      icon: UserRoundCog,
      callId: null,
      hasRecording: false,
    })),
    ...(lead.payments ?? []).map((item) => ({
      id: `payment-${item.id}`,
      kind: 'payments' as ActivityKind,
      at: item.paidAt ?? item.createdAt,
      title: `${t('payment')}: ${money(item.amountUzs)}`,
      text: paymentSummaryLine(item, t),
      icon: CreditCard,
      callId: null,
      hasRecording: false,
    })),
  ].sort((left, right) => (
    new Date(right.at ?? 0).getTime() - new Date(left.at ?? 0).getTime()
  ));

  const counts = items.reduce<Record<string, number>>((totals, item) => {
    totals[item.kind] = (totals[item.kind] ?? 0) + 1;
    return totals;
  }, {});
  const visibleItems = activeFilter === 'all'
    ? items
    : items.filter((item) => item.kind === activeFilter);

  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle>{t('activityHistory')}</CardTitle>
        {items.length > 0 ? (
          <div role="group" aria-label={t('activityHistory')} className="flex flex-wrap gap-1.5">
            {ACTIVITY_FILTERS.map((filter) => {
              const count = filter.value === 'all' ? items.length : counts[filter.value] ?? 0;
              if (count === 0) return null;
              return (
                <Button
                  key={filter.value}
                  type="button"
                  size="sm"
                  variant={activeFilter === filter.value ? 'secondary' : 'ghost'}
                  aria-pressed={activeFilter === filter.value}
                  className="h-7 gap-1.5 px-2.5 text-xs"
                  onClick={() => setActiveFilter(filter.value)}
                >
                  {t(filter.labelKey)}
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </Button>
              );
            })}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-0">
        {visibleItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noActivityYet')}</p>
        ) : (
          <ol className="flex flex-col">
            {visibleItems.map((item, index) => {
              const Icon = item.icon;
              return (
                <li key={item.id} className="relative flex gap-3 pb-3 last:pb-0">
                  {index !== visibleItems.length - 1 ? (
                    <span
                      aria-hidden
                      className="absolute bottom-0 left-[18px] top-9 w-px bg-border"
                    />
                  ) : null}
                  <div className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted ring-2 ring-background">
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium leading-tight">{item.title}</p>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <Clock3 className="size-3" />
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
        )}
      </CardContent>
    </Card>
  );
}
