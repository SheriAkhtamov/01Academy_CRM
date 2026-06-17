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
            { id: 'nav-admin', type: t('administration'), title: t('administration'), href: '/admin', icon: Settings },
            { id: 'nav-employees', type: t('employees'), title: t('employees'), href: '/employees', icon: Users },
            { id: 'nav-integrations', type: t('navIntegrations'), title: t('navIntegrations'), href: '/integrations', icon: Settings },
            { id: 'nav-settings', type: t('navSettings'), title: t('navSettings'), href: '/settings', icon: Settings },
          ];
        case 'account_manager':
          return [
            { id: 'nav-sales', type: t('salesPipeline'), title: t('navDashboard'), href: '/sales', icon: BarChart3 },
            { id: 'nav-sales-leads', type: t('myLeads'), title: t('myLeads'), href: '/sales?tab=leads', icon: Users },
            { id: 'nav-sales-pipeline', type: t('pipeline'), title: t('pipeline'), href: '/sales?tab=pipeline', icon: Flame },
            { id: 'nav-sales-students', type: t('myStudents'), title: t('myStudents'), href: '/sales?tab=students', icon: GraduationCap },
          ];
        case 'teacher':
          return [
            { id: 'nav-teacher', type: t('teacherWorkspace'), title: t('teacherWorkspace'), href: '/teacher-workspace', icon: GraduationCap },
            { id: 'nav-teacher-schedule', type: t('schedule'), title: t('schedule'), href: '/teacher-workspace?tab=schedule', icon: Calendar },
            { id: 'nav-teacher-groups', type: t('myGroups'), title: t('myGroups'), href: '/teacher-workspace?tab=groups', icon: Layers3 },
            { id: 'nav-teacher-attendance', type: t('attendanceLabel'), title: t('attendanceLabel'), href: '/teacher-workspace?tab=attendance', icon: ClipboardCheck },
          ];
        case 'operations_director':
          return [
            { id: 'nav-analytics', type: t('sectionTitleAnalytics'), title: t('navDashboard'), href: '/analytics-workspace', icon: BarChart3 },
            { id: 'nav-analytics-courses', type: t('byCourses'), title: t('byCourses'), href: '/analytics-workspace?tab=courses', icon: BookOpen },
            { id: 'nav-analytics-teachers', type: t('navTeachers'), title: t('navTeachers'), href: '/analytics-workspace?tab=teachers', icon: UserRoundCheck },
            { id: 'nav-analytics-groups', type: t('navGroups'), title: t('navGroups'), href: '/analytics-workspace?tab=groups', icon: Layers3 },
          ];
        case 'smm_manager':
          return [
            { id: 'nav-marketing', type: t('marketingTab'), title: t('navDashboard'), href: '/marketing-workspace', icon: BarChart3 },
            { id: 'nav-marketing-sources', type: t('leadSources'), title: t('leadSources'), href: '/marketing-workspace?tab=sources', icon: Megaphone },
            { id: 'nav-marketing-funnel', type: t('conversionFunnel'), title: t('conversionFunnel'), href: '/marketing-workspace?tab=funnel', icon: Flame },
            { id: 'nav-marketing-referrals', type: t('referralsTab'), title: t('referralsTab'), href: '/marketing-workspace?tab=referrals', icon: HeartHandshake },
          ];
        default:
          return [];
      }
    },
    [t, user?.role]
  );

  const entityItems: SearchItem[] = useMemo(() => {
    const items: SearchItem[] = [];
    if (!user || user.role === 'admin' || user.role === 'head') {
      return items;
    }
    (data?.leads ?? []).forEach((lead) => {
      if (user.role !== 'account_manager') return;
      items.push({
        id: `lead-${lead.id}`,
        type: t('typeLead'),
        title: lead.contactName || t('noData'),
        subtitle: [lead.phone, lead.studentName, lead.courseName].filter(Boolean).join(' • '),
        href: '/sales?tab=leads',
        icon: Users,
        keywords: [lead.contactName, lead.phone, lead.studentName, lead.messenger].filter(Boolean).join(' '),
      });
    });
    (data?.students ?? []).forEach((student) => {
      if (user.role !== 'account_manager' && user.role !== 'teacher') return;
      items.push({
        id: `student-${student.id}`,
        type: t('typeStudent'),
        title: student.studentName || t('noData'),
        subtitle: [student.contactName, student.phone, student.groupName].filter(Boolean).join(' • '),
        href: user.role === 'teacher' ? '/teacher-workspace?tab=groups' : '/sales?tab=students',
        icon: GraduationCap,
        keywords: [student.studentName, student.contactName, student.phone, student.referralCode].filter(Boolean).join(' '),
      });
    });
    (data?.courses ?? []).forEach((course) => {
      if (user.role !== 'operations_director' && user.role !== 'teacher') return;
      items.push({
        id: `course-${course.id}`,
        type: t('typeCourse'),
        title: course.name,
        subtitle: course.ageCategory,
        href: user.role === 'teacher' ? '/teacher-workspace?tab=groups' : '/analytics-workspace?tab=courses',
        icon: BookOpen,
        keywords: [course.name, course.slug, course.ageCategory].filter(Boolean).join(' '),
      });
    });
    (data?.groups ?? []).forEach((group) => {
      if (user.role !== 'operations_director' && user.role !== 'teacher') return;
      items.push({
        id: `group-${group.id}`,
        type: t('typeGroup'),
        title: group.name,
        subtitle: [group.courseName, group.teacherName].filter(Boolean).join(' • '),
        href: user.role === 'teacher' ? '/teacher-workspace?tab=groups' : '/analytics-workspace?tab=groups',
        icon: Layers3,
        keywords: [group.name, group.courseName, group.teacherName].filter(Boolean).join(' '),
      });
    });
    (data?.teachers ?? []).forEach((teacher) => {
      if (user.role !== 'operations_director') return;
      items.push({
        id: `teacher-${teacher.id}`,
        type: t('typeTeacher'),
        title: teacher.fullName,
        subtitle: teacher.status,
        href: '/analytics-workspace?tab=teachers',
        icon: UserRoundCheck,
        keywords: teacher.fullName,
      });
    });
    return items;
  }, [data, t, user]);

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
