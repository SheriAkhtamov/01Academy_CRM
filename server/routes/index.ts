import { Express } from 'express';
import type { IncomingMessage, Server } from 'http';
import type { WebSocket } from 'ws';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import type { WebSocketEvent } from '@shared/websocket';
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
import { logger } from '../lib/logger';
import { createPresenceTracker } from '../lib/presence';
import { appConfig } from '../config';

import { setBroadcastFunction as setMessageBroadcast } from './message.routes';
import { setBroadcastFunction as setBoardBroadcast } from './board.routes';
import { setInstagramBroadcastFunction } from '../services/instagram';

const PgStore = pgSession(session);
const WS_OPEN_STATE = 1;
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
        name: 'connect.sid',
        store: new PgStore({
            pool,
            tableName: 'session',
            createTableIfMissing: true,
        }),
        cookie: {
            secure: appConfig.session.cookieSecure,
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000,
            sameSite: 'lax' as const,
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
    app.use('/api/board', boardRoutes);
    app.use('/api/instagram', instagramRoutes);
    // Public inbound webhooks (verified by per-provider secrets, NOT session auth).
    app.use('/api/incoming', incomingRoutes);
    const httpServer = createServer(app);

    const wss = new WebSocket.WebSocketServer({ noServer: true });
    const clients = new Set<WebSocket>();
    const clientContexts = new Map<WebSocket, SocketContext>();
    const socketClosedState = new WeakMap<WebSocket, { closed: boolean }>();

    await pool.query(`
      UPDATE users
      SET is_online = false,
          updated_at = NOW(),
          last_seen_at = NOW()
      WHERE is_online = true
    `).catch((error) => {
        logger.error('Failed to reset stale online statuses', { error });
    });

    httpServer.on('upgrade', (request, socket, head) => {
        const requestUrl = request.url ? new URL(request.url, 'http://localhost') : null;
        if (requestUrl?.pathname !== '/ws') {
            return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    });

    wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
        const lifecycle = { closed: false };
        socketClosedState.set(ws, lifecycle);

        ws.on('close', () => {
            lifecycle.closed = true;
            const context = clientContexts.get(ws);
            clientContexts.delete(ws);
            clients.delete(ws);
            if (context) {
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

            if (Array.isArray(data.audienceUserIds) && data.audienceUserIds.length > 0) {
                if (!data.audienceUserIds.includes(context.userId)) {
                    return;
                }
            } else if (data.recipientId !== undefined && context.userId !== data.recipientId) {
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
        onError: (error, context) => {
            logger.error('Failed to sync user presence', { error, ...context });
        },
    });

    const handleSocketConnection = async (ws: WebSocket, request: WsSessionRequest) => {
        try {
            await applySessionMiddleware(sessionMiddleware, request);

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

            if (lifecycle?.closed || ws.readyState !== WS_OPEN_STATE) {
                return;
            }

            await presenceTracker.connect(user.id);

            if (lifecycle?.closed || ws.readyState !== WS_OPEN_STATE) {
                await presenceTracker.disconnect(user.id);
                return;
            }

            clientContexts.set(ws, {
                userId: user.id,
            });
            clients.add(ws);
        } catch (error) {
            logger.error('Failed to authenticate WebSocket connection', { error });
            ws.close(1011, 'Session error');
        }
    };

    setMessageBroadcast(broadcastToClients);
    setBoardBroadcast(broadcastToClients);
    setInstagramBroadcastFunction(broadcastToClients);

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
