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

  it("blocks non-administrators from assigning tasks to another employee", async () => {
    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: staffUser.id });
    const response = await agent.post("/api/board/tasks").send({
      title: "Assign away",
      assigneeId: assigneeUser.id,
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "taskAssignOtherEmployeesAdminOnly" });
    expect(mockStorage.board.createTask).not.toHaveBeenCalled();
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
});
