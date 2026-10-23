import type { LeadImportRecord } from './lead-import';
import { buildLeadImportComment, buildLegacyLeadImportComment } from './lead-import-comments';
import {
  hasChildImportContext, isStoredLeadImportAnswer, leadImportAnswerKind, resolveLeadImportFields,
  type LeadImportAnswerKind, type LeadImportFields,
} from './lead-import-fields';

const oldText = (value: unknown): string => String(value ?? '').trim();
const oldAnswerText = (value: unknown): string => value && typeof value === 'object' ? JSON.stringify(value) : oldText(value);

export const replaceGeneratedImportParagraph = (comment: string | null, before: string, after: string): string | null => {
  if (!comment) return comment;
  if (comment === before) return after || null;
  // Match a whole, uniquely occurring paragraph, leaving surrounding notes intact.
  const padded = `\n\n${comment}\n\n`;
  const needle = `\n\n${before}\n\n`;
  const index = padded.indexOf(needle);
  if (index < 0 || padded.indexOf(needle, index + 1) >= 0) return comment;
  const replacement = after ? `\n\n${after}\n\n` : '\n\n';
  return (padded.slice(0, index) + replacement + padded.slice(index + needle.length)).slice(2, -2) || null;
};

/** Reproduce only the customer content left by migration 0133, including its labels. */
const migratedBulletComment = (record: LeadImportRecord, stored?: LeadImportFields): string => {
  const resolved = resolveLeadImportFields(record);
  const childContext = hasChildImportContext(record);
  const keep = (kind: LeadImportAnswerKind | null, value: unknown) => !stored
    || !isStoredLeadImportAnswer(kind, value, stored, resolved);
  const lines: string[] = [];
  const details: Array<[string, unknown, LeadImportAnswerKind | null]> = [
    ['Возраст ребёнка', record.childAgeAnswer, 'studentAge'], ['Город', record.cityAnswer, 'locality'],
    ['Формат обучения', record.offlineAnswer, 'format'], ['Сфера деятельности', record.occupationAnswer, 'occupation'],
    ['Заметка', record.note, null],
  ];
  for (const [label, value, kind] of details) {
    const text = oldText(value).replace(/_/g, ' ');
    if (text && keep(kind, value)) lines.push(`${label}: ${text}`);
  }
  for (const answer of Array.isArray(record.answers) ? record.answers : []) {
    const name = oldText(answer?.name).replace(/_/g, ' ');
    if (!name || /^(external id|leadgen id|page id|campaign (id|name)|adset (id|name)|ad (id|name)|form (id|name)|created time|platform|is organic|source sheet|row|sheet)$/.test(name)) continue;
    const kind = leadImportAnswerKind(answer?.name, childContext);
    const values = (Array.isArray(answer?.values) ? answer.values : []).filter(value => keep(kind, value))
      .map(oldAnswerText).filter(Boolean);
    if (!values.length) continue;
    const label = name.replace(/^(full name|contact name|parent name|first name)$/i, 'Имя')
      .replace(/^last name$/i, 'Фамилия')
      .replace(/^(phone|phone number|mobile phone|mobile number)$/i, 'Телефон')
      .replace(/^email$/i, 'Электронная почта');
    lines.push(`• ${label}: ${values.join(', ')}`);
  }
  return lines.join('\n');
};

/** Match complete known generated bodies; never strip arbitrary lines from notes. */
export const historicalLeadImportComments = (record: LeadImportRecord, stored: LeadImportFields) => [
  { before: buildLegacyLeadImportComment(record), after: buildLeadImportComment(record, stored) },
  { before: migratedBulletComment(record), after: migratedBulletComment(record, stored) },
].filter((variant, index, variants) => variant.before && variant.before !== variant.after
  && variants.findIndex(other => other.before === variant.before) === index);
