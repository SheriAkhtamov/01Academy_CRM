const websocketEventTypes = [
  "ACADEMY_LEAD_CREATED",
  "ACADEMY_LEAD_UPDATED",
  "ACADEMY_STUDENT_CREATED",
  "ACADEMY_STUDENT_UPDATED",
  "ACADEMY_PAYMENT_CREATED",
  "ACADEMY_ATTENDANCE_UPDATED",
  "NEW_MESSAGE",
  "MESSAGE_READ",
  "USER_STATUS_CHANGED",
] as const;

type WebSocketEventType = (typeof websocketEventTypes)[number];

export type WebSocketEvent = {
  type: WebSocketEventType;
  data: Record<string, unknown>;
  recipientId?: number;
  audienceUserIds?: number[];
};
