import { academyInstant } from '@/lib/localeFormat';

export const deadlineInputToInstant = (value: string): string | null => {
  const [dateKey, timePart] = value.split('T');
  if (!dateKey || !timePart || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const instant = academyInstant(dateKey, timePart.slice(0, 5));
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
};
