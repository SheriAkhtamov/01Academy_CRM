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
  id: number;
  name: string;
  courseId: number;
  courseName?: string;
  schoolId: number;
  schoolName?: string;
  roomId: number;
  roomName?: string;
  teacherId?: number | null;
  teacherName?: string | null;
  teacherUserId?: number | null;
  schedule: WeekScheduleItem[];
  lessonCount: number;
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
