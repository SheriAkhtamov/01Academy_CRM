import type { WebSocketEvent } from "@shared/websocket";

interface PresenceTrackerOptions {
  updateUserOnlineStatus: (userId: number, isOnline: boolean) => Promise<void>;
  broadcast: (event: WebSocketEvent) => void;
  onError?: (error: unknown, context: { userId: number; isOnline: boolean }) => void;
}

export function createPresenceTracker({
  updateUserOnlineStatus,
  broadcast,
  onError,
}: PresenceTrackerOptions) {
  const connections = new Map<number, number>();

  const syncPresence = async (userId: number, isOnline: boolean) => {
    try {
      await updateUserOnlineStatus(userId, isOnline);
      broadcast({
        type: "USER_STATUS_CHANGED",
        data: {
          userId,
          isOnline,
        },
      });
    } catch (error) {
      onError?.(error, { userId, isOnline });
    }
  };

  return {
    async connect(userId: number) {
      const currentCount = connections.get(userId) ?? 0;
      connections.set(userId, currentCount + 1);

      if (currentCount === 0) {
        await syncPresence(userId, true);
      }
    },

    async disconnect(userId: number) {
      const currentCount = connections.get(userId) ?? 0;

      if (currentCount <= 1) {
        connections.delete(userId);
        if (currentCount === 1) {
          await syncPresence(userId, false);
        }
        return;
      }

      connections.set(userId, currentCount - 1);
    },
  };
}
