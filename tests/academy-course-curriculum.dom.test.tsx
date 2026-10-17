// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AcademySettings from '../client/src/pages/academy-settings';
import type { Course } from '../client/src/features/academy-resources/api';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';
import { flattenCourseCurriculum } from '../shared/contracts/course-curriculum';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, module: 'administration', modules: ['administration'] } }) }));

let client: QueryClient;
let courses: Course[];
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); i18n.setLanguage('ru'); courses = [];
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  for (const method of ['scrollIntoView', 'hasPointerCapture', 'setPointerCapture', 'releasePointerCapture']) {
    Object.defineProperty(Element.prototype, method, { configurable: true, value: vi.fn() });
  }
  client = new QueryClient({ defaultOptions: { queries: {
    retry: false, gcTime: 0, queryFn: async ({ queryKey }) => queryKey[0] === '/api/academy/configuration'
      ? { courses, schools: [], rooms: [], groups: [], statuses: [], teachers: [] } : [],
  } } });
  mocks.api.mockImplementation(async (method, _path, payload) => {
    const saved: Course = { ...courses.find(course => course.id === 7), id: 7, ...payload };
    courses = method === 'POST' ? [...courses, saved] : courses.map(course => course.id === saved.id ? saved : course);
    return saved;
  });
});
afterEach(async () => {
  cleanup(); client.clear();
  await new Promise(resolve => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

function mount() {
  allowNavigation(() => history.replaceState(null, '', '/admin/academy-settings?tab=courses'));
  render(<QueryClientProvider client={client}><AcademySettings /></QueryClientProvider>);
  return userEvent.setup();
}

it('saves the curriculum through course creation, reloads it for editing and preserves lesson identities on reopen', async () => {
  const user = mount();
  await user.click(await screen.findByRole('button', { name: i18n.t('addCourse') }));
  let dialog = within(screen.getByRole('dialog', { name: i18n.t('addCourse') }));
  fireEvent.change(dialog.getByLabelText(i18n.t('courseName'), { exact: false }), { target: { value: 'Программирование' } });
  fireEvent.change(dialog.getByLabelText(i18n.t('ageCategory'), { exact: false }), { target: { value: '12+' } });
  await user.click(dialog.getByRole('button', { name: i18n.t('courseAddBlock') }));
  fireEvent.change(dialog.getByLabelText(i18n.t('courseBlockTitle'), { exact: false }), { target: { value: 'Основы' } });
  fireEvent.change(dialog.getByLabelText(i18n.t('courseLessonTitle'), { exact: false }), { target: { value: 'Переменные' } });
  await user.click(dialog.getByRole('button', { name: i18n.t('courseAddMaterial') }));
  fireEvent.change(dialog.getByLabelText(i18n.t('courseMaterialTitle'), { exact: false }), { target: { value: 'Конспект' } });
  fireEvent.change(dialog.getByLabelText(i18n.t('courseMaterialContent'), { exact: false }), { target: { value: 'Учебный материал' } });
  await user.click(dialog.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('POST', '/api/academy/courses/with-teachers', expect.objectContaining({
    name: 'Программирование', program: { version: 1, blocks: [expect.objectContaining({ title: 'Основы', lessons: [expect.objectContaining({ title: 'Переменные' })] })] },
  })));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await screen.findByText('Программирование');
  const beforeEdit = flattenCourseCurriculum(courses[0].program)[0];
  await user.click(screen.getByRole('button', { name: i18n.t('edit') }));
  dialog = within(screen.getByRole('dialog', { name: i18n.t('editCourse') }));
  expect((dialog.getByLabelText(i18n.t('courseMaterialContent'), { exact: false }) as HTMLTextAreaElement).value).toBe('Учебный материал');
  fireEvent.change(dialog.getByLabelText(i18n.t('courseLessonTitle'), { exact: false }), { target: { value: 'Переменные и типы' } });
  await user.click(dialog.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('PATCH', '/api/academy/courses/7/with-teachers', expect.objectContaining({
    program: { version: 1, blocks: [expect.objectContaining({ lessons: [expect.objectContaining({ id: beforeEdit.id, title: 'Переменные и типы', materials: beforeEdit.materials })] })] },
  })));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await user.click(screen.getByRole('button', { name: i18n.t('edit') }));
  expect((screen.getByLabelText(i18n.t('courseLessonTitle'), { exact: false }) as HTMLInputElement).value).toBe('Переменные и типы');
  expect(flattenCourseCurriculum(courses[0].program)[0].id).toBe(beforeEdit.id);
});

it('opens a legacy course program with stable lesson IDs and retains its existing lesson content when saving', async () => {
  courses = [{ id: 7, name: 'Legacy course', slug: 'legacy-course', ageCategory: '12+', basePriceUzs: 0, isActive: true,
    program: [{ lessonNumber: 1, topic: 'Existing lesson', description: 'Existing notes' }] }];
  const user = mount();
  await user.click(await screen.findByRole('button', { name: i18n.t('edit') }));
  const dialog = within(screen.getByRole('dialog', { name: i18n.t('editCourse') }));
  expect((dialog.getByLabelText(i18n.t('courseBlockTitle'), { exact: false }) as HTMLInputElement).value).toBe(i18n.t('courseBlockNumber', { number: 1 }));
  expect((dialog.getByLabelText(i18n.t('courseMaterialContent'), { exact: false }) as HTMLTextAreaElement).value).toBe('Existing notes');
  await user.click(dialog.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledOnce());
  expect(flattenCourseCurriculum(mocks.api.mock.calls[0][2].program)).toMatchObject([{ id: 'legacy-lesson-1', title: 'Existing lesson', materials: [{ content: 'Existing notes' }] }]);
});

it.each([
  { program: [{ lessonNumber: 1, topic: 'Preserved lesson', description: 'Preserved notes' }, { lessonNumber: 2 }] },
  { program: { version: 1, blocks: [{ id: 'block', title: 'Preserved block', lessons: [] }] } },
])('preserves malformed stored curriculum while saving course metadata', async ({ program }) => {
  courses = [{ id: 7, name: 'Existing course', slug: 'existing-course', ageCategory: '12+', basePriceUzs: 0, isActive: true, program }];
  const user = mount();
  await user.click(await screen.findByRole('button', { name: i18n.t('edit') }));
  const dialog = within(screen.getByRole('dialog', { name: i18n.t('editCourse') }));
  expect(dialog.getByRole('alert').textContent).toBe(i18n.t('courseCurriculumLoadFailed'));
  expect(dialog.queryByRole('button', { name: i18n.t('courseAddBlock') })).toBeNull();
  fireEvent.change(dialog.getByLabelText(i18n.t('courseName'), { exact: false }), { target: { value: 'Updated course' } });
  await user.click(dialog.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledOnce());
  expect(mocks.api.mock.calls[0][2]).not.toHaveProperty('program');
  expect(courses[0].program).toEqual(program);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await user.click(screen.getByRole('button', { name: i18n.t('edit') }));
  expect(screen.getByRole('alert').textContent).toBe(i18n.t('courseCurriculumLoadFailed'));
});
