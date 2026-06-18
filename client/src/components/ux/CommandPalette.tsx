import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import {
  BarChart3,
  BookOpen,
  Calendar,
  ClipboardCheck,
  Flame,
  GraduationCap,
  HeartHandshake,
  Layers3,
  Loader2,
  Megaphone,
  Search,
  Settings,
  Users,
  UserRoundCheck,
  ListChecks,
  Star,
  Wallet,
  FileText,
  AlertTriangle,
  UserCircle,
} from 'lucide-react';

interface SearchItem {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  keywords?: string;
}

interface ServerSearchItem {
  id: string;
  entityType: string;
  title: string;
  subtitle?: string;
  href: string;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  const navigationItems: SearchItem[] = useMemo(
    () => {
      switch (user?.role) {
        case 'admin':
        case 'head':
          return [
            { id: 'nav-admin-reports', type: t('systemAdministration'), title: t('reportsActivityLogs'), href: '/admin', icon: FileText },
            { id: 'nav-employees', type: t('employees'), title: t('employees'), href: '/employees', icon: Users },
            { id: 'nav-integrations', type: t('navIntegrations'), title: t('navIntegrations'), href: '/integrations', icon: Settings },
            { id: 'nav-settings', type: t('settings'), title: t('settings'), href: '/settings', icon: Settings },
          ];
        case 'account_manager':
          return [
            { id: 'nav-sales', type: t('salesPipeline'), title: t('navDashboard'), href: '/sales', icon: BarChart3 },
            { id: 'nav-sales-leads', type: t('myLeads'), title: t('myLeads'), href: '/sales/leads', icon: Users },
            { id: 'nav-sales-pipeline', type: t('pipeline'), title: t('pipeline'), href: '/sales/pipeline', icon: Flame },
            { id: 'nav-sales-students', type: t('myStudents'), title: t('myStudents'), href: '/sales/clients', icon: GraduationCap },
            { id: 'nav-sales-tasks', type: t('myTasks'), title: t('myTasks'), href: '/sales/tasks', icon: ListChecks },
          ];
        case 'teacher':
          return [
            { id: 'nav-teacher', type: t('teacherWorkspace'), title: t('teacherWorkspace'), href: '/teacher-workspace', icon: GraduationCap },
            { id: 'nav-teacher-schedule', type: t('schedule'), title: t('schedule'), href: '/teacher-workspace/schedule', icon: Calendar },
            { id: 'nav-teacher-groups', type: t('myGroups'), title: t('myGroups'), href: '/teacher-workspace/groups', icon: Layers3 },
            { id: 'nav-teacher-attendance', type: t('attendanceLabel'), title: t('attendanceLabel'), href: '/teacher-workspace/attendance', icon: ClipboardCheck },
            { id: 'nav-teacher-ratings', type: t('lessonRatings'), title: t('lessonRatings'), href: '/teacher-workspace/ratings', icon: Star },
            { id: 'nav-teacher-profile', type: t('myProfile'), title: t('myProfile'), href: '/teacher-workspace/profile', icon: UserCircle },
          ];
        case 'operations_director':
          return [
            { id: 'nav-analytics', type: t('navAnalytics'), title: t('navDashboard'), href: '/analytics-workspace', icon: BarChart3 },
            { id: 'nav-analytics-funnel', type: t('salesPipeline'), title: t('salesPipeline'), href: '/analytics-workspace/funnel', icon: Flame },
            { id: 'nav-analytics-courses', type: t('byCourses'), title: t('byCourses'), href: '/analytics-workspace/courses', icon: BookOpen },
            { id: 'nav-analytics-sources', type: t('bySources'), title: t('bySources'), href: '/analytics-workspace/sources', icon: Megaphone },
            { id: 'nav-analytics-teachers', type: t('navTeachers'), title: t('navTeachers'), href: '/analytics-workspace/teachers', icon: UserRoundCheck },
            { id: 'nav-analytics-groups', type: t('navGroups'), title: t('navGroups'), href: '/analytics-workspace/groups', icon: Layers3 },
            { id: 'nav-analytics-risks', type: t('navRisks'), title: t('navRisks'), href: '/analytics-workspace/risks', icon: AlertTriangle },
            { id: 'nav-analytics-cohorts', type: t('cohortsTab'), title: t('cohortsTab'), href: '/analytics-workspace/cohorts', icon: Users },
          ];
        case 'smm_manager':
          return [
            { id: 'nav-marketing', type: t('marketingTab'), title: t('navDashboard'), href: '/marketing-workspace', icon: BarChart3 },
            { id: 'nav-marketing-sources', type: t('leadSources'), title: t('leadSources'), href: '/marketing-workspace/sources', icon: Megaphone },
            { id: 'nav-marketing-funnel', type: t('conversionFunnel'), title: t('conversionFunnel'), href: '/marketing-workspace/funnel', icon: Flame },
            { id: 'nav-marketing-warm', type: t('warmBase'), title: t('warmBase'), href: '/marketing-workspace/warm-base', icon: Users },
            { id: 'nav-marketing-referrals', type: t('navReferrals'), title: t('navReferrals'), href: '/marketing-workspace/referrals', icon: HeartHandshake },
            { id: 'nav-marketing-expenses', type: t('expenses'), title: t('expenses'), href: '/marketing-workspace/expenses', icon: Wallet },
            { id: 'nav-marketing-reports', type: t('reports'), title: t('reports'), href: '/marketing-workspace/reports', icon: FileText },
          ];
        default:
          return [];
      }
    },
    [t, user?.role]
  );

