import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), clientQuery: vi.fn(), release: vi.fn() }));
vi.mock('../server/db', () => ({ pool: { query: mocks.query, connect: async () => ({ query: mocks.clientQuery, release: mocks.release }) } }));
import { chatGroupManagementStorage as storage } from '../server/storage/chat-group-management.storage';

let group: { id: number; createdBy: number | null; name: string };
let members: number[];
let active: number[];
beforeEach(() => {
  vi.resetAllMocks(); group = { id: 4, createdBy: 7, name: 'Teachers' }; members = [7, 8]; active = [7, 8, 9];
  mocks.clientQuery.mockImplementation(async (sql: string, values: any[] = []) => {
    if (sql.startsWith('SELECT id, created_by')) return { rows: [{ ...group }] };
    if (sql.startsWith('SELECT user_id')) return { rows: members.map((user_id) => ({ user_id })) };
    if (sql.startsWith('SELECT id FROM users')) return { rows: (values[0] as number[]).filter((id) => active.includes(id)).map((id) => ({ id })) };
    if (sql.startsWith('SELECT full_name')) return { rows: active.includes(values[0]) ? [{ full_name: 'New owner' }] : [] };
    if (sql.startsWith('UPDATE chat_groups SET name')) group.name = values[1];
    if (sql.startsWith('UPDATE chat_groups SET created_by=$2')) group.createdBy = values[1];
    if (sql.startsWith('UPDATE chat_groups SET created_by=NULL')) group.createdBy = null;
    if (sql.startsWith('INSERT INTO chat_group_members')) members.push(...values[1]);
    if (sql.startsWith('DELETE FROM chat_group_members')) members = members.filter((id) => id !== values[1]);
    return { rows: [] };
  });
});

