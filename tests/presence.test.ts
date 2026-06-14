import { describe, expect, it, vi } from "vitest";
import { createPresenceTracker } from "../server/lib/presence";

describe("presence tracker", () => {
  it("updates presence on first connect and last disconnect only", async () => {
    const updateUserOnlineStatus = vi.fn().mockResolvedValue(undefined);
    const broadcast = vi.fn();
    const tracker = createPresenceTracker({
      updateUserOnlineStatus,
      broadcast,
    });

    await tracker.connect(7);
    await tracker.connect(7);
    await tracker.disconnect(7);
    await tracker.disconnect(7);

    expect(updateUserOnlineStatus).toHaveBeenNthCalledWith(1, 7, true);
    expect(updateUserOnlineStatus).toHaveBeenNthCalledWith(2, 7, false);
    expect(updateUserOnlineStatus).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenNthCalledWith(1, {
      type: "USER_STATUS_CHANGED",
      data: {
        userId: 7,
        isOnline: true,
      },
    });
    expect(broadcast).toHaveBeenNthCalledWith(2, {
      type: "USER_STATUS_CHANGED",
      data: {
        userId: 7,
        isOnline: false,
      },
    });
  });
});
