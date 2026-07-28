import type { WebSocketEvent } from '@shared/websocket';

export type RealtimeTransport = (event: WebSocketEvent) => void;

const noopTransport: RealtimeTransport = () => undefined;
let activeTransport: RealtimeTransport = noopTransport;

export const publishRealtimeEvent = (event: WebSocketEvent): void => {
  activeTransport(event);
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
