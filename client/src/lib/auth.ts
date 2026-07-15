import type { SanitizedUser } from '@shared/auth';
import {
  canAccessAcademyWorkspace,
  hasLeadershipAccess,
  type AcademyAccessModule,
} from '@shared/academy';
import type { TranslationKey } from '@/lib/i18n';

const workspaceTranslationKeys = {
  administration: 'administrationWorkspace',
  sales: 'salesDepartmentWorkspace',
  teacher: 'teacherDepartmentWorkspace',
  marketing: 'marketingDepartmentWorkspace',
  finance: 'financeCenterModule',
} as const satisfies Record<AcademyAccessModule, TranslationKey>;

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
  const key = workspaceTranslationKeys[workspace as AcademyAccessModule];
  return key ? t(key) : workspace;
}

export function canAccessReports(user: SanitizedUser): boolean {
  return hasLeadershipAccess(user) || canAccessAcademyWorkspace(user, 'marketing') || Boolean(user.hasReportAccess);
}

export function canManageUsers(user: SanitizedUser): boolean {
  return hasLeadershipAccess(user);
}
