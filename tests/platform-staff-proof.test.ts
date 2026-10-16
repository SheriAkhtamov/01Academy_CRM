import bcrypt from 'bcrypt';
import { beforeEach, expect, it, vi } from 'vitest';
import type { User } from '../server/db/schema';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('../server/storage', () => ({ storage: { getUserByLoginOrEmail: lookup } }));
import { authService } from '../server/services/auth';

beforeEach(() => lookup.mockReset());

it.each([
  [true, false, true],
  [false, false, false],
  [true, true, false],
] as const)('proves credential ownership for active=%s archived=%s while the actual login still enforces status', async (isActive, isArchived, mayLogIn) => {
  const user = { id: 7, email: 'employee', isActive, isArchived, password: await bcrypt.hash('ValidPassword123!', 1) } as User;
  lookup.mockResolvedValue(user);
  expect(await authService.verifyLoginCredentials(' employee ', 'ValidPassword123!')).toBe(true);
  expect(await authService.authenticateUser('employee', 'ValidPassword123!')).toEqual(mayLogIn ? user : null);
  expect(await authService.verifyLoginCredentials('employee', 'WrongPassword123!')).toBe(false);
  expect(lookup).toHaveBeenCalledWith('employee');
});

it('rejects oversized passwords even when the dummy comparison password equals a stored password', async () => {
  lookup.mockResolvedValue({ password: await bcrypt.hash('invalid-password', 1), isActive: true, isArchived: false });
  expect(await authService.verifyLoginCredentials('employee', 'x'.repeat(73))).toBe(false);
  expect(await authService.authenticateUser('employee', 'x'.repeat(73))).toBeNull();
});

it('does not prove unknown identifiers', async () => {
  lookup.mockResolvedValue(null);
  expect(await authService.verifyLoginCredentials('unknown', 'ValidPassword123!')).toBe(false);
});
