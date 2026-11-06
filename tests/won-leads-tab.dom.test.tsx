// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WonLeadsTab, matchesWonLeadSearch } from '../client/src/features/sales/ui/WonLeadsTab';
import { i18n } from '../client/src/lib/i18n';

const leads = [
  { id: 1, contactName: 'Parent One', studentName: 'Pupil One', managerName: 'Manager A', managerId: 3, wonAt: '2026-11-01T10:00:00.000Z' },
  { id: 2, contactName: 'Parent Two', phone: '+998901112233', managerName: 'Manager B', managerId: 4, wonAt: '2026-11-02T10:00:00.000Z' },
];

beforeEach(() => {
  i18n.setLanguage('en');
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('finds won deals by contact, pupil, manager and phone', () => {
  expect(matchesWonLeadSearch(leads[0], 'pupil one')).toBe(true);
  expect(matchesWonLeadSearch(leads[1], '1112233')).toBe(true);
  expect(matchesWonLeadSearch(leads[0], 'manager b')).toBe(false);
});

it('returns a won deal to work only after confirmation', async () => {
  const onReopen = vi.fn().mockResolvedValue(undefined);
  const onLeadClick = vi.fn();
  render(
    <WonLeadsTab
      t={(key) => i18n.t(key)}
      leads={leads}
      dateTime={(value) => value ?? ''}
      onLeadClick={onLeadClick}
      onReopen={onReopen}
      isPending={false}
    />,
  );
  const user = userEvent.setup();
  const row = screen.getByText('Parent Two').closest('tr')!;
  await user.click(within(row as HTMLElement).getByRole('button', { name: i18n.t('leadReopen') }));
  expect(onLeadClick).not.toHaveBeenCalled();
  expect(onReopen).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText(i18n.t('leadReopenTitle'))).toBeTruthy();
  await user.click(within(dialog).getByRole('button', { name: i18n.t('leadReopen') }));
  expect(onReopen).toHaveBeenCalledWith(2);
});

it('shows a short empty state without hints', () => {
  render(
    <WonLeadsTab t={(key) => i18n.t(key)} leads={[]} dateTime={() => ''} onLeadClick={vi.fn()} onReopen={vi.fn()} isPending={false} />,
  );
  expect(screen.getByText(i18n.t('noWonLeads'))).toBeTruthy();
});
