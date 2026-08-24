// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActivityTimeline } from '../client/src/features/leads/ui/LeadActivity';

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
    expect(screen.getByText(/Заметка по звонку · Хонзода|Call note · Хонзода/)).toBeTruthy();
    expect(screen.getByText('2026-08-21T11:45:11.000Z')).toBeTruthy();
  });
});
