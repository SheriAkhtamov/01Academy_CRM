import { z } from 'zod';

const hour = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const distinctIds = z.array(z.number().int().positive()).max(1000).refine(values => new Set(values).size === values.length);
export const LEARNING_ACHIEVEMENT_RULES = ['first_accepted', 'first_project', 'section_completed', 'makeup_completed', 'course_completed'] as const;
export const learningSchoolSettingsSchema = z.object({
  crmPreparation: z.object({ defaultFormat: z.enum(['offline', 'online']).nullable() }).strict().default({ defaultFormat: null }),
  maxFileMiB: z.number().int().min(1).max(100),
  studentQuotaGiB: z.number().min(0.1).max(80),
  schoolQuotaGiB: z.number().min(0.1).max(80),
  materialAccessDays: z.number().int().min(1).max(3650).nullable(),
  childFinanceVisible: z.boolean(),
  workCalendar: z.object({
    workdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(values => new Set(values).size === values.length),
    start: hour, end: hour,
    holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
      const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(+date) && date.toISOString().slice(0,10) === value;
    })).max(1000),
    coordinatorUserIds: distinctIds,
  }).strict().refine(value => value.end > value.start),
  achievementTemplates: z.array(z.object({
    rule: z.enum(LEARNING_ACHIEVEMENT_RULES), title: z.string().trim().min(1).max(255), reason: z.string().trim().min(1).max(1000),
  }).strict()).max(5).refine(values => new Set(values.map(value => value.rule)).size === values.length),
}).strict();
export type LearningSchoolSettings = z.infer<typeof learningSchoolSettingsSchema>;
export const DEFAULT_LEARNING_SCHOOL_SETTINGS: LearningSchoolSettings = {
  crmPreparation: { defaultFormat: null },
  maxFileMiB: 100, studentQuotaGiB: 5, schoolQuotaGiB: 20, materialAccessDays: 365, childFinanceVisible: false,
  workCalendar: { workdays: [1,2,3,4,5], start: '09:00', end: '18:00', holidays: [], coordinatorUserIds: [] },
  achievementTemplates: [],
};
export type LearningSchoolSettingsDto = { settings: LearningSchoolSettings; version: number; employees: { id: number; fullName: string }[]; emailConfigured: boolean; scannerConfigured: boolean };
export const learningSchoolSettingsUpdateSchema = z.object({ version:z.number().int().nonnegative(),settings:learningSchoolSettingsSchema.omit({crmPreparation:true}).extend({crmPreparation:z.object({defaultFormat:z.enum(['offline','online']).nullable()}).strict().optional()}) }).strict();
export type LearningSchoolSettingsUpdate = z.infer<typeof learningSchoolSettingsUpdateSchema>;
