// @vitest-environment jsdom
import { zodResolver } from '@hookform/resolvers/zod';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CourseCurriculum } from '../shared/contracts/course-curriculum';
import { CourseEditorDialog } from '../client/src/features/course-curriculum/CourseEditorDialog';
import { createCourseSchema, type CourseValues } from '../client/src/lib/academyResourceSchemas';
import { i18n } from '../client/src/lib/i18n';

const initialProgram: CourseCurriculum = {
  version: 1,
  blocks: [{
    id: 'block-one', title: 'Foundations', lessons: [
      { id: 'lesson-one', title: 'Variables', materials: [{ id: 'material-one', type: 'text', title: 'Notes', content: 'A variable stores a value.' }] },
      { id: 'lesson-two', title: 'Functions', materials: [] },
    ],
  }],
};

function Editor({ program = { version: 1, blocks: [] }, onSubmit = vi.fn(), editing = false, saving = false }: {
  program?: CourseCurriculum;
  onSubmit?: (values: CourseValues) => void;
  editing?: boolean;
  saving?: boolean;
}) {
  const form = useForm<CourseValues>({
    resolver: zodResolver(createCourseSchema(key => i18n.t(key))),
    defaultValues: { name: 'Programming', ageCategory: '12+', description: '', isActive: true, program },
  });
  return <CourseEditorDialog open onOpenChange={vi.fn()} form={form} editing={editing} saving={saving} onSubmit={onSubmit} />;
}

beforeEach(() => {
  i18n.setLanguage('en');
  for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView']) {
    Object.defineProperty(Element.prototype, method, { configurable: true, value: vi.fn() });
  }
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(cleanup);

it('creates named blocks and lessons with text and URL materials inside the course dialog', async () => {
  const saved = vi.fn();
  const user = userEvent.setup();
  render(<Editor onSubmit={saved} />);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('courseAddBlock') }));
  fireEvent.change(screen.getByLabelText(i18n.t('courseBlockTitle'), { exact: false }), { target: { value: 'Getting started' } });
  fireEvent.change(screen.getByLabelText(i18n.t('courseLessonTitle'), { exact: false }), { target: { value: 'Introduction' } });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('courseAddMaterial') }));
  fireEvent.change(screen.getByLabelText(i18n.t('courseMaterialTitle'), { exact: false }), { target: { value: 'Welcome' } });
  fireEvent.change(screen.getByLabelText(i18n.t('courseMaterialContent'), { exact: false }), { target: { value: 'Welcome to the course.' } });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('courseAddMaterial') }));
  const secondMaterial = screen.getByRole('region', { name: i18n.t('courseMaterialNumber', { number: 2 }) });
  fireEvent.change(within(secondMaterial).getByLabelText(i18n.t('courseMaterialTitle'), { exact: false }), { target: { value: 'Workbook' } });
  await user.click(within(secondMaterial).getByRole('combobox'));
  await user.click(screen.getByRole('option', { name: i18n.t('courseMaterialFile') }));
  fireEvent.change(within(secondMaterial).getByLabelText(i18n.t('courseMaterialUrl'), { exact: false }), { target: { value: 'https://academy.example/workbook.pdf' } });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const program = saved.mock.calls[0][0].program as CourseCurriculum;
  expect(program.blocks[0]).toMatchObject({ title: 'Getting started', lessons: [{ title: 'Introduction', materials: [
    { title: 'Welcome', type: 'text', content: 'Welcome to the course.' },
    { title: 'Workbook', type: 'file', content: 'https://academy.example/workbook.pdf' },
  ] }] });
  expect(new Set([program.blocks[0].id, program.blocks[0].lessons[0].id, ...program.blocks[0].lessons[0].materials.map(material => material.id)]).size).toBe(4);
  expect(screen.getByRole('dialog').contains(screen.getByRole('region', { name: i18n.t('courseCurriculum') }))).toBe(true);
});

