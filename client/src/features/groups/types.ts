import type { School, Room, Course } from '@/features/academy-resources/api';
import type { WeekScheduleItem } from '@/components/ux/WeekScheduleEditor';

export interface GroupTeacher {
  id: number;
  userId?: number | null;
  fullName: string;
  courseIds: number[];
  schoolIds: number[];
  availability: WeekScheduleItem[];
  status: string;
}

export interface Group {
  updatedAt?: string;
  id: number;
  name: string;
  courseId: number;
  courseName?: string;
  deliveryMode?: 'offline' | 'online';
  /** Null for an online group, which needs neither a branch nor a room. */
  schoolId: number | null;
  schoolName?: string | null;
  roomId: number | null;
  roomName?: string | null;
  teacherId?: number | null;
  teacherName?: string | null;
  teacherUserId?: number | null;
  schedule: WeekScheduleItem[];
  lessonCount: number;
  selectedCourseLessonIds?: string[] | null;
  lessonDurationMinutes: number;
  durationDays: number;
  frequency?: string | null;
  maxStudents: number;
  currentStudents: number;
  reservedStudents: number;
  status: string;
  isArchived?: boolean;
  archivedAt?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface GroupConfiguration {
  schools: School[];
  rooms: Room[];
  courses: Course[];
  teachers: GroupTeacher[];
  groups: Group[];
}

export type EnrollmentGroupOption = {
  id: number;
  name: string;
  status?: string;
  courseId?: number | null;
  courseName?: string | null;
  schoolId?: number | null;
  schoolName?: string | null;
  isArchived?: boolean;
  currentStudents?: number;
  reservedStudents?: number;
  maxStudents?: number;
};
