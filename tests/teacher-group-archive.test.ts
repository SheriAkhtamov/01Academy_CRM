import { describe, expect, it } from 'vitest';
import {
  canArchiveGroup,
  lessonsOutsideArchivedGroups,
} from '../client/src/lib/teacherModule';

const lesson = (id: number, groupId: number, overrides: Record<string, unknown> = {}) => ({
  id,
  groupId,
  ...overrides,
});

describe('archived groups leave the teacher calendars', () => {
  it('drops the lessons of a shelved group and keeps every other one', () => {
    const lessons = [lesson(1, 10), lesson(2, 20), lesson(3, 10)];
    const groups = [{ id: 10, isArchived: true }, { id: 20, isArchived: false }];

    expect(lessonsOutsideArchivedGroups(lessons, groups).map((item) => item.id)).toEqual([2]);
  });

  it('trusts the flag carried on the lesson when the group list is not at hand', () => {
    const lessons = [lesson(1, 10, { groupIsArchived: true }), lesson(2, 20)];

    expect(lessonsOutsideArchivedGroups(lessons, []).map((item) => item.id)).toEqual([2]);
  });

  it('returns the original list untouched when nothing is archived', () => {
    const lessons = [lesson(1, 10), lesson(2, 20)];
    const groups = [{ id: 10 }, { id: 20, isArchived: false }];

    expect(lessonsOutsideArchivedGroups(lessons, groups)).toBe(lessons);
  });
});

describe('what a teacher is allowed to archive', () => {
  it('offers the archive only for a course that has ended', () => {
    expect(canArchiveGroup({ status: 'completed' })).toBe(true);
    expect(canArchiveGroup({ status: 'in_progress' })).toBe(false);
    expect(canArchiveGroup({ status: 'open' })).toBe(false);
  });

  it('never offers to archive a group that is already on the shelf', () => {
    expect(canArchiveGroup({ status: 'completed', isArchived: true })).toBe(false);
  });
});
