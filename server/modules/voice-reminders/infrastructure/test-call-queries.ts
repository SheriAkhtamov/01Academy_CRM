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
  ${test}.intro_audio_id = ${settings}.intro_audio_id AND ${test}.outro_audio_id = ${settings}.outro_audio_id
  AND (
    (${test}.audio_mode = 'clock' AND EXISTS (
      SELECT 1 FROM voice_reminder_hour_audio hour_audio, voice_reminder_minute_audio minute_audio
      WHERE hour_audio.hour = substring(${test}.clock_time, 1, 2)
        AND minute_audio.minute = substring(${test}.clock_time, 4, 2)
        AND hour_audio.audio_id = ${test}.hour_audio_id AND minute_audio.audio_id = ${test}.minute_audio_id))
    OR (${test}.audio_mode = 'time' AND EXISTS (SELECT 1 FROM voice_reminder_time_audio whole_audio
      WHERE whole_audio.time = ${test}.clock_time AND whole_audio.audio_id = ${test}.time_audio_id)
      AND NOT EXISTS (SELECT 1 FROM voice_reminder_hour_audio hour_audio, voice_reminder_minute_audio minute_audio
        WHERE hour_audio.hour = substring(${test}.clock_time, 1, 2)
          AND minute_audio.minute = substring(${test}.clock_time, 4, 2)))
  )`;
