// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { StudentDetailDialog } from '../client/src/components/ux/StudentDetailDialog';
import { CreateTaskDialog } from '../client/src/components/ux/board/CreateTaskDialog';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation, requestNavigation } from '../client/src/lib/navigationGuard';

vi.mock('../client/src/features/students/api', () => ({ studentsApi: { profile: vi.fn().mockImplementation(() => new Promise(() => {})) } }));
vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({ useOnlinePbxCall: () => ({ isPending: false, startCall: vi.fn() }) }));
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
});
beforeEach(() => { i18n.setLanguage('en'); allowNavigation(() => history.replaceState(null, '', '/tasks')); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const student = { id: 1, studentName: 'Student', contactName: 'Parent', status: 'studying', exitReason: '', attendancePercent: 80, progressPercent: 40 };
const studentQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const sheet = (record: typeof student, onClose = vi.fn(), save = vi.fn(), extras = {}) => <QueryClientProvider client={studentQueryClient}><StudentDetailDialog student={record} open onOpenChange={onClose} onUpdateStatus={save} dateTime={() => ''} {...extras} /></QueryClientProvider>;
const changeStatus = () => fireEvent.change(screen.getByRole('combobox', { name: i18n.t('status') }), { target: { value: 'paused' } });

it('protects a student status draft on close and allows cancellation or explicit discard', () => {
  const onClose = vi.fn(); render(sheet(student, onClose)); changeStatus();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('close') }));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('keepEditing') }));
  expect((screen.getByRole('combobox', { name: i18n.t('status') }) as HTMLSelectElement).value).toBe('paused');
  fireEvent.click(screen.getByRole('button', { name: i18n.t('close') }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('discardChanges') }));
  expect(onClose).toHaveBeenCalledWith(false);
});

it('retains local changes during an external status update and requires a choice before saving', () => {
  const save = vi.fn(); const view = render(sheet(student, vi.fn(), save)); changeStatus();
  view.rerender(sheet({ ...student, status: 'completed' }, vi.fn(), save));
  expect((screen.getByRole('combobox', { name: i18n.t('status') }) as HTMLSelectElement).value).toBe('paused');
  expect(screen.getByRole('button', { name: i18n.t('studentSaveStatus') }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('studentKeepChanges') }));
  expect(screen.queryByText(i18n.t('studentChangesDetected'))).toBeNull();
  expect((screen.getByRole('combobox', { name: i18n.t('status') }) as HTMLSelectElement).value).toBe('paused');
  expect(save).not.toHaveBeenCalled();
});

it('confirms discarding the student draft before adopting updated details', () => {
  const view = render(sheet(student)); changeStatus();
  view.rerender(sheet({ ...student, status: 'completed' }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('studentAcceptChanges') }));
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('discardChanges') }));
  expect((screen.getByRole('combobox', { name: i18n.t('status') }) as HTMLSelectElement).value).toBe('completed');
});

it('names the group picker for assistive technology', async () => {
  render(sheet(student, vi.fn(), vi.fn(), { initialTab: 'learning', onAddGroup: vi.fn(), data: { groups: [{ id: 5, name: 'Group', status: 'open' }] } }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: i18n.t('chooseGroup') })).toBeTruthy());
});

it('protects task creation against reload and in-app navigation', () => {
  render(<QueryClientProvider client={new QueryClient()}><CreateTaskDialog open onOpenChange={vi.fn()} users={[]} currentUser={{ id: 1, fullName: 'Auditor', position: null, module: 'sales' }} canAssignUsers={false} /></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText(/Task title/i), { target: { value: 'Unsaved task' } });
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  const navigate = vi.fn(); act(() => requestNavigation(navigate));
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('keepEditing') }));
  expect((screen.getByLabelText(/Task title/i) as HTMLInputElement).value).toBe('Unsaved task');
  act(() => requestNavigation(navigate));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('discardChanges') }));
  expect(navigate).toHaveBeenCalledOnce();
});
