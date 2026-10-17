// @vitest-environment jsdom
import { zodResolver } from '@hookform/resolvers/zod';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CourseCurriculum } from '../shared/contracts/course-curriculum';
import type { PortalFileDto } from '../shared/contracts/portal-resources';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MIB } from '../shared/upload-policy';
import { CourseEditorDialog } from '../client/src/features/course-curriculum/CourseEditorDialog';
import { createCourseSchema, type CourseValues } from '../client/src/lib/academyResourceSchemas';
import { i18n } from '../client/src/lib/i18n';

const files = vi.hoisted(() => ({ upload: vi.fn(), status: vi.fn() }));
vi.mock('../client/src/features/course-curriculum/files-api', () => ({ courseMaterialFilesApi: files }));

const attachment = (id = 51, name = 'workbook.pdf'): PortalFileDto => ({
  id, name, mime: 'application/pdf', size: 24, state: 'ready', createdAt: '2026-10-18T00:00:00.000Z',
  downloadUrl: `/api/academy/course-material-files/${id}/download`, rejectionCode: null,
});
const reference = ({ id, name, mime, size }: PortalFileDto) => ({ id, name, mime, size });
const program = (): CourseCurriculum => ({
  version: 1,
  blocks: [
    { id: 'first-block', title: 'First block', lessons: [
      { id: 'first-lesson', title: 'First lesson', materials: [
        { id: 'target-material', title: 'Workbook', type: 'file', content: 'https://academy.example/previous.pdf' },
        { id: 'other-material', title: 'Slides', type: 'file', content: 'https://academy.example/slides.pdf' },
      ] },
      { id: 'other-lesson', title: 'Second lesson', materials: [] },
    ] },
    { id: 'other-block', title: 'Second block', lessons: [{ id: 'third-lesson', title: 'Third lesson', materials: [] }] },
  ],
});