it.each(['block', 'lesson', 'material'] as const)('requires confirmation before deleting an existing %s and its contents', async (kind) => {
  const saved = vi.fn();
  render(<Editor program={initialProgram} onSubmit={saved} />);
  const label = kind === 'block' ? 'Foundations' : kind === 'lesson' ? 'Variables' : 'Notes';
  fireEvent.click(screen.getByRole('button', { name: `${i18n.t('delete')}: ${label}` }));
  const confirmation = screen.getByRole('alertdialog');
  expect(confirmation.textContent).toContain(label);
  fireEvent.click(within(confirmation).getByRole('button', { name: i18n.t('cancel') }));
  expect(screen.getByRole('button', { name: `${i18n.t('delete')}: ${label}` })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: `${i18n.t('delete')}: ${label}` }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('delete') }));
  expect(screen.queryByRole('button', { name: `${i18n.t('delete')}: ${label}` })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const blocks = saved.mock.calls[0][0].program.blocks;
  if (kind === 'block') expect(blocks).toEqual([]);
  if (kind === 'lesson') expect(blocks[0].lessons.map((lesson: { id: string }) => lesson.id)).toEqual(['lesson-two']);
  if (kind === 'material') expect(blocks[0].lessons[0].materials).toEqual([]);
});

it('keeps stable lesson identities and their materials while changing lesson order', async () => {
  const saved = vi.fn();
  render(<Editor program={initialProgram} onSubmit={saved} />);
  fireEvent.click(screen.getByRole('button', { name: `${i18n.t('moveUp')}: Functions` }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(saved.mock.calls[0][0].program.blocks[0].lessons).toEqual([...initialProgram.blocks[0].lessons].reverse());
});

it('requires confirmation for unsaved items and validates the last lesson removed from a block', async () => {
  const saved = vi.fn();
  render(<Editor onSubmit={saved} />);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('courseAddBlock') }));
  fireEvent.change(screen.getByLabelText(i18n.t('courseBlockTitle'), { exact: false }), { target: { value: 'First block' } });
  fireEvent.click(screen.getByRole('button', { name: `${i18n.t('delete')}: ${i18n.t('courseLessonNumber', { number: 1 })}` }));
  expect(screen.getByLabelText(i18n.t('courseLessonTitle'), { exact: false })).toBeTruthy();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('delete') }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  expect(await screen.findByText(i18n.t('courseBlockLessonsRequired'))).toBeTruthy();
  expect(saved).not.toHaveBeenCalled();
});

it('shows localized nested validation and rejects unsafe material URLs', async () => {
  i18n.setLanguage('ru');
  const saved = vi.fn();
  render(<Editor program={{ ...initialProgram, blocks: [{ ...initialProgram.blocks[0], lessons: [{
    ...initialProgram.blocks[0].lessons[0], materials: [{ id: 'unsafe-material', title: 'Материал', type: 'link', content: 'javascript:alert(1)' }],
  }] }] }} onSubmit={saved} />);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  expect(await screen.findByText(i18n.t('courseMaterialUrlInvalid'))).toBeTruthy();
  expect(saved).not.toHaveBeenCalled();
});

it('supports quick age category presets, collapse/expand controls, and duplicating lessons and blocks with fresh IDs', async () => {
  const saved = vi.fn();
  render(<Editor program={initialProgram} onSubmit={saved} />);

  fireEvent.click(screen.getByRole('button', { name: '14–17' }));
  expect((screen.getByLabelText(i18n.t('ageCategory'), { exact: false }) as HTMLInputElement).value).toBe('14–17');

  fireEvent.click(screen.getByRole('button', { name: i18n.t('courseCollapseAll') }));
  expect(screen.queryByRole('textbox', { name: i18n.t('courseBlockTitle') })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('courseExpandAll') }));
  expect(screen.getByLabelText(i18n.t('courseBlockTitle'), { exact: false })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: `${i18n.t('courseDuplicateItem')}: Variables` }));
  fireEvent.click(screen.getByRole('button', { name: `${i18n.t('courseDuplicateItem')}: Foundations` }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));

  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const values = saved.mock.calls[0][0] as CourseValues;
  expect(values.ageCategory).toBe('14–17');
  const program = values.program as CourseCurriculum;
  expect(program.blocks).toHaveLength(2);
  expect(program.blocks[0].lessons).toHaveLength(3);
  expect(program.blocks[1].lessons).toHaveLength(3);
  expect(program.blocks[1].id).not.toBe(program.blocks[0].id);
  expect(program.blocks[0].lessons[1].id).not.toBe(program.blocks[0].lessons[0].id);
  expect(program.blocks[0].lessons[1].materials[0].id).not.toBe(program.blocks[0].lessons[0].materials[0].id);
});

