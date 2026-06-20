import cron from 'node-cron';
import { config } from './config.js';
import { sendSummaryToGroup } from './bot.js';

// Mon–Fri (1-5), skips Saturday and Sunday. Times are in the team timezone.
export function startScheduler() {
    const tz = config.timezone;

    cron.schedule('0 10 * * 1-5', () => {
        void sendSummaryToGroup('morning').catch((err) => console.error('[cron] morning failed', err));
    }, { timezone: tz });

    cron.schedule('0 16 * * 1-5', () => {
        void sendSummaryToGroup('afternoon').catch((err) => console.error('[cron] afternoon failed', err));
    }, { timezone: tz });

    console.log(`[scheduler] summaries scheduled at 10:00 and 16:00 (Mon–Fri, ${tz})`);
}
