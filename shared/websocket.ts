const websocketEventTypes = [
  "ACADEMY_LEAD_CREATED",
  "ACADEMY_LEAD_UPDATED",
  "ACADEMY_STUDENT_CREATED",
  "ACADEMY_STUDENT_UPDATED",
  "ACADEMY_PAYMENT_CREATED",
  "ACADEMY_ATTENDANCE_UPDATED",
  "NEW_MESSAGE",
  "MESSAGE_READ",
  "INSTAGRAM_CONVERSATION_UPDATED",
  "INSTAGRAM_HISTORY_IMPORT_STATUS",
  "USER_STATUS_CHANGED",
  "BOARD_TASK_CREATED",
  "BOARD_TASK_UPDATED",
  "BOARD_TASK_DELETED",
  "TELEPHONY_CALL_UPDATED",
] as const;

type WebSocketEventType = (typeof websocketEventTypes)[number];

export type WebSocketEvent = {
  type: WebSocketEventType;
  data: Record<string, unknown>;
  recipientId?: number;
  audienceUserIds?: number[];
};

export const isWebSocketEventVisibleToUser = (event: WebSocketEvent, userId: number): boolean => {
  if (Array.isArray(event.audienceUserIds)) {
    return event.audienceUserIds.includes(userId);
  }
  return event.recipientId === undefined || event.recipientId === userId;
};
