import { z } from 'zod';

export const reserveTelephonyLineSchema = z.object({
  clientCallId: z.string().uuid(),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
}).strict();
export const telephonyLineLeaseSchema = z.object({ id: z.string().uuid() }).strict();
export type TelephonyLineLease = { id: string | null };
