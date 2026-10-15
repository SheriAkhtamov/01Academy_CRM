import { z } from 'zod';

export const reserveTelephonyLineSchema = z.object({
  clientCallId: z.string().uuid(),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
}).strict();
export const telephonyLineLeaseSchema = z.object({ id: z.string().uuid() }).strict();
export const releaseTelephonyLineSchema = z.object({
  id: z.string().uuid(),
  beforeInvite: z.boolean().optional(),
}).strict();
export type TelephonyLineLease = { id: string | null };
export const TELEPHONY_REMINDER_LINE_BUSY = 'onlinePbxLineBusyWithReminder' as const;
