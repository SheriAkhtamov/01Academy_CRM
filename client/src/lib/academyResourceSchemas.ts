import { z } from 'zod';
import { courseCurriculumSchema, type CourseCurriculum } from '@shared/contracts/course-curriculum';
import type { TranslationKey } from '@/lib/i18n';

type Translate = (key: TranslationKey) => string;

/*
  Validation messages are translation keys resolved through t(): the schemas
  are factories so <LocalizedFormMessage /> renders localized text instead of
  raw English zod defaults in the RU UI.
*/
export const createSchoolSchema = (t: Translate) => z.object({
  name: z.string().trim().min(1, t('fieldRequired')),
  address: z.string().trim().min(1, t('fieldRequired')),
  timezone: z.string().trim().min(1, t('fieldRequired')),
  isActive: z.boolean(),
});

export const createRoomSchema = (t: Translate) => z.object({
  schoolId: z.string().min(1, t('fieldRequired')),
  name: z.string().trim().min(1, t('fieldRequired')),
  capacity: z.coerce.number<number>({ error: t('invalidDataFormat') }).int(t('invalidDataFormat')).min(1, t('invalidDataFormat')),
  isActive: z.boolean(),
});

export const createCourseSchema = (t: Translate) => z.object({
  name: z.string().trim().min(1, t('fieldRequired')),
  ageCategory: z.string().trim().min(1, t('fieldRequired')),
  description: z.string(),
  isActive: z.boolean(),
  program: z.custom<CourseCurriculum>().transform((value, context) => {
    const result = courseCurriculumSchema.safeParse(value);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      let message = t('invalidDataFormat');
      if (issue.code === 'custom') {
        const key = issue.message as 'courseMaterialUrlInvalid' | 'courseCurriculumDuplicateId' | 'courseCurriculumTooManyLessons' | 'courseMaterialFileInvalid' | 'courseLessonTooManyFiles' | 'fieldRequired';
        message = t(key);
      } else if (issue.code === 'too_small') {
        message = t(issue.path[issue.path.length - 1] === 'lessons' ? 'courseBlockLessonsRequired' : 'fieldRequired');
      } else if (issue.code === 'too_big') {
        message = t('courseCurriculumLimitExceeded');
      }
      context.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message });
    }
    return z.NEVER;
  }),
});

export const createStatusSchema = (t: Translate) => z.object({
  name: z.string().trim().min(1, t('fieldRequired')),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, t('invalidDataFormat')),
  sortOrder: z.coerce.number<number>({ error: t('invalidDataFormat') }).int(t('invalidDataFormat')).min(0, t('invalidDataFormat')),
  isPipeline: z.boolean(),
  isActive: z.boolean(),
});

export const createGroupSchema = (t: Translate, allowUnassignedTeacher = false) => z.object({
  name: z.string().trim().min(1, t('fieldRequired')).max(255, t('groupNameTooLong')),
  nameSuffix: z.string().trim().max(255, t('groupNameTooLong')).default('').nonoptional(),
  deliveryMode: z.enum(['offline', 'online']).default('offline').nonoptional(),
  trainingType: z.enum(['GRP', 'IND']).default('GRP').nonoptional(),
  courseId: z.string().min(1, t('fieldRequired')),
  schoolId: z.string().min(1, t('fieldRequired')),
  roomId: z.string().min(1, t('fieldRequired')),
  teacherId: z.string().regex(/^(?:[1-9]\d*)?$/, t('invalidDataFormat'))
    .refine((value) => allowUnassignedTeacher || value.length > 0, t('teacherRequired')),
  selectedCourseLessonIds: z.array(z.string().min(1)).min(1, t('groupLessonsRequired')).nullable().default(null).nonoptional(),
  lessonCount: z.coerce.number<number>({ error: t('invalidDataFormat') }).int(t('invalidDataFormat')).min(1, t('invalidDataFormat')),
  lessonDurationMinutes: z.coerce.number<number>({ error: t('invalidDataFormat') }).int(t('invalidDataFormat')).min(15, t('invalidDataFormat')),
  maxStudents: z.coerce.number<number>({ error: t('invalidDataFormat') }).int(t('invalidDataFormat')).min(1, t('invalidDataFormat')),
  status: z.enum(['open', 'in_progress', 'frozen', 'completed']),
  startDate: z.string().min(1, t('fieldRequired')),
  endDate: z.string(),
}).superRefine((values, context) => {
  if (values.trainingType === 'IND' && values.maxStudents !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxStudents'], message: t('groupIndividualCapacity') });
  }
  if (values.startDate && values.endDate && values.endDate < values.startDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: t('endDateBeforeStart'),
    });
  }
});

export type SchoolValues = z.infer<ReturnType<typeof createSchoolSchema>>;
export type RoomValues = z.infer<ReturnType<typeof createRoomSchema>>;
export type CourseValues = z.infer<ReturnType<typeof createCourseSchema>>;
export type StatusValues = z.infer<ReturnType<typeof createStatusSchema>>;
export type GroupValues = z.infer<ReturnType<typeof createGroupSchema>>;
