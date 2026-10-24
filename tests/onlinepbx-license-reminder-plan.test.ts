import { describe, expect, it } from 'vitest';
import { planOnlinePbxLicenseReminders } from '../server/services/onlinepbx-license-reminder-plan';
import type { OnlinePbxLicense } from '../server/services/onlinepbx';

const zone = 'Asia/Tashkent';
const domain = 'example.onpbx.ru';
const end = 1795294799; // 22 Nov 2026, 01:59:59 in Tashkent.
const license = (serviceType = 'USER', serviceCount = 1, endStamp = end, startStamp = 1792750360): OnlinePbxLicense =>
  ({ serviceType, serviceCount, startStamp, endStamp });
const plan = (licenses: OnlinePbxLicense[], now = '2026-11-15T04:00:00Z') =>
  planOnlinePbxLicenseReminders(licenses, domain, new Date(now), zone);

describe('OnlinePBX renewal reminders', () => {
  it('groups services with the same deadline and uses the academy timezone across midnight in Moscow', () => {
    const result = plan([license(), license('ACCESS_PLATFORM'), license('RECORDS')]);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain('22.11.2026, 01:59');
    expect(result[0].text).toContain('Asia/Tashkent');
    expect(result[0].text).toContain('Пользовательские места: 1');
    expect(result[0].text).toContain('Запись разговоров');
    expect(result[0].text).toContain('Доступ к платформе');
    expect(result[0].eventKey).toMatch(/:7$/);
    expect(plan([license()], '2026-11-14T04:00:00Z')).toEqual([]);
  });

  it('uses one persistent stage per 7/3/1 day window, catching up after an outage without sending old stages', () => {
    expect(plan([license()], '2026-11-16T04:00:00Z')[0].eventKey).toBe(plan([license()])[0].eventKey);
    expect(plan([license()], '2026-11-19T04:00:00Z')[0].eventKey).toMatch(/:3$/);
    expect(plan([license()], '2026-11-20T04:00:00Z')[0].eventKey).toMatch(/:3$/);
    expect(plan([license()], '2026-11-21T04:00:00Z')[0].eventKey).toMatch(/:1$/);
    expect(plan([license()], '2026-11-21T20:00:00Z')[0].eventKey).toMatch(/:1$/);
    expect(plan([license()], '2026-11-21T21:00:00Z')).toEqual([]);
  });

  it('suppresses a fully paid continuation, including renewals split over several licenses', () => {
    expect(plan([license('USER', 2), license('USER', 1, end + 2592000, end + 1),
      license('USER', 1, end + 2592000, end + 1)])).toEqual([]);
    expect(plan([license(), license('USER', 1, end + 2592000, end - 3600)])).toHaveLength(1);
    // An overlapping extra seat is still a reduction from two seats to one.
    expect(plan([license(), license('USER', 1, end + 2592000, end - 3600)])[0].text).toContain('Пользовательские места: 1');
  });

  it('reports only the missing seats after a partial renewal and keeps unrelated expiring services', () => {
    const result = plan([license('USER', 3), license('USER', 1, end + 2592000, end + 1), license('RECORDS')]);
    expect(result[0].text).toContain('Пользовательские места: 2');
    expect(result[0].text).toContain('Запись разговоров');
  });

  it('does not treat a later license with a service gap as a paid continuation', () => {
    expect(plan([license(), license('USER', 1, end + 2592000, end + 2)])).toHaveLength(1);
  });

  it('keeps different expiration dates and domains separate, skips inactive licenses and supports English', () => {
    expect(plan([license(), license('RECORDS', 1, end + 86400)], '2026-11-19T04:00:00Z')).toHaveLength(2);
    expect(plan([license('USER', 1, end + 2592000, end + 1)])).toEqual([]);
    const other = planOnlinePbxLicenseReminders([license()], 'other.onpbx.ru', new Date('2026-11-15T04:00:00Z'), zone, 'en');
    expect(other[0].eventKey).not.toBe(plan([license()])[0].eventKey);
    expect(other[0].text).toContain('User seats: 1');
    expect(other[0].text).toContain('Expires:');
  });
});
