import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const administrationUser = {
  id: 7,
  email: 'admin@example.com',
  password: 'hashed',
  fullName: 'Admin User',
  module: 'administration',
  modules: ['administration'],
  isActive: true,
  hasReportAccess: true,
};

const mockStorage = {
  getUser: vi.fn(),
  getUsers: vi.fn(),
  createAuditLog: vi.fn(),
};
const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
};
vi.mock('../server/storage', () => ({ storage: mockStorage }));
vi.mock('../server/db', () => ({ pool: mockPool }));
vi.mock('../server/services/auth', () => ({
  authService: {
    sanitizeUser: vi.fn((user) => user),
    createUser: vi.fn(),
    hashPassword: vi.fn(),
  },
}));
vi.mock('../server/services/email', () => ({
  emailService: { sendWelcomeEmail: vi.fn() },
}));
describe('user route validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getUser.mockResolvedValue(administrationUser);
    mockStorage.createAuditLog.mockResolvedValue(undefined);
  });

  const createApp = async () => {
    const { default: userRoutes } = await import('../server/routes/user.routes');
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
    app.post('/test/session', (req, res) => {
      req.session.userId = administrationUser.id;
      req.session.save(() => res.json({ ok: true }));
    });
    app.use('/api/users', userRoutes);
    return app;
  };

  it('rejects malformed IDs instead of partially parsing them', async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');

    const response = await agent.get('/api/users/1abc/sales-lead-count');

    expect(response.status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('rejects unknown module values instead of silently dropping them', async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');

    const response = await agent.post('/api/users').send({
      fullName: 'Sales User',
      module: 'sales',
      modules: ['sales', 'typo'],
    });

    expect(response.status).toBe(400);
    expect(mockStorage.getUsers).not.toHaveBeenCalled();
  });

  it('rejects string booleans instead of treating "false" as true', async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');

    const response = await agent.put('/api/users/7').send({ isActive: 'false' });

    expect(response.status).toBe(400);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('does not let the generic profile endpoint bypass credential confirmation', async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');

    const response = await agent.put('/api/users/7').send({
      email: 'changed@example.com',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('loginManagedInCredentials');
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('rejects calendar dates that JavaScript would otherwise roll forward', async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');

    const response = await agent.put('/api/users/7').send({ dateOfBirth: '2026-02-31' });

    expect(response.status).toBe(400);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('rejects malformed teacher availability before opening a transaction', async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');

    const response = await agent.put('/api/users/7').send({
      teacherAvailability: [{
        dayOfWeek: 1,
        startTime: '25:00',
        endTime: '18:00',
      }],
    });

    expect(response.status).toBe(400);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('keeps teacher availability under administration control', async () => {
    const teacherUser = {
      ...administrationUser,
      module: 'teacher',
      modules: ['teacher'],
      hasReportAccess: false,
    };
    mockStorage.getUser.mockResolvedValue(teacherUser);
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');

    const response = await agent.put('/api/users/7').send({
      teacherSchoolIds: [1],
      teacherAvailability: [],
    });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('adminAccessRequired');
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('commits lead transfer and access removal through the same database client', async () => {
    const currentUser = { ...administrationUser, modules: ['administration', 'sales'] };
    const updatedUser = { ...administrationUser, modules: ['administration'] };
    mockStorage.getUser
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(updatedUser);

    const statements: string[] = [];
    const client = {
      release: vi.fn(),
      query: vi.fn(async (statement: string, _params?: unknown[]) => {
        statements.push(statement.trim());
        if (statement.includes('SELECT id, full_name, module, is_active')) {
          return { rows: [{ id: 7, full_name: 'Admin User', module: 'administration', is_active: true }] };
        }
        if (statement.includes('SELECT module FROM user_modules')) {
          return { rows: [{ module: 'administration' }, { module: 'sales' }] };
        }
        if (statement.includes('AS lead_count')) {
          return { rows: [{ lead_count: 1, student_count: 0, open_task_count: 0 }] };
        }
        if (statement.includes('SELECT u.id, u.full_name')) {
          return { rows: [{ id: 8, full_name: 'Sales Manager' }] };
        }
        if (statement.includes('FROM academy_leads') && statement.includes('FOR UPDATE')) {
          return { rows: [{ id: 10 }] };
        }
        if (statement.includes('FROM academy_students') && statement.includes('FOR UPDATE')) {
          return { rows: [] };
        }
        if (statement.includes('UPDATE academy_tasks')) return { rows: [], rowCount: 0 };
        if (statement.includes('SELECT id FROM academy_teachers')) return { rows: [] };
        return { rows: [], rowCount: 1 };
      }),
    };
    mockPool.connect.mockResolvedValue(client);

    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');
    const response = await agent.put('/api/users/7').send({
      fullName: 'Admin User',
      module: 'administration',
      modules: ['administration'],
      isActive: true,
      leadTransferManagerId: 8,
    });

    expect(response.status).toBe(200);
    const transferIndex = statements.findIndex((statement) => statement.includes('UPDATE academy_leads'));
    const transferStatement = statements[transferIndex];
    const accessUpdateIndex = statements.findIndex((statement) => statement.includes('UPDATE users'));
    const commitIndex = statements.findIndex((statement) => statement === 'COMMIT');
    expect(transferIndex).toBeGreaterThan(-1);
    expect(transferStatement).toContain('first_viewed_at = NULL');
    expect(transferStatement).toContain('first_viewed_by = NULL');
    expect(accessUpdateIndex).toBeGreaterThan(transferIndex);
    expect(commitIndex).toBeGreaterThan(accessUpdateIndex);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('transfers every assigned responsibility before deleting a sales employee', async () => {
    const departingUser = {
      ...administrationUser,
      id: 16,
      fullName: 'Departing Sales User',
      module: 'sales',
      modules: ['sales'],
      hasReportAccess: false,
    };
    mockStorage.getUser
      .mockResolvedValueOnce(administrationUser)
      .mockResolvedValueOnce(departingUser);

    const statements: string[] = [];
    const client = {
      release: vi.fn(),
      query: vi.fn(async (statement: string, _params?: unknown[]) => {
        statements.push(statement.trim());
        if (statement.includes('AS has_leadership')) {
          return { rows: [{ id: 16, is_active: true, has_leadership: false }] };
        }
        if (statement.includes('AS lead_count')) {
          return { rows: [{ lead_count: 1, student_count: 1, open_task_count: 1 }] };
        }
        if (statement.includes('SELECT u.id, u.full_name')) {
          return { rows: [{ id: 8, full_name: 'Replacement Sales User' }] };
        }
        if (statement.includes('FROM academy_leads') && statement.includes('FOR UPDATE')) {
          return { rows: [{ id: 10 }] };
        }
        if (statement.includes('FROM academy_students') && statement.includes('FOR UPDATE')) {
          return { rows: [{ id: 20 }] };
        }
        if (statement.includes('UPDATE academy_tasks')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
    };
    mockPool.connect.mockResolvedValue(client);

    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');
    const response = await agent.delete('/api/users/16?leadTransferManagerId=8');

    expect(response.status).toBe(200);
    expect(response.body.transferredLeadCount).toBe(3);
    const leadTransferIndex = statements.findIndex((statement) => statement.includes('UPDATE academy_leads'));
    const studentTransferIndex = statements.findIndex((statement) => statement.includes('UPDATE academy_students'));
    const taskTransferIndex = statements.findIndex((statement) => statement.includes('UPDATE academy_tasks'));
    const historyIndex = statements.findIndex((statement) => statement.includes('INSERT INTO academy_lead_assignment_history'));
    const deleteIndex = statements.findIndex((statement) => statement.includes('DELETE FROM users'));
    const commitIndex = statements.findIndex((statement) => statement === 'COMMIT');
    expect(leadTransferIndex).toBeGreaterThan(-1);
    expect(studentTransferIndex).toBeGreaterThan(leadTransferIndex);
    expect(taskTransferIndex).toBeGreaterThan(studentTransferIndex);
    expect(historyIndex).toBeGreaterThan(taskTransferIndex);
    expect(deleteIndex).toBeGreaterThan(historyIndex);
    expect(commitIndex).toBeGreaterThan(deleteIndex);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('never allows an administrator to archive their own account', async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');

    const response = await agent.post('/api/users/7/archive');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('cannotArchiveOwnAccount');
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('transfers all responsibilities and revokes access before archiving an employee', async () => {
    const departingUser = {
      ...administrationUser,
      id: 16,
      fullName: 'Departing Sales User',
      module: 'sales',
      modules: ['sales'],
      isArchived: false,
    };
    const archivedUser = { ...departingUser, isActive: false, isArchived: true };
    mockStorage.getUser
      .mockResolvedValueOnce(administrationUser)
      .mockResolvedValueOnce(departingUser)
      .mockResolvedValueOnce(archivedUser);

    const statements: string[] = [];
    const client = {
      release: vi.fn(),
      query: vi.fn(async (statement: string) => {
        statements.push(statement.trim());
        if (statement.includes('AS has_leadership')) {
          return { rows: [{ id: 16, is_active: true, is_archived: false, has_leadership: false }] };
        }
        if (statement.includes('AS lead_count')) {
          return { rows: [{ lead_count: 1, student_count: 1, open_task_count: 1 }] };
        }
        if (statement.includes('SELECT u.id, u.full_name')) {
          return { rows: [{ id: 8, full_name: 'Replacement Sales User' }] };
        }
        if (statement.includes('FROM academy_leads') && statement.includes('FOR UPDATE')) {
          return { rows: [{ id: 10 }] };
        }
        if (statement.includes('FROM academy_students') && statement.includes('FOR UPDATE')) {
          return { rows: [{ id: 20 }] };
        }
        if (statement.includes('UPDATE academy_tasks')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
    };
    mockPool.connect.mockResolvedValue(client);

    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');
    const response = await agent.post('/api/users/16/archive').send({ leadTransferManagerId: 8 });

    expect(response.status).toBe(200);
    expect(response.body.transferredResponsibilityCount).toBe(3);
    const transferIndex = statements.findIndex((statement) => statement.includes('UPDATE academy_leads'));
    const transferStatement = statements[transferIndex];
    const archiveIndex = statements.findIndex((statement) => statement.includes('SET is_archived = true'));
    const sessionRevocationIndex = statements.findIndex((statement) => statement.includes('DELETE FROM "session"'));
    const commitIndex = statements.findIndex((statement) => statement === 'COMMIT');
    expect(archiveIndex).toBeGreaterThan(transferIndex);
    expect(transferStatement).toContain('first_viewed_at = NULL');
    expect(transferStatement).toContain('first_viewed_by = NULL');
    expect(sessionRevocationIndex).toBeGreaterThan(archiveIndex);
    expect(commitIndex).toBeGreaterThan(sessionRevocationIndex);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('blocks archiving the last active administrator inside the access lock', async () => {
    const target = { ...administrationUser, id: 16, isArchived: false };
    mockStorage.getUser
      .mockResolvedValueOnce(administrationUser)
      .mockResolvedValueOnce(target);
    const client = {
      release: vi.fn(),
      query: vi.fn(async (statement: string) => {
        if (statement.includes('AS has_leadership')) {
          return { rows: [{ id: 16, is_active: true, is_archived: false, has_leadership: true }] };
        }
        if (statement.includes('COUNT(*)::int AS count')) return { rows: [{ count: 1 }] };
        return { rows: [], rowCount: 1 };
      }),
    };
    mockPool.connect.mockResolvedValue(client);

    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');
    const response = await agent.post('/api/users/16/archive');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('cannotArchiveLastLeadershipAccount');
    expect(client.query.mock.calls.some(([statement]) => String(statement).includes('SET is_archived = true'))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('keeps repeated archive requests idempotent', async () => {
    const archivedUser = {
      ...administrationUser,
      id: 16,
      module: 'sales',
      modules: ['sales'],
      isActive: false,
      isArchived: true,
    };
    mockStorage.getUser
      .mockResolvedValueOnce(administrationUser)
      .mockResolvedValueOnce(archivedUser)
      .mockResolvedValueOnce(archivedUser);
    const client = {
      release: vi.fn(),
      query: vi.fn(async (statement: string) => {
        if (statement.includes('AS has_leadership')) {
          return { rows: [{ id: 16, is_active: false, is_archived: true, has_leadership: false }] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    mockPool.connect.mockResolvedValue(client);

    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');
    const response = await agent.post('/api/users/16/archive');

    expect(response.status).toBe(200);
    expect(response.body.alreadyArchived).toBe(true);
    expect(client.query.mock.calls.some(([statement]) => String(statement).includes('SET is_archived = true'))).toBe(false);
    expect(mockStorage.createAuditLog).not.toHaveBeenCalled();
  });

  it('restores the employee previous inactive state without granting access', async () => {
    const archivedUser = {
      ...administrationUser,
      id: 16,
      module: 'sales',
      modules: ['sales'],
      isActive: false,
      isArchived: true,
    };
    const restoredUser = { ...archivedUser, isArchived: false };
    mockStorage.getUser
      .mockResolvedValueOnce(administrationUser)
      .mockResolvedValueOnce(archivedUser)
      .mockResolvedValueOnce(restoredUser);
    const client = {
      release: vi.fn(),
      query: vi.fn(async (statement: string, _params?: unknown[]) => {
        if (statement.includes('archived_previous_is_active')) {
          return {
            rows: [{
              id: 16,
              full_name: 'Inactive Sales User',
              module: 'sales',
              is_archived: true,
              archived_previous_is_active: false,
              archived_previous_online_pbx_incoming_enabled: true,
            }],
          };
        }
        if (statement.includes('SELECT module FROM user_modules')) return { rows: [{ module: 'sales' }] };
        if (statement.includes('SELECT id FROM academy_teachers')) return { rows: [] };
        return { rows: [], rowCount: 1 };
      }),
    };
    mockPool.connect.mockResolvedValue(client);

    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');
    const response = await agent.post('/api/users/16/restore');

    expect(response.status).toBe(200);
    const restoreCall = client.query.mock.calls.find(([statement]) => (
      String(statement).includes('SET is_archived = false')
    ));
    expect(restoreCall?.[1]).toEqual([16, false, false]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('does not assign a telephony extension without Sales access', async () => {
    const currentUser = { ...administrationUser, onlinePbxExtension: null };
    const updatedUser = { ...administrationUser, onlinePbxExtension: null };
    mockStorage.getUser
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(updatedUser);

    const client = {
      release: vi.fn(),
      query: vi.fn(async (statement: string, _params?: unknown[]) => {
        if (statement.includes('SELECT id, full_name, module, is_active')) {
          return {
            rows: [{
              id: 7,
              full_name: 'Admin User',
              module: 'administration',
              is_active: true,
              online_pbx_extension: null,
            }],
          };
        }
        if (statement.includes('SELECT module FROM user_modules')) {
          return { rows: [{ module: 'administration' }] };
        }
        if (statement.includes('SELECT id FROM academy_teachers')) return { rows: [] };
        return { rows: [], rowCount: 1 };
      }),
    };
    mockPool.connect.mockResolvedValue(client);

    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');
    const response = await agent.put('/api/users/7').send({
      position: 'CEO',
    });

    expect(response.status).toBe(200);
    const updateCall = client.query.mock.calls.find(([statement]) =>
      String(statement).includes('UPDATE users')
    );
    expect(updateCall?.[1]).not.toEqual(expect.arrayContaining(['100', '101']));
  });

  it('does not create or assign an OnlinePBX extension to a new Sales employee', async () => {
    mockStorage.getUsers.mockResolvedValue([]);
    const createdUser = {
      id: 20,
      email: 'sales.new.user@01academy.local',
      fullName: 'New Sales User',
      module: 'sales',
      modules: ['sales'],
      onlinePbxExtension: null,
      isActive: true,
    };
    const client = {
      release: vi.fn(),
      query: vi.fn(async (statement: string, _params?: unknown[]) => {
        if (statement.includes('INSERT INTO users')) return { rows: [createdUser], rowCount: 1 };
        if (statement.includes('SELECT id FROM academy_teachers')) return { rows: [] };
        return { rows: [], rowCount: 1 };
      }),
    };
    mockPool.connect.mockResolvedValue(client);

    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');
    const response = await agent.post('/api/users').send({
      fullName: 'New Sales User',
      module: 'sales',
      modules: ['sales'],
      onlinePbxExtension: '109',
      isActive: true,
    });

    expect(response.status).toBe(200);
    const insertCall = client.query.mock.calls.find(([statement]) =>
      String(statement).includes('INSERT INTO users')
    );
    expect(insertCall?.[1]?.[5]).toBeNull();
  });
});
