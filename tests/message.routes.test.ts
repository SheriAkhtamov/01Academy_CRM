import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getConversationsByUser: vi.fn(),
  getMessagesBetweenUsers: vi.fn(),
  createMessage: vi.fn(),
  markMessageAsRead: vi.fn(),
  markConversationAsRead: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock("../server/storage", () => ({
  storage: {
    getUser: mocks.getUser,
    getConversationsByUser: mocks.getConversationsByUser,
    getMessagesBetweenUsers: mocks.getMessagesBetweenUsers,
    createMessage: mocks.createMessage,
    markMessageAsRead: mocks.markMessageAsRead,
    markConversationAsRead: mocks.markConversationAsRead,
  },
}));

const currentUser = {
  id: 1,
  fullName: "Current User",
  email: "current@example.com",
  password: "hash",
  workspace: "sales",
  workspaces: ["sales"],
  isActive: true,
  hasReportAccess: false,
};
const colleague = { ...currentUser, id: 2, fullName: "Colleague", email: "colleague@example.com" };

describe("message routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockImplementation(async (id: number) => Number(id) === 1 ? currentUser : colleague);
    mocks.getConversationsByUser.mockResolvedValue([]);
    mocks.getMessagesBetweenUsers.mockResolvedValue([]);
    mocks.markConversationAsRead.mockResolvedValue([
      { id: 10, senderId: 2, receiverId: 1, content: "hello", isRead: true },
    ]);
  });

  const createApp = async () => {
    const module = await import("../server/routes/message.routes");
    module.setBroadcastFunction(mocks.broadcast);

    const app = express();
    app.use(express.json());
    app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false }));
    app.post("/test/session", (req, res) => {
      Object.assign(req.session, req.body);
      req.session.save(() => res.json({ ok: true }));
    });
    app.use("/api/messages", module.default);
    return app;
  };

  it("marks all inbound messages from one colleague in a single request", async () => {
    const agent = request.agent(await createApp());
    await agent.post("/test/session").send({ userId: currentUser.id });

    const response = await agent.put("/api/messages/conversations/2/read");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ updated: 1, messageIds: [10] });
    expect(mocks.markConversationAsRead).toHaveBeenCalledWith(2, 1);
    expect(mocks.broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: "MESSAGE_READ",
      audienceUserIds: [2, 1],
    }));
  });

  it("rejects non-string content and malformed receiver ids", async () => {
    const agent = request.agent(await createApp());
    await agent.post("/test/session").send({ userId: currentUser.id });

    const sendResponse = await agent.post("/api/messages").send({ receiverId: 2, content: { text: "hello" } });
    const getResponse = await agent.get("/api/messages/2oops");

    expect(sendResponse.status).toBe(400);
    expect(getResponse.status).toBe(400);
    expect(mocks.createMessage).not.toHaveBeenCalled();
  });

  it("returns 404 rather than 500 when a single message is not owned by the reader", async () => {
    mocks.markMessageAsRead.mockResolvedValue(null);
    const agent = request.agent(await createApp());
    await agent.post("/test/session").send({ userId: currentUser.id });

    const response = await agent.put("/api/messages/99/read");

    expect(response.status).toBe(404);
  });
});
