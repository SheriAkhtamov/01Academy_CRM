// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesDemoStudent } from '../shared/contracts/sales-demo-students';
import { translations, type TranslationKey } from '../client/src/lib/i18n';
const api = vi.hoisted(() => vi.fn());
vi.mock('../client/src/features/sales/api', () => ({ getSalesDemoStudents: api }));
vi.mock('../client/src/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: TranslationKey) => translations[key].en, language: 'en' }) }));
import { DemoStudentsDialog } from '../client/src/components/ux/sales-overview/DemoStudentsDialog';
import { invalidateSalesData } from '../client/src/features/sales/queries';

const range = { from: '2026-08-01', to: '2026-08-31' };
const students: SalesDemoStudent[] = [{ studentId: 10, leadId: 20, studentName: 'Temur', contactName: 'Parent', phone: '+998 (90) 123-45-67', managerId: 1, managerName: 'Alice', visits: [
  { participantId: 2, demoId: 2, scheduledAt: '2026-08-10T10:00:00Z', durationMinutes: 60, format: 'online', courseName: 'Design', schoolName: 'Cyberpark', roomName: null, teacherName: 'Teacher' },
  { participantId: 1, demoId: 1, scheduledAt: '2026-07-31T19:00:00Z', durationMinutes: 60, format: 'offline', courseName: 'Coding', schoolName: 'Cyberpark', roomName: '101', teacherName: 'Teacher' },
] }, { studentId: 11, leadId: null, studentName: 'Aziza', contactName: null, phone: null, managerId: 1, managerName: 'Alice', visits: [
  { participantId: 3, demoId: 3, scheduledAt: '2026-08-31T18:59:59Z', durationMinutes: 60, format: 'offline', courseName: 'Coding', schoolName: 'Cyberpark', roomName: '102', teacherName: 'Teacher' },
] }];
let client: QueryClient;
const close = vi.fn();
const openLead = vi.fn();
const view = (managerId: number | null = 1) => <QueryClientProvider client={client}><DemoStudentsDialog key={managerId} reportingRange={range} managerId={managerId} onClose={close} onOpenLead={openLead} /></QueryClientProvider>;

beforeEach(() => {
  vi.clearAllMocks();
  api.mockResolvedValue(students);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });

describe('demo attendance list', () => {
  it('shows each student once with every visit and searches courses, contacts and formatted phones', async () => {
    const user = userEvent.setup();
    render(view());
    const temur = await screen.findByRole('article', { name: 'Temur' });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(within(temur).getAllByRole('listitem')).toHaveLength(2);
    expect(within(temur).getByText(/Aug 0?1, 2026/)).toBeTruthy();
    expect(within(temur).getByText(translations.online.en)).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Students: 2')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('from=2026-08-01&to=2026-08-31&managerId=1');
    const search = screen.getByRole('searchbox');
    for (const term of ['Design', 'Parent', '901234567']) {
      await user.clear(search);
      await user.type(search, term);
      expect(screen.getAllByRole('article')).toHaveLength(1);
      expect(screen.getByRole('article', { name: 'Temur' })).toBeTruthy();
    }
    await user.clear(search);
    await user.type(search, 'Nobody');
    expect(screen.getByText(translations.demoStudentsNoResults.en)).toBeTruthy();
    expect(screen.queryByText(translations.demoStudentsEmpty.en)).toBeNull();
    await user.click(screen.getByRole('button', { name: translations.clearSearch.en }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    await user.click(within(screen.getByRole('article', { name: 'Temur' })).getByRole('button', { name: translations.openLeadCard.en }));
    expect(close).toHaveBeenCalledOnce();
    expect(openLead).toHaveBeenCalledWith(20);
    expect(within(screen.getByRole('article', { name: 'Aziza' })).queryByRole('button')).toBeNull();
  });

  it('distinguishes loading, a failed request and an empty attendance period', async () => {
    const user = userEvent.setup();
    let reject!: (reason: Error) => void;
    api.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(view());
    expect(screen.getByRole('status').textContent).toBe(translations.loading.en);
    expect(screen.queryByText(translations.demoStudentsEmpty.en)).toBeNull();
    await act(async () => reject(new Error('Request failed')));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(translations.demoStudentsEmpty.en)).toBeNull();
    api.mockResolvedValueOnce([]);
    await user.click(screen.getByRole('button', { name: translations.retry.en }));
    expect(await screen.findByText(translations.demoStudentsEmpty.en)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not show the previous manager’s cached students while the next scope loads', async () => {
    const mounted = render(view());
    await screen.findByRole('article', { name: 'Temur' });
    let resolve!: (value: SalesDemoStudent[]) => void;
    api.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    mounted.rerender(view(2));
    expect(screen.queryByRole('article', { name: 'Temur' })).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(api).toHaveBeenLastCalledWith('from=2026-08-01&to=2026-08-31&managerId=2');
    await act(async () => resolve([]));
    expect(await screen.findByText(translations.demoStudentsEmpty.en)).toBeTruthy();
  });

  it('refreshes the open attendance list when a demo update invalidates sales data', async () => {
    render(view(null));
    await screen.findByRole('article', { name: 'Temur' });
    expect(api).toHaveBeenCalledWith('from=2026-08-01&to=2026-08-31');
    api.mockResolvedValue([]);
    await act(async () => { await invalidateSalesData(client); });
    await waitFor(() => expect(screen.queryByRole('article')).toBeNull());
    expect(screen.getByText(translations.demoStudentsEmpty.en)).toBeTruthy();
  });
});
