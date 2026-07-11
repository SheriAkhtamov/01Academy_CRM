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
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../server/services/workforce-policy', () => ({
  getWorkforcePolicy: vi.fn(async () => ({ salesPhoneVisibility: 'own_leads' })),
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
  });

  it('fails closed when a teacher workspace has no teacher profile mapping', async () => {
    mocks.actor = { id: 7, workspace: 'teacher', workspaces: ['teacher'] };
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM academy_teachers WHERE user_id')) return emptyResult();
      if (sql.includes('FROM academy_groups g') && !sql.includes('WHERE g.teacher_id = $1')) {
        return { rows: [{ id: 999, name: 'Other teacher group' }] };
      }
      if (sql.includes('SELECT st.*') && !sql.includes('st.group_id IN')) {
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

  it('does not let a sales-only user mark lesson attendance', async () => {
    mocks.actor = { id: 8, workspace: 'sales', workspaces: ['sales'] };

    const response = await request(await createApp())
      .post('/api/academy/lessons/10/attendance')
      .send({ attendance: [] });

    expect(response.status).toBe(403);
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
    expect(response.body.error).toBe('Teacher can mark only own lessons');
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

  it('does not grant the same referral reward on a later payment', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT * FROM academy_students WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 5, lead_id: 42, group_id: 3, manager_id: 1 }] };
      }
      if (sql.includes('INSERT INTO "academy_payments"')) {
        return { rows: [{ id: 100, lead_id: 42, student_id: 5, paid_until: values[9] }] };
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
      if (sql.includes('FROM academy_rooms WHERE id = $1')) {
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
        scheduledAt: '2026-07-13T10:00:00.000+05:00',
        durationMinutes: 60,
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('teacherUnavailableForLesson');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO "academy_lessons"'))).toBe(false);
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

  it('delegates manual automation runs to the shared idempotent service', async () => {
    mocks.runAutomations.mockResolvedValue(['payment:9:overdue']);

    const response = await request(await createApp()).post('/api/academy/automations/run');

    expect(response.status).toBe(200);
    expect(response.body.actions).toEqual(['payment:9:overdue']);
    expect(mocks.runAutomations).toHaveBeenCalledTimes(1);
    expect(mocks.runAutomations).toHaveBeenCalledWith(1);
  });
});
