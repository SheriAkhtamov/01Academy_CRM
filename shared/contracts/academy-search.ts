export const academySearchTypes = ['lead', 'student', 'group', 'course', 'source', 'user'] as const;
export type AcademySearchType = typeof academySearchTypes[number];
export interface AcademySearchItem {
  id: string;
  entityType: AcademySearchType;
  title: string;
  subtitle?: string;
  module?: string;
  isArchived?: boolean;
  href: string;
}
export interface AcademySearchPage {
  items: AcademySearchItem[];
  hasMore: boolean;
}
