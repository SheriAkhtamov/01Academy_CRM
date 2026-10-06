export type PublicAttendanceStatus = 'present' | 'absent' | null;

export interface PublicAttendanceLesson {
  id: number;
  groupId: number;
  number: number;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  canMark: boolean;
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
