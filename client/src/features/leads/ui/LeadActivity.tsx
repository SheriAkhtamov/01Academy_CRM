import { CallRecordingPlayer } from '@/components/telephony/CallRecordingPlayer';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/hooks/useTranslation';
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
  const items = [
    ...(lead.comments ?? []).map((item) => ({
      id: `lead-comment-${item.id}`,
      at: item.createdAt,
      title: item.authorName ? `${t('comment')} · ${item.authorName}` : t('comment'),
      text: item.body,
      icon: MessageSquare,
      callId: null,
      hasRecording: false,
    })),
    ...(lead.history ?? []).map((item) => ({
      id: `history-${item.id}`,
      at: item.enteredAt,
      title: leadStatusName(item.toStatusCode),
      text: item.comment,
      icon: History,
      callId: null,
      hasRecording: false,
    })),
    ...(lead.communications ?? []).map((item) => ({
      id: `communication-${item.id}`,
      at: item.createdAt,
      title: `${t('contact')}: ${item.channel}`,
      text: [item.result, item.comment].filter(Boolean).join(' — '),
      icon: MessageSquare,
      callId: null,
      hasRecording: false,
    })),
    ...(lead.calls ?? []).map((item) => ({
      id: `call-${item.id}`,
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
      at: item.paidAt ?? item.createdAt,
      title: `${t('payment')}: ${money(item.amountUzs)}`,
      text: item.method,
      icon: CreditCard,
      callId: null,
      hasRecording: false,
    })),
  ].sort((left, right) => (
    new Date(right.at ?? 0).getTime() - new Date(left.at ?? 0).getTime()
  ));

  return (
    <Card>
      <CardHeader><CardTitle>{t('activityHistory')}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-0">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noActivityYet')}</p>
        ) : (
          <ol className="flex flex-col">
            {items.map((item, index) => {
              const Icon = item.icon;
              return (
                <li key={item.id} className="relative flex gap-3 pb-3 last:pb-0">
                  {index !== items.length - 1 ? (
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
