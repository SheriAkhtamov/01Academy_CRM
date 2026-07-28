import type { IncomingMessage, Server } from 'node:http';
import type { Session, SessionData } from 'express-session';
import { WebSocketServer, type WebSocket } from 'ws';
import { isWebSocketEventVisibleToUser, type WebSocketEvent } from '@shared/websocket';
import { pool } from '../db';
import { storage } from '../storage';
import { logger } from '../lib/logger';
import { createPresenceTracker } from '../lib/presence';
import { isProductionEnvironment } from '../config';
import { isAllowedRequestOrigin } from '../middleware/security.middleware';
import {
  queueOnlinePbxRoutingSync,
  synchronizeOnlinePbxRoutingWithRetry,
} from '../services/telephony-routing';
import type { SessionMiddleware } from '../infrastructure/session';
import { setRealtimeTransport } from './realtime-hub';

const WS_OPEN_STATE = 1;
const MAX_TOTAL_WEBSOCKET_CONNECTIONS = 1_000;
const MAX_CONNECTIONS_PER_USER = 5;
const WEBSOCKET_AUTH_TIMEOUT_MS = 5_000;

type WsSessionRequest = IncomingMessage & {
  session?: Session & Partial<SessionData>;
};

type SocketContext = {
  userId: number;
};

export type WebSocketGateway = {
  close: () => Promise<void>;
};

