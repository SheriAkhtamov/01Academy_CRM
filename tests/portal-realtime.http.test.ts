import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createConnection, type Socket } from "node:net";
import { errorMonitor } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPortalWebSocketGateway,
  type PortalWebSocketGateway,
  type PortalWebSocketGatewayOptions,
} from "../server/realtime/portal-websocket-gateway";
import { PORTAL_COOKIE_NAME } from "../server/infrastructure/portal-session";
import { portalRealtimeEventSchema } from "@shared/contracts/portal-realtime";
import type { PortalSession } from "../server/modules/portal-identity/application/ports";
import type { PortalActorContext } from "../server/modules/portal-identity/domain/actor-context";

const secret = "isolated-portal-realtime-session-secret";
const origin = "http://portal.example.test";
const csrf = "c".repeat(43);
const sid = "a".repeat(43);
type World = Awaited<ReturnType<typeof fixture>>;
const worlds: Array<{
  server: Server;
  gateway: PortalWebSocketGateway;
  sockets: Set<WebSocket>;
  rawSockets: Set<Socket>;
}> = [];
function cookie(id = sid) {
  return `${PORTAL_COOKIE_NAME}=${id}.${createHmac("sha256", secret).update(id).digest("base64url")}`;
}
const session = (id = sid, accountId: number | null = 1): PortalSession => ({
  id,
  accountId,
  authVersion: 1,
  createdAt: Date.now(),
  lastSeenAt: Date.now(),
  absoluteExpiresAt: Date.now() + 3600000,
  csrfToken: csrf,
  reauthenticatedAt: null,
});
async function fixture(overrides: Partial<PortalWebSocketGatewayOptions> = {}) {
  const server: Server = createServer((_request, response) => response.end());
  const sessions = new Map([
    [sid, session()],
    ["b".repeat(43), session("b".repeat(43), 2)],
    ["n".repeat(43), session("n".repeat(43), null)],
  ]);
  const links = new Map<
    number,
    {
      accountId: number;
      studentId: number;
      active: boolean;
      enabled: boolean;
      permissions: PortalActorContext["permissions"];
    }
  >([
    [
      7,
      {
        accountId: 1,
        studentId: 11,
        active: true,
        enabled: true,
        permissions: ["learning.read"],
      },
    ],
    [
      8,
      {
        accountId: 1,
        studentId: 12,
        active: true,
        enabled: false,
        permissions: ["feedback.read"],
      },
    ],
    [
      17,
      {
        accountId: 2,
        studentId: 21,
        active: true,
        enabled: true,
        permissions: ["learning.read"],
      },
    ],
  ]);
  const state = { enabled: true };
  const identity = {
    resolveSession: vi.fn(async (id: string) => sessions.get(id) ?? null),
    resolveAccountActor: vi.fn(
      async (
        accountId: number,
        linkId: number,
        _permission?: import("@shared/contracts/portal-identity").PortalPermission,
        sessionId = "",
      ): Promise<PortalActorContext> => {
        const link = links.get(linkId);
        if (
          !accountId ||
          !link?.active ||
          link.accountId !== accountId ||
          !link.permissions.length
        )
          throw Object.assign(new Error("Access unavailable"), { status: 403 });
        return {
          portalAccountId: accountId,
          sessionId,
          linkId,
          studentId: link.studentId,
          kind: linkId === 8 ? "representative" : "self",
          studentClassification: linkId === 8 ? "minor" : "adult",
          permissions: [...link.permissions],
        };
      },
    ),
    getSessionDto: vi.fn(async (current: PortalSession) => ({
      subjects: [...links.entries()]
        .filter(
          ([, link]) => link.accountId === current.accountId && link.active,
        )
        .map(([linkId]) => ({ linkId })),
    })),
  };
  const gateway: PortalWebSocketGateway = createPortalWebSocketGateway(server, {
    identity,
    sessionSecret: secret,
    appUrl: origin,
    enabled: () => state.enabled,
    isActorEnabled: (actor) => links.get(actor.linkId)?.enabled ?? false,
    heartbeatMs: 60000,
    ...overrides,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected local HTTP port");
  const sockets = new Set<WebSocket>();
  const rawSockets = new Set<Socket>();
  const connect = (
    input: {
      path?: string;
      cookie?: string;
      origin?: string;
      protocols?: string[];
      autoPong?: boolean;
    } = {},
  ) => {
    const client = new WebSocket(
      `ws://127.0.0.1:${address.port}${input.path ?? "/api/portal/ws?linkId=7"}`,
      input.protocols ?? ["portal.v1", `csrf.${csrf}`],
      {
        headers: {
          Origin: input.origin ?? origin,
          Cookie: input.cookie ?? cookie(),
        },
        autoPong: input.autoPong,
      },
    );
    sockets.add(client);
    const status = new Promise<number>((resolve) => {
      client.once("open", () => resolve(101));
      client.once("unexpected-response", (_request, response) => {
        resolve(response.statusCode ?? 0);
        client.terminate();
      });
      client.on("error", () => resolve(0));
    });
    const frame = new Promise<unknown>((resolve) =>
      client.once("message", (data) => resolve(JSON.parse(data.toString()))),
    );
    return { client, status, frame };
  };
  const world = {
    server,
    gateway,
    sessions,
    links,
    state,
    identity,
    connect,
    sockets,
    rawSockets,
  };
  worlds.push(world);
  return world;
}
afterEach(async () => {
  while (worlds.length) {
    const world = worlds.pop()!;
    for (const client of world.sockets) client.terminate();
    for (const client of world.rawSockets) client.destroy();
    await world.gateway.close();
    world.server.closeAllConnections();
    await new Promise<void>((resolve) => world.server.close(() => resolve()));
  }
});
const closed = (client: WebSocket) =>
  new Promise<number>((resolve) =>
    client.once("close", (code) => resolve(code)),
  );
const message = (client: WebSocket) =>
  new Promise<unknown>((resolve) =>
    client.once("message", (data) => resolve(JSON.parse(data.toString()))),
  );
async function rawUpgrade(
  world: World,
  headers: { origin?: string; cookie?: string } = {},
  target = "/api/portal/ws?linkId=7",
) {
  const port = (world.server.address() as { port: number }).port;
  const client = createConnection({ host: "127.0.0.1", port });
  world.rawSockets.add(client);
  client.on("error", () => undefined);
  const status = new Promise<number>((resolve) => {
    let response = "";
    client.on("data", (data) => {
      response += data.toString();
      const code = /^HTTP\/1\.1 (\d+)/.exec(response)?.[1];
      if (code) resolve(Number(code));
    });
  });
  await new Promise<void>((resolve) => client.once("connect", resolve));
  client.write([
    `GET ${target} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    "Connection: Upgrade",
    "Upgrade: websocket",
    "Sec-WebSocket-Version: 13",
    "Sec-WebSocket-Key: Zml4dHVyZS1rZXktMDAwMQ==",
    `Sec-WebSocket-Protocol: portal.v1, csrf.${csrf}`,
    `Origin: ${headers.origin ?? origin}`,
    `Cookie: ${headers.cookie ?? cookie()}`,
    "", "",
  ].join("\r\n"));
  return { client, status };
}

describe("independent portal HTTP WebSocket gateway", () => {
  it.each(["/api/portal/ws-unknown", "/unclaimed-upgrade"])(
    "survives a TCP reset on the unclaimed upgrade path %s without changing HTTP or owned authorization",
    async (target) => {
      const world = await fixture();
      const errors: string[] = [];
      let arrived = () => {};
      const upgraded = new Promise<void>((resolve) => { arrived = resolve; });
      const disconnected = new Promise<void>((resolve) => {
        world.server.once("upgrade", (_request, socket) => {
          socket.on(errorMonitor, (error: NodeJS.ErrnoException) => {
            errors.push(error.code ?? "unknown");
          });
          socket.once("close", resolve);
          arrived();
        });
      });
      const unknown = await rawUpgrade(world, {}, target);
      await upgraded;
      unknown.client.resetAndDestroy();
      await disconnected;
      expect(errors).toContain("ECONNRESET");
      expect(world.identity.resolveSession).not.toHaveBeenCalled();
      const port = (world.server.address() as { port: number }).port;
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
      const live = world.connect();
      expect(await live.status).toBe(101);
      await live.frame;
    },
  );
  it("closes a malformed absolute upgrade target without querying identity or stopping HTTP", async () => {
    const world = await fixture();
    const malformed = await rawUpgrade(world, {}, "http://[");
    await new Promise<void>((resolve) => malformed.client.once("close", resolve));
    expect(world.identity.resolveSession).not.toHaveBeenCalled();
    const port = (world.server.address() as { port: number }).port;
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    const live = world.connect();
    expect(await live.status).toBe(101);
    await live.frame;
  });
  it("keeps HTTP and unrelated upgrades usable after repeated denied handshakes followed by TCP resets", async () => {
    const world = await fixture();
    const hmr = new WebSocketServer({ noServer: true });
    world.server.on("upgrade", (request, socket, head) => {
      if (request.url !== "/__vite_hmr") return;
      hmr.handleUpgrade(request, socket, head, (client) => {
        client.on("error", () => client.terminate());
      });
    });
    for (let index = 0; index < 12; index++) {
      const input = index % 2
        ? { cookie: "staff.sid=unrelated" }
        : { origin: "http://foreign.example.test" };
      const denied = await rawUpgrade(world, input);
      expect(await denied.status).toBe(index % 2 ? 401 : 403);
      denied.client.resetAndDestroy();
    }
    const port = (world.server.address() as { port: number }).port;
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    const unrelated = world.connect({ path: "/__vite_hmr", protocols: [] });
    expect(await unrelated.status).toBe(101);
    const unrelatedClosed = closed(unrelated.client);
    unrelated.client.close(1000);
    expect(await unrelatedClosed).toBe(1000);
    await new Promise<void>((resolve) => hmr.close(() => resolve()));
    const live = world.connect();
    expect(await live.status).toBe(101);
    await live.frame;
  });
  it.each(["disconnect", "reset"] as const)(
    "releases a pending authentication slot when its client sends a %s and keeps the server usable",
    async (kind) => {
      const world = await fixture({ maxPendingUpgrades: 1 });
      let release = () => {};
      const authentication = new Promise<void>((resolve) => { release = resolve; });
      world.identity.resolveSession.mockImplementationOnce(async () => {
        await authentication;
        return null;
      });
      const transportErrors: string[] = [];
      const disconnected = new Promise<void>((resolve) => {
        world.server.once("upgrade", (_request, socket) => {
          socket.on(errorMonitor, (error: NodeJS.ErrnoException) => {
            transportErrors.push(error.code ?? "unknown");
          });
          socket.once("close", resolve);
        });
      });
      const pending = await rawUpgrade(world);
      await vi.waitFor(() => expect(world.identity.resolveSession).toHaveBeenCalledTimes(1));
      if (kind === "reset") pending.client.resetAndDestroy();
      else pending.client.end();
      try {
        await disconnected;
        if (kind === "reset") expect(transportErrors).toContain("ECONNRESET");
        const port = (world.server.address() as { port: number }).port;
        expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
        const live = world.connect();
        expect(await live.status).toBe(101);
        await live.frame;
      } finally {
        release();
      }
    },
  );
  it("requires a signed authenticated portal cookie, exact origin and CSRF protocol before accepting an owned link", async () => {
    const world = await fixture();
    const cases: [Parameters<World["connect"]>[0], number][] = [
      [{ cookie: "connect.sid=staff-only" }, 401],
      [{ cookie: `${PORTAL_COOKIE_NAME}=${sid}.${"x".repeat(43)}` }, 401],
      [{ cookie: cookie("n".repeat(43)) }, 401],
      [{ origin: "http://foreign.example.test" }, 403],
      [{ protocols: ["portal.v1"] }, 403],
      [{ protocols: ["portal.v1", `csrf.${"d".repeat(43)}`] }, 403],
      [{ protocols: ["portal.v1", `csrf.${csrf}`, "extra"] }, 403],
      [{ path: "/api/portal/ws?linkId=17" }, 403],
      [{ path: "/api/portal/ws?linkId=0" }, 400],
      [{ path: `/api/portal/ws?csrf=${csrf}` }, 400],
      [{ path: "/api/portal/ws?linkId=7&linkId=8" }, 400],
    ];
    for (const [input, expected] of cases)
      expect(await world.connect(input).status).toBe(expected);
    const live = world.connect();
    expect(await live.status).toBe(101);
    expect(live.client.protocol).toBe("portal.v1");
    const event = portalRealtimeEventSchema.parse(await live.frame);
    expect(event).toMatchObject({ type: "portal.refresh", linkId: 7 });
    expect(Object.keys(event).sort()).toEqual(["linkId", "serverTime", "type"]);
    expect(JSON.stringify(event)).not.toContain(csrf);
    expect(JSON.stringify(event)).not.toContain("studentId");
    const refreshed = message(live.client);
    await world.gateway.refresh();
    expect(portalRealtimeEventSchema.parse(await refreshed).linkId).toBe(7);
    expect(world.identity.resolveAccountActor).toHaveBeenCalledWith(
      1,
      7,
      undefined,
      sid,
    );
  });
  it.each(["session", "link", "permissions", "group", "disabled"] as const)(
    "reauthenticates and closes a connected client after %s revocation",
    async (kind) => {
      const world = await fixture();
      const live = world.connect();
      expect(await live.status).toBe(101);
      await live.frame;
      if (kind === "session") world.sessions.delete(sid);
      if (kind === "link") world.links.get(7)!.active = false;
      if (kind === "permissions") world.links.get(7)!.permissions = [];
      if (kind === "group") world.links.get(7)!.enabled = false;
      if (kind === "disabled") world.state.enabled = false;
      const code = closed(live.client);
      await world.gateway.refresh();
      expect(await code).toBe(1008);
    },
  );
  it("rechecks all family grants and refreshes an unscoped family when its owned children change even without a new data revision", async () => {
    const world = await fixture({ readRevision: async () => "same-revision" });
    const family = world.connect({ path: "/api/portal/ws" });
    expect(await family.status).toBe(101);
    expect(
      portalRealtimeEventSchema.parse(await family.frame).linkId,
    ).toBeUndefined();
    const initial = message(family.client);
    await world.gateway.refresh();
    await initial;
    world.links.get(8)!.enabled = true;
    world.links.get(7)!.active = false;
    const changed = message(family.client);
    await world.gateway.refresh();
    expect(portalRealtimeEventSchema.parse(await changed)).toMatchObject({
      type: "portal.refresh",
    });
    expect(world.identity.resolveAccountActor).toHaveBeenCalledWith(
      1,
      8,
      undefined,
      sid,
    );
    world.links.get(8)!.permissions = [];
    const code = closed(family.client);
    await world.gateway.refresh();
    expect(await code).toBe(1008);
  });
  it("enforces per-account and global connection caps before creating more authenticated sockets", async () => {
    const world = await fixture({
      maxConnections: 2,
      maxConnectionsPerAccount: 1,
    });
    const first = world.connect();
    expect(await first.status).toBe(101);
    await first.frame;
    expect(await world.connect().status).toBe(429);
    const second = world.connect({
      cookie: cookie("b".repeat(43)),
      path: "/api/portal/ws?linkId=17",
    });
    expect(await second.status).toBe(101);
    await second.frame;
    const before = world.identity.resolveSession.mock.calls.length;
    expect(await world.connect().status).toBe(503);
    expect(world.identity.resolveSession.mock.calls.length).toBe(before);
  });
  it("keeps unchanged durable revisions quiet and forces refresh after a committed mutation", async () => {
    const world = await fixture({ readRevision: async () => "stable" });
    const live = world.connect();
    expect(await live.status).toBe(101);
    await live.frame;
    const frames: unknown[] = [];
    live.client.on("message", (data) =>
      frames.push(JSON.parse(data.toString())),
    );
    await world.gateway.refresh();
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    const authCalls = world.identity.resolveAccountActor.mock.calls.length;
    await world.gateway.refresh();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(frames).toHaveLength(1);
    expect(
      world.identity.resolveAccountActor.mock.calls.length,
    ).toBeGreaterThan(authCalls);
    const forced = message(live.client);
    await world.gateway.refresh({ force: true });
    expect(portalRealtimeEventSchema.parse(await forced).linkId).toBe(7);
  });
  it.each(["scoped", "family"] as const)(
    "validates the current session once for each %s refresh while rechecking every owned subject",
    async (kind) => {
      const world = await fixture({ readRevision: async () => "stable" });
      const live = world.connect({
        path: kind === "family" ? "/api/portal/ws" : "/api/portal/ws?linkId=7",
      });
      expect(await live.status).toBe(101);
      await live.frame;
      for (let index = 0; index < 2; index++) {
        world.identity.resolveSession.mockClear();
        world.identity.resolveAccountActor.mockClear();
        await world.gateway.refresh();
        expect(world.identity.resolveSession).toHaveBeenCalledExactlyOnceWith(
          sid,
        );
        expect(world.identity.resolveAccountActor).toHaveBeenCalledTimes(
          kind === "family" ? 2 : 1,
        );
        expect(world.identity.resolveAccountActor).toHaveBeenCalledWith(
          1,
          7,
          undefined,
          sid,
        );
        if (kind === "family")
          expect(world.identity.resolveAccountActor).toHaveBeenCalledWith(
            1,
            8,
            undefined,
            sid,
          );
      }
    },
  );
  it.each(["student", "account"] as const)(
    "reauthenticates only the affected %s scope and leaves other sockets for the global heartbeat",
    async (kind) => {
      const readRevision = vi.fn(async () => "stable");
      const world = await fixture({ readRevision });
      const first = world.connect();
      const second = world.connect({
        cookie: cookie("b".repeat(43)),
        path: "/api/portal/ws?linkId=17",
      });
      expect(await first.status).toBe(101);
      expect(await second.status).toBe(101);
      await Promise.all([first.frame, second.frame]);
      const target = kind === "student" ? first : second,
        foreign = kind === "student" ? second : first;
      const foreignFrames: unknown[] = [];
      foreign.client.on("message", (data) =>
        foreignFrames.push(JSON.parse(data.toString())),
      );
      world.identity.resolveSession.mockClear();
      world.identity.resolveAccountActor.mockClear();
      const delivered = message(target.client);
      await world.gateway.refresh({
        force: true,
        ...(kind === "student" ? { studentIds: [11] } : { accountIds: [2] }),
      });
      await delivered;
      expect(world.identity.resolveSession).toHaveBeenCalledExactlyOnceWith(
        kind === "student" ? sid : "b".repeat(43),
      );
      expect(world.identity.resolveAccountActor).toHaveBeenCalledTimes(1);
      expect(readRevision).not.toHaveBeenCalled();
      expect(foreignFrames).toEqual([]);
      const revoked = closed(foreign.client);
      world.sessions.delete(kind === "student" ? "b".repeat(43) : sid);
      await world.gateway.refresh();
      expect(await revoked).toBe(1008);
    },
  );
  it("merges queued student/account scopes with a global heartbeat while preserving targeted forced hints", async () => {
    const readRevision = vi.fn(async () => "stable"),
      world = await fixture({ readRevision });
    world.sessions.set("z".repeat(43), session("z".repeat(43), 3));
    world.links.set(27, {
      accountId: 3,
      studentId: 31,
      active: true,
      enabled: true,
      permissions: ["learning.read"],
    });
    const first = world.connect(),
      second = world.connect({
        cookie: cookie("b".repeat(43)),
        path: "/api/portal/ws?linkId=17",
      }),
      foreign = world.connect({
        cookie: cookie("z".repeat(43)),
        path: "/api/portal/ws?linkId=27",
      });
    expect(
      await Promise.all([first.status, second.status, foreign.status]),
    ).toEqual([101, 101, 101]);
    await Promise.all([first.frame, second.frame, foreign.frame]);
    const baseline = [
      message(first.client),
      message(second.client),
      message(foreign.client),
    ];
    await world.gateway.refresh();
    await Promise.all(baseline);
    const frames = [[], [], []] as unknown[][];
    [first, second, foreign].forEach((connection, index) =>
      connection.client.on("message", (data) =>
        frames[index].push(JSON.parse(data.toString())),
      ),
    );
    let release: () => void = () => {},
      held = true;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    world.identity.resolveSession.mockClear();
    readRevision.mockClear();
    world.identity.resolveSession.mockImplementation(async (id) => {
      if (id === sid && held) {
        held = false;
        await waiting;
      }
      return world.sessions.get(id) ?? null;
    });
    const initial = world.gateway.refresh({ force: true, studentIds: [11] });
    await vi.waitFor(() =>
      expect(world.identity.resolveSession).toHaveBeenCalledTimes(1),
    );
    const queuedAccount = world.gateway.refresh({
        force: true,
        accountIds: [2],
      }),
      queuedStudent = world.gateway.refresh({ force: true, studentIds: [11] }),
      heartbeat = world.gateway.refresh();
    release();
    await Promise.all([initial, queuedAccount, queuedStudent, heartbeat]);
    await vi.waitFor(() => {
      expect(frames[0]).toHaveLength(2);
      expect(frames[1]).toHaveLength(1);
    });
    expect(frames[2]).toEqual([]);
    expect(world.identity.resolveSession).toHaveBeenCalledTimes(4);
    expect(world.identity.resolveSession).toHaveBeenCalledWith("z".repeat(43));
    expect(readRevision).toHaveBeenCalledTimes(1);
  });
  it("admits a burst of twenty distinct accounts sharing one school IP with the production defaults", async () => {
    const world = await fixture();
    let release: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    world.identity.resolveSession.mockImplementation(async (id) => {
      await waiting;
      return world.sessions.get(id) ?? null;
    });
    const connections = Array.from({ length: 20 }, (_, index) => {
      const sessionId = String.fromCharCode(65 + index).repeat(43);
      const accountId = index + 100;
      const linkId = index + 1000;
      world.sessions.set(sessionId, session(sessionId, accountId));
      world.links.set(linkId, {
        accountId,
        studentId: index + 200,
        active: true,
        enabled: true,
        permissions: ["learning.read"],
      });
      return world.connect({
        cookie: cookie(sessionId),
        path: `/api/portal/ws?linkId=${linkId}`,
      });
    });
    await vi.waitFor(() =>
      expect(world.identity.resolveSession).toHaveBeenCalledTimes(20),
    );
    release();
    expect(
      await Promise.all(connections.map((connection) => connection.status)),
    ).toEqual(Array(20).fill(101));
    const frames = await Promise.all(
      connections.map((connection) => connection.frame),
    );
    expect(
      frames.map((frame) => portalRealtimeEventSchema.parse(frame).linkId),
    ).toEqual(Array.from({ length: 20 }, (_, index) => index + 1000));
  });
  it("preserves a forced mutation refresh queued during an ordinary durable revision read", async () => {
    let release: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const readRevision = vi.fn(async () => {
      if (readRevision.mock.calls.length === 1) await wait;
      return "stable";
    });
    const world = await fixture({ readRevision });
    const live = world.connect();
    expect(await live.status).toBe(101);
    await live.frame;
    const frames: unknown[] = [];
    live.client.on("message", (data) =>
      frames.push(JSON.parse(data.toString())),
    );
    const tick = world.gateway.refresh();
    await vi.waitFor(() => expect(readRevision).toHaveBeenCalledTimes(1));
    const forced = world.gateway.refresh({ force: true });
    release();
    await Promise.all([tick, forced]);
    await vi.waitFor(() => expect(frames).toHaveLength(2));
    expect(readRevision).toHaveBeenCalledTimes(2);
  });
  it.each(["global", "ip"] as const)(
    "caps pending %s upgrades before asynchronous authentication",
    async (kind) => {
      const world = await fixture({
        maxPendingUpgrades: kind === "global" ? 1 : 3,
        maxPendingUpgradesPerIp: 1,
        authTimeoutMs: 1000,
      });
      let release: () => void = () => {};
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      world.identity.resolveSession.mockImplementation(async (id) => {
        await waiting;
        return world.sessions.get(id) ?? null;
      });
      const first = world.connect();
      await vi.waitFor(() =>
        expect(world.identity.resolveSession).toHaveBeenCalledTimes(1),
      );
      expect(await world.connect().status).toBe(kind === "global" ? 503 : 429);
      expect(world.identity.resolveSession).toHaveBeenCalledTimes(1);
      release();
      expect(await first.status).toBe(101);
      await first.frame;
    },
  );
  it("rate-limits repeated handshakes, rejects incoming business messages and keeps disabled startup free of identity reads", async () => {
    const limited = await fixture({ maxHandshakeAttemptsPerIp: 1 });
    expect(await limited.connect({ cookie: "staff.sid=wrong" }).status).toBe(
      401,
    );
    expect(await limited.connect({ cookie: "staff.sid=wrong" }).status).toBe(
      429,
    );
    expect(limited.identity.resolveSession).not.toHaveBeenCalled();
    const disabled = await fixture({ enabled: undefined });
    expect(await disabled.connect().status).toBe(404);
    await disabled.gateway.refresh();
    expect(disabled.identity.resolveSession).not.toHaveBeenCalled();
    expect(disabled.identity.resolveAccountActor).not.toHaveBeenCalled();
    const liveWorld = await fixture();
    const live = liveWorld.connect();
    expect(await live.status).toBe(101);
    await live.frame;
    const code = closed(live.client);
    live.client.send(JSON.stringify({ studentId: 21, secret: "private body" }));
    expect(await code).toBe(1008);
  });
  it("bounds refresh authentication to four contexts and closes sessions revoked between heartbeat ticks", async () => {
    const world = await fixture({
      maxConnectionsPerAccount: 10,
      maxPendingUpgradesPerIp: 10,
      heartbeatMs: 50,
    });
    const connections = [];
    for (let index = 0; index < 8; index++) {
      const live = world.connect();
      expect(await live.status).toBe(101);
      await live.frame;
      connections.push(live);
    }
    let active = 0;
    let maximum = 0;
    world.identity.resolveSession.mockImplementation(async (id) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return world.sessions.get(id) ?? null;
    });
    await world.gateway.refresh();
    expect(maximum).toBeLessThanOrEqual(4);
    const code = closed(connections[0].client);
    world.sessions.delete(sid);
    expect(await code).toBe(1008);
  });
});
