import { z } from 'zod';

export type PublicAttendanceStatus = 'present' | 'absent' | null;
export type PublicAttendanceMarkedStatus = Exclude<PublicAttendanceStatus, null>;

export interface PublicAttendanceLesson {
  id: number;
  groupId: number;
  number: number;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  canMark: boolean;
  /** Every student on the lesson's roster has a mark — true even while the lesson waits for an earlier one to be completed. */
  fullyMarked: boolean;
}

export interface PublicAttendanceGroup {
  id: number;
  name: string;
  lessons: PublicAttendanceLesson[];
}

export interface PublicAttendanceStudent {
  id: number;
  name: string;
  organization: string | null;
  status: PublicAttendanceStatus;
  revision: string | null;
}

export interface PublicAttendanceRoster {
  lesson: PublicAttendanceLesson;
  students: PublicAttendanceStudent[];
}

export interface PublicAttendanceSession {
  available: boolean;
  authenticated: boolean;
  csrfToken?: string;
}

export interface PublicAttendanceMark {
  studentId: number;
  status: PublicAttendanceStatus;
  expectedRevision: string | null;
  clearConfirmed?: boolean;
}

/** Fills every listed student who is still unmarked; existing marks are left as they are. */
export interface PublicAttendanceBulkMark {
  studentIds: number[];
  status: PublicAttendanceMarkedStatus;
}

export const publicAttendanceReportQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).refine(({ from, to }) => !from || !to || from <= to);

export type PublicAttendanceReportQuery = z.infer<typeof publicAttendanceReportQuerySchema>;

export interface PublicAttendanceReportCounts {
  present: number;
  absent: number;
  unmarked: number;
}

export interface PublicAttendanceReportStudent extends PublicAttendanceReportCounts {
  id: number;
  name: string;
  organization: string | null;
}

export interface PublicAttendanceReportGroup extends PublicAttendanceReportCounts {
  id: number;
  name: string;
  lessonCount: number;
  students: PublicAttendanceReportStudent[];
}

export interface PublicAttendanceReport {
  groups: PublicAttendanceReportGroup[];
  totals: PublicAttendanceReportCounts & { lessonCount: number; studentCount: number };
}
