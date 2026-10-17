import { z } from "zod";

const identity = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const title = z.string().trim().min(1).max(255);

export const courseCurriculumMaterialSchema = z.object({
  id: identity,
  type: z.enum(["text", "link", "video", "file"]),
  title,
  content: z.string().trim().min(1).max(100_000),
}).strict().superRefine((material, context) => {
  if (material.type === "text") return;
  try {
    const url = new URL(material.content);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["content"], message: "courseMaterialUrlInvalid" });
  }
});
export const courseCurriculumLessonSchema = z.object({
  id: identity,
  title,
  materials: z.array(courseCurriculumMaterialSchema).max(100),
}).strict();
export const courseCurriculumBlockSchema = z.object({
  id: identity,
  title,
  lessons: z.array(courseCurriculumLessonSchema).min(1).max(2000),
}).strict();
export const courseCurriculumSchema = z.object({
  version: z.literal(1),
  blocks: z.array(courseCurriculumBlockSchema).max(200),
}).strict().superRefine((curriculum, context) => {
  const identities = new Set<string>();
  let count = 0;
  for (const block of curriculum.blocks) {
    for (const entry of [block, ...block.lessons, ...block.lessons.flatMap(lesson => lesson.materials)]) {
      if (identities.has(entry.id)) context.addIssue({ code: z.ZodIssueCode.custom, message: "courseCurriculumDuplicateId" });
      identities.add(entry.id);
    }
    count += block.lessons.length;
  }
  if (count > 2000) context.addIssue({ code: z.ZodIssueCode.custom, message: "courseCurriculumTooManyLessons" });
});

export type CourseCurriculum = z.infer<typeof courseCurriculumSchema>;
export type CourseCurriculumBlock = z.infer<typeof courseCurriculumBlockSchema>;
export type CourseCurriculumLesson = z.infer<typeof courseCurriculumLessonSchema>;
export type CourseCurriculumMaterial = z.infer<typeof courseCurriculumMaterialSchema>;
export type FlatCourseCurriculumLesson = CourseCurriculumLesson & { blockId: string; blockTitle: string; position: number };

/** Old CRM programs keep deterministic identities when opened and saved in the editor. */
export function normalizeCourseCurriculum(program: unknown): CourseCurriculum {
  const structured = courseCurriculumSchema.safeParse(program);
  if (structured.success) return structured.data;
  if (!Array.isArray(program) || program.length > 2000) return { version: 1, blocks: [] };
  const seen = new Set<number>();
  const lessons: CourseCurriculumLesson[] = [];
  for (const [index, raw] of program.entries()) {
    if (!raw || typeof raw !== "object") return { version: 1, blocks: [] };
    const entry = raw as Record<string, unknown>;
    const number = entry.lessonNumber === undefined ? index + 1 : Number(entry.lessonNumber);
    const lessonTitle = typeof entry.topic === "string" ? entry.topic.trim() : typeof entry.title === "string" ? entry.title.trim() : "";
    if (!Number.isSafeInteger(number) || number < 1 || seen.has(number) || !lessonTitle) return { version: 1, blocks: [] };
    seen.add(number);
    const content = [entry.description, entry.materials].filter((value): value is string => typeof value === "string" && Boolean(value.trim())).join("\n\n");
    lessons.push({ id: `legacy-lesson-${number}`, title: lessonTitle, materials: content ? [{ id: `legacy-material-${number}`, type: "text", title: lessonTitle, content }] : [] });
  }
  lessons.sort((left, right) => Number(left.id.slice(14)) - Number(right.id.slice(14)));
  return { version: 1, blocks: lessons.length ? [{ id: "legacy-block", title: "", lessons }] : [] };
}

export function flattenCourseCurriculum(program: unknown): FlatCourseCurriculumLesson[] {
  const curriculum = normalizeCourseCurriculum(program);
  let position = 0;
  return curriculum.blocks.flatMap(block => block.lessons.map(lesson => ({ ...lesson, blockId: block.id, blockTitle: block.title, position: position++ })));
}

export const selectedCourseLessonIdsSchema = z.array(identity).min(1).max(2000).refine(ids => new Set(ids).size === ids.length, "courseLessonsSelectionInvalid");

export function orderSelectedCourseLessons(program: unknown, ids: readonly string[]): FlatCourseCurriculumLesson[] {
  const lessons = flattenCourseCurriculum(program);
  const selected = new Set(ids);
  return lessons.filter(lesson => selected.has(lesson.id));
}

/** Plain text snapshots are compatible with existing CRM and LMS material drafts. */
export function courseLessonMaterialsText(lesson: CourseCurriculumLesson): string | null {
  return lesson.materials.map(material => material.type === "text" ? `${material.title}\n${material.content}`
    : `[${material.title.replace(/\[/g, "［").replace(/\]/g, "］")}](${material.content.replace(/\(/g, "%28").replace(/\)/g, "%29")})`).join("\n\n") || null;
}

/** Resolve against the pinned program, never a mutable course's current order. */
export function courseLessonPosition(program: unknown, sourceId: string | null | undefined, lessonNumber: number): number | null {
  if (!sourceId) return lessonNumber - 1;
  if (Array.isArray(program) && /^legacy-lesson-\d+$/.test(sourceId)) return Number(sourceId.slice(14)) - 1;
  const lesson = flattenCourseCurriculum(program).find(item => item.id === sourceId);
  return lesson?.position ?? null;
}