  const normalizedSearch = search.trim().toLowerCase();

  const { data: serverResults = [], isFetching } = useQuery<ServerSearchItem[]>({
    queryKey: ['academy-search', normalizedSearch],
    queryFn: () => apiRequest('GET', `/api/academy/search?q=${encodeURIComponent(normalizedSearch)}&limit=8`),
    enabled: open && normalizedSearch.length >= 2,
    staleTime: 30_000,
  });

  const iconForEntity = (entityType: string) => {
    const icons: Record<string, React.ComponentType<{ className?: string }>> = {
      lead: Users,
      student: GraduationCap,
      course: BookOpen,
      group: Layers3,
      teacher: UserRoundCheck,
      source: Megaphone,
      user: Users,
    };
    return icons[entityType] ?? Search;
  };

  const labelForEntity = (entityType: string) => {
    const labels: Record<string, string> = {
      lead: t('lead'),
      student: t('student'),
      course: t('course'),
      group: t('group'),
      teacher: t('teacher'),
      source: t('leadSources'),
      user: t('employees'),
    };
    return labels[entityType] ?? entityType;
  };

  const entityItems: SearchItem[] = useMemo(
    () =>
      serverResults.map((item) => ({
        id: item.id,
        type: labelForEntity(item.entityType),
        title: item.title || t('noData'),
        subtitle: item.subtitle,
        href: item.href,
        icon: iconForEntity(item.entityType),
      })),
    [serverResults, t]
  );

  const filteredNavigation = useMemo(() => {
    if (!normalizedSearch) return [];
    return navigationItems.filter(
      (item) =>
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.type.toLowerCase().includes(normalizedSearch)
    );
  }, [navigationItems, normalizedSearch]);

  const filteredEntities = normalizedSearch.length >= 2 ? entityItems : [];

  const handleSelect = (href: string) => {
    onOpenChange(false);
    setSearch('');
    setLocation(href);
  };

  const showNavigation = filteredNavigation.length > 0;
  const showEntities = filteredEntities.length > 0;
  const showSearching = normalizedSearch.length >= 2 && isFetching && !showEntities;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={t('commandPalettePlaceholder')}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        {!normalizedSearch && (
          <CommandEmpty className="py-8 text-center">
            <Search className="mx-auto h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">{t('commandPaletteHint')}</p>
          </CommandEmpty>
        )}
        {normalizedSearch.length === 1 && (
          <CommandEmpty className="py-8 text-center">
            <Search className="mx-auto h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">{t('commandPaletteHint')}</p>
          </CommandEmpty>
        )}
        {showSearching && (
          <CommandEmpty className="py-8 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400 mb-2" />
            <p className="text-sm text-slate-500">{t('loading')}</p>
          </CommandEmpty>
        )}
        {normalizedSearch.length >= 2 && !isFetching && !showNavigation && !showEntities && (
          <CommandEmpty>{t('noSearchResults')}</CommandEmpty>
        )}
        {showNavigation && (
          <CommandGroup heading={t('navigation')}>
            {filteredNavigation.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.id}
                  onSelect={() => handleSelect(item.href)}
                  className="cursor-pointer"
                >
                  {Icon && <Icon className="h-4 w-4 text-slate-500" />}
                  <span>{item.title}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {showNavigation && showEntities && <CommandSeparator />}
        {showEntities && (
          <CommandGroup heading={t('searchResults')}>
            {filteredEntities.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.id}
                  onSelect={() => handleSelect(item.href)}
                  className="cursor-pointer"
                >
                  {Icon && <Icon className="h-4 w-4 text-slate-500" />}
                  <div className="flex flex-col min-w-0">
                    <span className="truncate">{item.title}</span>
                    {item.subtitle && (
                      <span className="text-xs text-slate-500 truncate">{item.subtitle}</span>
                    )}
                  </div>
                  <span className="ml-auto text-xs text-slate-400 shrink-0">{item.type}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
