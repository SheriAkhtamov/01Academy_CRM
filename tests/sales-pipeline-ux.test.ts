import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyPipelineFilters,
  EMPTY_PIPELINE_FILTERS,
  hasActivePipelineFilters,
  leadDealAmount,
  PIPELINE_FILTER_UNASSIGNED,
  type PipelineFilterableLead,
} from '../client/src/lib/pipelineFilters';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const kanban = read('../client/src/components/ux/KanbanBoard.tsx');
const toolbar = read('../client/src/components/ux/PipelineToolbar.tsx');
const salesSections = read('../client/src/features/sales/ui/SalesSections.tsx');
const salesDashboard = read('../client/src/pages/sales-dashboard.tsx');
const leadSheet = read('../client/src/components/ux/LeadDetailSheet.tsx');
const leadActivity = read('../client/src/features/leads/ui/LeadActivity.tsx');
const paymentTab = read('../client/src/components/ux/lead/LeadPaymentTab.tsx');
const tasksTab = read('../client/src/components/ux/lead/LeadTasksTab.tsx');

const leads: PipelineFilterableLead[] = [
  {
    id: 1,
    contactName: 'Азиза Каримова',
    phoneNumbers: ['+998901112233'],
    sourceId: 5,
    sourceName: 'Instagram',
    managerId: 7,
    managerName: 'Дилшод',
    tags: [{ name: 'Робототехника' }],
    createdAt: '2026-07-01T10:00:00.000Z',
    offerPriceUzs: 3_000_000,
  },
  {
    id: 2,
    contactName: 'Бекзод Усмонов',
    phone: '+998935556677',
    comment: 'Просил перезвонить вечером',
    sourceId: 6,
    sourceName: 'Telegram',
    managerId: null,
    createdAt: '2026-07-20T10:00:00.000Z',
    expectedPaymentUzs: 1_200_000,
  },
  {
    id: 3,
    contactName: 'Валерия Ким',
    phoneNumbers: [],
    sourceId: 5,
    sourceName: 'Instagram',
    managerId: 8,
    managerName: 'Севара',
    createdAt: '2026-06-15T10:00:00.000Z',
  },
];

const idsOf = (result: PipelineFilterableLead[]) => result.map((lead) => lead.id);

describe('pipeline board filtering', () => {
  it('returns every lead newest-first when no filter is set', () => {
    expect(hasActivePipelineFilters(EMPTY_PIPELINE_FILTERS)).toBe(false);
    expect(idsOf(applyPipelineFilters(leads, EMPTY_PIPELINE_FILTERS))).toEqual([2, 1, 3]);
  });

  it('searches across name, comment, source, manager and tags', () => {
    const search = (query: string) => idsOf(applyPipelineFilters(leads, { ...EMPTY_PIPELINE_FILTERS, query }));

    expect(search('азиза')).toEqual([1]);
    expect(search('перезвонить')).toEqual([2]);
    expect(search('instagram')).toEqual([1, 3]);
    expect(search('севара')).toEqual([3]);
    expect(search('робото')).toEqual([1]);
  });

  it('matches phone numbers regardless of formatting and requires every token', () => {
    const search = (query: string) => idsOf(applyPipelineFilters(leads, { ...EMPTY_PIPELINE_FILTERS, query }));

    expect(search('+998 90 111 22 33')).toEqual([1]);
    expect(search('5556677')).toEqual([2]);
    expect(search('ким валерия')).toEqual([3]);
    expect(search('азиза telegram')).toEqual([]);
  });

  it('filters by responsible manager, unassigned leads and source', () => {
    expect(idsOf(applyPipelineFilters(leads, { ...EMPTY_PIPELINE_FILTERS, managerId: '8' }))).toEqual([3]);
    expect(idsOf(applyPipelineFilters(
      leads,
      { ...EMPTY_PIPELINE_FILTERS, managerId: PIPELINE_FILTER_UNASSIGNED },
    ))).toEqual([2]);
    expect(idsOf(applyPipelineFilters(leads, { ...EMPTY_PIPELINE_FILTERS, sourceId: '6' }))).toEqual([2]);
    expect(hasActivePipelineFilters({ ...EMPTY_PIPELINE_FILTERS, sourceId: '6' })).toBe(true);
  });

  it('sorts by age, deal amount and contact name', () => {
    expect(idsOf(applyPipelineFilters(leads, { ...EMPTY_PIPELINE_FILTERS, sort: 'oldest' }))).toEqual([3, 1, 2]);
    expect(idsOf(applyPipelineFilters(leads, { ...EMPTY_PIPELINE_FILTERS, sort: 'amount' }))).toEqual([1, 2, 3]);
    expect(idsOf(applyPipelineFilters(leads, { ...EMPTY_PIPELINE_FILTERS, sort: 'name' }))).toEqual([1, 2, 3]);
  });

  it('reads the column total from the same amount shown on the card', () => {
    expect(leadDealAmount(leads[0])).toBe(3_000_000);
    expect(leadDealAmount(leads[1])).toBe(1_200_000);
    expect(leadDealAmount(leads[2])).toBe(0);
    expect(leadDealAmount({ id: 4, contactName: 'x', offerPriceUzs: Number.NaN })).toBe(0);
  });
});

