import { expect, it, vi } from 'vitest';
import { syncPrimaryUserPhone } from '../server/routes/user-phone-support';

it.each([
  ['+998909999999', ['+998909999999', '+998902222222']],
  ['+99890 222 22 22', ['+99890 222 22 22']],
  [null, ['+998902222222']],
] as const)('updates the primary number and preserves extra numbers: %s', async (phone, expected) => {
  const executor = { query: vi.fn(async (sql: string) => sql.startsWith('SELECT phone')
    ? { rows: [{ phone: '+998901111111' }, { phone: '+998902222222' }] }
    : { rows: [] }) };
  await syncPrimaryUserPhone(executor as any, 7, phone);
  const insert = executor.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO user_phones')) as unknown as [string, unknown[]];
  expect(insert[1]).toEqual([7, expected]);
  expect(executor.query).toHaveBeenLastCalledWith('UPDATE users SET phone = $2 WHERE id = $1', [7, expected[0]]);
});