describe('group administration and membership transactions', () => {
  it('locks the group, renames as owner and announces the actual audience', async () => {
    expect(await storage.rename(4, 7, false, 'New name')).toEqual([7, 8]);
    expect(group.name).toBe('New name');
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('FOR UPDATE'), [4]);
    expect(mocks.clientQuery).toHaveBeenLastCalledWith('COMMIT'); expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('lets a CRM administrator manage only a group they belong to', async () => {
    await storage.rename(4, 8, true, 'New name');
    await expect(storage.rename(4, 9, true, 'Outside')).rejects.toMatchObject({ statusCode: 404 });
    expect(group.name).toBe('New name');
  });
  it.each(['rename', 'add', 'remove'])('denies an ordinary member the %s operation', async (operation) => {
    const call = operation === 'rename' ? storage.rename(4, 8, false, 'Forbidden')
      : operation === 'add' ? storage.addParticipants(4, 8, false, [9]) : storage.removeParticipant(4, 8, false, 7);
    await expect(call).rejects.toMatchObject({ statusCode: 403, message: 'chatGroupManagementDenied' });
    expect(group.name).toBe('Teachers'); expect(members).toEqual([7, 8]);
    expect(mocks.clientQuery).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
  });
  it('deduplicates additions, preserves old read cursors and includes newcomers in the event', async () => {
    expect(await storage.addParticipants(4, 7, false, [8, 9, 9])).toEqual([7, 8, 9]);
    expect(members).toEqual([7, 8, 9]);
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO chat_group_members'), [4, [9]]);
    expect(mocks.clientQuery.mock.calls.find(([sql]) => sql.startsWith('INSERT'))![0]).toContain('MAX(id)');
  });
  it('does not add an inactive or archived employee', async () => {
    active = [7, 8];
    await expect(storage.addParticipants(4, 7, false, [9])).rejects.toMatchObject({ message: 'chatGroupParticipantsUnavailable' });
    expect(members).toEqual([7, 8]); expect(mocks.clientQuery).toHaveBeenLastCalledWith('ROLLBACK');
  });
  it('enforces the overall group size under the lock', async () => {
    members = Array.from({ length: 100 }, (_, index) => index + 1);
    await expect(storage.addParticipants(4, 7, false, [101])).rejects.toMatchObject({ message: 'chatGroupParticipantsLimit' });
    expect(members).toHaveLength(100);
  });
  it('removes only the requested membership and still announces to the removed participant', async () => {
    expect(await storage.removeParticipant(4, 7, false, 8)).toEqual([7, 8]);
    expect(members).toEqual([7]);
    expect(mocks.clientQuery).toHaveBeenCalledWith('DELETE FROM chat_group_members WHERE group_id=$1 AND user_id=$2', [4, 8]);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => /DELETE FROM chat_group_messages|DELETE FROM chat_groups/.test(sql))).toBe(false);
  });
  it('protects the owner even from another CRM administrator', async () => {
    await expect(storage.removeParticipant(4, 8, true, 7)).rejects.toMatchObject({ message: 'chatGroupOwnerProtected' });
    expect(members).toEqual([7, 8]);
  });
  it('reports a stale participant instead of silently succeeding', async () => {
    await expect(storage.removeParticipant(4, 7, false, 9)).rejects.toMatchObject({ message: 'chatGroupMemberMissing', statusCode: 404 });
  });
  it('lets an ordinary member leave without transferring ownership', async () => {
    expect(await storage.leave(4, 8)).toEqual([7, 8]); expect(members).toEqual([7]); expect(group.createdBy).toBe(7);
  });
  it('requires a successor before an owner can leave their colleagues', async () => {
    await expect(storage.leave(4, 7)).rejects.toMatchObject({ message: 'chatGroupNextOwnerRequired' });
    expect(members).toEqual([7, 8]); expect(group.createdBy).toBe(7);
  });
  it.each([7, 9])('rejects a successor who is not another member: %s', async (id) => {
    await expect(storage.leave(4, 7, id)).rejects.toMatchObject({ message: 'chatGroupNextOwnerUnavailable' });
    expect(members).toEqual([7, 8]);
  });
  it('rejects an inactive successor', async () => {
    active = [7]; await expect(storage.leave(4, 7, 8)).rejects.toMatchObject({ message: 'chatGroupNextOwnerUnavailable' });
    expect(group.createdBy).toBe(7); expect(members).toEqual([7, 8]);
  });
  it('transfers administration and removes the owner within the same transaction', async () => {
    expect(await storage.leave(4, 7, 8)).toEqual([7, 8]); expect(group.createdBy).toBe(8); expect(members).toEqual([8]);
    expect(mocks.clientQuery).toHaveBeenCalledWith('UPDATE chat_groups SET created_by=$2, creator_name=$3 WHERE id=$1', [4, 8, 'New owner']);
    expect(mocks.clientQuery).toHaveBeenLastCalledWith('COMMIT');
  });
  it('lets the last owner leave without erasing any group or message history', async () => {
    members = [7]; expect(await storage.leave(4, 7)).toEqual([7]); expect(group.createdBy).toBeNull(); expect(members).toEqual([]);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => /DELETE FROM chat_group_messages|DELETE FROM chat_groups/.test(sql))).toBe(false);
  });
  it('rejects ownership manipulation by a regular member', async () => {
    await expect(storage.leave(4, 8, 7)).rejects.toMatchObject({ message: 'invalidData' });
    expect(group.createdBy).toBe(7); expect(members).toEqual([7, 8]);
  });
});

it('returns current photos and role rights only with a membership-scoped query', async () => {
  const participant = { id: 8, fullName: 'Alice', avatarUrl: '/api/users/photos/aaaaaaaaaaaaaaaaaaaaa', position: 'Teacher', isActive: true, isArchived: false };
  const row = { id: 4, name: 'Teachers', createdBy: 7, participants: [participant], participantCount: 2, unreadCount: 0 };
  mocks.query.mockResolvedValue({ rows: [row] });
  expect(await storage.detail(4, 7, false)).toEqual({ ...row, canManage: true });
  expect(await storage.detail(4, 8, false)).toEqual({ ...row, canManage: false });
  expect(await storage.detail(4, 8, true)).toEqual({ ...row, canManage: true });
  expect(mocks.query.mock.calls[0][0]).toContain('own.user_id=$2');
  expect(mocks.query.mock.calls[0][0]).toContain('u.avatar_url');
  mocks.query.mockResolvedValue({ rows: [] }); expect(await storage.detail(4, 9, true)).toBeNull();
});
