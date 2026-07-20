import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Clock3,
  Headphones,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  RefreshCw,
  Search,
  UserRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { CallRecordingPlayer } from '@/components/telephony/CallRecordingPlayer';
import { PageHeader } from '@/components/ux/PageHeader';
import { WorkspacePage, WorkspacePageBody } from '@/components/ux/WorkspacePage';
import { useOnlinePbxCall } from '@/hooks/useOnlinePbxCall';
import { useTranslation } from '@/hooks/useTranslation';
import { apiRequest } from '@/lib/queryClient';
import {
  activeTelephonyStatuses,
  formatCallDuration,
  telephonyStatusTranslationKey,
  type TelephonyCallStatus,
} from '@/lib/telephony';
import { cn } from '@/lib/utils';

type JournalCall = {
  id: number;
  userId: number | null;
  userName: string | null;
  extension: string | null;
  direction: 'incoming' | 'outgoing';
  status: TelephonyCallStatus;
  phone: string;
  leadId: number | null;
  leadName: string | null;
  contactName: string | null;
  managerId: number | null;
  managerName: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  talkSeconds: number;
  hangupCause: string | null;
  hasRecording: boolean;
};

type JournalResponse = {
  items: JournalCall[];
  page: number;
  limit: number;
  total: number;
  summary: {
    missed: number;
    answered: number;
    talkSeconds: number;
  };
};

const finalStatuses = new Set<TelephonyCallStatus>(['ended', 'failed', 'declined', 'missed']);

const statusVariant = (status: TelephonyCallStatus) => {
  if (status === 'connected' || status === 'ended') return 'success' as const;
  if (status === 'missed' || status === 'failed' || status === 'declined') return 'destructive' as const;
  return 'warning' as const;
};

