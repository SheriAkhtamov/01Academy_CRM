import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LearningText } from '../client/src/features/learning-content/text';
import {
  courseCurriculumSchema, courseLessonMaterialsText, courseLessonPosition,
  flattenCourseCurriculum, normalizeCourseCurriculum,
} from '../shared/contracts/course-curriculum';
import { prepareGroupCourseLessons } from '../server/modules/academy/course-curriculum';

const program = { version: 1 as const, blocks: [{ id: 'block-1', title: 'First block', lessons: [
  { id: 'lesson-1', title: 'One', materials: [] },
  { id: 'lesson-2', title: 'Two', materials: [{ id: 'file-2', type: 'file' as const, title: 'Workbook', content: 'https://academy.test/book.pdf' }] },
  { id: 'lesson-3', title: 'Three', materials: [] },
] }] };

describe('course curriculum and group selection', () => {
  it('keeps stable legacy identities, order, and both existing material fields', () => {
    const legacy = [{ lessonNumber: 3, topic: 'Third', materials: 'File' }, { lessonNumber: 1, topic: 'First', description: 'Notes', materials: 'Link' }];
    expect(flattenCourseCurriculum(legacy).map(lesson => lesson.id)).toEqual(['legacy-lesson-1', 'legacy-lesson-3']);
    expect(normalizeCourseCurriculum(legacy).blocks[0].lessons[0].materials[0].content).toBe('Notes\n\nLink');
    expect(courseLessonPosition(legacy, 'legacy-lesson-3', 2)).toBe(2);
  });
  it('rejects duplicate identities, empty lessons, invalid protocols and credential URLs', () => {
    expect(courseCurriculumSchema.safeParse(program).success).toBe(true);
    expect(courseCurriculumSchema.safeParse({ ...program, blocks: [{ ...program.blocks[0], lessons: [] }] }).success).toBe(false);
    expect(courseCurriculumSchema.safeParse({ ...program, blocks: [program.blocks[0], program.blocks[0]] }).success).toBe(false);
    for (const content of ['javascript:alert(1)', 'http://academy.test/file', 'https://user:password@academy.test/file']) {
      const copy = structuredClone(program); copy.blocks[0].lessons[1].materials[0].content = content;
      expect(courseCurriculumSchema.safeParse(copy).success).toBe(false);
    }
  });
  it('derives the count and curriculum order from a noncontiguous checked subset', () => {
    const values = { selectedCourseLessonIds: ['lesson-3', 'lesson-1'], lessonCount: 999 };
    prepareGroupCourseLessons(values, undefined, program);
    expect(values).toEqual({ selectedCourseLessonIds: ['lesson-1', 'lesson-3'], lessonCount: 2 });
    expect(courseLessonPosition(program, 'lesson-3', 2)).toBe(2);
  });
  it('rejects empty, duplicate, unknown and malformed selections', () => {
    for (const selectedCourseLessonIds of [[], ['lesson-1', 'lesson-1'], ['other-course'], 'lesson-1', null]) {
      expect(() => prepareGroupCourseLessons({ selectedCourseLessonIds }, undefined, program)).toThrow();
    }
    expect(() => prepareGroupCourseLessons({}, undefined, program)).toThrow('courseLessonsSelectionRequired');
  });
  it('preserves unconfigured legacy groups and derives configured groups on schedule edits', () => {
    const legacy = { lessonCount: 12, selectedCourseLessonIds: null };
    prepareGroupCourseLessons(legacy, { selectedCourseLessonIds: null }, program);
    expect(legacy).toEqual({ lessonCount: 12 });
    const configured = { lessonCount: 99 };
    prepareGroupCourseLessons(configured, { selectedCourseLessonIds: ['lesson-2'] }, program);
    expect(configured).toEqual({ lessonCount: 1, selectedCourseLessonIds: ['lesson-2'] });
  });
  it('serializes URL materials as usable links in existing LMS text, including bracketed titles', () => {
    expect(courseLessonMaterialsText(program.blocks[0].lessons[1])).toBe('[Workbook](https://academy.test/book.pdf)');
    const lesson = structuredClone(program.blocks[0].lessons[1]);
    lesson.materials[0].title = 'Workbook [PDF]';
    const text = courseLessonMaterialsText(lesson)!;
    const html = renderToStaticMarkup(createElement(LearningText, { text }));
    expect(html).toContain('href="https://academy.test/book.pdf"');
    expect(html).toContain('Workbook ［PDF］</a>');
  });
});