it('does not show premature errors when adding empty blocks, lessons, or materials and auto-expands only invalid sections on submit', async () => {
  const saved = vi.fn();
  render(<Editor program={initialProgram} onSubmit={saved} />);

  fireEvent.click(screen.getByRole('button', { name: i18n.t('courseAddBlock') }));
  expect(screen.queryAllByRole('alert')).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: i18n.t('courseCollapseAll') }));
  expect(screen.queryByRole('textbox', { name: i18n.t('courseBlockTitle') })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
  expect(saved).not.toHaveBeenCalled();

  const validBlock = screen.getByRole('region', { name: 'Foundations' });
  const invalidBlock = screen.getByRole('region', { name: i18n.t('courseBlockNumber', { number: 2 }) });
  expect(within(validBlock).queryByRole('textbox', { name: i18n.t('courseBlockTitle') })).toBeNull();
  expect(within(invalidBlock).getByLabelText(i18n.t('courseBlockTitle'), { exact: false })).toBeTruthy();

  fireEvent.click(within(invalidBlock).getByRole('button', { name: i18n.t('courseBlockNumber', { number: 2 }) }));
  expect(within(invalidBlock).queryByRole('textbox', { name: i18n.t('courseBlockTitle') })).toBeNull();
});

it.each([false, true])('saves a course without a price field (editing: %s)', async (editing) => {
  const saved = vi.fn();
  render(<Editor program={initialProgram} onSubmit={saved} editing={editing} />);

  expect(screen.queryByLabelText(/base price/i)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));

  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(saved.mock.calls[0][0]).not.toHaveProperty('basePriceUzs');
  expect(saved.mock.calls[0][0]).toMatchObject({ name: 'Programming', program: initialProgram });
});


it('opens collapsed parameters before focusing an invalid required field and retains its draft', async () => {
  render(<Editor program={initialProgram} />);
  const name = screen.getByRole('textbox', { name: i18n.t('courseName') });
  fireEvent.change(name, { target: { value: '' } });
  const parameters = screen.getByRole('button', { name: i18n.t('courseBasicParameters') });
  fireEvent.click(parameters);
  expect(name.closest('[hidden]')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  await waitFor(() => expect(document.activeElement).toBe(name));
  expect(parameters.getAttribute('aria-expanded')).toBe('true');
  expect(name.closest('[hidden]')).toBeNull();
});

it('mounts and opens an invalid lesson in a collapsed block before focusing its field', async () => {
  const program: CourseCurriculum = { ...initialProgram, blocks: [
    initialProgram.blocks[0],
    { id: 'closed-block', title: 'Advanced', lessons: [{ id: 'closed-lesson', title: '', materials: [] }] },
  ] };
  render(<Editor program={program} />);
  const block = screen.getByRole('button', { name: 'Advanced' });
  expect(block.getAttribute('aria-expanded')).toBe('false');
  expect(within(screen.getByRole('region', { name: 'Advanced' })).queryByLabelText(i18n.t('courseLessonTitle'), { exact: false })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('save') }));
  const invalidBlock = screen.getByRole('region', { name: 'Advanced' });
  await waitFor(() => {
    const invalidTitle = within(invalidBlock).getByRole('textbox', { name: i18n.t('courseLessonTitle') });
    expect(document.activeElement).toBe(invalidTitle);
    expect(invalidTitle.closest('[hidden]')).toBeNull();
  });
  expect(block.getAttribute('aria-expanded')).toBe('true');
});

it('keeps section navigation available while saving and blocks edits and structural actions', async () => {
  const user = userEvent.setup();
  render(<Editor program={initialProgram} saving />);
  const parameters = screen.getByRole('button', { name: i18n.t('courseBasicParameters') });
  await user.click(parameters);
  await user.keyboard('{Enter}');
  expect(parameters.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('textbox', { name: i18n.t('courseName') }).matches(':disabled')).toBe(true);
  expect(screen.getByRole('textbox', { name: i18n.t('courseBlockTitle') }).matches(':disabled')).toBe(true);
  expect(screen.getByRole('textbox', { name: i18n.t('courseMaterialTitle') }).matches(':disabled')).toBe(true);
  expect((screen.getByRole('button', { name: i18n.t('courseAddBlock') }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: `${i18n.t('delete')}: Foundations` }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: i18n.t('courseCollapseAll') }));
  expect(screen.queryByRole('textbox', { name: i18n.t('courseBlockTitle') })).toBeNull();
  await user.click(screen.getByRole('button', { name: i18n.t('courseExpandAll') }));
  expect(screen.getByRole('textbox', { name: i18n.t('courseBlockTitle') })).toBeTruthy();
});
