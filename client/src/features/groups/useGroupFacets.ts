import { useMemo } from 'react';
import { BookOpen, CircleDot, MapPin, UserRound } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import type { GroupFacet, GroupFacetKey } from './GroupsToolbar';
import { countFacet, countScope } from './presentation';
import type { GroupConfiguration } from './types';

/**
 * Everything the filter strip shows: each filter's options with how many
 * groups they would leave and the current/archive totals — all recounted
 * whenever the address changes.
 */
export function useGroupFacets(configuration: GroupConfiguration, params: URLSearchParams) {
  const { t } = useTranslation();
  const teacherValue = params.get('teacher') ?? (params.get('filter') === 'without-teacher' ? 'unassigned' : 'all');

  const facets = useMemo<GroupFacet[]>(() => {
    const counted = (facet: GroupFacetKey) => countFacet(configuration.groups, params, facet);
    const course = counted('course');
    const school = counted('school');
    const teacher = counted('teacher');
    const status = counted('status');
    return [
      {
        key: 'course', label: t('course'), icon: BookOpen, value: params.get('course') ?? 'all',
        allLabel: t('portalAllCourses'), allCount: course.total,
        options: configuration.courses.map((item) => ({
          value: String(item.id), label: item.name, count: course.counts.get(String(item.id)) ?? 0,
        })),
      },
      {
        key: 'school', label: t('school'), icon: MapPin, value: params.get('school') ?? 'all',
        allLabel: t('allSchools'), allCount: school.total,
        options: configuration.schools.map((item) => ({
          value: String(item.id), label: item.name, count: school.counts.get(String(item.id)) ?? 0,
        })),
      },
      {
        key: 'teacher', label: t('teacher'), icon: UserRound, value: teacherValue,
        allLabel: t('allTeachers'), allCount: teacher.total,
        options: [
          { value: 'unassigned', label: t('notAssigned'), count: teacher.counts.get('unassigned') ?? 0 },
          ...configuration.teachers.map((item) => ({
            value: String(item.id), label: item.fullName, count: teacher.counts.get(String(item.id)) ?? 0,
          })),
        ],
      },
      {
        key: 'status', label: t('status'), icon: CircleDot, value: params.get('status') ?? 'all',
        allLabel: t('groupsAllStatuses'), allCount: status.total,
        options: ([
          ['open', t('groupStatusOpen')],
          ['in_progress', t('groupStatusInProgress')],
          ['frozen', t('groupStatusFrozen')],
          ['completed', t('groupStatusCompleted')],
        ] as const).map(([value, label]) => ({ value, label, count: status.counts.get(value) ?? 0 })),
      },
    ];
  }, [configuration, params, t, teacherValue]);

  const scopeCounts = useMemo(() => ({
    current: countScope(configuration.groups, params, false),
    archive: countScope(configuration.groups, params, true),
  }), [configuration.groups, params]);

  return { facets, scopeCounts };
}
