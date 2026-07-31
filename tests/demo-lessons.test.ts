import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoLessonMutationSchema } from '../shared/contracts/demo-lessons';
import { buildSalesDemoScheduleEvents } from '../client/src/lib/salesSchedule';

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
const createDialog = readFileSync(
  new URL('../client/src/components/ux/DemoLessonDialog.tsx', import.meta.url),
  'utf8',
);
const detailsDialog = readFileSync(
  new URL('../client/src/components/ux/DemoLessonDetailsDialog.tsx', import.meta.url),
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

  it('validates room, capacity and unique participants before transport', () => {
    expect(demoLessonMutationSchema.safeParse(validMutation).success).toBe(true);
    const noRoom = demoLessonMutationSchema.safeParse({ ...validMutation, roomId: null });
    expect(noRoom.success).toBe(false);
    expect(noRoom.error?.issues[0]?.message).toBe('demoRoomRequired');
    const duplicate = demoLessonMutationSchema.safeParse({
      ...validMutation,
      participantIds: [10, 10],
    });
    expect(duplicate.success).toBe(false);
    expect(duplicate.error?.issues[0]?.message).toBe('duplicateDemoParticipants');
  });

  it('rechecks all resources under the academy scheduling lock', () => {
    expect(routes).toContain('pg_advisory_xact_lock');
    expect(routes).toContain('assertTeacherCanLeadLesson');
    expect(routes).toContain('assertLessonRoomAvailable');
    expect(routes).toContain('assertParticipantAvailability');
    expect(routes).toContain("router.post('/demo-lessons'");
    expect(routes).toContain("router.post('/demo-lessons/:id/cancel'");
    expect(routes).toContain("router.post('/demo-lessons/:id/attendance'");
    expect(scheduling).toContain('FROM academy_demo_lessons');
    expect(scheduling).toContain('Number(lesson.roomId) !== roomId');
    expect(routes).toContain('legacyConflict');
    expect(scheduling).toContain('participantBusyByLegacyDemo');
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
    expect(createDialog).toContain('<AvailabilityCalendar');
    expect(createDialog).toContain("t('bookDemoLesson')");
    expect(detailsDialog).toContain('<AlertDialog');
    expect(detailsDialog).toContain("t('cancelDemoLessonTitle')");
    expect(detailsDialog).toContain('cancelReason.trim()');
  });
});
