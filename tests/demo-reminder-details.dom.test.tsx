// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DemoReminderStatus } from '../client/src/features/demo-lessons/ui/DemoReminderStatus';
import type { DemoLessonParticipant } from '../client/src/features/demo-lessons/api';
import { i18n } from '../client/src/lib/i18n';

const participant: DemoLessonParticipant = {
  id: 1, studentId: 2, status: 'invited', studentName: 'Learner', canManage: true,
  reminderProgressStatus: 'not_connected',
  reminderRuns: [{ kind: 'day_before', status: 'unanswered', attemptLimit: 3, responseRetry: false, nextAttemptAt: null,
    calls: [{ startedAt: '2026-10-23T10:13:02Z', answeredAt: null, endedAt: '2026-10-23T10:13:23Z',
      talkSeconds: 0, outcome: 'unanswered', reason: 'not_connected', response: null,
      terminationConfirmed: true, causeUnspecified: true, responseRetry: false }] },
  { kind: 'same_day', status: 'waiting', attemptLimit: 2, responseRetry: false,
    nextAttemptAt: '2026-10-24T04:00:00Z', calls: [] }],
};

beforeEach(() => i18n.setLanguage('en'));
afterEach(cleanup);

describe('demo reminder call details', () => {
  it('opens the actual attempts and next call, translates the facts, and restores keyboard focus', async () => {
    const user = userEvent.setup();
    render(<DemoReminderStatus participant={participant} parentOpen />);
    const trigger = screen.getByRole('button', { name: /Learner:.*Call details/ });
    trigger.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Auto-informer calls' });
    expect(within(dialog).getByText('Could not connect')).toBeTruthy();
    expect(within(dialog).getByText('Call ended without a stated reason')).toBeTruthy();
    expect(within(dialog).getByText('1 of 3')).toBeTruthy();
    expect(within(dialog).getByText('0 of 2')).toBeTruthy();
    expect(within(dialog).getByText('Next call')).toBeTruthy();
    expect(within(dialog).getByText('No calls yet')).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/NORMAL_UNSPECIFIED|provider|SQL/);
    act(() => i18n.setLanguage('ru'));
    expect(within(dialog).getByText('Вызов завершён без указания причины')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the parent closes and removes call facts immediately when access is lost', async () => {
    const user = userEvent.setup();
    const view = render(<DemoReminderStatus participant={participant} parentOpen />);
    await user.click(screen.getByRole('button', { name: /Call details/ }));
    view.rerender(<DemoReminderStatus participant={participant} parentOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(<DemoReminderStatus participant={participant} parentOpen />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Call details/ }));
    view.rerender(<DemoReminderStatus participant={{ ...participant, canManage: false }} parentOpen />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Learner')).toBeNull();
  });

  it('distinguishes interrupted audio, a saved response, and an unconfirmed call end', async () => {
    const user = userEvent.setup();
    const first = participant.reminderRuns![0];
    render(<DemoReminderStatus participant={{ ...participant, reminderProgressStatus: 'interrupted', reminderRuns: [{ ...first,
      status: 'failed', calls: [{ ...first.calls[0], reason: 'interrupted', outcome: 'failed', answeredAt: '2026-10-23T10:13:07Z',
        talkSeconds: 12, causeUnspecified: false, terminationConfirmed: false },
      { ...first.calls[0], startedAt: '2026-10-23T11:00:00Z', outcome: 'played', response: 'yes', reason: null, responseRetry: true }],
    }] }} parentOpen />);
    await user.click(screen.getByRole('button', { name: /Call details/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Message interrupted')).toBeTruthy();
    expect(within(dialog).getByText('Answered at')).toBeTruthy();
    expect(within(dialog).getByText('12')).toBeTruthy();
    expect(within(dialog).getByText('Call end not confirmed')).toBeTruthy();
    expect(within(dialog).getByText('Will attend')).toBeTruthy();
    expect(within(dialog).getByText('Confirmation follow-up')).toBeTruthy();
    expect(within(dialog).getByText('1 of 3')).toBeTruthy();
  });
});
