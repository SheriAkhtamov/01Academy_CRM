import { z } from 'zod';
import type { TranslationKey } from '@/lib/i18n';

type Translate = (key: TranslationKey) => string;

/*
  Validation messages are translation keys resolved through t(): the schemas
  are factories so <LocalizedFormMessage /> renders localized text instead of
  raw English zod defaults in the RU UI.
*/
export const createSchoolSchema = (t: Translate) => z.object({
  name: z.string().trim().min(1, t('fieldRequired')),
  code: z.string().trim().min(1, t('fieldRequired')).regex(/^[a-z0-9_-]+$/, t('invalidDataFormat')),
  address: z.string().trim().min(1, t('fieldRequired')),
  timezone: z.string().trim().min(1, t('fieldRequired')),
  isActive: z.boolean(),
});

export const createRoomSchema = (t: Translate) => z.object({
  schoolId: z.string().min(1, t('fieldRequired')),
  name: z.string().trim().min(1, t('fieldRequired')),
  capacity: z.coerce.number({ invalid_type_error: t('invalidDataFormat') }).int(t('invalidDataFormat')).min(1, t('invalidDataFormat')),
  isActive: z.boolean(),
});

export const createCourseSchema = (t: Translate) => z.object({
  name: z.string().trim().min(1, t('fieldRequired')),
  ageCategory: z.string().trim().min(1, t('fieldRequired')),
  description: z.string(),
  basePriceUzs: z.coerce.number({ invalid_type_error: t('invalidDataFormat') }).int(t('invalidDataFormat')).min(0, t('invalidDataFormat')),
  isActive: z.boolean(),
});

export const createStatusSchema = (t: Translate) => z.object({
  name: z.string().trim().min(1, t('fieldRequired')),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, t('invalidDataFormat')),
  sortOrder: z.coerce.number({ invalid_type_error: t('invalidDataFormat') }).int(t('invalidDataFormat')).min(0, t('invalidDataFormat')),
  isPipeline: z.boolean(),
  isActive: z.boolean(),
});

export const createGroupSchema = (t: Translate) => z.object({
  name: z.string().trim().min(1, t('fieldRequired')),
  courseId: z.string().min(1, t('fieldRequired')),
  schoolId: z.string().min(1, t('fieldRequired')),
  roomId: z.string().min(1, t('fieldRequired')),
  teacherId: z.string(),
  lessonCount: z.coerce.number({ invalid_type_error: t('invalidDataFormat') }).int(t('invalidDataFormat')).min(1, t('invalidDataFormat')),
  lessonDurationMinutes: z.coerce.number({ invalid_type_error: t('invalidDataFormat') }).int(t('invalidDataFormat')).min(15, t('invalidDataFormat')),
  maxStudents: z.coerce.number({ invalid_type_error: t('invalidDataFormat') }).int(t('invalidDataFormat')).min(1, t('invalidDataFormat')),
  status: z.enum(['open', 'in_progress', 'completed']),
  startDate: z.string().min(1, t('fieldRequired')),
  endDate: z.string(),
}).superRefine((values, context) => {
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
