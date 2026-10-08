import type { WebSocketEvent } from '@shared/websocket';

export type RealtimeTransport = (event: WebSocketEvent) => void;
export type RealtimeUserDisconnect = (userId: number, exceptSessionId?: string | null) => void;
export type RealtimeSessionDisconnect = (sessionId: string) => void;

const noopTransport: RealtimeTransport = () => undefined;
const noopUserDisconnect: RealtimeUserDisconnect = () => undefined;
let activeTransport: RealtimeTransport = noopTransport;
let activeUserDisconnect: RealtimeUserDisconnect = noopUserDisconnect;
let activeSessionDisconnect: RealtimeSessionDisconnect = () => undefined;

export const publishRealtimeEvent = (event: WebSocketEvent): void => {
  activeTransport(event);
};

export const disconnectRealtimeUser = (userId: number, exceptSessionId?: string | null): void => {
  activeUserDisconnect(userId, exceptSessionId);
};

export const disconnectRealtimeSession = (sessionId: string): void => {
  activeSessionDisconnect(sessionId);
};

export const setRealtimeSessionDisconnect = (disconnect: RealtimeSessionDisconnect): (() => void) => {
  activeSessionDisconnect = disconnect;
  return () => {
    if (activeSessionDisconnect === disconnect) activeSessionDisconnect = () => undefined;
  };
};

/**
 * The composition root installs the process transport once the WebSocket
 * gateway is ready. Domain modules publish events without knowing how clients
 * are connected.
 */
export const setRealtimeTransport = (transport: RealtimeTransport): (() => void) => {
  activeTransport = transport;

  return () => {
    if (activeTransport === transport) {
      activeTransport = noopTransport;
    }
  };
};

export const setRealtimeUserDisconnect = (
  disconnect: RealtimeUserDisconnect,
): (() => void) => {
  activeUserDisconnect = disconnect;

  return () => {
    if (activeUserDisconnect === disconnect) {
      activeUserDisconnect = noopUserDisconnect;
    }
  };
};
