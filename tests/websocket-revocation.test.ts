import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import session from 'express-session';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), getUser: vi.fn(), updateUserOnlineStatus: vi.fn() }));
vi.mock('../server/db', () => ({ pool: { query: mocks.query } }));
vi.mock('../server/storage', () => ({ storage: { getUser: mocks.getUser, updateUserOnlineStatus: mocks.updateUserOnlineStatus } }));
vi.mock('../server/services/telephony-routing', () => ({ queueOnlinePbxRoutingSync: vi.fn(), synchronizeOnlinePbxRoutingWithRetry: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../server/config', () => ({ isProductionEnvironment: false }));
vi.mock('../server/middleware/security.middleware', () => ({ isAllowedRequestOrigin: () => true }));
import { attachWebSocketGateway } from '../server/realtime/websocket-gateway';
import { disconnectRealtimeSession, publishRealtimeEvent } from '../server/realtime/realtime-hub';
import { revokeUserAuthenticationArtifacts } from '../server/services/session-security';

let server: Server;
let gateway: Awaited<ReturnType<typeof attachWebSocketGateway>>;
let store: session.MemoryStore;
let clients: WebSocket[];
let states: Map<string, session.SessionData>;
const newSession = (userId = 7): session.SessionData => ({ userId, cookie: { expires: new Date(Date.now() + 60_000), originalMaxAge: 60_000 } } as session.SessionData);

beforeEach(async () => {
  vi.clearAllMocks(); clients = []; states = new Map();
  store = new session.MemoryStore();
  mocks.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('DELETE FROM "session"')) for (const [sid, state] of states) {
      if (String(state.userId) === params[0] && sid !== params[1]) store.destroy(sid, () => undefined);
    }
    return { rows: [] };
  });
  mocks.getUser.mockResolvedValue({ id: 7, isActive: true, isArchived: false });
  mocks.updateUserOnlineStatus.mockResolvedValue(undefined);
  server = createServer();
  gateway = await attachWebSocketGateway(server, ((req: any, _res: unknown, next: () => void) => {
    req.sessionID = req.headers['x-session-id']; req.sessionStore = store;
    store.get(req.sessionID, (_error, stored) => { req.session = stored; next(); });
  }) as any);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});
afterEach(async () => {
  for (const client of clients) client.terminate();
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
  expect(destroyed).toBe(false); client.terminate();
  await new Promise<void>((resolve) => hmr.close(() => resolve()));
});
