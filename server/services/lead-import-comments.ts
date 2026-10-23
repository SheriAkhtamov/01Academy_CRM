import {
  importText, isStoredLeadImportAnswer, leadImportAnswerKind, resolveLeadImportFields,
  type LeadImportAnswerKind, type LeadImportFieldInput, type LeadImportFields,
} from './lead-import-fields';

type CommentInput = LeadImportFieldInput & {
  offlineAnswer?: string | null;
  occupationAnswer?: string | null;
  note?: string | null;
  [key: string]: unknown;
};

const answerText = (value: unknown): string => {
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return importText(value);
};

const answerLabel = (value: unknown): string => {
  const name = String(value ?? '').trim().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const key = name.toLowerCase();
  if (/^(external id|leadgen id|page id|campaign (id|name)|adset (id|name)|ad (id|name)|form (id|name)|created time|platform|is organic|source sheet|row|sheet)$/.test(key)) return '';
  const labels: Record<string, string> = {
    'full name': 'Имя', 'contact name': 'Имя', 'parent name': 'Имя',
    'first name': 'Имя', 'last name': 'Фамилия',
    phone: 'Телефон', 'phone number': 'Телефон', 'mobile phone': 'Телефон', 'mobile number': 'Телефон',
    email: 'Электронная почта', city: 'Город', 'child age': 'Возраст ребёнка',
    'learning format': 'Формат обучения', occupation: 'Сфера деятельности',
  };
  return labels[key] ?? name;
};

const legacyDetails = (record: CommentInput): Array<[string, unknown]> => [
  ['Возраст ребёнка', record.childAgeAnswer], ['Город', record.cityAnswer],
  ['Формат обучения', record.offlineAnswer], ['Сфера деятельности', record.occupationAnswer],
  ['Заметка', record.note],
];

/** Exact previous renderer, used only to identify generated historical comments. */
export const buildLegacyLeadImportComment = (record: CommentInput): string => {
  const legacyText = (value: unknown): string => typeof value === 'boolean' ? (value ? 'Да' : 'Нет')
    : typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    const normalized = legacyText(value);
    const line = `${label}: ${normalized}`;
    if (label && normalized && !lines.includes(line)) lines.push(line);
  };
  for (const answer of Array.isArray(record.answers) ? record.answers : []) {
    add(answerLabel(answer?.name), Array.isArray(answer?.values) ? answer.values.map(legacyText).filter(Boolean).join(', ') : '');
  }
  for (const [label, value] of legacyDetails(record)) add(label, value);
  return lines.join('\n');
};

export const buildLeadImportComment = (
  record: CommentInput,
  stored: LeadImportFields = resolveLeadImportFields(record),
): string => {
  const resolved = resolveLeadImportFields(record);
  const answers = Array.isArray(record.answers) ? record.answers : [];
  const lines: string[] = [];
  const add = (label: string, values: unknown[], kind: LeadImportAnswerKind | null) => {
    const remaining = values.filter(value => !isStoredLeadImportAnswer(kind, value, stored, resolved));
    const value = remaining.map(answerText).filter(Boolean).join(', ');
    const line = `${label}: ${value}`;
    if (label && value && !lines.includes(line)) lines.push(line);
  };
  for (const answer of answers) {
    add(answerLabel(answer?.name), Array.isArray(answer?.values) ? answer.values : [], leadImportAnswerKind(answer?.name));
  }
  const details: Array<[string, unknown, LeadImportAnswerKind | null]> = [
    ['Имя', record.contactName, 'contactName'], ['Телефон', record.rawPhone ?? record.phone, 'phoneNumbers'],
    ['Имя ребёнка', record.studentName, 'studentName'], ['Возраст ребёнка', record.childAgeAnswer ?? record.studentAge, 'studentAge'],
    ['Город', record.cityAnswer ?? record.locality, 'locality'],
    ['Язык обучения', record.languages?.join(', ') ?? record.language, 'languages'],
    ['Дни обучения', record.studyDays, 'studyDays'], ['Время обучения', record.studyTime, 'studyTime'],
    ['Цель обучения', record.goal, 'goal'], ['Срочность', record.urgency, 'urgency'],
    ['Формат обучения', record.offlineAnswer, 'format'], ['Сфера деятельности', record.occupationAnswer, 'occupation'],
    ['Заметка', record.note, null],
  ];
  for (const [label, value, kind] of details) {
    // A custom question already carries this answer; don't append a second label.
    const covered = kind && answers.some(answer => {
      const answerKind = leadImportAnswerKind(answer?.name);
      if (kind === 'contactName' && (answerKind === 'firstName' || answerKind === 'lastName')
        && value === resolved.contactName) return true;
      if (answerKind !== kind || !Array.isArray(answer?.values)) return false;
      return answer.values.some(raw => answerText(raw) === answerText(value))
        || isStoredLeadImportAnswer(kind, value, resolveLeadImportFields({ answers: [answer] }), resolved);
    });
    if (!covered) add(label, [value], kind);
  }
  return lines.join('\n');
};
