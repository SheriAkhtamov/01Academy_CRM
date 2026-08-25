import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  demoLessonAttendanceSchema,
  demoLessonEnrollmentSchema,
  demoLessonMutationSchema,
  demoLessonOutcomeSchema,
  demoLessonRescheduleSchema,
  demoLessonResourceAvailabilitySchema,
  demoLessonTeacherChangeSchema,
} from '../shared/contracts/demo-lessons';
import { buildSalesDemoScheduleEvents } from '../client/src/lib/salesSchedule';
import { getDemoEnrollmentState } from '../client/src/components/ux/DemoLessonEnrollmentDialog';
import type { DemoLesson } from '../client/src/features/demo-lessons/api';

const migration = readFileSync(
  new URL('../migrations/0074_add_demo_lessons.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const capacityMigration = readFileSync(
  new URL('../migrations/0091_remove_capacity_limits.sql', import.meta.url),
  'utf8',
);
const noShowReasonMigration = readFileSync(
  new URL('../migrations/0094_add_demo_no_show_reasons.sql', import.meta.url),
  'utf8',
);
const outcomeMigration = readFileSync(
  new URL('../migrations/0096_add_demo_outcomes_and_rescheduling.sql', import.meta.url),
  'utf8',
);
const studentParticipantMigration = readFileSync(
  new URL('../migrations/0097_demo_participants_are_students.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(
  new URL('../server/db/schema/demo-lessons.ts', import.meta.url),
  'utf8',
);
const groupSchema = readFileSync(
  new URL('../server/db/schema/index.ts', import.meta.url),
  'utf8',
);
const groupRouteSupport = readFileSync(
  new URL('../server/modules/academy/academy-route-support.ts', import.meta.url),
  'utf8',
);
const routes = readFileSync(
  new URL('../server/modules/academy/demo-lessons.router.ts', import.meta.url),
  'utf8',
);
const scheduling = readFileSync(
  new URL('../server/modules/academy/academy-scheduling.ts', import.meta.url),
  'utf8',
);
const resourceAvailability = readFileSync(
  new URL('../server/modules/academy/demo-resource-availability.ts', import.meta.url),
  'utf8',
);
const createDialog = readFileSync(
  new URL('../client/src/components/ux/DemoLessonDialog.tsx', import.meta.url),
  'utf8',
);
const detailsDialog = readFileSync(
  new URL('../client/src/components/ux/DemoLessonDetailsDialog.tsx', import.meta.url),
  'utf8',
);
const enrollmentDialog = readFileSync(
  new URL('../client/src/components/ux/DemoLessonEnrollmentDialog.tsx', import.meta.url),
  'utf8',
);
const kanbanBoard = readFileSync(
  new URL('../client/src/components/ux/KanbanBoard.tsx', import.meta.url),
  'utf8',
);
const leadDetailSheet = readFileSync(
  new URL('../client/src/components/ux/LeadDetailSheet.tsx', import.meta.url),
  'utf8',
);

const validMutation = {
  courseId: 1,
  schoolId: 2,
  roomId: 3,
  teacherId: 4,
  scheduledAt: '2030-07-15T05:00:00.000Z',
  durationMinutes: 60,
  format: 'offline' as const,
  studentIds: [10, 11],
  notes: null,
};

describe('demo lessons', () => {
  it('stores resource-safe events and participant history', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "academy_demo_lessons"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "academy_demo_lesson_participants"');
    expect(migration).toContain('"academy_demo_lessons_room_format_check"');
    expect(migration).toContain('"academy_demo_lesson_participants_unique"');
    expect(schema).toContain('createAcademyDemoTables');
  });

  it('drops the seat ceiling from demo lessons and study groups', () => {
    expect(capacityMigration).toContain('DROP CONSTRAINT IF EXISTS "academy_demo_lessons_capacity_check"');
    expect(capacityMigration).toContain('DROP COLUMN IF EXISTS "capacity"');
    expect(capacityMigration).toContain('CHECK ("max_students" >= 1)');
    expect(capacityMigration).not.toContain('BETWEEN 1 AND 12');
    expect(journal.entries.find((entry) => entry.idx === 91)?.tag)
      .toBe('0091_remove_capacity_limits');
    expect(schema).not.toContain('capacity');
    expect(groupSchema).toContain('${table.maxStudents} >= 1');
    expect(groupRouteSupport).not.toContain('groupExceedsRoomCapacity');
    expect(groupRouteSupport).not.toContain('maxStudents > 12');
  });

  it('registers migration 0074 after the module terminology migration', () => {
    expect(journal.entries.find((entry) => entry.idx === 73)?.tag)
      .toBe('0073_rename_workspaces_to_modules');
    expect(journal.entries.find((entry) => entry.idx === 74)?.tag)
      .toBe('0074_add_demo_lessons');
    expect(journal.entries.filter((entry) => entry.idx === 74)).toHaveLength(1);
  });

  it('stores structured no-show reasons without rewriting legacy rows', () => {
    expect(noShowReasonMigration).toContain('ADD COLUMN IF NOT EXISTS "no_show_reason_code" varchar(40)');
    expect(noShowReasonMigration).toContain('ADD COLUMN IF NOT EXISTS "no_show_reason_note" text');
    expect(noShowReasonMigration).toContain('academy_demo_lesson_participants_no_show_reason_code_check');
    expect(noShowReasonMigration).toContain('academy_demo_lesson_participants_no_show_reason_state_check');
    expect(noShowReasonMigration).not.toContain('UPDATE "academy_demo_lesson_participants"');
    expect(journal.entries.find((entry) => entry.idx === 94)?.tag)
      .toBe('0094_add_demo_no_show_reasons');
    expect(schema).toContain("noShowReasonCode: varchar('no_show_reason_code', { length: 40 })");
    expect(schema).toContain("noShowReasonNote: text('no_show_reason_note')");
  });

  it('requires a classified reason for every newly saved no-show', () => {
    expect(demoLessonAttendanceSchema.safeParse({
      participants: [{ participantId: 10, status: 'no_show', result: null }],
    }).error?.issues[0]?.message).toBe('demoNoShowReasonRequired');
    expect(demoLessonAttendanceSchema.safeParse({
      participants: [{
        participantId: 10,
        status: 'no_show',
        result: null,
        noShowReasonCode: 'forgot',
        noShowReasonNote: null,
      }],
    }).success).toBe(true);
    expect(demoLessonAttendanceSchema.safeParse({
      participants: [{
        participantId: 10,
        status: 'no_show',
        noShowReasonCode: 'other',
        noShowReasonNote: '   ',
      }],
    }).error?.issues[0]?.message).toBe('demoNoShowOtherNoteRequired');
    expect(demoLessonAttendanceSchema.safeParse({
      participants: [{
        participantId: 10,
        status: 'attended',
        noShowReasonCode: 'forgot',
      }],
    }).error?.issues[0]?.message).toBe('demoNoShowReasonOnlyForAbsence');
  });

  it('stores explicit demo outcomes and rescheduling history with database invariants', () => {
    expect(outcomeMigration).toContain("'not_conducted'");
    expect(outcomeMigration).toContain('"not_conducted_reason_code" varchar(50)');
    expect(outcomeMigration).toContain('academy_demo_lessons_not_conducted_reason_state_check');
    expect(outcomeMigration).toContain('academy_demo_lessons_not_conducted_other_note_check');
    expect(outcomeMigration).toContain('"last_rescheduled_from" timestamp');
    expect(outcomeMigration).toContain('"last_reschedule_reason" text');
    expect(journal.entries.find((entry) => entry.idx === 96)?.tag)
      .toBe('0096_add_demo_outcomes_and_rescheduling');
    expect(schema).toContain("notConductedReasonCode: varchar('not_conducted_reason_code'");
    expect(schema).toContain("lastRescheduledFrom: timestamp('last_rescheduled_from')");
  });

  it('validates final outcomes and requires a reason for every move', () => {
    expect(demoLessonOutcomeSchema.safeParse({ status: 'completed' }).success).toBe(true);
    expect(demoLessonOutcomeSchema.safeParse({
      status: 'not_conducted',
      reasonCode: 'participants_absent',
    }).success).toBe(true);
    expect(demoLessonOutcomeSchema.safeParse({
      status: 'not_conducted',
      reasonCode: 'other',
      reasonNote: '  ',
    }).error?.issues[0]?.message).toBe('demoNoShowOtherNoteRequired');
    expect(demoLessonRescheduleSchema.safeParse({
      scheduledAt: '2030-07-15T10:00:00+05:00',
      reason: '',
    }).success).toBe(false);
    expect(demoLessonRescheduleSchema.safeParse({
      scheduledAt: '2030-07-15T10:00:00+05:00',
      reason: 'Parent requested another time',
    }).success).toBe(true);
    expect(demoLessonTeacherChangeSchema.safeParse({ teacherId: 7 }).success).toBe(true);
    expect(demoLessonTeacherChangeSchema.safeParse({ teacherId: 0 }).success).toBe(false);
  });

  it('creates a demo lesson without participants and without a seat limit', () => {
    const { studentIds, ...schedule } = validMutation;
    const empty = demoLessonMutationSchema.safeParse(schedule);
    expect(empty.success).toBe(true);
    expect(empty.data?.studentIds).toEqual([]);
    expect(studentIds).toHaveLength(2);
    expect(routes).not.toContain('resolveDemoCapacity');
    expect(routes).not.toContain('capacity');
    expect(createDialog).not.toContain("t('demoParticipants')");
    expect(createDialog).not.toContain('demoParticipantsSelected');
  });

  it('takes any number of participants and rejects only duplicates and a missing room', () => {
    expect(demoLessonMutationSchema.safeParse(validMutation).success).toBe(true);
    const crowded = demoLessonMutationSchema.safeParse({
      ...validMutation,
      studentIds: Array.from({ length: 250 }, (_, index) => index + 1),
    });
    expect(crowded.success).toBe(true);
    expect(crowded.data?.studentIds).toHaveLength(250);
    const noRoom = demoLessonMutationSchema.safeParse({ ...validMutation, roomId: null });
    expect(noRoom.success).toBe(false);
    expect(noRoom.error?.issues[0]?.message).toBe('demoRoomRequired');
    const duplicate = demoLessonMutationSchema.safeParse({
      ...validMutation,
      studentIds: [10, 10],
    });
    expect(duplicate.success).toBe(false);
    expect(duplicate.error?.issues[0]?.message).toBe('duplicateDemoParticipants');
    expect(demoLessonResourceAvailabilitySchema.safeParse({
      courseId: 1,
      schoolId: 2,
      scheduledAt: validMutation.scheduledAt,
      durationMinutes: 45,
      format: 'offline',
      studentIds: [],
    }).success).toBe(true);
    expect(demoLessonEnrollmentSchema.safeParse({ studentIds: [10] }).success).toBe(true);
    expect(demoLessonEnrollmentSchema.safeParse({ studentIds: [10, 10] }).success).toBe(false);
    expect(demoLessonEnrollmentSchema.safeParse({ leadIds: [10] }).success).toBe(false);
  });

  it('rechecks all resources under the academy scheduling lock', () => {
    expect(routes).toContain('pg_advisory_xact_lock');
    expect(routes).toContain('assertTeacherCanLeadLesson');
    expect(routes).toContain('assertLessonRoomAvailable');
    expect(routes).toContain('assertParticipantAvailability');
    expect(routes).toContain("router.post('/demo-lessons'");
    expect(routes).toContain("router.post('/demo-lessons/resource-availability'");
    expect(routes).toContain("router.post('/demo-lessons/:id/cancel'");
    expect(routes).toContain("router.post('/demo-lessons/:id/outcome'");
    expect(routes).toContain("router.post('/demo-lessons/:id/reschedule'");
    expect(routes).toContain("router.get('/demo-lessons/:id/teacher-options'");
    expect(routes).toContain("router.post('/demo-lessons/:id/teacher'");
    expect(routes).toContain("router.post('/demo-lessons/:id/attendance'");
    expect(routes).toContain("router.post('/demo-lessons/:id/participants'");
    expect(routes).toContain("router.delete('/demo-lessons/:id/participants/:participantId'");
    expect(routes).toContain('ADD_ACADEMY_DEMO_PARTICIPANTS');
    expect(routes).toContain('REMOVE_ACADEMY_DEMO_PARTICIPANT');
    expect(routes).toContain("!['invited', 'confirmed'].includes");
    expect(routes).toContain('demoParticipantAlreadyEnrolled');
    expect(scheduling).toContain('FROM academy_demo_lessons');
    expect(scheduling).toContain('Number(lesson.roomId) !== roomId');
    expect(routes).toContain('academy_student_group_enrollments');
    expect(routes).toContain('lesson.status <> \'cancelled\'');
    expect(resourceAvailability).toContain('FROM academy_lessons');
    expect(resourceAvailability).toContain('FROM academy_demo_lessons');
    expect(resourceAvailability).toContain("status IN ('open', 'in_progress')");
    expect(resourceAvailability).toContain('busyTeacherIds');
    expect(resourceAvailability).toContain('busyRoomIds');
    expect(routes).toContain('FINALIZE_ACADEMY_DEMO_LESSON');
    expect(routes).toContain('RESCHEDULE_ACADEMY_DEMO_LESSON');
    expect(routes).toContain('CHANGE_ACADEMY_DEMO_TEACHER');
    expect(routes).toContain('assertDemoResources(input, id)');
    expect(routes).toContain('excludeDemoLessonId: id');
    expect(detailsDialog).toContain("t('changeDemoTeacher')");
    expect(routes).not.toContain("status: Number(pending?.count ?? 0) === 0 ? 'completed'");
  });

  it('disables enrollment when a selected student is already booked or times overlap, never for a full demo', () => {
    const target: DemoLesson = {
      id: 1,
      courseId: 1,
      schoolId: 1,
      teacherId: 1,
      scheduledAt: '2030-07-15T05:00:00.000Z',
      durationMinutes: 60,
      format: 'offline',
      status: 'scheduled',
      participants: [],
    };
    expect(getDemoEnrollmentState(target, [10], [target], 0)).toBe('available');
    expect(getDemoEnrollmentState({
      ...target,
      participants: [{ id: 1, studentId: 10, leadId: 42, status: 'invited' }],
    }, [10], [target], 0)).toBe('already_enrolled');
    expect(getDemoEnrollmentState({
      ...target,
      participants: Array.from({ length: 40 }, (_, index) => ({
        id: index + 1,
        studentId: index + 11,
        leadId: 42,
        status: 'confirmed' as const,
      })),
    }, [10], [target], 0)).toBe('available');
    const overlapping: DemoLesson = {
      ...target,
      id: 2,
      scheduledAt: '2030-07-15T05:30:00.000Z',
      participants: [{ id: 2, studentId: 10, leadId: 42, status: 'invited' }],
    };
    expect(getDemoEnrollmentState(target, [10], [target, overlapping], 0)).toBe('lead_busy');
  });

  it('renders demo events alongside lessons in the weekly calendar', () => {
    const weekStart = new Date(2030, 6, 15);
    const events = buildSalesDemoScheduleEvents([{
      id: 9,
      courseName: 'Vibe Coding',
      teacherName: 'Teacher',
      roomName: 'Room 2',
      // Academy-offset instant: startMinutes must not depend on the runner's zone.
      scheduledAt: '2030-07-15T10:00:00+05:00',
      durationMinutes: 60,
      status: 'scheduled',
      participants: [{ studentId: 10 }, { studentId: 11 }],
    }], weekStart);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'demo',
      demoLessonId: 9,
      roomName: 'Room 2',
      participantCount: 2,
      startMinutes: 600,
      endMinutes: 660,
    });
  });

  it('keeps creation and cancellation inside explicit modal flows', () => {
    expect(createDialog).toContain('<Dialog');
    expect(createDialog).toContain('id="demo-teacher"');
    expect(createDialog).toContain('id="demo-date"');
    expect(createDialog).toContain('id="demo-time"');
    expect(createDialog).toContain('id="demo-room"');
    expect(createDialog).toContain('resourceAvailability');
    expect(createDialog).toContain("t('bookDemoLesson')");
    expect(detailsDialog).toContain('<AlertDialog');
    expect(detailsDialog).toContain("t('cancelDemoLessonTitle')");
    expect(detailsDialog).toContain('cancelReason.trim()');
    expect(detailsDialog).toContain("t('demoNoShowReasonTitle')");
    expect(detailsDialog).toContain('confirmNoShowReason');
    expect(detailsDialog).toContain('noShowReasonCode');
    expect(detailsDialog).toContain("t('markDemoConductedTitle')");
    expect(detailsDialog).toContain("t('markDemoNotConductedTitle')");
    expect(detailsDialog).toContain("t('rescheduleDemoLessonTitle')");
    expect(detailsDialog).toContain("t('removeDemoParticipantTitle')");
    expect(detailsDialog).toContain('demoLessonsApi.removeParticipant');
  });

  it('stores attendance against participant rows without mutating lead lifecycle fields', () => {
    expect(routes).not.toContain('ownsLegacyBooking');
    expect(routes).not.toContain("currentStatus === 'demo_attended' ? 'demo_invited' : currentStatus");
    expect(routes).not.toContain('canAdvanceToDemoAttended');
    expect(routes).toContain('no_show_reason_code = $5');
    expect(routes).toContain('{ demoLesson: locked, participants: lockedParticipants }');
  });

  it('enrolls only selected students and can create missing student profiles in the modal flow', () => {
    expect(kanbanBoard).toContain("t('enrollInDemoLesson')");
    expect(kanbanBoard).toContain('<DemoLessonEnrollmentDialog');
    expect(enrollmentDialog).toContain('<Dialog');
    expect(enrollmentDialog).toContain('demoLessonsApi.list');
    expect(enrollmentDialog).toContain('demoLessonsApi.enroll');
    expect(enrollmentDialog).toContain('{ studentIds: selectedStudentIds }');
    expect(enrollmentDialog).toContain('CreateLeadStudentDialog');
    expect(enrollmentDialog).not.toContain('{ leadIds:');
  });

  it('migrates every historical lead participant to exactly one student', () => {
    expect(studentParticipantMigration).toContain('ADD COLUMN IF NOT EXISTS "student_id" integer');
    expect(studentParticipantMigration).toContain("'trial'");
    expect(studentParticipantMigration).toContain('Ambiguous demo participant');
    expect(studentParticipantMigration).toContain('ALTER COLUMN "student_id" SET NOT NULL');
    expect(studentParticipantMigration).toContain('DROP COLUMN IF EXISTS "lead_id"');
    expect(studentParticipantMigration).toContain('("demo_lesson_id", "student_id")');
    expect(journal.entries.find((entry) => entry.idx === 97)?.tag)
      .toBe('0097_demo_participants_are_students');
    expect(schema).toContain("studentId: integer('student_id')");
    expect(schema).not.toContain("leadId: integer('lead_id')");
  });

  it('offers all upcoming demos before creating a new lesson from lead details', () => {
    expect(routes).toContain("req.query.upcoming === 'true'");
    expect(enrollmentDialog).toContain('demoLessonsApi.listUpcoming');
    expect(enrollmentDialog).toContain("t('createDemoLesson')");
    expect(enrollmentDialog).toContain('onCreateNew');
    expect(leadDetailSheet).toContain('<DemoLessonEnrollmentDialog');
    expect(leadDetailSheet).toContain('setDemoEnrollmentOpen(true)');
    expect(leadDetailSheet).toContain('setCreateDemoOpen(true)');
  });
});
