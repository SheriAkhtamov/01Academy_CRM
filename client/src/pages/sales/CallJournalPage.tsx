import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearch } from 'wouter';
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
import { DateRangeField } from '@/components/ux/DateRangeField';
import { PageHeader } from '@/components/ux/PageHeader';
import { PaginationControls } from '@/components/ux/PaginationControls';
import { UnreadCountBadge } from '@/components/ux/UnreadCountBadge';
import { ModulePage, ModulePageBody } from '@/components/ux/ModulePage';
import {
  journalOperatorsQueryOptions,
  missedCallUnreadQueryOptions,
} from '@/features/telephony/api';
import { useAuth } from '@/hooks/useAuth';
import { useOnlinePbxCall } from '@/hooks/useOnlinePbxCall';
import { useTranslation } from '@/hooks/useTranslation';
import { apiRequest } from '@/lib/queryClient';
import { ACADEMY_TIME_ZONE } from '@/lib/localeFormat';
import {
  activeTelephonyStatuses,
  formatCallDuration,
  telephonyStatusTranslationKey,
  type TelephonyCallStatus,
} from '@/lib/telephony';
import { cn } from '@/lib/utils';
import { MODULE_NAVIGATION } from '@/lib/moduleNavigation';
import { hasOnlinePbxManagerAssignment } from '@shared/telephony';

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
  note: string | null;
  hasRecording: boolean;
  requiresCallback: boolean;
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
const CALL_JOURNAL_DEFAULT_PAGE_SIZE = 50;
const ALL_EMPLOYEES = 'all';

const statusVariant = (status: TelephonyCallStatus) => {
  if (status === 'connected' || status === 'ended') return 'success' as const;
  if (status === 'missed' || status === 'failed' || status === 'declined') return 'destructive' as const;
  return 'warning' as const;
};

