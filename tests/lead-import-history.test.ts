import { describe, expect, it } from 'vitest';
import { historicalLeadImportComments, replaceGeneratedImportParagraph } from '../server/services/lead-import-history';
import { resolveLeadImportFields } from '../server/services/lead-import-fields';

describe('historical Meta comment templates', () => {
  it('preserves surrounding notes and ambiguous, partial, edited or cleared paragraphs', () => {
    const generated = 'Имя: Sevara\nТелефон: +998901234567';
    expect(replaceGeneratedImportParagraph(`Before\n\n${generated}\n\nAfter`, generated, 'Ответ: да')).toBe('Before\n\nОтвет: да\n\nAfter');
    expect(replaceGeneratedImportParagraph(`Before\n\n${generated}\n\nAfter`, generated, '')).toBe('Before\n\nAfter');
    expect(replaceGeneratedImportParagraph(`${generated}\n\n${generated}`, generated, '')).toBe(`${generated}\n\n${generated}`);
    expect(replaceGeneratedImportParagraph(`Manual ${generated}`, generated, '')).toBe(`Manual ${generated}`);
    expect(replaceGeneratedImportParagraph(null, generated, 'Ответ: да')).toBeNull();
  });
  it('recognizes the exact bullet template left by the metadata cleanup and retains unmapped answers', () => {
    const record = { externalId: 'old-meta', answers: [
      { name: 'full_name', values: ['Sevara'] }, { name: 'phone_number', values: ['+998901234567'] },
      { name: 'сколько_вам_лет?', values: ['35'] },
      { name: 'Любимый_предмет', values: ['Математика'] }, { name: 'email', values: ['parent@example.com'] },
    ] };
    expect(historicalLeadImportComments(record, resolveLeadImportFields(record))).toContainEqual({
      before: '• Имя: Sevara\n• Телефон: +998901234567\n• сколько вам лет?: 35\n• Любимый предмет: Математика\n• Электронная почта: parent@example.com',
      after: '• Любимый предмет: Математика\n• Электронная почта: parent@example.com',
    });
  });

  it('preserves original formatting of imported notes, unsupported objects, booleans and invalid values', () => {
    const record = { externalId: 'old-meta', childAgeAnswer: '8 лет', note: 'Перезвонить_завтра\nпосле 18:00', answers: [
      { name: 'phone', values: ['1991'] }, { name: 'city', values: ['toshkent'] },
      { name: 'Любимый_предмет', values: [{ text: 'Math' }, true] },
    ] };
    const variant = historicalLeadImportComments(record, resolveLeadImportFields(record)).find(value => value.before.includes('• Телефон'));
    expect(variant).toEqual({
      before: 'Возраст ребёнка: 8 лет\nЗаметка: Перезвонить завтра\nпосле 18:00\n• Телефон: 1991\n• city: toshkent\n• Любимый предмет: {"text":"Math"}, true',
      after: 'Заметка: Перезвонить завтра\nпосле 18:00\n• Телефон: 1991\n• city: toshkent\n• Любимый предмет: {"text":"Math"}, true',
    });
  });
});
