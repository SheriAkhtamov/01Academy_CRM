import { describe, expect, it } from 'vitest';
import {
  getGroupScheduleValidationError,
  normalizeWeeklySchedule,
  scheduleDateRangesOverlap,
  weeklySchedulesOverlap,
} from '../shared/scheduling';

describe('group scheduling', () => {
  it('requires valid lesson intervals', () => {
    expect(getGroupScheduleValidationError([])).toBe('groupScheduleRequired');
    expect(getGroupScheduleValidationError([
      { dayOfWeek: 1, startTime: '11:00', endTime: '10:00' },
    ])).toBe('groupScheduleInvalid');
  });

  it('detects overlaps inside one timetable', () => {
    expect(getGroupScheduleValidationError([
      { dayOfWeek: 1, startTime: '10:00', endTime: '11:30' },
      { dayOfWeek: 1, startTime: '11:00', endTime: '12:00' },
    ])).toBe('groupScheduleOverlap');
  });

  it('detects partial overlaps between group timetables', () => {
    const existing = normalizeWeeklySchedule([
      { dayOfWeek: 3, startTime: '14:00', endTime: '16:00' },
    ]);
    const conflicting = normalizeWeeklySchedule([
      { dayOfWeek: 3, startTime: '15:30', endTime: '17:00' },
    ]);
    const adjacent = normalizeWeeklySchedule([
      { dayOfWeek: 3, startTime: '16:00', endTime: '17:00' },
    ]);

    expect(weeklySchedulesOverlap(existing, conflicting)).toBe(true);
    expect(weeklySchedulesOverlap(existing, adjacent)).toBe(false);
  });

  it('allows identical weekly times when group date ranges do not overlap', () => {
    expect(scheduleDateRangesOverlap(
      new Date('2026-01-01'),
      new Date('2026-02-01'),
      new Date('2026-02-02'),
      new Date('2026-03-01'),
    )).toBe(false);
  });
});
