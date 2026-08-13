export interface CalendarTone {
  background: string;
  border: string;
  foreground: string;
  solid: string;
}

const tone = (name: string): CalendarTone => ({
  background: `var(--calendar-${name}-background)`,
  border: `var(--calendar-${name}-border)`,
  foreground: `var(--calendar-${name}-foreground)`,
  solid: `var(--calendar-${name}-solid)`,
});

/**
 * One palette for every calendar. The tones are theme tokens rather than
 * Tailwind colour classes so a card keeps its meaning in dark mode instead of
 * turning into a bright patch on a dark grid.
 */
export const CALENDAR_TONES = [
  tone('blue'),
  tone('emerald'),
  tone('amber'),
  tone('violet'),
  tone('rose'),
  tone('cyan'),
] as const;

export const DEMO_TONE = CALENDAR_TONES[3];

export const calendarToneAt = (index: number) => (
  CALENDAR_TONES[((index % CALENDAR_TONES.length) + CALENDAR_TONES.length) % CALENDAR_TONES.length]
);

export const formatCalendarMinutes = (minutes: number) => (
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.round(minutes) % 60).padStart(2, '0')}`
);
