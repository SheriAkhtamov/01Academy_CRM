import type {
  CourseCurriculum,
  CourseCurriculumBlock,
  CourseCurriculumLesson,
  CourseCurriculumMaterial,
} from '@shared/contracts/course-curriculum';
import { courseCurriculumSchema, normalizeCourseCurriculum } from '@shared/contracts/course-curriculum';

export const AGE_CATEGORY_PRESETS = ['7–9', '10–13', '14–17', '18+'] as const;

export function canEditCourseCurriculum(program: unknown): boolean {
  if (program == null) return true;
  if (!Array.isArray(program)) return courseCurriculumSchema.safeParse(program).success;
  const curriculum = normalizeCourseCurriculum(program);
  return curriculum.blocks.reduce((count, block) => count + block.lessons.length, 0) === program.length;
}

export function createCurriculumLesson(): CourseCurriculumLesson {
  return { id: crypto.randomUUID(), title: '', materials: [] };
}

export function createCurriculumBlock(): CourseCurriculumBlock {
  return { id: crypto.randomUUID(), title: '', lessons: [createCurriculumLesson()] };
}

export function createCurriculumMaterial(): CourseCurriculumMaterial {
  return { id: crypto.randomUUID(), type: 'text', title: '', content: '' };
}

export function duplicateCurriculumLesson(lesson: CourseCurriculumLesson): CourseCurriculumLesson {
  return {
    ...lesson,
    id: crypto.randomUUID(),
    materials: lesson.materials.map((material) => ({
      ...material,
      id: crypto.randomUUID(),
      file: material.file ? { ...material.file } : undefined,
    })),
  };
}

export function duplicateCurriculumBlock(block: CourseCurriculumBlock): CourseCurriculumBlock {
  return {
    ...block,
    id: crypto.randomUUID(),
    lessons: block.lessons.map(duplicateCurriculumLesson),
  };
}

export function insertCurriculumItemAfter<T>(items: T[], index: number, item: T): T[] {
  const next = [...items];
  next.splice(index + 1, 0, item);
  return next;
}

export function moveCurriculumItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const destination = index + direction;
  if (destination < 0 || destination >= items.length) return items;
  const next = [...items];
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

export function summarizeCourseCurriculum(program: CourseCurriculum | undefined): {
  blockCount: number;
  lessonCount: number;
  materialCount: number;
} {
  const blocks = program?.blocks ?? [];
  let lessonCount = 0;
  let materialCount = 0;
  for (const block of blocks) {
    lessonCount += block.lessons.length;
    for (const lesson of block.lessons) {
      materialCount += lesson.materials.length;
    }
  }
  return { blockCount: blocks.length, lessonCount, materialCount };
}
