import type { SanitizedUser } from '@shared/auth';
import type { AcademyRole } from '@shared/academy';
import type { TranslationKey } from '@/lib/i18n';

const roleTranslationKeys = {
  admin: 'admin',
  head: 'roleHead',
  account_manager: 'roleAccountManager',
  teacher: 'teacher',
  operations_director: 'roleOperationsDirector',
  smm_manager: 'roleSmmManager',
} as const satisfies Record<AcademyRole, TranslationKey>;

export function getInitials(fullName: string): string {
  return fullName
    .split(' ')
    .map(name => name.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);
}

export function formatUserRole(
  role: string,
  t: (key: TranslationKey) => string,
): string {
  const key = roleTranslationKeys[role as AcademyRole];
  return key ? t(key) : role;
}

export function canAccessReports(user: SanitizedUser): boolean {
  return ['admin', 'head', 'operations_director', 'smm_manager'].includes(user.role) || Boolean(user.hasReportAccess);
}

export function canManageUsers(user: SanitizedUser): boolean {
  return ['admin', 'head'].includes(user.role);
}

export function canAccessAnalytics(user: SanitizedUser): boolean {
  return ['admin', 'head', 'operations_director', 'smm_manager'].includes(user.role) || Boolean(user.hasReportAccess);
}
