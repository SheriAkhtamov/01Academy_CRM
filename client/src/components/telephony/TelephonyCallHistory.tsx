import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowUpRight,
  Clock3,
  NotebookPen,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyDate } from '@/lib/localeFormat';
import { formatCallDuration } from '@/lib/telephony';
import { telephonyApi, telephonyQueryKeys, type CallHistoryItem } from '@/features/telephony/api';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CallNoteEditor } from '@/components/telephony/CallNoteEditor';
import { CallRecordingPlayer } from '@/components/telephony/CallRecordingPlayer';
import type { TranslationKey } from '@/lib/i18n';

type HistoryFilter = 'all' | 'missed' | 'incoming' | 'outgoing';

const filterLabelKeys = {
  all: 'telephonyFilterAll',
  missed: 'telephonyFilterMissed',
  incoming: 'telephonyFilterIncoming',
  outgoing: 'telephonyFilterOutgoing',
} satisfies Record<HistoryFilter, TranslationKey>;

const unansweredStatuses = new Set(['missed', 'failed', 'declined']);

export const isUnansweredIncoming = (call: Pick<CallHistoryItem, 'direction' | 'status' | 'talkSeconds'>) => (
  call.direction === 'incoming' && call.talkSeconds === 0 && unansweredStatuses.has(call.status)
);

const matchesFilter = (call: CallHistoryItem, filter: HistoryFilter) => {
  if (filter === 'missed') return isUnansweredIncoming(call);
  if (filter === 'all') return true;
  return call.direction === filter;
};

const matchesSearch = (call: CallHistoryItem, search: string) => {
  if (!search) return true;
  const needle = search.toLowerCase();
  return (
    call.phone.toLowerCase().includes(needle)
    || (call.contactName ?? '').toLowerCase().includes(needle)
    || (call.note ?? '').toLowerCase().includes(needle)
  );
};

/**
 * Three signals, one glyph: which way the call went, whether it connected, and
 * — for an incoming call nobody picked up — that it still needs a callback.
 */
const CallGlyph = ({ call }: { call: CallHistoryItem }) => {
  const unanswered = isUnansweredIncoming(call);
  const failedOutgoing = call.direction === 'outgoing' && call.talkSeconds === 0;
  const Icon = unanswered
    ? PhoneMissed
    : call.direction === 'incoming'
      ? PhoneIncoming
      : PhoneOutgoing;
  return (
    <div className={cn(
      'flex size-9 shrink-0 items-center justify-center rounded-full',
      unanswered
        ? 'bg-red-50 text-red-600'
        : failedOutgoing
          ? 'bg-muted text-muted-foreground'
          : 'bg-emerald-50 text-emerald-700',
    )}>
      <Icon className="size-4" />
    </div>
  );
};

export function TelephonyCallHistory({
  onCallBack,
  onCollapse,
}: {
  onCallBack: (phone: string) => void;
  onCollapse: () => void;
}) {
  const { t, language } = useTranslation();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedNoteCallId, setExpandedNoteCallId] = useState<number | null>(null);

  // A websocket event invalidates this key the moment a call changes, so the
  // list needs no polling of its own.
  const historyQuery = useQuery({
    queryKey: telephonyQueryKeys.calls,
    queryFn: () => telephonyApi.getCalls(50),
    staleTime: 15_000,
  });

  const calls = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);
  const missedCount = useMemo(() => calls.filter(isUnansweredIncoming).length, [calls]);
  const visibleCalls = useMemo(
    () => calls.filter((call) => matchesFilter(call, filter) && matchesSearch(call, search)),
    [calls, filter, search],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-border/70 px-3 pb-2.5 pt-2">
        <div className="relative" data-no-drag>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('telephonyHistorySearch')}
            aria-label={t('search')}
            className="h-9 pl-9 pr-9 text-sm"
          />
          {search ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setSearch('')}
              aria-label={t('clearSearch')}
              title={t('clearSearch')}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5" data-no-drag>
          {(Object.keys(filterLabelKeys) as HistoryFilter[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              className={cn(
                'flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition',
                filter === option
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              onClick={() => setFilter(option)}
            >
              {t(filterLabelKeys[option])}
              {option === 'missed' && missedCount > 0 ? (
                <span className={cn(
                  'rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
                  filter === option ? 'bg-primary-foreground/20' : 'bg-red-100 text-red-700',
                )}>
                  {missedCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" data-no-drag>
        <div className="divide-y divide-border/60">
          {visibleCalls.map((call) => {
            const contactHref = call.leadId ? `/sales/pipeline?lead=${call.leadId}` : null;
            const noteOpen = expandedNoteCallId === call.id;
            return (
              <div key={call.id} className="px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <CallGlyph call={call} />
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-medium text-foreground">
                      {call.contactName || call.phone}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">
                        {formatAcademyDate(call.startedAt, language, {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {call.talkSeconds > 0 ? (
                        <span className="flex shrink-0 items-center gap-1 tabular-nums">
                          <Clock3 className="size-3" />
                          {formatCallDuration(call.talkSeconds)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center">
                    {contactHref ? (
                      <Link
                        href={contactHref}
                        onClick={onCollapse}
                        className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-primary"
                        aria-label={t('telephonyOpenContact')}
                        title={t('telephonyOpenContact')}
                      >
                        <ArrowUpRight className="size-4" />
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className={cn(
                        'flex size-8 items-center justify-center rounded-full hover:bg-accent',
                        call.note ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                      )}
                      aria-pressed={noteOpen}
                      onClick={() => setExpandedNoteCallId(noteOpen ? null : call.id)}
                      aria-label={t('telephonyAddNote')}
                      title={t('telephonyAddNote')}
                    >
                      <NotebookPen className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-50"
                      onClick={() => onCallBack(call.phone)}
                      aria-label={t('telephonyCallBack')}
                      title={t('telephonyCallBack')}
                    >
                      <Phone className="size-4" />
                    </button>
                  </div>
                </div>

                {call.note && !noteOpen ? (
                  <p className="mt-1.5 line-clamp-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-left text-xs text-muted-foreground">
                    {call.note}
                  </p>
                ) : null}

                {call.hasRecording ? (
                  <CallRecordingPlayer
                    callId={call.id}
                    hasRecording={call.hasRecording}
                    className="mt-1"
                  />
                ) : null}

                {noteOpen ? (
                  <CallNoteEditor
                    callId={call.id}
                    note={call.note}
                    autoFocus
                    className="mt-2"
                    onSaved={() => setExpandedNoteCallId(null)}
                  />
                ) : null}
              </div>
            );
          })}

          {historyQuery.isLoading ? (
            <p className="px-6 py-16 text-center text-sm text-muted-foreground">{t('loading')}</p>
          ) : null}
          {!historyQuery.isLoading && calls.length === 0 ? (
            <p className="px-6 py-16 text-center text-sm text-muted-foreground">{t('telephonyNoCalls')}</p>
          ) : null}
          {!historyQuery.isLoading && calls.length > 0 && visibleCalls.length === 0 ? (
            <p className="px-6 py-16 text-center text-sm text-muted-foreground">{t('telephonyNoCallsFound')}</p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
