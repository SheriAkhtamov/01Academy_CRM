import { LEAD_LOCALITIES, LEAD_STUDY_TIMES } from '../../shared/lead-preferences';
import type { LeadLanguage } from '../../shared/lead-languages';

export type LeadImportAnswer = { name: string; values: unknown[] };

export type LeadImportFieldInput = {
  contactName?: string | null;
  phone?: string | null;
  rawPhone?: string | null;
  phoneNumbers?: string[] | null;
  studentName?: string | null;
  studentAge?: number | string | null;
  childAgeAnswer?: number | string | null;
  cityAnswer?: string | null;
  locality?: string | null;
  language?: string | null;
  languages?: string[] | null;
  studyDays?: string | null;
  studyTime?: string | null;
  goal?: string | null;
  urgency?: string | null;
  answers?: LeadImportAnswer[];
};

export type LeadImportFields = {
  contactName: string | null;
  phoneNumbers: string[];
  studentName: string | null;
  studentAge: number | null;
  locality: string | null;
  languages: string[];
  studyDays: string | null;
  studyTime: string | null;
  goal: string | null;
  urgency: string | null;
};

export type LeadImportAnswerKind = keyof LeadImportFields | 'firstName' | 'lastName' | 'format' | 'occupation';

export const importText = (value: unknown): string => (
  typeof value === 'string' || typeof value === 'number' ? String(value).normalize('NFKC').trim() : ''
);

