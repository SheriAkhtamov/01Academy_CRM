import { describe, expect, it, vi } from 'vitest';
import { revokeUserAuthenticationArtifacts } from '../server/services/session-security';

describe('authentication artifact revocation', () => {
  it('revokes other sessions and both directions of saved-account access', async () => {
    const executor = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await revokeUserAuthenticationArtifacts(42, {
      exceptSessionId: 'current-session',
      executor: executor as any,
    });

    expect(executor.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`sess ->> 'userId' = $1`),
      ['42', 'current-session'],
    );
    expect(executor.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('owner_user_id = $1 OR account_user_id = $1'),
      [42],
    );
  });
});
