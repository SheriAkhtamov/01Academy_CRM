import type { SanitizedUser } from '@shared/auth';
import {
  canAccessAcademyWorkspace,
  hasLeadershipAccess,
  type AcademyWorkspace,
} from '@shared/academy';
import type { TranslationKey } from '@/lib/i18n';

const workspaceTranslationKeys = {
  administration: 'administrationWorkspace',
  director: 'directorWorkspace',
  sales: 'salesDepartmentWorkspace',
  teacher: 'teacher',
  marketing: 'marketingDepartmentWorkspace',
} as const satisfies Record<AcademyWorkspace, TranslationKey>;

export function getInitials(fullName: string): string {
  return fullName
    .split(' ')
    .map(name => name.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);
}

export function formatUserWorkspace(
  workspace: string,
  t: (key: TranslationKey) => string,
): string {
  const key = workspaceTranslationKeys[workspace as AcademyWorkspace];
  return key ? t(key) : workspace;
}

export function canAccessReports(user: SanitizedUser): boolean {
  return hasLeadershipAccess(user) || canAccessAcademyWorkspace(user, 'marketing') || Boolean(user.hasReportAccess);
}

export function canManageUsers(user: SanitizedUser): boolean {
  return hasLeadershipAccess(user);
}
