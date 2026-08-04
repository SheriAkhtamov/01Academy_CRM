import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getInitials,
  formatUserModule,
  canAccessReports,
} from '@/lib/auth';
import {
  canAccessAcademyModule,
  getAssignedModules,
  hasFinanceAccess,
  hasLeadershipAccess,
  type AcademyAccessModule,
  type AcademyModule,
} from '@shared/academy';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Logo from '@/components/Logo';
import { UnreadCountBadge } from '@/components/ux/UnreadCountBadge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  X,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { unviewedLeadCountQueryOptions } from '@/features/leads/api';
import { missedCallUnreadQueryOptions } from '@/features/telephony/api';
import { MODULE_NAVIGATION, TASKS_NAVIGATION_ITEM } from '@/lib/moduleNavigation';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  badgeCount?: number;
  badgeLabel?: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

export default function Sidebar({ onClose }: { onClose?: () => void }) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation();
  const hasSalesModule = canAccessAcademyModule(user, 'sales');
  const { data: missedCallUnread = { count: 0 } } = useQuery({
    ...missedCallUnreadQueryOptions,
    enabled: hasSalesModule,
  });
  const missedCallCount = Number(missedCallUnread.count) || 0;
  const missedCallsLabel = t('newMissedCallCount')
    .replace('{count}', String(missedCallCount));
  const { data: unviewedLeads = { count: 0 } } = useQuery({
    ...unviewedLeadCountQueryOptions,
    enabled: hasSalesModule,
  });
  const newLeadCount = Number(unviewedLeads.count) || 0;
  const newLeadsLabel = t('newLeadsCount').replace('{count}', String(newLeadCount));
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => (
    location.startsWith('/finance')
      ? {
          [t(MODULE_NAVIGATION.sales.nameKey)]: true,
          [t(MODULE_NAVIGATION.teacher.nameKey)]: true,
          [t(MODULE_NAVIGATION.marketing.nameKey)]: true,
          [t(MODULE_NAVIGATION.administration.nameKey)]: true,
        }
      : {}
  ));

  if (!user) return null;

  const assignedModules = getAssignedModules(user);
  const additionalModules = assignedModules.filter((module) => module !== user.module);
  const hasModule = (moduleName: AcademyModule) => canAccessAcademyModule(user, moduleName);

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
    const moduleSection = (module: AcademyAccessModule): NavSection => {
      const definition = MODULE_NAVIGATION[module];
      return {
        label: t(definition.nameKey),
        items: definition.items.map((item) => ({
          name: t(module === 'sales' && item.id === 'clients' && hasLeadershipAccess(user)
            ? 'allClients'
            : item.labelKey),
          href: item.href,
          icon: item.icon,
          ...(module === 'sales' && item.id === 'calls'
            ? { badgeCount: missedCallCount, badgeLabel: missedCallsLabel }
            : {}),
          ...(module === 'sales' && item.id === 'pipeline'
            ? { badgeCount: newLeadCount, badgeLabel: newLeadsLabel }
            : {}),
        })),
      };
    };

    return [
      hasModule('sales') ? moduleSection('sales') : null,
      hasModule('teacher') ? moduleSection('teacher') : null,
      hasModule('marketing') ? moduleSection('marketing') : null,
      hasFinanceAccess(user) ? moduleSection('finance') : null,
      hasModule('administration') ? moduleSection('administration') : null,
    ].filter((section): section is NavSection => Boolean(section));
  };

  const sections = buildSections();
  const taskBoardItem: NavItem = {
    name: t(TASKS_NAVIGATION_ITEM.labelKey),
    href: TASKS_NAVIGATION_ITEM.href,
    icon: TASKS_NAVIGATION_ITEM.icon,
  };

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
              <UnreadCountBadge
                count={item.badgeCount ?? 0}
                label={item.badgeLabel ?? item.name}
                className="ml-auto ring-card"
              />
              {isActive && !item.badgeCount && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary-600" />
              )}
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
              <span className="text-lg font-semibold text-foreground truncate tracking-tight leading-tight">
                {t('platformName')}
              </span>
              <span className="text-xs text-muted-foreground">{t('schoolCrm')}</span>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="md:hidden ml-2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label={t('close')}
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
                  aria-expanded={!isCollapsed}
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
          <div className="mt-3 border-t border-border/70 pt-3">
            {renderNavItem(taskBoardItem)}
          </div>
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
              <p className="text-sm font-medium text-foreground truncate">{user.fullName}</p>
              <p className="text-xs text-muted-foreground truncate">{user.position || formatUserModule(user.module, t)}</p>
              {user.position && (
                <p className="text-[10px] text-muted-foreground truncate">{formatUserModule(user.module, t)}</p>
              )}
              {additionalModules.length > 0 && (
                <p className="text-[10px] text-muted-foreground truncate">
                  {additionalModules.map((item) => formatUserModule(item, t)).join(' · ')}
                </p>
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
