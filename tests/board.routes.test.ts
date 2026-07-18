import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStorage = {
  getUser: vi.fn(),
  board: {
    getBoards: vi.fn(),
    getDefaultBoard: vi.fn(),
    getBoard: vi.fn(),
    getTasks: vi.fn(),
    getTask: vi.fn(),
    getTaskDetail: vi.fn(),
    getMaxPosition: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    createActivity: vi.fn(),
    createComment: vi.fn(),
    getComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    createChecklistItem: vi.fn(),
    getChecklistItem: vi.fn(),
    updateChecklistItem: vi.fn(),
    deleteChecklistItem: vi.fn(),
    createAttachment: vi.fn(),
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
  workspace: "sales",
  workspaces: ["sales"],
  isActive: true,
  hasReportAccess: false,
};

const adminUser = {
  id: 1,
  fullName: "Admin User",
  email: "admin@example.com",
  password: "hashed",
  workspace: "administration",
  workspaces: ["administration"],
  isActive: true,
  hasReportAccess: true,
};

const assigneeUser = {
  id: 8,
  fullName: "Assignee User",
  email: "assignee@example.com",
  password: "hashed",
  workspace: "teacher",
  workspaces: ["teacher"],
  isActive: true,
  hasReportAccess: false,
};

describe("board routes", () => {
  let usersById = new Map<number, any>();

  beforeEach(() => {
    vi.clearAllMocks();
    usersById = new Map([
      [staffUser.id, staffUser],
      [adminUser.id, adminUser],
      [assigneeUser.id, assigneeUser],
    ]);

    mockStorage.getUser.mockImplementation(async (id: number) => usersById.get(Number(id)));
    mockStorage.board.getDefaultBoard.mockResolvedValue(defaultBoard);
    mockStorage.board.getBoard.mockResolvedValue(defaultBoard);
    mockStorage.board.getTasks.mockResolvedValue([]);
    mockStorage.board.getTask.mockResolvedValue({
      id: 100,
      boardId: defaultBoard.id,
      title: "Existing task",
      description: null,
      status: "todo",
      priority: "normal",
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
    mockStorage.board.createTask.mockImplementation(async (data: any) => ({
      id: 100,
      ...data,
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

  it("lists only the current employee's visible tasks for non-administrators", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: staffUser.id });
    const response = await agent.get("/api/board/tasks");

    expect(response.status).toBe(200);
    expect(mockStorage.board.getTasks).toHaveBeenCalledWith(defaultBoard.id, staffUser.id);
  });

  it("lists all board tasks for administrators", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: adminUser.id });
    const response = await agent.get("/api/board/tasks");

    expect(response.status).toBe(200);
    expect(mockStorage.board.getTasks).toHaveBeenCalledWith(defaultBoard.id, undefined);
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
});
