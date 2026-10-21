// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { LessonStaff } from '../shared/contracts/lesson-staff';
import { LessonStaffSection } from '../client/src/features/lesson-staff/LessonStaffSection';
import { i18n } from '../client/src/lib/i18n';

const api = vi.hoisted(() => ({ get: vi.fn(), add: vi.fn(), remove: vi.fn() }));
vi.mock('../client/src/features/lesson-staff/api', () => ({
  lessonStaffApi: api, lessonStaffQueryKey: (id: number) => ['/api/academy/lessons', id, 'staff'],
}));
let client: QueryClient;
let staff: LessonStaff;
const pendingChange = vi.fn();
const main = { id: 4, fullName: 'Основной учитель' };
const assistants = [{ id: 5, fullName: 'Первый ассистент' }, { id: 6, fullName: 'Второй ассистент' }];
const button = (key: Parameters<typeof i18n.t>[0]) => screen.getByRole('button', { name: i18n.t(key) });
function mount(editable = true) {
  return render(<QueryClientProvider client={client}>
    <LessonStaffSection lessonId={17} editable={editable} onPendingChange={pendingChange} />
  </QueryClientProvider>);
}
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});
beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset());
  pendingChange.mockReset();
  i18n.setLanguage('ru');
  staff = { teacher: main, assistants: [], teachers: assistants };
  api.get.mockImplementation(async () => structuredClone(staff));
  api.add.mockImplementation(async (_id, teacherId) => {
    staff = { ...staff, assistants: [...staff.assistants, assistants.find(teacher => teacher.id === teacherId)!] };
    return structuredClone(staff);
  });
  api.remove.mockImplementation(async (_id, teacherId) => {
    staff = { ...staff, assistants: staff.assistants.filter(teacher => teacher.id !== teacherId) };
    return structuredClone(staff);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(async () => { cleanup(); client.clear(); await new Promise(resolve => setTimeout(resolve, 0)); });

it('adds several teachers to this lesson and restores their names after reopening', async () => {
  const view = mount();
  expect(await screen.findByText(main.fullName)).toBeTruthy();
  await userEvent.click(button('lessonAssistantAdd'));
  expect(screen.queryByRole('menuitemcheckbox', { name: main.fullName })).toBeNull();
  for (const teacher of assistants) {
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: teacher.fullName }));
    await waitFor(() => expect(screen.getByRole('menuitemcheckbox', { name: teacher.fullName }).getAttribute('aria-checked')).toBe('true'));
    expect(api.add).toHaveBeenCalledWith(17, teacher.id);
  }
  await userEvent.keyboard('{Escape}');
  expect(screen.getByText(main.fullName)).toBeTruthy();
  view.unmount(); client.clear();
  mount();
  expect(await screen.findByText(assistants[0].fullName)).toBeTruthy();
  expect(await screen.findByText(assistants[1].fullName)).toBeTruthy();
});

it('confirms removing an assistant and retains the assignment on cancel', async () => {
  staff = { ...staff, assistants: [assistants[0]] };
  mount();
  const remove = await screen.findByRole('button', { name: i18n.t('lessonAssistantRemoveName', { name: assistants[0].fullName }) });
  await userEvent.click(remove);
  let confirmation = await screen.findByRole('alertdialog');
  expect(api.remove).not.toHaveBeenCalled();
  await userEvent.click(within(confirmation).getByRole('button', { name: i18n.t('cancel') }));
  expect(screen.getByText(assistants[0].fullName)).toBeTruthy();
  await userEvent.click(remove);
  confirmation = await screen.findByRole('alertdialog');
  await userEvent.click(within(confirmation).getByRole('button', { name: i18n.t('lessonAssistantRemove') }));
  await waitFor(() => expect(screen.queryByText(assistants[0].fullName)).toBeNull());
  expect(api.remove).toHaveBeenCalledWith(17, 5);
  expect(screen.getByText(main.fullName)).toBeTruthy();
});

it('refreshes colleague assignments when reopening with a warm application cache', async () => {
  const view = mount();
  await screen.findByText(main.fullName);
  view.unmount();
  staff = { ...staff, assistants: [assistants[1]] };
  mount();
  expect(await screen.findByText(assistants[1].fullName)).toBeTruthy();
  expect(api.get).toHaveBeenCalledTimes(2);
});

it('keeps a failed removal in its confirmation and allows retry', async () => {
  staff = { ...staff, assistants: [assistants[0]] };
  api.remove.mockRejectedValueOnce(new Error(i18n.t('lessonStaffSaveFailed')));
  mount();
  await userEvent.click(await screen.findByRole('button', { name: i18n.t('lessonAssistantRemoveName', { name: assistants[0].fullName }) }));
  const confirmation = await screen.findByRole('alertdialog');
  await userEvent.click(within(confirmation).getByRole('button', { name: i18n.t('lessonAssistantRemove') }));
  expect(await within(confirmation).findByRole('alert')).toBeTruthy();
  expect(screen.getByText(main.fullName)).toBeTruthy();
  await userEvent.click(within(confirmation).getByRole('button', { name: i18n.t('lessonAssistantRemove') }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
});

it('blocks duplicate commands while an assignment is saving and reports pending to the lesson dialog', async () => {
  let finish!: (value: LessonStaff) => void;
  api.add.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mount();
  await userEvent.click(await screen.findByRole('button', { name: i18n.t('lessonAssistantAdd') }));
  const option = screen.getByRole('menuitemcheckbox', { name: assistants[0].fullName });
  await userEvent.click(option);
  await waitFor(() => expect(pendingChange).toHaveBeenLastCalledWith(true));
  expect(option.getAttribute('aria-disabled')).toBe('true');
  await userEvent.click(option);
  expect(api.add).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ...staff, assistants: [assistants[0]] }));
  await waitFor(() => expect(pendingChange).toHaveBeenLastCalledWith(false));
});

it('retries loading teacher names and shows readonly lesson staff without mutation controls', async () => {
  api.get.mockRejectedValueOnce(new Error('private database error'));
  mount(false);
  expect((await screen.findByRole('alert')).textContent).toBe(i18n.t('lessonStaffLoadFailed'));
  expect(screen.queryByText('private database error')).toBeNull();
  await userEvent.click(button('retry'));
  expect(await screen.findByText(main.fullName)).toBeTruthy();
  expect(screen.queryByRole('button', { name: i18n.t('lessonAssistantAdd') })).toBeNull();
});
