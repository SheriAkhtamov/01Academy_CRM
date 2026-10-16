import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import {
  canAccessAcademyModule,
  hasFinanceAccess,
  hasLeadershipAccess,
  type AcademyAccessModule,
  type AcademyModule,
} from '@shared/academy';
import { GraduationCap, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlatformSidebar, type PlatformSidebarItem } from '@/components/ux/PlatformSidebar';
import { unviewedLeadCountQueryOptions } from '@/features/leads/api';
import { missedCallUnreadQueryOptions } from '@/features/telephony/api';
import { boardApi, boardQueryKeys } from '@/features/board/api';
import { instagramInboxUnreadQueryOptions } from '@/features/sales/instagram-inbox-api';
import { MODULE_NAVIGATION, RESOURCE_NAVIGATION_ITEMS, TASKS_NAVIGATION_ITEM } from '@/lib/moduleNavigation';
import { useStickyState } from '@/hooks/useStickyState';
import { learningCapabilitiesQuery } from '@/features/learning-rollout/api';

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

export default function Sidebar({ onClose, isOpen }: { onClose?: () => void; isOpen?: boolean }) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { data: learningCapabilities } = useQuery({ ...learningCapabilitiesQuery, enabled: Boolean(user) });
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
  const { data: inboxUnread = { count: 0 } } = useQuery({
    ...instagramInboxUnreadQueryOptions,
    enabled: hasSalesModule,
  });
  const inboxMessageCount = Number(inboxUnread.count) || 0;
  const inboxMessagesLabel = t('newInboxMessagesCount')
    .replace('{count}', String(inboxMessageCount));
  const { data: pendingAcceptance = { count: 0 } } = useQuery({
    queryKey: boardQueryKeys.pendingAcceptanceCount,
    queryFn: boardApi.getPendingAcceptanceCount,
    enabled: Boolean(user),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const pendingAcceptanceCount = Number(pendingAcceptance.count) || 0;
  const pendingAcceptanceLabel = t('tasksPendingAcceptanceCount')
    .replace('{count}', String(pendingAcceptanceCount));
  const [collapsedSections, setCollapsedSections] = useStickyState<Record<string, boolean>>(
    'sidebar-collapsed-sections',
    location.startsWith('/finance')
      ? { sales: true, teacher: true, marketing: true, administration: true }
      : {},
  );

  if (!user) return null;

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
    // `/` renders the active module's overview page, so highlight that
    // module's overview item — otherwise the landing screen shows no active
    // nav item at all.
    if (currentPath === '/' && user.module) {
      return hrefPath === MODULE_NAVIGATION[user.module]?.items[0]?.href;
    }
    if (href === '/admin/sales-settings') {
      return currentPath === href || currentPath === '/admin/leads';
    }
    if (href === '/admin/academy-settings') {
      const activeTab = currentParams.get('tab');
      return currentPath === href && (!activeTab || !['pipeline', 'kpi'].includes(activeTab));
    }
    if (href === '/admin/system-management') {
      return currentPath === href || currentPath.startsWith(`${href}/`);
    }
    return currentPath === href;
  };

  const buildSections = (): NavSection[] => {
    const moduleSection = (module: AcademyAccessModule): NavSection => {
      const definition = MODULE_NAVIGATION[module];
      return {
        id: module,
        label: t(definition.nameKey),
        items: definition.items.filter((item) => (!['learning','learning-reports'].includes(item.id) || learningCapabilities?.learningEnabled) && (!['learning-settings','learning-access','learning-representatives'].includes(item.id) || learningCapabilities?.portalEnabled)).map((item) => ({
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
          ...(module === 'sales' && item.id === 'inbox'
            ? { badgeCount: inboxMessageCount, badgeLabel: inboxMessagesLabel }
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
      !hasModule('teacher') && !hasModule('administration') && learningCapabilities?.learningEnabled && learningCapabilities.canManageLearning ? {id:'learning',label:t('lmsStaffTitle'),items:[{name:t('lmsStaffTitle'),href:'/learning',icon:GraduationCap}]} : null,
    ].filter((section): section is NavSection => Boolean(section));
  };

  const sections = buildSections();
  const taskBoardItem: NavItem = {
    name: t(TASKS_NAVIGATION_ITEM.labelKey),
    href: TASKS_NAVIGATION_ITEM.href,
    icon: TASKS_NAVIGATION_ITEM.icon,
    badgeCount: pendingAcceptanceCount,
    badgeLabel: pendingAcceptanceLabel,
  };

  const toggleSection = (sectionId: string) => {
    setCollapsedSections({ ...collapsedSections, [sectionId]: !collapsedSections[sectionId] });
  };

  const presentItem = (item: NavItem): PlatformSidebarItem => ({
    id: item.name + item.href,
    label: item.name,
    href: item.href,
    icon: item.icon,
    active: isItemActive(item.href),
    badgeCount: item.badgeCount,
    badgeLabel: item.badgeLabel,
  });

  return (
    <PlatformSidebar
      sections={sections.map((section) => ({ ...section, items: section.items.map(presentItem) }))}
      trailingItems={[presentItem(taskBoardItem)]}
      collapsedSections={collapsedSections}
      onSectionToggle={toggleSection}
      onClose={onClose}
      isOpen={isOpen}
      navigationKey={location}
      footer={(
        <nav
          aria-label={t('sidebarResources')}
          className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 border-t border-border/70 px-3 py-1"
        >
          {RESOURCE_NAVIGATION_ITEMS.map((item) => {
            const isActive = isItemActive(item.href);
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => onClose?.()}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center rounded-sm px-1 text-xs font-medium underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  isActive ? 'text-primary underline' : 'text-muted-foreground',
                )}
              >
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>
      )}
    />
  );
}
