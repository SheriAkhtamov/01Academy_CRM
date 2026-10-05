import { z } from 'zod';

export const MAX_STUDENT_PROJECT_BYTES = 100 * 1024 * 1024;
export const studentProjectLinkSchema = z.string().trim().max(2000).url('studentProjectInvalidLink').refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch { return false; }
}, 'studentProjectInvalidLink');
export const studentProjectRequestSchema = z.object({
  title: z.string().trim().min(1, 'studentProjectTitleRequired').max(255),
  url: studentProjectLinkSchema.optional(),
});

export type StudentLearningGroup = {
  groupId: number; groupName: string; courseName: string | null; schoolName: string | null;
  teacherName: string | null; isPrimary: boolean; enrolledAt: string | null;
  totalLessons: number | null; completedLessons: number; remainingLessons: number | null;
  attendedLessons: number; missedLessons: number;
};
export type StudentLessonAttendance = {
  lessonId: number; topic: string | null; scheduledAt: string; groupName: string;
  status: 'present' | 'absent' | null; note: string | null;
};
export type StudentProject = {
  id: number; studentId: number; title: string; url: string | null;
  fileUrl: string | null; fileName?: string | null; createdAt: string;
};
export type StudentPayment = {
  id: number; amountUzs: number; status: string; type: string; method: string;
  period: string | null; paidAt: string | null; dueAt: string | null;
  paidUntil: string | null; createdAt: string; comment: string | null;
};
export type StudentProfileStudent = {
  id: number; studentName?: string | null; contactName: string; phone?: string | null;
  studentAge?: number | null; status: string; exitReason?: string | null;
  managerName?: string | null; nextPaymentAt?: string | null;
  referralCode?: string | null; createdAt?: string; updatedAt?: string; leadId?: number | null;
};
export type StudentProfile = {
  student: StudentProfileStudent;
  lead: { id: number; contactName: string; phone: string | null } | null;
  groups: StudentLearningGroup[];
  attendance: StudentLessonAttendance[];
  projects: StudentProject[];
  payments: StudentPayment[];
  summary: ReturnType<typeof summarizeStudentProfile>;
};

export function summarizeStudentProfile(groups: StudentLearningGroup[], attendance: StudentLessonAttendance[], payments: StudentPayment[]) {
  const completedLessons = groups.reduce((sum, group) => sum + group.completedLessons, 0);
  const hasPlan = groups.length > 0 && groups.every((group) => group.totalLessons !== null);
  const totalLessons = hasPlan ? groups.reduce((sum, group) => sum + Number(group.totalLessons), 0) : null;
  const remainingLessons = hasPlan ? groups.reduce((sum, group) => sum + Number(group.remainingLessons), 0) : null;
  const attended = attendance.filter((lesson) => lesson.status === 'present').length;
  const missed = attendance.filter((lesson) => lesson.status === 'absent').length;
  const unmarked = attendance.length - attended - missed;
  const attendancePercent = attended + missed > 0 ? Math.round(attended / (attended + missed) * 100) : null;
  const paid = payments.filter((payment) => payment.status === 'paid').reduce((sum, payment) => sum + payment.amountUzs, 0);
  const remaining = payments.filter((payment) => ['pending', 'overdue'].includes(payment.status)).reduce((sum, payment) => sum + payment.amountUzs, 0);
  const refunded = payments.filter((payment) => payment.status === 'refunded').reduce((sum, payment) => sum + payment.amountUzs, 0);
  return { completedLessons, totalLessons, remainingLessons, attended, missed, unmarked, attendancePercent,
    progressPercent: totalLessons ? Math.min(100, Math.round(completedLessons / totalLessons * 100)) : null,
    paid, remaining, charged: paid + remaining, refunded };
}
