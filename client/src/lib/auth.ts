import type { SanitizedUser } from '@shared/auth';
import {
  hasLeadershipAccess,
  type AcademyAccessModule,
} from '@shared/academy';
import type { TranslationKey } from '@/lib/i18n';

const moduleTranslationKeys = {
  administration: 'administration',
  sales: 'salesModule',
  teacher: 'teacher',
  marketing: 'marketingTab',
  finance: 'financeModule',
} as const satisfies Record<AcademyAccessModule, TranslationKey>;

export function getInitials(fullName: string): string {
  return fullName
    .split(' ')
    .map(name => name.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);
}

export function formatUserModule(
  module: string,
  t: (key: TranslationKey) => string,
): string {
  const key = moduleTranslationKeys[module as AcademyAccessModule];
  return key ? t(key) : module;
}

export function canManageUsers(user: SanitizedUser): boolean {
  return hasLeadershipAccess(user);
}
