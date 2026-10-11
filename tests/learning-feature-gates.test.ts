import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../server/config';
import { LearningFeatureController } from '../server/infrastructure/learning-flags';

function fixture(restrictions: number[] = []) {
  let allGroups = true, enabled = true, enrolled = true;
  const query = vi.fn(async (sql: string) => sql.includes('FROM lms_feature_flags')
    ? { rows: [{ key: 'learning', enabled, all_groups: allGroups, group_ids: [1], updated_at: new Date(), version: 0 }] }
    : sql.includes('FROM lms_school_settings') ? { rows: [] } : { rows: [{ allowed: enrolled }] });
  const config = { portal: { enabled: true, learningEnabled: true, groupIds: restrictions } } as AppConfig;
  const flags = new LearningFeatureController({ query } as unknown as Pool, config);
  return { flags, query, config, change: (values: { allGroups?: boolean; enabled?: boolean; enrolled?: boolean }) => {
    allGroups = values.allGroups ?? allGroups; enabled = values.enabled ?? enabled; enrolled = values.enrolled ?? enrolled;
  } };
}

describe('current learning rollout decisions', () => {
  it('does not query enrollment for whole-academy rollout, including an unassigned pupil', async () => {
    const value = fixture(); await value.flags.refresh(); value.query.mockClear(); value.change({ enrolled: false });
    expect(await value.flags.enabledForStudent('learning', 77)).toBe(true);
    expect(value.query).not.toHaveBeenCalled();
  });
  it('checks current enrollment when deployment configuration restricts groups', async () => {
    const value = fixture([1]); await value.flags.refresh(); value.query.mockClear();
    expect(await value.flags.enabledForStudent('learning', 77)).toBe(true);
    value.change({ enrolled: false });
    expect(await value.flags.enabledForStudent('learning', 77)).toBe(false);
    expect(value.query).toHaveBeenCalledTimes(2);
  });
  it('checks current enrollment for a group rollout after every change', async () => {
    const value = fixture(); value.change({ allGroups: false }); await value.flags.refresh(); value.query.mockClear();
    expect(await value.flags.enabledForStudent('learning', 77)).toBe(true);
    value.change({ enrolled: false });
    expect(await value.flags.enabledForStudent('learning', 77)).toBe(false);
    expect(value.query).toHaveBeenCalledTimes(2);
  });
  it('reads each group decision from the supplied transaction instead of the pool', async () => {
    const value = fixture(); value.change({ allGroups: false }); await value.flags.refresh(); value.query.mockClear();
    let enrollmentGroups = [1];
    const readEnrollmentGroups = vi.fn(async () => enrollmentGroups);
    expect(await value.flags.enabledForStudent('learning', 77, readEnrollmentGroups)).toBe(true);
    enrollmentGroups = [2];
    expect(await value.flags.enabledForStudent('learning', 77, readEnrollmentGroups)).toBe(false);
    expect(readEnrollmentGroups).toHaveBeenCalledTimes(2);
    expect(value.query).not.toHaveBeenCalled();
  });
  it('requires the same enrollment group to satisfy rollout and deployment restrictions', async () => {
    const value = fixture([2]); value.change({ allGroups: false }); await value.flags.refresh(); value.query.mockClear();
    const readEnrollmentGroups = vi.fn(async () => [1, 2]);
    expect(await value.flags.enabledForStudent('learning', 77, readEnrollmentGroups)).toBe(false);
    value.config.portal!.groupIds = [1];
    expect(await value.flags.enabledForStudent('learning', 77, readEnrollmentGroups)).toBe(true);
    expect(readEnrollmentGroups).toHaveBeenCalledTimes(2);
    expect(value.query).not.toHaveBeenCalled();
  });
  it('keeps whole-academy and disabled decisions independent of a transaction reader', async () => {
    const value = fixture(); await value.flags.refresh(); value.query.mockClear();
    const readEnrollmentGroups = vi.fn(async () => []);
    expect(await value.flags.enabledForStudent('learning', 77, readEnrollmentGroups)).toBe(true);
    value.change({ enabled: false }); await value.flags.refresh(); value.query.mockClear();
    expect(await value.flags.enabledForStudent('learning', 77, readEnrollmentGroups)).toBe(false);
    expect(readEnrollmentGroups).not.toHaveBeenCalled();
    expect(value.query).not.toHaveBeenCalled();
  });
  it('applies a refreshed disable immediately without a membership query', async () => {
    const value = fixture(); await value.flags.refresh(); expect(await value.flags.enabledForStudent('learning', 77)).toBe(true);
    value.change({ enabled: false }); await value.flags.refresh(); value.query.mockClear();
    expect(await value.flags.enabledForStudent('learning', 77)).toBe(false);
    expect(value.query).not.toHaveBeenCalled();
  });
  it('never enables learning before successful configuration load or when globally disabled', async () => {
    const value = fixture(); expect(await value.flags.enabledForStudent('learning', 77)).toBe(false);
    await value.flags.refresh(); value.config.portal!.enabled = false;
    expect(await value.flags.enabledForStudent('learning', 77)).toBe(false);
  });
});
