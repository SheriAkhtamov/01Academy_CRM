import { describe, expect, it } from 'vitest';
import { translations } from '../client/src/lib/i18n';
import {
  MODULE_NAVIGATION,
  TASKS_NAVIGATION_ITEM,
} from '../client/src/lib/moduleNavigation';

const localized = (key: keyof typeof translations, language: 'en' | 'ru') => (
  translations[key][language]
);

describe('module navigation naming', () => {
  it('uses concise canonical module names in both languages', () => {
    expect(Object.fromEntries(
      Object.entries(MODULE_NAVIGATION).map(([module, definition]) => [
        module,
        localized(definition.nameKey, 'ru'),
      ]),
    )).toEqual({
      administration: 'Администрирование',
      sales: 'Продажи',
      teacher: 'Преподаватель',
      marketing: 'Маркетинг',
      finance: 'Финансы',
    });

    expect(Object.fromEntries(
      Object.entries(MODULE_NAVIGATION).map(([module, definition]) => [
        module,
        localized(definition.nameKey, 'en'),
      ]),
    )).toEqual({
      administration: 'Administration',
      sales: 'Sales',
      teacher: 'Teacher',
      marketing: 'Marketing',
      finance: 'Finance',
    });
  });

  it('maps every section to its agreed Russian label', () => {
    const sectionNames = Object.fromEntries(
      Object.entries(MODULE_NAVIGATION).map(([module, definition]) => [
        module,
        definition.items.map((item) => localized(item.labelKey, 'ru')),
      ]),
    );

    expect(sectionNames).toEqual({
      administration: [
        'Обзор академии',
        'Сотрудники',
        'Структура академии',
        'Управление продажами',
        'Журнал действий',
        'Интеграции',
      ],
      sales: [
        'Обзор продаж',
        'Воронка продаж',
        'Архив лидов',
        'Расписание занятий',
        'Мои клиенты',
        'Входящие',
        'Журнал звонков',
      ],
      teacher: ['Мои показатели', 'Моё расписание', 'Мои группы', 'Посещаемость'],
      marketing: [
        'Обзор маркетинга',
        'Источники лидов',
        'Воронка и конверсия',
        'Реферальная программа',
        'Маркетинговые расходы',
        'Атрибуция Meta',
        'Менеджер событий Meta',
      ],
      finance: ['Обзор финансов', 'Доходы', 'Расходы', 'Зарплаты', 'Операции'],
    });
    expect(localized(TASKS_NAVIGATION_ITEM.labelKey, 'ru')).toBe('Задачи');
  });

  it('keeps navigation routes unique and stable', () => {
    const hrefs = Object.values(MODULE_NAVIGATION)
      .flatMap((definition) => definition.items.map((item) => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toContain('/sales/messages');
    expect(hrefs).toContain('/teacher-module/schedule');
    expect(hrefs).toContain('/marketing-module/meta-attribution');
    expect(hrefs).toContain('/marketing-module/meta-events');
    expect(hrefs).toContain('/finance/transactions');
    expect(TASKS_NAVIGATION_ITEM.href).toBe('/tasks');
  });
});
