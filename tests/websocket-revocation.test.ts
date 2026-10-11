import { createServer, type Server } from 'node:http';
import { once, errorMonitor } from 'node:events';
import { createConnection, type Socket } from 'node:net';
import session from 'express-session';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), getUser: vi.fn(), updateUserOnlineStatus: vi.fn(), allowedOrigin: vi.fn(() => true) }));
vi.mock('../server/db', () => ({ pool: { query: mocks.query } }));
vi.mock('../server/storage', () => ({ storage: { getUser: mocks.getUser, updateUserOnlineStatus: mocks.updateUserOnlineStatus } }));
vi.mock('../server/services/telephony-routing', () => ({ queueOnlinePbxRoutingSync: vi.fn(), synchronizeOnlinePbxRoutingWithRetry: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../server/config', () => ({ isProductionEnvironment: false }));
vi.mock('../server/middleware/security.middleware', () => ({ isAllowedRequestOrigin: mocks.allowedOrigin }));
import { attachWebSocketGateway } from '../server/realtime/websocket-gateway';
import { createPortalWebSocketGateway } from '../server/realtime/portal-websocket-gateway';
import { disconnectRealtimeSession, publishRealtimeEvent } from '../server/realtime/realtime-hub';
import { revokeUserAuthenticationArtifacts } from '../server/services/session-security';

let server: Server;
let gateway: Awaited<ReturnType<typeof attachWebSocketGateway>>;
let store: session.MemoryStore;
let clients: WebSocket[];
let rawClients: Socket[];
let states: Map<string, session.SessionData>;
const newSession = (userId = 7): session.SessionData => ({ userId, cookie: { expires: new Date(Date.now() + 60_000), originalMaxAge: 60_000 } } as session.SessionData);

beforeEach(async () => {
  vi.clearAllMocks(); clients = []; rawClients = []; states = new Map();
  mocks.allowedOrigin.mockReturnValue(true);
  store = new session.MemoryStore();
  mocks.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('DELETE FROM "session"')) for (const [sid, state] of states) {
      if (String(state.userId) === params[0] && sid !== params[1]) store.destroy(sid, () => undefined);
    }
    return { rows: [] };
  });
  mocks.getUser.mockResolvedValue({ id: 7, isActive: true, isArchived: false });
  mocks.updateUserOnlineStatus.mockResolvedValue(undefined);
  server = createServer((_request, response) => response.end());
  gateway = await attachWebSocketGateway(server, ((req: any, _res: unknown, next: () => void) => {
    req.sessionID = req.headers['x-session-id']; req.sessionStore = store;
    store.get(req.sessionID, (_error, stored) => { req.session = stored; next(); });
  }) as any);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});
afterEach(async () => {
  for (const client of clients) client.terminate();
  for (const client of rawClients) client.destroy();
  await gateway.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const connect = async (sid: string, userId = 7) => {
  const state = newSession(userId); states.set(sid, state);
  await new Promise<void>((resolve) => store.set(sid, state, resolve));
  const port = (server.address() as { port: number }).port;
  const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { 'x-session-id': sid } });
  clients.push(client); await once(client, 'open');
  await vi.waitFor(() => expect(mocks.updateUserOnlineStatus).toHaveBeenCalledWith(7, true));
  return client;
};
const privateEvent = () => publishRealtimeEvent({ type: 'NEW_MESSAGE', data: { content: 'private' }, audienceUserIds: [7] } as any);

