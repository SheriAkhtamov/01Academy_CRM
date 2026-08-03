import { useDeferredValue, useEffect, useMemo, useState } from 'react';
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

  const { data: serverResults = [], isFetching } = useQuery<ServerSearchItem[]>({
    queryKey: ['academy-search', queriedSearch],
    queryFn: () => apiRequest('GET', `/api/academy/search?q=${encodeURIComponent(queriedSearch)}&limit=8`),
    enabled: open && queriedSearch.length >= 2,
    staleTime: 30_000,
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
  // While the deferred term lags behind what is typed, the request has not been
  // issued yet — treat that as "still searching" so "nothing found" cannot flash.
  const searchPending = isFetching || normalizedSearch !== queriedSearch;
  const showSearching = normalizedSearch.length >= 2 && searchPending && !showEntities;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <CommandInput
        placeholder={t('commandPalettePlaceholder')}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        {!normalizedSearch && (
          <CommandEmpty className="py-8 text-center">
            <Search className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">{t('commandPaletteHint')}</p>
          </CommandEmpty>
        )}
        {normalizedSearch.length === 1 && (
          <CommandEmpty className="py-8 text-center">
            <Search className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">{t('commandPaletteHint')}</p>
          </CommandEmpty>
        )}
        {showSearching && (
          <CommandEmpty className="py-8 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          </CommandEmpty>
        )}
        {normalizedSearch.length >= 2 && !searchPending && !showNavigation && !showEntities && (
          <CommandEmpty>{t('noSearchResults')}</CommandEmpty>
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
      </CommandList>
    </CommandDialog>
  );
}