export default function CallJournalPage() {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const onlinePbxCall = useOnlinePbxCall();
  // Filters live in the URL: a configured view ("missed, last week, Anna")
  // survives navigation, refresh and can be shared as a link.
  const [, setRoute] = useLocation();
  const routeSearch = useSearch();
  const initialParams = useRef(new URLSearchParams(routeSearch));
  const [search, setSearch] = useState(() => initialParams.current.get('q') ?? '');
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(() => {
    const value = initialParams.current.get('userId');
    return value && value !== ALL_EMPLOYEES ? value : null;
  });
  const [direction, setDirection] = useState(() => initialParams.current.get('direction') ?? 'all');
  const [status, setStatus] = useState(() => initialParams.current.get('status') ?? 'all');
  const [from, setFrom] = useState(() => initialParams.current.get('from') ?? '');
  const [to, setTo] = useState(() => initialParams.current.get('to') ?? '');
  const [page, setPage] = useState(() => Math.max(1, Number(initialParams.current.get('page')) || 1));
  const [pageSize, setPageSize] = useState(CALL_JOURNAL_DEFAULT_PAGE_SIZE);
  const journalListRef = useRef<HTMLDivElement | null>(null);
  const deferredSearch = useDeferredValue(search.trim());

  const operatorsQuery = useQuery(journalOperatorsQueryOptions);
  // A manager opens the journal to read their own calls, so their name is the
  // default; someone without a phone widget of their own has no calls to open
  // on and keeps the whole team's history instead.
  const ownEmployeeId = user && hasOnlinePbxManagerAssignment(user) ? String(user.id) : null;
  const employee = selectedEmployee ?? ownEmployeeId ?? ALL_EMPLOYEES;
  const employeeOptions = useMemo(() => {
    const operators = operatorsQuery.data ?? [];
    // The reader's own name has to be selectable before the roster arrives,
    // otherwise the picker opens blank on the value it is already filtering by.
    if (!user || !ownEmployeeId || operators.some((operator) => operator.id === user.id)) {
      return operators;
    }
    return [
      { id: user.id, name: user.fullName, extension: user.onlinePbxExtension ?? '' },
      ...operators,
    ];
  }, [operatorsQuery.data, ownEmployeeId, user]);

  useEffect(() => setPage(1), [deferredSearch, direction, employee, status, from, to]);
  useEffect(() => {
    journalListRef.current?.scrollTo({ top: 0 });
  }, [deferredSearch, direction, employee, from, page, status, to]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(pageSize),
    });
    if (deferredSearch) params.set('q', deferredSearch);
    if (employee !== ALL_EMPLOYEES) params.set('userId', employee);
    if (direction !== 'all') params.set('direction', direction);
    if (status !== 'all') params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
  }, [deferredSearch, direction, employee, from, page, pageSize, status, to]);

  // Mirror the active view into the URL (replace: filters are not history
  // steps). The page number is only written when it is not the first one.
  useEffect(() => {
    const params = new URLSearchParams(routeSearch);
    const apply = (changes: Record<string, string | null>) => {
      Object.entries(changes).forEach(([key, value]) => {
        if (value === null) params.delete(key);
        else params.set(key, value);
      });
    };
    apply({
      q: deferredSearch || null,
      userId: employee !== ALL_EMPLOYEES ? employee : null,
      direction: direction !== 'all' ? direction : null,
      status: status !== 'all' ? status : null,
      from: from || null,
      to: to || null,
      page: page > 1 ? String(page) : null,
    });
    const query = params.toString();
    if (query === routeSearch) return;
    setRoute(query ? `/sales/calls?${query}` : '/sales/calls', { replace: true });
  }, [deferredSearch, direction, employee, from, page, routeSearch, setRoute, status, to]);

  const journalQuery = useQuery<JournalResponse>({
    queryKey: ['/api/telephony/calls/journal', queryString],
    queryFn: () => apiRequest('GET', `/api/telephony/calls/journal?${queryString}`),
    refetchInterval: (query) => (query.state.data?.items.some((call) => activeTelephonyStatuses.has(call.status)) ? 2_000 : 10_000),
    // Keep the current rows on screen while the next page/filter result loads
    // instead of collapsing the list into a skeleton on every transition.
    placeholderData: keepPreviousData,
  });
  const { data: missedCallUnread } = useQuery({
    ...missedCallUnreadQueryOptions,
  });

  const dateTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US', {
      timeZone: ACADEMY_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  const items = journalQuery.data?.items ?? [];
  const missedCallCount = Number(missedCallUnread?.count) || 0;
  const missedCallsLabel = t('newMissedCallCount')
    .replace('{count}', String(missedCallCount));

  return (
    <ModulePage contained className="pb-2 sm:pb-2 lg:pb-2">
      <PageHeader
        title={t('callJournal')}
        titleAccessory={(
          <UnreadCountBadge
            count={missedCallCount}
            label={missedCallsLabel}
            announce
          />
        )}
        subtitle={t('callJournalDescription')}
        breadcrumbs={[
          { label: t(MODULE_NAVIGATION.sales.nameKey), href: '/sales' },
          { label: t('callJournal') },
        ]}
        actions={(
          <>
            <Select value={employee} onValueChange={setSelectedEmployee}>
              {/* Radix drops a className on SelectValue, so the value span is
                  stretched from the trigger instead — otherwise `justify-between`
                  strands the name in the middle, away from its person icon. */}
              <SelectTrigger
                className="w-full gap-2 sm:w-56 [&>span]:flex-1 [&>span]:text-left"
                aria-label={t('callJournalEmployee')}
              >
                <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_EMPLOYEES}>{t('allEmployees')}</SelectItem>
                {employeeOptions.map((operator) => (
                  <SelectItem key={operator.id} value={String(operator.id)}>
                    {operator.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={() => journalQuery.refetch()} disabled={journalQuery.isFetching}>
              <RefreshCw className={cn(journalQuery.isFetching && 'animate-spin')} />
              {t('callJournalRefresh')}
            </Button>
          </>
        )}
      />

      <ModulePageBody
        contained
        scroll="hidden"
        ariaLabel={t('callJournal')}
        className="flex flex-col gap-3 overflow-y-auto [scrollbar-gutter:stable]"
      >
        <section className="grid shrink-0 grid-cols-tile gap-3" aria-label={t('callJournalSummary')}>
          <SummaryCard icon={PhoneCall} title={t('totalCalls')} value={journalQuery.data?.total ?? 0} />
          <SummaryCard icon={Headphones} title={t('answeredCalls')} value={journalQuery.data?.summary.answered ?? 0} tone="success" />
          <SummaryCard icon={PhoneMissed} title={t('missedCalls')} value={journalQuery.data?.summary.missed ?? 0} tone="danger" />
          <SummaryCard
            icon={Clock3}
            title={t('totalTalkTime')}
            value={formatCallDuration(journalQuery.data?.summary.talkSeconds ?? 0)}
          />
        </section>

        <Card className="shrink-0">
          <CardContent className="grid grid-cols-1 items-end gap-3 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_180px_190px_minmax(320px,1fr)]">
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
            <DateRangeField
              idPrefix="call-journal-range"
              variant="floating"
              className="sm:col-span-2 xl:col-span-1"
              value={{ from, to }}
              onChange={(range) => { setFrom(range.from); setTo(range.to); }}
            />
          </CardContent>
        </Card>

        <Card className="flex min-h-[26rem] shrink-0 flex-col overflow-hidden xl:min-h-[32rem] lg:flex-1">
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
            <div
              ref={journalListRef}
              className={cn(
                'min-h-0 flex-1 overflow-auto overscroll-contain transition-opacity [scrollbar-gutter:stable]',
                journalQuery.isPlaceholderData && 'pointer-events-none opacity-60',
              )}
              data-call-journal-scroll
              role="region"
              aria-label={t('callJournal')}
              aria-busy={journalQuery.isPlaceholderData}
              tabIndex={0}
            >
              <div className="hidden md:block">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="sticky top-0 z-10 border-b bg-card text-xs font-medium uppercase tracking-wide text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]">
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
                        requiresCallback={call.requiresCallback}
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
                    requiresCallback={call.requiresCallback}
                    onCall={() => onlinePbxCall.startCall(call.phone)}
                  />
                ))}
              </div>
            </div>
          )}
          <PaginationControls
            page={page}
            pageSize={journalQuery.data?.limit ?? pageSize}
            totalItems={journalQuery.data?.total ?? 0}
            disabled={journalQuery.isFetching}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            }}
          />
        </Card>
      </ModulePageBody>
    </ModulePage>
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

