import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import {
  PORTAL_REALTIME_PATH,
  PORTAL_REALTIME_PROTOCOL,
  PORTAL_REALTIME_CSRF_PREFIX,
  type PortalRealtimeEvent,
} from "@shared/contracts/portal-realtime";
import { readPortalSessionId } from "../infrastructure/portal-session";
import type { PortalActorContext } from "../modules/portal-identity/domain/actor-context";
import type { PortalSession } from "../modules/portal-identity/application/ports";
import type { PortalPermission } from "@shared/contracts/portal-identity";
import { guardUpgradeSocket, guardUpgradeSocketErrors } from "./upgrade-socket";

type Identity = {
  resolveSession: (id: string) => Promise<PortalSession | null>;
  resolveAccountActor: (
    accountId: number,
    linkId: number,
    permission?: PortalPermission,
    sessionId?: string,
  ) => Promise<PortalActorContext>;
  getSessionDto: (
    session: PortalSession,
  ) => Promise<{ subjects: Array<{ linkId: number }> }>;
};
export type PortalRealtimeContext = {
  accountId: number;
  linkId?: number;
  studentIds: readonly number[];
};
export type PortalWebSocketGatewayOptions = {
  identity: Identity;
  sessionSecret: string;
  appUrl: string;
  enabled?: () => boolean;
  isActorEnabled?: (actor: PortalActorContext) => boolean | Promise<boolean>;
  heartbeatMs?: number;
  authTimeoutMs?: number;
  maxConnections?: number;
  maxConnectionsPerAccount?: number;
  maxPendingUpgrades?: number;
  maxPendingUpgradesPerIp?: number;
  maxHandshakeAttemptsPerIp?: number;
  /** Supply only an address resolved by the application's configured trusted proxy policy. */
  clientIp?: (request: IncomingMessage) => string;
  readRevision?: (
    contexts: readonly PortalRealtimeContext[],
  ) => Promise<string>;
};
export type PortalRefreshOptions = {
  force?: boolean;
  studentIds?: readonly number[];
  accountIds?: readonly number[];
};
export type PortalWebSocketGateway = {
  refresh: (options?: PortalRefreshOptions) => Promise<void>;
  close: () => Promise<void>;
};
type ClientContext = PortalRealtimeContext & {
  sessionId: string;
  csrfToken: string;
  fingerprint: string;
  alive: boolean;
};
type RefreshBatch = {
  global: boolean;
  forceGlobal: boolean;
  studentIds: Set<number>;
  accountIds: Set<number>;
  forcedStudentIds: Set<number>;
  forcedAccountIds: Set<number>;
};
class HandshakeError extends Error {
  constructor(readonly status: number) {
    super("Portal socket unavailable");
  }
}

