import type { SanitizedUser } from '@shared/auth';
import { ACADEMY_ROLE_LABELS, type AcademyRole } from '@shared/academy';

export function getInitials(fullName: string): string {
  return fullName
    .split(' ')
    .map(name => name.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);
}

export function formatUserRole(role: string): string {
  return ACADEMY_ROLE_LABELS[role as AcademyRole]?.ru ?? role;
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

export function canAccessAdmin(user: SanitizedUser): boolean {
  return ['admin', 'head'].includes(user.role);
}

export function canAccessFinance(user: SanitizedUser): boolean {
  return ['admin', 'head', 'operations_director'].includes(user.role);
}

export function canAccessOperations(user: SanitizedUser): boolean {
  return ['admin', 'head', 'operations_director', 'teacher'].includes(user.role);
}

export function canAccessMarketing(user: SanitizedUser): boolean {
  return ['admin', 'head', 'account_manager', 'smm_manager'].includes(user.role);
}

export function isEmployee(user: SanitizedUser): boolean {
  return user.role === 'employee';
}
