import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, check, index, integer, pgTable, real, timestamp, uniqueIndex, uuid, varchar, type AnyPgColumn } from 'drizzle-orm/pg-core';

export const createVoiceReminderTables = (references: {
  userId: AnyPgColumn;
  demoLessonId: AnyPgColumn;
  participantId: AnyPgColumn;
}) => {
  const voiceReminderAudio = pgTable('voice_reminder_audio', {
    id: uuid('id').primaryKey(),
    fileName: varchar('file_name', { length: 180 }).notNull(),
    mimeType: varchar('mime_type', { length: 30 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationSeconds: real('duration_seconds').notNull(),
    storageKey: varchar('storage_key', { length: 80 }).notNull().unique(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    uploadedBy: integer('uploaded_by').references(() => references.userId, { onDelete: 'set null' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  }, table => ({
    mimeCheck: check('voice_reminder_audio_mime_type_check', sql`${table.mimeType} IN ('audio/mpeg', 'audio/wav')`),
    bytesCheck: check('voice_reminder_audio_size_bytes_check', sql`${table.sizeBytes} BETWEEN 1 AND 8388608`),
    durationCheck: check('voice_reminder_audio_duration_seconds_check', sql`${table.durationSeconds} > 0 AND ${table.durationSeconds} <= 180`),
    hashCheck: check('voice_reminder_audio_sha256_check', sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  }));

  const voiceReminderSettings = pgTable('voice_reminder_settings', {
    id: integer('id').primaryKey().default(1),
    enabled: boolean('enabled').notNull().default(false),
    leadMinutes: integer('lead_minutes').notNull().default(120),
    dayBeforeEnabled: boolean('day_before_enabled').notNull().default(false),
    dayBeforeStartTime: varchar('day_before_start_time', { length: 5 }).notNull().default('10:00'),
    dayBeforeEndTime: varchar('day_before_end_time', { length: 5 }).notNull().default('20:00'),
    dayBeforeIntroAudioId: uuid('day_before_intro_audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    maxAttempts: integer('max_attempts').notNull().default(2),
    retryMinutes: integer('retry_minutes').notNull().default(10),
    allowedStartTime: varchar('allowed_start_time', { length: 5 }).notNull().default('09:00'),
    allowedEndTime: varchar('allowed_end_time', { length: 5 }).notNull().default('20:00'),
    maxConcurrentCalls: integer('max_concurrent_calls').notNull().default(2),
    audioId: uuid('audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    introAudioId: uuid('intro_audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    outroAudioId: uuid('outro_audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    updatedBy: integer('updated_by').references(() => references.userId, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }, table => ({
    dayBeforeHoursCheck: check('voice_reminder_settings_day_before_hours_check', sql`${table.dayBeforeStartTime} >= '10:00' AND ${table.dayBeforeEndTime} <= '20:00' AND ${table.dayBeforeStartTime} < ${table.dayBeforeEndTime}`),
    dayBeforeStartCheck: check('voice_reminder_settings_day_before_start_time_check', sql`${table.dayBeforeStartTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    dayBeforeEndCheck: check('voice_reminder_settings_day_before_end_time_check', sql`${table.dayBeforeEndTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    dayBeforeAudioCheck: check('voice_reminder_settings_day_before_audio_check', sql`NOT (${table.enabled} AND ${table.dayBeforeEnabled}) OR ${table.dayBeforeIntroAudioId} IS NOT NULL`),
    singletonCheck: check('voice_reminder_settings_id_check', sql`${table.id} = 1`),
    leadCheck: check('voice_reminder_settings_lead_minutes_check', sql`${table.leadMinutes} BETWEEN 1 AND 1440`),
    attemptsCheck: check('voice_reminder_settings_max_attempts_check', sql`${table.maxAttempts} BETWEEN 1 AND 5`),
    retryCheck: check('voice_reminder_settings_retry_minutes_check', sql`${table.retryMinutes} BETWEEN 1 AND 60`),
    callsCheck: check('voice_reminder_settings_max_concurrent_calls_check', sql`${table.maxConcurrentCalls} BETWEEN 1 AND 2`),
    hoursCheck: check('voice_reminder_settings_hours_check', sql`${table.allowedStartTime} < ${table.allowedEndTime}`),
    startCheck: check('voice_reminder_settings_allowed_start_time_check', sql`${table.allowedStartTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    endCheck: check('voice_reminder_settings_allowed_end_time_check', sql`${table.allowedEndTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    enabledAudioCheck: check('voice_reminder_settings_modular_audio_check', sql`NOT ${table.enabled} OR (${table.introAudioId} IS NOT NULL AND ${table.outroAudioId} IS NOT NULL)`),
  }));

  const voiceReminderTimeAudio = pgTable('voice_reminder_time_audio', {
    time: varchar('time', { length: 5 }).primaryKey(),
    audioId: uuid('audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }).notNull(),
    updatedBy: integer('updated_by').references(() => references.userId, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }, table => ({
    timeCheck: check('voice_reminder_time_audio_time_check', sql`${table.time} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  }));

  const voiceReminderHourAudio = pgTable('voice_reminder_hour_audio', {
    hour: varchar('hour', { length: 2 }).primaryKey(),
    audioId: uuid('audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }).notNull(),
    updatedBy: integer('updated_by').references(() => references.userId, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }, table => ({ hourCheck: check('voice_reminder_hour_audio_hour_check', sql`${table.hour} ~ '^([01][0-9]|2[0-3])$'`) }));
  const voiceReminderMinuteAudio = pgTable('voice_reminder_minute_audio', {
    minute: varchar('minute', { length: 2 }).primaryKey(),
    audioId: uuid('audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }).notNull(),
    updatedBy: integer('updated_by').references(() => references.userId, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }, table => ({ minuteCheck: check('voice_reminder_minute_audio_minute_check', sql`${table.minute} ~ '^[0-5][0-9]$'`) }));

  const voiceReminderJobs = pgTable('voice_reminder_jobs', {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    demoLessonId: integer('demo_lesson_id').references(() => references.demoLessonId, { onDelete: 'cascade' }).notNull(),
    participantId: integer('participant_id').references(() => references.participantId, { onDelete: 'cascade' }).notNull(),
    reminderKind: varchar('reminder_kind', { length: 20 }).notNull().default('same_day'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    lessonRevision: integer('lesson_revision').notNull().default(0),
    participantRevision: integer('participant_revision').notNull().default(0),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    notBeforeAt: timestamp('not_before_at', { withTimezone: true }),
    status: varchar('status', { length: 20 }).notNull().default('waiting'),
    attempts: integer('attempts').notNull().default(0),
    phone: varchar('phone', { length: 20 }),
    audioId: uuid('audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    introAudioId: uuid('intro_audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    timeAudioId: uuid('time_audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    outroAudioId: uuid('outro_audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    audioClockTime: varchar('audio_clock_time', { length: 5 }),
    audioMode: varchar('audio_mode', { length: 10 }),
    hourAudioId: uuid('hour_audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    minuteAudioId: uuid('minute_audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    lastCallAt: timestamp('last_call_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    providerCallId: varchar('provider_call_id', { length: 160 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }, table => ({
    unique: uniqueIndex('voice_reminder_jobs_demo_participant_schedule_unique').on(table.demoLessonId, table.participantId, table.scheduledAt, table.lessonRevision, table.participantRevision, table.reminderKind),
    dueIndex: index('voice_reminder_jobs_due_idx').on(table.status, table.dueAt),
    leaseIndex: index('voice_reminder_jobs_lease_idx').on(table.leaseUntil).where(sql`${table.status} = 'calling'`),
    kindCheck: check('voice_reminder_jobs_reminder_kind_check', sql`${table.reminderKind} IN ('same_day','day_before')`),
    statusCheck: check('voice_reminder_jobs_status_check', sql`${table.status} IN ('waiting', 'calling', 'played', 'unanswered', 'failed', 'cancelled')`),
    attemptsCheck: check('voice_reminder_jobs_attempts_check', sql`${table.attempts} >= 0`),
    lessonRevisionCheck: check('voice_reminder_jobs_lesson_revision_check', sql`${table.lessonRevision} >= 0`),
    participantRevisionCheck: check('voice_reminder_jobs_participant_revision_check', sql`${table.participantRevision} >= 0`),
    clockTimeCheck: check('voice_reminder_jobs_audio_clock_time_check', sql`${table.audioClockTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    audioModeCheck: check('voice_reminder_jobs_audio_mode_check', sql`${table.audioMode} IN ('time', 'clock')`),
    audioPartsCheck: check('voice_reminder_jobs_audio_parts_check', sql`${table.audioMode} IS NULL
      OR (${table.audioMode} = 'time' AND ${table.timeAudioId} IS NOT NULL AND ${table.hourAudioId} IS NULL AND ${table.minuteAudioId} IS NULL)
      OR (${table.audioMode} = 'clock' AND ${table.timeAudioId} IS NULL AND ${table.hourAudioId} IS NOT NULL AND ${table.minuteAudioId} IS NOT NULL)`),
    leaseCheck: check('voice_reminder_jobs_lease_check', sql`(${table.status} = 'calling' AND ${table.leaseToken} IS NOT NULL AND ${table.leaseUntil} IS NOT NULL) OR (${table.status} <> 'calling' AND ${table.leaseToken} IS NULL AND ${table.leaseUntil} IS NULL)`),
  }));
  const voiceReminderTestCalls = pgTable('voice_reminder_test_calls', {
    id: uuid('id').primaryKey(),
    actorUserId: integer('actor_user_id').references(() => references.userId, { onDelete: 'set null' }),
    phone: varchar('phone', { length: 20 }).notNull(),
    reminderKind: varchar('reminder_kind', { length: 20 }).notNull().default('same_day'),
    clockTime: varchar('clock_time', { length: 5 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('waiting'),
    notBeforeAt: timestamp('not_before_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    audioMode: varchar('audio_mode', { length: 10 }),
    introAudioId: uuid('intro_audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    timeAudioId: uuid('time_audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    outroAudioId: uuid('outro_audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    hourAudioId: uuid('hour_audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    minuteAudioId: uuid('minute_audio_id').references(() => voiceReminderAudio.id, { onDelete: 'restrict' }),
    providerCallId: varchar('provider_call_id', { length: 160 }),
    dialStartedAt: timestamp('dial_started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }, table => ({
    actorActiveUnique: uniqueIndex('voice_reminder_test_calls_actor_active_unique').on(table.actorUserId)
      .where(sql`${table.status} IN ('waiting','calling')`),
    dueIndex: index('voice_reminder_test_calls_due_idx').on(table.status, table.notBeforeAt, table.expiresAt),
    currentIndex: index('voice_reminder_test_calls_actor_current_idx').on(table.actorUserId, sql`${table.createdAt} DESC`),
    kindCheck: check('voice_reminder_test_calls_reminder_kind_check', sql`${table.reminderKind} IN ('same_day','day_before')`),
    phoneCheck: check('voice_reminder_test_calls_phone_check', sql`${table.phone} ~ '^[+][1-9][0-9]{7,14}$'`),
    clockCheck: check('voice_reminder_test_calls_clock_time_check', sql`${table.clockTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    statusCheck: check('voice_reminder_test_calls_status_check', sql`${table.status} IN ('waiting','calling','played','unanswered','failed','cancelled')`),
    modeCheck: check('voice_reminder_test_calls_audio_mode_check', sql`${table.audioMode} IN ('time','clock')`),
    leaseCheck: check('voice_reminder_test_calls_lease_check', sql`(${table.status} = 'calling' AND ${table.leaseToken} IS NOT NULL AND ${table.leaseUntil} IS NOT NULL)
      OR (${table.status} <> 'calling' AND ${table.leaseToken} IS NULL AND ${table.leaseUntil} IS NULL)`),
    partsCheck: check('voice_reminder_test_calls_audio_parts_check', sql`${table.audioMode} IS NULL
      OR (${table.audioMode} = 'time' AND ${table.introAudioId} IS NOT NULL AND ${table.outroAudioId} IS NOT NULL
        AND ${table.timeAudioId} IS NOT NULL AND ${table.hourAudioId} IS NULL AND ${table.minuteAudioId} IS NULL)
      OR (${table.audioMode} = 'clock' AND ${table.introAudioId} IS NOT NULL AND ${table.outroAudioId} IS NOT NULL
        AND ${table.timeAudioId} IS NULL AND ${table.hourAudioId} IS NOT NULL AND ${table.minuteAudioId} IS NOT NULL)`),
  }));
  const telephonyLineReservations = pgTable('telephony_line_reservations', {
    id: uuid('id').primaryKey(),
    extension: varchar('extension', { length: 20 }).notNull().unique(),
    ownerType: varchar('owner_type', { length: 20 }).notNull(),
    ownerUserId: integer('owner_user_id').references(() => references.userId, { onDelete: 'set null' }),
    clientCallId: varchar('client_call_id', { length: 160 }).notNull(),
    phone: varchar('phone', { length: 20 }),
    jobId: bigint('job_id', { mode: 'number' }).references(() => voiceReminderJobs.id, { onDelete: 'set null' }),
    testCallId: uuid('test_call_id').references(() => voiceReminderTestCalls.id, { onDelete: 'set null' }),
    leaseUntil: timestamp('lease_until', { withTimezone: true }).notNull(),
    dialAuthorizedAt: timestamp('dial_authorized_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }, table => ({
    ownerCheck: check('telephony_line_reservations_owner_type_check', sql`${table.ownerType} IN ('manager', 'robot')`),
    leaseIndex: index('telephony_line_reservations_lease_idx').on(table.leaseUntil),
  }));
  const voiceReminderCallAttempts = pgTable('voice_reminder_call_attempts', {
    callId: uuid('call_id').primaryKey(),
    jobId: bigint('job_id', { mode: 'number' }).references(() => voiceReminderJobs.id, { onDelete: 'set null' }),
    testCallId: uuid('test_call_id').references(() => voiceReminderTestCalls.id, { onDelete: 'set null' }),
    extension: varchar('extension', { length: 20 }).notNull(),
    phone: varchar('phone', { length: 20 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    providerId: varchar('provider_id', { length: 160 }).unique(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    terminationConfirmedAt: timestamp('termination_confirmed_at', { withTimezone: true }),
  }, table => ({
    matchIndex: index('voice_reminder_call_attempts_match_idx').on(table.phone, table.extension, table.startedAt),
    unresolvedIndex: index('voice_reminder_call_attempts_unresolved_idx').on(table.startedAt).where(sql`${table.terminationConfirmedAt} IS NULL`),
    testUnique: uniqueIndex('voice_reminder_call_attempts_test_unique').on(table.testCallId).where(sql`${table.testCallId} IS NOT NULL`),
  }));
  const voiceReminderProviderQuarantine = pgTable('voice_reminder_provider_quarantine', {
    providerId: varchar('provider_id', { length: 160 }).primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  });
  return { voiceReminderAudio, voiceReminderSettings, voiceReminderTimeAudio, voiceReminderHourAudio, voiceReminderMinuteAudio, voiceReminderJobs, voiceReminderTestCalls, telephonyLineReservations, voiceReminderCallAttempts, voiceReminderProviderQuarantine };
};
