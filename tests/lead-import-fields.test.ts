import { describe, expect, it } from 'vitest';
import { buildLeadImportComment } from '../server/services/lead-import-comments';
import { normalizeImportedAge, resolveLeadImportFields } from '../server/services/lead-import-fields';

describe('Meta form field routing', () => {
  it('routes the Uzbek form from the reported contact without manufacturing a phone or district', () => {
    const record = { answers: [
      { name: 'farzandingizni sun’iy intellekt bilan ishlash bo‘yicha ai kids demo-darsimizga yozdirmoqchimisiz?', values: ['ha'] },
      { name: 'qaysi shahardansiz?', values: ['toshkent'] },
      { name: 'farzandingiz nechchi yoshda? (dars 7 yoshdan 10 yoshgacha bolalar uchun mos.)', values: ['8🎂'] },
      { name: 'Телефон', values: ['1991'] },
      { name: 'имя', values: ['Sevara'] },
    ] };
    expect(resolveLeadImportFields(record)).toMatchObject({ contactName: 'Sevara', studentAge: 8, phoneNumbers: [], locality: null });
    const comment = buildLeadImportComment(record);
    expect(comment).toContain('Телефон: 1991');
    expect(comment).toContain('qaysi shahardansiz?: toshkent');
    expect(comment).toContain('yozdirmoqchimisiz?: ha');
    expect(comment).not.toMatch(/Sevara|8🎂/);
  });

  it('keeps all valid phone values even if the first supplied answer is invalid', () => {
    const record = { rawPhone: '1991', answers: [
      { name: 'Telefon raqamingiz', values: ['1991', '+998 90 123 45 67', '998911234567; +99338036603'] },
      { name: 'phone_number', values: ['+998901234567'] },
    ] };
    expect(resolveLeadImportFields(record).phoneNumbers).toEqual(['+998901234567', '+998911234567', '+99338036603']);
    expect(buildLeadImportComment(record)).toBe('Telefon raqamingiz: 1991');
  });

  it('combines first and last names and distinguishes the child from the contact', () => {
    const record = { answers: [
      { name: 'first_name', values: ['Ali', 'Other name'] }, { name: 'last_name', values: ['Valiyev'] },
      { name: 'Farzandingizning ismi', values: ['Vali'] },
    ] };
    expect(resolveLeadImportFields(record)).toMatchObject({ contactName: 'Ali Valiyev', studentName: 'Vali' });
    expect(buildLeadImportComment(record)).toBe('Имя: Other name');
  });

  it('normalizes supported preferences and retains answers without a suitable CRM field', () => {
    const record = { answers: [
      { name: 'Qaysi tumanda yashaysiz?', values: ['Yunusobod tumani'] },
      { name: 'Язык обучения', values: ['O‘zbek tili, Русский'] },
      { name: 'Dars kunlari', values: ['Juft kunlar'] }, { name: 'Dars vaqti', values: ['18:00'] },
      { name: 'Цель обучения', values: ['Изучать программирование'] },
      { name: 'email', values: ['test@example.com'] }, { name: 'learning_format', values: ['online'] },
      { name: 'Любимый предмет', values: ['Математика'] },
    ] };
    expect(resolveLeadImportFields(record)).toMatchObject({ locality: 'yunusabad', languages: ['uz', 'ru'],
      studyDays: 'even', studyTime: '18:00', goal: 'Изучать программирование' });
    expect(buildLeadImportComment(record)).toBe('Электронная почта: test@example.com\nФормат обучения: online\nЛюбимый предмет: Математика');
  });

  it('retains conflicting answers when an existing contact already has different data', () => {
    const record = { contactName: 'New parent', studentAge: 8, answers: [
      { name: 'full_name', values: ['New parent'] }, { name: 'child_age', values: ['8 лет'] },
    ] };
    const stored = { ...resolveLeadImportFields(record), contactName: 'Existing parent', studentAge: 10 };
    expect(buildLeadImportComment(record, stored)).toBe('Имя: New parent\nВозраст ребёнка: 8 лет');
  });

  it.each(['1991', '7-10', '7–10', '8, 10', '8.5', '-8', '0', '121', '8 и 10 лет'])('retains ambiguous or invalid age %s', value => {
    expect(normalizeImportedAge(value)).toBeNull();
    expect(buildLeadImportComment({ childAgeAnswer: value })).toBe(`Возраст ребёнка: ${value}`);
  });
});
