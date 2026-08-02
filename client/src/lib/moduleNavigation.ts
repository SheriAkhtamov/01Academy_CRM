import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  BarChart3,
  Calendar,
  ClipboardCheck,
  ClipboardList,
  Flame,
  GraduationCap,
  HeartHandshake,
  KanbanSquare,
  Landmark,
  Layers3,
  Megaphone,
  MessagesSquare,
  PhoneCall,
  Plug,
  ReceiptText,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  UserCheck,
  Users,
  WalletCards,
} from 'lucide-react';
import type { AcademyAccessModule } from '@shared/academy';
import type { TranslationKey } from '@/lib/i18n';

export interface ModuleNavigationItem {
  id: string;
  labelKey: TranslationKey;
  href: string;
  icon: LucideIcon;
}

export interface ModuleNavigationDefinition {
  nameKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
  items: readonly ModuleNavigationItem[];
}

export const MODULE_NAVIGATION = {
  administration: {
    nameKey: 'administration',
    descriptionKey: 'administrationModuleDescription',
    icon: ShieldCheck,
    items: [
      { id: 'overview', labelKey: 'adminDashboardTitle', href: '/admin', icon: BarChart3 },
      { id: 'employees', labelKey: 'employees', href: '/employees', icon: Users },
      { id: 'academy-structure', labelKey: 'academyConfiguration', href: '/admin/academy-settings', icon: SlidersHorizontal },
      { id: 'sales-management', labelKey: 'salesSettings', href: '/admin/sales-settings', icon: UserCheck },
      { id: 'audit', labelKey: 'auditLog', href: '/admin/audit', icon: ClipboardList },
      { id: 'integrations', labelKey: 'navIntegrations', href: '/integrations', icon: Plug },
    ],
  },
  sales: {
    nameKey: 'salesModule',
    descriptionKey: 'salesModuleDescription',
    icon: TrendingUp,
    items: [
      { id: 'overview', labelKey: 'salesOverviewTitle', href: '/sales', icon: BarChart3 },
      { id: 'pipeline', labelKey: 'pipeline', href: '/sales/pipeline', icon: Flame },
      { id: 'archive', labelKey: 'leadArchive', href: '/sales/archive', icon: Archive },
      { id: 'schedule', labelKey: 'salesSchedule', href: '/sales/schedule', icon: Calendar },
      { id: 'clients', labelKey: 'myStudents', href: '/sales/clients', icon: GraduationCap },
      { id: 'inbox', labelKey: 'salesInbox', href: '/sales/messages', icon: MessagesSquare },
      { id: 'calls', labelKey: 'callJournal', href: '/sales/calls', icon: PhoneCall },
    ],
  },
  teacher: {
    nameKey: 'teacher',
    descriptionKey: 'teacherModuleDescription',
    icon: GraduationCap,
    items: [
      { id: 'overview', labelKey: 'teacherPerformance', href: '/teacher-module', icon: BarChart3 },
      { id: 'schedule', labelKey: 'teacherSchedule', href: '/teacher-module/schedule', icon: Calendar },
      { id: 'groups', labelKey: 'myGroups', href: '/teacher-module/groups', icon: Layers3 },
      { id: 'attendance', labelKey: 'attendanceLabel', href: '/teacher-module/attendance', icon: ClipboardCheck },
    ],
  },
  marketing: {
    nameKey: 'marketingTab',
    descriptionKey: 'marketingModuleDescription',
    icon: Megaphone,
    items: [
      { id: 'overview', labelKey: 'marketingOverviewTitle', href: '/marketing-module', icon: BarChart3 },
      { id: 'sources', labelKey: 'leadSources', href: '/marketing-module/sources', icon: Megaphone },
      { id: 'funnel', labelKey: 'marketingFunnelSection', href: '/marketing-module/funnel', icon: Flame },
      { id: 'warm-leads', labelKey: 'warmBase', href: '/marketing-module/warm-base', icon: Users },
      { id: 'referrals', labelKey: 'marketingReferrals', href: '/marketing-module/referrals', icon: HeartHandshake },
      { id: 'expenses', labelKey: 'marketingExpenses', href: '/marketing-module/expenses', icon: Banknote },
    ],
  },
  finance: {
    nameKey: 'financeModule',
    descriptionKey: 'financeCenterSubtitle',
    icon: Landmark,
    items: [
      { id: 'overview', labelKey: 'financeCenterOverview', href: '/finance', icon: Landmark },
      { id: 'income', labelKey: 'financeCenterIncome', href: '/finance/income', icon: ArrowDownToLine },
      { id: 'expenses', labelKey: 'expenses', href: '/finance/expenses', icon: ArrowUpFromLine },
      { id: 'payroll', labelKey: 'financeCenterPayroll', href: '/finance/payroll', icon: WalletCards },
      { id: 'transactions', labelKey: 'financeCenterTransactions', href: '/finance/transactions', icon: ReceiptText },
    ],
  },
} as const satisfies Record<AcademyAccessModule, {
  nameKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
  items: readonly ModuleNavigationItem[];
}>;

export const TASKS_NAVIGATION_ITEM = {
  id: 'tasks',
  labelKey: 'taskBoard',
  href: '/tasks',
  icon: KanbanSquare,
} as const satisfies ModuleNavigationItem;

export function moduleSectionLabelKey(
  module: AcademyAccessModule,
  sectionId: string,
): TranslationKey {
  const item = MODULE_NAVIGATION[module].items.find((candidate) => candidate.id === sectionId);
  if (!item) {
    throw new Error(`Unknown ${module} module section: ${sectionId}`);
  }
  return item.labelKey;
}
