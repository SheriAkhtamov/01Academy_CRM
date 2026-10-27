import { CHAT_TYPING_IDLE_MS, CHAT_TYPING_REFRESH_MS, type ChatTypingRequest } from '@shared/contracts/chat-typing';

/** One source per open composer keeps multiple tabs independent. */
export function createTypingReporter(send: (input: ChatTypingRequest) => Promise<unknown>) {
  const sourceId = crypto.randomUUID();
  let sequence = 0;
  let active = false;
  let disposed = false;
  let lastSent = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const publish = (next: boolean) => {
    // Send immediately with the current session. Sequence numbers let receivers
    // ignore a delayed start arriving after a stop; no draft text is transmitted.
    try { void send({ active: next, sourceId, sequence: ++sequence }).catch(() => undefined); }
    catch { /* Typing feedback must never block composing or sending a message. */ }
  };
  const stop = () => {
    clearTimeout(idle);
    if (!active) return;
    active = false;
    publish(false);
  };
  return {
    update(hasText: boolean) {
      if (disposed) return;
      if (!hasText) { stop(); return; }
      const now = Date.now();
      if (!active || now - lastSent >= CHAT_TYPING_REFRESH_MS) {
        lastSent = now;
        publish(true);
      }
      active = true;
      clearTimeout(idle);
      idle = setTimeout(stop, CHAT_TYPING_IDLE_MS);
    },
    stop,
    dispose() { stop(); disposed = true; },
  };
}
