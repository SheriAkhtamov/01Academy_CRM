// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeAvatar, EmployeeIdentity } from '../client/src/components/ux/EmployeeIdentity';
import { EmployeeIdentityContext, EmployeeIdentityProvider } from '../client/src/features/employees/EmployeeIdentityProvider';
import { SalesOverviewEmployeeFilter } from '../client/src/components/ux/SalesOverviewEmployeeFilter';
import { InstagramMessageAuthor } from '../client/src/features/sales/ui/InstagramMessageAuthor';
import { TransactionTable } from '../client/src/components/finance/TransactionTable';
import { IncomeRegistryTable } from '../client/src/components/finance/IncomeRegistryTable';
import { DemoLessonDetailsDialog } from '../client/src/components/ux/DemoLessonDetailsDialog';
import { SalesScheduleTeacherFilter } from '../client/src/components/ux/SalesScheduleTeacherFilter';
import { buildSalesScheduleTeacherOptions } from '../client/src/lib/salesSchedule';
import { i18n } from '../client/src/lib/i18n';
import { financeCopy } from '../client/src/lib/financeCenter';

const firstPhoto = '/api/users/photos/aaaaaaaaaaaaaaaaaaaaa';
const secondPhoto = '/api/users/photos/bbbbbbbbbbbbbbbbbbbbb';
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  user: { id: 1, fullName: 'Current employee', avatarUrl: null } as { id: number; fullName: string; avatarUrl: string | null } | null,
}));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
const clients: QueryClient[] = [];
beforeEach(() => {
  i18n.setLanguage('en');
  mocks.user = { id: 1, fullName: 'Current employee', avatarUrl: null };
  mocks.api.mockReset();
  vi.stubGlobal('Image', class extends EventTarget {
    complete = false;
    naturalWidth = 0;
    set src(_src: string) { queueMicrotask(() => { this.complete = true; this.naturalWidth = 24; this.dispatchEvent(new Event('load')); }); }
  });
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; vi.unstubAllGlobals(); });
const directory = (photo = firstPhoto) => new Map([
  [7, { id: 7, fullName: 'Shared employee', avatarUrl: photo }],
  [8, { id: 8, fullName: 'Shared employee', avatarUrl: secondPhoto }],
]);
const photos = (container: HTMLElement) => [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));

