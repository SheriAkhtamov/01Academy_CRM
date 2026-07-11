import { describe, expect, it } from "vitest";
import { isWebSocketEventVisibleToUser, type WebSocketEvent } from "../shared/websocket";

const event = (routing: Partial<WebSocketEvent>): WebSocketEvent => ({
  type: "INSTAGRAM_CONVERSATION_UPDATED",
  data: {},
  ...routing,
});

describe("WebSocket audience routing", () => {
  it("treats an omitted audience as a broadcast", () => {
    expect(isWebSocketEventVisibleToUser(event({}), 10)).toBe(true);
  });

  it("treats an explicit empty audience as send-to-nobody", () => {
    expect(isWebSocketEventVisibleToUser(event({ audienceUserIds: [] }), 10)).toBe(false);
  });

  it("only exposes an audience-scoped event to listed users", () => {
    const scoped = event({ audienceUserIds: [7, 8] });
    expect(isWebSocketEventVisibleToUser(scoped, 7)).toBe(true);
    expect(isWebSocketEventVisibleToUser(scoped, 9)).toBe(false);
  });
});