export default function CallJournalPage() {
  const { t, language } = useTranslation();
  const onlinePbxCall = useOnlinePbxCall();
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState('all');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());

  useEffect(() => setPage(1), [deferredSearch, direction, status, from, to]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    if (deferredSearch) params.set('q', deferredSearch);
    if (direction !== 'all') params.set('direction', direction);
    if (status !== 'all') params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
  }, [deferredSearch, direction, from, page, status, to]);

  const journalQuery = useQuery<JournalResponse>({
    queryKey: ['/api/telephony/calls/journal', queryString],
    queryFn: () => apiRequest('GET', `/api/telephony/calls/journal?${queryString}`),
    refetchInterval: (query) => (query.state.data?.items.some((call) => activeTelephonyStatuses.has(call.status)) ? 2_000 : 10_000),
  });

  const dateTime = (value: string) => new Date(value).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const totalPages = Math.max(1, Math.ceil((journalQuery.data?.total ?? 0) / 50));
  const items = journalQuery.data?.items ?? [];

  return (
    <WorkspacePage contained>
      <PageHeader
        title={t('callJournal')}
        subtitle={t('callJournalDescription')}
        breadcrumbs={[
          { label: t('navDashboard'), href: '/sales' },
          { label: t('callJournal') },
        ]}
        actions={(
          <Button type="button" variant="outline" onClick={() => journalQuery.refetch()} disabled={journalQuery.isFetching}>
            <RefreshCw className={cn(journalQuery.isFetching && 'animate-spin')} />
            {t('callJournalRefresh')}
          </Button>
        )}
      />

      <WorkspacePageBody contained ariaLabel={t('callJournal')} className="flex flex-col gap-5 pb-2">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t('callJournalSummary')}>
          <SummaryCard icon={PhoneCall} title={t('totalCalls')} value={journalQuery.data?.total ?? 0} />
          <SummaryCard icon={Headphones} title={t('answeredCalls')} value={journalQuery.data?.summary.answered ?? 0} tone="success" />
          <SummaryCard icon={PhoneMissed} title={t('missedCalls')} value={journalQuery.data?.summary.missed ?? 0} tone="danger" />
          <SummaryCard
            icon={Clock3}
            title={t('totalTalkTime')}
            value={formatCallDuration(journalQuery.data?.summary.talkSeconds ?? 0)}
          />
        </section>

        <Card>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_180px_190px_170px_170px]">
            <div className="relative sm:col-span-2 xl:col-span-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
                placeholder={t('callJournalSearch')}
                aria-label={t('search')}
              />
            </div>
            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger aria-label={t('callDirection')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allDirections')}</SelectItem>
                <SelectItem value="incoming">{t('incomingCall')}</SelectItem>
                <SelectItem value="outgoing">{t('outgoingCall')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label={t('status')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                <SelectItem value="connected">{t('telephonyStatusConnected')}</SelectItem>
                <SelectItem value="ended">{t('telephonyStatusEnded')}</SelectItem>
                <SelectItem value="missed">{t('telephonyStatusMissed')}</SelectItem>
                <SelectItem value="failed">{t('telephonyStatusFailed')}</SelectItem>
                <SelectItem value="declined">{t('telephonyStatusDeclined')}</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label={t('dateFrom')} />
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label={t('dateTo')} />
          </CardContent>
        </Card>

        <Card className="min-h-0 overflow-hidden">
          {journalQuery.isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}
            </div>
          ) : journalQuery.isError ? (
            <div className="p-10 text-center">
              <p className="font-medium text-destructive">{t('failedToLoadData')}</p>
              <Button className="mt-3" variant="outline" onClick={() => journalQuery.refetch()}>{t('retry')}</Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <Phone className="size-10 text-muted-foreground/50" />
              <p className="mt-3 font-medium">{t('noCallsInJournal')}</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('noCallsInJournalDescription')}</p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">{t('dateColumn')}</th>
                      <th className="px-4 py-3">{t('callDirection')}</th>
                      <th className="px-4 py-3">{t('lead')}</th>
                      <th className="px-4 py-3">{t('callEmployee')}</th>
                      <th className="px-4 py-3">{t('status')}</th>
                      <th className="px-4 py-3">{t('talkTime')}</th>
                      <th className="px-4 py-3">{t('recording')}</th>
                      <th className="px-4 py-3 text-right">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((call) => (
                      <JournalTableRow
                        key={call.id}
                        call={call}
                        dateTime={dateTime}
                        onCall={() => onlinePbxCall.startCall(call.phone)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y md:hidden">
                {items.map((call) => (
                  <JournalMobileCard
                    key={call.id}
                    call={call}
                    dateTime={dateTime}
                    onCall={() => onlinePbxCall.startCall(call.phone)}
                  />
                ))}
              </div>
            </>
          )}
        </Card>

        {journalQuery.data && journalQuery.data.total > 0 ? (
          <div className="flex items-center justify-between gap-3 pb-2 text-sm text-muted-foreground">
            <span>{t('callJournalCount').replace('{count}', String(journalQuery.data.total))}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                {t('previous')}
              </Button>
              <span className="tabular-nums">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>
                {t('next')}
              </Button>
            </div>
          </div>
        ) : null}
      </WorkspacePageBody>
    </WorkspacePage>
  );
}

function SummaryCard({
  icon: Icon,
  title,
  value,
  tone = 'default',
}: {
  icon: typeof PhoneCall;
  title: string;
  value: string | number;
  tone?: 'default' | 'success' | 'danger';
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 p-4 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground sm:text-sm">{title}</CardTitle>
        <Icon className={cn('size-4', tone === 'success' && 'text-emerald-600', tone === 'danger' && 'text-red-600')} />
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 text-xl font-semibold tabular-nums sm:text-2xl">{value}</CardContent>
    </Card>
  );
}

function JournalTableRow({ call, dateTime, onCall }: { call: JournalCall; dateTime: (value: string) => string; onCall: () => void }) {
  const { t } = useTranslation();
  const DirectionIcon = call.direction === 'incoming' ? PhoneIncoming : PhoneCall;
  const duration = call.talkSeconds || (finalStatuses.has(call.status) ? 0 : call.durationSeconds);
  return (
    <tr className="align-middle hover:bg-muted/20">
      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{dateTime(call.startedAt)}</td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-2"><DirectionIcon className="size-4" />{call.direction === 'incoming' ? t('incomingCall') : t('outgoingCall')}</span>
      </td>
      <td className="px-4 py-3">
        <LeadCell call={call} />
      </td>
      <td className="px-4 py-3">
        <p className="font-medium">{call.userName || t('notAssigned')}</p>
        {call.extension ? <p className="text-xs text-muted-foreground">{t('extensionShort')} {call.extension}</p> : null}
      </td>
      <td className="px-4 py-3"><Badge variant={statusVariant(call.status)}>{t(telephonyStatusTranslationKey(call.status))}</Badge></td>
      <td className="px-4 py-3 font-mono tabular-nums">{formatCallDuration(duration)}</td>
      <td className="px-4 py-3"><CallRecordingPlayer callId={call.id} hasRecording={call.hasRecording} /></td>
      <td className="px-4 py-3 text-right">
        <Button type="button" variant="ghost" size="icon" onClick={onCall} aria-label={t('telephonyCallBack')}><Phone /></Button>
      </td>
    </tr>
  );
}

function JournalMobileCard({ call, dateTime, onCall }: { call: JournalCall; dateTime: (value: string) => string; onCall: () => void }) {
  const { t } = useTranslation();
  const DirectionIcon = call.direction === 'incoming' ? PhoneIncoming : PhoneCall;
  return (
    <article className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <LeadCell call={call} />
        <Badge variant={statusVariant(call.status)}>{t(telephonyStatusTranslationKey(call.status))}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><DirectionIcon className="size-3.5" />{call.direction === 'incoming' ? t('incomingCall') : t('outgoingCall')}</span>
        <span className="text-right">{dateTime(call.startedAt)}</span>
        <span>{call.userName || t('notAssigned')}</span>
        <span className="text-right font-mono">{formatCallDuration(call.talkSeconds)}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CallRecordingPlayer callId={call.id} hasRecording={call.hasRecording} />
        <Button type="button" variant="outline" size="sm" onClick={onCall}><Phone />{t('telephonyCallBack')}</Button>
      </div>
    </article>
  );
}

function LeadCell({ call }: { call: JournalCall }) {
  const content = (
    <div className="min-w-0">
      <p className="max-w-64 truncate font-medium">{call.leadName || call.contactName || call.phone}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{call.phone}</p>
    </div>
  );
  return call.leadId ? (
    <Link href={`/sales/pipeline?lead=${call.leadId}`} className="inline-flex items-center gap-2 rounded-md hover:text-primary">
      <UserRound className="size-4 shrink-0" />{content}
    </Link>
  ) : content;
}
