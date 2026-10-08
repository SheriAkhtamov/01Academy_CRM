// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ActivityTimeline } from '../client/src/features/leads/ui/LeadActivity';
import { i18n } from '../client/src/lib/i18n';

afterEach(cleanup);
it.each(['paid', 'deleted_stage'])('preserves the historical label after stage %s is renamed or deleted', (code) => {
  i18n.setLanguage('en');
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><ActivityTimeline
    lead={{ history: [{ id: 1, toStatusCode: code, toStatusName: 'Initial conversation', enteredAt: '2026-10-08T08:00:00Z' }] }}
    dateTime={(value) => value ?? ''} leadStatusName={() => 'Current stage name'} money={(value) => String(value)}
  /></QueryClientProvider>);
  expect(screen.getByText('Initial conversation')).toBeTruthy();
  expect(screen.queryByText('Current stage name')).toBeNull();
  client.clear();
});
