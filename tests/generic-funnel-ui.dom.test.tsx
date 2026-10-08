// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AcademySettings from '../client/src/pages/academy-settings';
import { ArchiveTab } from '../client/src/features/sales/ui/ArchiveTab';
import { LeadStageStepper } from '../client/src/components/ux/lead/LeadSheetControls';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';

vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, module: 'administration', modules: ['administration'] } }) }));
const statuses = [
  { id: 1, code: 'custom_intake', funnelId: 7, name: 'Intake renamed', color: '#2563eb', sortOrder: 0, isSystem: false, isActive: true, isPipeline: true },
  { id: 2, code: 'demo_attended', funnelId: 7, name: 'Ordinary renamed', color: '#16a34a', sortOrder: 10, isSystem: true, isActive: true, isPipeline: true },
  { id: 3, code: 'custom_b', funnelId: 8, name: 'Other funnel stage', color: '#8b5cf6', sortOrder: 0, isSystem: false, isActive: true, isPipeline: true },
];
const funnels = [
  { id: 7, name: 'Funnel A', initialStageCode: 'custom_intake', isActive: true, isDefault: true },
  { id: 8, name: 'Funnel B', initialStageCode: 'custom_b', isActive: true, isDefault: false },
];
let client: QueryClient;
beforeEach(() => {
  i18n.setLanguage('en'); localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn(); Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: async ({ queryKey }) => queryKey[0] === '/api/academy/configuration'
    ? { groups: [], courses: [], schools: [], rooms: [], statuses, teachers: [], lessons: [] }
    : queryKey[0] === '/api/academy/sales-funnels' ? funnels : [] } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

it('protects only the recorded first stage while allowing old coded stages to be edited and deleted', async () => {
  allowNavigation(() => history.replaceState(null, '', '/admin/sales-settings?tab=pipeline'));
  render(<QueryClientProvider client={client}><AcademySettings mode="sales" /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Funnel A/ }));
  const dialog = screen.getByRole('dialog', { name: 'Funnel A' });
  const intake = within(dialog).getByText('Intake renamed').closest('div.rounded-xl')! as HTMLElement;
  const ordinary = within(dialog).getByText('Ordinary renamed').closest('div.rounded-xl')! as HTMLElement;
  expect(within(intake).getByText(i18n.t('salesFunnelInitialStage'))).toBeTruthy();
  expect((within(intake).getByRole('button', { name: i18n.t('delete') }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(ordinary).getByRole('button', { name: i18n.t('delete') }) as HTMLButtonElement).disabled).toBe(false);
  await user.click(within(ordinary).getByRole('button', { name: i18n.t('edit') }));
  const editor = screen.getByRole('dialog', { name: i18n.t('editPipelineStage') });
  expect((within(editor).getByLabelText(i18n.t('shownInPipeline')) as HTMLButtonElement).disabled).toBe(false);
  expect((within(editor).getByLabelText(i18n.t('active')) as HTMLButtonElement).disabled).toBe(false);
  expect((within(editor).getByLabelText(i18n.t('sortOrder')) as HTMLInputElement).disabled).toBe(false);
});

it('uses the archived row funnel for restoring even when other funnels are available', async () => {
  const onRestore = vi.fn();
  render(<ArchiveTab t={(key) => i18n.t(key)} leads={[{ id: 90, funnelId: 8, contactName: 'Archived parent', statusCode: 'custom_b' }]}
    funnels={funnels} activePipelineStatuses={statuses} leadStatusName={(code) => statuses.find((stage) => stage.code === code)?.name ?? code}
    archiveReasonName={(value) => value ?? ''} dateTime={(value) => value ?? ''} onLeadClick={vi.fn()} onRestore={onRestore} isPending={false} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: i18n.t('restoreLead') }));
  expect(screen.queryByRole('menuitem', { name: /Intake renamed/ })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: /Ordinary renamed/ })).toBeNull();
  await user.click(screen.getByRole('menuitem', { name: /Other funnel stage/ }));
  expect(onRestore).not.toHaveBeenCalled();
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('restoreLead') }));
  expect(onRestore).toHaveBeenCalledExactlyOnceWith(90, 'custom_b');
});

it('highlights only the current stage without marking earlier stages as completed', () => {
  render(<LeadStageStepper statuses={statuses.filter((stage) => stage.funnelId === 7)} currentStatusCode="demo_attended" leadStatusName={(code) => statuses.find((stage) => stage.code === code)?.name ?? code} />);
  const stages = screen.getByRole('group', { name: i18n.t('pipelineStages') });
  expect((within(stages).getByText('Intake renamed').parentElement as HTMLElement).style.backgroundColor).toBe('');
  expect((within(stages).getByText('Ordinary renamed').parentElement as HTMLElement).getAttribute('aria-current')).toBe('step');
});
