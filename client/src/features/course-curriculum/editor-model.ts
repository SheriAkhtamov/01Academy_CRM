import type {
  CourseCurriculumBlock,
  CourseCurriculumLesson,
  CourseCurriculumMaterial,
} from '@shared/contracts/course-curriculum';
import { courseCurriculumSchema, normalizeCourseCurriculum } from '@shared/contracts/course-curriculum';

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

export function moveCurriculumItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const destination = index + direction;
  if (destination < 0 || destination >= items.length) return items;
  const next = [...items];
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}
