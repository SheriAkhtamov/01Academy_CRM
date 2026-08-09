import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  demoLessonEnrollmentSchema,
  demoLessonMutationSchema,
  demoLessonResourceAvailabilitySchema,
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
const schema = readFileSync(
  new URL('../server/db/schema/demo-lessons.ts', import.meta.url),
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
  capacity: 2,
  participantIds: [10, 11],
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

  it('registers migration 0074 after the module terminology migration', () => {
    expect(journal.entries.find((entry) => entry.idx === 73)?.tag)
      .toBe('0073_rename_workspaces_to_modules');
    expect(journal.entries.find((entry) => entry.idx === 74)?.tag)
      .toBe('0074_add_demo_lessons');
    expect(journal.entries.filter((entry) => entry.idx === 74)).toHaveLength(1);
  });

  it('creates a demo lesson without participants and without an explicit capacity', () => {
    const { capacity, participantIds, ...schedule } = validMutation;
    const empty = demoLessonMutationSchema.safeParse(schedule);
    expect(empty.success).toBe(true);
    expect(empty.data?.participantIds).toEqual([]);
    expect(empty.data?.capacity).toBeUndefined();
    expect(capacity).toBe(2);
    expect(participantIds).toHaveLength(2);
    expect(routes).toContain('resolveDemoCapacity');
    expect(routes).toContain('capacity: resources.capacity');
    expect(createDialog).not.toContain("t('demoParticipants')");
    expect(createDialog).not.toContain('demoParticipantsSelected');
  });

  it('validates room, capacity and unique participants before transport', () => {
    expect(demoLessonMutationSchema.safeParse(validMutation).success).toBe(true);
    const overCapacity = demoLessonMutationSchema.safeParse({
      ...validMutation,
      capacity: 1,
    });
    expect(overCapacity.success).toBe(false);
    expect(overCapacity.error?.issues[0]?.message).toBe('demoCapacityExceeded');
    const noRoom = demoLessonMutationSchema.safeParse({ ...validMutation, roomId: null });
    expect(noRoom.success).toBe(false);
    expect(noRoom.error?.issues[0]?.message).toBe('demoRoomRequired');
    const duplicate = demoLessonMutationSchema.safeParse({
      ...validMutation,
      participantIds: [10, 10],
    });
    expect(duplicate.success).toBe(false);
    expect(duplicate.error?.issues[0]?.message).toBe('duplicateDemoParticipants');
    expect(demoLessonResourceAvailabilitySchema.safeParse({
      courseId: 1,
      schoolId: 2,
      scheduledAt: validMutation.scheduledAt,
      durationMinutes: 45,
      format: 'offline',
      participantIds: [],
    }).success).toBe(true);
    expect(demoLessonEnrollmentSchema.safeParse({ leadIds: [10] }).success).toBe(true);
    expect(demoLessonEnrollmentSchema.safeParse({ leadIds: [10, 10] }).success).toBe(false);
  });

  it('rechecks all resources under the academy scheduling lock', () => {
    expect(routes).toContain('pg_advisory_xact_lock');
    expect(routes).toContain('assertTeacherCanLeadLesson');
    expect(routes).toContain('assertLessonRoomAvailable');
    expect(routes).toContain('assertParticipantAvailability');
    expect(routes).toContain("router.post('/demo-lessons'");
    expect(routes).toContain("router.post('/demo-lessons/resource-availability'");
    expect(routes).toContain("router.post('/demo-lessons/:id/cancel'");
    expect(routes).toContain("router.post('/demo-lessons/:id/attendance'");
    expect(routes).toContain("router.post('/demo-lessons/:id/participants'");
    expect(routes).toContain('ADD_ACADEMY_DEMO_PARTICIPANTS');
    expect(routes).toContain('demoParticipantAlreadyEnrolled');
    expect(routes).toContain('Number(activeParticipants?.count ?? 0) + leads.length');
    expect(scheduling).toContain('FROM academy_demo_lessons');
    expect(scheduling).toContain('Number(lesson.roomId) !== roomId');
    expect(routes).toContain('legacyConflict');
    expect(scheduling).toContain('participantBusyByLegacyDemo');
    expect(resourceAvailability).toContain('FROM academy_lessons');
    expect(resourceAvailability).toContain('FROM academy_demo_lessons');
    expect(resourceAvailability).toContain("status IN ('open', 'in_progress')");
    expect(resourceAvailability).toContain('busyTeacherIds');
    expect(resourceAvailability).toContain('busyRoomIds');
  });

  it('disables enrollment when the lead is already booked, the demo is full, or times overlap', () => {
    const target: DemoLesson = {
      id: 1,
      courseId: 1,
      schoolId: 1,
      teacherId: 1,
      scheduledAt: '2030-07-15T05:00:00.000Z',
      durationMinutes: 60,
      format: 'offline',
      capacity: 2,
      status: 'scheduled',
      participants: [],
    };
    expect(getDemoEnrollmentState(target, 10, [target], 0)).toBe('available');
    expect(getDemoEnrollmentState({
      ...target,
      participants: [{ id: 1, leadId: 10, status: 'invited' }],
    }, 10, [target], 0)).toBe('already_enrolled');
    expect(getDemoEnrollmentState({
      ...target,
      capacity: 1,
      participants: [{ id: 1, leadId: 11, status: 'confirmed' }],
    }, 10, [target], 0)).toBe('full');
    const overlapping: DemoLesson = {
      ...target,
      id: 2,
      scheduledAt: '2030-07-15T05:30:00.000Z',
      participants: [{ id: 2, leadId: 10, status: 'invited' }],
    };
    expect(getDemoEnrollmentState(target, 10, [target, overlapping], 0)).toBe('lead_busy');
  });

  it('renders demo events alongside lessons in the weekly calendar', () => {
    const weekStart = new Date(2030, 6, 15);
    const events = buildSalesDemoScheduleEvents([{
      id: 9,
      courseName: 'Vibe Coding',
      teacherName: 'Teacher',
      roomName: 'Room 2',
      scheduledAt: new Date(2030, 6, 15, 10, 0).toISOString(),
      durationMinutes: 60,
      status: 'scheduled',
      participants: [{ leadId: 10 }, { leadId: 11 }],
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
  });

  it('enrolls directly from lead cards through an existing-demo dialog without creating a student', () => {
    expect(kanbanBoard).toContain("t('enrollInDemoLesson')");
    expect(kanbanBoard).toContain('<DemoLessonEnrollmentDialog');
    expect(enrollmentDialog).toContain('<Dialog');
    expect(enrollmentDialog).toContain('demoLessonsApi.list');
    expect(enrollmentDialog).toContain('demoLessonsApi.enroll');
    expect(enrollmentDialog).not.toContain('studentsApi');
    expect(enrollmentDialog).not.toContain('CreateLeadStudentDialog');
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
