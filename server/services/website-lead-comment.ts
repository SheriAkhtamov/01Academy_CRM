const courseNames = new Map([
  ['explorer', 'AI Explorer'],
  ['creator', 'AI Creator'],
  ['professional', 'AI Professional'],
]);

type WebsiteLeadCommentInput = {
  siteDomain: string;
  courseId?: unknown;
  courseName?: unknown;
  company: string | null;
  team: string | null;
  message: string | null;
  pageUrl: string | null;
};

const resolveCourseName = (input: WebsiteLeadCommentInput): string | null => {
  if (typeof input.courseId === 'string') {
    const courseName = courseNames.get(input.courseId.trim());
    if (courseName) return courseName;
  }

  if (typeof input.courseName === 'string') {
    const suppliedName = input.courseName.trim();
    for (const courseName of courseNames.values()) {
      if (suppliedName === courseName) return courseName;
    }
  }

  if (!input.pageUrl) return null;
  try {
    const page = new URL(input.pageUrl);
    if (page.protocol !== 'https:' && page.protocol !== 'http:') return null;
    const hostname = page.hostname.toLowerCase().replace(/^www\./, '');
    const siteDomain = input.siteDomain.toLowerCase().replace(/^www\./, '');
    if (hostname !== siteDomain) return null;
    const courseId = /^\/(?:ru|uz)\/courses\/([^/]+)\/?$/.exec(page.pathname)?.[1];
    return courseId ? courseNames.get(courseId) ?? null : null;
  } catch {
    return null;
  }
};

export const buildWebsiteLeadComment = (input: WebsiteLeadCommentInput) => {
  const courseName = resolveCourseName(input);
  const comment = [
    courseName ? `Интересуется ${courseName}` : null,
    input.company ? `Компания: ${input.company}` : null,
    input.team ? `Отдел / размер группы: ${input.team}` : null,
    input.message ? `Комментарий: ${input.message}` : null,
    input.pageUrl ? `Страница заявки: ${input.pageUrl}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n') || null;
  return { comment, courseName };
};