function Editor({ initialProgram = program(), onSubmit = vi.fn(), onClose = vi.fn() }: {
  initialProgram?: CourseCurriculum;
  onSubmit?: (values: CourseValues) => void;
  onClose?: (open: boolean) => void;
}) {
  const form = useForm<CourseValues>({
    resolver: zodResolver(createCourseSchema(key => i18n.t(key))),
    defaultValues: { name: 'Programming', ageCategory: '12+', description: '', basePriceUzs: 0, isActive: true, program: initialProgram },
  });
  return <CourseEditorDialog open onOpenChange={onClose} form={form} editing saving={false} onSubmit={onSubmit} />;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const fileInput = (name = 'Workbook') => within(screen.getByRole('region', { name })).getByLabelText(i18n.t('courseUploadMaterialFile'), { selector: 'input' });
const pick = (file: File, name = 'Workbook', confirmReplacement = true) => {
  fireEvent.change(fileInput(name), { target: { files: [file] } });
  const confirmation = screen.queryByRole('alertdialog');
  if (confirmation && confirmReplacement) {
    fireEvent.click(within(confirmation).getByRole('button', { name: i18n.t('courseReplaceMaterialFile') }));
  }
};
const selectedFile = () => new File(['%PDF-1.7 file contents'], 'workbook.pdf', { type: 'application/pdf' });

beforeEach(() => {
  vi.clearAllMocks(); i18n.setLanguage('en');
  files.upload.mockResolvedValue(attachment()); files.status.mockResolvedValue(attachment());
  for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView']) {
    Object.defineProperty(Element.prototype, method, { configurable: true, value: vi.fn() });
  }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('uploads a selected computer file, retains the material title and submits its private file reference', async () => {
  const saved = vi.fn();
  render(<Editor onSubmit={saved} />);
  const file = selectedFile();
  pick(file);
  await waitFor(() => expect(files.upload).toHaveBeenCalledOnce());
  expect(files.upload.mock.calls[0][0]).toBe(file);
  expect(files.upload.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  await screen.findByText('workbook.pdf');
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(saved.mock.calls[0][0].program.blocks[0].lessons[0].materials[0]).toEqual({
    id: 'target-material', title: 'Workbook', type: 'file', content: '', file: reference(attachment()),
  });
});

it('fills an empty material title from the selected filename', async () => {
  const initial = program(); initial.blocks[0].lessons[0].materials[0].title = '';
  const saved = vi.fn();
  render(<Editor initialProgram={initial} onSubmit={saved} />);
  pick(selectedFile(), i18n.t('courseMaterialNumber', { number: 1 }));
  await waitFor(() => expect(screen.getByRole('region', { name: 'workbook.pdf' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(saved.mock.calls[0][0].program.blocks[0].lessons[0].materials[0].title).toBe('workbook.pdf');
});

it('accepts a computer file dropped onto the upload field', async () => {
  const saved = vi.fn();
  render(<Editor onSubmit={saved} />);
  const file = selectedFile();
  fireEvent.drop(fileInput().closest('div')!, { dataTransfer: { files: [file] } });
  await screen.findByText('workbook.pdf');
  expect(files.upload.mock.calls[0][0]).toBe(file);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(saved.mock.calls[0][0].program.blocks[0].lessons[0].materials[0].file).toEqual(reference(attachment()));
});

it('keeps the previous file after upload failure and retries the same selected file', async () => {
  const initial = program();
  initial.blocks[0].lessons[0].materials[0] = { ...initial.blocks[0].lessons[0].materials[0], content: '', file: reference(attachment(40, 'previous.pdf')) };
  files.upload.mockRejectedValueOnce(new Error('courseFileUploadFailed'));
  const saved = vi.fn();
  render(<Editor initialProgram={initial} onSubmit={saved} />);
  const file = selectedFile();
  pick(file);
  expect(await screen.findByText(i18n.t('courseFileUploadFailed'))).toBeTruthy();
  expect(screen.getByText('previous.pdf')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(saved.mock.calls[0][0].program.blocks[0].lessons[0].materials[0].file).toEqual(reference(attachment(40, 'previous.pdf')));
  fireEvent.click(within(screen.getByRole('region', { name: 'Workbook' })).getByRole('button', { name: i18n.t('retry') }));
  await screen.findByText('workbook.pdf');
  expect(files.upload).toHaveBeenCalledTimes(2);
  expect(files.upload.mock.calls[1][0]).toBe(file);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  expect(saved.mock.calls[1][0].program.blocks[0].lessons[0].materials[0].file).toEqual(reference(attachment()));
});

it('rejects a file over the shared size limit without uploading or replacing the existing material', async () => {
  const oversized = selectedFile(); Object.defineProperty(oversized, 'size', { value: MAX_UPLOAD_BYTES + 1 });
  const saved = vi.fn();
  render(<Editor onSubmit={saved} />);
  pick(oversized);
  expect(await screen.findByText(i18n.t('courseFileTooLarge', { size: MAX_UPLOAD_MIB }))).toBeTruthy();
  expect(files.upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(saved.mock.calls[0][0].program.blocks[0].lessons[0].materials[0].content).toBe('https://academy.example/previous.pdf');
});

it('waits for a checking file to become ready before attaching it and allowing course save', async () => {
  vi.useFakeTimers();
  files.upload.mockResolvedValueOnce({ ...attachment(), state: 'checking', downloadUrl: null });
  const saved = vi.fn();
  render(<Editor onSubmit={saved} />);
  pick(selectedFile());
  await act(async () => { await Promise.resolve(); });
  expect((screen.getByRole('button', { name: i18n.t('save') }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(files.status).toHaveBeenCalledWith(51, expect.any(AbortSignal));
  expect(screen.getByText('workbook.pdf')).toBeTruthy();
  expect((screen.getByRole('button', { name: i18n.t('save') }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await act(async () => { await Promise.resolve(); });
  expect(saved).toHaveBeenCalledOnce();
});

it('preserves the previous file when server inspection rejects the uploaded file', async () => {
  files.upload.mockResolvedValueOnce({ ...attachment(), state: 'rejected', downloadUrl: null, rejectionCode: 'portalFileTypeUnsupported' });
  const saved = vi.fn();
  render(<Editor onSubmit={saved} />);
  pick(selectedFile());
  expect(await screen.findByText(i18n.t('courseFileUnsupported'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(saved.mock.calls[0][0].program.blocks[0].lessons[0].materials[0].content).toBe('https://academy.example/previous.pdf');
});

it('requires confirmation before replacing an attached file and preserves the attachment when cancelled', async () => {
  const initial = program();
  initial.blocks[0].lessons[0].materials[0] = { ...initial.blocks[0].lessons[0].materials[0], content: '', file: reference(attachment(40, 'previous.pdf')) };
  const saved = vi.fn();
  render(<Editor initialProgram={initial} onSubmit={saved} />);
  pick(selectedFile(), 'Workbook', false);
  const confirmation = screen.getByRole('alertdialog', { name: i18n.t('courseReplaceMaterialFile') });
  expect(files.upload).not.toHaveBeenCalled();
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n.t('cancel') }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(saved.mock.calls[0][0].program.blocks[0].lessons[0].materials[0].file).toEqual(reference(attachment(40, 'previous.pdf')));
});

it('requires confirmation before changing an attached file into a text material', async () => {
  const initial = program();
  initial.blocks[0].lessons[0].materials[0] = { ...initial.blocks[0].lessons[0].materials[0], content: '', file: reference(attachment(40, 'previous.pdf')) };
  const saved = vi.fn(); const user = userEvent.setup();
  render(<Editor initialProgram={initial} onSubmit={saved} />);
  const target = () => within(screen.getByRole('region', { name: 'Workbook' }));
  await user.click(target().getByRole('combobox'));
  await user.click(screen.getByRole('option', { name: i18n.t('courseMaterialText') }));
  fireEvent.click(within(screen.getByRole('alertdialog', { name: i18n.t('courseRemoveMaterialFile') })).getByRole('button', { name: i18n.t('cancel') }));
  expect(screen.getByRole('link', { name: 'previous.pdf' })).toBeTruthy();
  await user.click(target().getByRole('combobox'));
  await user.click(screen.getByRole('option', { name: i18n.t('courseMaterialText') }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('courseRemoveMaterialFile') }));
  expect(screen.queryByRole('link', { name: 'previous.pdf' })).toBeNull();
  fireEvent.change(target().getByLabelText(i18n.t('courseMaterialContent'), { exact: false }), { target: { value: 'New lesson notes' } });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const material = saved.mock.calls[0][0].program.blocks[0].lessons[0].materials[0];
  expect(material.file).toBeUndefined();
  expect(material).toMatchObject({ id: 'target-material', type: 'text', content: 'New lesson notes' });
});

it.each(['block', 'lesson', 'material'] as const)('applies a late upload to the same material after %s reordering', async (kind) => {
  const pending = deferred<PortalFileDto>(); files.upload.mockReturnValueOnce(pending.promise);
  const saved = vi.fn();
  render(<Editor onSubmit={saved} />);
  pick(selectedFile());
  await waitFor(() => expect(files.upload).toHaveBeenCalledOnce());
  const label = kind === 'block' ? 'First block' : kind === 'lesson' ? 'First lesson' : 'Workbook';
  fireEvent.click(screen.getByRole('button', { name: `${i18n.t('moveDown')}: ${label}` }));
  await act(async () => pending.resolve(attachment()));
  await screen.findByText('workbook.pdf');
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const materials = saved.mock.calls[0][0].program.blocks.flatMap((block: CourseCurriculum['blocks'][number]) => block.lessons.flatMap(lesson => lesson.materials));
  expect(materials.find((material: { id: string }) => material.id === 'target-material').file).toEqual(reference(attachment()));
  expect(materials.find((material: { id: string }) => material.id === 'other-material').content).toBe('https://academy.example/slides.pdf');
});

it.each(['block', 'lesson', 'material'] as const)('ignores a late upload after its containing %s is deleted', async (kind) => {
  const pending = deferred<PortalFileDto>(); files.upload.mockReturnValueOnce(pending.promise);
  const saved = vi.fn();
  render(<Editor onSubmit={saved} />);
  pick(selectedFile());
  await waitFor(() => expect(files.upload).toHaveBeenCalledOnce());
  const signal = files.upload.mock.calls[0][1] as AbortSignal;
  const label = kind === 'block' ? 'First block' : kind === 'lesson' ? 'First lesson' : 'Workbook';
  fireEvent.click(screen.getByRole('button', { name: `${i18n.t('delete')}: ${label}` }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('delete') }));
  await waitFor(() => expect(signal.aborted).toBe(true));
  await act(async () => pending.resolve(attachment()));
  expect(screen.queryByText('workbook.pdf')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(JSON.stringify(saved.mock.calls[0][0].program)).not.toContain('target-material');
  expect(JSON.stringify(saved.mock.calls[0][0].program)).not.toContain('workbook.pdf');
});

it('blocks save, submit and dialog close until every pending file upload has completed', async () => {
  const first = deferred<PortalFileDto>(); const second = deferred<PortalFileDto>();
  files.upload.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const saved = vi.fn(); const closed = vi.fn();
  render(<Editor onSubmit={saved} onClose={closed} />);
  pick(selectedFile()); pick(new File(['slides'], 'slides.pdf', { type: 'application/pdf' }), 'Slides');
  await waitFor(() => expect(files.upload).toHaveBeenCalledTimes(2));
  expect((screen.getByRole('button', { name: i18n.t('save') }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(saved).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled();
  await act(async () => first.resolve(attachment()));
  expect((screen.getByRole('button', { name: i18n.t('save') }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => second.resolve(attachment(52, 'slides.pdf')));
  await waitFor(() => expect((screen.getByRole('button', { name: i18n.t('save') }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
});

it('aborts an unfinished upload on unmount and ignores its result in a newly opened editor', async () => {
  const pending = deferred<PortalFileDto>(); files.upload.mockReturnValueOnce(pending.promise);
  const view = render(<Editor />);
  pick(selectedFile());
  await waitFor(() => expect(files.upload).toHaveBeenCalledOnce());
  const signal = files.upload.mock.calls[0][1] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  const saved = vi.fn(); render(<Editor onSubmit={saved} />);
  await act(async () => pending.resolve(attachment()));
  expect(screen.queryByText('workbook.pdf')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(saved.mock.calls[0][0].program.blocks[0].lessons[0].materials[0]).toEqual(program().blocks[0].lessons[0].materials[0]);
});

it('cancels an upload, restores course save and ignores the cancelled request finishing late', async () => {
  const pending = deferred<PortalFileDto>(); files.upload.mockReturnValueOnce(pending.promise);
  const saved = vi.fn();
  render(<Editor onSubmit={saved} />);
  pick(selectedFile());
  await waitFor(() => expect(files.upload).toHaveBeenCalledOnce());
  const signal = files.upload.mock.calls[0][1] as AbortSignal;
  fireEvent.click(within(screen.getByRole('region', { name: 'Workbook' })).getByRole('button', { name: i18n.t('cancel') }));
  expect(signal.aborted).toBe(true);
  expect((screen.getByRole('button', { name: i18n.t('save') }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => pending.resolve(attachment()));
  expect(screen.queryByText('workbook.pdf')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(saved.mock.calls[0][0].program.blocks[0].lessons[0].materials[0]).toEqual(program().blocks[0].lessons[0].materials[0]);
});

it('shows the localized lesson error for six attached files and accepts five after a confirmed removal', async () => {
  i18n.setLanguage('ru');
  const initial = program();
  initial.blocks[0].lessons[0].materials = Array.from({ length: 6 }, (_, index) => ({
    id: `uploaded-material-${index + 1}`, title: `Файл ${index + 1}`, type: 'file', content: '',
    file: reference(attachment(100 + index, `workbook-${index + 1}.pdf`)),
  }));
  const saved = vi.fn();
  render(<Editor initialProgram={initial} onSubmit={saved} />);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  const lesson = within(screen.getByRole('region', { name: 'First lesson' }));
  expect(await lesson.findByRole('alert')).toHaveProperty('textContent', i18n.t('courseLessonTooManyFiles'));
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(lesson.getByRole('button', { name: `${i18n.t('delete')}: Файл 6` }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('delete') }));
  await waitFor(() => expect(lesson.queryByText(i18n.t('courseLessonTooManyFiles'))).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(saved.mock.calls[0][0].program.blocks[0].lessons[0].materials.map((material: { file: { id: number } }) => material.file.id))
    .toEqual([100, 101, 102, 103, 104]);
});
