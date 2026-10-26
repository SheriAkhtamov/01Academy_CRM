import { LEAD_ARCHIVE_REASONS } from '@shared/academy';

const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
const aliases = new Map<string, string>(LEAD_ARCHIVE_REASONS.flatMap(reason => [
  [reason.code, reason.code], [normalized(reason.label), reason.code],
] as Array<[string, string]>));
for (const [alias, code] of Object.entries({
  'дубль': 'duplicate_or_invalid', 'дубликат': 'duplicate_or_invalid',
  'невалидная заявка': 'duplicate_or_invalid', 'неверный номер': 'wrong_contact',
  'не существ номер': 'wrong_contact', 'несуществующий номер': 'wrong_contact',
  'нет ответа': 'no_answer', 'нет отв': 'no_answer',
  'не интересуется': 'not_interested',
})) aliases.set(alias, code);

/** Merge exact, unambiguous aliases; retain specific free-text explanations. */
export function groupSalesClosureReasons(rows: Array<{ reason: string; count: number }>) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const original = row.reason?.trim() || 'unspecified';
    const reason = aliases.get(normalized(original)) ?? original;
    totals.set(reason, (totals.get(reason) ?? 0) + Number(row.count));
  }
  return [...totals].map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}
