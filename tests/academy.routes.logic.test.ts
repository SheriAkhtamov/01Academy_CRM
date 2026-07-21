import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: { id: 1, workspace: 'administration', workspaces: ['administration'] } as any,
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  connect: vi.fn(),
  release: vi.fn(),
  createAuditLog: vi.fn(),
  createNotification: vi.fn(),
  runAutomations: vi.fn(),
  getWorkforcePolicy: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../server/db', () => ({
  pool: {
    query: mocks.poolQuery,
    connect: mocks.connect,
  },
}));

vi.mock('../server/middleware/auth.middleware', () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.user = mocks.actor;
    next();
  },
}));

vi.mock('../server/storage', () => ({
  storage: {
    createAuditLog: mocks.createAuditLog,
    createNotification: mocks.createNotification,
  },
}));

vi.mock('../server/config', () => ({ appConfig: { integrations: {} } }));
vi.mock('../server/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../server/services/workforce-policy', () => ({
  getWorkforcePolicy: mocks.getWorkforcePolicy,
  maskPhone: (value: string) => value,
}));
vi.mock('../server/services/automations', () => ({
  runAutomations: mocks.runAutomations,
}));

const emptyResult = () => ({ rows: [] });

const createApp = async () => {
  const { default: academyRoutes } = await import('../server/routes/academy.routes');
  const app = express();
  app.use(express.json());
  app.use('/api/academy', academyRoutes);
  return app;
};

const readInsertValue = (sql: string, values: unknown[], column: string) => {
  const columns = sql.match(/\(([^)]+)\) VALUES/)?.[1]
    .split(',')
    .map((entry) => entry.trim().replace(/"/g, '')) ?? [];
  return values[columns.indexOf(column)];
};

const leadFixture = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  contact_name: 'Parent',
  student_name: 'Student',
  student_age: 12,
  course_id: 3,
  source_id: 2,
  status_code: 'new_request',
  manager_id: 1,
  enrolled_group_id: null,
  offer_course_id: 8,
  referrer_student_id: 7,
  updated_at: new Date('2026-07-10T10:00:00.000Z'),
  ...overrides,
});

const groupFixture = (overrides: Record<string, unknown> = {}) => ({
  id: 20,
  name: 'Vibe Coding 01',
  course_id: 1,
  school_id: 2,
  room_id: 3,
  teacher_id: 4,
  schedule: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00', schoolId: 2 }],
  lesson_count: 10,
  lesson_duration_minutes: 60,
  duration_days: 60,
  frequency: 'weekly',
  max_students: 12,
  status: 'in_progress',
  start_date: new Date('2026-07-01T00:00:00.000Z'),
  end_date: new Date('2026-09-01T00:00:00.000Z'),
  ...overrides,
});

const lessonFixture = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  group_id: 20,
  course_id: 1,
  school_id: 2,
  room_id: 3,
  teacher_id: 4,
  teacher_user_id: 1,
  lesson_number: 1,
  duration_minutes: 60,
  status: 'scheduled',
  scheduled_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  ...overrides,
});

