import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const administrationUser = {
  id: 7,
  email: 'admin@example.com',
  password: 'hashed',
  fullName: 'Admin User',
  workspace: 'administration',
  workspaces: ['administration'],
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
vi.mock('../server/services/credential-password', () => ({
  decryptCredentialPassword: vi.fn(),
  encryptCredentialPassword: vi.fn(),
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

  it('rejects unknown workspace values instead of silently dropping them', async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post('/test/session');

    const response = await agent.post('/api/users').send({
      fullName: 'Sales User',
      workspace: 'sales',
      workspaces: ['sales', 'typo'],
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
      workspace: 'teacher',
      workspaces: ['teacher'],
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
    const currentUser = { ...administrationUser, workspaces: ['administration', 'sales'] };
    const updatedUser = { ...administrationUser, workspaces: ['administration'] };
    mockStorage.getUser
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(updatedUser);

    const statements: string[] = [];
    const client = {
      release: vi.fn(),
      query: vi.fn(async (statement: string) => {
        statements.push(statement.trim());
        if (statement.includes('SELECT id, full_name, workspace, is_active')) {
          return { rows: [{ id: 7, full_name: 'Admin User', workspace: 'administration', is_active: true }] };
        }
        if (statement.includes('SELECT workspace FROM user_workspaces')) {
          return { rows: [{ workspace: 'administration' }, { workspace: 'sales' }] };
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
      workspace: 'administration',
      workspaces: ['administration'],
      isActive: true,
      leadTransferManagerId: 8,
    });

    expect(response.status).toBe(200);
    const transferIndex = statements.findIndex((statement) => statement.includes('UPDATE academy_leads'));
    const accessUpdateIndex = statements.findIndex((statement) => statement.includes('UPDATE users'));
    const commitIndex = statements.findIndex((statement) => statement === 'COMMIT');
    expect(transferIndex).toBeGreaterThan(-1);
    expect(accessUpdateIndex).toBeGreaterThan(transferIndex);
    expect(commitIndex).toBeGreaterThan(accessUpdateIndex);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
