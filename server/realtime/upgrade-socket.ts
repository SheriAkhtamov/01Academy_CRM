import type { Duplex } from "node:stream";

const errorGuards = new WeakMap<Duplex, () => void>();
const handedOffSockets = new WeakSet<Duplex>();

/** HTTP releases upgrade sockets even when no application route claims them. */
export function guardUpgradeSocketErrors(socket: Duplex): void {
  if (errorGuards.has(socket) || handedOffSockets.has(socket)) return;
  const destroy = () => socket.destroy();
  const detach = () => {
    socket.off("error", destroy);
    socket.off("close", detach);
    errorGuards.delete(socket);
  };
  socket.on("error", destroy);
  socket.once("close", detach);
  errorGuards.set(socket, detach);
}

/** Own only this upgrade socket until its WebSocket transport takes over. */
export function guardUpgradeSocket(socket: Duplex, onClose?: () => void): () => void {
  guardUpgradeSocketErrors(socket);
  const destroy = () => socket.destroy();
  const detach = () => {
    socket.off("end", destroy);
    socket.off("close", closed);
  };
  const closed = () => {
    detach();
    onClose?.();
  };
  socket.once("end", destroy);
  socket.once("close", closed);
  return () => {
    detach();
    handedOffSockets.add(socket);
    errorGuards.get(socket)?.();
  };
}
