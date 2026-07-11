type AttendanceLesson = {
  status: string;
  scheduledAt: string | Date;
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
      return leftPriority === 2 ? leftTime - rightTime : rightTime - leftTime;
    });
};
