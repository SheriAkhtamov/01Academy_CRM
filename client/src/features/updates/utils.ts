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
