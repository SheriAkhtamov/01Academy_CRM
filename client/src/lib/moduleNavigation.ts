import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  BellRing,
  Calendar,
  ClipboardCheck,
  ClipboardList,
  Flame,
  GraduationCap,
  KanbanSquare,
  Landmark,
  Layers3,
  Megaphone,
  MousePointerClick,
  MessagesSquare,
  PhoneCall,
  Plug,
  ReceiptText,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  RadioTower,
  Settings2,
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
  icon: LucideIcon;
  items: readonly ModuleNavigationItem[];
}

export const MODULE_NAVIGATION = {
  administration: {
    nameKey: 'administration',
    icon: ShieldCheck,
    items: [
      { id: 'overview', labelKey: 'adminDashboardTitle', href: '/admin', icon: BarChart3 },
      { id: 'employees', labelKey: 'employees', href: '/employees', icon: Users },
      { id: 'academy-structure', labelKey: 'academyConfiguration', href: '/admin/academy-settings', icon: SlidersHorizontal },
      { id: 'sales-management', labelKey: 'salesSettings', href: '/admin/sales-settings', icon: UserCheck },
      { id: 'system-management', labelKey: 'systemManagement', href: '/admin/system-management', icon: Settings2 },
    ],
  },
  sales: {
    nameKey: 'salesModule',
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
    icon: Megaphone,
    items: [
      { id: 'overview', labelKey: 'marketingOverviewTitle', href: '/marketing-module', icon: BarChart3 },
      { id: 'sources', labelKey: 'leadSources', href: '/marketing-module/sources', icon: Megaphone },
      { id: 'funnel', labelKey: 'marketingFunnelSection', href: '/marketing-module/funnel', icon: Flame },
      { id: 'meta-attribution', labelKey: 'metaAttribution', href: '/marketing-module/meta-attribution', icon: MousePointerClick },
      { id: 'meta-events', labelKey: 'metaEventManager', href: '/marketing-module/meta-events', icon: RadioTower },
    ],
  },
  finance: {
    nameKey: 'financeModule',
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
  icon: LucideIcon;
  items: readonly ModuleNavigationItem[];
}>;

export const TASKS_NAVIGATION_ITEM = {
  id: 'tasks',
  labelKey: 'taskBoard',
  href: '/tasks',
  icon: KanbanSquare,
} as const satisfies ModuleNavigationItem;

export const SYSTEM_MANAGEMENT_NAVIGATION_ITEMS = [
  { id: 'integrations', labelKey: 'navIntegrations', href: '/admin/system-management/integrations', icon: Plug },
  { id: 'employee-notifications', labelKey: 'employeeNotifications', href: '/admin/system-management/employee-notifications', icon: BellRing },
  { id: 'audit', labelKey: 'auditLog', href: '/admin/system-management/audit', icon: ClipboardList },
] as const satisfies readonly ModuleNavigationItem[];

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
