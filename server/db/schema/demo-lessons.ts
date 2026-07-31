import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const createAcademyDemoTables = (references: {
  courseId: AnyPgColumn;
  schoolId: AnyPgColumn;
  roomId: AnyPgColumn;
  teacherId: AnyPgColumn;
  leadId: AnyPgColumn;
  userId: AnyPgColumn;
}) => {
  const academyDemoLessons = pgTable('academy_demo_lessons', {
    id: serial('id').primaryKey(),
    courseId: integer('course_id').references(() => references.courseId, { onDelete: 'restrict' }).notNull(),
    schoolId: integer('school_id').references(() => references.schoolId, { onDelete: 'restrict' }).notNull(),
    roomId: integer('room_id').references(() => references.roomId, { onDelete: 'restrict' }),
    teacherId: integer('teacher_id').references(() => references.teacherId, { onDelete: 'restrict' }).notNull(),
    scheduledAt: timestamp('scheduled_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(60),
    format: varchar('format', { length: 20 }).notNull().default('offline'),
    capacity: integer('capacity').notNull().default(1),
    status: varchar('status', { length: 30 }).notNull().default('scheduled'),
    notes: text('notes'),
    cancellationReason: text('cancellation_reason'),
    createdBy: integer('created_by').references(() => references.userId, { onDelete: 'set null' }),
    updatedBy: integer('updated_by').references(() => references.userId, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  }, (table) => ({
    scheduleIdx: index('academy_demo_lessons_schedule_idx').on(table.scheduledAt, table.status),
    roomIdx: index('academy_demo_lessons_room_idx').on(table.roomId, table.scheduledAt),
    teacherIdx: index('academy_demo_lessons_teacher_idx').on(table.teacherId, table.scheduledAt),
    schoolIdx: index('academy_demo_lessons_school_idx').on(table.schoolId, table.scheduledAt),
    durationCheck: check('academy_demo_lessons_duration_check', sql`${table.durationMinutes} BETWEEN 15 AND 480`),
    capacityCheck: check('academy_demo_lessons_capacity_check', sql`${table.capacity} BETWEEN 1 AND 100`),
    formatCheck: check('academy_demo_lessons_format_check', sql`${table.format} IN ('offline', 'online')`),
    statusCheck: check('academy_demo_lessons_status_check', sql`${table.status} IN ('scheduled', 'completed', 'cancelled')`),
    roomFormatCheck: check(
      'academy_demo_lessons_room_format_check',
      sql`(${table.format} = 'offline' AND ${table.roomId} IS NOT NULL) OR (${table.format} = 'online' AND ${table.roomId} IS NULL)`,
    ),
  }));

  const academyDemoLessonParticipants = pgTable('academy_demo_lesson_participants', {
    id: serial('id').primaryKey(),
    demoLessonId: integer('demo_lesson_id')
      .references(() => academyDemoLessons.id, { onDelete: 'cascade' }).notNull(),
    leadId: integer('lead_id').references(() => references.leadId, { onDelete: 'cascade' }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default('invited'),
    result: text('result'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  }, (table) => ({
    participantUnique: uniqueIndex('academy_demo_lesson_participants_unique')
      .on(table.demoLessonId, table.leadId),
    leadIdx: index('academy_demo_lesson_participants_lead_idx').on(table.leadId, table.demoLessonId),
    statusCheck: check(
      'academy_demo_lesson_participants_status_check',
      sql`${table.status} IN ('invited', 'confirmed', 'attended', 'no_show', 'cancelled')`,
    ),
  }));

  return { academyDemoLessons, academyDemoLessonParticipants };
};
