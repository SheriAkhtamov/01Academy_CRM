import { describe, expect, it } from 'vitest';
import { buildSalesScheduleRangeEvents, salesScheduleColumnDateKey, salesScheduleRangeBounds } from '../client/src/lib/salesSchedule';

const lesson = { id: 1, groupId: 10, scheduledAt: '2030-07-15T10:00:00+05:00', durationMinutes: 60, status: 'scheduled' };
const demo = { id: 2, scheduledAt: '2030-07-15T09:00:00+05:00', durationMinutes: 60, status: 'scheduled' as const };
const group = { id: 10, name: 'Group', startDate: '2030-07-15T00:00:00.000Z', endDate: '2030-07-22T00:00:00.000Z',
  schedule: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }] };

describe('sales calendar uses academy date keys on every device', () => {
  it.each(['Asia/Tashkent', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Honolulu'])('keeps Monday lessons and demos in Monday and fetches its morning in %s', (zone) => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = zone;
      const column = new Date(2030, 6, 15);
      const startKey = salesScheduleColumnDateKey(column);
      expect(startKey).toBe('2030-07-15');
      const bounds = salesScheduleRangeBounds(startKey, 7);
      expect(bounds).toEqual({ from: '2030-07-14T19:00:00.000Z', to: '2030-07-21T19:00:00.000Z' });
      expect(new Date(new Date(demo.scheduledAt).getTime() + 60 * 60 * 1000) > new Date(bounds.from)).toBe(true);
      const events = buildSalesScheduleRangeEvents({ groups: [group], lessons: [lesson], demos: [demo], rangeStart: startKey, dayCount: 7 });
      expect(events.map((event) => ({ source: event.source, dayIndex: event.dayIndex, startMinutes: event.startMinutes }))).toEqual([
        { source: 'demo', dayIndex: 0, startMinutes: 540 }, { source: 'lesson', dayIndex: 0, startMinutes: 600 },
      ]);
      expect(buildSalesScheduleRangeEvents({ groups: [], lessons: [lesson], demos: [], rangeStart: column, dayCount: 7 })[0].dayIndex).toBe(0);
      expect(buildSalesScheduleRangeEvents({ groups: [group], lessons: [], demos: [], rangeStart: startKey, dayCount: 1 })[0].startsAt.toISOString()).toBe(lesson.scheduledAt.replace('10:00:00+05:00', '05:00:00.000Z'));
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('clips an arbitrary multiweek date-key range independently of week alignment', () => {
    const events = buildSalesScheduleRangeEvents({ groups: [group], lessons: [], demos: [], rangeStart: '2030-07-14', dayCount: 9 });
    expect(events.map((event) => event.dayIndex)).toEqual([1, 8]);
  });
});
