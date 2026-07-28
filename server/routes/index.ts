import { Express } from 'express';
import type { IncomingMessage, Server } from 'http';
import type { WebSocket } from 'ws';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import { isWebSocketEventVisibleToUser, type WebSocketEvent } from '@shared/websocket';
import { pool } from '../db';
import { storage } from '../storage';
import userRoutes from './user.routes';
import authRoutes from './auth.routes';
import messageRoutes from './message.routes';
import notificationsRoutes from './notifications.routes';
import academyRoutes from './academy.routes';
import incomingRoutes from './incoming.routes';
import instagramRoutes from './instagram.routes';
import boardRoutes from './board.routes';
import financeRoutes from './finance.routes';
import telephonyRoutes from './telephony.routes';
import { logger } from '../lib/logger';
import { createPresenceTracker } from '../lib/presence';
import {
    appConfig,
    isProductionEnvironment,
    secureSessionCookies,
} from '../config';
import { isAllowedRequestOrigin } from '../middleware/security.middleware';

import { setBroadcastFunction as setMessageBroadcast } from './message.routes';
import { setBroadcastFunction as setBoardBroadcast } from './board.routes';
import { setInstagramBroadcastFunction } from '../services/instagram';
import { setTelephonyBroadcastFunction } from './telephony.routes';
import {
    queueOnlinePbxRoutingSync,
    synchronizeOnlinePbxRoutingWithRetry,
} from '../services/telephony-routing';

const PgStore = pgSession(session);
const WS_OPEN_STATE = 1;
const MAX_TOTAL_WEBSOCKET_CONNECTIONS = 1_000;
const WEBSOCKET_AUTH_TIMEOUT_MS = 5_000;
type SessionMiddleware = ReturnType<typeof session>;
type WsSessionRequest = IncomingMessage & {
    session?: session.Session & Partial<session.SessionData>;
};
type SocketContext = {
    userId: number;
};

const buildSessionConfig = () => {
    const sessionSecret = appConfig.session.secret;

    if (!sessionSecret) {
        logger.error('session.secret is required in config/app.config.json to start the server.');
        process.exit(1);
    }

    if (!pool) {
        logger.error('Database pool is not initialized for session storage.');
        process.exit(1);
    }

    return {
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        name: 'academy.sid',
        store: new PgStore({
            pool,
            tableName: 'session',
            createTableIfMissing: true,
        }),
        cookie: {
            secure: secureSessionCookies,
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000,
            sameSite: 'lax' as const,
            priority: 'high' as const,
            domain: undefined,
            path: '/',
        },
    };
};

export async function registerModularRoutes(app: Express): Promise<Server> {
    const { createServer } = await import('http');
    const WebSocket = await import('ws');

    const sessionMiddleware = session(buildSessionConfig());
    app.use(sessionMiddleware);

    app.use('/api/auth', authRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/messages', messageRoutes);
    app.use('/api/notifications', notificationsRoutes);
    app.use('/api/academy', academyRoutes);
    app.use('/api/finance', financeRoutes);
    app.use('/api/board', boardRoutes);
    app.use('/api/telephony', telephonyRoutes);
    app.use('/api/instagram', instagramRoutes);
    // Public inbound webhooks (verified by per-provider secrets, NOT session auth).
    app.use('/api/incoming', incomingRoutes);
    const httpServer = createServer(app);
    httpServer.requestTimeout = 30_000;
    httpServer.headersTimeout = 15_000;
    httpServer.keepAliveTimeout = 5_000;
    httpServer.maxHeadersCount = 100;

    const wss = new WebSocket.WebSocketServer({
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
        const nextCount = Math.max(
            0,
            (userConnectionCounts.get(userId) ?? 1) - 1,
        );
        if (nextCount === 0) {
            userConnectionCounts.delete(userId);
        } else {
            userConnectionCounts.set(userId, nextCount);
        }
    };

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
            logger.error('WebSocket error:', error);
        });
        void handleSocketConnection(ws, request as WsSessionRequest);
    });

    const broadcastToClients = (data: WebSocketEvent) => {
        const message = JSON.stringify(data);
        clients.forEach((client) => {
            const context = clientContexts.get(client);
            if (!context || client.readyState !== WS_OPEN_STATE) {
                return;
            }

            // Supplying an audience is an explicit routing decision. In
            // particular, an empty audience means "send to nobody".
            if (!isWebSocketEventVisibleToUser(data, context.userId)) {
                return;
            }

            try {
                client.send(message);
            } catch (error) {
                logger.error('Failed to send WS message', { error });
            }
        });
    };

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
            if (connectionCount >= 5) {
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

            clientContexts.set(ws, {
                userId: user.id,
            });
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

    setMessageBroadcast(broadcastToClients);
    setBoardBroadcast(broadcastToClients);
    setInstagramBroadcastFunction(broadcastToClients);
    setTelephonyBroadcastFunction(broadcastToClients);

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
    httpServer.on('close', () => {
        clearInterval(heartbeat);
        clearInterval(telephonyRoutingHeartbeat);
    });

    return httpServer;
}

const applySessionMiddleware = async (middleware: SessionMiddleware, request: WsSessionRequest) =>
    new Promise<void>((resolve, reject) => {
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
