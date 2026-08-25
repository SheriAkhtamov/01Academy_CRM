import { z } from 'zod';

export const DEMO_LESSON_FORMATS = ['offline', 'online'] as const;
export const DEMO_LESSON_STATUSES = ['scheduled', 'completed', 'not_conducted', 'cancelled'] as const;
export const DEMO_PARTICIPANT_STATUSES = [
  'invited',
  'confirmed',
  'attended',
  'no_show',
  'cancelled',
] as const;
export const DEMO_NO_SHOW_REASON_CODES = [
  'no_contact',
  'forgot',
  'reschedule_requested',
  'illness_or_emergency',
  'could_not_reach_location',
  'technical_issue',
  'not_interested',
  'other',
] as const;
export const DEMO_NOT_CONDUCTED_REASON_CODES = [
  'teacher_unavailable',
  'participants_absent',
  'client_requested_change',
  'room_unavailable',
  'technical_issue',
  'organizational_issue',
  'emergency',
  'other',
] as const;

const entityId = z.coerce.number().int().positive();
// A demo lesson takes as many students as the branch invites, so the only rule
// left on the list is that nobody is enrolled twice.
const participantIds = (minimum: number) => z.array(entityId)
  .min(minimum)
  .refine((ids) => new Set(ids).size === ids.length, 'duplicateDemoParticipants');

export const demoLessonMutationSchema = z.object({
  courseId: entityId,
  schoolId: entityId,
  roomId: entityId.nullable().optional(),
  teacherId: entityId,
  scheduledAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().min(15).max(480),
  format: z.enum(DEMO_LESSON_FORMATS).default('offline'),
  studentIds: participantIds(0).default([]),
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
});

export const demoLessonResourceAvailabilitySchema = z.object({
  courseId: entityId,
  schoolId: entityId,
  scheduledAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().min(15).max(480),
  format: z.enum(DEMO_LESSON_FORMATS).default('offline'),
  studentIds: participantIds(0).default([]),
});

export const demoLessonCancelSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const demoLessonOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('completed'),
  }),
  z.object({
    status: z.literal('not_conducted'),
    reasonCode: z.enum(DEMO_NOT_CONDUCTED_REASON_CODES),
    reasonNote: z.string().trim().max(500).nullable().optional(),
  }),
]).superRefine((value, context) => {
  if (value.status === 'not_conducted'
    && value.reasonCode === 'other'
    && !value.reasonNote?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reasonNote'],
      message: 'demoNoShowOtherNoteRequired',
    });
  }
});

export const demoLessonRescheduleSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(1).max(500),
});

export const demoLessonAttendanceSchema = z.object({
  participants: z.array(z.object({
    participantId: entityId,
    status: z.enum(['attended', 'no_show']),
    result: z.string().trim().max(2_000).nullable().optional(),
    noShowReasonCode: z.enum(DEMO_NO_SHOW_REASON_CODES).nullable().optional(),
    noShowReasonNote: z.string().trim().max(500).nullable().optional(),
  }).superRefine((item, context) => {
    if (item.status === 'no_show' && !item.noShowReasonCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['noShowReasonCode'],
        message: 'demoNoShowReasonRequired',
      });
    }
    if (item.status === 'no_show'
      && item.noShowReasonCode === 'other'
      && !item.noShowReasonNote?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['noShowReasonNote'],
        message: 'demoNoShowOtherNoteRequired',
      });
    }
    if (item.status === 'attended' && (item.noShowReasonCode || item.noShowReasonNote)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['noShowReasonCode'],
        message: 'demoNoShowReasonOnlyForAbsence',
      });
    }
  })).min(1)
    .refine((items) => new Set(items.map((item) => item.participantId)).size === items.length, 'duplicateDemoParticipants'),
});

export const demoLessonEnrollmentSchema = z.object({
  studentIds: participantIds(1),
});

export type DemoLessonMutation = z.infer<typeof demoLessonMutationSchema>;
export type DemoLessonAttendance = z.infer<typeof demoLessonAttendanceSchema>;
export type DemoLessonEnrollment = z.infer<typeof demoLessonEnrollmentSchema>;
export type DemoLessonOutcome = z.infer<typeof demoLessonOutcomeSchema>;
export type DemoLessonReschedule = z.infer<typeof demoLessonRescheduleSchema>;
export type DemoLessonResourceAvailabilityRequest = z.infer<typeof demoLessonResourceAvailabilitySchema>;
export type DemoNoShowReasonCode = typeof DEMO_NO_SHOW_REASON_CODES[number];
export type DemoNotConductedReasonCode = typeof DEMO_NOT_CONDUCTED_REASON_CODES[number];
