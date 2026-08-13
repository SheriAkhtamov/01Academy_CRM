import { Link, useLocation } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
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
import { DURATION, EASE, SPRING } from '@/lib/motion';
import { StaggerGroup, StaggerItem } from '@/components/ux/motion';
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
  /** Stable across languages — the label is translated and cannot key state. */
  id: string;
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
      ? { sales: true, teacher: true, marketing: true, administration: true }
      : {} as Record<string, boolean>
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
        id: module,
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

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
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
              {/*
                One highlight element shared by every nav item: because they all
                carry the same `layoutId`, framer animates the single instance
                from the old item to the new one, so the selection appears to
                travel down the sidebar instead of blinking out and back in.
                The edge bar is nested inside it and therefore travels too.
              */}
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-highlight"
                  className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-r from-primary-50 to-primary-100"
                  transition={SPRING.snappy}
                >
                  <span
                    className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary-600"
                    style={{ boxShadow: '0 0 10px 0 var(--primary-glow)' }}
                  />
                </motion.span>
              )}
              <Icon className="sidebar-nav-item__icon" />
              <span className="truncate">{item.name}</span>
              <UnreadCountBadge
                count={item.badgeCount ?? 0}
                label={item.badgeLabel ?? item.name}
                className="ml-auto ring-card"
              />
              {isActive && !item.badgeCount && (
                <motion.span
                  layoutId="sidebar-active-dot"
                  className="ml-auto h-1.5 w-1.5 rounded-full bg-primary-600"
                  transition={SPRING.snappy}
                />
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
        <StaggerGroup
          count={sections.length + 1}
          className="flex-1 px-3 py-4 overflow-y-auto overflow-x-hidden"
          // A <nav> landmark is what screen readers navigate by; StaggerGroup
          // renders a plain div, so the role has to be restated here.
          role="navigation"
        >
          {sections.map((section) => {
            const visibleItems = section.items;
            if (visibleItems.length === 0) return null;
            const isCollapsed = collapsedSections[section.id];

            return (
              <StaggerItem key={section.id} className="mb-2">
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-500 transition-colors"
                  aria-expanded={!isCollapsed}
                >
                  <span>{section.label}</span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 transition-transform duration-200 ease-out-expo',
                      isCollapsed && '-rotate-90'
                    )}
                  />
                </button>
                {/*
                  A collapsed section is unmounted rather than hidden. Height
                  alone would leave the links in the tab order — the previous
                  fix for that was an `invisible` class, but AnimatePresence
                  gives the same guarantee and animates the real height, so a
                  section with three items and one with eight no longer share
                  a made-up max-height.
                */}
                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      className="space-y-0.5 overflow-hidden"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: DURATION.base, ease: EASE.out }}
                    >
                      {visibleItems.map((item) => renderNavItem(item))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </StaggerItem>
            );
          })}
          <StaggerItem className="mt-3 border-t border-border/70 pt-3">
            {renderNavItem(taskBoardItem)}
          </StaggerItem>
        </StaggerGroup>

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
