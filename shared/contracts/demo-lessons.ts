import { z } from 'zod';

export const DEMO_LESSON_FORMATS = ['offline', 'online'] as const;
export const DEMO_LESSON_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export const DEMO_PARTICIPANT_STATUSES = [
  'invited',
  'confirmed',
  'attended',
  'no_show',
  'cancelled',
] as const;

const entityId = z.coerce.number().int().positive();

export const demoLessonMutationSchema = z.object({
  courseId: entityId,
  schoolId: entityId,
  roomId: entityId.nullable().optional(),
  teacherId: entityId,
  scheduledAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().min(15).max(480),
  format: z.enum(DEMO_LESSON_FORMATS).default('offline'),
  capacity: z.coerce.number().int().min(1).max(100),
  participantIds: z.array(entityId).min(1).max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'duplicateDemoParticipants'),
  notes: z.string().trim().max(2_000).nullable().optional(),
}).superRefine((value, context) => {
  if (value.format === 'offline' && !value.roomId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['roomId'],
      message: 'demoRoomRequired',
    });
  }
  if (value.format === 'online' && value.roomId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['roomId'],
      message: 'demoOnlineRoomNotAllowed',
    });
  }
  if (value.participantIds.length > value.capacity) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['capacity'],
      message: 'demoCapacityExceeded',
    });
  }
});

export const demoLessonCancelSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const demoLessonAttendanceSchema = z.object({
  participants: z.array(z.object({
    leadId: entityId,
    status: z.enum(['attended', 'no_show']),
    result: z.string().trim().max(2_000).nullable().optional(),
  })).min(1).max(100)
    .refine((items) => new Set(items.map((item) => item.leadId)).size === items.length, 'duplicateDemoParticipants'),
});

export type DemoLessonMutation = z.infer<typeof demoLessonMutationSchema>;
export type DemoLessonAttendance = z.infer<typeof demoLessonAttendanceSchema>;
