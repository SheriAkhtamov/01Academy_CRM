import { z } from 'zod';

export const platformLoginRealmSchema = z.enum(['staff', 'portal']);
export type PlatformLoginRealm = z.infer<typeof platformLoginRealmSchema>;
export const platformLoginResolveSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(256),
  preferredRealm: platformLoginRealmSchema.default('staff'),
}).strict();
export const platformLoginResolutionSchema = z.object({ realm: platformLoginRealmSchema }).strict();
