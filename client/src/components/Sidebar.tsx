import { Link, useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getInitials,
  formatUserRole,
  canAccessReports,
  canAccessAnalytics,
  canAccessAdmin,
  canAccessFinance,
  canAccessOperations,
  canAccessMarketing
} from '@/lib/auth';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Logo from '@/components/Logo';
import {
  BarChart3,
  Calendar,
  ChartBar,
  Settings,
  Users,
  X,
  GraduationCap,
  BookOpen,
  Layers3,
  ClipboardCheck,
  Banknote,
  AlertTriangle,
  HeartHandshake,
  Plug,
  UserRoundCheck,
  Flame,
  Megaphone,
} from 'lucide-react';

interface NavSection {
  label: string;
  items: Array<{
    name: string;
    href: string;
    icon: any;
    requiresDocAccess?: boolean;
    requiresArchiveAccess?: boolean;
    requiresAnalyticsAccess?: boolean;
    requiresAdminAccess?: boolean;
    requiresFinanceAccess?: boolean;
    requiresOperationsAccess?: boolean;
    requiresMarketingAccess?: boolean;
  }>;
}

export default function Sidebar({ onClose }: { onClose?: () => void }) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation();

  if (!user) return null;

  const sections: NavSection[] = [
    {
      label: t('sectionMain'),
      items: [
        { name: t('navDashboard'), href: '/', icon: BarChart3 },
        { name: t('navLeads'), href: '/leads', icon: Users },
        { name: t('navPipeline'), href: '/pipeline', icon: Flame },
        { name: t('navStudents'), href: '/students', icon: GraduationCap },
        { name: t('navCourses'), href: '/courses', icon: BookOpen },
        { name: t('navGroups'), href: '/groups', icon: Layers3, requiresOperationsAccess: true },
        { name: t('navLessons'), href: '/lessons', icon: Calendar, requiresOperationsAccess: true },
        { name: t('navAttendance'), href: '/attendance', icon: ClipboardCheck, requiresOperationsAccess: true },
      ],
    },
    {
      label: t('sectionOperationsFinance'),
      items: [
        { name: t('navTeachers'), href: '/teachers', icon: UserRoundCheck, requiresOperationsAccess: true },
        { name: t('navPayments'), href: '/payments', icon: Banknote, requiresFinanceAccess: true },
        { name: t('navFinance'), href: '/finance', icon: ChartBar, requiresFinanceAccess: true },
        { name: t('navRisks'), href: '/risks', icon: AlertTriangle },
        { name: t('navWarmBase'), href: '/warm-base', icon: Megaphone, requiresMarketingAccess: true },
        { name: t('navReferrals'), href: '/referrals', icon: HeartHandshake },
      ],
    },
    {
      label: t('sectionSystem'),
      items: [
        { name: t('navAnalytics'), href: '/analytics', icon: ChartBar, requiresAnalyticsAccess: true },
        { name: t('navIntegrations'), href: '/integrations', icon: Plug },
        { name: t('navSettings'), href: '/settings', icon: Settings },
        { name: t('administration'), href: '/admin', icon: Settings, requiresAdminAccess: true },
      ],
    },
  ];

  const canAccess = (item: NavSection['items'][0]) => {
    if (item.requiresAnalyticsAccess && !canAccessAnalytics(user)) return false;
    if (item.requiresAdminAccess && !canAccessAdmin(user)) return false;
    if (item.requiresFinanceAccess && !canAccessFinance(user)) return false;
    if (item.requiresOperationsAccess && !canAccessOperations(user)) return false;
    if (item.requiresMarketingAccess && !canAccessMarketing(user)) return false;
    return true;
  };

  return (
    <div className="w-64 bg-white shadow-sm border-r border-slate-200 flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center px-6 py-4 border-b border-slate-200">
        <div className="flex items-center w-full">
          <Logo size="md" />
          <div className="ml-3 flex flex-col flex-1 min-w-0">
            <span className="text-xl font-semibold text-slate-900 truncate">
              {'01 Academy'}
            </span>
            <span className="text-xs text-gray-500">{t('schoolCrm')}</span>
          </div>
          {/* Mobile close button */}
          {onClose && (
            <button
              onClick={onClose}
              className="md:hidden ml-2 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Navigation — Grouped by Sections */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {sections.map((section) => {
          const visibleItems = section.items.filter(canAccess);
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.label}>
              <div className="sidebar-section-label">{section.label}</div>
              <div className="sidebar-nav">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.href === '/' ? location === '/' : location.startsWith(item.href);

                  return (
                    <Link key={item.name} href={item.href}>
                      <div
                        onClick={() => onClose?.()}
                        className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                      >
                        <Icon className="sidebar-nav-item__icon" />
                        {item.name}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Language Switcher */}
      <div className="px-4 py-2 border-t border-slate-200">
        <LanguageSwitcher />
      </div>

      {/* User Profile */}
      <div className="px-3 py-3 border-t border-slate-200">
        <div className="sidebar-user-card">
          <div className="sidebar-user-avatar">
            {getInitials(user.fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900 truncate">{user.fullName}</p>
            <p className="text-xs text-slate-500 truncate">{formatUserRole(user.role)}</p>
            {canAccessReports(user) && (
              <p className="text-[10px] text-emerald-600">{t('reportsAccess')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
