import { chatTypingEventSchema, type ChatTypingEvent } from '@shared/contracts/chat-typing';

type Listener = (event: ChatTypingEvent | null) => void;
const listeners = new Set<Listener>();

/** Ephemeral activity never enters the message cache or unread counters. */
export function receiveChatTyping(data: unknown) {
  const result = chatTypingEventSchema.safeParse(data);
  if (result.success) listeners.forEach((listener) => listener(result.data));
}

export function clearChatTyping() {
  listeners.forEach((listener) => listener(null));
}

export function subscribeChatTyping(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
