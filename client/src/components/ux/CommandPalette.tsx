import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { searchAcademy } from '@/features/search/api';
import { academySearchTypes, type AcademySearchType } from '@shared/contracts/academy-search';
import { formatUserModule } from '@/lib/auth';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  AlertCircle,
  BookOpen,
  Flame,
  GraduationCap,
  Layers3,
  Loader2,
  Megaphone,
  Search,
  Users,
  UserRoundCheck,
} from 'lucide-react';
import {
  canAccessAcademyModule,
  hasFinanceAccess,
  hasLeadershipAccess,
  type AcademyAccessModule,
  type AcademyModule,
} from '@shared/academy';
import { MODULE_NAVIGATION, TASKS_NAVIGATION_ITEM } from '@/lib/moduleNavigation';

interface SearchItem {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  keywords?: string;
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
  const [searchType, setSearchType] = useState<AcademySearchType | 'all'>('all');

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', down, { capture: true });
    return () => document.removeEventListener('keydown', down, { capture: true });
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setSearchType('all');
    }
  }, [open]);

  const navigationItems: SearchItem[] = useMemo(
    () => {
      const hasModule = (module: AcademyModule) => canAccessAcademyModule(user, module);
      const visibleModules: AcademyAccessModule[] = [
        'administration',
        'finance',
        'sales',
        'teacher',
        'marketing',
      ];

      const moduleItems = visibleModules.flatMap((module) => {
        const canOpen = module === 'finance' ? hasFinanceAccess(user) : hasModule(module);
        if (!canOpen) return [];
        const definition = MODULE_NAVIGATION[module];
        return definition.items.map((item) => ({
          id: `nav-${module}-${item.id}`,
          type: t(definition.nameKey),
          title: t(module === 'sales' && item.id === 'clients' && hasLeadershipAccess(user)
            ? 'allClients'
            : item.labelKey),
          href: item.href,
          icon: item.icon,
        }));
      });

      return [
        ...moduleItems,
        {
          id: 'nav-tasks',
          type: t(TASKS_NAVIGATION_ITEM.labelKey),
          title: t(TASKS_NAVIGATION_ITEM.labelKey),
          href: TASKS_NAVIGATION_ITEM.href,
          icon: TASKS_NAVIGATION_ITEM.icon,
        },
      ];
    },
    [t, user]
  );

  const normalizedSearch = search.trim().toLowerCase();
  // Defer the term that reaches the network so a fast typist does not fire one
  // search request per keystroke; the local navigation filter stays instant.
  const queriedSearch = useDeferredValue(normalizedSearch);

  const searchQuery = useInfiniteQuery({
    queryKey: ['academy-search', queriedSearch, searchType],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => searchAcademy(queriedSearch, searchType, pageParam),
    getNextPageParam: (lastPage, _pages, offset) => lastPage.hasMore ? offset + (searchType === 'all' ? 3 : 8) : undefined,
    enabled: open && queriedSearch.length >= 2,
    staleTime: 30_000,
    retry: 1,
  });
  const serverResults = [...new Map((searchQuery.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.id, item])).values()];
  const isFetching = searchQuery.isFetching;
  const searchError = searchQuery.isError;
  const availableTypes = academySearchTypes.filter((type) => {
    if (type === 'user') return hasLeadershipAccess(user);
    if (type === 'source') return canAccessAcademyModule(user, 'marketing');
    if (type === 'lead') return canAccessAcademyModule(user, 'sales');
    if (type === 'student') return canAccessAcademyModule(user, 'sales') || canAccessAcademyModule(user, 'teacher');
    return canAccessAcademyModule(user, 'teacher');
  });

  const iconForEntity = (entityType: string) => {
    const icons: Record<string, React.ComponentType<{ className?: string }>> = {
      lead: Flame,
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

  const entityItems: SearchItem[] = serverResults.map((item) => ({
    id: item.id, type: labelForEntity(item.entityType), title: item.title || t('noData'),
    subtitle: [item.subtitle, item.module ? formatUserModule(item.module, t) : '', item.isArchived ? t('leadArchive') : ''].filter(Boolean).join(' · '),
    href: item.href, icon: iconForEntity(item.entityType),
  }));

  const filteredNavigation = useMemo(() => {
    if (!normalizedSearch) return [];
    return navigationItems.filter(
      (item) =>
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.type.toLowerCase().includes(normalizedSearch)
    );
  }, [navigationItems, normalizedSearch]);

  const filteredEntities = normalizedSearch.length >= 2 && normalizedSearch === queriedSearch ? entityItems : [];

  const handleSelect = (href: string) => {
    onOpenChange(false);
    setSearch('');
    setLocation(href);
  };

  const showNavigation = filteredNavigation.length > 0;
  const showEntities = filteredEntities.length > 0;
  // While the deferred term lags behind what is typed, the request has not been
  // issued yet — treat that as "still searching" so "nothing found" cannot flash.
  const searchPending = isFetching || normalizedSearch !== queriedSearch;
  const showSearching = normalizedSearch.length >= 2 && searchPending && !showEntities;
  // A failed search must not read as "no results" — that makes people believe
  // the record does not exist when the endpoint simply errored.
  const showSearchError = normalizedSearch.length >= 2
    && !searchPending
    && searchError;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <CommandInput
        placeholder={t('commandPalettePlaceholder')}
        value={search}
        onValueChange={setSearch}
      />
      <div className="border-b p-2">
        <Select value={searchType} onValueChange={(value) => setSearchType(value as AcademySearchType | 'all')}>
          <SelectTrigger aria-label={t('searchEntityType')} className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('searchAllCategories')}</SelectItem>
            {availableTypes.map((type) => <SelectItem key={type} value={type}>{labelForEntity(type)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <CommandList>
        {!normalizedSearch && (
          <CommandEmpty className="py-8 text-center">
            <Search className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
          </CommandEmpty>
        )}
        {normalizedSearch.length === 1 && (
          <CommandEmpty className="py-8 text-center">
            <Search className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
          </CommandEmpty>
        )}
        {showSearching && (
          <CommandEmpty className="py-8 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          </CommandEmpty>
        )}
        {normalizedSearch.length >= 2 && !searchPending && !showNavigation && !showEntities && !searchError && (
          <CommandEmpty>{t('noSearchResults')}</CommandEmpty>
        )}
        {showSearchError && (
          <div role="alert" className="py-4 text-center">
            <AlertCircle className="mx-auto h-6 w-6 text-destructive mb-2" />
            <p className="text-sm text-destructive">{t('failedToLoadData')}</p>
            <CommandItem value="retry-search" onSelect={() => void searchQuery.refetch()}>{t('retry')}</CommandItem>
          </div>
        )}
        {showNavigation && (
          <CommandGroup heading={t('navigation')}>
            {filteredNavigation.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => handleSelect(item.href)}
                  className="cursor-pointer"
                >
                  {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <div className="min-w-0">
                    <p className="truncate">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.type}</p>
                  </div>
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
                  value={item.id}
                  onSelect={() => handleSelect(item.href)}
                  className="cursor-pointer flex items-center gap-2"
                >
                  {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="truncate font-medium">{item.title}</span>
                    {item.subtitle && (
                      <span className="text-xs text-muted-foreground truncate">{item.subtitle}</span>
                    )}
                  </div>
                  <span className="ml-auto text-xs text-muted-foreground/70 shrink-0 pl-2">{item.type}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {normalizedSearch.length >= 2 && searchQuery.hasNextPage ? (
          <CommandItem value="load-more-results" disabled={searchQuery.isFetchingNextPage} onSelect={() => void searchQuery.fetchNextPage()}>
            {searchQuery.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('loadMoreResults')}
          </CommandItem>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
