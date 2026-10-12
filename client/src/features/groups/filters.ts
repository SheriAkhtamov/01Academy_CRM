import type { Group } from './types';

export const GROUP_FILTER_KEYS = ['q', 'course', 'school', 'teacher', 'status', 'seats'] as const;
export const availableGroupSeats = (group: Group) => Math.max(0,
  group.maxStudents - Number(group.currentStudents || 0) - Number(group.reservedStudents || 0));

export function filterGroups(groups: Group[], params: URLSearchParams) {
  const search = (params.get('q') ?? '').trim().toLocaleLowerCase();
  const archived = params.get('filter') === 'archive';
  const teacher = params.get('teacher') ?? (params.get('filter') === 'without-teacher' ? 'unassigned' : 'all');
  return groups.filter((group) => {
    if (Boolean(group.isArchived) !== archived) return false;
    if (search && ![group.name, group.courseName, group.schoolName, group.roomName, group.teacherName]
      .some((value) => String(value ?? '').toLocaleLowerCase().includes(search))) return false;
    for (const [key, value] of [['course', group.courseId], ['school', group.schoolId], ['status', group.status]] as const) {
      if (params.get(key) && params.get(key) !== String(value)) return false;
    }
    if (teacher === 'unassigned' && group.teacherId) return false;
    if (teacher !== 'all' && teacher !== 'unassigned' && teacher !== String(group.teacherId)) return false;
    const seats = params.get('seats');
    if (seats && !['open', 'in_progress'].includes(group.status)) return false;
    if (seats === 'available' && availableGroupSeats(group) === 0) return false;
    if (seats === 'full' && availableGroupSeats(group) > 0) return false;
    return true;
  });
}
