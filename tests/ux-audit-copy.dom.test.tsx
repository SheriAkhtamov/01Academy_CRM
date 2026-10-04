// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import AuditPage from '../client/src/pages/admin/audit';
import { i18n, translations } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.api }));
const pagination = { page: 1, limit: 25, total: 1, totalPages: 1 };
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
beforeEach(() => {
  i18n.setLanguage('en');
  mocks.api.mockResolvedValue({
    logs: [{ id: 2, userName: 'Manager', userModule: 'sales', action: 'UPDATE', entityType: 'academy_lead', entityId: 987654,
      oldValues: { contact_name: 'Old contact', manager_id: 7 },
      newValues: { contact_name: 'New contact', manager_id: 8, status: 'new_request', internal_version: 12, webhook_payload: { access_token: 'secret-value' } },
      createdAt: '2026-10-03T05:00:00Z' }],
    integrationLogs: [{ id: 3, provider: 'instagram', status: 'failed', errorMessage: 'Graph API internal error 987654',
      payload: { access_token: 'secret-value', error: 'webhook_payload' }, createdAt: '2026-10-03T05:00:00Z' }],
    employees: [{ id: 7, fullName: 'Previous manager', module: 'sales' }, { id: 8, fullName: 'New manager', module: 'sales' }],
    pagination: { audit: pagination, integrations: pagination },
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuditPage /></QueryClientProvider>);

describe('audit copy and diagnostics', () => {
  it('keeps a modal with readable business changes and employee names', async () => {
    mount();
    const buttons = await screen.findAllByRole('button', { name: translations.viewChanges.en });
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog', { name: translations.recordChanges.en });
    expect(within(dialog).getByText(translations.contactPersonName.en)).toBeTruthy();
    expect(within(dialog).getByText('New contact')).toBeTruthy();
    expect(within(dialog).getByText('Previous manager')).toBeTruthy();
    expect(within(dialog).getByText('New manager')).toBeTruthy();
    expect(within(dialog).getByText(translations.leadStatusNewRequest.en)).toBeTruthy();
    for (const technicalValue of ['contact_name', 'manager_id', 'internal_version', 'webhook_payload', 'secret-value', '987654']) {
      expect(document.body.textContent).not.toContain(technicalValue);
    }
  });
  it('shows integration status without raw error or payload contents', async () => {
    mount();
    await screen.findAllByRole('button', { name: translations.viewChanges.en });
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: translations.auditSection.en }));
    await user.click(screen.getByRole('option', { name: translations.navIntegrations.en }));
    expect(screen.getAllByText(translations.integrationStatusFailed.en).length).toBeGreaterThan(0);
    expect(screen.getAllByText(translations.instagramIntegration.en).length).toBeGreaterThan(0);
    for (const technicalValue of ['Graph API', '987654', 'access_token', 'secret-value', 'webhook_payload']) {
      expect(document.body.textContent).not.toContain(technicalValue);
    }
  });

  it('groups the section selector and filter with the history heading, and refresh with the page title', async () => {
    mount();
    await screen.findAllByRole('button', { name: translations.viewChanges.en });
    const header = screen.getByRole('heading', { name: translations.auditHistory.en }).parentElement!;
    expect(within(header).getByRole('combobox', { name: translations.auditSection.en })).toBeTruthy();
    expect(within(header).getByRole('button', { name: translations.auditFilterButton.en })).toBeTruthy();
    const titleRow = screen.getByRole('heading', { name: translations.auditLog.en }).parentElement!;
    expect(within(titleRow).getByRole('button', { name: translations.adminRefresh.en })).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByLabelText(translations.financeCenterEmployee.en)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('applies all filters together from the dialog and preserves them until reset is applied', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findAllByRole('button', { name: translations.viewChanges.en });
    await user.click(screen.getByRole('button', { name: translations.auditFilterButton.en }));
    let dialog = screen.getByRole('dialog', { name: translations.auditFiltersTitle.en });
    const requestsBeforeEditing = mocks.api.mock.calls.length;
    await user.click(within(dialog).getByRole('combobox', { name: translations.financeCenterEmployee.en }));
    await user.click(screen.getByRole('option', { name: 'New manager' }));
    await user.click(within(dialog).getByRole('combobox', { name: translations.auditAction.en }));
    await user.click(screen.getByRole('option', { name: translations.auditActionChanged.en }));
    await user.click(within(dialog).getByRole('combobox', { name: translations.auditObject.en }));
    await user.click(screen.getByRole('option', { name: translations.navLeads.en }));
    fireEvent.change(within(dialog).getByLabelText(translations.fromDate.en), { target: { value: '2026-10-01' } });
    fireEvent.change(within(dialog).getByLabelText(translations.toDate.en), { target: { value: '2026-10-05' } });
    expect(mocks.api.mock.calls.length).toBe(requestsBeforeEditing);
    await user.click(within(dialog).getByRole('button', { name: translations.auditApplyFilters.en }));
    await waitFor(() => expect(mocks.api.mock.calls.at(-1)?.[1]).toContain('userId=8&action=UPDATE&entityType=academy_lead&from=2026-10-01&to=2026-10-05&auditPage=1'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('button', { name: /Filter/ })).getByText('4')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Filter/ }));
    dialog = screen.getByRole('dialog', { name: translations.auditFiltersTitle.en });
    expect((within(dialog).getByLabelText(translations.fromDate.en) as HTMLInputElement).value).toBe('2026-10-01');
    const filteredRequest = mocks.api.mock.calls.at(-1)?.[1];
    await user.click(within(dialog).getByRole('button', { name: translations.reset.en }));
    expect(mocks.api.mock.calls.at(-1)?.[1]).toBe(filteredRequest);
    await user.click(within(dialog).getByRole('button', { name: translations.auditApplyFilters.en }));
    await waitFor(() => expect(screen.getByRole('button', { name: translations.auditFilterButton.en }).textContent).not.toContain('4'));
    // Returning to the initial query can use its cache; reopening verifies the applied state.
    await user.click(screen.getByRole('button', { name: translations.auditFilterButton.en }));
    dialog = screen.getByRole('dialog', { name: translations.auditFiltersTitle.en });
    expect(within(dialog).getByRole('combobox', { name: translations.financeCenterEmployee.en }).textContent).toBe(translations.allEmployees.en);
    expect((within(dialog).getByLabelText(translations.fromDate.en) as HTMLInputElement).value).toBe('');
  });

  it('discards draft filters on cancel', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findAllByRole('button', { name: translations.viewChanges.en });
    const requestCount = mocks.api.mock.calls.length;
    await user.click(screen.getByRole('button', { name: translations.auditFilterButton.en }));
    const dialog = screen.getByRole('dialog', { name: translations.auditFiltersTitle.en });
    fireEvent.change(within(dialog).getByLabelText(translations.fromDate.en), { target: { value: '2026-10-01' } });
    await user.click(within(dialog).getByRole('button', { name: translations.cancel.en }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.api.mock.calls.length).toBe(requestCount);
    await user.click(screen.getByRole('button', { name: translations.auditFilterButton.en }));
    expect((screen.getByLabelText(translations.fromDate.en) as HTMLInputElement).value).toBe('');
  });
});
