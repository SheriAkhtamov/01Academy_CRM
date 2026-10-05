import { describe, expect, it } from 'vitest';
import { summarizeStudentProfile, studentProjectRequestSchema, type StudentLearningGroup, type StudentPayment } from '../shared/contracts/student-profile';

const group: StudentLearningGroup = { groupId: 1, groupName: 'Group', courseName: 'Course', schoolName: null,
  teacherName: null, isPrimary: true, enrolledAt: null, totalLessons: 16, completedLessons: 4,
  remainingLessons: 11, attendedLessons: 4, missedLessons: 1 };
const payment = (status: string, amountUzs: number): StudentPayment => ({ id: 1, status, amountUzs,
  type: 'full', method: 'cash', period: null, paidAt: null, dueAt: null, paidUntil: null,
  createdAt: '', comment: null });

describe('student profile totals', () => {
  it('keeps paid, pending, overdue and refunded amounts separate', () => {
    const summary = summarizeStudentProfile([group], [], [payment('paid', 1_500_000), payment('pending', 200_000),
      payment('overdue', 300_000), payment('refunded', 400_000), payment('cancelled', 900_000)]);
    expect(summary).toMatchObject({ paid: 1_500_000, remaining: 500_000, charged: 2_000_000, refunded: 400_000 });
  });
  it('does not treat missing attendance marks as absences', () => {
    const attendance = ['present', 'present', 'absent', null].map((status, lessonId) => ({
      lessonId, topic: null, scheduledAt: '', groupName: 'Group', status: status as 'present' | 'absent' | null, note: null,
    }));
    expect(summarizeStudentProfile([group], attendance, [])).toMatchObject({ attended: 2, missed: 1, unmarked: 1, attendancePercent: 67 });
  });
  it('combines multiple groups and leaves an unknown program length unset', () => {
    expect(summarizeStudentProfile([group, { ...group, groupId: 2 }], [], [])).toMatchObject({ totalLessons: 32, completedLessons: 8, remainingLessons: 22 });
    expect(summarizeStudentProfile([group, { ...group, totalLessons: null, remainingLessons: null }], [], [])).toMatchObject({ totalLessons: null, remainingLessons: null, progressPercent: null, attendancePercent: null });
    expect(summarizeStudentProfile([], [], []).remainingLessons).toBeNull();
  });
});
describe('student project links', () => {
  it('accepts only web links with a nonempty title', () => {
    expect(studentProjectRequestSchema.safeParse({ title: '  Portfolio  ', url: 'https://example.com/project' }).success).toBe(true);
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', '/relative/path']) {
      expect(studentProjectRequestSchema.safeParse({ title: 'Project', url }).success).toBe(false);
    }
    expect(studentProjectRequestSchema.safeParse({ title: '   ', url: 'https://example.com' }).success).toBe(false);
  });
});
