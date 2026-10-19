/** Wall-clock strings stay independent of the device's time zone. */
export const clockMinutes = (value?: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

export const clockValue = (minutes: number) => (
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
);

export function allowedClockMinutes(min?: string, max?: string, step: number | string = 60) {
  const first = clockMinutes(min);
  const last = clockMinutes(max);
  const stepSeconds = step === 'any' ? 60 : Math.max(60, Number(step) || 60);
  return Array.from({ length: 1440 }, (_, minute) => minute).filter(minute => {
    const inRange = first !== null && last !== null && first > last
      ? minute >= first || minute <= last
      : (first === null || minute >= first) && (last === null || minute <= last);
    return inRange && ((minute - (first ?? 0)) * 60) % stepSeconds === 0;
  });
}

export const nearestClockMinute = (allowed: number[], value: string) => {
  const current = clockMinutes(value) ?? 0;
  return allowed.reduce((closest, minute) => Math.abs(minute - current) < Math.abs(closest - current) ? minute : closest, allowed[0] ?? 0);
};
