import type { MarketingBotCourse, MarketingBotReport } from '@shared/contracts/telegram-marketing';
import { resolveMarketingCourse, resolveMarketingLanguages } from './attribution';

export type MarketingLeadFact = {
  id: number;
  courseSlug: string | null;
  formName?: string | null;
  campaignName?: string | null;
  languages: string[] | null;
  language: string | null;
  attempted: boolean;
  reached: boolean;
  qualified: boolean;
  bookedStudentIds: number[];
  attendedStudentIds: number[];
  dueStudentIds: number[];
  paymentCount: number;
  revenueUzs: number;
};

/** One creation cohort, with outcomes observed through the report's as-of time. */
export function summarizeMarketingLeads(facts: readonly MarketingLeadFact[], course: MarketingBotCourse): MarketingBotReport {
  const selected = facts.filter((fact) => course === 'all' || resolveMarketingCourse(fact) === course);
  const result: MarketingBotReport = {
    leads: selected.length, reached: 0, unreached: 0, notCalled: 0, qualified: 0,
    bookedStudents: 0, attendedStudents: 0, dueStudents: 0, payingLeads: 0, payments: 0, revenueUzs: 0,
    courses: [], languages: { uz: 0, ru: 0, both: 0, other: 0, unknown: 0 },
  };
  const booked = new Set<number>();
  const attended = new Set<number>();
  const due = new Set<number>();
  const courses = new Map<Exclude<MarketingBotCourse, 'all'>, number>();
  for (const fact of selected) {
    if (fact.reached) result.reached += 1;
    else if (fact.attempted) result.unreached += 1;
    else result.notCalled += 1;
    if (fact.qualified) result.qualified += 1;
    if (fact.paymentCount > 0) result.payingLeads += 1;
    result.payments += fact.paymentCount;
    result.revenueUzs += fact.revenueUzs;
    fact.bookedStudentIds.forEach((id) => booked.add(id));
    fact.attendedStudentIds.forEach((id) => attended.add(id));
    fact.dueStudentIds.forEach((id) => due.add(id));
    const key = resolveMarketingCourse(fact);
    courses.set(key, (courses.get(key) ?? 0) + 1);
    const languages = resolveMarketingLanguages(fact);
    if (languages.includes('uz') && languages.includes('ru')) result.languages.both += 1;
    else if (languages.includes('uz')) result.languages.uz += 1;
    else if (languages.includes('ru')) result.languages.ru += 1;
    else if (languages.length) result.languages.other += 1;
    else result.languages.unknown += 1;
  }
  result.bookedStudents = booked.size;
  result.attendedStudents = attended.size;
  result.dueStudents = due.size;
  result.courses = [...courses].map(([key, count]) => ({ course: key, count }));
  return result;
}
