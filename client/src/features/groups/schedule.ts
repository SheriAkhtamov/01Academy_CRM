import type { WeekScheduleItem } from '@/components/ux/WeekScheduleEditor';

export const normalizeSchedule = (items: unknown, fallbackDurationMinutes = 120): WeekScheduleItem[] => {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: any) => {
    const dayOfWeek = Number(item?.dayOfWeek);
    const startTime = String(item?.startTime ?? item?.time ?? '');
    const explicitEndTime = String(item?.endTime ?? '');
    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const legacyEndMinutes = Number.isFinite(startHours) && Number.isFinite(startMinutes)
      ? Math.min(startHours * 60 + startMinutes + fallbackDurationMinutes, 23 * 60 + 59)
      : 0;
    const legacyEndTime = legacyEndMinutes > startHours * 60 + startMinutes
      ? `${String(Math.floor(legacyEndMinutes / 60)).padStart(2, '0')}:${String(legacyEndMinutes % 60).padStart(2, '0')}`
      : '';
    const endTime = explicitEndTime || legacyEndTime;
    if (!dayOfWeek || !startTime) return [];
    return [{
      dayOfWeek,
      startTime,
      endTime: endTime || startTime,
      schoolId: item?.schoolId ? Number(item.schoolId) : null,
    }];
  });
};
