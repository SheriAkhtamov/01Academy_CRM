import type { MarketingBotCourse, MarketingBotReport, MarketingBotState } from '@shared/contracts/telegram-marketing';

export const marketingCourseNames: Record<MarketingBotCourse, string> = {
  all: 'Все курсы', 'ai-kids': 'AI Kids', 'vibe-coding': 'Вайбкодинг', 'ai-creator': 'AI Creator',
  other: 'Другие курсы', unknown: 'Курс не указан',
};
const button = (text: string, data: string) => ({ text, callback_data: `mr:${data}` });
export const marketingMainKeyboard = { inline_keyboard: [
  [button('📅 Период', 'period'), button('🎓 Курс', 'courses')],
  [button('🔄 Обновить', 'refresh'), button('Выйти', 'logout')],
] };
export const marketingPeriodKeyboard = { inline_keyboard: [
  [button('Сегодня', 'p:today'), button('Вчера', 'p:yesterday')],
  [button('7 дней', 'p:week'), button('Этот месяц', 'p:month')],
  [button('Прошлый месяц', 'p:previous'), button('Свои даты', 'custom')],
  [button('← К отчёту', 'refresh')],
] };
export const marketingCourseKeyboard = { inline_keyboard: [
  [button(marketingCourseNames.all, 'c:all')],
  [button(marketingCourseNames['ai-kids'], 'c:ai-kids'), button(marketingCourseNames['vibe-coding'], 'c:vibe-coding')],
  [button(marketingCourseNames['ai-creator'], 'c:ai-creator')],
  [button(marketingCourseNames.other, 'c:other'), button(marketingCourseNames.unknown, 'c:unknown')],
  [button('← К отчёту', 'refresh')],
] };
export const marketingDatePrompt = 'Введите период: ДД.ММ.ГГГГ — ДД.ММ.ГГГГ';
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
const percent = (part: number, total: number) => total ? `${number(Math.round(part / total * 1000) / 10)}%` : '—';
const date = (value: string) => value.split('-').reverse().join('.');

export function formatMarketingReport(report: MarketingBotReport, state: MarketingBotState, asOf: Date) {
  const timestamp = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(asOf);
  const language = report.languages;
  return [
    '📊 META · РЕЗУЛЬТАТЫ ЗАЯВОК',
    `Заявки: ${date(state.from)} — ${date(state.to)}`,
    `Результаты на ${timestamp} · Ташкент`,
    `🎓 ${marketingCourseNames[state.course]}`,
    '',
    `Новые лиды: ${number(report.leads)}`,
    `📞 Дозвон: ${number(report.reached)} · ${percent(report.reached, report.leads)}`,
    `Недозвон: ${number(report.unreached)}`,
    `Ещё не звонили: ${number(report.notCalled)}`,
    `✅ Квалифицированы: ${number(report.qualified)} · ${percent(report.qualified, report.leads)}`,
    '',
    `📅 Записаны на демо: ${number(report.bookedStudents)} учеников`,
    `Пришли: ${number(report.attendedStudents)} из ${number(report.bookedStudents)} · ${percent(report.attendedStudents, report.bookedStudents)}`,
    `Демо уже наступило: ${number(report.dueStudents)} · доходимость ${percent(report.attendedStudents, report.dueStudents)}`,
    '',
    `💳 Заявки с оплатой: ${number(report.payingLeads)} · ${percent(report.payingLeads, report.leads)}`,
    `Проведённые платежи: ${number(report.payments)}`,
    `Сумма: ${number(report.revenueUzs)} UZS`,
    '',
    'КУРСЫ · ЗАЯВКИ',
    ...(['ai-kids', 'vibe-coding', 'ai-creator', 'other', 'unknown'] as const).map((key) =>
      `${marketingCourseNames[key]}: ${number(report.courses.find((item) => item.course === key)?.count ?? 0)}`),
    '',
    'ЯЗЫК · ЗАЯВКИ',
    `Узбекский: ${number(language.uz)}`,
    `Русский: ${number(language.ru)}`,
    `Узбекский и русский: ${number(language.both)}`,
    `Другой: ${number(language.other)} · Не указан: ${number(language.unknown)}`,
  ].join('\n');
}
