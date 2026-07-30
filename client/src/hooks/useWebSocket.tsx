import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WebSocketEvent } from '@shared/websocket';
import { AUTH_SESSION_QUERY_KEY } from '@shared/auth';
import { useAuth } from './useAuth';
import { devLog } from '@/lib/debug';
import { messageQueryKeys } from '@/features/messages/api';
import { telephonyQueryKeys } from '@/features/telephony/api';

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
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
        setIsConnected(true);
        reconnectAttempts = 0;
      };

      ws.current.onclose = () => {
        setIsConnected(false);
        if (isMounted && reconnectAttempts < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          reconnectAttempts++;
          devLog(`WebSocket closed, reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
          reconnectTimer = setTimeout(connect, delay);
        }
      };

      ws.current.onerror = (error) => {
        devLog('WebSocket connection failed - this is expected in development mode', error);
        setIsConnected(false);
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
          queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/sales'] });
          queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/teacher'] });
          queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/marketing'] });
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
          queryClient.invalidateQueries({ queryKey: ['/api/board/tasks'] });
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
        case 'TELEPHONY_MISSED_CALLS_READ':
          queryClient.invalidateQueries({ queryKey: telephonyQueryKeys.missedCallUnread });
          break;
        case 'TELEPHONY_ROUTING_UPDATED':
          queryClient.invalidateQueries({ queryKey: ['/api/telephony/routing'] });
          queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
          break;
        default:
          devLog('Unhandled WebSocket message type:', message.type);
      }
    };

    connect();

    return () => {
      isMounted = false;
      clearTimeout(reconnectTimer);
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [queryClient, userId]);

  return { isConnected };
}