/** The transport carries invalidations; canonical portal APIs remain the only source of business data. */
export function createPortalWebSocketGateway(
  server: Server,
  options: PortalWebSocketGatewayOptions,
): PortalWebSocketGateway {
  const origin = new URL(options.appUrl).origin;
  const enabled = options.enabled ?? (() => false);
  const actorEnabled = options.isActorEnabled ?? (() => false);
  const now = () => Date.now();
  const authTimeoutMs = options.authTimeoutMs ?? 5000;
  const maxConnections = options.maxConnections ?? 200;
  const maxPerAccount = options.maxConnectionsPerAccount ?? 5;
  const maxPending = options.maxPendingUpgrades ?? 20;
  const maxPendingIp = options.maxPendingUpgradesPerIp ?? 20;
  const maxAttemptsIp = options.maxHandshakeAttemptsPerIp ?? 600;
  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: 1024,
    perMessageDeflate: false,
    handleProtocols: (protocols) =>
      protocols.has(PORTAL_REALTIME_PROTOCOL)
        ? PORTAL_REALTIME_PROTOCOL
        : false,
  });
  const clients = new Map<WebSocket, ClientContext>();
  const pending = new Map<Duplex, string>();
  const accountCounts = new Map<number, number>();
  const ipAttempts = new Map<string, { count: number; until: number }>();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let refreshing: Promise<void> | null = null;
  let pendingRefresh: RefreshBatch | undefined;
  let revision: string | undefined;

  const reject = (socket: Duplex, status: number) => {
    if (socket.destroyed) return;
    const text =
      (
        {
          400: "Bad Request",
          401: "Unauthorized",
          403: "Forbidden",
          404: "Not Found",
          429: "Too Many Requests",
          503: "Service Unavailable",
        } as Record<number, string>
      )[status] ?? "Service Unavailable";
    socket.once("finish", () => socket.destroy());
    socket.end(
      `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nCache-Control: private, no-store\r\nContent-Length: 0\r\n\r\n`,
    );
  };
  const releasePending = (socket: Duplex) => {
    pending.delete(socket);
  };
  const remove = (client: WebSocket) => {
    const context = clients.get(client);
    if (!context) return;
    clients.delete(client);
    const count = (accountCounts.get(context.accountId) ?? 1) - 1;
    if (count > 0) accountCounts.set(context.accountId, count);
    else accountCounts.delete(context.accountId);
    if (!clients.size && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
  };
  const timeout = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_resolve, rejectTimeout) => {
          timer = setTimeout(
            () => rejectTimeout(new HandshakeError(503)),
            authTimeoutMs,
          );
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const authorize = async (
    sessionId: string,
    csrfToken: string,
    linkId?: number,
  ): Promise<Omit<ClientContext, "alive">> => {
    if (closed || !enabled()) throw new HandshakeError(404);
    const session = await options.identity.resolveSession(sessionId);
    if (!session?.accountId) throw new HandshakeError(401);
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(session.csrfToken) ||
      session.csrfToken.length !== csrfToken.length ||
      !timingSafeEqual(Buffer.from(session.csrfToken), Buffer.from(csrfToken))
    )
      throw new HandshakeError(403);
    const actors: PortalActorContext[] = [];
    if (linkId !== undefined) {
      const actor = await options.identity.resolveAccountActor(
        session.accountId,
        linkId,
        undefined,
        sessionId,
      );
      if (
        actor.portalAccountId !== session.accountId ||
        actor.linkId !== linkId ||
        !(await actorEnabled(actor))
      )
        throw new HandshakeError(403);
      actors.push(actor);
    } else {
      const dto = await options.identity.getSessionDto(session);
      for (const subject of dto.subjects) {
        try {
          const actor = await options.identity.resolveAccountActor(
            session.accountId,
            subject.linkId,
            undefined,
            sessionId,
          );
          if (
            actor.portalAccountId === session.accountId &&
            (await actorEnabled(actor))
          )
            actors.push(actor);
        } catch (error) {
          const status =
            (error as { status?: number; statusCode?: number }).statusCode ??
            (error as { status?: number }).status;
          if (status !== 401 && status !== 403 && status !== 404) throw error;
        }
      }
      if (!actors.length) throw new HandshakeError(403);
    }
    if (closed || !enabled()) throw new HandshakeError(404);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify(
          actors
            .map((actor) => ({
              linkId: actor.linkId,
              studentId: actor.studentId,
              kind: actor.kind,
              classification: actor.studentClassification,
              permissions: [...actor.permissions].sort(),
            }))
            .sort((left, right) => left.linkId - right.linkId),
        ),
      )
      .digest("hex");
    return {
      sessionId,
      csrfToken,
      accountId: session.accountId,
      ...(linkId === undefined ? {} : { linkId }),
      studentIds: [...new Set(actors.map((actor) => actor.studentId))],
      fingerprint,
    };
  };
  const send = (client: WebSocket, context: ClientContext) => {
    if (client.readyState !== WebSocket.OPEN || !clients.has(client) || closed)
      return;
    const event: PortalRealtimeEvent = {
      type: "portal.refresh",
      ...(context.linkId === undefined ? {} : { linkId: context.linkId }),
      serverTime: new Date().toISOString(),
    };
    client.send(JSON.stringify(event));
  };
  const matchesScope = (
    context: ClientContext,
    studentIds: Set<number>,
    accountIds: Set<number>,
  ) =>
    accountIds.has(context.accountId) ||
    context.studentIds.some((studentId) => studentIds.has(studentId));
  const refreshBatch = async (batch: RefreshBatch) => {
    if (closed || !clients.size) return;
    if (!enabled()) {
      for (const client of clients.keys())
        client.close(1008, "portalUnavailable");
      return;
    }
    const entries = [...clients.entries()].filter(
      ([, context]) =>
        batch.global ||
        matchesScope(context, batch.studentIds, batch.accountIds),
    );
    const authorized: Array<[WebSocket, ClientContext, boolean, boolean]> = [];
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, entries.length) }, async () => {
        while (index < entries.length) {
          const [client, context] = entries[index++];
          if (
            client.readyState !== WebSocket.OPEN ||
            !clients.has(client) ||
            closed
          )
            continue;
          const forced =
            batch.forceGlobal ||
            matchesScope(
              context,
              batch.forcedStudentIds,
              batch.forcedAccountIds,
            );
          try {
            const next = await timeout(
              authorize(context.sessionId, context.csrfToken, context.linkId),
            );
            if (next.accountId !== context.accountId)
              throw new HandshakeError(403);
            if (
              client.readyState !== WebSocket.OPEN ||
              !clients.has(client) ||
              closed
            )
              continue;
            const changed = next.fingerprint !== context.fingerprint;
            Object.assign(context, next);
            authorized.push([client, context, changed, forced]);
          } catch (error) {
            const status =
              (error as { status?: number; statusCode?: number }).statusCode ??
              (error as { status?: number }).status;
            client.close(
              status && status < 500 ? 1008 : 1011,
              "portalUnavailable",
            );
          }
        }
      }),
    );
    let changed = true;
    if (batch.global && options.readRevision && authorized.length) {
      const next = await options.readRevision(
        authorized.map(([, context]) => ({
          accountId: context.accountId,
          ...(context.linkId === undefined ? {} : { linkId: context.linkId }),
          studentIds: context.studentIds,
        })),
      );
      changed = next !== revision;
      revision = next;
    }
    for (const [client, context, grantChanged, forced] of authorized)
      if (!batch.global || forced || changed || grantChanged)
        send(client, context);
  };
  const refresh = async (refreshOptions: PortalRefreshOptions = {}) => {
    if (closed) return;
    const pending = (pendingRefresh ??= {
      global: false,
      forceGlobal: false,
      studentIds: new Set(),
      accountIds: new Set(),
      forcedStudentIds: new Set(),
      forcedAccountIds: new Set(),
    });
    const scoped =
      refreshOptions.studentIds !== undefined ||
      refreshOptions.accountIds !== undefined;
    if (!scoped) {
      pending.global = true;
      pending.forceGlobal ||= refreshOptions.force === true;
    }
    for (const id of refreshOptions.studentIds ?? []) {
      pending.studentIds.add(id);
      if (refreshOptions.force) pending.forcedStudentIds.add(id);
    }
    for (const id of refreshOptions.accountIds ?? []) {
      pending.accountIds.add(id);
      if (refreshOptions.force) pending.forcedAccountIds.add(id);
    }
    if (refreshing) {
      await refreshing;
      return;
    }
    refreshing = (async () => {
      while (pendingRefresh && !closed) {
        const batch = pendingRefresh;
        pendingRefresh = undefined;
        await refreshBatch(batch);
      }
    })();
    try {
      await refreshing;
    } finally {
      refreshing = null;
    }
  };
  const startHeartbeat = () => {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
      if (closed) return;
      for (const [client, context] of clients) {
        if (!context.alive) {
          client.terminate();
          continue;
        }
        context.alive = false;
        if (client.readyState === WebSocket.OPEN) client.ping();
      }
      void refresh().catch(() => {
        for (const client of clients.keys())
          client.close(1011, "portalUnavailable");
      });
    }, options.heartbeatMs ?? 15000);
    heartbeat.unref();
  };
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    guardUpgradeSocketErrors(socket);
    let url: URL;
    try {
      url = new URL(request.url ?? "", origin);
    } catch {
      guardUpgradeSocket(socket);
      socket.destroy();
      return;
    }
    if (url.pathname !== PORTAL_REALTIME_PATH) return;
    const handoffSocket = guardUpgradeSocket(socket, () => releasePending(socket));
    if (closed || !enabled()) {
      reject(socket, 404);
      return;
    }
    const ip =
      options.clientIp?.(request) ?? request.socket.remoteAddress ?? "unknown";
    const time = now();
    for (const [address, entry] of ipAttempts)
      if (entry.until <= time) ipAttempts.delete(address);
    if (!ipAttempts.has(ip) && ipAttempts.size >= 2000) {
      reject(socket, 429);
      return;
    }
    const attempt = ipAttempts.get(ip) ?? { count: 0, until: time + 60000 };
    attempt.count++;
    ipAttempts.set(ip, attempt);
    if (attempt.count > maxAttemptsIp || ipAttempts.size > 2000) {
      reject(socket, 429);
      return;
    }
    if (
      clients.size + pending.size >= maxConnections ||
      pending.size >= maxPending
    ) {
      reject(socket, 503);
      return;
    }
    if (
      [...pending.values()].filter((address) => address === ip).length >=
      maxPendingIp
    ) {
      reject(socket, 429);
      return;
    }
    pending.set(socket, ip);
    void (async () => {
      try {
        if (request.headers.origin !== origin) throw new HandshakeError(403);
        if (
          request.url?.includes("#") ||
          [...url.searchParams.keys()].some((key) => key !== "linkId") ||
          url.searchParams.getAll("linkId").length > 1
        )
          throw new HandshakeError(400);
        const selected = url.searchParams.get("linkId");
        if (selected !== null && !/^[1-9]\d*$/.test(selected))
          throw new HandshakeError(400);
        const linkId = selected === null ? undefined : Number(selected);
        if (linkId !== undefined && !Number.isSafeInteger(linkId))
          throw new HandshakeError(400);
        const protocols = String(
          request.headers["sec-websocket-protocol"] ?? "",
        )
          .split(",")
          .map((value) => value.trim());
        if (
          protocols.length !== 2 ||
          protocols[0] !== PORTAL_REALTIME_PROTOCOL ||
          !new RegExp(
            `^${PORTAL_REALTIME_CSRF_PREFIX.replace(".", "\\.")}[A-Za-z0-9_-]{43}$`,
          ).test(protocols[1])
        )
          throw new HandshakeError(403);
        const sessionId = readPortalSessionId(
          request.headers.cookie,
          options.sessionSecret,
        );
        if (!sessionId) throw new HandshakeError(401);
        const context = await timeout(
          authorize(
            sessionId,
            protocols[1].slice(PORTAL_REALTIME_CSRF_PREFIX.length),
            linkId,
          ),
        );
        if (socket.destroyed) return;
        if (closed || !enabled()) {
          reject(socket, 404);
          return;
        }
        if ((accountCounts.get(context.accountId) ?? 0) >= maxPerAccount)
          throw new HandshakeError(429);
        request.headers["sec-websocket-protocol"] = PORTAL_REALTIME_PROTOCOL;
        wss.handleUpgrade(request, socket, head, (client) => {
          releasePending(socket);
          // ws has now installed its own socket lifecycle and error listeners.
          handoffSocket();
          const active: ClientContext = { ...context, alive: true };
          clients.set(client, active);
          accountCounts.set(
            active.accountId,
            (accountCounts.get(active.accountId) ?? 0) + 1,
          );
          client.on("pong", () => {
            active.alive = true;
          });
          client.on("message", () => client.close(1008, "portalUnavailable"));
          client.on("error", () => client.terminate());
          client.once("close", () => remove(client));
          startHeartbeat();
          send(client, active);
        });
      } catch (error) {
        const status =
          (error as { status?: number; statusCode?: number }).statusCode ??
          (error as { status?: number }).status ??
          503;
        reject(
          socket,
          [400, 401, 403, 404, 429, 503].includes(status) ? status : 503,
        );
      } finally {
        releasePending(socket);
      }
    })();
  };
  server.on("upgrade", upgrade);
  return {
    refresh,
    close: async () => {
      closed = true;
      server.off("upgrade", upgrade);
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
      for (const socket of pending.keys()) socket.destroy();
      pending.clear();
      for (const client of clients.keys()) client.terminate();
      clients.clear();
      accountCounts.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
