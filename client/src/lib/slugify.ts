/**
 * Cyrillic-to-latin transliteration and slug generation for resource codes
 * (school/course codes are auto-suggested from the display name).
 */
const transliterationMap: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh',
  щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export const slugify = (value: string) => value
  .trim()
  .toLowerCase()
  .split('')
  .map((character) => transliterationMap[character] ?? character)
  .join('')
  .replace(/[^a-z0-9а-яё]+/gi, '-')
  .replace(/[^a-z0-9-]+/g, '')
  .replace(/^-+|-+$/g, '');

interface SlugSource { slug?: string | null }

export const buildUniqueCourseSlug = (
  name: string,
  courses: SlugSource[],
  ignoredCourseId?: number | null,
) => {
  const baseSlug = slugify(name) || 'course';
  const usedSlugs = new Set(
    courses
      .filter((course) => course.slug !== undefined)
      .map((course) => course.slug as string),
  );
  if (!usedSlugs.has(baseSlug)) return baseSlug;

  let suffix = 2;
  while (usedSlugs.has(`${baseSlug}-${suffix}`)) suffix += 1;
  return `${baseSlug}-${suffix}`;
};
