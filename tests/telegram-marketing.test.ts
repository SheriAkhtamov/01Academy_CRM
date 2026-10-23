import { describe, expect, it, vi } from 'vitest';
import { resolveMarketingCourse, resolveMarketingLanguages } from '../server/modules/telegram-marketing/domain/attribution';
import { summarizeMarketingLeads, type MarketingLeadFact } from '../server/modules/telegram-marketing/domain/report';
import { marketingDateBounds, marketingPeriod, parseMarketingDates } from '../server/modules/telegram-marketing/domain/period';
import { formatMarketingReport } from '../server/modules/telegram-marketing/domain/presentation';
import { createMarketingBotService } from '../server/modules/telegram-marketing/application/bot-service';
import type { MarketingBotPorts } from '../server/modules/telegram-marketing/application/ports';
import { hashMarketingPassword, verifyMarketingPassword } from '../server/modules/telegram-marketing/infrastructure/password';

const fact = (overrides: Partial<MarketingLeadFact> = {}): MarketingLeadFact => ({
  id: 1, courseSlug: 'ai-kids', languages: ['uz'], language: 'ru', attempted: true, reached: true,
  qualified: true, bookedStudentIds: [10, 11], attendedStudentIds: [10], dueStudentIds: [10, 11],
  paymentCount: 2, revenueUzs: 100000, ...overrides,
});
const now = new Date('2026-10-23T21:00:00Z');
const state = { from: '2026-10-01', to: '2026-10-23', course: 'all' as const, awaitingDates: false };

