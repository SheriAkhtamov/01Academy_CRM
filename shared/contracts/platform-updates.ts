import { z } from 'zod';

const localized = (maximum: number) => z.object({
  ru: z.string().trim().min(1).max(maximum),
  en: z.string().trim().min(1).max(maximum),
}).strict();
const localImage = z.string().regex(/^\/api\/updates\/images\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/);
export const updateContentSchema = z.object({
  title: localized(200),
  summary: localized(600),
  sections: z.array(z.object({
    heading: localized(200).optional(),
    paragraphs: z.array(localized(5000)).max(20).default([]),
    items: z.array(localized(2000)).max(20).default([]),
    image: z.object({ src: localImage, caption: localized(300) }).strict().optional(),
  }).strict().refine((section) => section.paragraphs.length > 0 || section.items.length > 0 || Boolean(section.image))).min(1).max(20),
}).strict();
export const publishUpdateSchema = z.object({
  publicationKey: z.string().regex(/^[a-zA-Z0-9-]{8,100}$/),
  content: updateContentSchema,
}).strict();
export type LocalizedUpdateText = { ru: string; en: string };
export type UpdateContent = z.infer<typeof updateContentSchema>;
export type PublishUpdateCommand = z.infer<typeof publishUpdateSchema>;
export interface PlatformUpdate {
  id: number;
  publishedAt: string;
  content: UpdateContent;
}
export interface UpdatePublicationResult {
  post: PlatformUpdate;
  recipientIds: number[];
  created: boolean;
}
