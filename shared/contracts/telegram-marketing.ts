import { z } from 'zod';

export const marketingBotCourses = ['all', 'ai-kids', 'vibe-coding', 'ai-creator', 'other', 'unknown'] as const;
export type MarketingBotCourse = typeof marketingBotCourses[number];
export const marketingBotStateSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  course: z.enum(marketingBotCourses).default('all'),
  awaitingDates: z.boolean().default(false),
});
export type MarketingBotState = z.infer<typeof marketingBotStateSchema>;

export const marketingBotSettingsSchema = z.object({
  botToken: z.string().trim().max(2048).optional(),
  accessPassword: z.string().trim().min(5).max(128).optional().or(z.literal('')),
}).strict();

export type MarketingBotReport = {
  leads: number;
  uniqueLeads: number;
  reached: number;
  unreached: number;
  notCalled: number;
  qualified: number;
  bookedStudents: number;
  attendedStudents: number;
  dueStudents: number;
  payingLeads: number;
  payments: number;
  revenueUzs: number;
  courses: Array<{ course: Exclude<MarketingBotCourse, 'all'>; count: number }>;
  languages: { uz: number; ru: number; both: number; other: number; unknown: number };
};
