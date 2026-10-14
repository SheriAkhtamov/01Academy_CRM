import { LEADERSHIP_MODULES } from '@shared/academy';

/** Aliases are supplied only by trusted SQL adapters, never by an HTTP input. */
export const testCallActorSql = (staff = 'staff'): string => {
  const modules = LEADERSHIP_MODULES.map(module => `'${module}'`).join(',');
  return `${staff}.is_active IS TRUE AND ${staff}.is_archived = false
    AND (${staff}.module IN (${modules}) OR EXISTS (SELECT 1 FROM user_modules assigned
      WHERE assigned.user_id = ${staff}.id AND assigned.module IN (${modules})))`;
};

/** A preferred split pair invalidates a prepared legacy clock before INVITE. */
export const testCallAudioPinsSql = (test = 'test', settings = 'settings'): string => `
  ${test}.intro_audio_id = voice_reminder_library_audio_id(${test}.language,CASE WHEN ${test}.reminder_kind='day_before' THEN 'dayBeforeIntro' ELSE 'intro' END)
  AND ${test}.outro_audio_id = voice_reminder_library_audio_id(${test}.language,'outro')
  AND ${test}.confirmation_enabled=${settings}.confirmation_enabled
  AND (NOT ${test}.confirmation_enabled OR (
    ${test}.confirmation_yes_audio_id=voice_reminder_library_audio_id(${test}.language,'confirmationYes')
    AND ${test}.confirmation_no_audio_id=voice_reminder_library_audio_id(${test}.language,'confirmationNo')))
  AND (
    (${test}.audio_mode='clock'
      AND ${test}.hour_audio_id=voice_reminder_library_audio_id(${test}.language,'hour',substring(${test}.clock_time,1,2))
      AND ${test}.minute_audio_id=voice_reminder_library_audio_id(${test}.language,'minute',substring(${test}.clock_time,4,2)))
    OR (${test}.audio_mode='time'
      AND ${test}.time_audio_id=voice_reminder_library_audio_id(${test}.language,'time',${test}.clock_time)
      AND NOT (voice_reminder_library_audio_id(${test}.language,'hour',substring(${test}.clock_time,1,2)) IS NOT NULL
        AND voice_reminder_library_audio_id(${test}.language,'minute',substring(${test}.clock_time,4,2)) IS NOT NULL))
  )`;
