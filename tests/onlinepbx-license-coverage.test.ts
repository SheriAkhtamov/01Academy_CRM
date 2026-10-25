import { describe, expect, it } from 'vitest';
import { isOnlinePbxRenewalPaid, type OnlinePbxLicense } from '../server/domain/onlinepbx-licenses';

const end = 1795294799;
const now = new Date('2026-11-15T04:00:00Z');
const license = (serviceType = 'USER', serviceCount = 1, startStamp = end + 1, endStamp = end + 2592000): OnlinePbxLicense =>
  ({ serviceType, serviceCount, startStamp, endStamp });

describe('confirmed OnlinePBX renewal coverage', () => {
  it('requires all services and every seat, accepting split paid continuations', () => {
    expect(isOnlinePbxRenewalPaid([license(), license()], { USER: 2 }, end, now)).toBe(true);
    expect(isOnlinePbxRenewalPaid([license()], { USER: 2 }, end, now)).toBe(false);
    expect(isOnlinePbxRenewalPaid([license()], { USER: 1, RECORDS: 1 }, end, now)).toBe(false);
    expect(isOnlinePbxRenewalPaid([license(), license('RECORDS')], { USER: 1, RECORDS: 1 }, end, now)).toBe(true);
  });

  it('does not invent payment confirmation from an absent license or missing historical requirements', () => {
    expect(isOnlinePbxRenewalPaid([], { USER: 1 }, end, now)).toBe(false);
    expect(isOnlinePbxRenewalPaid([license()], null, end, now)).toBe(false);
    expect(isOnlinePbxRenewalPaid([license()], {}, end, now)).toBe(false);
  });

  it('settles a late renewal after service resumes, while preserving a not-yet-covered gap', () => {
    const late = license('USER', 1, end + 86400);
    expect(isOnlinePbxRenewalPaid([late], { USER: 1 }, end, now)).toBe(false);
    expect(isOnlinePbxRenewalPaid([late], { USER: 1 }, end, new Date((end + 86401) * 1000))).toBe(true);
  });
});
