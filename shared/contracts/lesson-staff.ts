import { z } from 'zod';

export const lessonAssistantSchema = z.object({ teacherId: z.number().int().positive().max(2_147_483_647) }).strict();
export type LessonStaffTeacher = { id: number; fullName: string };
export type LessonStaff = {
  teacher: LessonStaffTeacher | null;
  assistants: LessonStaffTeacher[];
  teachers: LessonStaffTeacher[];
};
