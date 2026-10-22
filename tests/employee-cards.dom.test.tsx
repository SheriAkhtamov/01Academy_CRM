// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { EmployeeCardProvider } from '../client/src/features/employees/EmployeeCardProvider';
import { EmployeeIdentity, EmployeeAvatar } from '../client/src/components/ux/EmployeeIdentity';
import { LessonStaffSection } from '../client/src/features/lesson-staff/LessonStaffSection';
import { CommandPalette } from '../client/src/components/ux/CommandPalette';
import { Dialog, DialogContent, DialogTitle } from '../client/src/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../client/src/components/ui/select';
import { Button } from '../client/src/components/ui/button';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({ api: vi.fn(), user: { id: 7, module: 'teacher', modules: ['teacher'] } as any }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
const profile = { id: 20, fullName: 'Sam Employee', avatarUrl: null, position: 'Teacher', modules: ['teacher'], phoneNumbers: ['+998901234567'], isArchived: false };
let client: QueryClient;
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
beforeEach(() => {
  i18n.setLanguage('en');
  mocks.user = { id: 7, module: 'teacher', modules: ['teacher'] };
  mocks.api.mockReset().mockImplementation(async (_method, url) => {
    if (url === '/api/users/20/profile') return profile;
    if (url === '/api/users/21/profile') return { ...profile, id: 21, fullName: 'Alex Employee' };
    throw new Error(`Unexpected request: ${url}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); });
const label = (name = profile.fullName) => i18n.t('openEmployeeCardName', { name });
const card = () => screen.findByRole('dialog', { name: i18n.t('employeeCard') });
function mount(children: React.ReactNode) {
  const location = memoryLocation({ path: '/teacher-module/attendance', record: true });
  const tree = () => <QueryClientProvider client={client}><Router hook={location.hook}><EmployeeCardProvider>{children}</EmployeeCardProvider></Router></QueryClientProvider>;
  return { ...render(tree()), tree, location };
}

it('opens the correct employee from a name and avatar, supports the keyboard and restores focus', async () => {
  mount(<><EmployeeIdentity userId={20} name={profile.fullName} /><EmployeeAvatar userId={21} name="Alex Employee" /></>);
  expect(mocks.api).not.toHaveBeenCalled();
  const person = screen.getByRole('button', { name: label() });
  await userEvent.click(within(person).getByText(profile.fullName));
  let dialog = await card();
  expect(await within(dialog).findByText(profile.position, { selector: 'dd' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: profile.phoneNumbers[0] }).getAttribute('href')).toBe(`tel:${profile.phoneNumbers[0]}`);
  expect(within(dialog).queryByRole('button', { name: i18n.t('editUser') })).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('close') }));
  await waitFor(() => expect(document.activeElement).toBe(person));
  const avatar = screen.getByRole('button', { name: label('Alex Employee') });
  await userEvent.click(within(avatar).getByText('AE'));
  dialog = await card();
  expect(await within(dialog).findByText('Alex Employee')).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('close') }));
  person.focus();
  await userEvent.keyboard('{Enter}');
  expect(await within(await card()).findByText(profile.fullName)).toBeTruthy();
  expect(mocks.api).toHaveBeenCalledWith('GET', '/api/users/20/profile');
  expect(mocks.api).toHaveBeenCalledWith('GET', '/api/users/21/profile');
});

it('keeps the lesson draft and assistant choices intact while opening a colleague above both dialogs', async () => {
  mocks.api.mockImplementation(async (method, url) => {
    if (url === '/api/academy/lessons/17/staff') return { canManage: true, teacher: { id: 4, userId: 20, fullName: profile.fullName }, assistants: [], teachers: [{ id: 5, userId: 21, fullName: 'Alex Employee' }] };
    if (url === '/api/users/21/profile') return { ...profile, id: 21, fullName: 'Alex Employee' };
    if (method === 'POST') return { canManage: true, teacher: null, assistants: [{ id: 5, userId: 21, fullName: 'Alex Employee' }], teachers: [{ id: 5, userId: 21, fullName: 'Alex Employee' }] };
    throw new Error(url);
  });
  mount(<Dialog open><DialogContent aria-describedby={undefined}><DialogTitle>Lesson</DialogTitle><textarea aria-label="Lesson note" defaultValue="Draft note" /><LessonStaffSection lessonId={17} editable /></DialogContent></Dialog>);
  const lesson = screen.getByRole('dialog', { name: 'Lesson' });
  await within(lesson).findByText(profile.fullName);
  await userEvent.click(within(lesson).getByRole('button', { name: i18n.t('lessonAssistantAdd') }));
  await userEvent.click(await screen.findByRole('button', { name: label('Alex Employee') }));
  const dialog = await card();
  expect(await within(dialog).findByText('Alex Employee')).toBeTruthy();
  expect(mocks.api.mock.calls.some(([method]) => method === 'POST')).toBe(false);
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('close') }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n.t('employeeCard') })).toBeNull());
  expect(lesson.getAttribute('data-state')).toBe('open');
  expect((within(lesson).getByLabelText('Lesson note') as HTMLTextAreaElement).value).toBe('Draft note');
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Alex Employee' }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('POST', '/api/academy/lessons/17/assistants', { teacherId: 5 }));
});

it('preserves selection and primary button actions without nested profile buttons', async () => {
  const select = vi.fn(), primary = vi.fn(), row = vi.fn();
  const view = mount(<><Button onClick={primary}><EmployeeIdentity userId={20} name={profile.fullName} /></Button>
    <Select onValueChange={select}><SelectTrigger aria-label="Teacher"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="20"><EmployeeIdentity userId={20} name={profile.fullName} /></SelectItem></SelectContent></Select>
    <div onClick={row} role="presentation"><EmployeeIdentity userId={21} name="Alex Employee" /></div></>);
  expect(view.container.querySelector('button button')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /Sam Employee/ }));
  expect(primary).toHaveBeenCalledOnce();
  expect(mocks.api).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('combobox', { name: 'Teacher' }));
  await userEvent.click(await screen.findByRole('option', { name: profile.fullName }));
  expect(select).toHaveBeenCalledWith('20');
  expect(mocks.api).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: label('Alex Employee') }));
  expect(await card()).toBeTruthy();
  expect(row).not.toHaveBeenCalled();
});

it('clears the card on account changes and ignores a late response from the previous card', async () => {
  let finish!: (value: typeof profile) => void;
  mocks.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = mount(<EmployeeIdentity userId={20} name={profile.fullName} />);
  await userEvent.click(screen.getByRole('button', { name: label() }));
  await card();
  mocks.user = { id: 9, module: 'sales', modules: ['sales'] };
  view.rerender(view.tree());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await act(async () => finish(profile));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows a short failure state, retries and permits editing only for an administrator', async () => {
  mocks.user = { id: 7, module: 'administration', modules: ['administration'] };
  mocks.api.mockRejectedValueOnce(new Error('private database details'));
  const view = mount(<EmployeeIdentity userId={20} name={profile.fullName} />);
  await userEvent.click(screen.getByRole('button', { name: label() }));
  const dialog = await card();
  await within(dialog).findByText(i18n.t('employeeCardUnavailable'));
  expect(document.body.textContent).not.toContain('private database details');
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('retry') }));
  await userEvent.click(await within(dialog).findByRole('button', { name: i18n.t('editUser') }));
  await waitFor(() => expect(view.location.history.at(-1)).toBe('/employees?employee=20'));
});

it('opens employee search results as cards without leaving the current page', async () => {
  mocks.user = { id: 7, module: 'administration', modules: ['administration'] };
  mocks.api.mockImplementation(async (_method, url) => url.startsWith('/api/academy/search')
    ? { items: [{ id: 'user-20', userId: 20, entityType: 'user', title: profile.fullName, href: '/employees?employee=20' }], hasMore: false } : profile);
  function Search() { const [open, setOpen] = useState(true); return <CommandPalette open={open} onOpenChange={setOpen} />; }
  const view = mount(<Search />);
  await userEvent.type(screen.getByRole('combobox', { name: i18n.t('search') }), 'Sam');
  await userEvent.click(await screen.findByText(profile.fullName));
  expect(await within(await card()).findByText(profile.fullName)).toBeTruthy();
  expect(view.location.history.at(-1)).toBe('/teacher-module/attendance');
});