describe('Meta advertising cohort report', () => {
  it('resolves courses from Meta forms but counts languages only after CRM selection', () => {
    expect(resolveMarketingCourse({ courseSlug: null, formName: 'АИ КИДС - РР- УЗБ язык' })).toBe('ai-kids');
    expect(resolveMarketingCourse({ courseSlug: null, formName: 'ВАЙБКОДИНГ - Взрослые' })).toBe('vibe-coding');
    expect(resolveMarketingCourse({ courseSlug: null, formName: 'AI Creator Форма УЗБ' })).toBe('ai-creator');
    expect(resolveMarketingCourse({ courseSlug: null, formName: 'Новая форма' })).toBe('unknown');
    expect(resolveMarketingLanguages({ languages: [], language: '', formName: 'АИ КИДС - УЗБ', campaignName: 'RU campaign' })).toEqual([]);
    expect(resolveMarketingLanguages({ languages: ['ru'], language: '', formName: 'АИ КИДС - УЗБ' })).toEqual(['ru']);
  });
  it('separates calls, students, languages and actual payments without double-counting repeat demos', () => {
    const report = summarizeMarketingLeads([
      fact({ bookedStudentIds: [10, 11, 10], attendedStudentIds: [10, 10] }),
      fact({ id: 2, attempted: true, reached: false, qualified: false, languages: ['ru', 'uz'],
        bookedStudentIds: [], attendedStudentIds: [], dueStudentIds: [], paymentCount: 0, revenueUzs: 0 }),
      fact({ id: 3, courseSlug: null, attempted: false, reached: false, qualified: false, languages: [],
        bookedStudentIds: [], attendedStudentIds: [], dueStudentIds: [], paymentCount: 0, revenueUzs: 0 }),
    ], 'all');
    expect(report).toMatchObject({ leads: 3, reached: 1, unreached: 1, notCalled: 1, qualified: 1,
      bookedStudents: 2, attendedStudents: 1, payingLeads: 1, payments: 2, revenueUzs: 100000,
      languages: { uz: 1, ru: 0, both: 1, unknown: 1, other: 0 } });
    expect(formatMarketingReport(report, state, now)).toContain('Пришли: 1 из 2 · 50%');
  });
  it('applies the course filter to every metric and keeps unrecorded course/language explicit', () => {
    const report = summarizeMarketingLeads([fact(), fact({ id: 2, courseSlug: 'vibe-coding', languages: null })], 'vibe-coding');
    expect(report.leads).toBe(1); expect(report.revenueUzs).toBe(100000); expect(report.languages.ru).toBe(1);
    const empty = summarizeMarketingLeads([], 'all');
    expect(formatMarketingReport(empty, state, now)).not.toMatch(/NaN|Infinity/);
  });
  it('uses Tashkent day boundaries and rejects invalid or future custom dates', () => {
    expect(marketingPeriod('today', now)).toEqual({ from: '2026-10-24', to: '2026-10-24' });
    expect(marketingPeriod('previous', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(marketingDateBounds(state)).toEqual({ start: new Date('2026-09-30T19:00Z'), end: new Date('2026-10-23T19:00Z') });
    expect(parseMarketingDates('01.10.2026 — 23.10.2026', now)).toEqual({ from: state.from, to: state.to });
    for (const text of ['31.02.2026 - 23.10.2026', '23.10.2026 - 01.10.2026', '01.01.2025 - 23.10.2026', '25.10.2026 - 26.10.2026']) {
      expect(parseMarketingDates(text, now)).toBeNull();
    }
  });
  it('stores only a salted password hash and verifies passwords', async () => {
    const hash = await hashMarketingPassword('test-report-pass');
    expect(hash).not.toContain('test-report-pass');
    expect(await verifyMarketingPassword('test-report-pass', hash)).toBe(true);
    expect(await verifyMarketingPassword('incorrect', hash)).toBe(false);
    expect(await verifyMarketingPassword('x', 'corrupt')).toBe(false);
  });
});

describe('marketing bot flow', () => {
  const config = { botToken: '100:test-token', passwordHash: 'hash', webhookSecret: 'secret' };
  function setup(authenticated = true) {
    const ports: MarketingBotPorts = {
      access: { get: vi.fn().mockResolvedValue(authenticated ? { state } : null), authenticate: vi.fn().mockResolvedValue('denied'),
        saveState: vi.fn(), logout: vi.fn() },
      facts: vi.fn().mockResolvedValue([fact()]), telegram: vi.fn().mockResolvedValue(true), now: () => now,
    };
    return { ports, handle: createMarketingBotService(ports) };
  }
  it('never loads financial data before password authentication', async () => {
    const { ports, handle } = setup(false);
    const response = await handle(config, { userId: '42', chatId: 42, text: '/start', messageId: 1 });
    expect(response.text).toContain('пароль'); expect(ports.facts).not.toHaveBeenCalled();
    expect(ports.access.authenticate).not.toHaveBeenCalled();
  });
  it('deletes a password message and respects lockout without requesting a report', async () => {
    const { ports, handle } = setup(false);
    vi.mocked(ports.access.authenticate).mockResolvedValue('locked');
    const response = await handle(config, { userId: '42', chatId: 42, text: 'wrong', messageId: 2 });
    expect(response.text).toContain('15 минут'); expect(ports.facts).not.toHaveBeenCalled();
    expect(ports.telegram).toHaveBeenCalledWith(config.botToken, 'deleteMessage', { chat_id: 42, message_id: 2 });
  });
  it('changes the period and edits the same message after acknowledging a button', async () => {
    const { ports, handle } = setup();
    const response = await handle(config, { userId: '42', chatId: 42, text: 'mr:p:today', messageId: 7, callbackId: 'cb' });
    expect(ports.telegram).toHaveBeenCalledWith(config.botToken, 'answerCallbackQuery', { callback_query_id: 'cb' });
    expect(ports.facts).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-24', to: '2026-10-24' }), now);
    expect(response).toMatchObject({ method: 'editMessageText', message_id: 7 });
  });
  it('does not leak a report when access expires during its calculation', async () => {
    const { ports, handle } = setup();
    vi.mocked(ports.access.get).mockResolvedValueOnce({ state }).mockResolvedValueOnce(null);
    const result = await handle(config, { userId: '42', chatId: 42, text: '/report' });
    expect(result.text).toContain('пароль'); expect(result.text).not.toContain('UZS');
  });
});