describe('academy route logic boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor = { id: 1, workspace: 'administration', workspaces: ['administration'] };
    mocks.poolQuery.mockResolvedValue(emptyResult());
    mocks.clientQuery.mockResolvedValue(emptyResult());
    mocks.connect.mockImplementation(async () => ({
      query: mocks.clientQuery,
      release: mocks.release,
    }));
    mocks.createAuditLog.mockResolvedValue(undefined);
    mocks.createNotification.mockResolvedValue(undefined);
    mocks.runAutomations.mockResolvedValue([]);
    mocks.getWorkforcePolicy.mockResolvedValue({ salesPhoneVisibility: 'own_leads' });
  });

  it('returns the connected Instagram account identity needed by the disconnect action', async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM academy_integration_logs')) return emptyResult();
      if (sql.includes('FROM instagram_accounts')) {
        expect(sql).toContain("WHERE status = 'connected'");
        expect(sql).toContain('ORDER BY updated_at DESC, id DESC');
        expect(sql).toContain('LIMIT 1');
        return { rows: [{ id: 17, username: '01academy_uz' }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp()).get('/api/academy/integrations/status');

    expect(response.status).toBe(200);
    expect(response.body).toContainEqual(expect.objectContaining({
      provider: 'instagram',
      connected: true,
      accountId: 17,
      accountUsername: '01academy_uz',
    }));
  });

  it('shows full own and unassigned lead cards to sales while excluding other managers', async () => {
    mocks.actor = { id: 7, workspace: 'sales', workspaces: ['sales'] };
    mocks.poolQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('FROM academy_company_settings')) return { rows: [{ id: 1 }] };
      if (sql.includes('SELECT l.*') && sql.includes('COALESCE(l.is_archived, false) = false')) {
        expect(sql).toContain('AND (l.manager_id = $1 OR l.manager_id IS NULL)');
        expect(values).toEqual([7]);
        return {
          rows: [
            { id: 1, contact_name: 'Own lead', manager_id: 7, phone: '+998901111111', phone_numbers: ['+998901111111'] },
            { id: 2, contact_name: 'Unassigned lead', manager_id: null, phone: '+998902222222', phone_numbers: ['+998902222222'] },
            { id: 3, contact_name: 'Other lead', manager_id: 8, phone: '+998903333333', phone_numbers: ['+998903333333'] },
          ],
        };
      }
      if (sql.includes('SELECT l.*') && sql.includes('COALESCE(l.is_archived, false) = true')) {
        expect(sql).toContain('AND (l.manager_id = $1 OR l.manager_id IS NULL)');
        expect(values).toEqual([7]);
        return {
          rows: [
            { id: 4, contact_name: 'Own archived lead', manager_id: 7, phone: '+998904444444', phone_numbers: ['+998904444444'] },
            { id: 5, contact_name: 'Other archived lead', manager_id: 8, phone: '+998905555555', phone_numbers: ['+998905555555'] },
          ],
        };
      }
      return emptyResult();
    });

    const response = await request(await createApp()).get('/api/academy/workspaces/sales');

    expect(response.status, String(mocks.loggerError.mock.calls[0]?.[1]?.error?.stack)).toBe(200);
    expect(response.body.leads).toEqual([
      expect.objectContaining({ id: 1, phone: '+998901111111' }),
      expect.objectContaining({ id: 2, phone: '+998902222222' }),
    ]);
    expect(response.body.archivedLeads).toEqual([
      expect.objectContaining({ id: 4, phone: '+998904444444' }),
    ]);
  });

  it('shows every manager lead with full data to an administration user', async () => {
    mocks.actor = {
      id: 1,
      workspace: 'administration',
      workspaces: ['administration', 'sales'],
    };
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM academy_company_settings')) return { rows: [{ id: 1 }] };
      if (sql.includes('SELECT l.*') && sql.includes('COALESCE(l.is_archived, false) = false')) {
        expect(sql).not.toContain('AND (l.manager_id = $1 OR l.manager_id IS NULL)');
        return {
          rows: [
            { id: 1, contact_name: 'First manager lead', manager_id: 7, phone: '+998901111111' },
            { id: 2, contact_name: 'Second manager lead', manager_id: 8, phone: '+998902222222' },
          ],
        };
      }
      return emptyResult();
    });

    const response = await request(await createApp()).get('/api/academy/workspaces/sales');

    expect(response.status, String(mocks.loggerError.mock.calls[0]?.[1]?.error?.stack)).toBe(200);
    expect(response.body.leads).toEqual([
      expect.objectContaining({ id: 1, managerId: 7, phone: '+998901111111' }),
      expect.objectContaining({ id: 2, managerId: 8, phone: '+998902222222' }),
    ]);
    expect(mocks.getWorkforcePolicy).not.toHaveBeenCalled();
  });

  it('denies a sales employee direct access to another manager archived lead', async () => {
    mocks.actor = { id: 7, workspace: 'sales', workspaces: ['sales'] };
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('WHERE l.id = $1')) {
        return {
          rows: [{
            id: 42,
            contact_name: 'Other archived lead',
            manager_id: 8,
            phone: '+998903333333',
            is_archived: true,
          }],
        };
      }
      return emptyResult();
    });

    const response = await request(await createApp()).get('/api/academy/leads/42');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Lead access required');
  });

  it('does not expose legacy lead group reservations as student enrollments', async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM academy_leads l') && sql.includes('WHERE l.id = $1')) {
        return {
          rows: [leadFixture({
            enrolled_group_id: 10,
            lead_groups: [
              { groupId: 10, groupName: 'Primary', isPrimary: true },
              { groupId: 20, groupName: 'Secondary', isPrimary: false },
            ],
            lead_group_ids: [10, 20],
          })],
        };
      }
      return emptyResult();
    });

    const response = await request(await createApp()).get('/api/academy/leads/42');

    expect(response.status).toBe(200);
    expect(response.body.studentId).toBeNull();
    expect(response.body.groupIds).toEqual([]);
    expect(response.body.groups).toEqual([]);
    expect(response.body.students).toEqual([]);
  });

  it('defers assignment notifications and audits until the archive transaction commits', async () => {
    mocks.actor = { id: 7, workspace: 'sales', workspaces: ['sales'] };
    const events: string[] = [];
    const unassignedLead = leadFixture({
      id: 1679,
      contact_name: '100k 💪',
      manager_id: null,
      is_archived: false,
    });
    const assignedLead = {
      ...unassignedLead,
      manager_id: 7,
      manager_name: 'Абдурахманова Хонзода',
    };
    const archivedLead = {
      ...assignedLead,
      is_archived: true,
      archive_reason: 'no_answer',
      archived_by: 7,
    };
    let leadFetchCount = 0;

    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('WHERE l.id = $1')) {
        leadFetchCount += 1;
        return { rows: [leadFetchCount === 1 ? unassignedLead : archivedLead] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        events.push(sql);
        return emptyResult();
      }
      if (sql.includes('SELECT id, full_name') && sql.includes('FROM users u')) {
        return { rows: [{ id: 7, full_name: 'Абдурахманова Хонзода' }] };
      }
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE')) {
        return { rows: [unassignedLead] };
      }
      if (sql.includes('UPDATE "academy_leads"') && sql.includes('"manager_id" = $2')) {
        return { rows: [assignedLead] };
      }
      if (sql.includes('UPDATE "academy_leads"') && sql.includes('"is_archived" = $2')) {
        return { rows: [archivedLead] };
      }
      if (sql.includes('INSERT INTO "academy_lead_assignment_history"')) {
        return { rows: [{ id: 1, lead_id: 1679, to_manager_id: 7 }] };
      }
      return emptyResult();
    });
    mocks.createNotification.mockImplementation(async () => {
      events.push('NOTIFICATION');
      return undefined;
    });
    mocks.createAuditLog.mockImplementation(async (entry: { action: string }) => {
      events.push(`AUDIT:${entry.action}`);
      return undefined;
    });

    const response = await request(await createApp())
      .post('/api/academy/leads/1679/archive')
      .send({ reason: 'no_answer', assignToSelf: true });

    expect(response.status, String(mocks.loggerError.mock.calls[0]?.[1]?.error?.stack)).toBe(200);
    expect(response.body).toMatchObject({
      id: 1679,
      managerId: 7,
      isArchived: true,
      archiveReason: 'no_answer',
    });
    expect(events).toEqual([
      'BEGIN',
      'COMMIT',
      'NOTIFICATION',
      'AUDIT:ASSIGN_ACADEMY_LEAD',
      'AUDIT:ARCHIVE_ACADEMY_LEAD',
    ]);
  });

  it('requires and stores a handwritten reason when archiving with the other option', async () => {
    const lead = leadFixture({ id: 1679, manager_id: 1, is_archived: false });
    const archivedLead = {
      ...lead,
      is_archived: true,
      archive_reason: 'Родитель попросил связаться осенью',
      archived_by: 1,
    };
    let archivedPersisted = false;
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('WHERE l.id = $1')) {
        return { rows: [archivedPersisted ? archivedLead : lead] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('UPDATE "academy_leads"') && sql.includes('"is_archived" = $2')) {
        archivedPersisted = true;
        return { rows: [archivedLead] };
      }
      return emptyResult();
    });
    const app = await createApp();

    const missingReason = await request(app)
      .post('/api/academy/leads/1679/archive')
      .send({ reason: 'other' });
    expect(missingReason.status).toBe(400);
    expect(missingReason.body.error).toBe('archiveCustomReasonRequired');

    const response = await request(app)
      .post('/api/academy/leads/1679/archive')
      .send({ reason: 'other', customReason: '  Родитель попросил связаться осенью  ' });

    expect(response.status, String(mocks.loggerError.mock.calls[0]?.[1]?.error?.stack)).toBe(200);
    expect(response.body.archiveReason).toBe('Родитель попросил связаться осенью');
    const archiveUpdate = mocks.clientQuery.mock.calls.find(([sql]) => (
      String(sql).includes('UPDATE "academy_leads"') && String(sql).includes('"archive_reason"')
    ));
    expect(archiveUpdate?.[1]).toContain('Родитель попросил связаться осенью');
  });

  it('discards deferred side effects when an archive transaction rolls back', async () => {
    mocks.actor = { id: 7, workspace: 'sales', workspaces: ['sales'] };
    const events: string[] = [];
    const unassignedLead = leadFixture({
      id: 1679,
      contact_name: '100k 💪',
      manager_id: null,
      is_archived: false,
    });
    const assignedLead = { ...unassignedLead, manager_id: 7 };

    mocks.poolQuery.mockImplementation(async (sql: string) => (
      sql.includes('WHERE l.id = $1') ? { rows: [unassignedLead] } : emptyResult()
    ));
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        events.push(sql);
        return emptyResult();
      }
      if (sql.includes('SELECT id, full_name') && sql.includes('FROM users u')) {
        return { rows: [{ id: 7, full_name: 'Абдурахманова Хонзода' }] };
      }
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE')) {
        return { rows: [unassignedLead] };
      }
      if (sql.includes('UPDATE "academy_leads"') && sql.includes('"manager_id" = $2')) {
        return { rows: [assignedLead] };
      }
      if (sql.includes('UPDATE "academy_leads"') && sql.includes('"is_archived" = $2')) {
        return emptyResult();
      }
      if (sql.includes('INSERT INTO "academy_lead_assignment_history"')) {
        return { rows: [{ id: 1, lead_id: 1679, to_manager_id: 7 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/leads/1679/archive')
      .send({ reason: 'no_answer', assignToSelf: true });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Lead not found');
    expect(events).toEqual(['BEGIN', 'ROLLBACK']);
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it('fails closed when a teacher workspace has no teacher profile mapping', async () => {
    mocks.actor = { id: 7, workspace: 'teacher', workspaces: ['teacher'] };
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM academy_teachers WHERE user_id')) return emptyResult();
      if (sql.includes('FROM academy_groups g') && !sql.includes('WHERE g.teacher_id = $1')) {
        return { rows: [{ id: 999, name: 'Other teacher group' }] };
      }
      if (sql.includes('SELECT st.*') && !sql.includes('teacher_membership')) {
        return { rows: [{ id: 999, student_name: 'Other teacher student' }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp()).get('/api/academy/workspaces/teacher');

    expect(response.status).toBe(200);
    expect(response.body.teacher).toBeNull();
    expect(response.body.groups).toEqual([]);
    expect(response.body.students).toEqual([]);
  });

  it('scopes a leadership account to its own teacher profile inside the teacher workspace', async () => {
    mocks.actor = {
      id: 1,
      workspace: 'administration',
      workspaces: ['administration', 'teacher'],
      position: 'Глобальный администратор',
    };
    mocks.poolQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('SELECT id FROM academy_teachers WHERE user_id')) {
        return { rows: [{ id: 4 }] };
      }
      if (sql.includes('SELECT * FROM academy_teachers WHERE id = $1')) {
        return { rows: [{ id: 4, user_id: 1, full_name: 'Шерзод Ахтамов' }] };
      }
      if (sql.includes('FROM academy_groups g')) {
        return sql.includes('WHERE g.teacher_id = $1')
          ? { rows: [{ id: 20, name: 'My group', teacher_id: 4 }] }
          : { rows: [{ id: 999, name: 'Another teacher group', teacher_id: 8 }] };
      }
      if (sql.includes('SELECT st.*')) {
        return sql.includes('teacher_membership') && sql.includes('teacher_group.teacher_id = $1')
          ? { rows: [{ id: 30, student_name: 'My student', group_id: 20 }] }
          : { rows: [{ id: 999, student_name: 'Another teacher student', group_id: 99 }] };
      }
      if (sql.includes('SELECT l.*, g.name AS group_name')) {
        return sql.includes('AND l.teacher_id = $1')
          ? { rows: [{ id: 40, group_id: 20, teacher_id: 4, topic: 'My lesson' }] }
          : { rows: [{ id: 999, group_id: 99, teacher_id: 8, topic: 'Another lesson' }] };
      }
      if (sql.includes('SELECT a.*') && sql.includes('FROM academy_attendance')) {
        expect(values).toEqual([4]);
        return emptyResult();
      }
      return emptyResult();
    });

    const response = await request(await createApp()).get('/api/academy/workspaces/teacher');

    expect(response.status).toBe(200);
    expect(response.body.teacher).toMatchObject({ id: 4, fullName: 'Шерзод Ахтамов' });
    expect(response.body.groups).toEqual([expect.objectContaining({ id: 20, teacherId: 4 })]);
    expect(response.body.students).toEqual([expect.objectContaining({ id: 30, groupId: 20 })]);
    expect(response.body.lessons).toEqual([expect.objectContaining({ id: 40, teacherId: 4 })]);
    expect(mocks.poolQuery.mock.calls.some(([sql, values]) => (
      String(sql).includes('AND l.teacher_id = $1') && Number(values?.[0]) === 4
    ))).toBe(true);
  });

  it('does not let a sales-only user mark lesson attendance', async () => {
    mocks.actor = { id: 8, workspace: 'sales', workspaces: ['sales'] };

    const response = await request(await createApp())
      .post('/api/academy/lessons/10/attendance')
      .send({ attendance: [] });

    expect(response.status).toBe(403);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('does not let a teacher change availability outside Administration', async () => {
    mocks.actor = { id: 8, workspace: 'teacher', workspaces: ['teacher'] };

    const response = await request(await createApp())
      .patch('/api/academy/teachers/me/availability')
      .send({ schoolIds: [2], availability: [] });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('adminAccessRequired');
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('rejects malformed attendance instead of silently turning it into an absence', async () => {
    const response = await request(await createApp())
      .post('/api/academy/lessons/10/attendance')
      .send({ attendance: [{ studentId: 5, status: 'late' }] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid attendance item');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('checks lesson ownership under lock before a teacher marks attendance', async () => {
    mocks.actor = { id: 8, workspace: 'teacher', workspaces: ['teacher'] };
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('FOR UPDATE OF l')) {
        return {
          rows: [{
            id: 10,
            group_id: 20,
            status: 'scheduled',
            teacher_user_id: 99,
          }],
        };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/lessons/10/attendance')
      .send({ attendance: [{ studentId: 5, status: 'present' }] });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('teacherOwnLessonAttendanceOnly');
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('does not let a scheduled lesson be completed before it starts', async () => {
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000);
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('FOR UPDATE OF l')) {
        return {
          rows: [{
            id: 10,
            group_id: 20,
            status: 'scheduled',
            scheduled_at: scheduledAt,
          }],
        };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/lessons/10/attendance')
      .send({ lessonStatus: 'conducted', attendance: [] });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('lessonNotStarted');
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO academy_attendance'))).toBe(false);
  });

  it('requires earlier scheduled lessons in the same group to be completed first', async () => {
    const scheduledAt = new Date(Date.now() - 60 * 60 * 1000);
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('FOR UPDATE OF l')) {
        return {
          rows: [{
            id: 11,
            group_id: 20,
            status: 'scheduled',
            scheduled_at: scheduledAt,
          }],
        };
      }
      if (sql.includes('FROM academy_lessons previous_lesson')) {
        return { rows: [{ id: 10 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/lessons/11/attendance')
      .send({ lessonStatus: 'conducted', attendance: [] });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('previousLessonMustBeCompleted');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO academy_attendance'))).toBe(false);
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('does not reopen a conducted lesson through the attendance endpoint', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('FOR UPDATE OF l')) {
        return {
          rows: [{
            id: 10,
            group_id: 20,
            status: 'conducted',
            scheduled_at: new Date(Date.now() - 60 * 60 * 1000),
          }],
        };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/lessons/10/attendance')
      .send({ lessonStatus: 'scheduled', attendance: [] });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('conductedLessonCannotBeReopened');
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('marks a started lesson conducted and saves the complete historical roster atomically', async () => {
    const scheduledAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('FOR UPDATE OF l')) {
        return {
          rows: [{
            id: 10,
            group_id: 20,
            status: 'scheduled',
            scheduled_at: scheduledAt,
            duration_minutes: 60,
          }],
        };
      }
      if (sql.includes('FROM academy_students student') && sql.includes('FOR UPDATE OF student')) {
        return {
          rows: [
            { id: 5, group_id: 20, phone: '+998901111111', manager_id: 1 },
            { id: 6, group_id: 20, phone: '+998902222222', manager_id: 1 },
          ],
        };
      }
      if (sql.includes('INSERT INTO academy_attendance')) {
        return {
          rows: [{
            lesson_id: values[0],
            student_id: values[1],
            status: values[2],
          }],
        };
      }
      if (sql.includes('UPDATE "academy_lessons"')) {
        return { rows: [{ id: 10, group_id: 20, status: 'conducted', scheduled_at: scheduledAt }] };
      }
      if (sql.includes('INSERT INTO "academy_lesson_status_history"')) {
        return { rows: [{ id: 90 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/lessons/10/attendance')
      .send({
        lessonStatus: 'conducted',
        attendance: [
          { studentId: 5, status: 'present' },
          { studentId: 6, status: 'absent' },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.lesson.status).toBe('conducted');
    expect(response.body.attendance).toHaveLength(2);
    const attendanceWrites = mocks.clientQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO academy_attendance'));
    expect(attendanceWrites).toHaveLength(2);
    expect(attendanceWrites.every(([, values]) => values[6] === false && values[7] === false)).toBe(true);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO "academy_lesson_status_history"'))).toBe(true);
    expect(mocks.clientQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO "academy_notification_outbox"'))).toHaveLength(1);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('closes a stale three-absence task when corrected attendance removes the streak', async () => {
    const scheduledAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('FOR UPDATE OF l')) {
        return {
          rows: [{
            id: 10,
            group_id: 20,
            status: 'conducted',
            scheduled_at: scheduledAt,
            duration_minutes: 60,
          }],
        };
      }
      if (sql.includes('FROM academy_students student') && sql.includes('FOR UPDATE OF student')) {
        return { rows: [{ id: 5, group_id: 20, manager_id: 1 }] };
      }
      if (sql.includes('INSERT INTO academy_attendance')) {
        return { rows: [{ lesson_id: 10, student_id: 5, status: values[2] }] };
      }
      if (sql.includes('UPDATE "academy_lessons"')) {
        return { rows: [{ id: 10, group_id: 20, status: 'conducted', scheduled_at: scheduledAt }] };
      }
      if (sql.includes('ORDER BY l.scheduled_at DESC') && sql.includes('LIMIT 3')) {
        return { rows: [{ status: 'present' }, { status: 'absent' }, { status: 'absent' }] };
      }
      if (sql.includes("title = '3 пропуска подряд: позвонить родителю'")) {
        return { rows: [{ id: 70 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/lessons/10/attendance')
      .send({
        lessonStatus: 'conducted',
        attendance: [{ studentId: 5, status: 'present' }],
      });

    expect(response.status).toBe(200);
    expect(mocks.clientQuery.mock.calls.some(([sql, values]) => (
      String(sql).includes('UPDATE academy_tasks')
      && String(sql).includes("status = 'done'")
      && values[0] === 70
    ))).toBe(true);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('reschedules a lesson chain atomically and preserves the lesson intervals', async () => {
    const originalAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    originalAt.setHours(10, 0, 17, 321);
    const followingAt = new Date(originalAt.getTime() + 2 * 24 * 60 * 60 * 1000);
    const nextAt = new Date(originalAt.getTime() + 2 * 24 * 60 * 60 * 1000);
    nextAt.setSeconds(0, 0);
    const lessonRow = (id: number, scheduledAt: Date) => ({
      id,
      group_id: 20,
      course_id: 1,
      school_id: 2,
      room_id: 3,
      teacher_id: 4,
      teacher_user_id: 1,
      lesson_number: id - 9,
      duration_minutes: 60,
      status: 'scheduled',
      scheduled_at: scheduledAt,
    });

    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('SELECT lesson.*') && sql.includes('FOR UPDATE OF lesson')) {
        return { rows: [lessonRow(10, originalAt)] };
      }
      if (sql.includes('FROM academy_attendance WHERE lesson_id')) return emptyResult();
      if (sql.includes('FROM academy_lessons affected_lesson') && sql.includes('affected_lesson.group_id = $1') && sql.includes('FOR UPDATE')) {
        return { rows: [lessonRow(10, originalAt), lessonRow(11, followingAt)] };
      }
      if (sql.includes('FROM academy_groups WHERE id = $1 FOR SHARE')) {
        return {
          rows: [{
            id: 20,
            course_id: 1,
            school_id: 2,
            room_id: 3,
            teacher_id: 4,
            lesson_duration_minutes: 60,
          }],
        };
      }
      if (sql.includes('FROM academy_rooms room')) {
        return { rows: [{ id: 3, school_id: 2, is_active: true }] };
      }
      if (sql.includes('FROM academy_teachers WHERE id = $1')) {
        return {
          rows: [{
            id: 4,
            status: 'active',
            course_ids: [1],
            school_ids: [2],
            availability: Array.from({ length: 7 }, (_, index) => ({
              dayOfWeek: index + 1,
              startTime: '00:00',
              endTime: '23:59',
              schoolId: 2,
            })),
          }],
        };
      }
      if (sql.includes('SELECT id FROM academy_lessons') || sql.includes('FROM academy_groups\n')) {
        return emptyResult();
      }
      if (sql.includes('UPDATE "academy_lessons"')) {
        return { rows: [{ ...lessonRow(Number(values[0]), values[1] as Date), scheduled_at: values[1] }] };
      }
      if (sql.includes('INSERT INTO "academy_lesson_reschedules"')) {
        return { rows: [{ id: 100 }] };
      }
      if (sql.includes('UPDATE academy_groups')) return emptyResult();
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/lessons/10/reschedule')
      .send({
        scheduledAt: nextAt.toISOString(),
        reason: 'Учитель заболел',
        shiftFollowing: true,
      });

    expect(response.status).toBe(200);
    expect(response.body.shiftedCount).toBe(2);
    expect(response.body.lessons.map((lesson: any) => new Date(lesson.scheduledAt).getTime())).toEqual([
      nextAt.getTime(),
      followingAt.getTime() + (nextAt.getTime() - originalAt.getTime()),
    ]);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
    expect(mocks.clientQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO "academy_lesson_reschedules"'))).toHaveLength(2);
  });

  it('always shifts following lessons even when the client omits the legacy flag', async () => {
    const originalAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    originalAt.setHours(10, 0, 0, 0);
    const nextAt = new Date(originalAt.getTime() + 2 * 24 * 60 * 60 * 1000);
    const lesson = lessonFixture({ scheduled_at: originalAt });
    const following = lessonFixture({
      id: 11,
      lesson_number: 2,
      scheduled_at: new Date(originalAt.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('SELECT lesson.*') && sql.includes('FOR UPDATE OF lesson')) return { rows: [lesson] };
      if (sql.includes('FROM academy_lessons affected_lesson')) {
        return { rows: [lesson, following] };
      }
      if (sql.includes('FROM academy_attendance WHERE lesson_id')) return emptyResult();
      if (sql.includes('FROM academy_groups WHERE id = $1 FOR SHARE')) {
        return { rows: [{ id: 20, course_id: 1, school_id: 2, room_id: 3, teacher_id: 4, lesson_duration_minutes: 60 }] };
      }
      if (sql.includes('FROM academy_rooms room')) return { rows: [{ id: 3, school_id: 2, is_active: true }] };
      if (sql.includes('FROM academy_teachers WHERE id = $1')) {
        return {
          rows: [{
            id: 4,
            status: 'active',
            course_ids: [1],
            school_ids: [2],
            availability: Array.from({ length: 7 }, (_, index) => ({
              dayOfWeek: index + 1,
              startTime: '00:00',
              endTime: '23:59',
              schoolId: 2,
            })),
          }],
        };
      }
      if (sql.includes('SELECT id FROM academy_lessons') || sql.includes('FROM academy_groups\n')) return emptyResult();
      if (sql.includes('UPDATE "academy_lessons"')) {
        const source = Number(values[0]) === 11 ? following : lesson;
        return { rows: [{ ...source, scheduled_at: values[1] }] };
      }
      if (sql.includes('INSERT INTO "academy_lesson_reschedules"')) return { rows: [{ id: 100 }] };
      if (sql.includes('UPDATE academy_groups')) return emptyResult();
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/lessons/10/reschedule')
      .send({
        scheduledAt: nextAt.toISOString(),
        reason: 'Перенос только одного занятия',
      });

    expect(response.status).toBe(200);
    expect(response.body.shiftedCount).toBe(2);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('reopens a conducted lesson, clears its attendance, and records both histories', async () => {
    const originalAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    originalAt.setHours(10, 0, 0, 0);
    const nextAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    nextAt.setHours(10, 0, 0, 0);
    const conducted = lessonFixture({ status: 'conducted', scheduled_at: originalAt });

    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('SELECT lesson.*') && sql.includes('FOR UPDATE OF lesson')) return { rows: [conducted] };
      if (sql.includes('FROM academy_lessons affected_lesson')) return { rows: [conducted] };
      if (sql.includes('SELECT lesson_id') && sql.includes('FROM academy_attendance')) return emptyResult();
      if (sql.includes('DELETE FROM academy_attendance')) return { rows: [{ student_id: 5 }] };
      if (sql.includes('FROM academy_groups WHERE id = $1 FOR SHARE')) {
        return { rows: [{ id: 20, course_id: 1, school_id: 2, room_id: 3, teacher_id: 4, lesson_duration_minutes: 60 }] };
      }
      if (sql.includes('FROM academy_rooms room')) return { rows: [{ id: 3, school_id: 2, is_active: true }] };
      if (sql.includes('FROM academy_teachers WHERE id = $1')) {
        return {
          rows: [{
            id: 4,
            status: 'active',
            course_ids: [1],
            school_ids: [2],
            availability: Array.from({ length: 7 }, (_, index) => ({
              dayOfWeek: index + 1,
              startTime: '00:00',
              endTime: '23:59',
              schoolId: 2,
            })),
          }],
        };
      }
      if (sql.includes('SELECT id FROM academy_lessons') || sql.includes('FROM academy_groups\n')) return emptyResult();
      if (sql.includes('UPDATE "academy_lessons"')) {
        return { rows: [{ ...conducted, scheduled_at: values[1], status: 'scheduled' }] };
      }
      if (sql.includes('INSERT INTO "academy_lesson_reschedules"')) return { rows: [{ id: 100 }] };
      if (sql.includes('INSERT INTO "academy_lesson_status_history"')) return { rows: [{ id: 101 }] };
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1')) return emptyResult();
      if (sql.includes('UPDATE academy_groups')) return emptyResult();
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/lessons/10/reschedule')
      .send({
        scheduledAt: nextAt.toISOString(),
        reason: 'Урок был отмечен проведённым случайно',
      });

    expect(response.status).toBe(200);
    expect(response.body.lesson.status).toBe('scheduled');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM academy_attendance'))).toBe(true);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO "academy_lesson_status_history"'))).toBe(true);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('rolls back a chain reschedule when any following lesson already has attendance', async () => {
    const originalAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    originalAt.setSeconds(0, 0);
    const followingAt = new Date(originalAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const nextAt = new Date(originalAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    const target = lessonFixture({ scheduled_at: originalAt });
    const following = lessonFixture({ id: 11, scheduled_at: followingAt });

    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('SELECT lesson.*') && sql.includes('FOR UPDATE OF lesson')) return { rows: [target] };
      if (sql.includes('FROM academy_lessons affected_lesson') && sql.includes('FOR UPDATE OF affected_lesson')) {
        return { rows: [target, following] };
      }
      if (sql.includes('FROM academy_attendance') && sql.includes('ANY($1::int[])')) {
        return { rows: [{ lesson_id: 11 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/lessons/10/reschedule')
      .send({
        scheduledAt: nextAt.toISOString(),
        reason: 'Перенос всей цепочки',
        shiftFollowing: true,
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('lessonWithAttendanceCannotBeRescheduled');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE "academy_lessons"'))).toBe(false);
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('does not let a teacher shift a following lesson assigned to another teacher', async () => {
    mocks.actor = { id: 7, workspace: 'teacher', workspaces: ['teacher'] };
    const originalAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    originalAt.setSeconds(0, 0);
    const nextAt = new Date(originalAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const target = lessonFixture({ scheduled_at: originalAt, teacher_user_id: 7 });
    const anotherTeacherLesson = lessonFixture({
      id: 11,
      scheduled_at: new Date(originalAt.getTime() + 7 * 24 * 60 * 60 * 1000),
      teacher_id: 5,
      teacher_user_id: 8,
    });

    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('SELECT lesson.*') && sql.includes('FOR UPDATE OF lesson')) return { rows: [target] };
      if (sql.includes('FROM academy_lessons affected_lesson') && sql.includes('FOR UPDATE OF affected_lesson')) {
        return { rows: [target, anotherTeacherLesson] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/lessons/10/reschedule')
      .send({
        scheduledAt: nextAt.toISOString(),
        reason: 'Перенос цепочки',
        shiftFollowing: true,
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('teacherOwnLessonRescheduleOnly');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE "academy_lessons"'))).toBe(false);
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('does not let a teacher change another teacher\'s student status', async () => {
    mocks.actor = { id: 8, workspace: 'teacher', workspaces: ['teacher'] };
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 5, group_id: 20, status: 'studying' }] };
      }
      if (sql.includes('SELECT id FROM academy_teachers WHERE user_id = $1')) {
        return { rows: [{ id: 3 }] };
      }
      if (sql.includes('SELECT id FROM academy_groups WHERE id = $1 AND teacher_id = $2')) {
        return emptyResult();
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .patch('/api/academy/students/5/status')
      .send({ status: 'completed' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Teacher can update only own students');
  });

  it('rolls back a transfer into a completed group before writing transfer history', async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1')) {
        return { rows: [{ id: 5, lead_id: null, group_id: 10, status: 'studying' }] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 5, lead_id: null, group_id: 10, status: 'studying' }] };
      }
      if (sql.includes('SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 20 }] };
      }
      if (sql.includes('SELECT * FROM academy_groups WHERE id = $1')) {
        return { rows: [{ id: 20, status: 'completed', max_students: 12 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/students/5/transfer')
      .send({ toGroupId: 20 });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('groupNotOpen');
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO "academy_student_transfers"'))).toBe(false);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE "academy_students"'))).toBe(false);
  });

  it('moves the student and linked lead to the target group course and school atomically', async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1')) {
        return { rows: [{ id: 5, lead_id: 42, group_id: 10, status: 'studying' }] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT id FROM academy_leads WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 42 }] };
      }
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 5, lead_id: 42, group_id: 10, status: 'studying' }] };
      }
      if (sql.includes('SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 20 }] };
      }
      if (sql.includes('SELECT * FROM academy_groups WHERE id = $1')) {
        return {
          rows: [{ id: 20, status: 'open', max_students: 12, course_id: 9, school_id: 4 }],
        };
      }
      if (sql.includes('COUNT(DISTINCT s.id)::int AS current_students')) {
        return { rows: [{ current_students: 0, reserved_students: 0, max_students: 12 }] };
      }
      if (sql.includes('UPDATE "academy_students"') && sql.includes('"group_id"')) {
        return { rows: [{ id: 5, lead_id: 42, group_id: 20, course_id: 9, school_id: 4 }] };
      }
      if (sql.includes('UPDATE "academy_leads"')) return { rows: [{ id: 42 }] };
      if (sql.includes('INSERT INTO "academy_student_transfers"')) return { rows: [{ id: 1 }] };
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1')) {
        return { rows: [{ id: 5, group_id: 20 }] };
      }
      if (sql.includes('COUNT(*)::text AS count')) return { rows: [{ count: '0' }] };
      if (sql.includes('SELECT lesson_count FROM academy_groups')) return { rows: [{ lesson_count: 10 }] };
      if (sql.includes('UPDATE "academy_students"')) return { rows: [{ id: 5, group_id: 20 }] };
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/students/5/transfer')
      .send({ toGroupId: 20, reason: 'schedule' });

    expect(response.status).toBe(200);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
    expect(mocks.clientQuery.mock.calls).toContainEqual([
      expect.stringContaining('UPDATE "academy_students"'),
      [5, 20, 9, 4],
    ]);
    expect(mocks.clientQuery.mock.calls).toContainEqual([
      expect.stringContaining('UPDATE "academy_leads"'),
      [42, 20, 9, 4],
    ]);
  });

  it('adds a secondary group without replacing the student primary group', async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1')) {
        return { rows: [{ id: 5, lead_id: null, group_id: 10, status: 'studying' }] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 5, lead_id: null, group_id: 10, status: 'studying' }] };
      }
      if (sql.includes('SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 20 }] };
      }
      if (sql.includes('SELECT * FROM academy_groups WHERE id = $1')) {
        return { rows: [{ id: 20, status: 'open', max_students: 12, course_id: 9, school_id: 4 }] };
      }
      if (sql.includes('AS resources_active')) return { rows: [{ resources_active: true }] };
      if (sql.includes('COUNT(DISTINCT s.id)::int AS current_students')) {
        return { rows: [{ current_students: 0, reserved_students: 0, max_students: 12 }] };
      }
      if (sql.includes('INSERT INTO academy_student_group_enrollments')) {
        return { rows: [{ id: 1, student_id: 5, group_id: 20, is_primary: false }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/students/5/groups')
      .send({ groupId: 20 });

    expect(response.status).toBe(201);
    const enrollmentInsert = mocks.clientQuery.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO academy_student_group_enrollments')
      && String(sql).includes("'active', $3")
    ));
    expect(enrollmentInsert?.[1]?.slice(0, 3)).toEqual([5, 20, false]);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => (
      String(sql).includes('UPDATE "academy_students"') && String(sql).includes('"group_id"')
    ))).toBe(false);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('adds a secondary group directly to an unpaid lead without replacing its primary group', async () => {
    const lead = leadFixture({ enrolled_group_id: 10 });
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM academy_leads l') && sql.includes('WHERE l.id = $1')) {
        return { rows: [lead] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE')) {
        return { rows: [lead] };
      }
      if (sql.includes('SELECT id FROM academy_students WHERE lead_id = $1 FOR UPDATE')) {
        return emptyResult();
      }
      if (sql.includes('SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 20 }] };
      }
      if (sql.includes('SELECT * FROM academy_groups WHERE id = $1')) {
        return { rows: [{ id: 20, status: 'open', max_students: 12, course_id: 9, school_id: 4 }] };
      }
      if (sql.includes('AS resources_active')) return { rows: [{ resources_active: true }] };
      if (sql.includes('COUNT(DISTINCT s.id)::int AS current_students')) {
        return { rows: [{ current_students: 0, reserved_students: 0, max_students: 12 }] };
      }
      if (sql.includes('INSERT INTO academy_lead_group_reservations')) {
        return { rows: [{ id: 1, lead_id: 42, group_id: 20 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/leads/42/groups')
      .send({ groupId: 20 });

    expect(response.status).toBe(201);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO academy_lead_group_reservations'),
      [42, 20, 1],
    );
    expect(mocks.clientQuery.mock.calls.some(([sql]) => (
      String(sql).includes('UPDATE "academy_leads"') && String(sql).includes('"enrolled_group_id"')
    ))).toBe(false);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('keeps a studying student in at least one active group', async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1')) {
        return { rows: [{ id: 5, lead_id: null, group_id: 20, status: 'studying' }] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 5, lead_id: null, group_id: 20, status: 'studying' }] };
      }
      if (sql.includes('FROM academy_student_group_enrollments') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 1, student_id: 5, group_id: 20, status: 'active', is_primary: true }] };
      }
      if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 1 }] };
      return emptyResult();
    });

    const response = await request(await createApp())
      .delete('/api/academy/students/5/groups/20');

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('studentRequiresAtLeastOneGroup');
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => (
      String(sql).includes('UPDATE academy_student_group_enrollments')
    ))).toBe(false);
  });

  it('does not resume a paused student into a full group', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 5, group_id: 20, status: 'paused' }] };
      }
      if (sql.includes('SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 20 }] };
      }
      if (sql.includes('SELECT * FROM academy_groups WHERE id = $1')) {
        return { rows: [{ id: 20, status: 'open', max_students: 12 }] };
      }
      if (sql.includes('COUNT(DISTINCT s.id)::int AS current_students')) {
        return { rows: [{ current_students: 12, reserved_students: 0, max_students: 12 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .patch('/api/academy/students/5/status')
      .send({ status: 'studying' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('groupIsFull');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE "academy_students"'))).toBe(false);
  });

  it('anchors the default paid-until date to paidAt and links student-only payments to the lead', async () => {
    const paidAt = new Date('2026-01-15T10:00:00.000Z');
    let insertedLeadId: unknown;
    let insertedPaidUntil: unknown;

    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 5, lead_id: 42, group_id: 3, manager_id: 1 }] };
      }
      if (sql.includes('INSERT INTO "academy_payments"')) {
        insertedLeadId = readInsertValue(sql, values, 'lead_id');
        insertedPaidUntil = readInsertValue(sql, values, 'paid_until');
        return { rows: [{ id: 99, lead_id: insertedLeadId, student_id: 5, paid_until: insertedPaidUntil }] };
      }
      if (sql.includes('UPDATE "academy_students"')) {
        return { rows: [{ id: 5, lead_id: 42, group_id: 3, manager_id: 1 }] };
      }
      if (sql.includes('FROM academy_leads l')) {
        return { rows: [{ id: 42, referrer_student_id: null }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/payments')
      .send({ studentId: 5, amountUzs: 100_000, paidAt: paidAt.toISOString() });

    expect(response.status).toBe(201);
    expect(insertedLeadId).toBe(42);
    expect(insertedPaidUntil).toBeInstanceOf(Date);
    expect((insertedPaidUntil as Date).toISOString()).toBe('2026-02-14T10:00:00.000Z');
  });

  it('requires an explicit student when a contact has several students', async () => {
    const lead = leadFixture({ is_archived: false });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE')) return { rows: [lead] };
      if (sql.includes('SELECT * FROM academy_students WHERE lead_id = $1 ORDER BY id FOR UPDATE')) {
        return { rows: [{ id: 5, lead_id: 42 }, { id: 6, lead_id: 42 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/payments')
      .send({ leadId: 42, amountUzs: 100_000 });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('studentSelectionRequired');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO "academy_payments"'))).toBe(false);
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('converts every reserved lead group into a student membership after payment', async () => {
    const lead = leadFixture({
      enrolled_group_id: 10,
      status_code: 'enrolled',
      phone: '+998901234567',
      referrer_student_id: null,
      is_archived: false,
    });
    const payment = {
      id: 99,
      lead_id: 42,
      student_id: null,
      group_id: 10,
      amount_uzs: 250_000,
      status: 'paid',
      paid_at: new Date('2026-07-18T10:00:00.000Z'),
      paid_until: new Date('2026-08-17T10:00:00.000Z'),
    };
    const student = {
      id: 5,
      lead_id: 42,
      group_id: 10,
      course_id: 3,
      school_id: 2,
      manager_id: 1,
      enrolled_at: new Date('2026-07-18T10:00:00.000Z'),
      student_name: 'Student',
    };

    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE')) return { rows: [lead] };
      if (sql.includes('SELECT id FROM academy_leads WHERE id = $1 FOR UPDATE')) return { rows: [{ id: 42 }] };
      if (sql.includes('FROM academy_leads l') && sql.includes('WHERE l.id = $1')) return { rows: [lead] };
      if (sql.includes('SELECT * FROM academy_students WHERE lead_id = $1 FOR UPDATE')) return emptyResult();
      if (sql.includes('FROM academy_lead_group_reservations') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            { id: 1, lead_id: 42, group_id: 10 },
            { id: 2, lead_id: 42, group_id: 20 },
          ],
        };
      }
      if (sql.includes('SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: Number(values[0]) }] };
      }
      if (sql.includes('SELECT * FROM academy_groups WHERE id = $1')) {
        return {
          rows: [{
            id: Number(values[0]),
            status: 'open',
            max_students: 12,
            course_id: 3,
            school_id: 2,
          }],
        };
      }
      if (sql.includes('AS resources_active')) return { rows: [{ resources_active: true }] };
      if (sql.includes('COUNT(DISTINCT s.id)::int AS current_students')) {
        return { rows: [{ current_students: 0, reserved_students: 0, max_students: 12 }] };
      }
      if (sql.includes('SELECT * FROM academy_courses WHERE id = $1')) return { rows: [{ id: 3 }] };
      if (sql.includes('INSERT INTO "academy_payments"')) return { rows: [payment] };
      if (sql.includes('SELECT * FROM academy_payments WHERE id = $1 FOR UPDATE')) return { rows: [payment] };
      if (sql.includes('INSERT INTO "academy_students"')) return { rows: [student] };
      if (sql.includes('UPDATE "academy_payments"')) return { rows: [{ ...payment, student_id: 5 }] };
      if (sql.includes('UPDATE academy_students') && sql.includes('SET next_payment_at')) return { rows: [student] };
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1')) return { rows: [student] };
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/payments')
      .send({ leadId: 42, amountUzs: 250_000 });

    expect(response.status, String(mocks.loggerError.mock.calls[0]?.[1]?.error?.stack)).toBe(201);
    const membershipInsert = mocks.clientQuery.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO academy_student_group_enrollments')
      && String(sql).includes('UNNEST($5::int[])')
    ));
    expect(membershipInsert?.[1]?.[4]).toEqual([10, 20]);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      'DELETE FROM academy_lead_group_reservations WHERE lead_id = $1',
      [42],
    );
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('creates another student for the same lead and enrolls only that student in selected groups', async () => {
    const lead = leadFixture({
      status_code: 'qualified',
      phone: '+998901234567',
      is_archived: false,
    });
    const student = {
      id: 77,
      lead_id: 42,
      student_name: 'Second child',
      student_age: 9,
      group_id: 20,
      course_id: 3,
      school_id: 2,
      status: 'studying',
    };
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM academy_leads l') && sql.includes('WHERE l.id = $1')) {
        return { rows: [lead] };
      }
      if (sql.includes('FROM academy_students student') && sql.includes('WHERE student.id = $1')) {
        return { rows: [{ ...student, groups: [{ groupId: 20, groupName: 'Group 20', isPrimary: true }] }] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE')) return { rows: [lead] };
      if (sql.includes('SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: Number(values[0]) }] };
      }
      if (sql.includes('SELECT * FROM academy_groups WHERE id = $1')) {
        return { rows: [{ id: 20, status: 'open', max_students: 12, course_id: 3, school_id: 2 }] };
      }
      if (sql.includes('AS resources_active')) return { rows: [{ resources_active: true }] };
      if (sql.includes('COUNT(DISTINCT s.id)::int AS current_students')) {
        return { rows: [{ current_students: 1, reserved_students: 0, max_students: 12 }] };
      }
      if (sql.includes('SELECT COUNT(*)::int AS count FROM academy_students')) return { rows: [{ count: 1 }] };
      if (sql.includes('INSERT INTO "academy_students"')) return { rows: [student] };
      if (sql.includes('INSERT INTO "academy_student_status_history"')) return { rows: [{ id: 88 }] };
      if (sql.includes('FROM academy_lead_statuses') && sql.includes('code = $1')) return { rows: [{ code: 'enrolled' }] };
      if (sql.includes('UPDATE "academy_leads"')) return { rows: [{ ...lead, status_code: 'enrolled' }] };
      if (sql.includes('INSERT INTO "academy_lead_stage_history"')) return { rows: [{ id: 89 }] };
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/leads/42/students')
      .send({
        studentName: 'Second child',
        studentAge: 9,
        groupIds: [20],
        primaryGroupId: 20,
        enrolledAt: '2026-07-21',
      });

    expect(response.status, String(mocks.loggerError.mock.calls[0]?.[1]?.error?.stack)).toBe(201);
    const studentInsert = mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO "academy_students"'));
    expect(readInsertValue(String(studentInsert?.[0]), studentInsert?.[1] ?? [], 'lead_id')).toBe(42);
    expect(readInsertValue(String(studentInsert?.[0]), studentInsert?.[1] ?? [], 'student_name')).toBe('Second child');
    const membershipInsert = mocks.clientQuery.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO academy_student_group_enrollments')
      && String(sql).includes('UNNEST($5::int[])')
    ));
    expect(membershipInsert?.[1]?.[4]).toEqual([20]);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => (
      String(sql).includes('UPDATE "academy_leads"') && String(sql).includes('"status_code"')
    ))).toBe(true);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('rejects invalid payment dates and enums before writing anything', async () => {
    const invalidDate = await request(await createApp())
      .post('/api/academy/payments')
      .send({ studentId: 5, amountUzs: 100_000, paidAt: 'not-a-date' });
    const invalidMethod = await request(await createApp())
      .post('/api/academy/payments')
      .send({ studentId: 5, amountUzs: 100_000, method: 'crypto' });

    expect(invalidDate.status).toBe(400);
    expect(invalidDate.body.error).toBe('Invalid paidAt');
    expect(invalidMethod.status).toBe(400);
    expect(invalidMethod.body.error).toBe('Invalid payment method');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('rejects a manually selected referral discount when no benefit is available', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 5, lead_id: null, group_id: 3, manager_id: 1 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/payments')
      .send({
        studentId: 5,
        amountUzs: 100_000,
        discount: 'referral_15',
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('referralDiscountNotAvailable');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => (
      String(sql).includes('FROM academy_referral_benefits')
      && String(sql).includes("benefit_type = 'next_payment_discount_15'")
      && String(sql).includes("status = 'pending'")
      && String(sql).includes('FOR UPDATE')
    ))).toBe(true);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => (
      String(sql).includes('INSERT INTO "academy_payments"')
    ))).toBe(false);
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.clientQuery).not.toHaveBeenCalledWith('COMMIT');
  });

  it('automatically applies and atomically consumes a pending referral discount benefit', async () => {
    let insertedDiscount: unknown;

    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 5, lead_id: null, group_id: 3, manager_id: 1 }] };
      }
      if (
        sql.includes('FROM academy_referral_benefits')
        && sql.includes("benefit_type = 'next_payment_discount_15'")
        && sql.includes("status = 'pending'")
      ) {
        return {
          rows: [{
            id: 77,
            student_id: 5,
            benefit_type: 'next_payment_discount_15',
            status: 'pending',
          }],
        };
      }
      if (sql.includes('INSERT INTO "academy_payments"')) {
        insertedDiscount = readInsertValue(sql, values, 'discount');
        return {
          rows: [{
            id: 100,
            lead_id: null,
            student_id: 5,
            discount: insertedDiscount,
            paid_until: readInsertValue(sql, values, 'paid_until'),
          }],
        };
      }
      if (sql.includes('UPDATE academy_referral_benefits')) {
        return {
          rows: [{
            id: 77,
            student_id: 5,
            benefit_type: 'next_payment_discount_15',
            status: 'consumed',
            consumed_by_payment_id: 100,
          }],
        };
      }
      if (sql.includes('UPDATE academy_students') && sql.includes('SET next_payment_at')) {
        return { rows: [{ id: 5, lead_id: null, group_id: 3, manager_id: 1 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/payments')
      .send({ studentId: 5, amountUzs: 100_000 });

    expect(response.status).toBe(201);
    expect(insertedDiscount).toBe('referral_15');
    expect(response.body.payment.discount).toBe('referral_15');
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE academy_referral_benefits'),
      [77, 'consumed', 100],
    );

    const statements = mocks.clientQuery.mock.calls.map(([sql]) => String(sql));
    const beginIndex = statements.indexOf('BEGIN');
    const benefitLockIndex = statements.findIndex((sql) => (
      sql.includes('FROM academy_referral_benefits') && sql.includes('FOR UPDATE')
    ));
    const paymentInsertIndex = statements.findIndex((sql) => sql.includes('INSERT INTO "academy_payments"'));
    const benefitConsumeIndex = statements.findIndex((sql) => sql.includes('UPDATE academy_referral_benefits'));
    const commitIndex = statements.indexOf('COMMIT');

    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(benefitLockIndex).toBeGreaterThan(beginIndex);
    expect(paymentInsertIndex).toBeGreaterThan(benefitLockIndex);
    expect(benefitConsumeIndex).toBeGreaterThan(paymentInsertIndex);
    expect(commitIndex).toBeGreaterThan(benefitConsumeIndex);
    expect(mocks.clientQuery).not.toHaveBeenCalledWith('ROLLBACK');
  });

  it('does not grant the same referral reward on a later payment', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 5, lead_id: 42, group_id: 3, manager_id: 1 }] };
      }
      if (sql.includes('INSERT INTO "academy_payments"')) {
        return {
          rows: [{
            id: 100,
            lead_id: 42,
            student_id: 5,
            paid_until: readInsertValue(sql, values, 'paid_until'),
          }],
        };
      }
      if (sql.includes('UPDATE "academy_students"')) {
        return { rows: [{ id: 5, lead_id: 42, group_id: 3, manager_id: 1 }] };
      }
      if (sql.includes('FROM academy_leads l')) {
        return { rows: [{ id: 42, referrer_student_id: 7 }] };
      }
      if (sql.includes('UPDATE academy_referral_rewards')) return emptyResult();
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/payments')
      .send({ studentId: 5, amountUzs: 100_000 });

    expect(response.status).toBe(201);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('"referral_level"'))).toBe(false);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('Бесплатный месяц'))).toBe(false);
  });

  it('does not bulk-move leads into a non-pipeline status before deleting a stage', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('WHERE id = ANY($1::int[])')) {
        return {
          rows: [
            { id: 11, code: 'custom', is_pipeline: true, is_system: false, is_active: true },
            { id: 12, code: 'not_now', is_pipeline: false, is_system: true, is_active: true },
          ],
        };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/pipeline-statuses/11/transfer-leads-and-delete')
      .send({ targetStatusId: 12 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('targetPipelineStageRequired');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE academy_leads'))).toBe(false);
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('validates an explicitly selected lesson teacher for schedule conflicts', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('FROM academy_groups WHERE id = $1 FOR SHARE')) {
        return {
          rows: [{
            id: 20,
            course_id: 1,
            school_id: 2,
            room_id: 3,
            teacher_id: 4,
            lesson_duration_minutes: 60,
          }],
        };
      }
      if (sql.includes('FROM academy_rooms room')) {
        return { rows: [{ id: 3, school_id: 2, is_active: true }] };
      }
      if (sql.includes('FROM academy_teachers WHERE id = $1')) {
        return {
          rows: [{
            id: 4,
            status: 'active',
            course_ids: [1],
            school_ids: [2],
            availability: [{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00', schoolId: 2 }],
          }],
        };
      }
      if (sql.includes('WHERE teacher_id = $1') && sql.includes('scheduled_at < $3')) {
        return { rows: [{ id: 999 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/lessons')
      .send({
        groupId: 20,
        teacherId: 4,
        lessonNumber: 1,
        topic: 'Conflict validation',
        scheduledAt: '2026-07-13T10:00:00.000+05:00',
        durationMinutes: 60,
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('teacherUnavailableForLesson');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO "academy_lessons"'))).toBe(false);
  });

  it('rejects overlapping lessons for the same group even in another room', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql.includes('pg_advisory_xact_lock')) {
        return emptyResult();
      }
      if (sql.includes('FROM academy_groups WHERE id = $1 FOR SHARE')) {
        return {
          rows: [{
            id: 20,
            course_id: 1,
            school_id: 2,
            room_id: 3,
            teacher_id: 4,
            lesson_duration_minutes: 60,
          }],
        };
      }
      if (sql.includes('FROM academy_rooms room')) {
        return { rows: [{ id: 3, school_id: 2, is_active: true }] };
      }
      if (sql.includes('WHERE group_id = $1') && sql.includes('scheduled_at < $3')) {
        return { rows: [{ id: 998 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/lessons')
      .send({
        groupId: 20,
        teacherId: 4,
        lessonNumber: 1,
        topic: 'Group overlap validation',
        scheduledAt: '2026-07-13T10:00:00.000+05:00',
        durationMinutes: 60,
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('groupLessonOverlap');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO "academy_lessons"'))).toBe(false);
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('accepts a 10:00 Tashkent lesson inside teacher availability when the server runs in UTC', async () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) {
          return emptyResult();
        }
        if (sql.includes('FROM academy_groups WHERE id = $1 FOR SHARE')) {
          return {
            rows: [{
              id: 20,
              course_id: 1,
              school_id: 2,
              room_id: 3,
              teacher_id: 4,
              lesson_duration_minutes: 60,
            }],
          };
        }
        if (sql.includes('FROM academy_rooms room')) {
          return { rows: [{ id: 3, school_id: 2, is_active: true }] };
        }
        if (sql.includes('FROM academy_teachers WHERE id = $1')) {
          return {
            rows: [{
              id: 4,
              status: 'active',
              course_ids: [1],
              school_ids: [2],
              availability: [{
                dayOfWeek: 1,
                startTime: '10:00',
                endTime: '11:00',
                schoolId: 2,
              }],
            }],
          };
        }
        if (sql.includes('INSERT INTO "academy_lessons"')) {
          return {
            rows: [{
              id: 101,
              group_id: 20,
              teacher_id: 4,
              scheduled_at: readInsertValue(sql, values, 'scheduled_at'),
              status: 'scheduled',
            }],
          };
        }
        return emptyResult();
      });

      const response = await request(await createApp())
        .post('/api/academy/lessons')
        .send({
          groupId: 20,
          teacherId: 4,
          lessonNumber: 1,
          topic: 'Timezone regression',
          scheduledAt: '2026-07-13T10:00:00.000+05:00',
          durationMinutes: 60,
        });

      expect(response.status).toBe(201);
      expect(new Date(response.body.scheduledAt).toISOString()).toBe('2026-07-13T05:00:00.000Z');
      expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO "academy_lessons"'))).toBe(true);
    } finally {
      if (previousTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimeZone;
    }
  });

  it('builds 10:00 Tashkent availability slots from academy-day boundaries on a UTC server', async () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      mocks.poolQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM academy_courses') && sql.includes('is_active = true')) {
          return { rows: [{ id: 1, name: 'Vibe Coding', lesson_duration_minutes: 60 }] };
        }
        if (sql.includes('FROM academy_schools') && sql.includes('is_active = true')) {
          return { rows: [{ id: 2, name: 'Main school', is_active: true }] };
        }
        if (sql.includes('FROM academy_teachers t') && sql.includes('upcoming_lessons')) {
          return {
            rows: [{
              id: 4,
              full_name: 'Teacher',
              status: 'active',
              course_ids: [1],
              school_ids: [2],
              availability: [{
                dayOfWeek: 1,
                startTime: '10:00',
                endTime: '11:00',
                schoolId: 2,
              }],
            }],
          };
        }
        return emptyResult();
      });

      const response = await request(await createApp())
        .get('/api/academy/availability/slots')
        .query({ schoolId: 2, courseId: 1, from: '2030-07-15', days: 1 });

      expect(response.status).toBe(200);
      expect(response.body.from).toBe('2030-07-14T19:00:00.000Z');
      expect(response.body.slots).toHaveLength(1);
      expect(response.body.slots[0].startsAt).toBe('2030-07-15T05:00:00.000Z');
      expect(response.body.slots[0].endsAt).toBe('2030-07-15T06:00:00.000Z');
    } finally {
      if (previousTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimeZone;
    }
  });

  it('does not let group schedule-backed fields diverge from existing lessons', async () => {
    const group = groupFixture();
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM "academy_groups" WHERE id = $1')) return { rows: [group] };
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql.includes('pg_advisory_xact_lock')) {
        return emptyResult();
      }
      if (sql.includes('SELECT * FROM academy_groups WHERE id = $1 FOR UPDATE')) {
        return { rows: [group] };
      }
      if (sql.includes('AS has_lessons')) {
        return {
          rows: [{
            has_lessons: true,
            has_scheduled_lessons: false,
            has_studying_students: false,
            has_reserved_leads: false,
          }],
        };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .patch('/api/academy/groups/20')
      .send({ roomId: 9 });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('groupLessonsLockSchedule');
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE "academy_groups"'))).toBe(false);
  });

  it('renames a group with existing lessons without treating auto assignment as a schedule change', async () => {
    const group = groupFixture({ teacher_id: null });
    const updatedGroup = { ...group, name: 'Vibe Coding Advanced' };
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM "academy_groups" WHERE id = $1')) return { rows: [group] };
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) {
        return emptyResult();
      }
      if (sql.includes('SELECT * FROM academy_groups WHERE id = $1 FOR UPDATE')) {
        return { rows: [updatedGroup] };
      }
      if (sql.includes('UPDATE "academy_groups"')) return { rows: [updatedGroup] };
      if (sql.includes('SELECT * FROM academy_groups WHERE id = $1')) {
        return { rows: [updatedGroup] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .patch('/api/academy/groups/20')
      .send({
        name: updatedGroup.name,
        courseId: group.course_id,
        schoolId: group.school_id,
        roomId: group.room_id,
        teacherId: null,
        schedule: group.schedule,
        lessonCount: group.lesson_count,
        lessonDurationMinutes: group.lesson_duration_minutes,
        durationDays: group.duration_days,
        frequency: group.frequency,
        maxStudents: group.max_students,
        status: group.status,
        startDate: group.start_date,
        endDate: group.end_date,
        autoAssign: true,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: group.id,
      name: updatedGroup.name,
      teacherId: null,
    });
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('AS has_lessons'))).toBe(false);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('moves lead-owned notifications when leads are assigned to another manager', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT id, full_name') && sql.includes('FROM users u')) {
        return { rows: [{ id: 9, full_name: 'New manager' }] };
      }
      if (sql.includes('FROM academy_leads') && sql.includes('FOR UPDATE')) {
        return { rows: [leadFixture({ id: 42, manager_id: 3 })] };
      }
      if (sql.includes('INSERT INTO "academy_lead_assignment_history"')) {
        return { rows: [{ id: 100 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/leads/bulk-assign')
      .send({ leadIds: [42], managerId: 9 });

    expect(response.status).toBe(200);
    expect(response.body.updatedCount).toBe(1);
    const notificationSync = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE notifications notification')
    );
    expect(notificationSync).toBeDefined();
    expect(notificationSync?.[1]).toEqual([9, [42]]);
    expect(String(notificationSync?.[0])).toContain("notification.related_entity_type = 'lead'");
    expect(String(notificationSync?.[0])).toContain("notification.related_entity_type = 'academy_task'");
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it.each([
    {
      dependency: 'scheduled lessons',
      lifecycle: { has_lessons: true, has_scheduled_lessons: true },
      error: 'groupHasScheduledLessons',
    },
    {
      dependency: 'studying students',
      lifecycle: { has_studying_students: true },
      error: 'groupHasStudyingStudents',
    },
    {
      dependency: 'reserved leads',
      lifecycle: { has_reserved_leads: true },
      error: 'groupHasReservedLeads',
    },
  ])('does not complete a group with $dependency', async ({ lifecycle, error }) => {
    const group = groupFixture();
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM "academy_groups" WHERE id = $1')) return { rows: [group] };
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql.includes('pg_advisory_xact_lock')) {
        return emptyResult();
      }
      if (sql.includes('SELECT * FROM academy_groups WHERE id = $1 FOR UPDATE')) {
        return { rows: [group] };
      }
      if (sql.includes('AS has_lessons')) {
        return {
          rows: [{
            has_lessons: false,
            has_scheduled_lessons: false,
            has_studying_students: false,
            has_reserved_leads: false,
            ...lifecycle,
          }],
        };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .patch('/api/academy/groups/20')
      .send({
        status: 'completed',
        roomId: group.room_id,
        teacherId: group.teacher_id,
        schedule: group.schedule,
        startDate: group.start_date,
        endDate: group.end_date,
        lessonCount: group.lesson_count,
        lessonDurationMinutes: group.lesson_duration_minutes,
        durationDays: group.duration_days,
        frequency: group.frequency,
        autoAssign: false,
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe(error);
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE "academy_groups"'))).toBe(false);
  });

  it('saves a course and every teacher assignment in one transaction', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('INSERT INTO "academy_courses"')) {
        return { rows: [{ id: 9, name: 'AI Robotics', slug: 'ai-robotics' }] };
      }
      if (sql.includes('SELECT * FROM academy_teachers ORDER BY id FOR UPDATE')) {
        return {
          rows: [
            { id: 1, course_ids: [2] },
            { id: 2, course_ids: [9] },
          ],
        };
      }
      if (sql.includes('UPDATE "academy_teachers"')) return { rows: [{ id: 1 }] };
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/courses/with-teachers')
      .send({
        name: 'AI Robotics',
        slug: 'ai-robotics',
        ageCategory: '10-15',
        description: '',
        basePriceUzs: 1_500_000,
        isActive: true,
        teacherIds: [1],
      });

    expect(response.status).toBe(201);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
    expect(mocks.clientQuery.mock.calls).toContainEqual([
      expect.stringContaining('UPDATE "academy_teachers"'),
      [1, JSON.stringify([2, 9])],
    ]);
    expect(mocks.clientQuery.mock.calls).toContainEqual([
      expect.stringContaining('UPDATE "academy_teachers"'),
      [2, JSON.stringify([])],
    ]);
  });

  it('preserves a course assignment required by an active group or scheduled lesson', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) {
        return emptyResult();
      }
      if (sql.includes('SELECT * FROM academy_courses WHERE id = $1 FOR UPDATE')) {
        return {
          rows: [{
            id: 9,
            name: 'AI Robotics',
            slug: 'ai-robotics',
            age_category: '10-15',
            base_price_uzs: 1_500_000,
            is_active: true,
          }],
        };
      }
      if (sql.includes('UPDATE "academy_courses"')) {
        return { rows: [{ id: 9, name: 'AI Robotics', slug: 'ai-robotics', is_active: true }] };
      }
      if (sql.includes('SELECT DISTINCT assignment.teacher_id')) {
        return { rows: [{ teacher_id: 2 }] };
      }
      if (sql.includes('SELECT * FROM academy_teachers ORDER BY id FOR UPDATE')) {
        return {
          rows: [
            { id: 1, course_ids: [2, 9] },
            { id: 2, course_ids: [9] },
          ],
        };
      }
      if (sql.includes('UPDATE "academy_teachers"')) return { rows: [{ id: 1 }] };
      return emptyResult();
    });

    const response = await request(await createApp())
      .patch('/api/academy/courses/9/with-teachers')
      .send({
        name: 'AI Robotics',
        slug: 'ai-robotics',
        ageCategory: '10-15',
        description: '',
        basePriceUzs: 1_500_000,
        isActive: true,
        teacherIds: [],
      });

    expect(response.status).toBe(200);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
    const teacherUpdates = mocks.clientQuery.mock.calls.filter(
      ([sql]) => String(sql).includes('UPDATE "academy_teachers"'),
    );
    expect(teacherUpdates).toEqual([
      [expect.stringContaining('UPDATE "academy_teachers"'), [1, JSON.stringify([2])]],
    ]);
  });

  it('rejects a stale pipeline reorder without applying a partial order', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('SELECT * FROM academy_lead_statuses ORDER BY id FOR UPDATE')) {
        return { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .put('/api/academy/pipeline-statuses/reorder')
      .send({ orderedStatusIds: [1, 2] });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('pipelineConfigurationChanged');
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE academy_lead_statuses'))).toBe(false);
  });

  it('preserves omitted offer and referrer fields when patching a lead', async () => {
    const existing = leadFixture();
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM academy_leads l') && sql.includes('WHERE l.id = $1')) {
        return { rows: [existing] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('FROM academy_leads') && sql.includes('WHERE id = $1') && sql.includes('FOR UPDATE')) {
        return { rows: [existing] };
      }
      if (sql.includes('UPDATE "academy_leads"')) {
        return { rows: [{ ...existing, comment: 'Updated' }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .patch('/api/academy/leads/42')
      .send({ comment: 'Updated' });

    expect(response.status).toBe(200);
    const updateSql = String(mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE "academy_leads"'))?.[0]);
    expect(updateSql).not.toContain('"offer_course_id"');
    expect(updateSql).not.toContain('"referrer_student_id"');
    expect(updateSql).not.toContain('"source_id"');
  });

  it('accepts explicit null for an optional offer course but rejects malformed ids', async () => {
    const existing = leadFixture();
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM academy_leads l') && sql.includes('WHERE l.id = $1')) {
        return { rows: [existing] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE')) {
        return { rows: [existing] };
      }
      if (sql.includes('UPDATE "academy_leads"')) {
        return { rows: [{ ...existing, offer_course_id: null }] };
      }
      return emptyResult();
    });

    const cleared = await request(await createApp())
      .patch('/api/academy/leads/42')
      .send({ offerCourseId: null });
    const malformed = await request(await createApp())
      .patch('/api/academy/leads/42')
      .send({ offerCourseId: 'not-an-id' });

    expect(cleared.status).toBe(200);
    const updateCall = mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE "academy_leads"'));
    expect(String(updateCall?.[0])).toContain('"offer_course_id"');
    expect(updateCall?.[1]).toContain(null);
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe('Invalid offerCourseId');
  });

  it('allows legacy lead student fields to be cleared after student separation', async () => {
    const existing = leadFixture({
      status_code: 'paid',
      enrolled_group_id: 9,
      student_name: 'Legacy student',
    });
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM academy_leads l') && sql.includes('WHERE l.id = $1')) {
        return { rows: [existing] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('FROM academy_leads') && sql.includes('WHERE id = $1') && sql.includes('FOR UPDATE')) {
        return { rows: [existing] };
      }
      if (sql.includes('UPDATE "academy_leads"')) {
        return { rows: [{ ...existing, student_name: null }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .patch('/api/academy/leads/42')
      .send({ studentName: null });

    expect(response.status).toBe(200);
    const updateCall = mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE "academy_leads"'));
    expect(String(updateCall?.[0])).toContain('"student_name"');
    expect(updateCall?.[1]).toContain(null);
  });

  it('validates referrers and prevents self-referral under the lead lock', async () => {
    const existing = leadFixture();
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM academy_leads l') && sql.includes('WHERE l.id = $1')) {
        return { rows: [existing] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE')) {
        return { rows: [existing] };
      }
      if (sql.includes('FROM academy_referral_rewards')) return emptyResult();
      if (sql.includes('FROM academy_students') && sql.includes('FOR SHARE')) {
        return { rows: [{ id: 5, student_name: 'Same student', lead_id: 42 }] };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .patch('/api/academy/leads/42')
      .send({ referrerStudentId: 5 });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('leadCannotReferItself');
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE "academy_leads"'))).toBe(false);
  });

  it('rejects a lead whose referrer student does not exist', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/leads')
      .send({ contactName: 'Parent', referrerStudentId: 999 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('referrerStudentNotFound');
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO academy_lead_sources'))).toBe(false);
  });

  it('does not change a referral link after a reward has been created', async () => {
    const existing = leadFixture();
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM academy_leads l') && sql.includes('WHERE l.id = $1')) {
        return { rows: [existing] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE')) {
        return { rows: [existing] };
      }
      if (sql.includes('FROM academy_referral_rewards')) return { rows: [{ id: 100 }] };
      return emptyResult();
    });

    const response = await request(await createApp())
      .patch('/api/academy/leads/42')
      .send({ referrerStudentId: 8 });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('referralAlreadyRewarded');
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('uses case-insensitive messenger duplicate checks and excludes the same lead\'s student', async () => {
    const existing = leadFixture();
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM academy_leads l') && sql.includes('WHERE l.id = $1')) {
        return { rows: [existing] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE')) {
        return { rows: [existing] };
      }
      if (sql.includes('UPDATE "academy_leads"')) return { rows: [{ ...existing, messenger: '@Student' }] };
      return emptyResult();
    });

    const response = await request(await createApp())
      .patch('/api/academy/leads/42')
      .send({ messenger: '@Student' });

    expect(response.status).toBe(200);
    const duplicateSql = mocks.poolQuery.mock.calls.map(([sql]) => String(sql));
    expect(duplicateSql.some((sql) => sql.includes('LOWER(BTRIM(l.messenger)) = LOWER(BTRIM($2))'))).toBe(true);
    expect(duplicateSql.some((sql) => sql.includes('lead_id IS DISTINCT FROM $3'))).toBe(true);
    const studentDuplicateCall = mocks.poolQuery.mock.calls.find(([sql]) => String(sql).includes('lead_id IS DISTINCT FROM $3'));
    expect(studentDuplicateCall?.[1]).toEqual([null, '@Student', 42, 'student']);
  });

  it('offers an assigned sales manager a merge when a new lead has an existing phone', async () => {
    mocks.actor = { id: 7, workspace: 'sales', workspaces: ['sales'] };
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT 'lead' AS entity_type")) {
        return {
          rows: [{
            entity_type: 'lead',
            id: 55,
            contact_name: 'Existing parent',
            phone: '+998901112233',
            phone_numbers: ['+998901112233'],
            manager_id: 7,
            manager_name: 'Sales manager',
            is_archived: false,
          }],
        };
      }
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/leads')
      .send({
        contactName: 'Duplicate parent',
        phoneNumbers: ['+998 90 111 22 33'],
        sourceId: 1,
        managerId: 7,
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual(expect.objectContaining({
      error: 'clientAlreadyExists',
      duplicate: expect.objectContaining({
        id: 55,
        entityType: 'lead',
        canMerge: true,
      }),
    }));
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('includes the student identity when checking a shared family phone', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/leads')
      .send({
        contactName: 'Shared parent',
        studentName: 'Younger Child',
        phoneNumbers: ['+998 90 111 22 33'],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('sourceRequired');
    const duplicateCalls = [
      ...mocks.poolQuery.mock.calls,
      ...mocks.clientQuery.mock.calls,
    ].filter(([sql]) => String(sql).includes("SELECT 'lead' AS entity_type"));
    expect(duplicateCalls.length).toBeGreaterThanOrEqual(2);
    for (const [sql, values] of duplicateCalls) {
      expect(String(sql)).toContain('REGEXP_REPLACE(BTRIM(l.student_name)');
      expect(values?.[3]).toBe('younger child');
    }
  });

  it('merges lead relationships into the retained card and archives the duplicate atomically', async () => {
    const retained = leadFixture({
      id: 101,
      contact_name: 'Retained parent',
      phone: '+998901010101',
      manager_id: null,
      is_archived: false,
      referral_code: null,
    });
    const duplicate = leadFixture({
      id: 202,
      contact_name: 'Duplicate parent',
      phone: '+998902020202',
      manager_id: null,
      is_archived: false,
      referral_code: 'REF-202',
    });
    const merged = { ...retained, phone: '+998901010101', referral_code: 'REF-202' };

    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('FROM academy_leads') && sql.includes('id = ANY($1::int[])') && sql.includes('FOR UPDATE')) {
        return { rows: [retained, duplicate] };
      }
      if (sql.includes('retained_students') && sql.includes('duplicate_students')) {
        return { rows: [{ retained_students: 0, duplicate_students: 0 }] };
      }
      if (sql.includes('AS instagram_conversations') && sql.includes('AS notifications')) {
        return { rows: [{ instagram_conversations: 1, tasks: 2, notifications: 1, phones: 1 }] };
      }
      if (sql.includes('FROM academy_lead_phones') && sql.includes('lead_id = ANY')) {
        return {
          rows: [
            { id: 1, lead_id: 101, phone: '+998901010101', normalized_phone: '998901010101', is_primary: true },
            { id: 2, lead_id: 202, phone: '+998902020202', normalized_phone: '998902020202', is_primary: true },
          ],
        };
      }
      if (sql.includes('FROM academy_lead_phones') && sql.includes('lead_id = $1') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            { id: 1, lead_id: 101, phone: '+998901010101', normalized_phone: '998901010101', is_primary: true },
            { id: 2, lead_id: 101, phone: '+998902020202', normalized_phone: '998902020202', is_primary: false },
          ],
        };
      }
      if (sql.includes('UPDATE "academy_leads"')) {
        return { rows: [Number(values[0]) === 101 ? merged : { ...duplicate, is_archived: true }] };
      }
      if (sql.includes('INSERT INTO "audit_logs"')) return { rows: [{ id: 900 }] };
      if (sql.includes(')::int AS total')) return { rows: [{ total: 0 }] };
      if (sql.includes('FROM academy_leads l') && sql.includes('WHERE l.id = $1')) return { rows: [merged] };
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/leads/merge')
      .send({ retainedLeadId: 101, duplicateLeadId: 202 });

    expect(response.status, String(mocks.loggerError.mock.calls[0]?.[1]?.error?.stack)).toBe(200);
    expect(response.body.retainedLead).toEqual(expect.objectContaining({ id: 101 }));
    const statements = mocks.clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes('UPDATE instagram_conversations'))).toBe(true);
    expect(statements.some((sql) => sql.includes('UPDATE academy_tasks'))).toBe(true);
    expect(statements.some((sql) => sql.includes('INSERT INTO "audit_logs"'))).toBe(true);
    const archiveUpdate = mocks.clientQuery.mock.calls.find(([sql, values]) => (
      String(sql).includes('UPDATE "academy_leads"') && Number(values?.[0]) === 202
    ));
    expect(String(archiveUpdate?.[0])).toContain('"archive_reason"');
    expect(String(archiveUpdate?.[0])).toContain('"phone"');
    expect(archiveUpdate?.[1]).toContain('duplicate_or_invalid');
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('moves all student records when both lead cards already have students', async () => {
    const retained = leadFixture({ id: 101, manager_id: null, is_archived: false });
    const duplicate = leadFixture({ id: 202, manager_id: null, is_archived: false });
    const merged = { ...retained };
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('FROM academy_leads') && sql.includes('id = ANY($1::int[])') && sql.includes('FOR UPDATE')) {
        return { rows: [retained, duplicate] };
      }
      if (sql.includes('AS instagram_conversations') && sql.includes('AS notifications')) {
        return { rows: [{ students: 1 }] };
      }
      if (sql.includes('FROM academy_lead_phones') && sql.includes('lead_id = ANY')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT * FROM academy_students WHERE lead_id = $1 FOR UPDATE')) {
        return { rows: [{ id: 11, lead_id: 101 }, { id: 22, lead_id: 101 }] };
      }
      if (sql.includes('UPDATE "academy_leads"')) {
        return { rows: [Number(values[0]) === 101 ? merged : { ...duplicate, is_archived: true }] };
      }
      if (sql.includes('INSERT INTO "audit_logs"')) return { rows: [{ id: 901 }] };
      if (sql.includes(')::int AS total')) return { rows: [{ total: 0 }] };
      if (sql.includes('FROM academy_leads l') && sql.includes('WHERE l.id = $1')) return { rows: [merged] };
      return emptyResult();
    });

    const response = await request(await createApp())
      .post('/api/academy/leads/merge')
      .send({ retainedLeadId: 101, duplicateLeadId: 202 });

    expect(response.status, String(mocks.loggerError.mock.calls[0]?.[1]?.error?.stack)).toBe(200);
    const studentMove = mocks.clientQuery.mock.calls.find(([sql]) => (
      String(sql).includes('UPDATE academy_students SET lead_id = $1')
    ));
    expect(studentMove?.[1]).toEqual([101, 202]);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('rejects an unknown explicit source and creates source codes only inside the lead transaction', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('INSERT INTO academy_lead_sources')) {
        return { rows: [{ id: 12, code: 'event_robotics', is_active: true }] };
      }
      return emptyResult();
    });

    const unknown = await request(await createApp())
      .post('/api/academy/leads')
      .send({ contactName: 'Parent', sourceId: 999 });
    const rolledBack = await request(await createApp())
      .post('/api/academy/leads')
      .send({ contactName: 'Parent', sourceCode: 'event_robotics' });

    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe('invalidLeadSource');
    expect(rolledBack.status).toBe(409);
    expect(rolledBack.body.error).toBe('noActivePipelineStages');
    const sourceInsert = mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO academy_lead_sources'));
    expect(String(sourceInsert?.[0])).toContain('ON CONFLICT (code) DO UPDATE');
    expect(mocks.clientQuery.mock.calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(2);
    expect(mocks.poolQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO academy_lead_sources'))).toBe(false);
  });

  it('protects system lead sources from deletion and privilege changes', async () => {
    mocks.actor = { id: 9, workspace: 'marketing', workspaces: ['marketing'] };
    const systemSource = {
      id: 5,
      code: 'instagram',
      name: 'Instagram',
      channel: 'instagram',
      is_system: true,
      is_active: true,
      cost_per_lead_uzs: 0,
    };
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM "academy_lead_sources" WHERE id = $1')) {
        return { rows: [systemSource] };
      }
      return emptyResult();
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return emptyResult();
      if (sql.includes('SELECT * FROM "academy_lead_sources" WHERE id = $1 FOR UPDATE')) {
        return { rows: [systemSource] };
      }
      return emptyResult();
    });

    const remove = await request(await createApp()).delete('/api/academy/sources/5');
    const demote = await request(await createApp())
      .patch('/api/academy/sources/5')
      .send({ isSystem: false });

    expect(remove.status).toBe(409);
    expect(remove.body.error).toBe('systemLeadSourceProtected');
    expect(demote.status).toBe(409);
    expect(demote.body.error).toBe('systemLeadSourceProtected');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM "academy_lead_sources"'))).toBe(false);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE "academy_lead_sources"'))).toBe(false);
  });

  it('delegates manual automation runs to the shared idempotent service', async () => {
    mocks.runAutomations.mockResolvedValue(['payment:9:overdue']);

    const response = await request(await createApp()).post('/api/academy/automations/run');

    expect(response.status).toBe(200);
    expect(response.body.actions).toEqual(['payment:9:overdue']);
    expect(mocks.runAutomations).toHaveBeenCalledTimes(1);
    expect(mocks.runAutomations).toHaveBeenCalledWith(1);
  });
});
