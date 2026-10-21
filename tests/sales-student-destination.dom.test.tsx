// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SalesDashboard from '../client/src/pages/sales-dashboard';
import { TooltipProvider } from '../client/src/components/ui/tooltip';
import { salesQueryKeys } from '../client/src/features/sales/queries';
import { summarizeStudentProfile } from '../shared/contracts/student-profile';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';

const mocks = vi.hoisted(() => ({ profile: vi.fn() }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({
  user: { id: 7, fullName: 'Manager', module: 'sales', modules: ['sales'] },
}) }));
vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({ useOnlinePbxCall: () => ({ startCall: vi.fn(), isPending: false }) }));
vi.mock('../client/src/features/students/api', () => ({ studentsApi: { profile: mocks.profile } }));
vi.mock('../client/src/components/ux/SalesOverviewMetrics', () => ({ SalesOverviewMetrics: () => null }));
vi.mock('../client/src/features/sales/ui/SalesSections', () => ({
  SalesOverviewSection: () => null, SalesPipelineSection: () => null, SalesBulkActionsButton: () => null,
}));
vi.mock('../client/src/features/learning-rollout/api', () => ({ learningCapabilitiesQuery: {
  queryKey: ['learning-capabilities'], queryFn: async () => ({ canManageAccess: false, portalEnabled: false }),
} }));

const student = { id: 42, studentName: 'Ученик', contactName: 'Родитель', status: 'studying', leadId: 12 };
let client: QueryClient;
beforeEach(() => {
  i18n.setLanguage('ru');
  allowNavigation(() => history.replaceState(null, '', '/sales?student=42'));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => [] } } });
  client.setQueryData(salesQueryKeys.module, { students: [student], leads: [], archivedLeads: [], groups: [],
    statuses: [], courses: [], schools: [], payments: [], sources: [], lessons: [] });
  mocks.profile.mockResolvedValue({ student, lead: { id: 12, contactName: 'Родитель', phone: null },
    groups: [], attendance: [], payments: [], projects: [], summary: summarizeStudentProfile([], [], []) });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  cleanup(); client.clear();
  await new Promise(resolve => setTimeout(resolve, 0));
});

it('opens a student from the shared search and notification destination on the sales overview', async () => {
  render(<QueryClientProvider client={client}><TooltipProvider><SalesDashboard /></TooltipProvider></QueryClientProvider>);
  expect(await screen.findByRole('dialog', { name: student.studentName })).toBeTruthy();
  await waitFor(() => expect(mocks.profile).toHaveBeenCalledWith(42, 'sales'));
  await userEvent.click(screen.getByRole('button', { name: i18n.t('close') }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('heading', { name: i18n.t('salesOverviewTitle') })).toBeTruthy();
  expect(location.pathname + location.search).toBe('/sales');
});