export const normalizeImportFieldName = (value: unknown): string => importText(value)
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[’‘ʼʻ'`´]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

const names: Record<string, LeadImportAnswerKind> = {
  'full name': 'contactName', 'contact name': 'contactName', 'parent name': 'contactName',
  name: 'contactName', fullname: 'contactName', фио: 'contactName', fio: 'contactName',
  'ваше имя': 'contactName', 'полное имя': 'contactName', 'ваше полное имя': 'contactName',
  'как к вам обращаться': 'contactName', 'имя фамилия': 'contactName',
  'имя родителя': 'contactName', 'фамилия имя': 'contactName', 'имя и фамилия': 'contactName',
  'как вас зовут': 'contactName', 'ism familiya': 'contactName', 'ism sharif': 'contactName',
  'ism va familiyangiz': 'contactName', 'ism familiyangiz': 'contactName',
  'first name': 'firstName', имя: 'firstName', ismingiz: 'firstName', ism: 'firstName',
  'last name': 'lastName', фамилия: 'lastName', familiya: 'lastName', familiyangiz: 'lastName',
  'student name': 'studentName', 'child name': 'studentName', 'child full name': 'studentName',
  'child age': 'studentAge', 'student age': 'studentAge', 'возраст ребенка': 'studentAge',
  city: 'locality', город: 'locality', location: 'locality', locality: 'locality', district: 'locality', район: 'locality',
  shahar: 'locality', tuman: 'locality',
  language: 'languages', languages: 'languages', 'язык обучения': 'languages', язык: 'languages',
  'study days': 'studyDays', 'learning days': 'studyDays', 'дни обучения': 'studyDays',
  'study time': 'studyTime', 'learning time': 'studyTime', 'время обучения': 'studyTime',
  goal: 'goal', 'learning goal': 'goal', цель: 'goal', 'цель обучения': 'goal', maqsad: 'goal',
  urgency: 'urgency', срочность: 'urgency',
  'learning format': 'format', 'формат обучения': 'format', offline: 'format',
  occupation: 'occupation', job: 'occupation', 'сфера деятельности': 'occupation',
};

export const leadImportAnswerKind = (name: unknown): LeadImportAnswerKind | null => {
  const key = normalizeImportFieldName(name);
  if (names[key]) return names[key];
  const child = /child|student|kid|ребен|ученик|farzand|bola|фарзанд|бола/u.test(key);
  if (child && /\bage\b|возраст|сколько.*лет|yosh|еш/u.test(key)) return 'studentAge';
  if (child && /\bname\b|имя|фио|как.*зовут|\bism\w*|исм/u.test(key)) return 'studentName';
  if (/\bphone\b|\bmobile\b|телефон|\btelefon\b|\baloqa raqam/u.test(key)) return 'phoneNumbers';
  if (/^ismingiz\b|^ism sharifingiz\b|^ism va familiya/u.test(key)) return 'firstName';
  if (/qaysi.*shahar|qaysi.*tuman|qayerda.*yashay|какого.*города|каком.*районе/u.test(key)) return 'locality';
  if (/\blanguage\b|язык|\btil(?:i|da|ini)?\b/u.test(key)) return 'languages';
  if (/oqish kun|dars kun|qulay kun|qaysi kun/u.test(key)) return 'studyDays';
  if (/oqish vaqt|dars vaqt|qulay vaqt|qaysi vaqt/u.test(key)) return 'studyTime';
  return null;
};

export const normalizeLeadImportPhone = (value: unknown): string | null => {
  const raw = importText(value).replace(/^(?:p:|tel:)\s*/i, '');
  if (!raw || !/^\+?[\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = `998${digits}`;
  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.startsWith('998') && digits.length !== 12) return null;
  return `+${digits}`;
};

export const importPhoneParts = (value: unknown): string[] => importText(value)
  .split(/[,;/\n]+|\s+(?=\+)/)
  .map(part => part.trim()).filter(Boolean);

export const normalizeImportedAge = (value: unknown): number | null => {
  const raw = importText(value);
  // An age is one number, not a birth year, range, or several children's ages.
  if (!/^\d{1,3}(?:\s*[^\d.,-]+)?$/u.test(raw)) return null;
  const age = Number.parseInt(raw, 10);
  return age >= 1 && age <= 120 ? age : null;
};

const districtAliases: Record<string, string> = {
  бектемир: 'bektemir', чиланзар: 'chilanzar', chilonzor: 'chilanzar',
  мирабад: 'mirabad', миробод: 'mirabad', mirobod: 'mirabad',
  'мирзо улугбек': 'mirzo_ulugbek', 'mirzo ulugbek': 'mirzo_ulugbek',
  алмазар: 'olmazor', сергели: 'sergeli',
  шайхантахур: 'shaykhontohur', shayxontohur: 'shaykhontohur',
  учтепа: 'uchtepa', яккасарай: 'yakkasaray',
  янгиҳает: 'yangihayot', янгихаёт: 'yangihayot', янгихает: 'yangihayot',
  яшнабад: 'yashnabad', yashnobod: 'yashnabad',
  юнусабад: 'yunusabad', yunusobod: 'yunusabad',
  область: 'region', регион: 'region', viloyat: 'region',
};

export const normalizeImportedLocality = (value: unknown): string | null => {
  const key = normalizeImportFieldName(value).replace(/\s+(?:district|район|tumani)$/u, '');
  const direct = LEAD_LOCALITIES.find(locality => normalizeImportFieldName(locality) === key);
  // "Toshkent" is a city, not a particular district: keep it as an answer.
  return direct ?? districtAliases[key] ?? null;
};

const languageAliases: Record<string, LeadLanguage> = {
  ru: 'ru', russian: 'ru', русский: 'ru', rus: 'ru', 'rus tili': 'ru',
  uz: 'uz', uzbek: 'uz', ozbek: 'uz', ozbekcha: 'uz', узбекский: 'uz', 'ozbek tili': 'uz',
  en: 'en', english: 'en', английский: 'en', ingliz: 'en', 'ingliz tili': 'en',
};
export const normalizeImportedLanguage = (value: unknown): LeadLanguage | null => (
  languageAliases[normalizeImportFieldName(value)] ?? null
);

const normalizeDays = (value: unknown): string | null => {
  const key = normalizeImportFieldName(value);
  if (['even', 'четные', 'четные дни', 'juft', 'juft kunlar'].includes(key)) return 'even';
  if (['odd', 'нечетные', 'нечетные дни', 'toq', 'toq kunlar'].includes(key)) return 'odd';
  if (['weekend', 'выходные', 'dam olish kunlari'].includes(key)) return 'weekend';
  return null;
};
const normalizeTime = (value: unknown): string | null => {
  const match = /^(\d{1,2})(?::00)?$/.exec(importText(value));
  const time = match ? `${match[1].padStart(2, '0')}:00` : '';
  return LEAD_STUDY_TIMES.includes(time) ? time : null;
};
const personName = (value: unknown) => {
  const name = importText(value).replace(/\s+/g, ' ');
  return /\p{L}/u.test(name) ? name.slice(0, 255) : null;
};

export const resolveLeadImportFields = (record: LeadImportFieldInput): LeadImportFields => {
  const answers = Array.isArray(record.answers) ? record.answers : [];
  const values = (kind: LeadImportAnswerKind) => answers
    .filter(answer => leadImportAnswerKind(answer?.name) === kind)
    .flatMap(answer => Array.isArray(answer?.values) ? answer.values : []);
  const first = <T>(candidates: unknown[], normalize: (value: unknown) => T | null): T | null => {
    for (const candidate of candidates) {
      const result = normalize(candidate);
      if (result !== null) return result;
    }
    return null;
  };
  const firstName = first(values('firstName'), personName);
  const lastName = first(values('lastName'), personName);
  const contactName = first([record.contactName, ...values('contactName')], personName)
    ?? personName([firstName, lastName].filter(Boolean).join(' '));
  const phoneNumbers = [...new Set([
    record.rawPhone, record.phone, ...(Array.isArray(record.phoneNumbers) ? record.phoneNumbers : []), ...values('phoneNumbers'),
  ].flatMap(importPhoneParts).map(normalizeLeadImportPhone).filter((value): value is string => Boolean(value)))].slice(0, 10);
  const languages = [...new Set([
    ...(Array.isArray(record.languages) ? record.languages : []), record.language, ...values('languages'),
  ].flatMap(value => importText(value).split(/[,;/]+/)).map(normalizeImportedLanguage)
    .filter((value): value is LeadLanguage => Boolean(value)))];
  return {
    contactName, phoneNumbers,
    studentName: first([record.studentName, ...values('studentName')], personName),
    studentAge: first([record.studentAge, record.childAgeAnswer, ...values('studentAge')], normalizeImportedAge),
    locality: first([record.locality, record.cityAnswer, ...values('locality')], normalizeImportedLocality),
    languages,
    studyDays: first([record.studyDays, ...values('studyDays')], normalizeDays),
    studyTime: first([record.studyTime, ...values('studyTime')], normalizeTime),
    goal: first([record.goal, ...values('goal')], value => importText(value).slice(0, 5_000) || null),
    urgency: first([record.urgency, ...values('urgency')], value => importText(value).slice(0, 5_000) || null),
  };
};

const sameText = (left: unknown, right: unknown) => importText(left).replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU')
  === importText(right).replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');

/** Only remove an answer from a comment if its value is actually represented. */
export const isStoredLeadImportAnswer = (
  kind: LeadImportAnswerKind | null,
  value: unknown,
  stored: LeadImportFields,
  resolved: LeadImportFields,
): boolean => {
  if (!kind) return false;
  if (kind === 'contactName' || kind === 'studentName' || kind === 'goal' || kind === 'urgency') {
    return Boolean(stored[kind] && sameText(value, stored[kind]));
  }
  if (kind === 'firstName' || kind === 'lastName') {
    const name = importText(stored.contactName).toLocaleLowerCase('ru-RU');
    const part = importText(value).toLocaleLowerCase('ru-RU');
    return Boolean(part && sameText(stored.contactName, resolved.contactName)
      && (name === part || (kind === 'firstName' ? name.startsWith(`${part} `) : name.endsWith(` ${part}`))));
  }
  if (kind === 'studentAge') return normalizeImportedAge(value) !== null && normalizeImportedAge(value) === stored.studentAge;
  if (kind === 'locality') return Boolean(stored.locality && normalizeImportedLocality(value) === stored.locality);
  if (kind === 'studyDays') return Boolean(stored.studyDays && normalizeDays(value) === stored.studyDays);
  if (kind === 'studyTime') return Boolean(stored.studyTime && normalizeTime(value) === stored.studyTime);
  if (kind === 'phoneNumbers') {
    const parts = importPhoneParts(value);
    return parts.length > 0 && parts.every(part => {
      const phone = normalizeLeadImportPhone(part);
      return phone !== null && stored.phoneNumbers.includes(phone);
    });
  }
  if (kind === 'languages') {
    const parts = importText(value).split(/[,;/]+/);
    return parts.length > 0 && parts.every(part => {
      const language = normalizeImportedLanguage(part);
      return language !== null && stored.languages.includes(language);
    });
  }
  return false;
};
