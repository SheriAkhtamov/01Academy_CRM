import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), release: vi.fn(), getUser: vi.fn(), getUsers: vi.fn() }));
vi.mock('../server/db', () => ({ pool: { query: mocks.query, connect: async () => ({ query: mocks.transaction, release: mocks.release }) } }));
vi.mock('../server/storage', () => ({ storage: { getUser: mocks.getUser, getUsers: mocks.getUsers } }));
import { bindTelegramTaskEmployee, getTelegramTaskIdentity, TelegramBindingDenied, telegramTaskAccess } from '../server/services/telegram-tasks';
import type { TaskToken } from '../server/services/telegram-tasks-crypto';
const user = { id: 7, fullName: 'Test employee', phone: '+998 90 123-45-67', isActive: true, isArchived: false };
const original = { bot_id: '12345', telegram_user_id: '654321', user_id: 7, verified_phone: '998901234567', verification_id: 'version-1' };
let employees: Array<{ id: number; phone: string }>;
let bindings: typeof original[];
beforeEach(() => {
  vi.clearAllMocks(); employees = [{ id: 7, phone: user.phone }]; bindings = [{ ...original }]; mocks.getUser.mockResolvedValue({ ...user });
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('telegram_task_bindings') ? bindings : employees }));
  mocks.transaction.mockImplementation(async (sql: string) => ({ rows: sql.includes('SELECT * FROM telegram_task_bindings') ? bindings : sql.includes('SELECT id, phone FROM users') ? employees : [] }));
});
describe('Telegram employee binding', () => {
  it('rechecks the current active employee and canonical phone on every request', async () => {
    expect((await getTelegramTaskIdentity('12345', '654321'))?.user.id).toBe(7);
    expect(mocks.getUser).toHaveBeenCalledWith(7);
  });
  it.each([
    { isArchived: true }, { isActive: false }, { phone: '+998901234568' },
  ])('revokes access after employee changes %s', async (changes) => {
    mocks.getUser.mockResolvedValue({ ...user, ...changes });
    expect(await getTelegramTaskIdentity('12345', '654321')).toBeNull();
  });
  it('revokes access after deletion, unlinking or a duplicate number appears', async () => {
    mocks.getUser.mockResolvedValue(undefined); expect(await getTelegramTaskIdentity('12345', '654321')).toBeNull();
    mocks.getUser.mockResolvedValue(user); employees.push({ id: 8, phone: '901234567' });
    expect(await getTelegramTaskIdentity('12345', '654321')).toBeNull();
    bindings = []; expect(await getTelegramTaskIdentity('12345', '654321')).toBeNull();
  });
  it('rejects tokens issued before rebinding', async () => {
    const token = { userId: 7, verificationId: 'old-version' } as TaskToken;
    expect(await getTelegramTaskIdentity('12345', '654321', token)).toBeNull();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it('serializes contact registration and keeps repeated confirmations idempotent', async () => {
    await bindTelegramTaskEmployee('12345', '654321', '+998901234567');
    expect(mocks.transaction).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['telegram-task-registration:12345']);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO telegram_task_bindings'), ['12345', '654321', 7, '998901234567', 'version-1']);
    expect(mocks.transaction).toHaveBeenCalledWith('COMMIT'); expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  it('uses a fresh verification version when the confirmed phone changes', async () => {
    bindings[0].verified_phone = '998901111111';
    await bindTelegramTaskEmployee('12345', '654321', '+998901234567');
    const insert = mocks.transaction.mock.calls.find(([sql]) => sql.startsWith('INSERT'))!;
    expect(insert[1][4]).not.toBe('version-1'); expect(insert[1][4]).toMatch(/^[a-f0-9-]{36}$/);
  });
  it.each(['duplicate', 'unknown', 'other-telegram', 'other-employee'])('rolls back %s contacts without overwriting a binding', async (kind) => {
    if (kind === 'duplicate') employees.push({ id: 8, phone: '901234567' });
    if (kind === 'unknown') employees = [];
    if (kind === 'other-telegram') bindings[0].telegram_user_id = '111';
    if (kind === 'other-employee') bindings[0].user_id = 8;
    await expect(bindTelegramTaskEmployee('12345', '654321', '+998901234567')).rejects.toBeInstanceOf(TelegramBindingDenied);
    expect(mocks.transaction).toHaveBeenCalledWith('ROLLBACK'); expect(mocks.release).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });
  it('returns only minimal active employee data for assignment', async () => {
    mocks.getUsers.mockResolvedValue([{ ...user, password: 'secret', email: 'private@test', position: 'Teacher', module: 'teacher' }, { ...user, id: 8, isArchived: true }]);
    const list = await telegramTaskAccess.getAssignableUsers();
    expect(list).toEqual([{ id: 7, fullName: user.fullName, position: 'Teacher', module: 'teacher' }]);
  });
});