it('disconnects revoked sessions but preserves the current session receiving private messages', async () => {
  const old = await connect('old');
  const current = await connect('current');
  const closed = once(old, 'close');
  await revokeUserAuthenticationArtifacts(7, { exceptSessionId: 'current' });
  await closed;
  const received = once(current, 'message'); privateEvent();
  expect(String((await received)[0])).toContain('private');
  expect(old.readyState).toBe(WebSocket.CLOSED);
});
it('closes only the logged-out session', async () => {
  const old = await connect('logout'); const current = await connect('another');
  const closed = once(old, 'close'); disconnectRealtimeSession('logout'); await closed;
  expect(current.readyState).toBe(WebSocket.OPEN);
});
it('rejects private deliveries after another process revokes or expires the session', async () => {
  const client = await connect('outside');
  const received: string[] = []; client.on('message', (data) => received.push(String(data)));
  await new Promise<void>((resolve) => store.destroy('outside', resolve));
  const closed = once(client, 'close'); privateEvent(); await closed;
  expect(received.filter((data) => data.includes('private'))).toEqual([]);
});
it('closes an already connected session once it has expired, without delivering private data', async () => {
  const client = await connect('expired');
  const received: string[] = []; client.on('message', (data) => received.push(String(data)));
  const state = newSession(); state.cookie.expires = new Date(Date.now() - 1);
  await new Promise<void>((resolve) => store.set('expired', state, resolve));
  const closed = once(client, 'close'); privateEvent(); await closed;
  expect(received.filter((data) => data.includes('private'))).toEqual([]);
});
it('passes Vite HMR upgrades to the next listener', async () => {
  const hmr = new WebSocketServer({ noServer: true });
  let destroyed = false;
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/__vite_hmr') return;
    destroyed = socket.destroyed;
    hmr.handleUpgrade(req, socket, head, (ws) => { ws.on('error', () => undefined); });
  });
  const client = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}/__vite_hmr`);
  clients.push(client); await once(client, 'open');
  expect(destroyed).toBe(false);
  const closed = once(client, 'close'); client.close(1000);
  expect((await closed)[0]).toBe(1000);
  await new Promise<void>((resolve) => hmr.close(() => resolve()));
});
it('keeps staff HTTP and authorized sockets usable after denied-origin upgrades followed by TCP resets', async () => {
  mocks.allowedOrigin.mockReturnValue(false);
  const port = (server.address() as { port: number }).port;
  for (let index = 0; index < 8; index++) {
    const client = createConnection({ host: '127.0.0.1', port });
    rawClients.push(client);
    client.on('error', () => undefined);
    const status = new Promise<number>((resolve) => {
      client.on('data', (data) => {
        const code = /^HTTP\/1\.1 (\d+)/.exec(data.toString())?.[1];
        if (code) resolve(Number(code));
      });
    });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    client.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nOrigin: http://foreign.example.test\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: Zml4dHVyZS1rZXktMDAwMQ==\r\n\r\n`);
    expect(await status).toBe(403);
    client.resetAndDestroy();
  }
  expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
  mocks.allowedOrigin.mockReturnValue(true);
  expect((await connect('after-rejections')).readyState).toBe(WebSocket.OPEN);
});
it('survives an absolute upgrade target accepted by the HTTP parser but rejected by the URL parser', async () => {
  const port = (server.address() as { port: number }).port;
  const client = createConnection({ host: '127.0.0.1', port });
  rawClients.push(client);
  client.on('error', () => undefined);
  const closed = new Promise<void>((resolve) => client.once('close', resolve));
  await new Promise<void>((resolve) => client.once('connect', resolve));
  client.write(`GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: Zml4dHVyZS1rZXktMDAwMQ==\r\n\r\n`);
  await closed;
  expect(mocks.getUser).not.toHaveBeenCalled();
  expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
  expect((await connect('after-malformed-target')).readyState).toBe(WebSocket.OPEN);
});
it('keeps shared staff and portal listeners alive after an unclaimed TCP reset and permits normal staff closure', async () => {
  const portal = createPortalWebSocketGateway(server, {
    sessionSecret: 'isolated-shared-upgrade-fixture-secret',
    appUrl: 'http://portal.example.test',
    enabled: () => true,
    identity: {
      resolveSession: vi.fn(async () => null),
      resolveAccountActor: vi.fn(async () => { throw new Error('Unexpected portal identity read'); }),
      getSessionDto: vi.fn(async () => ({ subjects: [] })),
    },
  });
  try {
    const port = (server.address() as { port: number }).port;
    const errors: string[] = [];
    let arrived = () => {};
    const upgraded = new Promise<void>((resolve) => { arrived = resolve; });
    const disconnected = new Promise<void>((resolve) => {
      server.once('upgrade', (_request, socket) => {
        socket.on(errorMonitor, (error: NodeJS.ErrnoException) => errors.push(error.code ?? 'unknown'));
        socket.once('close', resolve);
        arrived();
      });
    });
    const client = createConnection({ host: '127.0.0.1', port });
    rawClients.push(client);
    client.on('error', () => undefined);
    await new Promise<void>((resolve) => client.once('connect', resolve));
    client.write(`GET /api/portal/ws-unknown HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: Zml4dHVyZS1rZXktMDAwMQ==\r\n\r\n`);
    await upgraded;
    client.resetAndDestroy();
    await disconnected;
    expect(errors).toContain('ECONNRESET');
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    const authorized = await connect('after-unclaimed-upgrade');
    const closed = once(authorized, 'close'); authorized.close(1000);
    expect((await closed)[0]).toBe(1000);
  } finally {
    await portal.close();
  }
});
