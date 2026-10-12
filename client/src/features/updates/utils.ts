import type { LocalizedUpdateText, PlatformUpdate, UpdateCategory } from '@shared/contracts/platform-updates';

export type { UpdateCategory } from '@shared/contracts/platform-updates';

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
// Category determination and presentation
// ==========================================

export function getPostCategory(post: PlatformUpdate): UpdateCategory {
  if (post.content.category) {
    return post.content.category;
  }
  if ((post as unknown as { category?: UpdateCategory }).category) {
    return (post as unknown as { category: UpdateCategory }).category;
  }
  const actionHref = post.content.action?.href;
  if (actionHref?.includes('admin')) {
    return 'administration';
  }
  if (actionHref?.includes('sales')) {
    return 'sales';
  }

  const text = [
    post.content.title.ru,
    post.content.title.en,
    post.content.summary.ru,
    post.content.summary.en,
    ...(post.content.sections?.flatMap((s) => [
      s.heading?.ru,
      s.heading?.en,
      ...s.paragraphs.flatMap((p) => [p.ru, p.en]),
      ...s.items.flatMap((i) => [i.ru, i.en]),
    ]) ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const improvementPattern = new RegExp('\\u0443\\u043b\\u0443\\u0447|\\u0438\\u0441\\u043f\\u0440\\u0430\\u0432|\\u043e\\u043f\\u0442\\u0438\\u043c\\u0438\\u0437|ux|ui|fix|improve|speed', 'i');
  if (improvementPattern.test(text)) {
    return 'improvement';
  }

  const salesPattern = new RegExp('\\u043f\\u0440\\u043e\\u0434\\u0430\\u0436|\\u043b\\u0438\\u0434|\\u043a\\u043b\\u0438\\u0435\\u043d\\u0442|\\u0441\\u0434\\u0435\\u043b\\u043a|sales', 'i');
  if (salesPattern.test(text)) {
    return 'sales';
  }

  const adminPattern = new RegExp('\\u0430\\u0434\\u043c\\u0438\\u043d|\\u043d\\u0430\\u0441\\u0442\\u0440\\u043e\\u0439\\u043a|\\u0441\\u0442\\u0440\\u0443\\u043a\\u0442\\u0443\\u0440|\\u043f\\u0440\\u0430\\u0432\\u0430|admin|settings', 'i');
  if (adminPattern.test(text)) {
    return 'administration';
  }

  return 'feature';
}

export function getCategoryBadgeClass(category: UpdateCategory): string {
  switch (category) {
    case 'improvement':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    case 'sales':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'administration':
      return 'border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400';
    case 'feature':
    default:
      return 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400';
  }
}

export function getCategoryTranslationKey(category: UpdateCategory): 'updatesCategoryFeature' | 'updatesCategoryImprovement' | 'updatesCategorySales' | 'updatesCategoryAdministration' {
  switch (category) {
    case 'improvement':
      return 'updatesCategoryImprovement';
    case 'sales':
      return 'updatesCategorySales';
    case 'administration':
      return 'updatesCategoryAdministration';
    case 'feature':
    default:
      return 'updatesCategoryFeature';
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

export function markAllPostsAsRead(postIds: number[]): number[] {
  try {
    const current = getReadPostIds();
    const set = new Set([...current, ...postIds.filter((id) => typeof id === 'number' && Number.isSafeInteger(id))]);
    const updated = Array.from(set);
    window.localStorage.setItem(READ_POSTS_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return getReadPostIds();
  }
}

export function isPostRead(postId: number, readIds: number[]): boolean {
  return readIds.includes(postId);
}

// ==========================================
// Employee reaction utilities
// ==========================================

export const REACTIONS_STORAGE_KEY = 'academy-updates:reactions';
export type ReactionType = 'helpful' | 'awesome' | 'excited';

export interface PostReactions {
  helpful: number;
  awesome: number;
  excited: number;
  userReaction?: ReactionType | null;
}

interface StoredReactionsMap {
  [postId: string]: {
    counts: { helpful: number; awesome: number; excited: number };
    userReaction?: ReactionType | null;
  };
}

export function getPostReactions(postId: number): PostReactions {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { helpful: 0, awesome: 0, excited: 0, userReaction: null };
    }
    const raw = window.localStorage.getItem(REACTIONS_STORAGE_KEY);
    if (!raw) return { helpful: 0, awesome: 0, excited: 0, userReaction: null };
    const parsed = JSON.parse(raw) as StoredReactionsMap;
    const item = parsed[String(postId)];
    if (!item) return { helpful: 0, awesome: 0, excited: 0, userReaction: null };
    return {
      helpful: item.counts?.helpful ?? 0,
      awesome: item.counts?.awesome ?? 0,
      excited: item.counts?.excited ?? 0,
      userReaction: item.userReaction ?? null,
    };
  } catch {
    return { helpful: 0, awesome: 0, excited: 0, userReaction: null };
  }
}

export function togglePostReaction(postId: number, reaction: ReactionType): PostReactions {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { helpful: 0, awesome: 0, excited: 0, userReaction: null };
    }
    const raw = window.localStorage.getItem(REACTIONS_STORAGE_KEY);
    const parsed: StoredReactionsMap = raw ? JSON.parse(raw) : {};
    const key = String(postId);
    const current = parsed[key] || { counts: { helpful: 0, awesome: 0, excited: 0 }, userReaction: null };

    if (current.userReaction === reaction) {
      current.counts[reaction] = Math.max(0, (current.counts[reaction] || 0) - 1);
      current.userReaction = null;
    } else {
      if (current.userReaction) {
        current.counts[current.userReaction] = Math.max(0, (current.counts[current.userReaction] || 0) - 1);
      }
      current.counts[reaction] = (current.counts[reaction] || 0) + 1;
      current.userReaction = reaction;
    }

    parsed[key] = current;
    window.localStorage.setItem(REACTIONS_STORAGE_KEY, JSON.stringify(parsed));
    return {
      helpful: current.counts.helpful,
      awesome: current.counts.awesome,
      excited: current.counts.excited,
      userReaction: current.userReaction,
    };
  } catch {
    return { helpful: 0, awesome: 0, excited: 0, userReaction: null };
  }
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
  category?: UpdateCategory;
  actionHref?: string;
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
