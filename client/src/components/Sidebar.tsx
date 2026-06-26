import { Link, useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getInitials,
  formatUserWorkspace,
  canAccessReports,
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
  Users,
  X,
  GraduationCap,
  Layers3,
  ClipboardCheck,
  Banknote,
  ClipboardList,
  HeartHandshake,
  Plug,
  Flame,
  Megaphone,
  ChevronDown,
  ListChecks,
  UserCircle,
  UserCheck,
  SlidersHorizontal,
  KanbanSquare,
  MessagesSquare,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ceoCopy } from '@/components/ui/ceo-copy';

interface NavItem {
  name: string;
  href: string;
  icon: any;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

export default function Sidebar({ onClose }: { onClose?: () => void }) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  if (!user) return null;

  const { workspace } = user;

  const isItemActive = (href: string) => {
    const currentPath = location.split('?')[0];
    const currentParams = new URLSearchParams(location.split('?')[1] ?? '');
    const [hrefPath, hrefSearch] = href.split('?');

    if (hrefSearch) {
      const hrefParams = new URLSearchParams(hrefSearch);
      return currentPath === hrefPath && hrefParams.get('tab') === currentParams.get('tab');
    }

    if (href === '/') return currentPath === '/';
    if (href === '/admin/sales-settings') {
      return currentPath === href || currentPath === '/admin/leads';
    }
    if (href === '/admin/academy-settings') {
      const activeTab = currentParams.get('tab');
      return currentPath === href && (!activeTab || !['pipeline', 'kpi'].includes(activeTab));
    }
    return currentPath === href;
  };

  const buildSections = (): NavSection[] => {
    const salesSection: NavSection = {
      label: t('salesPipeline'),
      items: [
        { name: t('navDashboard'), href: '/sales', icon: BarChart3 },
        { name: t('pipeline'), href: '/sales/pipeline', icon: Flame },
        { name: t('salesSchedule'), href: '/sales/schedule', icon: Calendar },
        { name: t('myStudents'), href: '/sales/clients', icon: GraduationCap },
        { name: t('myTasks'), href: '/sales/tasks', icon: ListChecks },
        { name: t('messages'), href: '/sales/messages', icon: MessagesSquare },
      ],
    };

    const teacherSection: NavSection = {
      label: t('teacher'),
      items: [
        { name: t('teacherWorkspace'), href: '/teacher-workspace', icon: GraduationCap },
        { name: t('schedule'), href: '/teacher-workspace/schedule', icon: Calendar },
        { name: t('myGroups'), href: '/teacher-workspace/groups', icon: Layers3 },
        { name: t('attendanceLabel'), href: '/teacher-workspace/attendance', icon: ClipboardCheck },
        { name: t('myProfile'), href: '/teacher-workspace/profile', icon: UserCircle },
      ],
    };

    const marketingSection: NavSection = {
      label: t('marketingTab'),
      items: [
        { name: t('navDashboard'), href: '/marketing-workspace', icon: BarChart3 },
        { name: t('leadSources'), href: '/marketing-workspace/sources', icon: Megaphone },
        { name: t('conversionFunnel'), href: '/marketing-workspace/funnel', icon: Flame },
        { name: t('warmBase'), href: '/marketing-workspace/warm-base', icon: Users },
        { name: t('navReferrals'), href: '/marketing-workspace/referrals', icon: HeartHandshake },
        { name: t('expenses'), href: '/marketing-workspace/expenses', icon: Banknote },
      ],
    };

    const systemSection: NavSection = {
      label: t('systemAdministration'),
      items: [
        { name: t('employees'), href: '/employees', icon: Users },
        { name: t('taskBoard'), href: '/admin/tasks', icon: KanbanSquare },
        { name: t('academyConfiguration'), href: '/admin/academy-settings', icon: SlidersHorizontal },
        { name: t('salesSettings'), href: '/admin/sales-settings', icon: UserCheck },
        { name: ceoCopy.workspace.audit, href: '/admin/audit', icon: ClipboardList },
        { name: t('navIntegrations'), href: '/integrations', icon: Plug },
      ],
    };

    if (workspace === 'sales') {
      return [salesSection];
    }

    if (workspace === 'teacher') {
      return [teacherSection];
    }

    if (workspace === 'marketing') {
      return [marketingSection];
    }

    if (workspace === 'administration') {
      return [systemSection];
    }

    if (workspace === 'director') {
      return [
        {
          label: t('directorWorkspace'),
          items: [
            { name: t('adminDashboardTitle'), href: '/admin', icon: BarChart3 },
          ],
        },
        salesSection,
        teacherSection,
        marketingSection,
        systemSection,
      ];
    }

    return [];
  };

  const sections = buildSections();

  const toggleSection = (label: string) => {
    setCollapsedSections((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = isItemActive(item.href);

    return (
      <Tooltip key={item.name + item.href}>
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
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-64 flex-col border-r border-border/70 bg-card/95 backdrop-blur-sm">
        {/* Logo */}
        <div className="flex items-center border-b border-border/70 px-5 py-4">
          <div className="flex items-center w-full">
            <Logo size="md" />
            <div className="ml-3 flex flex-col flex-1 min-w-0">
              <span className="text-lg font-semibold text-slate-900 truncate tracking-tight leading-tight">
                {t('platformName')}
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
            const visibleItems = section.items;
            if (visibleItems.length === 0) return null;
            const isCollapsed = collapsedSections[section.label];

            return (
              <div key={section.label} className="mb-2">
                <button
                  onClick={() => toggleSection(section.label)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-500 transition-colors"
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
                  {visibleItems.map((item) => renderNavItem(item))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Language Switcher */}
        <div className="border-t border-border/70 px-4 py-2">
          <LanguageSwitcher />
        </div>

        {/* User Profile */}
        <div className="border-t border-border/70 px-3 py-3">
          <div className="sidebar-user-card">
            <div className="sidebar-user-avatar">
              {getInitials(user.fullName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900 truncate">{user.fullName}</p>
              <p className="text-xs text-slate-500 truncate">{user.position || formatUserWorkspace(user.workspace, t)}</p>
              {user.position && (
                <p className="text-[10px] text-slate-400 truncate">{formatUserWorkspace(user.workspace, t)}</p>
              )}
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
