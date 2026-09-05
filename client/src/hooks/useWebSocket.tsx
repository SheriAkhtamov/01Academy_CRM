import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WebSocketEvent } from '@shared/websocket';
import { AUTH_SESSION_QUERY_KEY } from '@shared/auth';
import { useAuth } from './useAuth';
import { devLog } from '@/lib/debug';
import { messageQueryKeys } from '@/features/messages/api';
import { telephonyQueryKeys } from '@/features/telephony/api';
import { boardQueryKeys } from '@/features/board/api';

/**
 * `connecting` covers both the first attempt and the backoff window, so the UI
 * only nags once retries have actually been exhausted.
 */
export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

export function useWebSocket() {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const ws = useRef<WebSocket | null>(null);
  const reconnectNowRef = useRef<() => void>(() => undefined);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;

    let reconnectTimer: ReturnType<typeof setTimeout>;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        setStatus('connected');
        reconnectAttempts = 0;
        // Backoff may have run for minutes; anything that happened meanwhile
        // never arrived as an event, so treat the cache as suspect.
        queryClient.invalidateQueries();
      };

      ws.current.onclose = () => {
        if (isMounted && reconnectAttempts < maxReconnectAttempts) {
          setStatus('connecting');
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          reconnectAttempts++;
          devLog(`WebSocket closed, reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
          reconnectTimer = setTimeout(connect, delay);
        } else {
          // Out of retries: live updates have stopped for good until something
          // triggers a fresh attempt, so the UI has to say so.
          setStatus('disconnected');
        }
      };

      ws.current.onerror = (error) => {
        devLog('WebSocket connection failed - this is expected in development mode', error);
      };

      ws.current.onmessage = (event) => {
        try {
          const message: WebSocketEvent = JSON.parse(event.data);
          handleWebSocketMessage(message);
        } catch (error) {
          devLog('Failed to parse WebSocket message:', error);
        }
      };
    };

    const handleWebSocketMessage = (message: WebSocketEvent) => {
      switch (message.type) {
        case 'ACADEMY_LEAD_CREATED':
        case 'ACADEMY_LEAD_UPDATED':
        case 'ACADEMY_STUDENT_CREATED':
        case 'ACADEMY_STUDENT_UPDATED':
        case 'ACADEMY_PAYMENT_CREATED':
        case 'ACADEMY_ATTENDANCE_UPDATED':
          // Event payloads do not consistently include every related entity ID.
          // Refresh active academy views and invalidate the inactive ones too,
          // including open lead details, metrics, administration and finance.
          queryClient.invalidateQueries({ predicate: (query) => (
            typeof query.queryKey[0] === 'string'
            && (query.queryKey[0].startsWith('/api/academy/') || query.queryKey[0] === 'finance')
          ) });
          break;
        case 'NEW_MESSAGE':
          if (message.data?.senderId && message.data?.receiverId) {
            queryClient.invalidateQueries({ queryKey: messageQueryKeys.thread(Number(message.data.senderId)) });
            queryClient.invalidateQueries({ queryKey: messageQueryKeys.thread(Number(message.data.receiverId)) });
            queryClient.invalidateQueries({ queryKey: messageQueryKeys.conversations });
          }
          break;
        case 'MESSAGE_READ':
          if (message.data?.senderId && message.data?.receiverId) {
            queryClient.invalidateQueries({ queryKey: messageQueryKeys.thread(Number(message.data.senderId)) });
            queryClient.invalidateQueries({ queryKey: messageQueryKeys.thread(Number(message.data.receiverId)) });
            queryClient.invalidateQueries({ queryKey: messageQueryKeys.conversations });
          }
          break;
        case 'INSTAGRAM_CONVERSATION_UPDATED':
          queryClient.invalidateQueries({ queryKey: ['/api/instagram/conversations'] });
          if (message.data?.conversationId) {
            queryClient.invalidateQueries({
              queryKey: ['/api/instagram/conversations', message.data.conversationId, 'messages'],
            });
          }
          break;
        case 'INSTAGRAM_HISTORY_IMPORT_STATUS':
          queryClient.setQueryData(['/api/instagram/conversations/sync/status'], message.data);
          if (message.data?.status === 'completed' || message.data?.status === 'partial') {
            queryClient.invalidateQueries({ queryKey: ['/api/instagram/conversations'] });
            queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/sales'] });
          }
          break;
        case 'USER_STATUS_CHANGED':
          queryClient.invalidateQueries({ queryKey: ['/api/users/online-status'] });
          queryClient.invalidateQueries({ queryKey: ['/api/telephony/routing'] });
          break;
        case 'BOARD_TASK_CREATED':
        case 'BOARD_TASK_UPDATED':
        case 'BOARD_TASK_DELETED':
          queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
          if (message.data?.id) {
            queryClient.invalidateQueries({ queryKey: [`/api/board/tasks/${message.data.id}`] });
          }
          break;
        case 'TELEPHONY_CALL_UPDATED':
          queryClient.invalidateQueries({ queryKey: ['/api/telephony/calls'] });
          queryClient.invalidateQueries({ queryKey: ['/api/telephony/calls/journal'] });
          queryClient.invalidateQueries({ queryKey: telephonyQueryKeys.missedCallUnread });
          queryClient.invalidateQueries({ queryKey: ['/api/academy/leads'] });
          break;
        case 'TELEPHONY_MISSED_CALLS_UPDATED':
          queryClient.invalidateQueries({ queryKey: telephonyQueryKeys.missedCallUnread });
          queryClient.invalidateQueries({ queryKey: ['/api/telephony/calls/journal'] });
          break;
        case 'TELEPHONY_ROUTING_UPDATED':
          queryClient.invalidateQueries({ queryKey: ['/api/telephony/routing'] });
          queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
          break;
        default:
          devLog('Unhandled WebSocket message type:', message.type);
      }
    };

    // A machine that sleeps or loses Wi-Fi burns through every retry while it
    // is offline and then stays dead forever. Coming back online, returning to
    // the tab, or pressing Reconnect all restart the budget.
    const restart = () => {
      if (!isMounted) return;
      const readyState = ws.current?.readyState;
      if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) return;
      clearTimeout(reconnectTimer);
      reconnectAttempts = 0;
      setStatus('connecting');
      connect();
    };

    reconnectNowRef.current = restart;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') restart();
    };

    window.addEventListener('online', restart);
    document.addEventListener('visibilitychange', handleVisibility);

    connect();

    return () => {
      isMounted = false;
      reconnectNowRef.current = () => undefined;
      window.removeEventListener('online', restart);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTimeout(reconnectTimer);
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [queryClient, userId]);

  return {
    status,
    isConnected: status === 'connected',
    reconnect: () => reconnectNowRef.current(),
  };
}
