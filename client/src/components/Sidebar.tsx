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
  canAccessMarketing,
} from '@/lib/auth';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Logo from '@/components/Logo';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
  ChevronDown,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

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
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

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

  const toggleSection = (label: string) => {
    setCollapsedSections((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="w-64 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-r border-slate-200/70 dark:border-slate-800/70 flex flex-col h-full">
        {/* Logo */}
        <div className="flex items-center px-5 py-4 border-b border-slate-200/70 dark:border-slate-800/70">
          <div className="flex items-center w-full">
            <Logo size="md" />
            <div className="ml-3 flex flex-col flex-1 min-w-0">
              <span className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate tracking-tight leading-tight">
                {'01 Academy'}
              </span>
              <span className="text-xs text-slate-400">{t('schoolCrm')}</span>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="md:hidden ml-2 p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto overflow-x-hidden">
          {sections.map((section) => {
            const visibleItems = section.items.filter(canAccess);
            if (visibleItems.length === 0) return null;
            const isCollapsed = collapsedSections[section.label];

            return (
              <div key={section.label} className="mb-2">
                <button
                  onClick={() => toggleSection(section.label)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-500 transition-colors"
                >
                  <span>{section.label}</span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 transition-transform duration-200',
                      isCollapsed && '-rotate-90'
                    )}
                  />
                </button>
                <div
                  className={cn(
                    'space-y-0.5 overflow-hidden transition-all duration-200',
                    isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[500px] opacity-100'
                  )}
                >
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.href === '/' ? location === '/' : location.startsWith(item.href);

                    return (
                      <Tooltip key={item.name}>
                        <TooltipTrigger asChild>
                          <Link href={item.href}>
                            <div
                              onClick={() => onClose?.()}
                              className={cn(
                                'sidebar-nav-item group',
                                isActive && 'active'
                              )}
                            >
                              <Icon className="sidebar-nav-item__icon" />
                              <span className="truncate">{item.name}</span>
                              {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary-600" />}
                            </div>
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="hidden md:block">
                          {item.name}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Language Switcher */}
        <div className="px-4 py-2 border-t border-slate-200/70 dark:border-slate-800/70">
          <LanguageSwitcher />
        </div>

        {/* User Profile */}
        <div className="px-3 py-3 border-t border-slate-200/70 dark:border-slate-800/70">
          <div className="sidebar-user-card">
            <div className="sidebar-user-avatar">
              {getInitials(user.fullName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{user.fullName}</p>
              <p className="text-xs text-slate-500 truncate">{formatUserRole(user.role)}</p>
              {canAccessReports(user) && (
                <p className="text-[10px] text-emerald-600">{t('reportsAccess')}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
