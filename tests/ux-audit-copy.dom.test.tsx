// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuditPage from '../client/src/pages/admin/audit';
import { i18n, translations } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.api }));
const pagination = { page: 1, limit: 25, total: 1, totalPages: 1 };
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
    await userEvent.setup().click(screen.getByRole('tab', { name: translations.navIntegrations.en }));
    expect(screen.getAllByText(translations.integrationStatusFailed.en).length).toBeGreaterThan(0);
    expect(screen.getAllByText(translations.instagramIntegration.en).length).toBeGreaterThan(0);
    for (const technicalValue of ['Graph API', '987654', 'access_token', 'secret-value', 'webhook_payload']) {
      expect(document.body.textContent).not.toContain(technicalValue);
    }
  });
});
