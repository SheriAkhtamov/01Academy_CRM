import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
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
import {
  BarChart3,
  BookOpen,
  Calendar,
  ClipboardCheck,
  Flame,
  GraduationCap,
  HeartHandshake,
  Layers3,
  Megaphone,
  Search,
  Settings,
  Users,
  UserRoundCheck,
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

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data?: {
    leads?: any[];
    students?: any[];
    courses?: any[];
    groups?: any[];
    teachers?: any[];
    sources?: any[];
  };
}

export function CommandPalette({ open, onOpenChange, data }: CommandPaletteProps) {
  const { t } = useTranslation();
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
    () => [
      { id: 'nav-dashboard', type: t('navDashboard'), title: t('navDashboard'), href: '/', icon: BarChart3 },
      { id: 'nav-leads', type: t('navLeads'), title: t('navLeads'), href: '/leads', icon: Users },
      { id: 'nav-pipeline', type: t('navPipeline'), title: t('navPipeline'), href: '/pipeline', icon: Flame },
      { id: 'nav-students', type: t('navStudents'), title: t('navStudents'), href: '/students', icon: GraduationCap },
      { id: 'nav-courses', type: t('navCourses'), title: t('navCourses'), href: '/courses', icon: BookOpen },
      { id: 'nav-groups', type: t('navGroups'), title: t('navGroups'), href: '/groups', icon: Layers3 },
      { id: 'nav-lessons', type: t('navLessons'), title: t('navLessons'), href: '/lessons', icon: Calendar },
      { id: 'nav-attendance', type: t('navAttendance'), title: t('navAttendance'), href: '/attendance', icon: ClipboardCheck },
      { id: 'nav-teachers', type: t('navTeachers'), title: t('navTeachers'), href: '/teachers', icon: UserRoundCheck },
      { id: 'nav-finance', type: t('navFinance'), title: t('navFinance'), href: '/finance', icon: BarChart3 },
      { id: 'nav-analytics', type: t('navAnalytics'), title: t('navAnalytics'), href: '/analytics', icon: BarChart3 },
      { id: 'nav-referrals', type: t('navReferrals'), title: t('navReferrals'), href: '/referrals', icon: HeartHandshake },
      { id: 'nav-warm-base', type: t('navWarmBase'), title: t('navWarmBase'), href: '/warm-base', icon: Megaphone },
      { id: 'nav-settings', type: t('navSettings'), title: t('navSettings'), href: '/settings', icon: Settings },
    ],
    [t]
  );

  const entityItems: SearchItem[] = useMemo(() => {
    const items: SearchItem[] = [];
    (data?.leads ?? []).forEach((lead) => {
      items.push({
        id: `lead-${lead.id}`,
        type: t('typeLead'),
        title: lead.contactName || t('noData'),
        subtitle: [lead.phone, lead.studentName, lead.courseName].filter(Boolean).join(' • '),
        href: '/leads',
        icon: Users,
        keywords: [lead.contactName, lead.phone, lead.studentName, lead.messenger].filter(Boolean).join(' '),
      });
    });
    (data?.students ?? []).forEach((student) => {
      items.push({
        id: `student-${student.id}`,
        type: t('typeStudent'),
        title: student.studentName || t('noData'),
        subtitle: [student.contactName, student.phone, student.groupName].filter(Boolean).join(' • '),
        href: '/students',
        icon: GraduationCap,
        keywords: [student.studentName, student.contactName, student.phone, student.referralCode].filter(Boolean).join(' '),
      });
    });
    (data?.courses ?? []).forEach((course) => {
      items.push({
        id: `course-${course.id}`,
        type: t('typeCourse'),
        title: course.name,
        subtitle: course.ageCategory,
        href: '/courses',
        icon: BookOpen,
        keywords: [course.name, course.slug, course.ageCategory].filter(Boolean).join(' '),
      });
    });
    (data?.groups ?? []).forEach((group) => {
      items.push({
        id: `group-${group.id}`,
        type: t('typeGroup'),
        title: group.name,
        subtitle: [group.courseName, group.teacherName].filter(Boolean).join(' • '),
        href: '/groups',
        icon: Layers3,
        keywords: [group.name, group.courseName, group.teacherName].filter(Boolean).join(' '),
      });
    });
    (data?.teachers ?? []).forEach((teacher) => {
      items.push({
        id: `teacher-${teacher.id}`,
        type: t('typeTeacher'),
        title: teacher.fullName,
        subtitle: teacher.status,
        href: '/teachers',
        icon: UserRoundCheck,
        keywords: teacher.fullName,
      });
    });
    return items;
  }, [data, t]);

  const normalizedSearch = search.trim().toLowerCase();

  const filteredNavigation = useMemo(() => {
    if (!normalizedSearch) return [];
    return navigationItems.filter(
      (item) =>
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.type.toLowerCase().includes(normalizedSearch)
    );
  }, [navigationItems, normalizedSearch]);

  const filteredEntities = useMemo(() => {
    if (!normalizedSearch) return [];
    return entityItems
      .filter(
        (item) =>
          item.title.toLowerCase().includes(normalizedSearch) ||
          (item.subtitle && item.subtitle.toLowerCase().includes(normalizedSearch)) ||
          (item.keywords && item.keywords.toLowerCase().includes(normalizedSearch))
      )
      .slice(0, 8);
  }, [entityItems, normalizedSearch]);

  const handleSelect = (href: string) => {
    onOpenChange(false);
    setSearch('');
    setLocation(href);
  };

  const showNavigation = filteredNavigation.length > 0;
  const showEntities = filteredEntities.length > 0;

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
        {normalizedSearch && !showNavigation && !showEntities && (
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
