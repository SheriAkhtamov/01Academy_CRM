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

const mocks = vi.hoisted(() => ({ api: vi.fn(), upload: vi.fn(), status: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('../client/src/features/course-curriculum/files-api', () => ({ courseMaterialFilesApi: { upload: mocks.upload, status: mocks.status } }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, module: 'administration', modules: ['administration'] } }) }));

let client: QueryClient;
let courses: Course[];
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); i18n.setLanguage('ru'); courses = [];
  const uploaded = { id: 84, name: 'workbook.pdf', mime: 'application/pdf', size: 29, state: 'ready',
    downloadUrl: '/api/academy/course-material-files/84/download', rejectionCode: null, createdAt: '2026-10-18T00:00:00.000Z' };
  mocks.upload.mockResolvedValue(uploaded); mocks.status.mockResolvedValue(uploaded);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  for (const method of ['scrollIntoView', 'hasPointerCapture', 'setPointerCapture', 'releasePointerCapture']) {
    Object.defineProperty(Element.prototype, method, { configurable: true, value: vi.fn() });
  }
  client = new QueryClient({ defaultOptions: { queries: {
    retry: false, gcTime: 0, queryFn: async ({ queryKey }) => queryKey[0] === '/api/academy/configuration'
      ? { courses, schools: [], rooms: [], groups: [], statuses: [], teachers: [] } : [],
  } } });
  mocks.api.mockImplementation(async (method, _path, payload) => {
    const saved: Course = { basePriceUzs: 0, ...courses.find(course => course.id === 7), id: 7, ...payload };
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
  expect(mocks.api.mock.calls[0][2]).not.toHaveProperty('basePriceUzs');
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
  courses = [{ id: 7, name: 'Legacy course', slug: 'legacy-course', ageCategory: '12+', basePriceUzs: 1_500_000, isActive: true,
    program: [{ lessonNumber: 1, topic: 'Existing lesson', description: 'Existing notes' }] }];
  const user = mount();
  await user.click(await screen.findByRole('button', { name: i18n.t('edit') }));
  const dialog = within(screen.getByRole('dialog', { name: i18n.t('editCourse') }));
  expect(screen.queryByRole('columnheader', { name: /базовая цена/i })).toBeNull();
  expect(dialog.queryByLabelText(/базовая цена/i)).toBeNull();
  expect((dialog.getByLabelText(i18n.t('courseBlockTitle'), { exact: false }) as HTMLInputElement).value).toBe(i18n.t('courseBlockNumber', { number: 1 }));
  expect((dialog.getByLabelText(i18n.t('courseMaterialContent'), { exact: false }) as HTMLTextAreaElement).value).toBe('Existing notes');
  await user.click(dialog.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledOnce());
  expect(mocks.api.mock.calls[0][2]).not.toHaveProperty('basePriceUzs');
  expect(courses[0].basePriceUzs).toBe(1_500_000);
  expect(flattenCourseCurriculum(mocks.api.mock.calls[0][2].program)).toMatchObject([{ id: 'legacy-lesson-1', title: 'Existing lesson', materials: [{ content: 'Existing notes' }] }]);
});

it('saves an uploaded computer file in the course and restores its filename and download link on reopen', async () => {
  courses = [{ id: 7, name: 'Course with files', slug: 'course-with-files', ageCategory: '12+', basePriceUzs: 0, isActive: true,
    program: { version: 1, blocks: [{ id: 'block-files', title: 'Documents', lessons: [{ id: 'lesson-files', title: 'Workbook lesson', materials: [
      { id: 'material-files', type: 'file', title: 'Workbook material', content: 'https://academy.example/previous.pdf' },
    ] }] }] } }];
  const user = mount();
  await user.click(await screen.findByRole('button', { name: i18n.t('edit') }));
  const file = new File(['%PDF-1.7 sample file contents'], 'workbook.pdf', { type: 'application/pdf' });
  const material = screen.getByRole('region', { name: 'Workbook material' });
  fireEvent.change(within(material).getByLabelText(i18n.t('courseUploadMaterialFile'), { selector: 'input' }), { target: { files: [file] } });
  await screen.findByText('workbook.pdf');
  expect(mocks.upload.mock.calls[0][0]).toBe(file);
  await user.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('PATCH', '/api/academy/courses/7/with-teachers', expect.objectContaining({
    program: { version: 1, blocks: [expect.objectContaining({ lessons: [expect.objectContaining({ materials: [{
      id: 'material-files', title: 'Workbook material', type: 'file', content: '', file: { id: 84, name: 'workbook.pdf', mime: 'application/pdf', size: 29 },
    }] })] })] },
  })));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await user.click(screen.getByRole('button', { name: i18n.t('edit') }));
  const filename = screen.getByText('workbook.pdf');
  expect(filename.closest('a')?.getAttribute('href')).toBe('/api/academy/course-material-files/84/download');
  expect(flattenCourseCurriculum(courses[0].program)[0].materials[0]).toMatchObject({ id: 'material-files', file: { id: 84, name: 'workbook.pdf' } });
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
