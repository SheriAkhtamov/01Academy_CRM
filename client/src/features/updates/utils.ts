import type { LocalizedUpdateText, PlatformUpdate } from '@shared/contracts/platform-updates';

export function calculateReadingTime(textOrPost: string | PlatformUpdate, locale: 'ru' | 'en' = 'ru'): number {
  if (typeof textOrPost === 'string') {
    const chars = textOrPost.trim().length;
    return Math.max(1, Math.ceil(chars / 1000));
  }

  const post = textOrPost;
  let totalChars = 0;
  totalChars += post.content.title[locale]?.length ?? 0;
  totalChars += post.content.summary[locale]?.length ?? 0;

  for (const section of post.content.sections) {
    if (section.heading?.[locale]) {
      totalChars += section.heading[locale].length;
    }
    for (const paragraph of section.paragraphs) {
      totalChars += paragraph[locale]?.length ?? 0;
    }
    for (const item of section.items) {
      totalChars += item[locale]?.length ?? 0;
    }
    if (section.image?.caption?.[locale]) {
      totalChars += section.image.caption[locale].length;
    }
  }

  return Math.max(1, Math.ceil(totalChars / 1000));
}

export function getFirstPostImage(post: PlatformUpdate): { src: string; caption: LocalizedUpdateText } | null {
  for (const section of post.content.sections) {
    if (section.image) {
      return section.image;
    }
  }
  return null;
}

export function formatReleaseDate(dateString: string, locale: 'ru' | 'en'): string {
  try {
    return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
      dateStyle: 'long',
      timeZone: 'Asia/Tashkent',
    }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

// ==========================================
// Read status utilities
// ==========================================

export const READ_POSTS_STORAGE_KEY = 'academy-updates:read-posts';

export function getReadPostIds(): number[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(READ_POSTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id));
    }
  } catch {}
  return [];
}

export function markPostAsRead(postId: number): number[] {
  if (typeof postId !== 'number' || !Number.isSafeInteger(postId)) return getReadPostIds();
  try {
    const current = getReadPostIds();
    if (!current.includes(postId)) {
      const updated = [...current, postId];
      window.localStorage.setItem(READ_POSTS_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    }
    return current;
  } catch {
    return getReadPostIds();
  }
}

export function isPostRead(postId: number, readIds: number[]): boolean {
  return readIds.includes(postId);
}

// ==========================================
// Publish draft auto-save utilities
// ==========================================

export const PUBLISH_DRAFT_STORAGE_KEY = 'academy-updates:publish-draft';

export interface PublishDraftData {
  titleRu: string;
  titleEn: string;
  summaryRu: string;
  summaryEn: string;
  sectionsRu?: Array<{ heading?: string; paragraphs?: string[]; items?: string[] }>;
  sectionsEn?: Array<{ heading?: string; paragraphs?: string[]; items?: string[] }>;
  rawBodyRu?: string;
  rawBodyEn?: string;
  updatedAt?: string;
}

export function getPublishDraft(): PublishDraftData | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(PUBLISH_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PublishDraftData;
  } catch {
    return null;
  }
}

export function savePublishDraft(draft: PublishDraftData): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    draft.updatedAt = new Date().toISOString();
    window.localStorage.setItem(PUBLISH_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {}
}

export function clearPublishDraft(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(PUBLISH_DRAFT_STORAGE_KEY);
  } catch {}
}
