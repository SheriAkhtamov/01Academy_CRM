// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTimeline } from '../client/src/features/leads/ui/LeadActivity';
import { i18n, translations } from '../client/src/lib/i18n';

beforeEach(() => {
  i18n.setLanguage('ru');
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const reminderCallId = '11111111-1111-4111-8111-111111111111';
const reminderCall = {
  id: reminderCallId, source: 'voice_reminder' as const, voiceReminderCallId: reminderCallId,
  direction: 'outgoing' as const, status: 'ended' as const, startedAt: '2026-08-21T12:00:00.000Z',
  talkSeconds: 23, reminderOutcome: 'delivered_no_response' as const, hasRecording: true,
};

const timeline = (calls: Parameters<typeof ActivityTimeline>[0]['lead']['calls']) => render(
  <ActivityTimeline lead={{ calls }} dateTime={(value) => value ?? ''} leadStatusName={(code) => code} money={String} />,
);

describe('call notes in lead activity', () => {
  it('shows a previously saved manager note on its call activity', () => {
    render(
      <ActivityTimeline
        lead={{
          calls: [{
            id: 71,
            direction: 'outgoing',
            status: 'ended',
            startedAt: '2026-08-21T11:40:00.000Z',
            talkSeconds: 125,
            userName: 'Хонзода',
            note: 'Клиент попросил перезвонить после 18:00',
            noteAuthorName: 'Хонзода',
            noteUpdatedAt: '2026-08-21T11:45:11.000Z',
            hasRecording: false,
          }],
        }}
        dateTime={(value) => value ?? ''}
        leadStatusName={(code) => code}
        money={(value) => String(value ?? '')}
      />,
    );

    expect(screen.getByText('Клиент попросил перезвонить после 18:00')).toBeTruthy();
    const noteHeader = screen.getByText(translations.telephonyNote.ru).parentElement!;
    expect(within(noteHeader).getByText('Хонзода')).toBeTruthy();
    expect(screen.getByText('2026-08-21T11:45:11.000Z')).toBeTruthy();
  });

  it('mixes actual reminder calls with manager calls and plays only the reminder conversation from its own protected endpoint', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      url: `/api/telephony/reminder-calls/${reminderCallId}/recording/media`,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const view = timeline([
      { id: 71, source: 'manager', direction: 'incoming', status: 'ended', startedAt: '2026-08-21T11:00:00.000Z',
        talkSeconds: 125, userName: 'Хонзода', note: 'Уточнить расписание', hasRecording: false },
      { ...reminderCall, userName: 'Чужой менеджер', note: 'Чужая заметка', hangupCause: 'NORMAL_CLEARING' },
    ]);
    const botRow = screen.getByText('Автоинформатор').closest('li')!;
    expect(within(botRow).getByText('Напоминание доставлено, ответ не получен')).toBeTruthy();
    expect(within(botRow).getByText(/00:23/)).toBeTruthy();
    expect(screen.getByText(/Хонзода/)).toBeTruthy();
    expect(screen.getByText('Уточнить расписание')).toBeTruthy();
    expect(screen.queryByText(/Чужой менеджер|Чужая заметка|NORMAL_CLEARING/)).toBeNull();
    expect(screen.queryByText(reminderCallId)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Прослушать запись' })).toHaveLength(1);

    await userEvent.setup().click(within(botRow).getByRole('button', { name: 'Прослушать запись' }));
    await waitFor(() => expect(view.container.querySelector('audio')?.getAttribute('src'))
      .toBe(`/api/telephony/reminder-calls/${reminderCallId}/recording/media`));
    expect(fetch).toHaveBeenCalledWith(`/api/telephony/reminder-calls/${reminderCallId}/recording`, expect.objectContaining({ method: 'GET' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: translations.telephonyAddNote.ru })).toBeNull();
  });

  it.each([
    ['ru', 'yes', 'Автоинформатор', 'Придёт'], ['ru', 'no', 'Автоинформатор', 'Не придёт'],
    ['en', 'yes', 'Auto-informer', 'Will attend'], ['en', 'no', 'Auto-informer', 'Will not attend'],
  ] as const)('shows the actual %s %s reply ahead of the call outcome without claiming a recording exists', (language, response, source, label) => {
    i18n.setLanguage(language);
    timeline([{ ...reminderCall, reminderResponse: response, hasRecording: false }]);
    expect(screen.getByText(source)).toBeTruthy();
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText(translations.voiceRemindersDeliveredNoResponse[language])).toBeNull();
    expect(screen.queryByRole('button', { name: translations.telephonyPlayRecording[language] })).toBeNull();
  });

  it('does not route a reminder recording through a manager call id when the explicit recording reference is missing', () => {
    timeline([{ ...reminderCall, voiceReminderCallId: null }]);
    expect(screen.getByText('Автоинформатор')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Прослушать запись' })).toBeNull();
  });
});
