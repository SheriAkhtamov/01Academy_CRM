import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_TYPING_TTL_MS, type ChatTypingKind } from '@shared/contracts/chat-typing';
import { useAuth } from '@/hooks/useAuth';
import { messagesApi } from './api';
import { chatGroupsApi } from './chat-groups-api';
import { subscribeChatTyping } from './typing-events';
import { createTypingReporter } from './typing-reporter';

export function useChatTyping(kind: ChatTypingKind, targetId: number | null, enabled = true) {
  const { user } = useAuth();
  const viewerId = user?.id;
  const scope = enabled && viewerId && targetId ? `${viewerId}:${kind}:${targetId}` : null;
  const [status, setStatus] = useState<{ scope: string | null; typing: boolean }>({ scope: null, typing: false });
  const reporter = useRef<ReturnType<typeof createTypingReporter> | null>(null);

  useEffect(() => {
    if (!scope || !viewerId || !targetId) {
      setStatus({ scope: null, typing: false });
      return;
    }
    const source = createTypingReporter((input) => kind === 'direct'
      ? messagesApi.typing(targetId, input)
      : chatGroupsApi.typing(targetId, input));
    reporter.current = source;
    const participants = new Map<string, { sequence: number; active: boolean; timer?: ReturnType<typeof setTimeout> }>();
    const update = () => setStatus({ scope, typing: [...participants.values()].some((entry) => entry.active) });
    const reset = () => {
      participants.forEach((entry) => clearTimeout(entry.timer));
      participants.clear();
      update();
    };
    const unsubscribe = subscribeChatTyping((event) => {
      if (!event) { reset(); return; }
      if (event.kind !== kind || event.senderId === viewerId) return;
      const matches = kind === 'direct' ? event.senderId === targetId && event.targetId === viewerId : event.targetId === targetId;
      if (!matches) return;
      const key = `${event.senderId}:${event.sourceId}`;
      const previous = participants.get(key);
      if (previous && event.sequence <= previous.sequence) return;
      clearTimeout(previous?.timer);
      const entry = { sequence: event.sequence, active: event.active, timer: undefined as ReturnType<typeof setTimeout> | undefined };
      if (entry.active) entry.timer = setTimeout(() => { entry.active = false; update(); }, CHAT_TYPING_TTL_MS);
      participants.set(key, entry);
      update();
    });
    const stopWhenHidden = () => { if (document.hidden) source.stop(); };
    document.addEventListener('visibilitychange', stopWhenHidden);
    window.addEventListener('blur', source.stop);
    window.addEventListener('offline', source.stop);
    reset();
    return () => {
      unsubscribe();
      participants.forEach((entry) => clearTimeout(entry.timer));
      source.dispose();
      if (reporter.current === source) reporter.current = null;
      document.removeEventListener('visibilitychange', stopWhenHidden);
      window.removeEventListener('blur', source.stop);
      window.removeEventListener('offline', source.stop);
    };
  }, [scope, kind, targetId, viewerId]);

  const reportTyping = useCallback((hasText: boolean) => {
    if (!document.hidden) reporter.current?.update(hasText);
  }, []);
  const stopTyping = useCallback(() => reporter.current?.stop(), []);
  return { isTyping: status.scope === scope && status.typing, reportTyping, stopTyping };
}
