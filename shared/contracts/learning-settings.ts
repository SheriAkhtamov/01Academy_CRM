import { z } from 'zod';

export const LEARNING_ACHIEVEMENT_RULES = ['first_accepted', 'first_project', 'section_completed', 'makeup_completed', 'course_completed'] as const;
export const learningSchoolSettingsSchema = z.object({
  crmPreparation: z.object({ defaultFormat: z.enum(['offline', 'online']).nullable() }).strict().default({ defaultFormat: null }),
  maxFileMiB: z.number().int().min(1).max(100),
  studentQuotaGiB: z.number().min(0.1).max(80),
  schoolQuotaGiB: z.number().min(0.1).max(80),
  materialAccessDays: z.number().int().min(1).max(3650).nullable(),
  achievementTemplates: z.array(z.object({
    rule: z.enum(LEARNING_ACHIEVEMENT_RULES), title: z.string().trim().min(1).max(255), reason: z.string().trim().min(1).max(1000),
  }).strict()).max(5).refine(values => new Set(values.map(value => value.rule)).size === values.length),
}).strip();
export type LearningSchoolSettings = z.infer<typeof learningSchoolSettingsSchema>;
export const DEFAULT_LEARNING_SCHOOL_SETTINGS: LearningSchoolSettings = {
  crmPreparation: { defaultFormat: null },
  maxFileMiB: 10, studentQuotaGiB: 5, schoolQuotaGiB: 20, materialAccessDays: null,
  achievementTemplates: [
    { rule: 'first_accepted', title: 'lmsAchievementFirstAccepted', reason: 'lmsAchievementFirstAccepted' },
    { rule: 'first_project', title: 'lmsAchievementFirstProject', reason: 'lmsAchievementFirstProject' },
    { rule: 'section_completed', title: 'lmsAchievementSectionCompleted', reason: 'lmsAchievementSectionCompleted' },
    { rule: 'makeup_completed', title: 'portalMakeupComplete', reason: 'portalMakeupComplete' },
    { rule: 'course_completed', title: 'lmsAchievementCourseCompleted', reason: 'lmsAchievementCourseCompleted' },
  ],
};
export type LearningSchoolSettingsDto = { settings: LearningSchoolSettings; version: number; employees: { id: number; fullName: string }[] };
export const learningSchoolSettingsUpdateSchema = z.object({ version:z.number().int().nonnegative(),settings:learningSchoolSettingsSchema.omit({crmPreparation:true}).extend({crmPreparation:z.object({defaultFormat:z.enum(['offline','online']).nullable()}).strict().optional()}) }).strip();
export type LearningSchoolSettingsUpdate = z.infer<typeof learningSchoolSettingsUpdateSchema>;

export function fixedLearningPolicy(stored: LearningSchoolSettings): LearningSchoolSettings {
  return { ...stored, maxFileMiB: 10, materialAccessDays: null, achievementTemplates: DEFAULT_LEARNING_SCHOOL_SETTINGS.achievementTemplates.map(template => stored.achievementTemplates.find(value => value.rule === template.rule) ?? template) };
}
