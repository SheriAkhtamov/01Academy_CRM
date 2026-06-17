import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WebSocketEvent } from '@shared/websocket';
import { useAuth } from './useAuth';
import { devLog } from '@/lib/debug';

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
          queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] });
          queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/teacher'] });
          queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/marketing'] });
          queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/analytics'] });
          queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/admin'] });
          queryClient.invalidateQueries({ queryKey: ['/api/academy/analytics/dashboard'] });
          break;
        case 'NEW_MESSAGE':
          if (message.data?.senderId && message.data?.receiverId) {
            queryClient.invalidateQueries({ queryKey: ['/api/messages', message.data.senderId] });
            queryClient.invalidateQueries({ queryKey: ['/api/messages', message.data.receiverId] });
            queryClient.invalidateQueries({ queryKey: ['/api/messages/conversations'] });
          }
          break;
        case 'MESSAGE_READ' as any:
          if (message.data?.senderId && message.data?.receiverId) {
            queryClient.invalidateQueries({ queryKey: ['/api/messages', message.data.senderId] });
            queryClient.invalidateQueries({ queryKey: ['/api/messages', message.data.receiverId] });
            queryClient.invalidateQueries({ queryKey: ['/api/messages/conversations'] });
          }
          break;
        case 'USER_STATUS_CHANGED':
          queryClient.invalidateQueries({ queryKey: ['/api/users/online-status'] });
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
