import type { TranslationKey } from '@/lib/i18n';
import type {
  SalesScheduleDemoStatus,
  SalesScheduleEvent,
} from '@/lib/salesSchedule';

const FINAL_DEMO_STATUS_KEYS: Partial<Record<SalesScheduleDemoStatus, TranslationKey>> = {
  completed: 'demoStatusCompleted',
  not_conducted: 'demoStatusNotConducted',
  cancelled: 'demoStatusCancelled',
};

export const getDemoCalendarStatusKey = (
  event: SalesScheduleEvent,
): TranslationKey | null => (
  event.source === 'demo' && event.demoStatus
    ? FINAL_DEMO_STATUS_KEYS[event.demoStatus] ?? null
    : null
);

export const isInactiveDemoCalendarEvent = (event: SalesScheduleEvent) => (
  event.source === 'demo'
  && (event.demoStatus === 'not_conducted' || event.demoStatus === 'cancelled')
);
