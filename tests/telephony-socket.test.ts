import { describe, expect, it, vi } from 'vitest';
import { waitForTelephonySocket } from '../client/src/contexts/TelephonyContext';

describe('browser telephony socket recovery', () => {
  it('waits for the reconnecting OnlinePBX socket before dialing', async () => {
    const socketReady = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);

    await expect(waitForTelephonySocket({ socketReady }, 100, 1)).resolves.toBe(true);
    expect(socketReady).toHaveBeenCalledTimes(3);
  });

  it('fails without creating a call when the socket does not recover', async () => {
    const socketReady = vi.fn().mockReturnValue(false);

    await expect(waitForTelephonySocket({ socketReady }, 5, 1)).resolves.toBe(false);
  });
});
