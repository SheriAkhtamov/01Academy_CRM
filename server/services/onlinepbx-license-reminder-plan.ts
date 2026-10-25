import { createHash } from 'node:crypto';
import { onlinePbxLicenseCapacity, type OnlinePbxLicense, type OnlinePbxLicenseCoverage } from '../domain/onlinepbx-licenses';
import { t } from '../lib/i18n';

export type OnlinePbxLicenseReminder = { eventKey: string; endStamp: number; coverage: OnlinePbxLicenseCoverage; text: string };

const serviceKeys = {
  USER: 'onlinePbxLicenseUsers',
  ACCESS_PLATFORM: 'onlinePbxLicensePlatform',
  ANALYTICS: 'onlinePbxLicenseAnalytics',
  QUALITY_SCORE: 'onlinePbxLicenseQuality',
  RECORDS: 'onlinePbxLicenseRecords',
  STEREO_RECORDS: 'onlinePbxLicenseStereo',
} as const;

const dateKey = (value: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(value);

/** Warn about a loss of paid capacity, accounting for already paid renewals. */
export function planOnlinePbxLicenseReminders(
  licenses: readonly OnlinePbxLicense[], domain: string, now: Date, timeZone: string,
  language: 'ru' | 'en' = 'ru',
): OnlinePbxLicenseReminder[] {
  const nowStamp = Math.floor(now.getTime() / 1000);
  const today = Date.parse(`${dateKey(now, timeZone)}T00:00:00Z`);
  const active = licenses.filter((license) => license.startStamp <= nowStamp && license.endStamp >= nowStamp);
  const domainKey = createHash('sha256').update(domain.toLowerCase()).digest('hex').slice(0, 24);
  const reminders: OnlinePbxLicenseReminder[] = [];
  for (const endStamp of [...new Set(active.map((license) => license.endStamp))].sort((a, b) => a - b)) {
    const end = new Date(endStamp * 1000);
    const days = Math.round((Date.parse(`${dateKey(end, timeZone)}T00:00:00Z`) - today) / 86_400_000);
    if (days > 7) continue;
    const types = [...new Set(active.filter((license) => license.endStamp === endStamp).map((license) => license.serviceType))].sort();
    const coverage: OnlinePbxLicenseCoverage = {};
    const services = types.flatMap((type) => {
      const before = onlinePbxLicenseCapacity(licenses, type, endStamp);
      const lost = before - onlinePbxLicenseCapacity(licenses, type, endStamp + 1);
      if (lost <= 0) return [];
      coverage[type] = before;
      const key = serviceKeys[type as keyof typeof serviceKeys] ?? 'onlinePbxLicenseOther';
      return [`• ${t(key, language, { count: String(lost) })}`];
    });
    if (!services.length) continue;
    const deadline = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ru-RU', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(end);
    reminders.push({
      endStamp,
      coverage,
      eventKey: `pbx:${domainKey}:${endStamp}:7`,
      text: t('onlinePbxLicenseReminder', language, { domain, deadline, timezone: timeZone, services: services.join('\n') }),
    });
  }
  return reminders;
}
