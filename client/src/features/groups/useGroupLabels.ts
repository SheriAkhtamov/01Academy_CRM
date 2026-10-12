import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import {
  START_COUNTDOWN_DAYS,
  groupTimeline,
  isSellableGroup,
  relativeDays,
  type GroupSeatTone,
  type GroupSeats,
} from './presentation';
import type { Group } from './types';

export const SEAT_TONE_LABEL_KEYS = {
  available: 'groupsSeatsAvailableShort',
  few: 'groupsSeatsFew',
  full: 'groupsSeatsFullShort',
  closed: 'groupsEnrollmentClosed',
} as const satisfies Record<GroupSeatTone, TranslationKey>;

/**
 * The sentences every view of a group shares, so the list, the week grid and
 * the drawer never word the same fact two ways.
 */
export function useGroupLabels() {
  const { t, language } = useTranslation();

  /** "Starts in 5 days" for a group a manager can still sell, within a month either side. */
  const startLabel = (group: Group, todayKey: string) => {
    const { daysToStart } = groupTimeline(group, todayKey);
    if (daysToStart === null || !isSellableGroup(group) || Math.abs(daysToStart) > START_COUNTDOWN_DAYS) return '';
    return (daysToStart >= 0 ? t('groupStartsRelative') : t('groupStartedRelative'))
      .replace('{relative}', relativeDays(daysToStart, language));
  };

  const lessonPlanLabel = (group: Group) => t('groupLessonPlanValue')
    .replace('{count}', String(group.lessonCount))
    .replace('{minutes}', String(group.lessonDurationMinutes));

  /** Fits a calendar block: "4 free", "Full", "Enrollment closed". */
  const seatShortLabel = (seats: GroupSeats) => (
    !seats.sellable
      ? t('groupsEnrollmentClosed')
      : seats.free === 0
        ? t('groupsSeatsFullShort')
        : t('groupsFreeSeatsShort').replace('{count}', String(seats.free))
  );

  return { startLabel, lessonPlanLabel, seatShortLabel };
}