describe('canonical employee display identities', () => {
  it('shares one identity query across finance surfaces and replaces every photo after profile invalidation', async () => {
    let photo = firstPhoto;
    mocks.api.mockImplementation(async () => [...directory(photo).values()]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const copy = financeCopy((key) => i18n.t(key));
    const { container } = render(<QueryClientProvider client={client}><EmployeeIdentityProvider>
      <TransactionTable rows={[{ id: 1, counterparty: 'Previous name', counterpartyUserId: 7, title: 'Payment' }]} copy={copy} money={String} dateTime={String} categoryLabel={String} />
      <IncomeRegistryTable rows={[{ id: 2, managerName: 'Previous name', managerId: 7 }]} copy={copy} money={String} dateTime={String} methodLabel={String} />
      <EmployeeAvatar userId={7} name="Previous name" />
    </EmployeeIdentityProvider></QueryClientProvider>);
    await waitFor(() => expect(photos(container).filter((src) => src === firstPhoto).length).toBeGreaterThanOrEqual(3));
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith('GET', '/api/users/identities');
    expect(screen.queryByText('Previous name')).toBeNull();
    const photoCount = photos(container).length;
    photo = secondPhoto;
    await act(async () => { await client.invalidateQueries({ queryKey: ['/api/users'] }); });
    await waitFor(() => {
      expect(photos(container)).toHaveLength(photoCount);
      expect(photos(container).every((src) => src === secondPhoto)).toBe(true);
    });
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });

  it('keeps people with identical names separate by ID and does not invent a vendor identity', async () => {
    const { container } = render(<EmployeeIdentityContext.Provider value={directory()}>
      <EmployeeIdentity userId={7} name="Shared employee" />
      <EmployeeIdentity userId={8} name="Shared employee" />
      <EmployeeIdentity name="Shared employee" />
    </EmployeeIdentityContext.Provider>);
    await waitFor(() => expect(photos(container)).toEqual([firstPhoto, secondPhoto]));
    expect(screen.getAllByText('Shared employee')).toHaveLength(3);
  });

  it('uses an updated own-session photo immediately and stops exposing directory images after logout', async () => {
    mocks.api.mockResolvedValue([{ id: 1, fullName: 'Old name', avatarUrl: firstPhoto }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
    const tree = () => <QueryClientProvider client={client}><EmployeeIdentityProvider><EmployeeIdentity userId={1} name="Fallback name" /></EmployeeIdentityProvider></QueryClientProvider>;
    mocks.user = { id: 1, fullName: 'Current employee', avatarUrl: secondPhoto };
    const view = render(tree());
    await waitFor(() => expect(photos(view.container)).toEqual([secondPhoto]));
    expect(screen.queryByText('Old name')).toBeNull();
    mocks.user = null;
    view.rerender(tree());
    await waitFor(() => expect(photos(view.container)).toEqual([]));
    expect(screen.getByText('Fallback name')).toBeTruthy();
  });

  it.each(['https://outside.example/photo.png', '/api/portal/me/photos/aaaaaaaaaaaaaaaaaaaaa'])('shows initials without a photo and rejects a non-staff image URL: %s', async (avatarUrl) => {
    const { container } = render(<><EmployeeIdentity userId={9} name="No Photo" /><EmployeeAvatar userId={10} name="Unsafe Photo" avatarUrl={avatarUrl} /></>);
    expect(container.textContent).toContain('NP');
    expect(container.textContent).toContain('UP');
    expect(photos(container)).toEqual([]);
  });

  it('uses the linked staff user rather than the unrelated teacher profile ID in the demo and teacher filter', async () => {
    const identities = new Map([
      [44, { id: 44, fullName: 'Linked teacher', avatarUrl: firstPhoto }],
      [3, { id: 3, fullName: 'Different employee', avatarUrl: secondPhoto }],
    ]);
    const teachers = buildSalesScheduleTeacherOptions(
      [{ id: 1, name: 'Group', teacherId: 3, teacherName: 'Linked teacher', teacherUserId: 44 }],
      [{ id: 2, groupId: 1, teacherId: 3, teacherName: 'Linked teacher', scheduledAt: '2030-01-15T10:00:00Z' }],
    );
    expect(teachers).toEqual([{ id: 3, name: 'Linked teacher', userId: 44 }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
    const { container } = render(<QueryClientProvider client={client}><EmployeeIdentityContext.Provider value={identities}>
      <SalesScheduleTeacherFilter teachers={teachers} selectedTeacherIds={new Set([3])} eventCounts={new Map()} onToggle={vi.fn()} onClear={vi.fn()} />
      <DemoLessonDetailsDialog open onOpenChange={vi.fn()} demo={{ id: 5, courseId: 1, schoolId: 1,
        teacherId: 3, teacherUserId: 44, teacherName: 'Linked teacher', scheduledAt: '2030-01-15T10:00:00Z',
        durationMinutes: 60, format: 'online', status: 'scheduled', participants: [] }} />
    </EmployeeIdentityContext.Provider></QueryClientProvider>);
    await waitFor(() => {
      expect(photos(document.body).filter((src) => src === firstPhoto)).toHaveLength(2);
      expect(photos(document.body)).not.toContain(secondPhoto);
    });
    expect(container.textContent).not.toContain('Different employee');
  });

  it('shows employee photos in both the selected manager and the keyboard-accessible choices', async () => {
    const onChange = vi.fn();
    const { container } = render(<EmployeeIdentityContext.Provider value={directory()}>
      <SalesOverviewEmployeeFilter value="7" managers={[{ id: 7, fullName: 'Shared employee' }, { id: 8, fullName: 'Other employee' }]} canViewAllManagers onChange={onChange} />
    </EmployeeIdentityContext.Provider>);
    const user = userEvent.setup();
    await waitFor(() => expect(photos(container)).toEqual([firstPhoto]));
    await user.click(screen.getByRole('combobox', { name: i18n.t('salesOverviewManager') }));
    expect(screen.getByRole('option', { name: i18n.t('allManagers') })).toBeTruthy();
    const options = screen.getAllByRole('option');
    const second = options.find((option) => option.getAttribute('data-state') === 'unchecked' && option.textContent?.includes('Shared employee'))!;
    await waitFor(() => expect(second.querySelector('img')?.getAttribute('src')).toBe(secondPhoto));
    await user.click(second);
    expect(onChange).toHaveBeenCalledWith('8');
  });

  it('keeps the own employee selector disabled when choosing other managers is not permitted', async () => {
    const onChange = vi.fn();
    render(<EmployeeIdentityContext.Provider value={directory()}>
      <SalesOverviewEmployeeFilter value="7" managers={[{ id: 7, fullName: 'Shared employee' }]} canViewAllManagers={false} onChange={onChange} />
    </EmployeeIdentityContext.Provider>);
    const trigger = screen.getByRole('combobox', { name: i18n.t('salesOverviewManager') }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    await userEvent.setup().click(trigger);
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByText('Shared employee')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Instagram outgoing message attribution', () => {
  it('uses the actual CRM sender, including another employee, instead of the Instagram account', async () => {
    const { container } = render(<EmployeeIdentityContext.Provider value={directory()}>
      <InstagramMessageAuthor sentBy={8} accountUsername="academy" accountPhotoUrl="https://cdn.example/instagram.jpg" />
    </EmployeeIdentityContext.Provider>);
    expect(screen.getByText('Shared employee')).toBeTruthy();
    expect(screen.queryByText('@academy')).toBeNull();
    await waitFor(() => expect(photos(container)).toEqual([secondPhoto]));
  });

  it('uses the Instagram account identity for externally sent messages', async () => {
    const { container } = render(<EmployeeIdentityContext.Provider value={directory()}>
      <InstagramMessageAuthor sentBy={null} accountUsername="academy" accountPhotoUrl="https://cdn.example/instagram.jpg" />
    </EmployeeIdentityContext.Provider>);
    expect(screen.getByText('@academy')).toBeTruthy();
    await waitFor(() => expect(photos(container)).toEqual(['/api/instagram/media-proxy?url=https%3A%2F%2Fcdn.example%2Finstagram.jpg']));
    expect(screen.queryByText('Shared employee')).toBeNull();
  });

  it('never mislabels an unresolved CRM sender as the Instagram account', () => {
    render(<InstagramMessageAuthor sentBy={999} accountUsername="academy" />);
    expect(screen.getByText(i18n.t('financeCenterEmployee'))).toBeTruthy();
    expect(screen.queryByText('@academy')).toBeNull();
  });
});