describe('pipeline board interactions', () => {
  it('keeps the board draggable while a status change is in flight', () => {
    expect(kanban).not.toContain('disabled: isPending');
    expect(kanban).toContain('const CLICK_AFTER_DRAG_MS = 250');
  });

  it('does not open the lead sheet on the click that ends a drag', () => {
    expect(kanban).toContain('dragEndedAtRef.current = Date.now()');
    expect(kanban).toContain('if (wasJustDragged()) return;');
  });

  it('shows the deal amount on the card and formats column totals with the page locale', () => {
    expect(kanban).toContain('{money(amount)}');
    expect(kanban).toContain('{money(totalSum)}');
    expect(kanban).not.toContain("Intl.NumberFormat('ru-RU')");
  });

  it('wires search, filters and sorting into the board', () => {
    expect(salesSections).toContain('<PipelineToolbar');
    expect(salesSections).toContain('applyPipelineFilters(leads, filters)');
    expect(salesDashboard).toContain('sources={activeLeadSources}');
    expect(toolbar).toContain("t('resetFilters')");
    expect(toolbar).toContain("aria-label={t('clearSearch')}");
  });
});

describe('lead sheet usability', () => {
  it('confirms before discarding unsaved deal edits', () => {
    expect(leadSheet).toContain('useUnsavedChangesGuard');
    expect(leadSheet).toContain('onOpenChange={closeGuard.handleOpenChange}');
    expect(leadSheet).toContain('<UnsavedChangesDialog');
  });

  it('keeps the header fixed and scrolls only the tab body', () => {
    expect(leadSheet).toContain('className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"');
    expect(leadSheet).toContain('<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">');
    expect(leadSheet).toContain('className="sticky bottom-0 -mx-6 -mb-6');
  });

  it('stays open after reassigning the responsible manager', () => {
    const assignLeadBlock = leadSheet.slice(
      leadSheet.indexOf('const assignLead = useMutation'),
      leadSheet.indexOf('const addLeadComment = useMutation'),
    );
    expect(assignLeadBlock).toContain('await leadQuery.refetch()');
    expect(assignLeadBlock).not.toContain('onOpenChange(false)');
  });

  it('explains why the paid status cannot be picked by hand', () => {
    expect(leadSheet).toContain("toast({ title: t('leadStatusPaidNeedsPayment') })");
  });

  it('translates saved payment details instead of printing raw codes', () => {
    expect(paymentTab).toContain('export const paymentSummaryLine');
    expect(paymentTab).toContain('{paymentSummaryLine(payment, t)}');
    expect(leadActivity).toContain('text: paymentSummaryLine(item, t)');
    expect(paymentTab).not.toContain('[payment.method, payment.type, payment.discount]');
  });

  it('uses grouped currency inputs for money fields', () => {
    expect(leadSheet).toContain('<CurrencyInput');
    expect(paymentTab).toContain('<CurrencyInput');
    expect(paymentTab).not.toContain('type="number"');
  });

  it('flags overdue lead tasks and reports task creation progress', () => {
    expect(tasksTab).toContain("t('taskOverdue')");
    expect(tasksTab).toContain("{isCreating ? t('saving') : t('createTask')}");
  });

  it('filters the activity timeline instead of repeating the comment list', () => {
    expect(leadActivity).toContain('const ACTIVITY_FILTERS');
    expect(leadActivity).toContain("const [activeFilter, setActiveFilter] = useState<'all' | ActivityKind>('all')");
    expect(leadActivity).toContain("{t('leadLatestComment')}");
  });
});
