// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArchiveTab, type ArchivedLead } from '../client/src/features/sales/ui/ArchiveTab';
import { EmployeeIdentityContext } from '../client/src/features/employees/EmployeeIdentityProvider';
import { i18n } from '../client/src/lib/i18n';

beforeEach(() => { i18n.setLanguage('en'); window.localStorage.clear(); });
afterEach(() => { cleanup(); window.localStorage.clear(); });

it('keeps the selected employee visible after their final archived lead leaves the list', () => {
  window.localStorage.setItem('academy-ui:sales.archive.managerFilter', JSON.stringify('employee:7'));
  const directory = new Map([[7, { id: 7, fullName: 'Alice', avatarUrl: null }]]);
  const lead: ArchivedLead = { id: 1, funnelId: 1, contactName: 'Archived lead', statusCode: 'new_request', managerId: 7, managerName: 'Alice' };
  const view = (leads: ArchivedLead[]) => <EmployeeIdentityContext.Provider value={directory}>
    <ArchiveTab t={(key) => i18n.t(key)} leads={leads} funnels={[]} activePipelineStatuses={[]}
      leadStatusName={(code) => code} archiveReasonName={(code) => code ?? ''} dateTime={(date) => date ?? ''}
      onLeadClick={vi.fn()} onRestore={vi.fn()} isPending={false} />
  </EmployeeIdentityContext.Provider>;
  const rendered = render(view([lead]));
  expect(within(screen.getByRole('combobox', { name: i18n.t('manager') })).getByText('Alice')).toBeTruthy();
  rendered.rerender(view([]));
  const filter = screen.getByRole('combobox', { name: i18n.t('manager') });
  expect(within(filter).getByText('Alice')).toBeTruthy();
  expect(filter.textContent).not.toContain('employee:');
  expect(window.localStorage.getItem('academy-ui:sales.archive.managerFilter')).toBe(JSON.stringify('employee:7'));
});
