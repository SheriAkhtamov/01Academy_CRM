import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const callJournal = readFileSync(
  new URL('../client/src/pages/sales/CallJournalPage.tsx', import.meta.url),
  'utf8',
);
const telephonyRoutes = readFileSync(
  new URL('../server/routes/telephony.routes.ts', import.meta.url),
  'utf8',
);

describe('call journal navigation', () => {
  it('keeps a dedicated keyboard-accessible scroll region for journal rows', () => {
    expect(callJournal).toContain('data-call-journal-scroll');
    expect(callJournal).toContain("'min-h-0 flex-1 overflow-auto overscroll-contain transition-opacity [scrollbar-gutter:stable]'");
    expect(callJournal).toContain('role="region"');
    expect(callJournal).toContain('tabIndex={0}');
  });

  it('keeps the previous page visible while the next one loads', () => {
    expect(callJournal).toContain('placeholderData: keepPreviousData');
    expect(callJournal).toContain('aria-busy={journalQuery.isPlaceholderData}');
  });

  it('loads fifty calls per page and derives navigation from the server response', () => {
    expect(callJournal).toContain('const CALL_JOURNAL_PAGE_SIZE = 50;');
    expect(callJournal).toContain('journalQuery.data?.limit ?? CALL_JOURNAL_PAGE_SIZE');
    expect(callJournal).toContain('Math.ceil((journalQuery.data?.total ?? 0) / pageSize)');
    expect(telephonyRoutes).toContain('const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);');
    expect(telephonyRoutes).toContain('LIMIT ${limitParam} OFFSET ${offsetParam}');
  });

  it('keeps page controls outside the row scroller and resets scroll position on navigation', () => {
    const scrollRegionEnd = callJournal.indexOf('</Card>', callJournal.indexOf('data-call-journal-scroll'));
    const pagination = callJournal.indexOf('page} / {totalPages}');

    expect(scrollRegionEnd).toBeGreaterThan(0);
    expect(pagination).toBeGreaterThan(scrollRegionEnd);
    expect(callJournal).toContain('journalListRef.current?.scrollTo({ top: 0 });');
  });

  it('uses the available viewport height for a taller journal list', () => {
    expect(callJournal).toContain('<ModulePage contained className="pb-2 sm:pb-2 lg:pb-2">');
    expect(callJournal).toContain('className="flex flex-col gap-3 overflow-y-auto lg:overflow-hidden"');
    expect(callJournal).toContain('className="flex min-h-[32rem] shrink-0 flex-col overflow-hidden lg:min-h-0 lg:flex-1"');
  });

  it('shows a localized red indicator beside every unread missed call status', () => {
    expect(callJournal).toContain('isUnread={isUnreadMissedCall(call, lastSeenMissedCallId)}');
    expect(callJournal).toContain("title={t('newMissedCall')}");
    expect(callJournal).toContain('rounded-full bg-destructive');
    expect(callJournal).toContain('<CallStatus call={call} isUnread={isUnread} />');
  });

  it('marks missed calls viewed only after their real journal rows are visible', () => {
    expect(callJournal).toContain('const hasVisibleUnreadMissedCalls = items.some');
    expect(callJournal).toContain('!journalQuery.isSuccess');
    expect(callJournal).toContain('journalQuery.isPlaceholderData');
    expect(callJournal).toContain('pendingMissedCallReadRef.current = true;');
    expect(callJournal).not.toContain("t('markMissedCallsRead')");
  });

  it('keeps the red counter lit until the manager leaves the journal', () => {
    const seenEffect = callJournal.indexOf('pendingMissedCallReadRef.current = true;');
    const leaveEffect = callJournal.indexOf('useEffect(() => () => {');

    expect(seenEffect).toBeGreaterThan(0);
    expect(leaveEffect).toBeGreaterThan(seenEffect);
    // The request belongs to the unmount cleanup, so nothing clears the badge
    // while the journal is still on screen.
    expect(callJournal.indexOf('telephonyApi.markMissedCallsRead()')).toBeGreaterThan(leaveEffect);
    expect(callJournal).toContain('if (!pendingMissedCallReadRef.current) return;');
    expect(callJournal).toContain('queryClient.setQueryData(telephonyQueryKeys.missedCallUnread, summary);');
  });

  it('refreshes the short-lived OnlinePBX recording URL instead of returning a stored URL', () => {
    expect(telephonyRoutes).toContain('resolveOnlinePbxRecording(call)');
    expect(telephonyRoutes).toContain("res.setHeader('Cache-Control', 'no-store, private')");
    expect(telephonyRoutes).not.toContain('if (call.recordingUrl) return');
  });
});
