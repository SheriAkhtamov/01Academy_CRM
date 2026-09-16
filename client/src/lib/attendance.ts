import type { DemoLesson } from '@/features/demo-lessons/api';
import type { AttendanceCalendarLesson } from '@/components/ux/AttendanceCalendar';

type AttendanceLesson = {
  status: string;
  scheduledAt: string | Date;
};

// Demo and regular lessons have independent numeric ids. Namespace demo ids so
// selecting demo 10 can never load the roster or draft of regular lesson 10.
export const buildDemoAttendanceLessons = (
  demos: DemoLesson[],
  demoLabel: string,
  fallbackCourseLabel: string,
): AttendanceCalendarLesson[] => demos.map((demo) => ({
  id: `demo:${demo.id}`,
  topic: demo.courseName || fallbackCourseLabel,
  groupName: demoLabel,
  scheduledAt: demo.scheduledAt,
  status: demo.status === 'completed' ? 'conducted' : demo.status,
}));

export const parseDemoAttendanceId = (value: string | null): number | null => {
  if (!value || !/^demo:[1-9]\d*$/.test(value)) return null;
  const id = Number(value.slice(5));
  return Number.isSafeInteger(id) ? id : null;
};

/** Keep unfinished past lessons visible above history and the future schedule. */
export const sortAttendanceLessons = <T extends AttendanceLesson>(
  lessons: T[],
  now: number,
): T[] => {
  const priority = (lesson: T) => {
    if (lesson.status === 'conducted') return 1;
    return new Date(lesson.scheduledAt).getTime() <= now ? 0 : 2;
  };

  return lessons
    .filter((lesson) => lesson.status === 'scheduled' || lesson.status === 'conducted')
    .slice()
    .sort((left, right) => {
      const leftPriority = priority(left);
      const rightPriority = priority(right);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;

      const leftTime = new Date(left.scheduledAt).getTime();
      const rightTime = new Date(right.scheduledAt).getTime();
      return leftTime - rightTime;
    });
};