function JournalTableRow({
  call,
  dateTime,
  requiresCallback,
  onCall,
}: {
  call: JournalCall;
  dateTime: (value: string) => string;
  requiresCallback: boolean;
  onCall: () => void;
}) {
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
        <CallNote note={call.note} className="max-w-64" />
      </td>
      <td className="px-4 py-3">
        <p className="font-medium">{call.userName || t('notAssigned')}</p>
        {call.extension ? <p className="text-xs text-muted-foreground">{t('extensionShort')} {call.extension}</p> : null}
      </td>
      <td className="px-4 py-3"><CallStatus call={call} requiresCallback={requiresCallback} /></td>
      <td className="px-4 py-3 font-mono tabular-nums">{formatCallDuration(duration)}</td>
      <td className="px-4 py-3"><CallRecordingPlayer callId={call.id} hasRecording={call.hasRecording} /></td>
      <td className="px-4 py-3 text-right">
        <Button type="button" variant="ghost" size="icon" onClick={onCall} aria-label={t('telephonyCallBack')}><Phone /></Button>
      </td>
    </tr>
  );
}

function JournalMobileCard({
  call,
  dateTime,
  requiresCallback,
  onCall,
}: {
  call: JournalCall;
  dateTime: (value: string) => string;
  requiresCallback: boolean;
  onCall: () => void;
}) {
  const { t } = useTranslation();
  const DirectionIcon = call.direction === 'incoming' ? PhoneIncoming : PhoneCall;
  return (
    <article className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <LeadCell call={call} />
        <CallStatus call={call} requiresCallback={requiresCallback} />
      </div>
      <CallNote note={call.note} />
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

function CallStatus({ call, requiresCallback }: { call: JournalCall; requiresCallback: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="inline-flex items-center gap-2">
      {requiresCallback ? (
        <span
          className="inline-flex size-2 shrink-0 rounded-full bg-destructive shadow-[0_0_0_3px_hsl(var(--destructive)/0.12)]"
          title={t('newMissedCall')}
        >
          <span className="sr-only">{t('newMissedCall')}</span>
        </span>
      ) : null}
      <Badge variant={statusVariant(call.status)}>
        {t(telephonyStatusTranslationKey(call.status))}
      </Badge>
    </div>
  );
}

/** The note a manager wrote in the phone widget while the call was fresh. */
function CallNote({ note, className }: { note: string | null; className?: string }) {
  const { t } = useTranslation();
  if (!note) return null;
  return (
    <p
      className={cn('mt-1 line-clamp-2 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground', className)}
      title={t('telephonyNote')}
    >
      {note}
    </p>
  );
}

function LeadCell({ call }: { call: JournalCall }) {
  const name = call.leadName || call.contactName || call.phone;
  const phoneAnchor = (
    <a
      href={`tel:${call.phone.replace(/[^\d+]/g, '')}`}
      className="mt-0.5 block w-fit text-xs text-muted-foreground transition-colors hover:text-primary"
    >
      {call.phone}
    </a>
  );
  if (!call.leadId) {
    return (
      <div className="min-w-0">
        <p className="max-w-64 truncate font-medium">{name}</p>
        {phoneAnchor}
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <Link href={`/sales/pipeline?lead=${call.leadId}`} className="inline-flex max-w-64 items-center gap-2 rounded-md hover:text-primary">
        <UserRound className="size-4 shrink-0" />
        <span className="truncate font-medium">{name}</span>
      </Link>
      {phoneAnchor}
    </div>
  );
}
