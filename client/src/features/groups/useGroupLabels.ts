import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import {
  START_COUNTDOWN_DAYS,
  groupTimeline,
  isSellableGroup,
  relativeDays,
  type GroupSeatTone,
} from './presentation';
import type { Group } from './types';

export const SEAT_TONE_LABEL_KEYS = {
  available: 'groupsSeatsAvailableShort',
  few: 'groupsSeatsFew',
  full: 'groupsSeatsFullShort',
  closed: 'groupsEnrollmentClosed',
} as const satisfies Record<GroupSeatTone, TranslationKey>;

/**
 * The sentences the group list and drawer share so they never word
 * the same fact two ways.
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

  return { startLabel, lessonPlanLabel };
}
