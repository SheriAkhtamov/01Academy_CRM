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
const telephonyRecordingRoutes = readFileSync(
  new URL('../server/routes/telephony-recording.routes.ts', import.meta.url),
  'utf8',
);
const paginationControls = readFileSync(
  new URL('../client/src/components/ux/PaginationControls.tsx', import.meta.url),
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

  it('defaults to fifty calls and lets the shared pagination change the server page size', () => {
    expect(callJournal).toContain('const CALL_JOURNAL_DEFAULT_PAGE_SIZE = 50;');
    expect(callJournal).toContain('const [pageSize, setPageSize] = useState(CALL_JOURNAL_DEFAULT_PAGE_SIZE);');
    expect(callJournal).toContain('limit: String(pageSize)');
    expect(callJournal).toContain('pageSize={journalQuery.data?.limit ?? pageSize}');
    expect(callJournal).toContain('onPageSizeChange={(nextPageSize) => {');
    expect(paginationControls).toContain('const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;');
    expect(telephonyRoutes).toContain('const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);');
    expect(telephonyRoutes).toContain('LIMIT ${limitParam} OFFSET ${offsetParam}');
  });

  it('keeps page controls outside the row scroller and resets scroll position on navigation', () => {
    const scrollRegion = callJournal.indexOf('data-call-journal-scroll');
    const pagination = callJournal.indexOf('<PaginationControls', scrollRegion);
    const cardEnd = callJournal.indexOf('</Card>', pagination);

    expect(scrollRegion).toBeGreaterThan(0);
    expect(pagination).toBeGreaterThan(scrollRegion);
    expect(cardEnd).toBeGreaterThan(pagination);
    expect(callJournal).toContain('journalListRef.current?.scrollTo({ top: 0 });');
  });

  it('uses the available viewport height for a taller journal list', () => {
    expect(callJournal).toContain('<ModulePage contained className="pb-2 sm:pb-2 lg:pb-2">');
    // The card fills the desktop viewport but keeps its 32rem floor there, so
    // a short screen scrolls the page instead of hiding the bottom of the list.
    expect(callJournal).toContain('className="flex flex-col gap-3 overflow-y-auto"');
    expect(callJournal).toContain('className="flex min-h-[32rem] shrink-0 flex-col overflow-hidden lg:flex-1"');
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

  it('offers an employee picker in the header that opens on the reader\'s own calls', () => {
    expect(callJournal).toContain("const ALL_EMPLOYEES = 'all';");
    expect(callJournal).toContain('const ownEmployeeId = user && hasOnlinePbxManagerAssignment(user) ? String(user.id) : null;');
    expect(callJournal).toContain('const employee = selectedEmployee ?? ownEmployeeId ?? ALL_EMPLOYEES;');
    // The picker belongs to the header actions slot, which is the top-right
    // corner of every module page.
    const actions = callJournal.indexOf('actions={(');
    const picker = callJournal.indexOf('<Select value={employee} onValueChange={setSelectedEmployee}>');
    expect(picker).toBeGreaterThan(actions);
    expect(picker).toBeLessThan(callJournal.indexOf("t('callJournalRefresh')"));
    expect(callJournal).toContain("aria-label={t('callJournalEmployee')}");
    expect(callJournal).toContain("<SelectItem value={ALL_EMPLOYEES}>{t('allEmployees')}</SelectItem>");
  });

  it('keeps the reader selectable before the operator roster arrives', () => {
    expect(callJournal).toContain('const operatorsQuery = useQuery(journalOperatorsQueryOptions);');
    expect(callJournal).toContain('operators.some((operator) => operator.id === user.id)');
    expect(callJournal).toContain('{ id: user.id, name: user.fullName, extension: user.onlinePbxExtension ?? \'\' },');
  });

  it('asks the server for one employee and resets paging when the pick changes', () => {
    expect(callJournal).toContain("if (employee !== ALL_EMPLOYEES) params.set('userId', employee);");
    expect(callJournal).toContain('useEffect(() => setPage(1), [deferredSearch, direction, employee, status, from, to]);');
    expect(telephonyRoutes).toContain('const employeeId = Number(String(req.query.userId ?? \'\').trim());');
    expect(telephonyRoutes).toContain('conditions.push(`call.user_id = ${addParam(employeeId)}`);');
  });

  it('lists only telephony-enabled sales employees, the reader included', () => {
    expect(telephonyRoutes).toContain("router.get('/calls/journal/operators', requireAuth,");
    expect(telephonyRoutes).toContain('employee.online_pbx_incoming_enabled = true');
    expect(telephonyRoutes).toContain('onlinePbxRoutingDestination(employee.extension)');
    // The journal roster keeps the reader; only the transfer list drops them.
    const operators = telephonyRoutes.indexOf("router.get('/calls/journal/operators'");
    const operatorsEnd = telephonyRoutes.indexOf("router.get('/calls/journal',", operators);
    expect(telephonyRoutes.slice(operators, operatorsEnd)).not.toContain('manager.id <> $1');
  });

  it('narrows the journal without widening what a manager may read', () => {
    const visibility = telephonyRoutes.indexOf('buildTelephonyCallVisibilitySql(actor)');
    const employeeFilter = telephonyRoutes.indexOf('conditions.push(`call.user_id = ${addParam(employeeId)}`);');

    expect(visibility).toBeGreaterThan(0);
    // Both land in the same AND-joined condition list, so a picked employee can
    // only ever subtract rows from what the reader is already allowed to see.
    expect(employeeFilter).toBeGreaterThan(visibility);
    expect(telephonyRoutes).toContain("const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';");
  });

  it('refreshes the short-lived OnlinePBX recording URL instead of returning a stored URL', () => {
    expect(telephonyRecordingRoutes).toContain('resolveOnlinePbxRecording(call)');
    expect(telephonyRecordingRoutes).toContain("res.setHeader('Cache-Control', 'no-store, private')");
    expect(telephonyRecordingRoutes).not.toContain('if (call.recordingUrl) return');
  });
});
