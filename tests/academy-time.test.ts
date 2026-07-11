import { afterEach, describe, expect, it } from 'vitest';
import {
  getTrailingZonedMonthRanges,
  getZonedDateTimeParts,
  getZonedDateOnlyRange,
  getZonedDayRange,
  getZonedMonthRange,
  zonedWallClockToInstant,
} from '../server/lib/academy-time';

const originalProcessTimeZone = process.env.TZ;

afterEach(() => {
  if (originalProcessTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalProcessTimeZone;
});

describe('academy business timezone ranges', () => {
  it('starts a Tashkent day at the matching UTC instant', () => {
    const range = getZonedDayRange(new Date('2026-07-10T23:30:00.000Z'), 'Asia/Tashkent');

    expect(range.start.toISOString()).toBe('2026-07-10T19:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-07-11T19:00:00.000Z');
  });

  it('resolves a 10:00 Tashkent lesson independently of a UTC host timezone', () => {
    process.env.TZ = 'UTC';
    const lesson = new Date('2026-07-13T05:00:00.000Z');

    expect(getZonedDateTimeParts(lesson, 'Asia/Tashkent')).toMatchObject({
      year: 2026,
      month: 7,
      day: 13,
      hour: 10,
      minute: 0,
    });
    expect(zonedWallClockToInstant({
      year: 2026,
      month: 7,
      day: 13,
      hour: 10,
      minute: 0,
    }, 'Asia/Tashkent').toISOString()).toBe('2026-07-13T05:00:00.000Z');
  });

  it('resolves the local calendar month across a UTC month boundary', () => {
    // It is already August in Tashkent, although the UTC date is still July 31.
    const range = getZonedMonthRange(new Date('2026-07-31T20:00:00.000Z'), 'Asia/Tashkent');

    expect(range.key).toBe('2026-08');
    expect(range.start.toISOString()).toBe('2026-07-31T19:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-08-31T19:00:00.000Z');
  });

  it('maps UTC-naive date-only fields to Tashkent calendar midnights', () => {
    const range = getZonedDateOnlyRange(
      new Date('2026-08-31T00:00:00.000Z'),
      'Asia/Tashkent',
    );

    expect(range.start.toISOString()).toBe('2026-08-30T19:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-08-31T19:00:00.000Z');
  });

  it('builds six ordered ranges correctly across a year boundary', () => {
    const ranges = getTrailingZonedMonthRanges(
      new Date('2026-01-15T12:00:00.000Z'),
      'Asia/Tashkent',
      6,
    );

    expect(ranges.map((range) => range.key)).toEqual([
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
    expect(ranges[0].start.toISOString()).toBe('2025-07-31T19:00:00.000Z');
    expect(ranges[5].end.toISOString()).toBe('2026-01-31T19:00:00.000Z');
  });

  it('does not depend on the host process timezone', () => {
    const reference = new Date('2026-07-31T20:00:00.000Z');
    process.env.TZ = 'Pacific/Honolulu';
    const honoluluHost = getZonedMonthRange(reference, 'Asia/Tashkent');
    process.env.TZ = 'Pacific/Kiritimati';
    const kiritimatiHost = getZonedMonthRange(reference, 'Asia/Tashkent');

    expect(kiritimatiHost).toEqual(honoluluHost);
  });

  it('uses calendar midnights rather than fixed 24-hour increments', () => {
    const range = getZonedDayRange(new Date('2026-03-08T12:00:00.000Z'), 'America/New_York');

    expect(range.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(range.end.getTime() - range.start.getTime()).toBe(23 * 60 * 60 * 1_000);
  });

  it('rejects invalid month counts', () => {
    expect(() => getTrailingZonedMonthRanges(new Date(), 'Asia/Tashkent', -1)).toThrow(RangeError);
    expect(() => getTrailingZonedMonthRanges(new Date(), 'Asia/Tashkent', 1.5)).toThrow(RangeError);
  });
});
