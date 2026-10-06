import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const progressNotify = vi.hoisted(() => vi.fn());
vi.mock('../server/services/telegram-task-reminders', () => ({ notifyTelegramTaskProgress: progressNotify }));

const mockStorage = {
  getUser: vi.fn(),
  board: {
    getBoards: vi.fn(),
    getDefaultBoard: vi.fn(),
    getBoard: vi.fn(),
    getLeadReference: vi.fn(),
    getTasks: vi.fn(),
    getPendingAcceptanceCount: vi.fn(),
    getTask: vi.fn(),
    getTaskDetail: vi.fn(),
    getMaxPosition: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    createActivity: vi.fn(),
    createComment: vi.fn(),
    markCommentsRead: vi.fn(),
    getComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    createChecklistItem: vi.fn(),
    getChecklistItem: vi.fn(),
    updateChecklistItem: vi.fn(),
    deleteChecklistItem: vi.fn(),
    createAttachment: vi.fn(),
    createAttachmentWithActivity: vi.fn(),
    getAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
  },
};

vi.mock("../server/storage", () => ({
  storage: mockStorage,
}));

const defaultBoard = {
  id: 1,
  name: "Team board",
  description: null,
  isDefault: true,
  isArchived: false,
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const staffUser = {
  id: 7,
  fullName: "Staff User",
  email: "staff@example.com",
  password: "hashed",
  module: "sales",
  modules: ["sales"],
  isActive: true,
};

const adminUser = {
  id: 1,
  fullName: "Admin User",
  email: "admin@example.com",
  password: "hashed",
  module: "administration",
  modules: ["administration"],
  isActive: true,
};

const assigneeUser = {
  id: 8,
  fullName: "Assignee User",
  email: "assignee@example.com",
  password: "hashed",
  module: "teacher",
  modules: ["teacher"],
  isActive: true,
};

describe("board routes", () => {
  let usersById = new Map<number, any>();

  beforeEach(() => {
    vi.clearAllMocks();
    progressNotify.mockResolvedValue(true);
    usersById = new Map([
      [staffUser.id, staffUser],
      [adminUser.id, adminUser],
      [assigneeUser.id, assigneeUser],
    ]);

    mockStorage.getUser.mockImplementation(async (id: number) => usersById.get(Number(id)));
    mockStorage.board.getDefaultBoard.mockResolvedValue(defaultBoard);
    mockStorage.board.getBoard.mockResolvedValue(defaultBoard);
    mockStorage.board.getLeadReference.mockImplementation(async (id: number) => (
      id === 42 ? { id: 42, contactName: "Linked lead", managerId: staffUser.id } : undefined
    ));
    mockStorage.board.getTasks.mockResolvedValue([]);
    mockStorage.board.getPendingAcceptanceCount.mockResolvedValue(2);
    mockStorage.board.getTask.mockResolvedValue({
      id: 100,
      boardId: defaultBoard.id,
      title: "Existing task",
      description: null,
      status: "todo",
      priority: "normal",
      color: null,
      position: 0,
      creatorId: staffUser.id,
      assigneeId: staffUser.id,
      dueAt: null,
      acceptedAt: null,
      acceptedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockStorage.board.getMaxPosition.mockResolvedValue(0);
    mockStorage.board.createActivity.mockResolvedValue({});
    mockStorage.board.createComment.mockImplementation(async (data: any) => ({ id: 11, ...data }));
    mockStorage.board.markCommentsRead.mockResolvedValue(undefined);
    mockStorage.board.createAttachmentWithActivity.mockImplementation((data: unknown) => mockStorage.board.createAttachment(data));
    mockStorage.board.createTask.mockImplementation(async (data: any) => ({
      id: 100,
      ...data,
      color: data.color ?? null,
      acceptedAt: null,
      acceptedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  });

  const createApp = async () => {
    const { default: boardRoutes } = await import("../server/routes/board.routes");

    const app = express();
    app.use(express.json());
    app.use(
      session({
        secret: "test-secret",
        resave: false,
        saveUninitialized: false,
      }),
    );

    app.post("/test/session", (req, res) => {
      Object.assign(req.session, req.body);
      req.session.save(() => res.json({ ok: true }));
    });

    app.use("/api/board", boardRoutes);
    return app;
  };

  it("lets every employee view the shared task board", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: staffUser.id });
    const response = await agent.get("/api/board/tasks");

    expect(response.status).toBe(200);
    expect(mockStorage.board.getTasks).toHaveBeenCalledWith(defaultBoard.id, undefined, false, staffUser.id);
  });

  it("counts delegated tasks awaiting their creator's acceptance", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: staffUser.id });
    const response = await agent.get("/api/board/tasks/pending-acceptance/count");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ count: 2 });
    expect(mockStorage.board.getPendingAcceptanceCount)
      .toHaveBeenCalledWith(defaultBoard.id, staffUser.id);
  });

  it("lists all board tasks for administrators", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: adminUser.id });
    const response = await agent.get("/api/board/tasks");

    expect(response.status).toBe(200);
    expect(mockStorage.board.getTasks).toHaveBeenCalledWith(defaultBoard.id, undefined, false, adminUser.id);
  });

  it("lists accepted tasks only when the archive is requested", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: staffUser.id });
    const response = await agent.get("/api/board/tasks?archived=true");

    expect(response.status).toBe(200);
    expect(mockStorage.board.getTasks).toHaveBeenCalledWith(defaultBoard.id, undefined, true, staffUser.id);
  });

  it("rejects an invalid archive filter", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: staffUser.id });
    const response = await agent.get("/api/board/tasks?archived=eventually");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid archive filter" });
    expect(mockStorage.board.getTasks).not.toHaveBeenCalled();
  });

  it.each([staffUser, adminUser])('makes unrelated employees tasks read-only for $module', async (actor) => {
    const task = { id: 100, boardId: 1, title: 'Delegated work', creatorId: 8, assigneeId: 8, status: 'todo' };
    mockStorage.board.getTask.mockResolvedValue(task);
    mockStorage.board.getTaskDetail.mockResolvedValue(task);
    mockStorage.board.getComment.mockResolvedValue({ id: 10, taskId: 100, authorId: actor.id });
    mockStorage.board.getChecklistItem.mockResolvedValue({ id: 10, taskId: 100 });
    mockStorage.board.getAttachment.mockResolvedValue({ id: 10, taskId: 100, uploadedBy: actor.id });
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: actor.id });
    expect((await agent.get('/api/board/tasks/100')).status).toBe(200);
    const actions = [
      () => agent.patch('/api/board/tasks/100').send({ title: 'Changed', assigneeId: actor.id, creatorId: actor.id }),
      () => agent.patch('/api/board/tasks/100/status').send({ status: 'in_progress', position: 5 }),
      () => agent.patch('/api/board/tasks/100/status').send({ status: 'todo', position: 5 }),
      () => agent.delete('/api/board/tasks/100'),
      () => agent.post('/api/board/tasks/100/comments').send({ body: 'Changed' }),
      () => agent.patch('/api/board/comments/10').send({ body: 'Changed' }),
      () => agent.delete('/api/board/comments/10'),
      () => agent.post('/api/board/tasks/100/checklist').send({ content: 'Changed' }),
      () => agent.patch('/api/board/checklist/10').send({ isDone: true }),
      () => agent.delete('/api/board/checklist/10'),
      () => agent.post('/api/board/tasks/100/attachments').send({}),
      () => agent.delete('/api/board/attachments/10'),
    ];
    const responses = [];
    for (const action of actions) responses.push(await action());
    expect(responses.map((response) => response.status)).toEqual(Array(12).fill(403));
    for (const mutation of [mockStorage.board.updateTask, mockStorage.board.deleteTask, mockStorage.board.createActivity,
      mockStorage.board.createComment, mockStorage.board.updateComment, mockStorage.board.deleteComment,
      mockStorage.board.createChecklistItem, mockStorage.board.updateChecklistItem, mockStorage.board.deleteChecklistItem,
      mockStorage.board.createAttachmentWithActivity, mockStorage.board.deleteAttachment]) {
      expect(mutation).not.toHaveBeenCalled();
    }
  });

  it.each([staffUser, adminUser])('lets an assignee change status but forbids editing or deleting delegated work: $module', async (actor) => {
    const task = { id: 100, boardId: 1, title: 'Assigned to me', creatorId: 8, assigneeId: actor.id, status: 'todo' };
    mockStorage.board.getTask.mockResolvedValue(task);
    mockStorage.board.updateTask.mockImplementation(async (_id, updates) => ({ ...task, ...updates }));
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: actor.id });
    expect((await agent.patch('/api/board/tasks/100').send({ title: 'My change', dueAt: '2026-10-06T12:00:00Z', creatorId: actor.id })).status).toBe(403);
    expect((await agent.patch('/api/board/tasks/100/status').send({ status: 'in_progress' })).status).toBe(200);
    expect((await agent.delete('/api/board/tasks/100')).status).toBe(403);
    expect(mockStorage.board.deleteTask).not.toHaveBeenCalled();
    expect(mockStorage.board.updateTask).toHaveBeenCalledOnce();
    expect(mockStorage.board.updateTask).toHaveBeenCalledWith(100, expect.objectContaining({ status: 'in_progress' }));
  });

  it.each([staffUser, adminUser])('lets the creator edit and comment on work assigned to another employee: $module', async (actor) => {
    const task = { id: 100, boardId: 1, title: 'Delegated work', creatorId: actor.id, assigneeId: 8, status: 'todo' };
    mockStorage.board.getTask.mockResolvedValue(task);
    mockStorage.board.updateTask.mockImplementation(async (_id, updates) => ({ ...task, ...updates }));
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: actor.id });
    expect((await agent.patch('/api/board/tasks/100').send({ title: 'New instructions', assigneeId: 8 })).status).toBe(200);
    expect((await agent.post('/api/board/tasks/100/comments').send({ body: 'My reply' })).status).toBe(200);
    expect(mockStorage.board.createComment).toHaveBeenCalledWith({ taskId: 100, authorId: actor.id, body: 'My reply' });
    expect((await agent.delete('/api/board/tasks/100')).status).toBe(200);
    expect(mockStorage.board.deleteTask).toHaveBeenCalledWith(100, actor.id);
  });

  it.each([7, 8])('marks only the viewed comments read for participant %s', async (actorId) => {
    mockStorage.board.getTask.mockResolvedValue({ id: 100, boardId: 1, creatorId: 7, assigneeId: 8 });
    mockStorage.board.getTaskDetail.mockResolvedValue({ id: 100, boardId: 1, creatorId: 7, assigneeId: 8 });
    mockStorage.board.getComment.mockResolvedValue({ id: 10, taskId: 100, authorId: actorId === 7 ? 8 : 7 });
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: actorId });
    expect((await agent.get('/api/board/tasks/100')).status).toBe(200);
    expect(mockStorage.board.markCommentsRead).not.toHaveBeenCalled();
    expect((await agent.post('/api/board/tasks/100/comments/read').send({ throughCommentId: 10 })).status).toBe(200);
    expect(mockStorage.board.markCommentsRead).toHaveBeenCalledWith(100, actorId, 10);
  });

  it('acknowledges viewed comments when their recipient replies', async () => {
    mockStorage.board.getTask.mockResolvedValue({ id: 100, boardId: 1, creatorId: 7, assigneeId: 8 });
    mockStorage.board.getComment.mockResolvedValue({ id: 10, taskId: 100, authorId: 8 });
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: 7 });
    expect((await agent.post('/api/board/tasks/100/comments').send({ body: 'Reply', readThroughCommentId: 10 })).status).toBe(200);
    expect(mockStorage.board.markCommentsRead).toHaveBeenCalledWith(100, 7, 10);
  });

  it('rejects marking a foreign comment or another participant\'s receipt read', async () => {
    mockStorage.board.getTask.mockResolvedValue({ id: 100, boardId: 1, creatorId: 7, assigneeId: 8 });
    mockStorage.board.getComment.mockResolvedValue({ id: 10, taskId: 999, authorId: 8 });
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: 7 });
    expect((await agent.post('/api/board/tasks/100/comments/read').send({ throughCommentId: 10 })).status).toBe(400);
    await agent.post('/test/session').send({ userId: 1 });
    expect((await agent.post('/api/board/tasks/100/comments/read').send({ throughCommentId: 10, userId: 7 })).status).toBe(403);
    expect(mockStorage.board.markCommentsRead).not.toHaveBeenCalled();
  });

  it("assigns new staff-created tasks to the current employee", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: staffUser.id });
    const response = await agent.post("/api/board/tasks").send({ title: "Follow up" });

    expect(response.status).toBe(200);
    expect(mockStorage.board.createTask).toHaveBeenCalledWith(expect.objectContaining({
      creatorId: staffUser.id,
      assigneeId: staffUser.id,
    }));
  });

  it("stores a selected palette colour on a new task", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: staffUser.id });
    const response = await agent.post("/api/board/tasks").send({
      title: "Colour-coded follow up",
      color: "violet",
    });

    expect(response.status).toBe(200);
    expect(mockStorage.board.createTask).toHaveBeenCalledWith(expect.objectContaining({
      color: "violet",
    }));
  });

  it.each([
    ['in_progress', 'todo'],
    ['done', 'in_progress'],
  ])('notifies the creator when the assignee moves a delegated task to %s', async (status, from) => {
    const task = { id: 100, boardId: 1, title: 'Delegated task', creatorId: 7, assigneeId: 8, status: from };
    mockStorage.board.getTask.mockResolvedValue(task);
    mockStorage.board.updateTask.mockResolvedValue({ ...task, status });
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: 8 });
    expect((await agent.patch('/api/board/tasks/100/status').send({ status })).status).toBe(200);
    await vi.waitFor(() => expect(progressNotify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Delegated task', creatorId: 7, assigneeId: 8, actorId: 8, actorName: 'Assignee User', status,
    })));
  });

  it('skips progress messages for unchanged status, self-assigned work and changes by another actor', async () => {
    const task = { id: 100, boardId: 1, title: 'Delegated task', creatorId: 7, assigneeId: 8, status: 'in_progress' };
    mockStorage.board.getTask.mockResolvedValue(task);
    mockStorage.board.updateTask.mockImplementation(async (_id, updates) => ({ ...await mockStorage.board.getTask(), ...updates }));
    const assignee = request.agent(await createApp());
    await assignee.post('/test/session').send({ userId: 8 });
    expect((await assignee.patch('/api/board/tasks/100/status').send({ status: 'in_progress' })).status).toBe(200);
    expect(progressNotify).not.toHaveBeenCalled();

    mockStorage.board.getTask.mockResolvedValue({ ...task, status: 'todo', creatorId: 8 });
    expect((await assignee.patch('/api/board/tasks/100/status').send({ status: 'in_progress' })).status).toBe(200);
    expect(progressNotify).not.toHaveBeenCalled();

    mockStorage.board.getTask.mockResolvedValue({ ...task, status: 'todo' });
    const creator = request.agent(await createApp());
    await creator.post('/test/session').send({ userId: 7 });
    expect((await creator.patch('/api/board/tasks/100/status').send({ status: 'in_progress' })).status).toBe(403);
    expect(progressNotify).not.toHaveBeenCalled();
  });

  it("rejects arbitrary task colours on creation and update", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: staffUser.id });
    const createResponse = await agent.post("/api/board/tasks").send({
      title: "Unsafe colour",
      color: "#fff; background: url(https://example.com)",
    });
    const updateResponse = await agent.patch("/api/board/tasks/100").send({ color: "transparent" });

    expect(createResponse.status).toBe(400);
    expect(updateResponse.status).toBe(400);
    expect(mockStorage.board.createTask).not.toHaveBeenCalled();
    expect(mockStorage.board.updateTask).not.toHaveBeenCalled();
  });

  it("records a task colour change in its activity history", async () => {
    mockStorage.board.updateTask.mockImplementation(async (_id: number, updates: any) => ({
      ...await mockStorage.board.getTask(100),
      ...updates,
    }));
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: staffUser.id });
    const response = await agent.patch("/api/board/tasks/100").send({ color: "cyan" });

    expect(response.status).toBe(200);
    expect(mockStorage.board.updateTask).toHaveBeenCalledWith(100, { color: "cyan" });
    expect(mockStorage.board.createActivity).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 100,
      type: "color_changed",
      fromValue: null,
      toValue: "cyan",
    }));
  });

  it("creates a task linked to an existing lead", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: staffUser.id });
    const response = await agent.post("/api/board/tasks").send({
      title: "Call the lead",
      leadId: 42,
    });

    expect(response.status).toBe(200);
    expect(mockStorage.board.createTask).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 42,
    }));
  });

  it("rejects malformed and missing lead links", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: staffUser.id });
    const malformed = await agent.post("/api/board/tasks").send({ title: "Bad link", leadId: "42oops" });
    const missing = await agent.post("/api/board/tasks").send({ title: "Missing link", leadId: 999 });

    expect(malformed.status).toBe(400);
    expect(missing.status).toBe(404);
  });

  it("does not let an unrelated employee attach a task to a sales lead", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: assigneeUser.id });
    const response = await agent.post("/api/board/tasks").send({
      title: "Unauthorized link",
      leadId: 42,
    });

    expect(response.status).toBe(403);
    expect(mockStorage.board.createTask).not.toHaveBeenCalled();
  });

  it("allows every employee to assign a task to another active employee", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: staffUser.id });
    const response = await agent.post("/api/board/tasks").send({
      title: "Assign away",
      assigneeId: assigneeUser.id,
    });

    expect(response.status).toBe(200);
    expect(mockStorage.board.createTask).toHaveBeenCalledWith(expect.objectContaining({
      creatorId: staffUser.id,
      assigneeId: assigneeUser.id,
    }));
  });

  it("allows administrators to assign tasks to another active employee", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: adminUser.id });
    const response = await agent.post("/api/board/tasks").send({
      title: "Prepare lesson",
      assigneeId: assigneeUser.id,
    });

    expect(response.status).toBe(200);
    expect(mockStorage.board.createTask).toHaveBeenCalledWith(expect.objectContaining({
      creatorId: adminUser.id,
      assigneeId: assigneeUser.id,
    }));
  });

  it("does not allow creating an already accepted task", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: adminUser.id });
    const response = await agent.post("/api/board/tasks").send({
      title: "Skip approval",
      status: "accepted",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Task must be in Done before it can be accepted" });
    expect(mockStorage.board.createTask).not.toHaveBeenCalled();
  });

  it("records acceptance metadata before the task moves to the archive", async () => {
    const completedTask = {
      id: 100,
      boardId: defaultBoard.id,
      title: "Completed task",
      description: null,
      status: "done",
      priority: "normal",
      color: null,
      position: 0,
      creatorId: staffUser.id,
      assigneeId: staffUser.id,
      dueAt: null,
      acceptedAt: null,
      acceptedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockStorage.board.getTask.mockResolvedValue(completedTask);
    mockStorage.board.updateTask.mockImplementation(async (_id: number, updates: any) => ({
      ...completedTask,
      ...updates,
    }));

    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/test/session").send({ userId: staffUser.id });
    const response = await agent.patch("/api/board/tasks/100/status").send({ status: "accepted" });

    expect(response.status).toBe(200);
    expect(mockStorage.board.updateTask).toHaveBeenCalledWith(100, expect.objectContaining({
      status: "accepted",
      acceptedAt: expect.any(Date),
      acceptedBy: staffUser.id,
    }));
    expect(mockStorage.board.createActivity).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 100,
      type: "accepted",
    }));
  });

  it("strictly rejects malformed and negative ids instead of truncating them", async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/test/session").send({ userId: staffUser.id });

    const taskResponse = await agent.get("/api/board/tasks/100oops");
    const boardResponse = await agent.get("/api/board/tasks?boardId=-1");

    expect(taskResponse.status).toBe(400);
    expect(boardResponse.status).toBe(400);
    expect(mockStorage.board.getTaskDetail).not.toHaveBeenCalled();
  });

  it.each([
    { actor: 8, creator: 7, assignee: 8, from: 'done', to: 'accepted' },
    { actor: 1, creator: 7, assignee: 8, from: 'done', to: 'accepted' },
    { actor: 1, creator: 1, assignee: 8, from: 'accepted', to: 'todo' },
    { actor: 7, creator: 7, assignee: null, from: 'done', to: 'accepted' },
  ])('denies self-approval of delegated work and unrelated acceptance or reopening by $actor', async ({ actor, creator, assignee, from, to }) => {
    mockStorage.board.getTask.mockResolvedValue({ id: 100, boardId: 1, creatorId: creator, assigneeId: assignee, status: from });
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: actor });
    const result = await agent.patch('/api/board/tasks/100/status').send({ status: to, creatorId: actor, acceptedBy: actor });
    expect(result.status).toBe(403);
    expect(mockStorage.board.updateTask).not.toHaveBeenCalled();
    expect(mockStorage.board.createActivity).not.toHaveBeenCalled();
  });

  it('lets an employee finalize a task created for themselves', async () => {
    const task = { id: 100, boardId: 1, creatorId: 7, assigneeId: 7, status: 'done' };
    mockStorage.board.getTask.mockResolvedValue(task);
    mockStorage.board.updateTask.mockResolvedValue({ ...task, status: 'accepted' });
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: 7 });
    expect((await agent.patch('/api/board/tasks/100/status').send({ status: 'accepted' })).status).toBe(200);
  });

  it.each([staffUser, adminUser])('lets the author edit and accept delegated work while preserving assignee-only progress: $module', async (actor) => {
    const task = { id: 100, boardId: 1, creatorId: actor.id, assigneeId: 8, status: 'done' };
    mockStorage.board.getTask.mockResolvedValue(task);
    mockStorage.board.updateTask.mockImplementation(async (_id, updates) => ({ ...task, ...updates }));
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: actor.id });
    expect((await agent.patch('/api/board/tasks/100').send({ title: 'Changed' })).status).toBe(200);
    expect((await agent.patch('/api/board/tasks/100/status').send({ status: 'in_progress' })).status).toBe(403);
    expect(mockStorage.board.updateTask).toHaveBeenCalledOnce();
    expect((await agent.patch('/api/board/tasks/100/status').send({ status: 'accepted' })).status).toBe(200);
    expect(mockStorage.board.updateTask).toHaveBeenCalledWith(100, expect.objectContaining({ status: 'accepted', acceptedBy: actor.id }));
    expect((await agent.delete('/api/board/tasks/100')).status).toBe(200);
    expect(mockStorage.board.deleteTask).toHaveBeenCalledWith(100, actor.id);
  });

  it('does not let an author skip the done stage when accepting delegated work', async () => {
    mockStorage.board.getTask.mockResolvedValue({ id: 100, boardId: 1, creatorId: 7, assigneeId: 8, status: 'in_progress' });
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: 7 });
    expect((await agent.patch('/api/board/tasks/100/status').send({ status: 'accepted' })).status).toBe(400);
    expect(mockStorage.board.updateTask).not.toHaveBeenCalled();
  });

  it('makes repeated acceptance idempotent without overwriting approval history', async () => {
    mockStorage.board.getTask.mockResolvedValue({ id: 100, boardId: 1, creatorId: 7, assigneeId: 8, status: 'accepted', acceptedBy: 7 });
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: 7 });
    expect((await agent.patch('/api/board/tasks/100/status').send({ status: 'accepted' })).status).toBe(200);
    expect(mockStorage.board.updateTask).not.toHaveBeenCalled();
    expect(mockStorage.board.createActivity).not.toHaveBeenCalled();
  });

  it('rejects malformed upload/create retry keys', async () => {
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: 7 });
    expect((await agent.post('/api/board/tasks').send({ title: 'Test', requestKey: '../bad' })).status).toBe(400);
    expect((await agent.post('/api/board/tasks/100/attachments').set('X-Upload-Key', '../bad').attach('file', Buffer.from('x'), 'x.pdf')).status).toBe(400);
    expect(mockStorage.board.createAttachment).not.toHaveBeenCalled();
  });

  it.each([50 * 1024 * 1024, 50 * 1024 * 1024 + 1])('enforces the upload byte boundary %i and cleans temporary files', async (size) => {
    const fs = await import('node:fs/promises');
    const { BOARD_UPLOAD_DIR } = await import('../server/middleware/upload.middleware');
    const before = new Set(await fs.readdir(BOARD_UPLOAD_DIR));
    // Intentionally fail persistence so the test leaves no permanent file.
    mockStorage.board.createAttachment.mockRejectedValueOnce(new Error('test rollback'));
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: 7 });
    const result = await agent.post('/api/board/tasks/100/attachments').attach('file', Buffer.alloc(size), 'boundary.pdf');
    expect(result.status).toBe(size > 50 * 1024 * 1024 ? 413 : 500);
    expect(mockStorage.board.createAttachment).toHaveBeenCalledTimes(size > 50 * 1024 * 1024 ? 0 : 1);
    expect(new Set(await fs.readdir(BOARD_UPLOAD_DIR))).toEqual(before);
    mockStorage.board.createAttachment.mockReset();
  });

  it('denies uploads to observers while allowing them to read task attachments', async () => {
    mockStorage.board.getAttachment.mockResolvedValue({ id: 10, taskId: 100, fileName: 'invalid-name' });
    const agent = request.agent(await createApp());
    await agent.post('/test/session').send({ userId: 8 });
    expect((await agent.post('/api/board/tasks/100/attachments').attach('file', Buffer.from('x'), 'x.pdf')).status).toBe(403);
    expect((await agent.get('/api/board/attachments/10/download')).status).toBe(404);
    expect(mockStorage.board.createAttachment).not.toHaveBeenCalled();
  });

  it("rejects invalid due dates, board ids, and object-valued text", async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/test/session").send({ userId: adminUser.id });

    const dueDateResponse = await agent.post("/api/board/tasks").send({
      title: "Bad date",
      dueAt: "not-a-date",
    });
    const boardResponse = await agent.post("/api/board/tasks").send({
      title: "Bad board",
      boardId: "1oops",
    });
    const descriptionResponse = await agent.post("/api/board/tasks").send({
      title: "Bad description",
      description: { nested: true },
    });

    expect(dueDateResponse.status).toBe(400);
    expect(boardResponse.status).toBe(400);
    expect(descriptionResponse.status).toBe(400);
    expect(mockStorage.board.createTask).not.toHaveBeenCalled();
  });

  it("requires a real boolean for checklist completion", async () => {
    mockStorage.board.getChecklistItem.mockResolvedValue({
      id: 12,
      taskId: 100,
      content: "Check item",
      isDone: true,
    });
    mockStorage.board.updateChecklistItem.mockResolvedValue({
      id: 12,
      taskId: 100,
      content: "Check item",
      isDone: false,
    });
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/test/session").send({ userId: staffUser.id });

    const stringResponse = await agent.patch("/api/board/checklist/12").send({ isDone: "false" });
    const booleanResponse = await agent.patch("/api/board/checklist/12").send({ isDone: false });

    expect(stringResponse.status).toBe(400);
    expect(booleanResponse.status).toBe(200);
    expect(mockStorage.board.updateChecklistItem).toHaveBeenCalledTimes(1);
    expect(mockStorage.board.updateChecklistItem).toHaveBeenCalledWith(12, { isDone: false });
  });

  it("removes an uploaded file when attachment metadata cannot be saved", async () => {
    const fs = await import("node:fs/promises");
    const { BOARD_UPLOAD_DIR } = await import("../server/middleware/upload.middleware");
    const before = new Set(await fs.readdir(BOARD_UPLOAD_DIR));
    mockStorage.board.createAttachment.mockRejectedValueOnce(new Error("database unavailable"));

    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/test/session").send({ userId: staffUser.id });
    const response = await agent
      .post("/api/board/tasks/100/attachments")
      .attach("file", Buffer.from("temporary upload"), "temporary.txt");

    expect(response.status).toBe(500);
    const after = new Set(await fs.readdir(BOARD_UPLOAD_DIR));
    expect(after).toEqual(before);
  });

  it("rejects active-content attachments before writing metadata", async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/test/session").send({ userId: staffUser.id });

    const response = await agent
      .post("/api/board/tasks/100/attachments")
      .attach("file", Buffer.from("<script>alert(1)</script>"), {
        filename: "attack.html",
        contentType: "text/html",
      });

    expect(response.status).toBe(400);
    expect(mockStorage.board.createAttachment).not.toHaveBeenCalled();
  });

  it("does not resolve stored attachment names outside the upload directory", async () => {
    mockStorage.board.getAttachment.mockResolvedValue({
      id: 5,
      taskId: 100,
      fileName: "../../config/app.config.json",
      originalName: "report.txt",
      uploadedBy: staffUser.id,
    });
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/test/session").send({ userId: staffUser.id });

    const response = await agent.get("/api/board/attachments/5/download");

    expect(response.status).toBe(404);
  });
});