export const attachWebSocketGateway = async (
  httpServer: Server,
  sessionMiddleware: SessionMiddleware,
): Promise<WebSocketGateway> => {
  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  const allSockets = new Set<WebSocket>();
  const clients = new Set<WebSocket>();
  const clientContexts = new Map<WebSocket, SocketContext>();
  const socketClosedState = new WeakMap<WebSocket, { closed: boolean }>();
  const socketAliveState = new WeakMap<WebSocket, boolean>();
  const userConnectionCounts = new Map<number, number>();

  const decrementUserConnectionCount = (userId: number) => {
    const nextCount = Math.max(0, (userConnectionCounts.get(userId) ?? 1) - 1);
    if (nextCount === 0) {
      userConnectionCounts.delete(userId);
    } else {
      userConnectionCounts.set(userId, nextCount);
    }
  };

  const broadcastToClients = (event: WebSocketEvent) => {
    const message = JSON.stringify(event);
    clients.forEach((client) => {
      const context = clientContexts.get(client);
      if (!context || client.readyState !== WS_OPEN_STATE) {
        return;
      }
      if (!isWebSocketEventVisibleToUser(event, context.userId)) {
        return;
      }

      try {
        client.send(message);
      } catch (error) {
        logger.error('Failed to send WebSocket event', { error, eventType: event.type });
      }
    });
  };

  const resetRealtimeTransport = setRealtimeTransport(broadcastToClients);
  const presenceTracker = createPresenceTracker({
    updateUserOnlineStatus: storage.updateUserOnlineStatus.bind(storage),
    broadcast: broadcastToClients,
    afterPresenceChange: async () => {
      queueOnlinePbxRoutingSync();
    },
    onError: (error, context) => {
      logger.error('Failed to sync user presence', { error, ...context });
    },
  });

  await pool.query(`
    UPDATE users
    SET is_online = false,
        updated_at = NOW(),
        last_seen_at = NOW()
    WHERE is_online = true
  `).catch((error) => {
    logger.error('Failed to reset stale online statuses', { error });
  });
  await synchronizeOnlinePbxRoutingWithRetry(2).catch((error) => {
    logger.warn('OnlinePBX routing could not be synchronized during startup', { error });
  });

  const handleSocketConnection = async (ws: WebSocket, request: WsSessionRequest) => {
    try {
      await applySessionMiddlewareWithTimeout(sessionMiddleware, request);

      const sessionUserId = request.session?.userId;
      const lifecycle = socketClosedState.get(ws);
      if (!sessionUserId) {
        ws.close(1008, 'Unauthorized');
        return;
      }
      if (lifecycle?.closed || ws.readyState !== WS_OPEN_STATE) {
        return;
      }

      const user = await storage.getUser(sessionUserId);
      if (!user || !user.isActive) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      const connectionCount = userConnectionCounts.get(user.id) ?? 0;
      if (connectionCount >= MAX_CONNECTIONS_PER_USER) {
        ws.close(1008, 'Too many connections');
        return;
      }
      userConnectionCounts.set(user.id, connectionCount + 1);
      let connectionReserved = true;

      if (lifecycle?.closed || ws.readyState !== WS_OPEN_STATE) {
        decrementUserConnectionCount(user.id);
        return;
      }

      try {
        await presenceTracker.connect(user.id);
      } catch (error) {
        decrementUserConnectionCount(user.id);
        connectionReserved = false;
        throw error;
      }

      if (lifecycle?.closed || ws.readyState !== WS_OPEN_STATE) {
        if (connectionReserved) decrementUserConnectionCount(user.id);
        await presenceTracker.disconnect(user.id);
        return;
      }

      clientContexts.set(ws, { userId: user.id });
      connectionReserved = false;
      clients.add(ws);
    } catch (error) {
      if ((error as { code?: string })?.code === 'WS_AUTH_TIMEOUT') {
        ws.terminate();
        return;
      }
      logger.error('Failed to authenticate WebSocket connection', { error });
      ws.close(1011, 'Session error');
    }
  };

  httpServer.on('upgrade', (request, socket, head) => {
    if (allSockets.size >= MAX_TOTAL_WEBSOCKET_CONNECTIONS) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const requestUrl = request.url ? new URL(request.url, 'http://localhost') : null;
    if (requestUrl?.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const origin = Array.isArray(request.headers.origin)
      ? request.headers.origin[0]
      : request.headers.origin;
    if (
      (isProductionEnvironment && !isAllowedRequestOrigin(origin))
      || (!isProductionEnvironment && origin && !isAllowedRequestOrigin(origin))
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    const lifecycle = { closed: false };
    allSockets.add(ws);
    socketClosedState.set(ws, lifecycle);
    socketAliveState.set(ws, true);

    ws.on('pong', () => {
      socketAliveState.set(ws, true);
    });
    ws.on('close', () => {
      lifecycle.closed = true;
      allSockets.delete(ws);
      const context = clientContexts.get(ws);
      clientContexts.delete(ws);
      clients.delete(ws);
      if (context) {
        decrementUserConnectionCount(context.userId);
        void presenceTracker.disconnect(context.userId);
      }
    });
    ws.on('error', (error: Error) => {
      logger.error('WebSocket error', { error });
    });

    void handleSocketConnection(ws, request as WsSessionRequest);
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!socketAliveState.get(client)) {
        client.terminate();
        continue;
      }
      socketAliveState.set(client, false);
      client.ping();
    }
  }, 30_000);
  heartbeat.unref();

  const telephonyRoutingHeartbeat = setInterval(() => {
    queueOnlinePbxRoutingSync();
  }, 30_000);
  telephonyRoutingHeartbeat.unref();

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearInterval(telephonyRoutingHeartbeat);
    resetRealtimeTransport();
    for (const socket of allSockets) {
      socket.terminate();
    }
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  };

  httpServer.once('close', () => {
    void close();
  });

  return { close };
};

const applySessionMiddleware = async (
  middleware: SessionMiddleware,
  request: WsSessionRequest,
) => new Promise<void>((resolve, reject) => {
  const responseStub = {
    getHeader: () => undefined,
    setHeader: () => undefined,
    removeHeader: () => undefined,
    writeHead: () => undefined,
    end: () => undefined,
  };

  middleware(request as never, responseStub as never, (error?: unknown) => {
    if (error) {
      reject(error);
      return;
    }
    resolve();
  });
});

const applySessionMiddlewareWithTimeout = async (
  middleware: SessionMiddleware,
  request: WsSessionRequest,
) => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      applySessionMiddleware(middleware, request),
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(Object.assign(new Error('WebSocket session lookup timed out'), {
            code: 'WS_AUTH_TIMEOUT',
          }));
        }, WEBSOCKET_AUTH_TIMEOUT_MS);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};
